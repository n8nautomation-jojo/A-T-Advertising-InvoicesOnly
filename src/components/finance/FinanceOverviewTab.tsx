import React from "react";
import { Plus, Receipt, TrendingUp, Wallet } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import type { CompanyProfitability } from "@/lib/domain/finance";
import type {
  OpenSalesInvoiceRow,
  PayablesSummary,
  ReceivablesSummary,
} from "@/lib/repositories/LedgerRepository";
import { formatNumber } from "@/lib/printCalculator";
import { getCurrencyShortLabel } from "@/lib/currency/currencyFormat";
import { Card, Row } from "./FinancePrimitives";

interface FinanceOverviewTabProps {
  profitability: CompanyProfitability | null;
  receivables: ReceivablesSummary | null;
  payables: PayablesSummary | null;
  openInvoices: OpenSalesInvoiceRow[];
  currencyLabel?: string;
  onOpenReceiptDialog: (invoiceId: string | null) => void;
  onOpenSupplierDialog: () => void;
}

export function FinanceOverviewTab({
  profitability,
  receivables,
  payables,
  openInvoices,
  currencyLabel = getCurrencyShortLabel("SDG"),
  onOpenReceiptDialog,
  onOpenSupplierDialog,
}: FinanceOverviewTabProps) {
  const fmt = (n: number) => `${formatNumber(n)} ${currencyLabel}`;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      <Card title={`الربحية (مسجّلة · ${currencyLabel})`} icon={<TrendingUp className="h-3.5 w-3.5 text-primary" />}>
        <Row label="الإيراد المُفوتر" value={fmt(profitability?.revenue ?? 0)} />
        <Row label="تكاليف مباشرة" value={fmt(profitability?.directCosts ?? 0)} />
        <Row label="هامش إجمالي" value={fmt(profitability?.grossMargin ?? 0)} strong />
        <Row label="مصروفات تشغيلية" value={fmt(profitability?.operatingExpenses ?? 0)} />
        <Row label="صافي الربح" value={fmt(profitability?.netProfit ?? 0)} strong />
        <p className="pt-1.5 text-[10.5px] leading-relaxed text-muted-foreground">
          الإيراد هو قيمة الفواتير الصادرة، وليس نقداً محصّلاً. النقد الفعلي المتاح أعلاه هو السيولة الجاهزة.
        </p>
      </Card>

      <Card title={`التحصيل والالتزامات (${currencyLabel})`} icon={<Wallet className="h-3.5 w-3.5 text-primary" />}>
        <Row label="مُفوتر للعملاء" value={fmt(receivables?.invoiced ?? 0)} />
        <Row label="محصّل فعلاً" value={fmt(receivables?.collected ?? 0)} />
        <Row label="متبقي على العملاء" value={fmt(receivables?.outstanding ?? 0)} strong />
        <Row label="فواتير متأخرة" value={String(receivables?.overdueCount ?? 0)} />
        <Row label="مشتريات الموردين" value={fmt(payables?.purchased ?? 0)} />
        <Row label="مدفوع للموردين" value={fmt(payables?.paid ?? 0)} />
        <Row label="مستحق للموردين" value={fmt(payables?.outstanding ?? 0)} strong />
        <div className="pt-2.5 flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            onClick={() => onOpenReceiptDialog(null)}
            className="flex-1 h-8 rounded-xl text-[11px] font-black"
          >
            تحصيل من عميل
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onOpenSupplierDialog}
            className="flex-1 h-8 rounded-xl text-[11px] font-black"
          >
            سداد لمورد
          </Button>
        </div>
      </Card>

      <div className="md:col-span-2 surface-panel space-y-2.5">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <p className="surface-panel-title">
            <Receipt className="h-3.5 w-3.5 text-primary" />
            فواتير المبيعات بانتظار التحصيل ({openInvoices.length})
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => onOpenReceiptDialog(null)}
            className="h-7 rounded-lg text-[10.5px] font-black gap-1"
          >
            <Plus className="h-3 w-3" />
            تحصيل دفعة جديدة
          </Button>
        </div>
        {openInvoices.length === 0 ? (
          <p className="text-xs font-bold text-muted-foreground py-2">
            لا توجد فواتير مبيعات مفتوحة بهذه العملة حالياً — يمكنك تحصيل دفعة مقدّمة من أي عميل.
          </p>
        ) : (
          <div className="divide-y divide-border/50 rounded-xl border border-border/60 bg-card overflow-hidden">
            {openInvoices.slice(0, 12).map((inv) => {
              const invCurLabel = inv.currency
                ? getCurrencyShortLabel(inv.currency)
                : currencyLabel;
              return (
                <div
                  key={inv.id}
                  className="flex items-center justify-between gap-2.5 p-3 text-right hover:bg-muted/20 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-black text-foreground truncate">
                      <span className="font-mono text-primary" dir="ltr">
                        {inv.reference || "—"}
                      </span>
                      <span className="mx-1.5 text-muted-foreground">·</span>
                      {inv.customerId ? (
                        <Link
                          to="/customers"
                          search={{ id: inv.customerId }}
                          className="hover:text-primary hover:underline transition-colors"
                        >
                          {inv.customerName || "عميل غير محدد"}
                        </Link>
                      ) : (
                        <span>{inv.customerName || "عميل غير محدد"}</span>
                      )}
                    </p>
                    <p className="text-[10.5px] text-muted-foreground mt-0.5">
                      {inv.date} · مدفوع {formatNumber(inv.settlement.paid)} من {formatNumber(inv.settlement.total)}{" "}
                      {invCurLabel}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="text-left">
                      <span className="font-mono text-xs font-black text-amber-600 dark:text-amber-400 tabular-nums">
                        {formatNumber(inv.settlement.outstanding)} {invCurLabel}
                      </span>
                      <p className="text-[9.5px] text-muted-foreground">متبقي</p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => onOpenReceiptDialog(inv.id)}
                      className="h-8 rounded-lg px-3 text-[11px] font-black gap-1"
                    >
                      <Receipt className="h-3 w-3" />
                      تحصيل
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
