import React, { useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  FolderOpen,
  Loader2,
  RotateCcw,
  ShieldCheck,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Capacitor } from "@capacitor/core";
import { backupBridge, isBackupEngineAvailable } from "@/lib/backup/bridge";
import { discoverForRecovery, type DiscoveryState } from "@/lib/backup/useBackupStatus";
import { restoreBackup } from "@/lib/backup/restoreService";
import { saveBackupSettings } from "@/lib/backup/settingsStore";
import { formatBytes, formatDateTime } from "@/components/settings/BackupManagerCard";
import { playSuccessSound, playTapSound } from "@/lib/soundEffects";
import { hasCustomPassword } from "@/lib/passwordStore";
import { getStoredSync } from "@/lib/sqliteStorage";

function hasExistingLocalDatabaseData(discovery: DiscoveryState | null): boolean {
  const db = discovery?.loaded?.database;
  if (!db) return false;
  if ((db.invoiceCount ?? 0) > 0) return true;
  if ((db.totalBusinessRecords ?? 0) > 0) return true;
  const counts = db.counts ?? {};
  return (
    (counts.custom_invoices ?? 0) > 0 ||
    (counts.proforma_invoices ?? 0) > 0 ||
    (counts.print_invoices ?? 0) > 0 ||
    (counts.customers ?? 0) > 0 ||
    (counts.orders ?? 0) > 0 ||
    (counts.customer_payments ?? 0) > 0 ||
    (counts.supplier_payments ?? 0) > 0 ||
    (counts.suppliers ?? 0) > 0 ||
    (counts.expenses ?? 0) > 0 ||
    (counts.official_letters ?? 0) > 0
  );
}

function hasLocalInitializedProfile(): boolean {
  return (
    hasCustomPassword() ||
    getStoredSync("future_print_onboarded", "") === "true" ||
    Boolean(getStoredSync("future_print_user_name", ""))
  );
}

function isPermanentlyDismissed(): boolean {
  if (typeof window === "undefined") return true;
  try {
    if (localStorage.getItem("ta_recovery_gate_dismissed") === "true") return true;
    // التطبيق تم فتحه واستخدامه مسبقاً بنجاح — لا تزعج المستخدم بشاشة الاستعادة عند كل تشغيل
    if (localStorage.getItem("ta_unlocked_at")) return true;
    if (sessionStorage.getItem("future_calc_unlocked") === "true") return true;
  } catch {
    return false;
  }
  return false;
}

/**
 * First-launch recovery discovery.
 *
 * Security invariant (SEC-08):
 * - Pre-authentication recovery ONLY runs on a genuinely fresh, empty database with NO user PIN.
 * - If a custom PIN or existing local records exist, unauthenticated users are NEVER shown backup
 *   counts and can NEVER overwrite the database before unlocking.
 * - Full restore is always accessible after authentication inside Settings > Backup Center.
 */
export function RecoveryDiscoveryGate({
  children,
  isAuthenticated = false,
}: {
  children: React.ReactNode;
  isAuthenticated?: boolean;
}) {
  const blockedPreAuth = !isAuthenticated && hasLocalInitializedProfile();
  const isAlreadyDismissed = isPermanentlyDismissed() || blockedPreAuth;
  const [checked, setChecked] = useState(
    isAlreadyDismissed || !Capacitor.isNativePlatform() || !isBackupEngineAvailable()
  );
  const [discovery, setDiscovery] = useState<DiscoveryState | null>(null);
  const [dismissed, setDismissed] = useState(isAlreadyDismissed);
  const [busy, setBusy] = useState<"restore" | "folder" | null>(null);

  useEffect(() => {
    if (isAlreadyDismissed) return;
    let cancelled = false;
    if (checked) return;
    (async () => {
      try {
        const result = await discoverForRecovery();
        if (cancelled) return;
        // Never allow pre-auth discovery to overwrite or leak data on an existing non-empty DB
        if (!isAuthenticated && hasExistingLocalDatabaseData(result)) {
          setDismissed(true);
          return;
        }
        setDiscovery(result);
      } catch (err) {
        console.warn("[Recovery] discovery failed:", err);
      } finally {
        if (!cancelled) setChecked(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [checked, isAlreadyDismissed, isAuthenticated]);

  if (blockedPreAuth) {
    return <>{children}</>;
  }

  if (!checked) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background text-primary" dir="rtl">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin" />
          <p className="text-xs font-bold text-muted-foreground">جاري البحث عن نسخ احتياطية سابقة…</p>
        </div>
      </div>
    );
  }

  const hasLocalData = hasExistingLocalDatabaseData(discovery);
  const newest = discovery?.decision?.newest ?? null;
  const needsReconnect = Boolean(discovery?.needsFolderReconnect);
  const showPrompt =
    !dismissed &&
    (isAuthenticated || (!hasLocalData && !hasLocalInitializedProfile())) &&
    (Boolean(newest && discovery?.decision?.shouldPrompt) || needsReconnect);

  const handleDismiss = async () => {
    setDismissed(true);
    try {
      if (typeof window !== "undefined") {
        localStorage.setItem("ta_recovery_gate_dismissed", "true");
        if (newest?.manifest?.backupId) {
          localStorage.setItem("ta_recovery_dismissed_backup", newest.manifest.backupId);
        }
      }
      await saveBackupSettings({
        dismissedRecoveryBackupId: newest?.manifest?.backupId || "all",
        onboardingCompletedAt: new Date().toISOString(),
      });
    } catch (err) {
      console.warn("[Recovery] dismissal persistence failed:", err);
    }
  };

  const handleRestore = async () => {
    if (!newest) return;
    if (!isAuthenticated && (hasLocalInitializedProfile() || hasExistingLocalDatabaseData(discovery))) {
      toast.error("يجب فتح قفل التطبيق أولاً قبل استعادة البيانات على قاعدة بيانات قائمة.");
      setDismissed(true);
      return;
    }
    playTapSound();
    setBusy("restore");
    try {
      const result = await restoreBackup(newest.fileName, "replace");
      if (result.ok) {
        playSuccessSound();
        toast.success("تمت استعادة بياناتك السابقة بنجاح.");
        if (typeof window !== "undefined") {
          localStorage.setItem("ta_recovery_gate_dismissed", "true");
        }
        await saveBackupSettings({ onboardingCompletedAt: new Date().toISOString() });
        setDismissed(true);
        window.location.hash = "#/";
      } else {
        toast.error(result.message || "تعذّرت الاستعادة، ولم تُمس بياناتك الحالية.");
      }
    } finally {
      setBusy(null);
    }
  };

  const handleReconnect = async () => {
    playTapSound();
    setBusy("folder");
    try {
      const result = await backupBridge.chooseFolder();
      if (result.ok) {
        await saveBackupSettings({ folderUri: result.folderUri ?? "", folderLabel: result.folderLabel ?? "" });
        const refreshed = await discoverForRecovery();
        setDiscovery(refreshed);
        toast.success("تم ربط المجلد — جاري البحث عن النسخ.");
      }
    } finally {
      setBusy(null);
    }
  };

  if (!showPrompt) return <>{children}</>;

  const manifest = newest?.manifest;

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-background px-4 py-8" dir="rtl">
      <div className="w-full max-w-md rounded-3xl border border-primary/20 bg-gradient-to-br from-card via-card to-primary/5 p-5 shadow-elegant space-y-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="grid h-10 w-10 place-items-center rounded-2xl bg-primary/10 text-primary border border-primary/20">
              <Database className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-sm font-black text-foreground">
                {needsReconnect && !newest ? "أعد ربط مجلد النسخ الاحتياطي" : "تم العثور على نسخة احتياطية سابقة"}
              </h1>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {needsReconnect && !newest
                  ? "بياناتك القديمة قد تكون موجودة، لكن التطبيق يحتاج إذن الوصول للمجلد مجدداً."
                  : "عثر التطبيق على بيانات محفوظة من إصدار سابق على هذا الجهاز."}
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="تخطي"
            onClick={handleDismiss}
            className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {needsReconnect && !newest && (
          <div className="space-y-3">
            <div className="rounded-2xl border border-border/60 bg-muted/30 p-3 text-xs">
              <p className="font-bold text-foreground">المجلد السابق المحفوظ</p>
              <p className="mt-1 text-muted-foreground" dir="ltr">
                {discovery?.preferredFolderLabel || "Documents/InvoiceBackups"}
              </p>
            </div>
            <Button
              type="button"
              onClick={handleReconnect}
              disabled={busy !== null}
              className="h-11 w-full rounded-2xl gap-2 text-xs font-black"
            >
              {busy === "folder" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderOpen className="h-4 w-4" />}
              اختيار المجلد واستعادة الوصول
            </Button>
            <p className="text-[10px] leading-relaxed text-muted-foreground">
              تبقى ملفاتك في المجلد نفسه بعد إعادة التثبيت — أندرويد لا يمنح التطبيق الجديد صلاحية الوصول تلقائياً.
            </p>
          </div>
        )}

        {newest && manifest && (
          <>
            <div className="space-y-2 rounded-2xl border border-border/60 bg-muted/20 p-3.5 text-xs">
              <RecoveryRow label="عدد الفواتير" value={`${manifest.invoiceCount} فاتورة`} strong />
              {(manifest.counts?.customers ?? 0) > 0 && (
                <RecoveryRow label="العملاء" value={`${manifest.counts.customers} عميل`} />
              )}
              {(manifest.counts?.official_letters ?? 0) > 0 && (
                <RecoveryRow label="الخطابات الرسمية" value={`${manifest.counts.official_letters} خطاب`} />
              )}
              {((manifest.counts?.customer_payments ?? 0) +
                (manifest.counts?.supplier_payments ?? 0) +
                (manifest.counts?.expenses ?? 0) +
                (manifest.counts?.suppliers ?? 0)) > 0 && (
                <RecoveryRow
                  label="السجلات المالية"
                  value={`${
                    (manifest.counts?.customer_payments ?? 0) +
                    (manifest.counts?.supplier_payments ?? 0) +
                    (manifest.counts?.expenses ?? 0) +
                    (manifest.counts?.suppliers ?? 0)
                  } سجل`}
                />
              )}
              <RecoveryRow label="آخر نسخة احتياطية" value={formatDateTime(manifest.createdAt)} />
              <RecoveryRow label="حجم النسخة" value={formatBytes(newest.sizeBytes)} />
              <RecoveryRow
                label="حالة النسخة"
                value={
                  <span className="flex items-center gap-1 font-bold text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    سليمة
                  </span>
                }
              />
              {manifest.encrypted && (
                <p className="flex items-center gap-1 rounded-lg bg-primary/5 p-2 text-[10px] text-primary">
                  <ShieldCheck className="h-3 w-3" /> نسخة مشفّرة — سيُستخدم مفتاح الجهاز لفك التشفير.
                </p>
              )}
            </div>

            {discovery?.decision?.corruptCount ? (
              <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-2.5">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
                <p className="text-[10px] leading-relaxed text-amber-700 dark:text-amber-300">
                  يوجد {discovery.decision.corruptCount} ملف نسخة غير سليم في المجلد — تم تجاهلها وتقديم أحدث نسخة سليمة.
                </p>
              </div>
            ) : null}

            <div className="rounded-xl bg-muted/40 p-3">
              <p className="text-xs font-black text-foreground">استعادة البيانات السابقة</p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                استعادة الفواتير والإعدادات والسجل إلى التطبيق الحالي. سيتم الاحتفاظ بنسخة أمان من أي بيانات موجودة الآن.
              </p>
            </div>

            <Button
              type="button"
              onClick={handleRestore}
              disabled={busy !== null}
              className="h-11 w-full rounded-2xl gap-2 text-xs font-black"
            >
              {busy === "restore" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
              استعادة البيانات السابقة
            </Button>

            <Button
              type="button"
              variant="ghost"
              onClick={handleDismiss}
              className="h-9 w-full rounded-xl text-[11px] font-bold text-muted-foreground"
            >
              البدء كتثبيت جديد بدون استعادة
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

function RecoveryRow({ label, value, strong }: { label: string; value: React.ReactNode; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className={strong ? "text-sm font-black text-foreground tabular-nums" : "font-bold text-foreground"}>{value}</span>
    </div>
  );
}
