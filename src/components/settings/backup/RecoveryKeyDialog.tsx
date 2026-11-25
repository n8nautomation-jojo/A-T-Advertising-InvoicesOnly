import React, { useEffect, useState } from "react";
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
  KeyRound,
  ShieldCheck,
  ShieldAlert,
  Copy,
  Check,
  Share2,
  Loader2,
  Unlock,
  Smartphone,
  Info,
  Eye,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { playSuccessSound, playTapSound } from "@/lib/soundEffects";
import { formatDateTime } from "./types";
import type {
  RecoveryKeyExportResponse,
  RecoveryKeyImportResponse,
} from "./useBackupManagerActions";

interface RecoveryKeyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  encryptionEnabled: boolean;
  encryptionAvailable: boolean;
  hasEncryptionKey: boolean;
  encryptionKeyId: string;
  recoveryKeyExportedAt?: string | null;
  onExportRecoveryKey: () => Promise<RecoveryKeyExportResponse>;
  onImportRecoveryKey: (code: string) => Promise<RecoveryKeyImportResponse>;
}

async function copyTextToClipboard(text: string): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const el = document.createElement("textarea");
  el.value = text;
  el.setAttribute("readonly", "");
  el.style.position = "fixed";
  el.style.opacity = "0";
  document.body.appendChild(el);
  el.select();
  const ok = document.execCommand("copy");
  document.body.removeChild(el);
  if (!ok) {
    throw new Error("COPY_FAILED");
  }
}

export function RecoveryKeyDialog({
  open,
  onOpenChange,
  encryptionEnabled,
  encryptionAvailable,
  hasEncryptionKey,
  encryptionKeyId,
  recoveryKeyExportedAt,
  onExportRecoveryKey,
  onImportRecoveryKey,
}: RecoveryKeyDialogProps) {
  const [exporting, setExporting] = useState(false);
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [activeKeyId, setActiveKeyId] = useState<string>(encryptionKeyId || "");
  const [copied, setCopied] = useState(false);
  const [sharing, setSharing] = useState(false);

  const [importCode, setImportCode] = useState("");
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    if (open) {
      setRevealedKey(null);
      setActiveKeyId(encryptionKeyId || "");
      setCopied(false);
      setImportCode("");
    }
  }, [open, encryptionKeyId]);

  const displayKeyId = activeKeyId || encryptionKeyId;

  const handleRevealKey = async () => {
    if (!encryptionAvailable) {
      toast.error("استخراج مفتاح التشفير متاح داخل تطبيق أندرويد فقط.");
      return;
    }
    setExporting(true);
    try {
      const res = await onExportRecoveryKey();
      if (res.ok && res.recoveryKey) {
        setRevealedKey(res.recoveryKey);
        if (res.keyId) setActiveKeyId(res.keyId);
        setCopied(false);
      }
    } finally {
      setExporting(false);
    }
  };

  const handleCopyKey = async () => {
    if (!revealedKey) return;
    playTapSound();
    try {
      await copyTextToClipboard(revealedKey);
      setCopied(true);
      playSuccessSound();
      toast.success("تم نسخ مفتاح التشفير — احفظه في مكان آمن خارج الهاتف.");
      setTimeout(() => setCopied(false), 3000);
    } catch {
      toast.error("تعذّر النسخ التلقائي — حدّد الرمز وانسخه يدوياً.");
    }
  };

  const handleShareOrSaveKey = async () => {
    if (!revealedKey) return;
    playTapSound();
    setSharing(true);
    const keyInfoLines = [
      "مفتاح استرداد النسخ الاحتياطي (T.A Advertising)",
      "احتفظ بهذا الرمز في مكان آمن خارج الهاتف لفك تشفير ملفات .tabk على هاتف جديد.",
      "",
      `Recovery Key: ${revealedKey}`,
      ...(displayKeyId ? [`Key ID: ${displayKeyId}`] : []),
      `Exported At: ${new Date().toISOString()}`,
    ];
    const textContent = keyInfoLines.join("\n");

    try {
      if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
        try {
          await navigator.share({
            title: "مفتاح تشفير النسخ الاحتياطي (TAKEY)",
            text: textContent,
          });
          playSuccessSound();
          toast.success("تم فتح قائمة المشاركة لحفظ مفتاح التشفير.");
          return;
        } catch (shareErr: any) {
          if (shareErr?.name === "AbortError") {
            return;
          }
          // Fall through to .txt blob download / copy fallback
        }
      }

      const isNative = typeof window !== "undefined" && Boolean((window as any).Capacitor?.isNativePlatform?.());
      if (!isNative) {
        try {
          const blob = new Blob([textContent], { type: "text/plain;charset=utf-8" });
          const url = URL.createObjectURL(blob);
          const link = document.createElement("a");
          link.href = url;
          link.download = "ta-backup-key.txt";
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          setTimeout(() => URL.revokeObjectURL(url), 1000);
          playSuccessSound();
          toast.success("تم حفظ ملف المفتاح (ta-backup-key.txt) — انقله لمكان آمن خارج الهاتف.");
          return;
        } catch {
          // Fallback to clipboard copy if blob download is blocked
        }
      }

      await copyTextToClipboard(revealedKey);
      setCopied(true);
      playSuccessSound();
      toast.success("تم نسخ مفتاح التشفير إلى الحافظة — الصقه في ملاحظة سحابية آمنة.");
      setTimeout(() => setCopied(false), 3000);
    } catch {
      toast.error("تعذّر مشاركة المفتاح — يمكنك نسخه يدوياً من المربع أعلاه.");
    } finally {
      setSharing(false);
    }
  };

  const handleImportSubmit = async () => {
    const clean = importCode.trim();
    if (!clean) {
      toast.error("أدخل رمز الاسترداد أولاً.");
      return;
    }
    setImporting(true);
    try {
      const res = await onImportRecoveryKey(clean);
      if (res.ok) {
        setImportCode("");
        if (res.keyId) setActiveKeyId(res.keyId);
      }
    } finally {
      setImporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        dir="rtl"
        className="max-w-lg p-5 rounded-3xl border border-primary/20 bg-card shadow-2xl max-h-[90vh] overflow-y-auto overscroll-contain"
      >
        <DialogHeader className="text-right space-y-1 pb-3 border-b border-border/50">
          <div className="flex items-center gap-2.5">
            <div className="grid h-10 w-10 place-items-center rounded-2xl bg-primary/10 text-primary border border-primary/20 shrink-0">
              <KeyRound className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <DialogTitle className="text-base font-black text-foreground">
                مفتاح التشفير ونقل الهاتف الجديد
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                إدارة رمز الاسترداد (TAKEY) لحماية واستعادة نسخك بين الأجهزة
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="py-3 space-y-4">
          {/* a) Status Banner */}
          <div
            className={cn(
              "rounded-2xl border p-3.5 space-y-2",
              encryptionEnabled
                ? "border-emerald-500/35 bg-emerald-500/10"
                : "border-amber-500/35 bg-amber-500/10"
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                {encryptionEnabled ? (
                  <ShieldCheck className="h-4.5 w-4.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                ) : (
                  <ShieldAlert className="h-4.5 w-4.5 text-amber-600 dark:text-amber-400 shrink-0" />
                )}
                <span className="text-xs font-black text-foreground">
                  حالة تشفير AES-256:
                </span>
              </div>
              <span
                className={cn(
                  "rounded-full px-2.5 py-0.5 text-[11px] font-black border",
                  encryptionEnabled
                    ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30"
                    : "bg-amber-500/15 text-amber-800 dark:text-amber-200 border-amber-500/30"
                )}
              >
                {encryptionEnabled ? "مفعّل" : "غير مفعّل"}
              </span>
            </div>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              إذا كان التشفير غير مفعّل يمكنك نقل ملف{" "}
              <span className="font-mono font-bold text-foreground" dir="ltr">
                .tabk
              </span>{" "}
              واستعادته على الهاتف الجديد مباشرة بدون مفتاح. أما عند تفعيل التشفير (AES-256)
              فستحتاج رمز الاسترداد (
              <span className="font-mono font-bold text-foreground" dir="ltr">
                TAKEY-...
              </span>
              ) لفك تشفير النسخة على الهاتف الجديد.
            </p>
          </div>

          {!encryptionAvailable && (
            <div className="flex items-start gap-2 rounded-2xl border border-border/70 bg-muted/40 p-3 text-[11px] text-muted-foreground">
              <Info className="h-4 w-4 shrink-0 mt-0.5 text-primary" />
              <span>
                مخزن مفاتيح التشفير متاح داخل تطبيق أندرويد فقط. افتح هذه الشاشة من هاتفك لإظهار أو استيراد مفتاح الاسترداد.
              </span>
            </div>
          )}

          {/* b) Section 1 — Export & Save This Phone's Key */}
          <div className="rounded-2xl border border-border/70 bg-muted/20 p-3.5 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <div className="grid h-8 w-8 place-items-center rounded-xl bg-primary/10 text-primary shrink-0">
                  <KeyRound className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-xs font-black text-foreground">
                    1. استخراج وحفظ مفتاح هذا الهاتف (TAKEY-...)
                  </h3>
                  <p className="text-[10px] text-muted-foreground">
                    {hasEncryptionKey
                      ? "المفتاح جاهز ومخزّن بأمان في هذا الجهاز"
                      : "سيتم إنشاء مفتاح آمن تلقائياً عند عرضه لأول مرة"}
                  </p>
                </div>
              </div>
            </div>

            {(displayKeyId || recoveryKeyExportedAt) && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/50 bg-background/70 px-3 py-2 text-[10px] text-muted-foreground">
                {displayKeyId && (
                  <span className="font-mono font-bold text-foreground" dir="ltr">
                    Key ID: {displayKeyId}
                  </span>
                )}
                {recoveryKeyExportedAt && (
                  <span>آخر تصدير: {formatDateTime(recoveryKeyExportedAt)}</span>
                )}
              </div>
            )}

            <Button
              type="button"
              onClick={handleRevealKey}
              disabled={exporting || !encryptionAvailable}
              className="w-full h-11 rounded-2xl gap-2 text-xs font-black bg-primary hover:bg-primary/95 text-primary-foreground shadow-sm active:scale-[0.99] touch-manipulation"
            >
              {exporting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Eye className="h-4 w-4" />
              )}
              <span>عرض مفتاح التشفير الخاص بهذا الهاتف</span>
            </Button>

            {revealedKey && (
              <div className="rounded-2xl border-2 border-primary/40 bg-background p-3 space-y-3 shadow-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-black text-primary">
                    رمز الاسترداد السري (TAKEY):
                  </span>
                  <span className="text-[10px] font-bold text-amber-700 dark:text-amber-300">
                    سرّي — احفظه خارج الهاتف
                  </span>
                </div>

                <div
                  dir="ltr"
                  className="select-all break-all rounded-xl bg-slate-950 text-emerald-300 dark:bg-black/80 border border-emerald-500/40 px-3 py-3 font-mono text-xs sm:text-[13px] font-black tracking-wider text-center leading-relaxed"
                >
                  {revealedKey}
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={handleCopyKey}
                    className="h-10 rounded-xl gap-1.5 text-xs font-black active:scale-95 touch-manipulation"
                  >
                    {copied ? (
                      <>
                        <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                        <span>تم النسخ</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-4 w-4" />
                        <span>نسخ المفتاح</span>
                      </>
                    )}
                  </Button>

                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleShareOrSaveKey}
                    disabled={sharing}
                    className="h-10 rounded-xl gap-1.5 text-xs font-black border-primary/30 text-primary hover:bg-primary/5 active:scale-95 touch-manipulation"
                  >
                    {sharing ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Share2 className="h-4 w-4" />
                    )}
                    <span>مشاركة / حفظ المفتاح</span>
                  </Button>
                </div>
              </div>
            )}

            {/* 3-Step New Phone Transfer Guide */}
            <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 space-y-2">
              <div className="flex items-center gap-1.5 text-[11px] font-black text-primary">
                <Smartphone className="h-3.5 w-3.5 shrink-0" />
                <span>دليل النقل لهاتف جديد (3 خطوات سريعة):</span>
              </div>
              <ol className="space-y-1.5 text-[11px] leading-relaxed text-foreground/90">
                <li className="flex items-start gap-2">
                  <span className="grid h-4.5 w-4.5 place-items-center rounded-full bg-primary/15 text-primary text-[10px] font-black shrink-0 mt-0.5">
                    1
                  </span>
                  <span>
                    انسخ رمز{" "}
                    <span className="font-mono font-bold" dir="ltr">
                      TAKEY-...
                    </span>{" "}
                    واحفظه في مكان آمن خارج الهاتف (ملاحظات سحابية أو رسالة محفوظة) وانقل أحدث ملف{" "}
                    <span className="font-mono font-bold" dir="ltr">
                      .tabk
                    </span>
                    .
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="grid h-4.5 w-4.5 place-items-center rounded-full bg-primary/15 text-primary text-[10px] font-black shrink-0 mt-0.5">
                    2
                  </span>
                  <span>
                    على الهاتف الجديد: افتح{" "}
                    <strong className="font-black">
                      الإعدادات ← النسخ الاحتياطي ← مفتاح التشفير ونقل الهاتف
                    </strong>{" "}
                    وأدخل الرمز في القسم أدناه.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="grid h-4.5 w-4.5 place-items-center rounded-full bg-primary/15 text-primary text-[10px] font-black shrink-0 mt-0.5">
                    3
                  </span>
                  <span>
                    اختر ملف{" "}
                    <span className="font-mono font-bold" dir="ltr">
                      .tabk
                    </span>{" "}
                    (أو اربط مجلد النسخ) واضغط{" "}
                    <strong className="font-black">استعادة نسخة</strong> لتعود جميع
                    فواتيرك وعملائك وحساباتك فوراً.
                  </span>
                </li>
              </ol>
            </div>
          </div>

          {/* c) Section 2 — Import Key From Old Phone */}
          <div className="rounded-2xl border border-border/70 bg-muted/20 p-3.5 space-y-3">
            <div className="flex items-center gap-2">
              <div className="grid h-8 w-8 place-items-center rounded-xl bg-amber-500/15 text-amber-700 dark:text-amber-300 shrink-0">
                <Unlock className="h-4 w-4" />
              </div>
              <div>
                <h3 className="text-xs font-black text-foreground">
                  2. إدخال مفتاح من هاتف قديم (عند الانتقال لهاتف جديد)
                </h3>
                <p className="text-[10px] text-muted-foreground">
                  أدخل رمز الاسترداد المستخرج من جهازك السابق لفك تشفير النسخ المشفّرة
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <Input
                dir="ltr"
                value={importCode}
                onChange={(e) => setImportCode(e.target.value)}
                placeholder="TAKEY-XXXX-XXXX-..."
                className="h-11 rounded-xl font-mono text-xs uppercase tracking-wider bg-background"
                disabled={importing || !encryptionAvailable}
              />
              <Button
                type="button"
                onClick={handleImportSubmit}
                disabled={importing || !importCode.trim() || !encryptionAvailable}
                className="w-full h-10 rounded-xl gap-2 text-xs font-black bg-amber-600 hover:bg-amber-700 text-white active:scale-[0.99] touch-manipulation"
              >
                {importing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <KeyRound className="h-4 w-4" />
                )}
                <span>حفظ المفتاح وفك تشفير النسخ</span>
              </Button>
            </div>
          </div>
        </div>

        <DialogFooter className="pt-2 border-t border-border/50">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="w-full h-11 rounded-2xl text-xs font-bold"
          >
            إغلاق
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
