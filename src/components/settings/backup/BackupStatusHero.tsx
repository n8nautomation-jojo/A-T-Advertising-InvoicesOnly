import React from "react";
import {
  ShieldCheck,
  AlertTriangle,
  FolderOpen,
  Loader2,
  Calendar,
  Layers,
  HardDrive,
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
            disabled={busy === "folder"}
            className="shrink-0 h-9 rounded-xl gap-1.5 text-xs font-bold border-primary/30 text-primary hover:bg-primary/5 active:scale-95 touch-manipulation"
          >
            {busy === "folder" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <FolderOpen className="h-3.5 w-3.5" />
            )}
            <span>{dashboard.storage?.folderUri ? "تغيير المجلد" : "تحديد مجلد"}</span>
          </Button>
        </div>
      </div>
    </div>
  );
}
