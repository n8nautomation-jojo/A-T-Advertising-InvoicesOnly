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
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import {
  Settings2,
  Lock,
  RefreshCw,
  Archive,
  Clock,
  Check,
  AlertTriangle,
  KeyRound,
  Copy,
  ChevronDown,
  Loader2,
  Unlock,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { playTapSound, playSuccessSound } from "@/lib/soundEffects";
import { formatDateTime, type BackupSettings } from "./types";
import type {
  RecoveryKeyExportResponse,
  RecoveryKeyImportResponse,
} from "./useBackupManagerActions";

interface BackupSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: BackupSettings;
  encryptionAvailable: boolean;
  hasEncryptionKey?: boolean;
  encryptionKeyId?: string;
  onSave: (updated: Partial<BackupSettings>) => Promise<void>;
  onExportRecoveryKey?: () => Promise<RecoveryKeyExportResponse>;
  onImportRecoveryKey?: (code: string) => Promise<RecoveryKeyImportResponse>;
}

const RETENTION_WINDOW_OPTIONS: Array<{
  days: number;
  label: string;
  recommended?: boolean;
}> = [
  { days: 7, label: "7 أيام" },
  { days: 14, label: "14 يوماً" },
  { days: 30, label: "آخر شهر (30 يوماً)", recommended: true },
  { days: 60, label: "شهران (60 يوماً)" },
  { days: 90, label: "3 أشهر (90 يوماً)" },
  { days: 0, label: "بلا حذف تلقائي" },
];

export function BackupSettingsDialog({
  open,
  onOpenChange,
  settings,
  encryptionAvailable,
  hasEncryptionKey = false,
  encryptionKeyId = "",
  onSave,
  onExportRecoveryKey,
  onImportRecoveryKey,
}: BackupSettingsDialogProps) {
  const [autoDaily, setAutoDaily] = useState(settings.autoDaily);
  const [afterTransaction, setAfterTransaction] = useState(
    settings.afterTransaction
  );
  const [encryptionEnabled, setEncryptionEnabled] = useState(
    settings.encryptionEnabled
  );
  const [maxAgeDays, setMaxAgeDays] = useState<number>(
    settings.retention?.maxAgeDays ?? 30
  );
  const [saving, setSaving] = useState(false);

  // Recovery Key export state
  const [exportingKey, setExportingKey] = useState(false);
  const [exportedKey, setExportedKey] = useState<string | null>(null);
  const [exportedKeyId, setExportedKeyId] = useState<string>("");
  const [copiedKey, setCopiedKey] = useState(false);

  // Recovery Key import state
  const [showImportKey, setShowImportKey] = useState(false);
  const [importCode, setImportCode] = useState("");
  const [importingKey, setImportingKey] = useState(false);

  useEffect(() => {
    if (open) {
      setAutoDaily(settings.autoDaily);
      setAfterTransaction(settings.afterTransaction);
      setEncryptionEnabled(settings.encryptionEnabled);
      setMaxAgeDays(settings.retention?.maxAgeDays ?? 30);
      setExportedKey(null);
      setExportedKeyId(encryptionKeyId || "");
      setCopiedKey(false);
      setShowImportKey(false);
      setImportCode("");
    }
  }, [open, settings, encryptionKeyId]);

  const handleSave = async () => {
    setSaving(true);
    playTapSound();
    try {
      await onSave({
        autoDaily,
        afterTransaction,
        encryptionEnabled,
        retention: {
          ...settings.retention,
          daily: maxAgeDays > 0 ? Math.min(maxAgeDays, 90) : 30,
          maxAgeDays,
        },
      });
      playSuccessSound();
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  const handleExportKeyClick = async () => {
    if (!onExportRecoveryKey) return;
    setExportingKey(true);
    try {
      const res = await onExportRecoveryKey();
      if (res.ok && res.recoveryKey) {
        setExportedKey(res.recoveryKey);
        if (res.keyId) setExportedKeyId(res.keyId);
        setCopiedKey(false);
      }
    } finally {
      setExportingKey(false);
    }
  };

  const handleCopyKey = async () => {
    if (!exportedKey) return;
    playTapSound();
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(exportedKey);
      } else {
        const el = document.createElement("textarea");
        el.value = exportedKey;
        document.body.appendChild(el);
        el.select();
        document.execCommand("copy");
        document.body.removeChild(el);
      }
      setCopiedKey(true);
      playSuccessSound();
      toast.success("تم نسخ رمز الاسترداد — احفظه في مكان آمن خارج الهاتف.");
      setTimeout(() => setCopiedKey(false), 3000);
    } catch {
      toast.error("تعذّر النسخ التلقائي — حدّد الرمز وانسخه يدوياً.");
    }
  };

  const handleImportKeyClick = async () => {
    if (!onImportRecoveryKey || !importCode.trim()) return;
    setImportingKey(true);
    try {
      const res = await onImportRecoveryKey(importCode.trim());
      if (res.ok) {
        setImportCode("");
        setShowImportKey(false);
        if (res.keyId) setExportedKeyId(res.keyId);
      }
    } finally {
      setImportingKey(false);
    }
  };

  const displayKeyId = exportedKeyId || encryptionKeyId;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        dir="rtl"
        className="max-w-md p-5 rounded-3xl border border-primary/20 bg-card shadow-2xl max-h-[90vh] overflow-y-auto overscroll-contain"
      >
        <DialogHeader className="text-right space-y-1 pb-2 border-b border-border/50">
          <div className="flex items-center gap-2.5">
            <div className="grid h-10 w-10 place-items-center rounded-2xl bg-primary/10 text-primary border border-primary/20 shrink-0">
              <Settings2 className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle className="text-base font-black text-foreground">
                إعدادات النسخ التلقائي والتشفير
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                تخصيص مواعيد النسخ الاحتياطي ومستوى أمان البيانات
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="py-3 space-y-3.5">
          {/* Daily auto-backup */}
          <div className="flex items-center justify-between gap-3 p-3 rounded-2xl border border-border/70 bg-muted/20">
            <div className="flex items-center gap-3">
              <div className="grid h-9 w-9 place-items-center rounded-xl bg-primary/10 text-primary shrink-0">
                <RefreshCw className="h-4.5 w-4.5" />
              </div>
              <div>
                <p className="text-xs font-black text-foreground">
                  نسخ احتياطي يومي مجدول
                </p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  أخذ نسخة تلقائياً كل 24 ساعة في الخلفية
                </p>
              </div>
            </div>
            <Switch checked={autoDaily} onCheckedChange={setAutoDaily} />
          </div>

          {/* After transaction */}
          <div className="flex items-center justify-between gap-3 p-3 rounded-2xl border border-border/70 bg-muted/20">
            <div className="flex items-center gap-3">
              <div className="grid h-9 w-9 place-items-center rounded-xl bg-primary/10 text-primary shrink-0">
                <Archive className="h-4.5 w-4.5" />
              </div>
              <div>
                <p className="text-xs font-black text-foreground">
                  نسخ فوري بعد كل معاملة
                </p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  حفظ نسخة تلقائية بعد كل فاتورة أو سند أو خطاب يصدر
                </p>
              </div>
            </div>
            <Switch
              checked={afterTransaction}
              onCheckedChange={setAfterTransaction}
            />
          </div>

          {/* Encryption + Recovery Key Management */}
          <div className="rounded-2xl border border-border/70 bg-muted/20 p-3 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="grid h-9 w-9 place-items-center rounded-xl bg-primary/10 text-primary shrink-0">
                  <Lock className="h-4.5 w-4.5" />
                </div>
                <div>
                  <p className="text-xs font-black text-foreground">
                    تشفير النسخ (AES-256)
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {encryptionAvailable
                      ? "حماية النسخ بمفتاح معزول في مخزن المفاتيح"
                      : "غير مدعوم على هذا الجهاز"}
                  </p>
                </div>
              </div>
              <Switch
                checked={encryptionEnabled}
                onCheckedChange={setEncryptionEnabled}
                disabled={!encryptionAvailable}
              />
            </div>

            {encryptionAvailable && (
              <div className="space-y-2.5 pt-2 border-t border-border/50">
                {encryptionEnabled ? (
                  <div className="flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-2.5 text-[11px] leading-relaxed text-amber-800 dark:text-amber-200">
                    <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
                    <div className="space-y-1">
                      <p className="font-black">
                        تنبيه مهم: احفظ رمز الاسترداد (Recovery Key)
                      </p>
                      <p>
                        لا يمكن استعادة النسخ المشفّرة بعد حذف التطبيق أو عند الانتقال لهاتف جديد بدون إدخال رمز الاسترداد. احتفظ به في مكان آمن خارج الجهاز.
                      </p>
                    </div>
                  </div>
                ) : (
                  <p className="text-[11px] leading-relaxed text-muted-foreground px-0.5">
                    يمكنك استخراج رمز الاسترداد (<span className="font-mono font-bold" dir="ltr">TAKEY-...</span>) أو إدخال مفتاح من هاتف قديم في أي وقت من هنا حتى لو كان التشفير متوقفاً حالياً.
                  </p>
                )}

                {(hasEncryptionKey || displayKeyId || settings.recoveryKeyExportedAt) && (
                  <div className="flex flex-wrap items-center justify-between gap-1.5 text-[10px] text-muted-foreground px-1">
                    {displayKeyId && (
                      <span className="font-mono" dir="ltr">
                        Key ID: {displayKeyId}
                      </span>
                    )}
                    {settings.recoveryKeyExportedAt && (
                      <span>
                        آخر تصدير: {formatDateTime(settings.recoveryKeyExportedAt)}
                      </span>
                    )}
                  </div>
                )}

                {/* Export Recovery Key button */}
                {onExportRecoveryKey && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleExportKeyClick}
                    disabled={exportingKey}
                    className={cn(
                      "w-full h-10 rounded-xl gap-2 text-xs font-black active:scale-[0.99] touch-manipulation",
                      encryptionEnabled
                        ? "border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-300 hover:bg-amber-500/15"
                        : "border-primary/30 bg-primary/5 text-primary hover:bg-primary/10"
                    )}
                  >
                    {exportingKey ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <KeyRound className="h-4 w-4" />
                    )}
                    <span>عرض ونسخ رمز الاسترداد (TAKEY)</span>
                  </Button>
                )}

                {/* Displayed Exported Recovery Key */}
                {exportedKey && (
                  <div className="rounded-xl border border-primary/30 bg-background p-2.5 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-black text-primary">
                        رمز الاسترداد السري الخاص بك:
                      </span>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={handleCopyKey}
                        className="h-7 px-2.5 rounded-lg text-[10px] font-black gap-1"
                      >
                        {copiedKey ? (
                          <>
                            <Check className="h-3 w-3 text-emerald-600" />
                            <span>تم النسخ</span>
                          </>
                        ) : (
                          <>
                            <Copy className="h-3 w-3" />
                            <span>نسخ الرمز</span>
                          </>
                        )}
                      </Button>
                    </div>
                    <div
                      dir="ltr"
                      className="select-all break-all rounded-lg bg-muted/60 border border-border/60 p-2 font-mono text-[11px] font-bold tracking-wider text-foreground text-center"
                    >
                      {exportedKey}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Expandable Import Recovery Key section (for restoring from another device) */}
            {onImportRecoveryKey && encryptionAvailable && (
              <div className="pt-2 border-t border-border/50 space-y-2">
                <button
                  type="button"
                  onClick={() => {
                    playTapSound();
                    setShowImportKey((prev) => !prev);
                  }}
                  className="flex items-center justify-between w-full text-[11px] font-black text-primary hover:underline px-0.5"
                >
                  <span className="flex items-center gap-1.5">
                    <Unlock className="h-3.5 w-3.5" />
                    <span>إدخال رمز استرداد (لنسخ من جهاز سابق)</span>
                  </span>
                  <ChevronDown
                    className={cn(
                      "h-3.5 w-3.5 transition-transform duration-200",
                      showImportKey ? "rotate-180" : ""
                    )}
                  />
                </button>

                {showImportKey && (
                  <div className="space-y-2 pt-1">
                    <Input
                      dir="ltr"
                      value={importCode}
                      onChange={(e) => setImportCode(e.target.value)}
                      placeholder="TAKEY-XXXX-XXXX-..."
                      className="h-10 font-mono text-xs uppercase tracking-wider"
                      disabled={importingKey}
                    />
                    <Button
                      type="button"
                      size="sm"
                      onClick={handleImportKeyClick}
                      disabled={importingKey || !importCode.trim()}
                      className="w-full h-9 rounded-xl gap-1.5 text-xs font-black"
                    >
                      {importingKey ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <KeyRound className="h-3.5 w-3.5" />
                      )}
                      <span>استيراد وفك تشفير النسخ</span>
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Smart Retention Window Selector */}
          <div className="rounded-2xl bg-primary/5 border border-primary/20 p-3 space-y-2.5 text-xs">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 font-black text-primary">
                <Clock className="h-4 w-4 shrink-0" />
                <span>فلترة وحذف النسخ القديمة تلقائياً</span>
              </div>
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">
                {maxAgeDays > 0 ? `آخر ${maxAgeDays} يوماً` : "بلا حد زمني"}
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
              {RETENTION_WINDOW_OPTIONS.map((opt) => {
                const selected = maxAgeDays === opt.days;
                return (
                  <button
                    key={opt.days}
                    type="button"
                    onClick={() => {
                      playTapSound();
                      setMaxAgeDays(opt.days);
                    }}
                    className={cn(
                      "relative flex flex-col items-center justify-center rounded-xl border px-2 py-2 text-center transition-all active:scale-95 touch-manipulation",
                      selected
                        ? "border-primary bg-primary text-primary-foreground shadow-sm font-black"
                        : "border-border/70 bg-background/80 text-foreground hover:border-primary/40 hover:bg-primary/5 font-bold"
                    )}
                  >
                    <span className="text-[11px] leading-tight">{opt.label}</span>
                    {opt.recommended && (
                      <span
                        className={cn(
                          "mt-0.5 rounded-full px-1.5 py-0.2 text-[9px] font-black",
                          selected
                            ? "bg-white/20 text-primary-foreground"
                            : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                        )}
                      >
                        موصى به
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            <p className="text-[11px] text-muted-foreground leading-relaxed">
              يحتفظ التطبيق تلقائياً بالنسخ خلال المدة المختارة ويحذف النسخ الأقدم لتوفير ذاكرة الهاتف، مع ضغط النسخ المتكررة لنسخة واحدة يومياً والاحتفاظ دائماً بآخر نسختين سليمتين على الأقل وبجميع النسخ اليدوية.
            </p>
          </div>
        </div>

        <DialogFooter className="gap-2 pt-2 border-t border-border/50">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="flex-1 h-11 rounded-2xl text-xs font-bold"
          >
            إلغاء
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="flex-1 h-11 rounded-2xl text-xs font-black bg-primary text-primary-foreground shadow-sm active:scale-95 touch-manipulation"
          >
            <Check className="h-4 w-4 ml-1.5" />
            <span>حفظ الإعدادات</span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

