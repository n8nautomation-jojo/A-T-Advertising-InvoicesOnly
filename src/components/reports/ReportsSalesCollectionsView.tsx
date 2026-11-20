import React from "react";
import { Receipt, Wallet, AlertCircle, CheckCircle2, User } from "lucide-react";
import type {
  SalesPerformance,
  CustomerCollectionsReport,
} from "@/lib/repositories/ReportsRepository";
import { formatNumber } from "@/lib/printCalculator";
import { cn } from "@/lib/utils";
import { DEFAULT_CURRENCY, SUPPORTED_CURRENCIES, type AppCurrency } from "@/lib/currency/types";

interface Props {
  type: "sales" | "collections";
  sales: SalesPerformance | null;
  collections: CustomerCollectionsReport | null;
  currency?: AppCurrency;
}

export function ReportsSalesCollectionsView({
  type,
  sales,
  collections,
  currency = DEFAULT_CURRENCY,
}: Props) {
  const curLabel = currency === "SDG" ? "ج.س" : SUPPORTED_CURRENCIES[currency]?.symbol ?? currency;
  const money = (val: number | undefined) => `${formatNumber(Number(val) || 0)} ${curLabel}`;

  if (type === "sales") {
    return (
      <div className="space-y-3.5" dir="rtl">
        {/* بطاقات الإحصائيات الثلاثية */}
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-2xl border border-border/80 bg-card p-3 text-center shadow-2xs space-y-1">
            <p className="text-[10px] font-bold text-muted-foreground">عدد الفواتير</p>
            <p className="text-base sm:text-lg font-black text-foreground tabular-nums">
              {sales?.invoiceCount ?? 0}
            </p>
          </div>
          <div className="rounded-2xl border border-primary/30 bg-primary/5 p-3 text-center shadow-2xs space-y-1">
            <p className="text-[10px] font-bold text-primary">إجمالي المبيعات</p>
            <p className="text-xs sm:text-sm font-black text-primary tabular-nums">
              {money(sales?.totalSales)}
            </p>
          </div>
          <div className="rounded-2xl border border-border/80 bg-card p-3 text-center shadow-2xs space-y-1">
            <p className="text-[10px] font-bold text-muted-foreground">متوسط الفاتورة</p>
            <p className="text-xs sm:text-sm font-black text-foreground tabular-nums">
              {money(sales?.averageInvoice)}
            </p>
          </div>
        </div>

        {/* المبيعات حسب العميل */}
        <div className="rounded-2xl border border-border/80 bg-card p-3.5 sm:p-4 shadow-2xs space-y-2.5">
          <div className="flex items-center gap-1.5">
            <User className="h-4 w-4 text-primary" />
            <h3 className="text-xs font-black text-foreground">المبيعات حسب العميل</h3>
          </div>

          {!sales?.byCustomer?.length ? (
            <p className="py-3 text-center text-xs text-muted-foreground">لا توجد بيانات عملاء في هذه الفترة.</p>
          ) : (
            <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
              {sales.byCustomer.map((row) => (
                <div
                  key={row.name}
                  className="flex items-center justify-between rounded-xl bg-muted/30 p-2 text-xs border border-border/40"
                >
                  <span className="font-bold text-foreground">
                    {row.name}{" "}
                    <span className="text-[10px] text-muted-foreground">({row.count} فواتير)</span>
                  </span>
                  <span className="font-black tabular-nums text-foreground">{money(row.total)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* فواتير المبيعات الفردية */}
        <div className="rounded-2xl border border-border/80 bg-card p-3.5 sm:p-4 shadow-2xs space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Receipt className="h-4 w-4 text-primary" />
              <h3 className="text-xs font-black text-foreground">سجل الفواتير (تتبع مباشر)</h3>
            </div>
            <span className="text-[10px] font-bold text-muted-foreground">
              {sales?.invoices?.length || 0} فاتورة
            </span>
          </div>

          {!sales?.invoices?.length ? (
            <p className="py-3 text-center text-xs text-muted-foreground">لا توجد فواتير مصدرة في هذه الفترة.</p>
          ) : (
            <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
              {sales.invoices.slice(0, 40).map((inv) => (
                <div
                  key={inv.id}
                  className="flex items-center justify-between rounded-xl bg-muted/30 p-2 text-xs border border-border/40"
                >
                  <div className="min-w-0">
                    <p className="font-mono text-[11px] font-bold text-foreground" dir="ltr">
                      {inv.reference}
                    </p>
                    <p className="text-[10px] text-muted-foreground truncate">
                      {inv.date} · {inv.customerName}
                    </p>
                  </div>
                  <span className="shrink-0 font-black tabular-nums text-foreground">
                    {money(inv.total)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Collections view
  return (
    <div className="space-y-3.5" dir="rtl">
      {/* إحصائيات التحصيل الثلاثية */}
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-3 text-center shadow-2xs space-y-1">
          <p className="text-[10px] font-bold text-emerald-700 dark:text-emerald-300">محصل في الفترة</p>
          <p className="text-xs sm:text-sm font-black text-emerald-700 dark:text-emerald-300 tabular-nums">
            {money(collections?.collectedTotal)}
          </p>
        </div>
        <div className="rounded-2xl border border-border/80 bg-card p-3 text-center shadow-2xs space-y-1">
          <p className="text-[10px] font-bold text-muted-foreground">ذمم قائمة</p>
          <p className="text-xs sm:text-sm font-black text-foreground tabular-nums">
            {money(collections?.outstandingTotal)}
          </p>
        </div>
        <div className="rounded-2xl border border-rose-500/30 bg-rose-500/5 p-3 text-center shadow-2xs space-y-1">
          <p className="text-[10px] font-bold text-rose-700 dark:text-rose-300">منها متأخرة</p>
          <p className="text-xs sm:text-sm font-black text-rose-700 dark:text-rose-300 tabular-nums">
            {money(collections?.overdueTotal)}
          </p>
        </div>
      </div>

      {/* دفعات محصلة */}
      <div className="rounded-2xl border border-border/80 bg-card p-3.5 sm:p-4 shadow-2xs space-y-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            <h3 className="text-xs font-black text-foreground">دفعات محصلة من العملاء</h3>
          </div>
          <span className="text-[10px] font-bold text-muted-foreground">
            {collections?.payments?.length || 0} دفعة
          </span>
        </div>

        {!collections?.payments?.length ? (
          <p className="py-3 text-center text-xs text-muted-foreground">لا توجد دفعات محصلة في هذه الفترة.</p>
        ) : (
          <div className="space-y-1.5 max-h-60 overflow-y-auto pr-1">
            {collections.payments.map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between rounded-xl bg-muted/30 p-2 text-xs border border-border/40"
              >
                <div className="min-w-0">
                  <p className="font-bold text-foreground text-[11px] truncate">{p.customerName}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {p.date} · مرجع: <span className="font-mono" dir="ltr">{p.reference}</span>
                  </p>
                </div>
                <span className="shrink-0 font-black tabular-nums text-emerald-600 dark:text-emerald-400">
                  +{formatNumber(p.amount)} {curLabel}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* فواتير بأرصدة قائمة */}
      <div className="rounded-2xl border border-border/80 bg-card p-3.5 sm:p-4 shadow-2xs space-y-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            <h3 className="text-xs font-black text-foreground">فواتير بأرصدة قائمة ومستحقة</h3>
          </div>
          <span className="text-[10px] font-bold text-muted-foreground">
            {collections?.openInvoices?.length || 0} فاتورة
          </span>
        </div>

        {!collections?.openInvoices?.length ? (
          <p className="py-3 text-center text-xs text-muted-foreground">لا توجد فواتير ذات أرصدة معلقة. جميع الحسابات مسواة.</p>
        ) : (
          <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
            {collections.openInvoices.map((inv) => (
              <div
                key={inv.id}
                className={cn(
                  "flex items-center justify-between rounded-xl p-2 text-xs border",
                  inv.overdue
                    ? "bg-rose-500/5 border-rose-500/30"
                    : "bg-muted/30 border-border/40"
                )}
              >
                <div className="min-w-0">
                  <p className="font-bold text-foreground text-[11px] truncate">
                    {inv.customerName}
                    {inv.overdue && (
                      <span className="mr-1.5 rounded-md bg-rose-500/10 px-1 py-0.5 text-[9px] font-black text-rose-600">
                        متأخرة
                      </span>
                    )}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    مرجع: <span className="font-mono" dir="ltr">{inv.reference}</span>
                  </p>
                </div>
                <span
                  className={cn(
                    "shrink-0 font-black tabular-nums",
                    inv.overdue ? "text-rose-600 dark:text-rose-400" : "text-amber-600 dark:text-amber-400"
                  )}
                >
                  {formatNumber(inv.settlement.outstanding)} {curLabel}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
