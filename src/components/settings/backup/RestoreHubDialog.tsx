import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  RotateCcw,
  CheckCircle2,
  FileCheck,
  AlertTriangle,
  UploadCloud,
  Loader2,
  KeyRound,
  Lock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { playTapSound } from "@/lib/soundEffects";
import { countBusinessRecords, countInvoices } from "@/lib/backup/validation";
import {
  type BackupFileInfo,
  type RestoreMode,
  type RestoreResult,
  formatBytes,
  formatDateTime,
  formatRelative,
  STATUS_LABEL,
} from "./types";
import {
  BackupModulePills,
  RestoreArchiveSelector,
  RestoreSuccessView,
} from "./RestoreHubParts";
import type { RecoveryKeyImportResponse } from "./useBackupManagerActions";

interface RestoreHubDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  backups: BackupFileInfo[];
  currentInvoiceCount: number;
  currentBusinessRecordCount?: number;
  currentSchemaVersion: number;
  busy: string | null;
  onRestore: (fileName: string, mode: RestoreMode) => Promise<void>;
  onImportExternal: () => void;
  onImportRecoveryKey?: (code: string) => Promise<RecoveryKeyImportResponse>;
  successResult: RestoreResult | null;
  onCloseSuccess: () => void;
  initialSelected?: BackupFileInfo | null;
}

export function RestoreHubDialog({
  open,
  onOpenChange,
  backups,
  currentInvoiceCount,
  currentBusinessRecordCount,
  busy,
  onRestore,
  onImportExternal,
  onImportRecoveryKey,
  successResult,
  onCloseSuccess,
  initialSelected,
}: RestoreHubDialogProps) {
  const [selectedFile, setSelectedFile] = useState<BackupFileInfo | null>(null);
  const [restoreMode, setRestoreMode] = useState<RestoreMode>("replace");
  const [showOtherBackups, setShowOtherBackups] = useState(false);
  const [recoveryKeyInput, setRecoveryKeyInput] = useState("");
  const [unlocking, setUnlocking] = useState(false);

  // Auto-select the best backup on open and refresh the selected entry when backups reload
  useEffect(() => {
    if (!open) {
      setSelectedFile(null);
      setShowOtherBackups(false);
      setRecoveryKeyInput("");
      return;
    }
    if (initialSelected) {
      const freshInitial =
        backups.find((b) => b.fileName === initialSelected.fileName) ??
        initialSelected;
      setSelectedFile(freshInitial);
      return;
    }
    setSelectedFile((prev) => {
      if (prev) {
        const refreshed = backups.find((b) => b.fileName === prev.fileName);
        if (refreshed) return refreshed;
      }
      if (backups.length === 0) return null;
      return (
        backups.find((b) => {
          const recCount =
            b.manifest?.totalBusinessRecords ??
            countBusinessRecords(b.manifest?.counts);
          return b.status === "verified" && recCount > 0;
        }) ||
        backups.find((b) => b.status === "verified") ||
        backups.find((b) => b.status === "encrypted") ||
        backups[0] ||
        null
      );
    });
  }, [open, backups, initialSelected]);

  const handleSelectFile = (file: BackupFileInfo) => {
    playTapSound();
    setSelectedFile(file);
    setShowOtherBackups(false);
  };

  const handleConfirmRestore = async () => {
    if (!selectedFile || selectedFile.status !== "verified") return;
    playTapSound();
    await onRestore(selectedFile.fileName, restoreMode);
  };

  const handleUnlockEncrypted = async () => {
    if (!onImportRecoveryKey || !recoveryKeyInput.trim()) return;
    setUnlocking(true);
    try {
      const res = await onImportRecoveryKey(recoveryKeyInput.trim());
      if (res.ok) {
        setRecoveryKeyInput("");
      }
    } finally {
      setUnlocking(false);
    }
  };

  const isRestoring = busy === "restore";
  const selectedInvoices = selectedFile
    ? selectedFile.manifest?.invoiceCount ??
      countInvoices(selectedFile.manifest?.counts)
    : 0;
  const selectedBusinessRecords = selectedFile
    ? selectedFile.manifest?.totalBusinessRecords ??
      countBusinessRecords(selectedFile.manifest?.counts)
    : 0;
  const liveRecordCount = currentBusinessRecordCount ?? currentInvoiceCount;
  const isSelectedEmpty =
    Boolean(selectedFile) &&
    selectedFile?.status === "verified" &&
    countBusinessRecords(selectedFile.manifest?.counts) === 0;
  const isSelectedEncrypted = selectedFile?.status === "encrypted";
  const canRestore = Boolean(selectedFile && selectedFile.status === "verified");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        dir="rtl"
        className="max-w-md p-5 rounded-3xl border border-primary/20 bg-card shadow-2xl max-h-[92vh] overflow-y-auto overscroll-contain"
      >
        <DialogHeader className="text-right space-y-1.5 pb-2 border-b border-border/50">
          <div className="flex items-center gap-2.5">
            <div className="grid h-10 w-10 place-items-center rounded-2xl bg-amber-500/10 text-amber-600 border border-amber-500/20 shrink-0">
              <RotateCcw className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle className="text-base font-black text-foreground">
                مركز استعادة النسخ الاحتياطية
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                استرجاع آمن للبيانات والفواتير والخطابات مع حماية مسبقة تلقائية
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {successResult ? (
          <RestoreSuccessView
            successResult={successResult}
            onCloseSuccess={onCloseSuccess}
          />
        ) : (
          <div className="py-2 space-y-4">
            {selectedFile ? (
              <div className="rounded-2xl border-2 border-primary/40 bg-gradient-to-br from-primary/5 via-card to-amber-500/5 p-4 space-y-3 relative overflow-hidden shadow-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 text-xs font-black text-primary bg-primary/10 px-2.5 py-1 rounded-full border border-primary/20">
                    {isSelectedEncrypted ? (
                      <Lock className="h-3.5 w-3.5" />
                    ) : (
                      <FileCheck className="h-3.5 w-3.5" />
                    )}
                    <span>النسخة المحددة للاستعادة</span>
                  </span>
                  <span className="text-[11px] font-bold text-muted-foreground">
                    {formatRelative(selectedFile.manifest?.createdAt)}
                  </span>
                </div>

                <div className="space-y-1">
                  <p className="text-xs font-black text-foreground" dir="ltr">
                    {selectedFile.fileName}
                  </p>
                  <p className="text-[11px] text-muted-foreground font-medium">
                    {formatDateTime(selectedFile.manifest?.createdAt)} •{" "}
                    {formatBytes(selectedFile.sizeBytes)}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                  {!isSelectedEncrypted && (
                    <span className="rounded-lg bg-emerald-600/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20 font-black px-2.5 py-1 tabular-nums">
                      {selectedBusinessRecords} سجل مؤمّن
                    </span>
                  )}
                  <span className="rounded-lg bg-muted text-foreground font-bold px-2 py-1">
                    {STATUS_LABEL[selectedFile.status]?.label ?? "سليمة"}
                  </span>
                  <span className="rounded-lg bg-muted text-muted-foreground font-mono px-2 py-1 tabular-nums">
                    حجم الجهاز: {liveRecordCount} سجل
                  </span>
                </div>

                {!isSelectedEncrypted && (
                  <BackupModulePills
                    counts={selectedFile.manifest?.counts}
                    invoiceCount={selectedInvoices}
                  />
                )}

                {isSelectedEncrypted && (
                  <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 space-y-2.5">
                    <div className="flex items-start gap-2 text-[11px] text-amber-800 dark:text-amber-200 leading-relaxed">
                      <KeyRound className="h-4 w-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
                      <div>
                        <p className="font-black">
                          إدخال رمز الاسترداد لفك تشفير النسخة
                        </p>
                        <p className="mt-0.5">
                          هذه النسخة مشفّرة بمفتاح جهاز آخر. أدخل رمز الاسترداد (TAKEY-...) لفك تشفيرها ومعاينتها واستعادتها فوراً.
                        </p>
                      </div>
                    </div>
                    {onImportRecoveryKey && (
                      <div className="space-y-2">
                        <Input
                          dir="ltr"
                          value={recoveryKeyInput}
                          onChange={(e) => setRecoveryKeyInput(e.target.value)}
                          placeholder="TAKEY-XXXX-XXXX-..."
                          className="h-10 font-mono text-xs uppercase tracking-wider bg-background"
                          disabled={unlocking || busy === "import-key"}
                        />
                        <Button
                          type="button"
                          size="sm"
                          onClick={handleUnlockEncrypted}
                          disabled={
                            unlocking ||
                            busy === "import-key" ||
                            !recoveryKeyInput.trim()
                          }
                          className="w-full h-9 rounded-xl gap-1.5 text-xs font-black bg-amber-600 hover:bg-amber-700 text-white"
                        >
                          {unlocking || busy === "import-key" ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <KeyRound className="h-3.5 w-3.5" />
                          )}
                          <span>فك تشفير النسخة الآن</span>
                        </Button>
                      </div>
                    )}
                  </div>
                )}

                {isSelectedEmpty && (
                  <div className="flex items-start gap-2 rounded-xl bg-amber-500/10 p-2.5 text-[11px] text-amber-700 dark:text-amber-300 border border-amber-500/20">
                    <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                    <span>
                      تنبيه: هذه النسخة خالية من السجلات (0 سجل). اختر نسخة أخرى إذا كنت تريد استعادة بيانات سابقة.
                    </span>
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-muted-foreground/30 p-4 text-center space-y-2">
                <AlertTriangle className="h-6 w-6 text-amber-500 mx-auto" />
                <p className="text-xs font-bold text-muted-foreground">
                  لم يتم العثور على نسخ احتياطية في المجلد المحدد.
                </p>
              </div>
            )}

            <RestoreArchiveSelector
              backups={backups}
              selectedFile={selectedFile}
              showOtherBackups={showOtherBackups}
              onToggleShowOther={() => setShowOtherBackups((prev) => !prev)}
              onSelectFile={handleSelectFile}
            />

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onImportExternal}
              className="w-full h-10 rounded-xl gap-2 text-xs font-bold border-dashed border-border hover:bg-primary/5 hover:text-primary active:scale-95 touch-manipulation"
            >
              <UploadCloud className="h-4 w-4 text-primary" />
              <span>استعراض واستيراد ملف خارجي (.tabk / .json)</span>
            </Button>

            <div className="space-y-2 pt-1 border-t border-border/50">
              <label className="text-xs font-black text-foreground block">
                طريقة الاستعادة:
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    playTapSound();
                    setRestoreMode("replace");
                  }}
                  className={cn(
                    "p-3 rounded-2xl border text-right transition-all flex flex-col justify-between gap-1",
                    restoreMode === "replace"
                      ? "border-primary bg-primary/10 shadow-sm"
                      : "border-border/70 bg-card hover:bg-muted/40"
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-black text-foreground">
                      استبدال كامل
                    </span>
                    {restoreMode === "replace" && (
                      <CheckCircle2 className="h-4 w-4 text-primary" />
                    )}
                  </div>
                  <p className="text-[10px] text-muted-foreground leading-relaxed">
                    استبدال قاعدة البيانات مع أخذ نسخة حماية تلقائية لما هو موجود
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    playTapSound();
                    setRestoreMode("merge");
                  }}
                  className={cn(
                    "p-3 rounded-2xl border text-right transition-all flex flex-col justify-between gap-1",
                    restoreMode === "merge"
                      ? "border-primary bg-primary/10 shadow-sm"
                      : "border-border/70 bg-card hover:bg-muted/40"
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-black text-foreground">
                      دمج ذكي آمن
                    </span>
                    {restoreMode === "merge" && (
                      <CheckCircle2 className="h-4 w-4 text-primary" />
                    )}
                  </div>
                  <p className="text-[10px] text-muted-foreground leading-relaxed">
                    إضافة السجلات الجديدة فقط دون حذف أو تكرار أي سجل حالي
                  </p>
                </button>
              </div>
            </div>

            <DialogFooter className="gap-2 pt-3 border-t border-border/50 flex-col sm:flex-row">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isRestoring}
                className="w-full sm:w-1/3 h-11 rounded-2xl text-xs font-bold"
              >
                إلغاء
              </Button>
              <Button
                type="button"
                onClick={handleConfirmRestore}
                disabled={isRestoring || !canRestore}
                className="w-full sm:w-2/3 h-11 rounded-2xl text-xs font-black bg-amber-600 hover:bg-amber-700 text-white shadow-md active:scale-[0.98] touch-manipulation"
              >
                {isRestoring ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin ml-2" />
                    <span>جاري استعادة البيانات...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-4 w-4 ml-2" />
                    <span>
                      تأكيد الاستعادة الآن ({selectedBusinessRecords} سجل)
                    </span>
                  </>
                )}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

