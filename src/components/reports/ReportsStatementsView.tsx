import React from "react";
import { Users, Truck, FileText, Printer, Share2, ExternalLink } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { CustomerRecord } from "@/lib/customersStore";
import type { Supplier } from "@/lib/repositories/SupplierRepository";
import type { CustomerStatement, SupplierStatement } from "@/lib/repositories/ReportsRepository";
import { DEFAULT_CURRENCY, type AppCurrency } from "@/lib/currency/types";
import { getCurrencyShortLabel } from "@/lib/currency/currencyFormat";
import { CurrencySelector } from "@/components/currency/CurrencySelector";
import { formatNumber } from "@/lib/printCalculator";
import {
  printCustomerStatement,
  shareCustomerStatementViaWhatsApp,
} from "@/lib/customerStatementExport";
import { cn } from "@/lib/utils";

interface Props {
  customers: CustomerRecord[];
  suppliers: Supplier[];
  statementCustomerId: string | null;
  statementSupplierId: string | null;
  statement: CustomerStatement | null;
  supplierStatement: SupplierStatement | null;
  currency?: AppCurrency;
  onCurrencyChange?: (c: AppCurrency) => void;
  onSelectCustomer: (id: string | null) => void;
  onSelectSupplier: (id: string | null) => void;
}

export function ReportsStatementsView({
  customers,
  suppliers,
  statementCustomerId,
  statementSupplierId,
  statement,
  supplierStatement,
  currency = DEFAULT_CURRENCY,
  onCurrencyChange,
  onSelectCustomer,
  onSelectSupplier,
}: Props) {
  const curLabel = getCurrencyShortLabel(currency);
  const activeCustomer = statementCustomerId
    ? customers.find((c) => c.id === statementCustomerId)
    : undefined;

  return (
    <div className="space-y-3.5" dir="rtl">
      {onCurrencyChange && (
        <div className="flex items-center justify-between gap-2 rounded-2xl border border-border/80 bg-card p-3 shadow-2xs">
          <span className="text-xs font-black text-foreground">عملة كشوفات الحساب:</span>
          <CurrencySelector label="" dropdownTitle="اختر عملة كشف الحساب" value={currency} onChange={onCurrencyChange} locale="ar" />
        </div>
      )}

      {/* كشف حساب العميل */}
      <div className="rounded-2xl border border-border/80 bg-card p-3.5 sm:p-4 shadow-2xs space-y-3">
        <div className="flex items-center gap-1.5 border-b border-border/60 pb-2">
          <Users className="h-4 w-4 text-primary" />
          <div>
            <h3 className="text-xs sm:text-sm font-black text-foreground">كشف حساب عميل</h3>
            <p className="text-[10px] text-muted-foreground">
              اختر العميل لعرض جدول الحركات التفصيلي والرصيد الجاري
            </p>
          </div>
        </div>

        {customers.length === 0 ? (
          <p className="text-xs text-muted-foreground py-2 text-center">لا يوجد عملاء مسجلون حالياً.</p>
        ) : (
          <div className="flex flex-wrap gap-2 max-h-48 overflow-y-auto pr-1">
            {customers.map((c) => (
              <Button
                key={c.id}
                type="button"
                size="sm"
                variant={statementCustomerId === c.id ? "default" : "outline"}
                onClick={() => onSelectCustomer(c.id)}
                className="h-8 rounded-xl text-xs font-bold transition-all active:scale-95 touch-manipulation"
              >
                {c.name}
              </Button>
            ))}
          </div>
        )}
      </div>

      {/* كشف حساب المورد */}
      <div className="rounded-2xl border border-border/80 bg-card p-3.5 sm:p-4 shadow-2xs space-y-3">
        <div className="flex items-center gap-1.5 border-b border-border/60 pb-2">
          <Truck className="h-4 w-4 text-primary" />
          <div>
            <h3 className="text-xs sm:text-sm font-black text-foreground">كشف حساب مورد</h3>
            <p className="text-[10px] text-muted-foreground">
              اختر المورد للاطلاع على فواتير الشراء والدفعات والمستحقات
            </p>
          </div>
        </div>

        {suppliers.length === 0 ? (
          <p className="text-xs text-muted-foreground py-2 text-center">لا يوجد موردون مسجلون حالياً.</p>
        ) : (
          <div className="flex flex-wrap gap-2 max-h-48 overflow-y-auto pr-1">
            {suppliers.map((s) => (
              <Button
                key={s.id}
                type="button"
                size="sm"
                variant={statementSupplierId === s.id ? "default" : "outline"}
                onClick={() => onSelectSupplier(s.id)}
                className="h-8 rounded-xl text-xs font-bold transition-all active:scale-95 touch-manipulation"
              >
                {s.name}
              </Button>
            ))}
          </div>
        )}
      </div>

      {/* نافذة كشف العميل */}
      <StatementModal
        open={Boolean(statementCustomerId)}
        onOpenChange={(open) => !open && onSelectCustomer(null)}
        title={`كشف حساب: ${statement?.customerName ?? ""}`}
        currency={currency}
        onCurrencyChange={onCurrencyChange}
        currencyLabel={curLabel}
        lines={statement?.lines ?? []}
        summary={[
          { label: "إجمالي الفواتير", value: statement?.totalInvoiced ?? 0 },
          { label: "إجمالي التحصيل", value: statement?.totalCollected ?? 0 },
          { label: "الرصيد المتبقي", value: statement?.netBalance ?? statement?.outstanding ?? 0 },
        ]}
        onPrint={
          statement && activeCustomer
            ? () => {
                void printCustomerStatement(statement, activeCustomer, currency);
              }
            : undefined
        }
        onShare={
          statement && activeCustomer
            ? () => {
                void shareCustomerStatementViaWhatsApp(statement, activeCustomer, currency);
              }
            : undefined
        }
        workspaceLink={
          statementCustomerId
            ? { label: "ملف العميل", to: "/customers", search: { id: statementCustomerId } }
            : undefined
        }
      />

      {/* نافذة كشف المورد */}
      <StatementModal
        open={Boolean(statementSupplierId)}
        onOpenChange={(open) => !open && onSelectSupplier(null)}
        title={`كشف حساب المورد: ${supplierStatement?.supplierName ?? ""}`}
        currency={currency}
        onCurrencyChange={onCurrencyChange}
        currencyLabel={curLabel}
        lines={supplierStatement?.lines ?? []}
        summary={[
          { label: "إجمالي المشتريات", value: supplierStatement?.totalPurchased ?? 0 },
          { label: "إجمالي المدفوع", value: supplierStatement?.totalPaid ?? 0 },
          { label: "المستحق القائم", value: supplierStatement?.netBalance ?? supplierStatement?.outstanding ?? 0 },
        ]}
        workspaceLink={{ label: "صفحة الموردين", to: "/suppliers" }}
      />
    </div>
  );
}

function StatementModal({
  open,
  onOpenChange,
  title,
  currency = DEFAULT_CURRENCY,
  onCurrencyChange,
  currencyLabel,
  lines,
  summary,
  onPrint,
  onShare,
  workspaceLink,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  currency?: AppCurrency;
  onCurrencyChange?: (c: AppCurrency) => void;
  currencyLabel: string;
  lines: {
    id: string;
    kind: string;
    reference: string;
    date: string;
    label: string;
    debit: number;
    credit: number;
    runningBalance: number;
  }[];
  summary: { label: string; value: number }[];
  onPrint?: () => void;
  onShare?: () => void;
  workspaceLink?: { label: string; to: "/customers" | "/suppliers"; search?: { id: string } };
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-md max-h-[85vh] overflow-y-auto rounded-3xl p-4 sm:p-6">
        <DialogHeader className="border-b border-border/60 pb-2">
          <DialogTitle className="text-sm font-black flex items-center gap-1.5">
            <FileText className="h-4 w-4 text-primary" />
            {title}
          </DialogTitle>
        </DialogHeader>

        {onCurrencyChange && (
          <div className="flex items-center justify-between gap-2 rounded-xl border border-border/60 bg-muted/20 px-3 py-1.5">
            <span className="text-[11px] font-black text-foreground">عملة الكشف:</span>
            <CurrencySelector
              label=""
              dropdownTitle="اختر عملة كشف الحساب"
              value={currency}
              onChange={onCurrencyChange}
              locale="ar"
            />
          </div>
        )}

        {(onPrint || onShare || workspaceLink) && (
          <div className="flex items-center gap-2 flex-wrap">
            {onPrint && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={onPrint}
                className="h-8 rounded-xl gap-1.5 text-[11px] font-black"
              >
                <Printer className="h-3.5 w-3.5 text-primary" />
                <span>طباعة A4</span>
              </Button>
            )}
            {onShare && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={onShare}
                className="h-8 rounded-xl gap-1.5 text-[11px] font-black text-emerald-600 dark:text-emerald-400"
              >
                <Share2 className="h-3.5 w-3.5" />
                <span>واتساب PDF</span>
              </Button>
            )}
            {workspaceLink && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                asChild
                className="h-8 rounded-xl gap-1.5 text-[11px] font-black ms-auto"
              >
                <Link to={workspaceLink.to} search={workspaceLink.search} onClick={() => onOpenChange(false)}>
                  <ExternalLink className="h-3.5 w-3.5" />
                  <span>{workspaceLink.label}</span>
                </Link>
              </Button>
            )}
          </div>
        )}

        <div className="grid grid-cols-3 gap-2 my-2">
          {summary.map((row) => (
            <div
              key={row.label}
              className="rounded-xl border border-border/70 bg-muted/30 p-2 text-center"
            >
              <p className="text-[10px] text-muted-foreground">{row.label}</p>
              <p className="text-xs font-black tabular-nums text-foreground">
                {formatNumber(row.value)} {currencyLabel}
              </p>
            </div>
          ))}
        </div>

        {lines.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">لا توجد حركات مسجلة لهذا الحساب.</p>
        ) : (
          <div className="space-y-1.5 max-h-80 overflow-y-auto pr-1">
            {lines.map((line) => (
              <div
                key={`${line.kind}-${line.id}`}
                className="flex items-center justify-between gap-2 rounded-xl bg-card border border-border/60 p-2.5 text-xs shadow-2xs"
              >
                <div className="min-w-0">
                  <p className="truncate font-mono text-[11px] font-black text-foreground" dir="ltr">
                    {line.reference || "—"}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    {line.date} · {line.label}
                  </p>
                </div>
                <div className="shrink-0 text-left">
                  <p
                    className={cn(
                      "font-black tabular-nums",
                      line.debit > 0 ? "text-foreground" : "text-emerald-600 dark:text-emerald-400"
                    )}
                  >
                    {line.debit > 0 ? `+${formatNumber(line.debit)}` : `-${formatNumber(line.credit)}`}{" "}
                    {currencyLabel}
                  </p>
                  <p className="text-[9.5px] text-muted-foreground tabular-nums">
                    رصيد: {formatNumber(line.runningBalance)} {currencyLabel}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
