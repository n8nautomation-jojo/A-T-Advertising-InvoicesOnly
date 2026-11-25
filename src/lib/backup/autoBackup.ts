/**
 * ═══════════════════════════════════════════════════════════════
 * Automatic backup triggers (type A: after important transactions)
 * ═══════════════════════════════════════════════════════════════
 * Every mutation path in the app already writes through a repository. This
 * module is the single entry point those paths call after a successful write.
 *
 * Design rules:
 *  - Never runs synchronously inside the write path: the caller fires and
 *    forgets, the UI is never blocked.
 *  - Coalesces bursts: while a backup is running, further requests collapse
 *    into ONE follow-up run instead of queueing N snapshots.
 *  - Throttles by time AND content: `skipIfUnchanged` lets the native engine
 *    see the same database hash and return without writing a file.
 *  - Never throws at the caller: a failed automatic backup must not break the
 *    invoice save that triggered it. Failures are recorded for the dashboard.
 */

import { Capacitor } from "@capacitor/core";
import { App as CapApp } from "@capacitor/app";
import * as dbModule from "@/lib/database";
import { backupBridge, isBackupEngineAvailable } from "./bridge";
import { shouldCreateScheduledBackup } from "./retention";
import { getBackupSettingsSnapshot, loadBackupSettings, recordBackupRun } from "./settingsStore";
import { countBusinessRecords, countInvoices, newestVerified } from "./validation";
import type { BackupKind, BackupRunResult } from "./types";

const MIN_TRAILING_DEBOUNCE_MS = 3_000;
const MAX_TRAILING_WAIT_MS = 10_000;

function runWithWriteLock<T>(fn: () => Promise<T>): Promise<T> {
  try {
    const lock = (dbModule as Record<string, unknown>)["withDbWriteLock"];
    if (typeof lock === "function") {
      return (lock as (cb: () => Promise<T>) => Promise<T>)(fn);
    }
  } catch {
    // Partial test mocks may omit withDbWriteLock
  }
  return fn();
}

/**
 * Flush committed SQLCipher WAL frames passively under the FIFO write lock so
 * WAL checkpoints never collide with open beginTransaction() write scopes.
 */
export async function flushWalBeforeBackup(mode: "passive" | "truncate" = "passive"): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  const pragma = mode === "truncate" ? "PRAGMA wal_checkpoint(TRUNCATE);" : "PRAGMA wal_checkpoint(PASSIVE);";
  await runWithWriteLock(async () => {
    try {
      const db = await dbModule.getDb();
      await db.query(pragma);
    } catch {
      try {
        const db = await dbModule.getDb();
        await db.query("PRAGMA wal_checkpoint(PASSIVE);");
      } catch {
        // non-fatal: native snapshotter uses SQLCipher's open handle or WAL recovery directly
      }
    }
  });
}

let running = false;
let queued = false;
let hasPendingChanges = false;
let lastAttemptAt = 0;
let trailingTimer: ReturnType<typeof setTimeout> | null = null;
let appPauseListenerRegistered = false;
let visibilityListenerRegistered = false;
let visibilityHandler: (() => void) | null = null;

type Listener = (result: BackupRunResult) => void;
const listeners = new Set<Listener>();

function clearTrailingTimer(): void {
  if (trailingTimer !== null) {
    clearTimeout(trailingTimer);
    trailingTimer = null;
  }
}

function scheduleTrailingBackup(delayMs: number, reason: string): void {
  clearTrailingTimer();
  const boundedDelay = Math.max(MIN_TRAILING_DEBOUNCE_MS, delayMs);
  trailingTimer = setTimeout(() => {
    trailingTimer = null;
    if (!hasPendingChanges) return;
    void runQueue("transaction", reason, true).catch((err) => {
      console.warn("[AutoBackup] trailing backup failed:", err);
    });
  }, boundedDelay);
}

/** UI can subscribe to background results (dashboard toast / badge). */
export function subscribeBackupRuns(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(result: BackupRunResult) {
  listeners.forEach((fn) => {
    try {
      fn(result);
    } catch {
      // a broken listener must not stop the backup engine
    }
  });
}

/** True when a backup operation is currently in flight. */
export function isBackupRunning(): boolean {
  return running;
}

/** Resets module state (tests only). */
export function resetAutoBackupStateForTests(): void {
  running = false;
  queued = false;
  hasPendingChanges = false;
  lastAttemptAt = 0;
  clearTrailingTimer();
  appPauseListenerRegistered = false;
  if (visibilityHandler && typeof document !== "undefined") {
    document.removeEventListener("visibilitychange", visibilityHandler);
    visibilityHandler = null;
  }
  visibilityListenerRegistered = false;
  listeners.clear();
}

/**
 * Main entry point for mutation-triggered backups.
 * Safe to call on every invoice/record save: uses a leading + trailing
 * debounce scheduler so rapid bursts coalesce without ever dropping changes.
 */
export function triggerBackupAfterTransaction(reason = "transaction"): void {
  if (!Capacitor.isNativePlatform() || !isBackupEngineAvailable()) return;
  hasPendingChanges = true;
  void runQueue("transaction", reason, false).catch((err) => {
    console.warn("[AutoBackup] trigger failed:", err);
  });
}

/**
 * Immediately flushes any pending transaction-triggered backup (bypassing the
 * throttle window). Invoked automatically when the app moves to background.
 */
export async function flushPendingTransactionBackup(reason = "app-pause"): Promise<BackupRunResult | null> {
  if (!Capacitor.isNativePlatform() || !isBackupEngineAvailable()) return null;
  if (!hasPendingChanges) return null;
  clearTrailingTimer();
  return runQueue("transaction", reason, true);
}

/**
 * Whether a transaction-triggered backup should even be attempted now.
 * Exported for tests; the throttle window comes from the user's settings.
 */
export function shouldAttemptTransactionBackup(
  now: number,
  lastAttempt: number,
  throttleMinutes: number,
  autoEnabled: boolean
): boolean {
  if (!autoEnabled) return false;
  return now - lastAttempt >= Math.max(1, throttleMinutes) * 60_000;
}

async function runQueue(kind: BackupKind, reason: string, bypassThrottle: boolean): Promise<BackupRunResult | null> {
  if (running) {
    queued = true;
    return null;
  }
  await loadBackupSettings();
  const settings = getBackupSettingsSnapshot();
  if (kind === "transaction") {
    if (!settings.afterTransaction) {
      hasPendingChanges = false;
      clearTrailingTimer();
      return null;
    }
    const now = Date.now();
    if (!bypassThrottle && !shouldAttemptTransactionBackup(now, lastAttemptAt, settings.transactionThrottleMinutes, true)) {
      const throttleMs = Math.max(1, settings.transactionThrottleMinutes) * 60_000;
      const remainingMs = Math.max(0, throttleMs - (now - lastAttemptAt));
      const delayMs = Math.max(MIN_TRAILING_DEBOUNCE_MS, Math.min(remainingMs, MAX_TRAILING_WAIT_MS));
      if (trailingTimer === null) {
        scheduleTrailingBackup(delayMs, reason);
      }
      return null;
    }
    clearTrailingTimer();
    lastAttemptAt = now;
  }

  running = true;
  try {
    // Give the repository's async SQLite write a moment to land unless the app is pausing/hiding right now.
    const settleDelayMs = reason === "app-pause" || reason === "visibility-hidden" ? 0 : 250;
    if (settleDelayMs > 0) {
      await new Promise((r) => setTimeout(r, settleDelayMs));
    }
    await flushWalBeforeBackup("passive");
    const settingsNow = getBackupSettingsSnapshot();
    const result = await backupBridge.createBackup(kind, {
      skipIfUnchanged: true,
      encrypt: settingsNow.encryptionEnabled,
    });
    const nowIso = new Date().toISOString();
    if (result.ok) {
      if (!queued) {
        hasPendingChanges = false;
        clearTrailingTimer();
      }
      await recordBackupRun("ok", nowIso, null);
      const emitted: BackupRunResult = { ...result, message: "تم حفظ نسخة احتياطية تلقائية (" + reason + ")" };
      emit(emitted);
      return emitted;
    } else {
      if (kind === "transaction" && result.errorCode === "NO_FOLDER") {
        hasPendingChanges = false;
        clearTrailingTimer();
        return result;
      }
      await recordBackupRun("failed", nowIso, result.message ?? result.errorCode ?? "خطأ غير معروف");
      emit(result);
      return result;
    }
  } catch (err: unknown) {
    const rawMsg = err instanceof Error ? err.message : String(err);
    const message = rawMsg === "NATIVE_UNAVAILABLE" ? "وحدة النسخ الاحتياطي غير متوفرة في هذه النسخة." : rawMsg;
    await recordBackupRun("failed", new Date().toISOString(), message);
    const failed: BackupRunResult = { ok: false, errorCode: "IO_FAILED", message };
    emit(failed);
    return failed;
  } finally {
    running = false;
    if (queued) {
      queued = false;
      hasPendingChanges = true;
      scheduleTrailingBackup(MIN_TRAILING_DEBOUNCE_MS, "queued");
    }
  }
}

/**
 * Manual backup from the UI. Bypasses the throttle; still coalesces with a
 * running operation so two taps cannot produce overlapping snapshots.
 */
export async function createManualBackup(): Promise<BackupRunResult> {
  if (!isBackupEngineAvailable()) {
    return { ok: false, errorCode: "UNSUPPORTED", message: "النسخ الاحتياطي متاح داخل تطبيق أندرويد فقط." };
  }
  if (running) {
    return { ok: false, errorCode: "ALREADY_RUNNING", message: "هناك عملية نسخ احتياطي جارية بالفعل، انتظر قليلاً." };
  }
  running = true;
  try {
    await flushWalBeforeBackup("passive");
    await loadBackupSettings();
    const settings = getBackupSettingsSnapshot();
    const result = await backupBridge.createBackup("manual", { skipIfUnchanged: false, encrypt: settings.encryptionEnabled });
    const nowIso = new Date().toISOString();
    if (result.ok) {
      lastAttemptAt = Date.now();
      if (!queued) {
        hasPendingChanges = false;
        clearTrailingTimer();
      }
      await recordBackupRun("ok", nowIso, null);
    } else {
      await recordBackupRun("failed", nowIso, result.message ?? result.errorCode ?? "خطأ غير معروف");
    }
    return result;
  } catch (err: unknown) {
    const rawMsg = err instanceof Error ? err.message : String(err);
    const message = rawMsg === "NATIVE_UNAVAILABLE" ? "وحدة النسخ الاحتياطي غير متوفرة في هذه النسخة." : rawMsg;
    await recordBackupRun("failed", new Date().toISOString(), message);
    return { ok: false, errorCode: "IO_FAILED", message };
  } finally {
    running = false;
  }
}

/**
 * Immediately creates an initial verified backup right after the user links or
 * reconnects a SAF backup folder so their data is protected without waiting.
 */
export async function runInitialBackupAfterFolderLink(): Promise<BackupRunResult> {
  if (!isBackupEngineAvailable()) {
    return { ok: false, errorCode: "UNSUPPORTED", message: "النسخ الاحتياطي متاح داخل تطبيق أندرويد فقط." };
  }
  if (running) {
    const deadline = Date.now() + 2_000;
    while (running && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
    }
    if (running) {
      return { ok: false, errorCode: "ALREADY_RUNNING", message: "هناك عملية نسخ احتياطي جارية بالفعل، انتظر قليلاً." };
    }
  }
  running = true;
  try {
    await flushWalBeforeBackup("passive");
    await loadBackupSettings();
    const settings = getBackupSettingsSnapshot();

    // New-phone transfer protection: if this device's DB is completely empty (0 business
    // records) and the chosen folder already holds verified backups from a previous phone,
    // do not clutter the folder with an empty snapshot — prompt the user to restore instead.
    try {
      if (typeof backupBridge.getStatus === "function") {
        const preStatus = await backupBridge.getStatus();
        if (preStatus?.ok && preStatus.status) {
          const liveInvoices =
            preStatus.status.database.invoiceCount ??
            countInvoices(preStatus.status.database.counts);
          const liveBusiness =
            preStatus.status.database.totalBusinessRecords ??
            countBusinessRecords(preStatus.status.database.counts);
          const existingVerified = (preStatus.status.backups ?? []).filter(
            (b) => b.status === "verified" && b.manifest
          );
          if (liveInvoices === 0 && liveBusiness === 0 && existingVerified.length > 0) {
            const skippedRes: BackupRunResult = {
              ok: true,
              skipped: true,
              skipReason: "empty-db-existing-backups",
              message: `تم العثور على ${existingVerified.length} نسخة احتياطية سابقة في هذا المجلد — يمكنك استعادتها فوراً من زر (استعادة نسخة).`,
            };
            emit(skippedRes);
            return skippedRes;
          }
        }
      }
    } catch {
      // Non-fatal: proceed to create initial backup cleanly
    }

    const result = await backupBridge.createBackup("daily", {
      skipIfUnchanged: false,
      encrypt: settings.encryptionEnabled,
    });
    const nowIso = new Date().toISOString();
    if (result.ok) {
      lastAttemptAt = Date.now();
      if (!queued) {
        hasPendingChanges = false;
        clearTrailingTimer();
      }
      await recordBackupRun("ok", nowIso, null);
      emit(result);
      return result;
    } else {
      await recordBackupRun("failed", nowIso, result.message ?? result.errorCode ?? "خطأ غير معروف");
      emit(result);
      return result;
    }
  } catch (err: unknown) {
    const rawMsg = err instanceof Error ? err.message : String(err);
    const message = rawMsg === "NATIVE_UNAVAILABLE" ? "وحدة النسخ الاحتياطي غير متوفرة في هذه النسخة." : rawMsg;
    await recordBackupRun("failed", new Date().toISOString(), message);
    const failed: BackupRunResult = { ok: false, errorCode: "IO_FAILED", message };
    emit(failed);
    return failed;
  } finally {
    running = false;
    if (queued) {
      queued = false;
      hasPendingChanges = true;
      scheduleTrailingBackup(MIN_TRAILING_DEBOUNCE_MS, "queued");
    }
  }
}

/**
 * Catches up any missed daily or transaction backup on app startup or resume
 * (essential on OEM Android phones that delay or kill background WorkManager jobs).
 */
export async function runCatchUpAutoBackupIfNeeded(): Promise<BackupRunResult | null> {
  if (!Capacitor.isNativePlatform() || !isBackupEngineAvailable() || running) return null;
  await loadBackupSettings();
  const settings = getBackupSettingsSnapshot();
  if (!settings.autoDaily && !settings.afterTransaction) return null;

  let statusRes: Awaited<ReturnType<typeof backupBridge.getStatus>> | null = null;
  try {
    if (typeof backupBridge.getStatus !== "function") return null;
    statusRes = await backupBridge.getStatus();
  } catch {
    return null;
  }
  if (!statusRes?.ok || !statusRes.status || statusRes.status.storage?.state !== "ok") {
    return null;
  }

  const status = statusRes.status;
  const backups = status.backups ?? [];
  const verified = backups.filter((b) => b.status === "verified" && b.sha256Ok && b.manifest);
  const nowMs = Date.now();

  const needsInitial = verified.length === 0;
  const needsDaily =
    settings.autoDaily &&
    shouldCreateScheduledBackup("daily", nowMs, backups, new Date().getTimezoneOffset());

  let needsTransactionCatchUp = false;
  if (settings.afterTransaction) {
    if (hasPendingChanges) {
      needsTransactionCatchUp = true;
    } else {
      const newest = newestVerified(backups);
      if (newest?.manifest) {
        const dbInvoices = status.database.invoiceCount ?? countInvoices(status.database.counts);
        const dbBusiness = status.database.totalBusinessRecords ?? countBusinessRecords(status.database.counts);
        const backupInvoices = newest.manifest.invoiceCount ?? countInvoices(newest.manifest.counts);
        const backupBusiness = newest.manifest.totalBusinessRecords ?? countBusinessRecords(newest.manifest.counts);
        const newestMs = Date.parse(newest.manifest.createdAt);
        const lastChangeMs = settings.lastDataChangeAt ? Date.parse(settings.lastDataChangeAt) : NaN;
        if (
          backupInvoices < dbInvoices ||
          backupBusiness < dbBusiness ||
          (Number.isFinite(lastChangeMs) && Number.isFinite(newestMs) && lastChangeMs > newestMs + 2_000)
        ) {
          needsTransactionCatchUp = true;
        }
      }
    }
  }

  if (!needsInitial && !needsDaily && !needsTransactionCatchUp) return null;
  if (running) return null;

  const kind: BackupKind = needsDaily ? "daily" : "transaction";
  const skipIfUnchanged = verified.length > 0;
  running = true;
  try {
    await flushWalBeforeBackup("passive");
    const settingsNow = getBackupSettingsSnapshot();
    const result = await backupBridge.createBackup(kind, {
      skipIfUnchanged,
      encrypt: settingsNow.encryptionEnabled,
    });
    const nowIso = new Date().toISOString();
    if (result.ok) {
      lastAttemptAt = Date.now();
      if (!queued) {
        hasPendingChanges = false;
        clearTrailingTimer();
      }
      await recordBackupRun("ok", nowIso, null);
      emit(result);
      return result;
    }
    if (result.errorCode !== "NO_FOLDER") {
      await recordBackupRun("failed", nowIso, result.message ?? result.errorCode ?? "خطأ غير معروف");
      emit(result);
    }
    return result;
  } catch (err: unknown) {
    const rawMsg = err instanceof Error ? err.message : String(err);
    const message = rawMsg === "NATIVE_UNAVAILABLE" ? "وحدة النسخ الاحتياطي غير متوفرة في هذه النسخة." : rawMsg;
    await recordBackupRun("failed", new Date().toISOString(), message);
    const failed: BackupRunResult = { ok: false, errorCode: "IO_FAILED", message };
    emit(failed);
    return failed;
  } finally {
    running = false;
    if (queued) {
      queued = false;
      hasPendingChanges = true;
      scheduleTrailingBackup(MIN_TRAILING_DEBOUNCE_MS, "queued");
    }
  }
}

/**
 * Ensures the daily schedule exists (idempotent; WorkManager de-duplicates by
 * unique work name) and attaches the app-pause/resume & visibility flush listeners
 * once. Called at app start and after restoring a backup.
 */
export async function ensureScheduledBackups(): Promise<void> {
  if (!isBackupEngineAvailable()) return;
  if (!appPauseListenerRegistered && Capacitor.isNativePlatform()) {
    appPauseListenerRegistered = true;
    void CapApp.addListener("appStateChange", ({ isActive }) => {
      if (!isActive) {
        if (hasPendingChanges) {
          void flushPendingTransactionBackup("app-pause");
          if (typeof backupBridge.scheduleImmediateCatchUp === "function") {
            void backupBridge.scheduleImmediateCatchUp().catch(() => {});
          }
        }
      } else {
        void runCatchUpAutoBackupIfNeeded();
      }
    }).catch((err) => {
      appPauseListenerRegistered = false;
      console.warn("[AutoBackup] could not register appStateChange listener:", err);
    });
  }
  if (!visibilityListenerRegistered && Capacitor.isNativePlatform() && typeof document !== "undefined") {
    visibilityListenerRegistered = true;
    visibilityHandler = () => {
      if (document.visibilityState === "hidden" && hasPendingChanges) {
        void flushPendingTransactionBackup("visibility-hidden");
        if (typeof backupBridge.scheduleImmediateCatchUp === "function") {
          void backupBridge.scheduleImmediateCatchUp().catch(() => {});
        }
      }
    };
    document.addEventListener("visibilitychange", visibilityHandler);
  }
  try {
    await loadBackupSettings();
    const settings = getBackupSettingsSnapshot();
    await backupBridge.setScheduledBackupEnabled(settings.autoDaily);
    await backupBridge.saveSettings({
      encryptionEnabled: settings.encryptionEnabled,
      autoDaily: settings.autoDaily,
      afterTransaction: settings.afterTransaction,
      retentionDaily: settings.retention.daily,
      retentionWeekly: settings.retention.weekly,
      retentionMonthly: settings.retention.monthly,
      retentionMinimum: settings.retention.keepMinimum,
      retentionMaxAgeDays: settings.retention.maxAgeDays ?? 30,
      staleAfterHours: settings.staleAfterHours,
      transactionThrottleMinutes: settings.transactionThrottleMinutes,
    });
    void runCatchUpAutoBackupIfNeeded();
  } catch (err) {
    console.warn("[AutoBackup] could not ensure schedule:", err);
  }
}
