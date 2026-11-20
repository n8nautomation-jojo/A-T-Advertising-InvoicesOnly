import React, { useMemo, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { isBackupEngineAvailable } from "@/lib/backup/bridge";
import { useBackupDashboard } from "@/lib/backup/useBackupStatus";
import { newestWithData } from "@/lib/backup/validation";
import {
  type BackupFileInfo,
  type RestoreResult,
} from "./backup/types";

import { BackupStatusHero } from "./backup/BackupStatusHero";
import { BackupActionsCard } from "./backup/BackupActionsCard";
import { RestoreHubDialog } from "./backup/RestoreHubDialog";
import { BackupSettingsDialog } from "./backup/BackupSettingsDialog";
import { BackupHistoryDialog } from "./backup/BackupHistoryDialog";
import { useBackupManagerActions } from "./backup/useBackupManagerActions";

export {
  formatBytes,
  formatDateTime,
  formatRelative,
  STATUS_LABEL,
  PROTECTION_META,
} from "./backup/types";

export function BackupManagerCard() {
  const dashboard = useBackupDashboard();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isRestoreHubOpen, setIsRestoreHubOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [restoreSuccessResult, setRestoreSuccessResult] =
    useState<RestoreResult | null>(null);
  const [preSelectedBackup, setPreSelectedBackup] =
    useState<BackupFileInfo | null>(null);

  const settings = dashboard.settings;
  const newest = useMemo(
    () =>
      dashboard.backups
        .filter((b) => b.status === "verified" && b.manifest)
        .sort(
          (a, b) =>
            Date.parse(b.manifest!.createdAt) -
            Date.parse(a.manifest!.createdAt)
        )[0] ?? null,
    [dashboard.backups]
  );

  const newestDataBackup = useMemo(
    () => newestWithData(dashboard.backups),
    [dashboard.backups]
  );

  const {
    busy,
    handleChooseFolder,
    handleBackupNow,
    handleVerify,
    handleExport,
    handleImportFile,
    handleRestore,
    handleSaveSettings,
    handleExportRecoveryKey,
    handleImportRecoveryKey,
  } = useBackupManagerActions({
    folderUri: dashboard.storage?.folderUri || settings.folderUri,
    refresh: dashboard.refresh,
    fileInputRef,
    setIsRestoreHubOpen,
    setRestoreSuccessResult,
  });

  const engineMissing =
    Capacitor.isNativePlatform() && !isBackupEngineAvailable();

  return (
    <section className="rounded-2xl sm:rounded-3xl border border-primary/20 bg-card p-4 sm:p-5 shadow-sm space-y-4">
      <BackupStatusHero
        dashboard={dashboard}
        newestBackup={newestDataBackup || newest}
        busy={busy}
        onChooseFolder={handleChooseFolder}
        engineMissing={engineMissing}
      />

      <BackupActionsCard
        busy={busy}
        hasFolder={Boolean(dashboard.storage?.folderUri || settings.folderUri)}
        backupCount={dashboard.backups.length}
        onBackupNow={handleBackupNow}
        onOpenRestoreHub={() => {
          setRestoreSuccessResult(null);
          setIsRestoreHubOpen(true);
        }}
        onOpenHistory={() => setIsHistoryOpen(true)}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onImportClick={() => fileInputRef.current?.click()}
        onVerifyLatest={() => newest && handleVerify(newest.fileName)}
        hasLatestBackup={Boolean(newest)}
      />

      <input
        ref={fileInputRef}
        type="file"
        accept=".tabk,.json,application/octet-stream,application/json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleImportFile(f);
        }}
      />

      <RestoreHubDialog
        open={isRestoreHubOpen}
        onOpenChange={(open) => {
          setIsRestoreHubOpen(open);
          if (!open) {
            setRestoreSuccessResult(null);
            setPreSelectedBackup(null);
          }
        }}
        initialSelected={preSelectedBackup}
        backups={dashboard.backups}
        currentInvoiceCount={dashboard.database?.invoiceCount ?? 0}
        currentBusinessRecordCount={dashboard.databaseBusinessRecordCount}
        currentSchemaVersion={dashboard.database?.schemaVersion ?? 1}
        busy={busy}
        onRestore={handleRestore}
        onImportExternal={() => fileInputRef.current?.click()}
        onImportRecoveryKey={handleImportRecoveryKey}
        successResult={restoreSuccessResult}
        onCloseSuccess={() => {
          setIsRestoreHubOpen(false);
          setRestoreSuccessResult(null);
        }}
      />

      <BackupSettingsDialog
        open={isSettingsOpen}
        onOpenChange={setIsSettingsOpen}
        settings={settings}
        encryptionAvailable={dashboard.encryptionAvailable}
        hasEncryptionKey={dashboard.hasEncryptionKey}
        encryptionKeyId={dashboard.encryptionKeyId}
        onSave={handleSaveSettings}
        onExportRecoveryKey={handleExportRecoveryKey}
        onImportRecoveryKey={handleImportRecoveryKey}
      />

      <BackupHistoryDialog
        open={isHistoryOpen}
        onOpenChange={setIsHistoryOpen}
        backups={dashboard.backups}
        busy={busy}
        onVerify={handleVerify}
        onRestoreSelect={(b) => {
          setPreSelectedBackup(b);
          setIsHistoryOpen(false);
          setRestoreSuccessResult(null);
          setIsRestoreHubOpen(true);
        }}
        onExport={handleExport}
      />
    </section>
  );
}
