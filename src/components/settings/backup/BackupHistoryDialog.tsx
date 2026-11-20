import React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  History,
  FileCheck,
  RotateCcw,
  DownloadCloud,
  Lock,
  Loader2,
  KeyRound,
} from "lucide-react";
import { countBusinessRecords } from "@/lib/backup/validation";
import {
  BACKUP_KIND_LABELS,
  type BackupFileInfo,
  formatBytes,
  formatDateTime,
  STATUS_LABEL,
} from "./types";
import { BackupModulePills } from "./RestoreHubParts";
import { playTapSound } from "@/lib/soundEffects";

interface BackupHistoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  backups: BackupFileInfo[];
  busy: string | null;
  onVerify: (fileName: string) => void;
  onRestoreSelect: (backup: BackupFileInfo) => void;
  onExport: (fileName: string) => void;
}

export function BackupHistoryDialog({
  open,
  onOpenChange,
  backups,
  busy,
  onVerify,
  onRestoreSelect,
  onExport,
}: BackupHistoryDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        dir="rtl"
        className="max-w-lg p-5 rounded-3xl border border-primary/20 bg-card shadow-2xl max-h-[88vh] flex flex-col"
      >
        <DialogHeader className="text-right space-y-1 pb-2 border-b border-border/50 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="grid h-10 w-10 place-items-center rounded-2xl bg-primary/10 text-primary border border-primary/20 shrink-0">
              <History className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle className="text-base font-black text-foreground">
                أرشيف وسجل النسخ الاحتياطية
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                استعراض، فحص وتصدير كافة النسخ المحفوظة على وحدة التخزين ({backups.length} نسخة)
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="py-2 space-y-2 flex-1 overflow-y-auto overscroll-contain pr-1">
          {backups.length === 0 ? (
            <div className="py-12 text-center space-y-2">
              <History className="h-8 w-8 text-muted-foreground/40 mx-auto" />
              <p className="text-xs font-bold text-muted-foreground">
                لا توجد أي نسخ احتياطية محفوظة حتى الآن.
              </p>
            </div>
          ) : (
            backups.map((b) => {
              const status = STATUS_LABEL[b.status] ?? {
                label: "غير معروفة",
                tone: "text-muted-foreground",
              };
              const kind = b.manifest
                ? BACKUP_KIND_LABELS[b.manifest.kind] ?? b.manifest.kind
                : "نسخة محفوظة";
              const isVerifying = busy === "verify:" + b.fileName;
              const isExporting = busy === "export:" + b.fileName;
              const isEncryptedLocked = b.status === "encrypted";
              const totalRecords = b.manifest
                ? b.manifest.totalBusinessRecords ??
                  countBusinessRecords(b.manifest.counts)
                : 0;

              return (
                <div
                  key={b.fileName}
                  className="rounded-2xl border border-border/70 bg-muted/20 p-3 space-y-2 hover:border-primary/30 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-black text-foreground">
                          {formatDateTime(b.manifest?.createdAt)}
                        </span>
                        <span className="rounded-md bg-primary/10 text-primary font-bold text-[10px] px-1.5 py-0.2">
                          {kind}
                        </span>
                      </div>
                      <p
                        className="text-[10px] text-muted-foreground truncate font-mono mt-0.5"
                        dir="ltr"
                      >
                        {b.fileName}
                      </p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
                        <span className={`font-black ${status.tone}`}>
                          {status.label}
                        </span>
                        <span>• {formatBytes(b.sizeBytes)}</span>
                        {b.manifest && (
                          <>
                            <span>• {totalRecords} سجل</span>
                            <span>
                              • مخطط v{b.manifest.databaseSchemaVersion ?? "1"}
                            </span>
                          </>
                        )}
                        {(b.manifest?.encrypted || isEncryptedLocked) && (
                          <span className="flex items-center gap-0.5 text-primary font-bold">
                            <Lock className="h-2.5 w-2.5" />
                            مشفّرة
                          </span>
                        )}
                      </div>

                      {b.manifest?.counts && (
                        <BackupModulePills
                          counts={b.manifest.counts}
                          invoiceCount={b.manifest.invoiceCount}
                          className="mt-2"
                        />
                      )}

                      {b.issue && (
                        <p className="mt-1.5 text-[10px] leading-relaxed text-amber-700 dark:text-amber-300 bg-amber-500/10 p-1.5 rounded-lg border border-amber-500/20">
                          {b.issue}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-1 shrink-0 pt-0.5">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => onVerify(b.fileName)}
                        disabled={busy !== null}
                        className="h-8 w-8 p-0 rounded-xl"
                        title="فحص السلامة"
                      >
                        {isVerifying ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <FileCheck className="h-3.5 w-3.5 text-primary" />
                        )}
                      </Button>

                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          playTapSound();
                          onRestoreSelect(b);
                        }}
                        disabled={
                          busy !== null ||
                          (b.status !== "verified" && !isEncryptedLocked)
                        }
                        className="h-8 px-2 rounded-xl text-[11px] font-bold gap-1 border-amber-500/40 text-amber-600 hover:bg-amber-500/10"
                        title={
                          isEncryptedLocked
                            ? "فك تشفير النسخة برمز الاسترداد"
                            : "استعادة هذه النسخة"
                        }
                      >
                        {isEncryptedLocked ? (
                          <>
                            <KeyRound className="h-3 w-3" />
                            <span>فك التشفير</span>
                          </>
                        ) : (
                          <>
                            <RotateCcw className="h-3 w-3" />
                            <span>استعادة</span>
                          </>
                        )}
                      </Button>

                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => onExport(b.fileName)}
                        disabled={busy !== null}
                        className="h-8 w-8 p-0 rounded-xl"
                        title="تصدير ومشاركة"
                      >
                        {isExporting ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <DownloadCloud className="h-3.5 w-3.5 text-primary" />
                        )}
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <DialogFooter className="pt-2 border-t border-border/50 shrink-0">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="w-full h-11 rounded-2xl text-xs font-bold"
          >
            إغلاق الأرشيف
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
