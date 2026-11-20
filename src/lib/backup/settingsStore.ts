/**
 * ═══════════════════════════════════════════════════════════════
 * Backup settings store
 * ═══════════════════════════════════════════════════════════════
 * Stored in the SQLite `settings` table (key = backup_settings_v1) so every
 * backup carries the retention policy, encryption choice and last-run status
 * along with the invoice data.
 *
 * A synchronous in-memory copy backs the React external-store pattern.
 */

import { Capacitor } from "@capacitor/core";
import { getDb } from "@/lib/database";
import { DEFAULT_BACKUP_SETTINGS, type BackupSettings, type RetentionPolicy } from "./types";

const SETTINGS_KEY = "backup_settings_v1";

let snapshot: BackupSettings = { ...DEFAULT_BACKUP_SETTINGS, retention: { ...DEFAULT_BACKUP_SETTINGS.retention } };
let loaded = false;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((fn) => fn());
}

export function subscribeBackupSettings(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getBackupSettingsSnapshot(): BackupSettings {
  return snapshot;
}

function sanitize(raw: any): BackupSettings {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_BACKUP_SETTINGS, retention: { ...DEFAULT_BACKUP_SETTINGS.retention } };
  const retention: RetentionPolicy = {
    daily: clampInt(raw.retention?.daily, 1, 60, DEFAULT_BACKUP_SETTINGS.retention.daily),
    weekly: clampInt(raw.retention?.weekly, 1, 52, DEFAULT_BACKUP_SETTINGS.retention.weekly),
    monthly: clampInt(raw.retention?.monthly, 1, 120, DEFAULT_BACKUP_SETTINGS.retention.monthly),
    keepMinimum: clampInt(raw.retention?.keepMinimum, 1, 10, DEFAULT_BACKUP_SETTINGS.retention.keepMinimum),
  };
  return {
    folderUri: typeof raw.folderUri === "string" ? raw.folderUri : "",
    folderLabel: typeof raw.folderLabel === "string" ? raw.folderLabel : "",
    encryptionEnabled: Boolean(raw.encryptionEnabled),
    encryptionKey: "",
    autoDaily: raw.autoDaily !== false,
    afterTransaction: raw.afterTransaction !== false,
    retention,
    transactionThrottleMinutes: clampInt(raw.transactionThrottleMinutes, 1, 240, DEFAULT_BACKUP_SETTINGS.transactionThrottleMinutes),
    staleAfterHours: clampInt(raw.staleAfterHours, 1, 24 * 30, DEFAULT_BACKUP_SETTINGS.staleAfterHours),
    lastBackupAt: typeof raw.lastBackupAt === "string" ? raw.lastBackupAt : null,
    lastBackupStatus: raw.lastBackupStatus === "ok" || raw.lastBackupStatus === "failed" ? raw.lastBackupStatus : "never",
    lastBackupMessage: typeof raw.lastBackupMessage === "string" ? raw.lastBackupMessage : null,
    lastDataChangeAt: typeof raw.lastDataChangeAt === "string" ? raw.lastDataChangeAt : null,
    onboardingCompletedAt: typeof raw.onboardingCompletedAt === "string" ? raw.onboardingCompletedAt : null,
    dismissedRecoveryBackupId: typeof raw.dismissedRecoveryBackupId === "string" ? raw.dismissedRecoveryBackupId : null,
    lastPreUpdateVersion: typeof raw.lastPreUpdateVersion === "string" ? raw.lastPreUpdateVersion : null,
    recoveryKeyExportedAt: typeof raw.recoveryKeyExportedAt === "string" ? raw.recoveryKeyExportedAt : null,
  };
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

function autoDailyTouched(patch: Partial<BackupSettings>): boolean {
  return Object.prototype.hasOwnProperty.call(patch, "autoDaily");
}

function nativeSettingsTouched(patch: Partial<BackupSettings>): boolean {
  return (
    Object.prototype.hasOwnProperty.call(patch, "encryptionEnabled") ||
    Object.prototype.hasOwnProperty.call(patch, "autoDaily") ||
    Object.prototype.hasOwnProperty.call(patch, "retention") ||
    Object.prototype.hasOwnProperty.call(patch, "staleAfterHours") ||
    Object.prototype.hasOwnProperty.call(patch, "transactionThrottleMinutes")
  );
}

export async function loadBackupSettings(force = false): Promise<BackupSettings> {
  if (loaded && !force) return snapshot;
  if (force) {
    loaded = false;
  }
  loaded = true;
  if (!Capacitor.isNativePlatform()) return snapshot;
  try {
    const db = await getDb();
    const res = await db.query("SELECT value FROM settings WHERE key = ?", [SETTINGS_KEY]);
    const value = res.values?.[0]?.value;
    if (typeof value === "string" && value) {
      const preservedFolderUri = snapshot.folderUri;
      const preservedFolderLabel = snapshot.folderLabel;
      const next = sanitize(JSON.parse(value));
      // When reloading after restoring an older database snapshot, keep the
      // device's active SAF folder binding if the restored DB had none.
      if (!next.folderUri && preservedFolderUri) {
        next.folderUri = preservedFolderUri;
        next.folderLabel = preservedFolderLabel;
      }
      if (!force && snapshot.lastDataChangeAt) {
        const memMs = Date.parse(snapshot.lastDataChangeAt);
        const dbMs = next.lastDataChangeAt ? Date.parse(next.lastDataChangeAt) : NaN;
        if (Number.isFinite(memMs) && (!Number.isFinite(dbMs) || memMs > dbMs)) {
          next.lastDataChangeAt = snapshot.lastDataChangeAt;
        }
      }
      snapshot = next;
      notify();
    } else if (force) {
      const preservedFolderUri = snapshot.folderUri;
      const preservedFolderLabel = snapshot.folderLabel;
      snapshot = sanitize({
        ...DEFAULT_BACKUP_SETTINGS,
        folderUri: preservedFolderUri,
        folderLabel: preservedFolderLabel,
      });
      notify();
    }
  } catch (err) {
    console.warn("[BackupSettings] load failed:", err);
  }
  return snapshot;
}

export async function saveBackupSettings(patch: Partial<BackupSettings>): Promise<BackupSettings> {
  snapshot = sanitize({ ...snapshot, ...patch, encryptionKey: "" });
  notify();
  if (Capacitor.isNativePlatform() && (autoDailyTouched(patch) || nativeSettingsTouched(patch))) {
    try {
      const { backupBridge } = await import("./bridge");
      if (autoDailyTouched(patch)) {
        // The native scheduler is the source of truth for the daily cadence.
        await backupBridge.setScheduledBackupEnabled(snapshot.autoDaily);
      }
      if (nativeSettingsTouched(patch)) {
        // Sync native-consumed settings immediately so encryption/retention toggles take effect without restart (SEC-02).
        await backupBridge.saveSettings({
          encryptionEnabled: snapshot.encryptionEnabled,
          autoDaily: snapshot.autoDaily,
          retentionDaily: snapshot.retention.daily,
          retentionWeekly: snapshot.retention.weekly,
          retentionMonthly: snapshot.retention.monthly,
          retentionMinimum: snapshot.retention.keepMinimum,
          staleAfterHours: snapshot.staleAfterHours,
          transactionThrottleMinutes: snapshot.transactionThrottleMinutes,
        });
      }
    } catch (err) {
      console.warn("[BackupSettings] native settings sync failed:", err);
    }
  }
  if (Capacitor.isNativePlatform()) {
    try {
      const db = await getDb();
      await db.run("INSERT OR REPLACE INTO settings(key, value) VALUES(?,?)", [SETTINGS_KEY, JSON.stringify(snapshot)]);
    } catch (err) {
      console.warn("[BackupSettings] save failed:", err);
    }
  }
  return snapshot;
}

/**
 * Updates `lastDataChangeAt` synchronously in memory and notifies subscribers
 * without adding an extra SQLite write on every mutation. Persisted naturally
 * whenever settings or a backup run saves to SQLite.
 */
export function markDataChangedInMemory(iso?: string): void {
  const nextIso = typeof iso === "string" && iso ? iso : new Date().toISOString();
  snapshot = { ...snapshot, lastDataChangeAt: nextIso };
  notify();
}

/** Records the outcome of a backup run for the dashboard. */
export async function recordBackupRun(status: "ok" | "failed", at: string, message: string | null): Promise<void> {
  await saveBackupSettings({ lastBackupAt: at, lastBackupStatus: status, lastBackupMessage: message });
}

export function resetBackupSettingsCacheForTests(): void {
  loaded = false;
  snapshot = { ...DEFAULT_BACKUP_SETTINGS, retention: { ...DEFAULT_BACKUP_SETTINGS.retention } };
}
