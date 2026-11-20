import React from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle, CheckCircle2, ChevronDown, Info, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { countBusinessRecords, countInvoices } from "@/lib/backup/validation";
import type { TableCounts } from "@/lib/backup/types";
import {
  type BackupFileInfo,
  type RestoreResult,
  formatDateTime,
} from "./types";

interface BackupModulePillsProps {
  counts?: TableCounts | null;
  invoiceCount?: number;
  className?: string;
}

export function BackupModulePills({
  counts,
  invoiceCount,
  className,
}: BackupModulePillsProps) {
  if (!counts) return null;
  const invoices = invoiceCount ?? countInvoices(counts);
  const vouchers =
    (counts.customer_payments ?? 0) + (counts.supplier_payments ?? 0);

  const items = [
    { key: "invoices", label: "الفواتير", value: invoices },
    { key: "customers", label: "العملاء", value: counts.customers ?? 0 },
    {
      key: "letters",
      label: "الخطابات الرسمية",
      value: counts.official_letters ?? 0,
    },
    { key: "vouchers", label: "السندات", value: vouchers },
    { key: "expenses", label: "المصاريف", value: counts.expenses ?? 0 },
    { key: "suppliers", label: "الموردون", value: counts.suppliers ?? 0 },
    { key: "orders", label: "الطلبات", value: counts.orders ?? 0 },
  ].filter((i) => i.value > 0);

  if (items.length === 0) return null;

  return (
    <div className={cn("flex flex-wrap items-center gap-1", className)}>
      {items.map((item) => (
        <span
          key={item.key}
          className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-background/80 px-1.5 py-0.5 text-[10px] font-bold text-foreground tabular-nums"
        >
          <span className="text-muted-foreground">{item.label}:</span>
          <span className="font-black text-primary">{item.value}</span>
        </span>
      ))}
    </div>
  );
}

interface RestoreSuccessViewProps {
  successResult: RestoreResult;
  onCloseSuccess: () => void;
}

function describeSkippedSafetyReason(reason: string): string {
  switch (reason) {
    case "empty-database":
      return "تم تخطي نسخة الأمان المسبقة لأن قاعدة البيانات الحالية كانت فارغة.";
    case "live-db-corrupt":
      return "كانت قاعدة البيانات السابقة تالفة فتعذّر نسخها كأرشيف قياسي، وتم حفظ نسخة خام إنقاذية منها قبل الاستبدال.";
    default:
      return `تم تخطي نسخة الأمان المسبقة (${reason}).`;
  }
}

export function RestoreSuccessView({
  successResult,
  onCloseSuccess,
}: RestoreSuccessViewProps) {
  const c = successResult.counts || {};
  const vouchers = (c.customer_payments ?? 0) + (c.supplier_payments ?? 0);

  const detailRows: { label: string; value: number; alwaysShow?: boolean }[] = [
    { label: "الفواتير المخصصة", value: c.custom_invoices ?? 0, alwaysShow: true },
    { label: "العروض المبدئية", value: c.proforma_invoices ?? 0, alwaysShow: true },
    { label: "فواتير الحاسبة", value: c.print_invoices ?? 0 },
    { label: "العملاء", value: c.customers ?? 0 },
    { label: "الخطابات الرسمية", value: c.official_letters ?? 0 },
    { label: "السندات والمدفوعات", value: vouchers },
    { label: "المصاريف", value: c.expenses ?? 0 },
    { label: "الموردون", value: c.suppliers ?? 0 },
    { label: "الطلبات", value: c.orders ?? 0 },
  ].filter((r) => r.alwaysShow || r.value > 0);

  return (
    <div className="py-4 space-y-4 text-center">
      <div className="mx-auto grid h-16 w-16 place-items-center rounded-3xl bg-emerald-500/15 text-emerald-600 border border-emerald-500/30">
        <CheckCircle2 className="h-8 w-8" />
      </div>
      <div className="space-y-1">
        <h3 className="text-base font-black text-foreground">
          تمت استعادة البيانات بنجاح!
        </h3>
        <p className="text-xs text-muted-foreground">
          تم تحديث جميع السجلات والفواتير والخطابات المحفوظة في قاعدة البيانات.
        </p>
      </div>

      <div className="rounded-2xl border border-border/80 bg-muted/30 p-3 text-xs space-y-1.5 text-right font-medium">
        {detailRows.map((row) => (
          <div key={row.label} className="flex justify-between">
            <span className="text-muted-foreground">{row.label}:</span>
            <span className="font-bold text-foreground font-mono tabular-nums">
              {row.value}
            </span>
          </div>
        ))}

        {successResult.safetyBackupId ? (
          <p className="text-[11px] text-emerald-700 dark:text-emerald-300 pt-1.5 border-t border-border/40 font-bold">
            ✓ تم حفظ نسخة أمان تلقائية للبيانات السابقة قبل التطبيق.
          </p>
        ) : successResult.safetyBackupSkippedReason ? (
          <div
            className={cn(
              "flex items-start gap-1.5 pt-1.5 border-t border-border/40 text-[11px] font-bold leading-relaxed",
              successResult.safetyBackupSkippedReason === "live-db-corrupt"
                ? "text-amber-700 dark:text-amber-300"
                : "text-muted-foreground"
            )}
          >
            {successResult.safetyBackupSkippedReason === "live-db-corrupt" ? (
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            ) : (
              <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            )}
            <span>
              {describeSkippedSafetyReason(successResult.safetyBackupSkippedReason)}
            </span>
          </div>
        ) : null}
      </div>

      <Button
        type="button"
        onClick={onCloseSuccess}
        className="w-full h-11 rounded-2xl font-black text-xs bg-primary text-primary-foreground shadow-sm active:scale-[0.98] touch-manipulation"
      >
        إتمام والعودة للتطبيق
      </Button>
    </div>
  );
}

interface RestoreArchiveSelectorProps {
  backups: BackupFileInfo[];
  selectedFile: BackupFileInfo | null;
  showOtherBackups: boolean;
  onToggleShowOther: () => void;
  onSelectFile: (file: BackupFileInfo) => void;
}

export function RestoreArchiveSelector({
  backups,
  selectedFile,
  showOtherBackups,
  onToggleShowOther,
  onSelectFile,
}: RestoreArchiveSelectorProps) {
  if (backups.length <= 1) return null;

  return (
    <div className="space-y-1.5">
      <button
        type="button"
        onClick={onToggleShowOther}
        className="flex items-center justify-between w-full text-xs font-bold text-primary hover:underline px-1 py-0.5"
      >
        <span className="flex items-center gap-1">
          <span>اختيار نسخة أخرى من الأرشيف ({backups.length} نسخة متوفرة)</span>
        </span>
        <ChevronDown
          className={cn(
            "h-4 w-4 transition-transform duration-200",
            showOtherBackups ? "rotate-180" : ""
          )}
        />
      </button>

      {showOtherBackups && (
        <div className="rounded-2xl border border-border/80 bg-muted/30 p-2 space-y-1 max-h-48 overflow-y-auto">
          {backups.map((b) => {
            const totalRecords = b.manifest
              ? b.manifest.totalBusinessRecords ??
                countBusinessRecords(b.manifest.counts)
              : 0;
            const invCount =
              b.manifest?.invoiceCount ?? countInvoices(b.manifest?.counts);
            const isSelected = selectedFile?.fileName === b.fileName;
            return (
              <button
                key={b.fileName}
                type="button"
                onClick={() => onSelectFile(b)}
                className={cn(
                  "w-full text-right p-2 rounded-xl text-xs flex items-center justify-between transition-colors",
                  isSelected
                    ? "bg-primary text-primary-foreground font-black"
                    : "hover:bg-muted text-foreground font-medium"
                )}
              >
                <div className="min-w-0 flex-1 truncate pl-2">
                  <p className="truncate text-xs font-bold">
                    {formatDateTime(b.manifest?.createdAt)}
                  </p>
                  <p className="text-[10px] opacity-80" dir="ltr">
                    {b.fileName}
                  </p>
                </div>
                {b.status === "encrypted" ? (
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold shrink-0">
                    <Lock className="h-3 w-3" />
                    مشفّرة
                  </span>
                ) : (
                  <span className="text-[10px] font-mono shrink-0">
                    {totalRecords > invCount
                      ? `${totalRecords} سجل`
                      : `${invCount} فاتورة`}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

