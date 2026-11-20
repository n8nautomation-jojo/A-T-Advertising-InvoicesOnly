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
import { getDb } from "@/lib/database";
import { backupBridge, isBackupEngineAvailable } from "./bridge";
import { getBackupSettingsSnapshot, loadBackupSettings, recordBackupRun } from "./settingsStore";
import type { BackupKind, BackupRunResult } from "./types";

const MIN_TRAILING_DEBOUNCE_MS = 5_000;
const MAX_TRAILING_WAIT_MS = 60_000;

/**
 * Flush committed SQLCipher WAL frames into the main .db file before the native
 * Android SQLite snapshotter reads it, avoiding cross-driver WAL visibility gaps.
 * Uses PASSIVE mode for transaction-triggered runs to prevent locking the database,
 * and TRUNCATE mode only for manual explicit user backups.
 */
export async function flushWalBeforeBackup(mode: "passive" | "truncate" = "passive"): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  const pragma = mode === "truncate" ? "PRAGMA wal_checkpoint(TRUNCATE);" : "PRAGMA wal_checkpoint(PASSIVE);";
  try {
    const db = await getDb();
    await db.query(pragma);
  } catch {
    try {
      const db = await getDb();
      await db.query("PRAGMA wal_checkpoint(PASSIVE);");
    } catch {
      // non-fatal: snapshotter still reads WAL when possible
    }
  }
}

let running = false;
let queued = false;
let hasPendingChanges = false;
let lastAttemptAt = 0;
let trailingTimer: ReturnType<typeof setTimeout> | null = null;
let appPauseListenerRegistered = false;

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
export async function flushPendingTransactionBackup(): Promise<BackupRunResult | null> {
  if (!Capacitor.isNativePlatform() || !isBackupEngineAvailable()) return null;
  if (!hasPendingChanges) return null;
  clearTrailingTimer();
  return runQueue("transaction", "app-pause", true);
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
    // Give the repository's async SQLite write a moment to land, then flush WAL passively without locking readers.
    await new Promise((r) => setTimeout(r, 250));
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
    await flushWalBeforeBackup("truncate");
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
 * Ensures the daily schedule exists (idempotent; WorkManager de-duplicates by
 * unique work name) and attaches the app-pause flush listener once. Called at app start
 * and after restoring a backup.
 */
export async function ensureScheduledBackups(): Promise<void> {
  if (!isBackupEngineAvailable()) return;
  if (!appPauseListenerRegistered && Capacitor.isNativePlatform()) {
    appPauseListenerRegistered = true;
    void CapApp.addListener("appStateChange", ({ isActive }) => {
      if (!isActive) {
        void flushPendingTransactionBackup();
      }
    }).catch((err) => {
      appPauseListenerRegistered = false;
      console.warn("[AutoBackup] could not register appStateChange listener:", err);
    });
  }
  try {
    await loadBackupSettings();
    const settings = getBackupSettingsSnapshot();
    await backupBridge.setScheduledBackupEnabled(settings.autoDaily);
    await backupBridge.saveSettings({
      encryptionEnabled: settings.encryptionEnabled,
      autoDaily: settings.autoDaily,
      retentionDaily: settings.retention.daily,
      retentionWeekly: settings.retention.weekly,
      retentionMonthly: settings.retention.monthly,
      retentionMinimum: settings.retention.keepMinimum,
      staleAfterHours: settings.staleAfterHours,
      transactionThrottleMinutes: settings.transactionThrottleMinutes,
    });
  } catch (err) {
    console.warn("[AutoBackup] could not ensure schedule:", err);
  }
}
