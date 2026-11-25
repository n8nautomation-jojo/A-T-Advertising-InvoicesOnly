import React from "react";
import {
  HardDriveDownload,
  RotateCcw,
  History,
  Settings2,
  UploadCloud,
  FileCheck,
  Loader2,
  KeyRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface BackupActionsCardProps {
  busy: string | null;
  hasFolder: boolean;
  backupCount: number;
  onBackupNow: () => void;
  onOpenRestoreHub: () => void;
  onOpenHistory: () => void;
  onOpenSettings: () => void;
  onOpenRecoveryKey: () => void;
  onImportClick: () => void;
  onVerifyLatest: () => void;
  hasLatestBackup: boolean;
  encryptionEnabled?: boolean;
  needsKeyBackupBadge?: boolean;
}

export function BackupActionsCard({
  busy,
  hasFolder,
  backupCount,
  onBackupNow,
  onOpenRestoreHub,
  onOpenHistory,
  onOpenSettings,
  onOpenRecoveryKey,
  onImportClick,
  onVerifyLatest,
  hasLatestBackup,
  encryptionEnabled = false,
  needsKeyBackupBadge = false,
}: BackupActionsCardProps) {
  return (
    <div className="space-y-3 pt-2">
      <div className="grid grid-cols-2 gap-2.5">
        {/* Backup Now */}
        <Button
          type="button"
          onClick={onBackupNow}
          disabled={busy !== null || !hasFolder}
          className="h-12 rounded-2xl gap-2 font-black text-xs bg-primary hover:bg-primary/95 text-primary-foreground shadow-sm active:scale-[0.98] touch-manipulation"
        >
          {busy === "backup" ? (
            <Loader2 className="h-4 w-4 animate-spin ml-1" />
          ) : (
            <HardDriveDownload className="h-4 w-4 ml-1" />
          )}
          <span>إنشاء نسخة الآن</span>
        </Button>

        {/* Restore Hub */}
        <Button
          type="button"
          onClick={onOpenRestoreHub}
          disabled={busy !== null}
          className="h-12 rounded-2xl gap-2 font-black text-xs bg-amber-600 hover:bg-amber-700 text-white shadow-sm active:scale-[0.98] touch-manipulation"
        >
          <RotateCcw className="h-4 w-4 ml-1" />
          <span>استعادة نسخة</span>
          {backupCount > 0 && (
            <span className="rounded-full bg-white/20 px-1.5 py-0.2 text-[10px] font-mono">
              {backupCount}
            </span>
          )}
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={onOpenHistory}
          disabled={busy !== null}
          className="h-11 rounded-xl gap-1.5 font-bold text-xs border-border/80 hover:bg-muted/50 active:scale-95 touch-manipulation px-2.5"
        >
          <History className="h-4 w-4 shrink-0 text-primary" />
          <span className="truncate">سجل النسخ ({backupCount})</span>
        </Button>

        <Button
          type="button"
          variant="outline"
          onClick={onImportClick}
          disabled={busy !== null}
          className="h-11 rounded-xl gap-1.5 font-bold text-xs border-border/80 hover:bg-muted/50 active:scale-95 touch-manipulation px-2.5"
        >
          <UploadCloud className="h-4 w-4 shrink-0 text-primary" />
          <span className="truncate">استيراد ملف خارجي</span>
        </Button>

        <Button
          type="button"
          variant="outline"
          onClick={onOpenRecoveryKey}
          disabled={busy !== null}
          className={cn(
            "relative h-11 rounded-xl gap-1.5 font-bold text-xs active:scale-95 touch-manipulation px-2.5",
            needsKeyBackupBadge
              ? "border-amber-500/50 bg-amber-500/10 text-amber-900 dark:text-amber-200 hover:bg-amber-500/15"
              : encryptionEnabled
              ? "border-emerald-500/40 bg-emerald-500/5 hover:bg-emerald-500/10"
              : "border-border/80 hover:bg-muted/50"
          )}
        >
          <KeyRound
            className={cn(
              "h-4 w-4 shrink-0",
              needsKeyBackupBadge
                ? "text-amber-600 dark:text-amber-400"
                : "text-primary"
            )}
          />
          <span className="truncate">مفتاح التشفير ونقل الهاتف</span>
          {needsKeyBackupBadge && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-500 text-white px-1.5 py-0.5 text-[9px] font-black shrink-0">
              <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" />
              <span>احفظ المفتاح</span>
            </span>
          )}
        </Button>

        <Button
          type="button"
          variant="outline"
          onClick={onOpenSettings}
          disabled={busy !== null}
          className="h-11 rounded-xl gap-1.5 font-bold text-xs border-border/80 hover:bg-muted/50 active:scale-95 touch-manipulation px-2.5"
        >
          <Settings2 className="h-4 w-4 shrink-0 text-primary" />
          <span className="truncate">الجدولة والتشفير</span>
        </Button>
      </div>

      {hasLatestBackup && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onVerifyLatest}
          disabled={busy !== null}
          className="w-full h-8 text-[11px] font-bold text-muted-foreground hover:text-foreground gap-1.5 justify-center"
        >
          {busy?.startsWith("verify:") ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <FileCheck className="h-3.5 w-3.5 text-primary" />
          )}
          <span>فحص سلامة وتكامل أحدث نسخة محفوظة</span>
        </Button>
      )}
    </div>
  );
}
