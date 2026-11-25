import React from "react";
import {
  ShieldCheck,
  AlertTriangle,
  FolderOpen,
  Loader2,
  Calendar,
  Layers,
  HardDrive,
  RefreshCw,
  Clock,
  Lock,
  LockOpen,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useBackupDashboard } from "@/lib/backup/useBackupStatus";
import { countBusinessRecords, countInvoices } from "@/lib/backup/validation";
import {
  type BackupFileInfo,
  PROTECTION_META,
  formatBytes,
  formatDateTime,
  formatRelative,
} from "./types";

interface BackupStatusHeroProps {
  dashboard: ReturnType<typeof useBackupDashboard>;
  newestBackup: BackupFileInfo | null;
  busy: string | null;
  onChooseFolder: () => void;
  engineMissing: boolean;
}

export function BackupStatusHero({
  dashboard,
  newestBackup,
  busy,
  onChooseFolder,
  engineMissing,
}: BackupStatusHeroProps) {
  const protection =
    PROTECTION_META[dashboard.protection.status] ?? PROTECTION_META.unprotected;

  const lastBackupAt = dashboard.lastBackupAt ?? dashboard.settings.lastBackupAt;
  const manifestCounts = newestBackup?.manifest?.counts;
  const protectedRecords = newestBackup?.manifest
    ? newestBackup.manifest.totalBusinessRecords ??
      countBusinessRecords(manifestCounts)
    : 0;
  const liveRecords =
    dashboard.databaseBusinessRecordCount ??
    dashboard.database?.totalBusinessRecords ??
    countBusinessRecords(dashboard.database?.counts);

  const moduleBreakdown = manifestCounts
    ? [
        {
          key: "invoices",
          label: "الفواتير",
          count:
            newestBackup?.manifest?.invoiceCount ??
            countInvoices(manifestCounts),
        },
        {
          key: "customers",
          label: "العملاء",
          count: manifestCounts.customers ?? 0,
        },
        {
          key: "letters",
          label: "الخطابات",
          count: manifestCounts.official_letters ?? 0,
        },
        {
          key: "finance",
          label: "السندات والمصاريف",
          count:
            (manifestCounts.customer_payments ?? 0) +
            (manifestCounts.supplier_payments ?? 0) +
            (manifestCounts.expenses ?? 0),
        },
        {
          key: "suppliers",
          label: "الموردون",
          count: manifestCounts.suppliers ?? 0,
        },
        {
          key: "accounts",
          label: "الحسابات",
          count: manifestCounts.financial_accounts ?? 0,
        },
      ].filter((item) => item.count > 0)
    : [];

  const autoDaily = dashboard.settings.autoDaily;
  const afterTransaction = dashboard.settings.afterTransaction;
  const autoBackupLabel =
    autoDaily && afterTransaction
      ? "النسخ التلقائي: مفعّل (فوري + يومي)"
      : afterTransaction
      ? "النسخ التلقائي: فوري فقط"
      : autoDaily
      ? "النسخ التلقائي: يومي فقط"
      : "النسخ التلقائي: متوقف";
  const autoBackupActive = autoDaily || afterTransaction;

  const maxAgeDays = dashboard.settings.retention?.maxAgeDays ?? 30;
  const retentionLabel =
    maxAgeDays > 0
      ? `الاحتفاظ الذكي: آخر ${maxAgeDays} يوماً`
      : "الاحتفاظ الذكي: بلا حد زمني";

  const encryptionEnabled = dashboard.settings.encryptionEnabled;
  const encryptionLabel = encryptionEnabled
    ? "التشفير: مفعّل (AES-256)"
    : "التشفير: غير مفعّل";

  return (
    <div className="space-y-4">
      {/* Header bar */}
      <div className="flex items-start justify-between gap-3 border-b border-border/60 pb-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="grid h-10 w-10 place-items-center rounded-2xl bg-primary/10 text-primary border border-primary/20 shrink-0">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-black text-foreground truncate">
              حماية البيانات والنسخ الاحتياطي
            </h2>
            <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
              نسخ احتياطي مستقل ومشفّر معزول عن ذاكرة التطبيق
            </p>
          </div>
        </div>
        <span
          className={cn(
            "flex items-center gap-1.5 text-[10px] font-bold px-2.5 py-1 rounded-full border shrink-0",
            protection.tone
          )}
        >
          {dashboard.loading ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            protection.icon
          )}
          <span>{protection.label}</span>
        </span>
      </div>

      {engineMissing && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
          وحدة النسخ الاحتياطي الأصلية غير مثبّتة في هذه النسخة من التطبيق.
        </div>
      )}

      {dashboard.error && !engineMissing && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-300">
          {dashboard.error}
        </div>
      )}

      {/* Warning banner */}
      {dashboard.protection.status !== "protected" &&
        dashboard.protection.reason && (
          <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
            <p className="text-xs leading-relaxed text-amber-800 dark:text-amber-200">
              {dashboard.protection.reason}
            </p>
          </div>
        )}

      {/* Quick stats grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        <div className="rounded-xl border border-border/60 bg-muted/20 p-2.5 space-y-1">
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground font-bold">
            <Calendar className="h-3.5 w-3.5 text-primary" />
            <span>آخر نسخة مكتملة</span>
          </div>
          <p className="text-xs font-black text-foreground truncate">
            {formatRelative(lastBackupAt)}
          </p>
          <p className="text-[10px] text-muted-foreground font-mono truncate">
            {formatDateTime(lastBackupAt)}
          </p>
        </div>

        <div className="rounded-xl border border-border/60 bg-muted/20 p-2.5 space-y-1">
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground font-bold">
            <Layers className="h-3.5 w-3.5 text-primary" />
            <span>البيانات المؤمنة</span>
          </div>
          <p className="text-xs font-black text-foreground tabular-nums">
            {protectedRecords} سجل
          </p>
          <p className="text-[10px] text-muted-foreground font-medium tabular-nums">
            بالجهاز حالياً: {liveRecords} سجل
          </p>
        </div>

        <div className="col-span-2 sm:col-span-1 rounded-xl border border-border/60 bg-muted/20 p-2.5 space-y-1">
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground font-bold">
            <HardDrive className="h-3.5 w-3.5 text-primary" />
            <span>الأرشيف والمساحة</span>
          </div>
          <p className="text-xs font-black text-foreground">
            {dashboard.storage?.backupCount ?? 0} ملف محفوظة
          </p>
          <p className="text-[10px] text-muted-foreground font-mono">
            {formatBytes(dashboard.storage?.backupBytes)}
          </p>
        </div>
      </div>

      {/* Multi-module protected records breakdown */}
      {moduleBreakdown.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-border/50 bg-muted/15 px-2.5 py-2">
          <span className="text-[10px] font-bold text-muted-foreground ml-1">
            محتوى آخر نسخة:
          </span>
          {moduleBreakdown.map((item) => (
            <span
              key={item.key}
              className="inline-flex items-center gap-1 rounded-lg border border-border/60 bg-background/80 px-2 py-0.5 text-[10px] font-bold text-foreground tabular-nums"
            >
              <span className="text-muted-foreground">{item.label}:</span>
              <span className="text-primary font-black">{item.count}</span>
            </span>
          ))}
        </div>
      )}

      {/* Auto-Backup, Smart Retention & Encryption status pill row */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-bold",
            autoBackupActive
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
              : "border-border/70 bg-muted/40 text-muted-foreground"
          )}
        >
          <RefreshCw className="h-3 w-3 shrink-0" />
          <span>{autoBackupLabel}</span>
        </span>

        <span className="inline-flex items-center gap-1 rounded-full border border-primary/25 bg-primary/5 px-2.5 py-1 text-[10px] font-bold text-primary">
          <Clock className="h-3 w-3 shrink-0" />
          <span>{retentionLabel}</span>
        </span>

        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-bold",
            encryptionEnabled
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
              : "border-border/70 bg-muted/40 text-muted-foreground"
          )}
        >
          {encryptionEnabled ? (
            <Lock className="h-3 w-3 shrink-0" />
          ) : (
            <LockOpen className="h-3 w-3 shrink-0" />
          )}
          <span>{encryptionLabel}</span>
        </span>
      </div>

      {/* Folder location box */}
      <div className="rounded-xl border border-border/60 bg-muted/30 p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[11px] font-bold text-muted-foreground">
              مجلد حفظ النسخ الاحتياطية على الهاتف
            </p>
            <p
              className="text-xs font-black text-foreground truncate"
              dir="ltr"
            >
              {dashboard.storage?.folderLabel || "(لم يتم تحديد مجلد بعد)"}
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onChooseFolder}
            disabled={busy === "folder" || busy === "folder-backup"}
            className="shrink-0 h-9 rounded-xl gap-1.5 text-xs font-bold border-primary/30 text-primary hover:bg-primary/5 active:scale-95 touch-manipulation"
          >
            {busy === "folder" || busy === "folder-backup" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <FolderOpen className="h-3.5 w-3.5" />
            )}
            <span>{dashboard.storage?.folderUri ? "تغيير المجلد" : "تحديد مجلد"}</span>
          </Button>
        </div>

        {busy === "folder-backup" && (
          <div className="flex items-center gap-2 rounded-lg border border-primary/25 bg-primary/5 px-2.5 py-2 text-[11px] font-bold text-primary">
            <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
            <span>جاري إنشاء أول نسخة تلقائية وتفعيل الحماية...</span>
          </div>
        )}
      </div>
    </div>
  );
}
