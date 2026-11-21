/**
 * ═══════════════════════════════════════════════════════════════
 * Typed bridge to the native TaBackup plugin
 * ═══════════════════════════════════════════════════════════════
 * All methods resolve (never reject) with a result object that carries
 * `ok` plus `errorCode`/`message`, so callers can render a precise Arabic
 * message instead of a generic failure.
 */

import { registerPlugin } from "@capacitor/core";
import { Capacitor } from "@capacitor/core";
import type {
  BackupFileInfo,
  BackupKind,
  BackupManifest,
  BackupPreview,
  BackupRunResult,
  DatabaseStatus,
  DiscoveryResult,
  EngineStatus,
  RestoreMode,
  RestoreResult,
  StorageInfo,
} from "./types";

interface NativePluginApi {
  chooseFolder(): Promise<{ ok: boolean; folderUri?: string; folderLabel?: string; errorCode?: string; message?: string }>;
  restoreFolderPermission(options: { treeUri: string }): Promise<{ ok: boolean; folderUri?: string; folderLabel?: string }>;
  getFolder(): Promise<{ ok: boolean; folderUri: string; folderLabel: string; preferredFolderUri: string }>;
  forgetFolder(): Promise<{ ok: boolean }>;
  getStatus(): Promise<NativeStatus>;
  listBackups(): Promise<{ ok: boolean; backups: any[]; errorCode?: string; message?: string }>;
  createBackup(options: { kind: BackupKind; skipIfUnchanged?: boolean; encrypt?: boolean }): Promise<BackupRunResult>;
  verifyBackup(options: { fileName: string }): Promise<{ ok: boolean; info?: any; errorCode?: string; message?: string }>;
  restoreBackup(options: { fileName: string; mode: RestoreMode }): Promise<RestoreResult>;
  discoverBackups(): Promise<{ ok: boolean; status?: NativeStatus; currentInvoiceCount?: number; pendingSchemaUpgrade?: boolean }>;
  exportArchive(options: { fileName: string }): Promise<{ ok: boolean; base64?: string; errorCode?: string; message?: string }>;
  importArchive(options: { base64: string; fileName: string }): Promise<{ ok: boolean; fileName?: string; manifest?: BackupManifest; needsRecoveryKey?: boolean; keyId?: string; errorCode?: string; message?: string }>;
  getDbCounts(): Promise<{ ok: boolean; counts: Record<string, number>; invoiceCount: number; totalBusinessRecords?: number; schemaVersion: number }>;
  saveSettings(options: Record<string, unknown>): Promise<{ ok: boolean }>;
  getEngineInfo(): Promise<{ ok: boolean; engineVersion: string; sdkInt: number; model: string; supported: boolean }>;
  setScheduledBackupEnabled(options: { enabled: boolean }): Promise<{ ok: boolean }>;
  getBackupRecords(): Promise<{ ok: boolean; backups: any[]; errorCode?: string; message?: string }>;
  exportRecoveryKey(): Promise<{ ok: boolean; recoveryKey?: string; keyId?: string; errorCode?: string; message?: string }>;
  importRecoveryKey(options: { recoveryKey: string }): Promise<{ ok: boolean; keyId?: string; errorCode?: string; message?: string }>;
  getEncryptionInfo(): Promise<{ ok: boolean; hasKey: boolean; keyId: string; keystoreAvailable: boolean; keyCount: number }>;
  preparePreUpdateBackup(options: { appVersion: string; targetSchema: number }): Promise<{ ok: boolean; skipped?: boolean; skipReason?: string; backupId?: string; fileName?: string; message?: string }>;
  ensureDatabaseHealthy(options?: { forceRepair?: boolean }): Promise<{
    ok: boolean;
    status: "missing" | "healthy" | "repaired" | "quarantined_reset" | "error";
    salvagedRecords?: number;
    salvagedInvoices?: number;
    salvagedCustomers?: number;
    errorCode?: string;
    message?: string;
  }>;
}

interface NativeStatus {
  ok: boolean;
  storage?: StorageInfo;
  database?: DatabaseStatus & { counts: Record<string, number> };
  backups?: any[];
  newestVerified?: any;
  protection?: string;
  encryptionAvailable?: boolean;
  engineVersion?: string;
  lastBackupAt?: string | null;
  lastBackupStatus?: string | null;
  lastBackupMessage?: string | null;
  hasEncryptionKey?: boolean;
  encryptionKeyId?: string | null;
}

const nativePlugin = registerPlugin<NativePluginApi>("TaBackup");

export const BACKUP_PLUGIN_NAME = "TaBackup";

export function isBackupEngineAvailable(): boolean {
  if (!Capacitor.isNativePlatform()) return false;
  const core = Capacitor as unknown as { Plugins?: Record<string, unknown> };
  return Boolean(core.Plugins?.[BACKUP_PLUGIN_NAME]);
}

/** Defensively normalizes legacy Java StorageState enum values into canonical TS states (DB-07). */
export function normalizeStorageState(state: unknown): StorageInfo["state"] {
  const raw = String(state ?? "").trim();
  switch (raw) {
    case "ok":
    case "OK":
      return "ok";
    case "folder-not-selected":
    case "NO_FOLDER":
      return "folder-not-selected";
    case "permission-lost":
    case "PERMISSION_LOST":
      return "permission-lost";
    case "unsupported":
    case "UNSUPPORTED":
      return "unsupported";
    case "browser":
    case "BROWSER":
      return "browser";
    case "unavailable":
    case "UNAVAILABLE":
    default:
      return "unavailable";
  }
}

function normalizeStorageInfo(storage: StorageInfo): StorageInfo {
  return {
    ...storage,
    state: normalizeStorageState(storage?.state),
  };
}

/** Normalises a native file record into the domain type. */
export function toBackupFileInfo(raw: any): BackupFileInfo {
  const manifest = raw?.manifest && raw.manifest !== null && typeof raw.manifest === "object" ? raw.manifest : null;
  return {
    manifest,
    fileName: String(raw?.fileName ?? ""),
    uri: String(raw?.uri ?? ""),
    sizeBytes: Number(raw?.sizeBytes ?? 0),
    modifiedAt: Number(raw?.modifiedAt ?? 0),
    sha256Ok: Boolean(raw?.sha256Ok),
    quickCheckOk: Boolean(raw?.quickCheckOk),
    status: (raw?.status ?? "unreadable") as BackupFileInfo["status"],
    issue: raw?.issue ? String(raw.issue) : undefined,
  };
}

const NATIVE_COMMANDS = [
  "chooseFolder",
  "restoreFolderPermission",
  "getFolder",
  "forgetFolder",
  "getStatus",
  "listBackups",
  "createBackup",
  "verifyBackup",
  "restoreBackup",
  "discoverBackups",
  "exportArchive",
  "importArchive",
  "getDbCounts",
  "saveSettings",
  "getEngineInfo",
  "setScheduledBackupEnabled",
  "getBackupRecords",
  "exportRecoveryKey",
  "importRecoveryKey",
  "getEncryptionInfo",
  "preparePreUpdateBackup",
  "ensureDatabaseHealthy",
] as const;

/**
 * Guards against the "plugin not implemented on Android" case (e.g. an APK
 * built from the web assets without the native module) so the UI can show an
 * honest message instead of a white screen.
 */
async function callNative<T>(method: (typeof NATIVE_COMMANDS)[number], args?: any): Promise<T> {
  if (!isBackupEngineAvailable()) {
    throw new Error("NATIVE_UNAVAILABLE");
  }
  const fn = (nativePlugin as unknown as Record<string, (a?: any) => Promise<T>>)[method];
  if (typeof fn !== "function") throw new Error("NATIVE_UNAVAILABLE");
  return fn.call(nativePlugin, args);
}

export const backupBridge = {
  async chooseFolder() {
    return callNative<{ ok: boolean; folderUri?: string; folderLabel?: string; errorCode?: string; message?: string }>("chooseFolder");
  },

  async restoreFolderPermission(treeUri: string) {
    return callNative<{ ok: boolean; folderUri?: string; folderLabel?: string }>("restoreFolderPermission", { treeUri });
  },

  async getFolder() {
    return callNative<{ ok: boolean; folderUri: string; folderLabel: string; preferredFolderUri: string }>("getFolder");
  },

  async forgetFolder() {
    return callNative<{ ok: boolean }>("forgetFolder");
  },

  async getStatus(): Promise<{ ok: boolean; status: EngineStatus | null; errorCode?: string; message?: string }> {
    const raw = await callNative<NativeStatus>("getStatus");
    if (!raw?.ok || !raw.storage || !raw.database) {
      return { ok: false, status: null, errorCode: "IO_FAILED", message: "تعذّر قراءة حالة النسخ الاحتياطي." };
    }
    const backups = Array.isArray(raw.backups) ? raw.backups.map(toBackupFileInfo) : [];
    const newestRaw = raw.newestVerified && raw.newestVerified !== null ? toBackupFileInfo(raw.newestVerified) : null;
    const lastNativeStatus =
      raw.lastBackupStatus === "ok" || raw.lastBackupStatus === "failed" ? raw.lastBackupStatus : "never";
    return {
      ok: true,
      status: {
        storage: normalizeStorageInfo(raw.storage),
        database: raw.database,
        settings: null as unknown as EngineStatus["settings"],
        backups,
        newestVerified: newestRaw,
        oldestVerifiedAt: null,
        protection: (raw.protection ?? "unprotected") as EngineStatus["protection"],
        protectionReason: null,
        encryptionAvailable: Boolean(raw.encryptionAvailable),
        engineVersion: String(raw.engineVersion ?? ""),
        lastNativeBackupAt: typeof raw.lastBackupAt === "string" && raw.lastBackupAt ? raw.lastBackupAt : null,
        lastNativeBackupStatus: lastNativeStatus,
        lastNativeBackupMessage: typeof raw.lastBackupMessage === "string" && raw.lastBackupMessage ? raw.lastBackupMessage : null,
        hasEncryptionKey: Boolean(raw.hasEncryptionKey),
        encryptionKeyId: typeof raw.encryptionKeyId === "string" ? raw.encryptionKeyId : "",
      },
    };
  },

  async listBackups(): Promise<{ ok: boolean; backups: BackupFileInfo[]; errorCode?: string; message?: string }> {
    const raw = await callNative<{ ok: boolean; backups: any[]; errorCode?: string; message?: string }>("listBackups");
    return {
      ok: Boolean(raw?.ok),
      backups: Array.isArray(raw?.backups) ? raw.backups.map(toBackupFileInfo) : [],
      errorCode: raw?.errorCode,
      message: raw?.message,
    };
  },

  async createBackup(kind: BackupKind, options: { skipIfUnchanged?: boolean; encrypt?: boolean } = {}): Promise<BackupRunResult> {
    const payload = {
      kind,
      skipIfUnchanged: options.skipIfUnchanged ?? false,
      encrypt: options.encrypt ?? true,
    };
    const raw = await callNative<BackupRunResult>("createBackup", {
      ...payload,
      options: payload,
    });
    return { ...raw, ok: Boolean(raw?.ok) };
  },

  async verifyBackup(fileName: string): Promise<{ ok: boolean; info: BackupFileInfo | null; errorCode?: string; message?: string }> {
    const raw = await callNative<{ ok: boolean; info?: any; errorCode?: string; message?: string }>("verifyBackup", {
      fileName,
      options: { fileName },
    });
    return {
      ok: Boolean(raw?.ok),
      info: raw?.info ? toBackupFileInfo(raw.info) : null,
      errorCode: raw?.errorCode,
      message: raw?.message,
    };
  },

  async restoreBackup(fileName: string, mode: RestoreMode): Promise<RestoreResult> {
    const cleanFileName = String(fileName || "").trim();
    const raw = await callNative<RestoreResult>("restoreBackup", {
      fileName: cleanFileName,
      name: cleanFileName,
      file: cleanFileName,
      mode,
      options: {
        fileName: cleanFileName,
        name: cleanFileName,
        file: cleanFileName,
        mode,
      },
    });
    return { ...raw, ok: Boolean(raw?.ok), mode };
  },

  async discover(): Promise<{ ok: boolean; currentInvoiceCount: number; pendingSchemaUpgrade: boolean; status?: NativeStatus }> {
    const raw = await callNative<{ ok: boolean; currentInvoiceCount?: number; pendingSchemaUpgrade?: boolean; status?: NativeStatus }>("discoverBackups");
    const normalizedStatus = raw?.status
      ? {
          ...raw.status,
          storage: raw.status.storage ? normalizeStorageInfo(raw.status.storage) : undefined,
        }
      : undefined;
    return {
      ok: Boolean(raw?.ok),
      currentInvoiceCount: Number(raw?.currentInvoiceCount ?? 0),
      pendingSchemaUpgrade: Boolean(raw?.pendingSchemaUpgrade),
      status: normalizedStatus,
    };
  },

  async exportArchive(fileName: string): Promise<{ ok: boolean; base64?: string; errorCode?: string; message?: string }> {
    return callNative("exportArchive", { fileName });
  },

  async importArchive(
    base64: string,
    fileName: string
  ): Promise<{ ok: boolean; fileName?: string; manifest?: BackupManifest; needsRecoveryKey?: boolean; keyId?: string; errorCode?: string; message?: string }> {
    return callNative("importArchive", { base64, fileName });
  },

  async getDbCounts(): Promise<{ ok: boolean; counts: Record<string, number>; invoiceCount: number; totalBusinessRecords?: number; schemaVersion: number }> {
    return callNative("getDbCounts");
  },

  async saveSettings(settings: Record<string, unknown>): Promise<{ ok: boolean }> {
    return callNative("saveSettings", {
      ...settings,
      options: settings,
    });
  },

  async getEngineInfo(): Promise<{ ok: boolean; engineVersion: string; sdkInt: number; model: string; supported: boolean }> {
    return callNative("getEngineInfo");
  },

  async setScheduledBackupEnabled(enabled: boolean): Promise<{ ok: boolean }> {
    return callNative("setScheduledBackupEnabled", { enabled });
  },

  async exportRecoveryKey(): Promise<{ ok: boolean; recoveryKey?: string; keyId?: string; errorCode?: string; message?: string }> {
    return callNative("exportRecoveryKey");
  },

  async importRecoveryKey(recoveryKey: string): Promise<{ ok: boolean; keyId?: string; errorCode?: string; message?: string }> {
    return callNative("importRecoveryKey", { recoveryKey });
  },

  async getEncryptionInfo(): Promise<{ ok: boolean; hasKey: boolean; keyId: string; keystoreAvailable: boolean; keyCount: number }> {
    return callNative("getEncryptionInfo");
  },

  async preparePreUpdateBackup(
    appVersion: string,
    targetSchema: number
  ): Promise<{ ok: boolean; skipped?: boolean; skipReason?: string; backupId?: string; fileName?: string; message?: string }> {
    return callNative("preparePreUpdateBackup", { appVersion, targetSchema });
  },

  async ensureDatabaseHealthy(options?: { forceRepair?: boolean }): Promise<{
    ok: boolean;
    status: "missing" | "healthy" | "repaired" | "quarantined_reset" | "error";
    salvagedRecords?: number;
    salvagedInvoices?: number;
    salvagedCustomers?: number;
    errorCode?: string;
    message?: string;
  }> {
    return callNative("ensureDatabaseHealthy", { forceRepair: Boolean(options?.forceRepair) });
  },
};

export type { BackupPreview };
