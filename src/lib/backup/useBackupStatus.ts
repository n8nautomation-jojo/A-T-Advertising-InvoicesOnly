/**
 * ═══════════════════════════════════════════════════════════════
 * Backup dashboard state (React hook) + discovery flow
 * ═══════════════════════════════════════════════════════════════
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { backupBridge, isBackupEngineAvailable } from "./bridge";
import { loadBackupSettings, getBackupSettingsSnapshot, saveBackupSettings, subscribeBackupSettings } from "./settingsStore";
import {
  assessProtection,
  countBusinessRecords,
  countInvoices,
  decideDiscovery,
  newestVerified,
  newestWithData,
} from "./validation";
import type { DiscoveryDecision, ProtectionAssessment } from "./validation";
import type {
  BackupFileInfo,
  BackupSettings,
  BackupPreview,
  DatabaseStatus,
  StorageInfo,
} from "./types";

export interface DashboardState {
  loading: boolean;
  available: boolean;
  storage: StorageInfo | null;
  database: DatabaseStatus | null;
  backups: BackupFileInfo[];
  settings: BackupSettings;
  protection: ProtectionAssessment;
  encryptionAvailable: boolean;
  engineVersion: string;
  lastBackupAt: string | null;
  hasEncryptionKey: boolean;
  encryptionKeyId: string;
  databaseBusinessRecordCount: number;
  error: string | null;
}

const EMPTY_STORAGE: StorageInfo = {
  state: Capacitor.isNativePlatform() ? "unavailable" : "browser",
  folderUri: "",
  folderLabel: "",
  totalBytes: -1,
  freeBytes: -1,
  appDataBytes: 0,
  backupBytes: 0,
  backupCount: 0,
};

const EMPTY_DATABASE: DatabaseStatus = {
  exists: false,
  schemaVersion: 0,
  quickCheckOk: true,
  integrityDetail: "",
  counts: {},
  invoiceCount: 0,
  totalBusinessRecords: 0,
  fileBytes: 0,
  walBytes: 0,
  journalMode: "",
};

export interface LoadedStatus {
  storage: StorageInfo;
  database: DatabaseStatus;
  backups: BackupFileInfo[];
  protection: ProtectionAssessment;
  encryptionAvailable: boolean;
  engineVersion: string;
  lastBackupAt: string | null;
  hasEncryptionKey: boolean;
  encryptionKeyId: string;
  databaseBusinessRecordCount: number;
  error: string | null;
}

function pickNewerIso(a?: string | null, b?: string | null): string | null {
  const aMs = a ? Date.parse(a) : NaN;
  const bMs = b ? Date.parse(b) : NaN;
  if (Number.isFinite(aMs) && Number.isFinite(bMs)) return aMs >= bMs ? a! : b!;
  if (Number.isFinite(aMs)) return a!;
  if (Number.isFinite(bMs)) return b!;
  return null;
}

/** Single source of truth for "what is the backup situation right now". */
export async function loadBackupStatus(): Promise<LoadedStatus> {
  const settings = await loadBackupSettings();
  if (!isBackupEngineAvailable()) {
    return {
      storage: EMPTY_STORAGE,
      database: EMPTY_DATABASE,
      backups: [],
      protection: assessProtection({
        storage: EMPTY_STORAGE,
        backups: [],
        settings,
        databaseInvoiceCount: 0,
        databaseBusinessRecordCount: 0,
        now: Date.now(),
      }),
      encryptionAvailable: false,
      engineVersion: "",
      lastBackupAt: settings.lastBackupAt,
      hasEncryptionKey: false,
      encryptionKeyId: "",
      databaseBusinessRecordCount: 0,
      error: Capacitor.isNativePlatform() ? "وحدة النسخ الاحتياطي غير مثبّتة في هذا البناء." : null,
    };
  }

  const statusRes = await backupBridge.getStatus();
  const engineStatus = statusRes.ok && statusRes.status ? statusRes.status : null;
  const storage: StorageInfo = engineStatus ? engineStatus.storage : EMPTY_STORAGE;
  const database: DatabaseStatus = engineStatus ? engineStatus.database : EMPTY_DATABASE;
  const backups: BackupFileInfo[] = engineStatus ? engineStatus.backups : [];
  const databaseBusinessRecordCount = database.totalBusinessRecords ?? countBusinessRecords(database.counts);
  const nativeLastBackupAt = engineStatus?.lastNativeBackupAt ?? null;
  const nativeLastBackupStatus = engineStatus?.lastNativeBackupStatus;
  const nativeLastBackupMessage = engineStatus?.lastNativeBackupMessage ?? null;

  const protection = assessProtection({
    storage,
    backups,
    settings,
    databaseInvoiceCount: database.invoiceCount,
    databaseBusinessRecordCount,
    nativeLastBackupAt,
    nativeLastBackupStatus,
    nativeLastBackupMessage,
    now: Date.now(),
  });

  // Keep the persisted folder label in sync with what the system reports.
  if (storage.folderUri && storage.folderUri !== settings.folderUri) {
    await saveBackupSettings({ folderUri: storage.folderUri, folderLabel: storage.folderLabel });
  }

  return {
    storage,
    database,
    backups,
    protection,
    encryptionAvailable: engineStatus ? engineStatus.encryptionAvailable : false,
    engineVersion: engineStatus ? engineStatus.engineVersion : "",
    lastBackupAt: pickNewerIso(nativeLastBackupAt, settings.lastBackupAt),
    hasEncryptionKey: Boolean(engineStatus?.hasEncryptionKey),
    encryptionKeyId: engineStatus?.encryptionKeyId ?? "",
    databaseBusinessRecordCount,
    error: statusRes.ok ? null : statusRes.message ?? null,
  };
}

export function useBackupDashboard() {
  const [state, setState] = useState<DashboardState>(() => {
    const initialSettings = getBackupSettingsSnapshot();
    return {
      loading: true,
      available: isBackupEngineAvailable(),
      storage: null,
      database: null,
      backups: [],
      settings: initialSettings,
      protection: { status: "browser", reason: null, newest: null, ageHours: null, staleAt: null },
      encryptionAvailable: false,
      engineVersion: "",
      lastBackupAt: initialSettings.lastBackupAt,
      hasEncryptionKey: false,
      encryptionKeyId: "",
      databaseBusinessRecordCount: 0,
      error: null,
    };
  });
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true }));
    try {
      const loaded = await loadBackupStatus();
      if (!mounted.current) return;
      setState({
        loading: false,
        available: isBackupEngineAvailable(),
        storage: loaded.storage,
        database: loaded.database,
        backups: loaded.backups,
        settings: getBackupSettingsSnapshot(),
        protection: loaded.protection,
        encryptionAvailable: loaded.encryptionAvailable,
        engineVersion: loaded.engineVersion,
        lastBackupAt: loaded.lastBackupAt,
        hasEncryptionKey: loaded.hasEncryptionKey,
        encryptionKeyId: loaded.encryptionKeyId,
        databaseBusinessRecordCount: loaded.databaseBusinessRecordCount,
        error: loaded.error,
      });
    } catch (err: any) {
      if (!mounted.current) return;
      setState((prev) => ({ ...prev, loading: false, error: err?.message === "NATIVE_UNAVAILABLE" ? "وحدة النسخ الاحتياطي غير مثبّتة في هذا البناء." : String(err?.message ?? err) }));
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const unsub = subscribeBackupSettings(() => {
      if (!mounted.current) return;
      const nextSettings = getBackupSettingsSnapshot();
      setState((prev) => ({
        ...prev,
        settings: nextSettings,
        lastBackupAt: pickNewerIso(prev.lastBackupAt, nextSettings.lastBackupAt),
      }));
    });
    return () => {
      mounted.current = false;
      unsub();
    };
  }, [refresh]);

  return { ...state, refresh };
}

// ═══════════════════════════════════════════════════════════════════════════
// First-launch recovery discovery
// ═══════════════════════════════════════════════════════════════════════════

export interface DiscoveryState {
  loading: boolean;
  decision: DiscoveryDecision | null;
  loaded: LoadedStatus | null;
  /** A folder was remembered from a previous install but its grant is gone. */
  needsFolderReconnect: boolean;
  preferredFolderLabel: string;
}

/**
 * Looks for backups left by a previous install.
 * Never restores anything by itself — it only produces the prompt data.
 */
export async function discoverForRecovery(): Promise<DiscoveryState> {
  const settings = await loadBackupSettings();
  if (!isBackupEngineAvailable()) {
    return { loading: false, decision: null, loaded: null, needsFolderReconnect: false, preferredFolderLabel: "" };
  }
  let preferredFolderLabel = "";
  try {
    const folder = await backupBridge.getFolder();
    if (folder?.ok) {
      preferredFolderLabel = folder.folderLabel || "";
      const preferred = folder.preferredFolderUri;
      if (!folder.folderUri && preferred) {
        // Try to re-bind the previous folder without asking the user yet; if the
        // grant is gone this is a no-op and we show the reconnect card.
        await backupBridge.restoreFolderPermission(preferred);
      }
    }
  } catch {
    // ignore: discovery must never crash the launch
  }

  const loaded = await loadBackupStatus();
  const decision = decideDiscovery(
    {
      storage: loaded.storage,
      backups: loaded.backups,
      currentInvoiceCount: loaded.database.invoiceCount,
      currentBusinessRecordCount: loaded.databaseBusinessRecordCount,
      settings,
    },
    Date.now()
  );

  const needsFolderReconnect =
    !loaded.storage.folderUri &&
    (loaded.storage.state === "folder-not-selected" || loaded.storage.state === "permission-lost") &&
    Boolean(preferredFolderLabel || settings.folderLabel);

  return { loading: false, decision, loaded, needsFolderReconnect, preferredFolderLabel: preferredFolderLabel || settings.folderLabel };
}

/** Builds the restore confirmation card data for one backup. */
export async function buildBackupPreview(info: BackupFileInfo): Promise<BackupPreview> {
  const currentCounts = await backupBridge.getDbCounts().catch(() => null);
  const manifest = info.manifest!;
  return {
    info,
    currentInvoiceCount: currentCounts?.invoiceCount ?? 0,
    currentSchemaVersion: currentCounts?.schemaVersion ?? 0,
    compatible: info.status === "verified",
    encrypted: Boolean(manifest.encrypted),
    message: info.issue,
  };
}

export { countBusinessRecords, countInvoices, newestVerified, newestWithData };
