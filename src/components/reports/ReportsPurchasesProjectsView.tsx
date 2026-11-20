import React from "react";
import { Truck, ArrowLeftRight, CreditCard, DollarSign } from "lucide-react";
import type {
  PurchasesReport,
  CashMovementReport,
} from "@/lib/repositories/ReportsRepository";
import { formatNumber } from "@/lib/printCalculator";
import { cn } from "@/lib/utils";
import { DEFAULT_CURRENCY, SUPPORTED_CURRENCIES, type AppCurrency } from "@/lib/currency/types";

interface Props {
  type: "purchases" | "cash";
  purchases: PurchasesReport | null;
  cash: CashMovementReport | null;
  currency?: AppCurrency;
}

export function ReportsPurchasesProjectsView({
  type,
  purchases,
  cash,
  currency = DEFAULT_CURRENCY,
}: Props) {
  const curLabel = currency === "SDG" ? "ج.س" : SUPPORTED_CURRENCIES[currency]?.symbol ?? currency;
  const money = (val: number | undefined) => `${formatNumber(Number(val) || 0)} ${curLabel}`;

  if (type === "purchases") {
    return (
      <div className="space-y-3.5" dir="rtl">
        {/* إحصائيات المشتريات الثلاثية */}
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-2xl border border-border/80 bg-card p-3 text-center shadow-2xs space-y-1">
            <p className="text-[10px] font-bold text-muted-foreground">فواتير الشراء</p>
            <p className="text-xs sm:text-sm font-black text-foreground tabular-nums">
              {money(purchases?.purchaseTotal)}
            </p>
          </div>
          <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-3 text-center shadow-2xs space-y-1">
            <p className="text-[10px] font-bold text-emerald-700 dark:text-emerald-300">مدفوع للموردين</p>
            <p className="text-xs sm:text-sm font-black text-emerald-700 dark:text-emerald-300 tabular-nums">
              {money(purchases?.paidTotal)}
            </p>
          </div>
          <div className="rounded-2xl border border-rose-500/30 bg-rose-500/5 p-3 text-center shadow-2xs space-y-1">
            <p className="text-[10px] font-bold text-rose-700 dark:text-rose-300">مستحق للموردين</p>
            <p className="text-xs sm:text-sm font-black text-rose-700 dark:text-rose-300 tabular-nums">
              {money(purchases?.outstandingTotal)}
            </p>
          </div>
        </div>

        {/* فواتير الشراء */}
        <div className="rounded-2xl border border-border/80 bg-card p-3.5 sm:p-4 shadow-2xs space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Truck className="h-4 w-4 text-primary" />
              <h3 className="text-xs font-black text-foreground">فواتير الشراء والتوريد</h3>
            </div>
            <span className="text-[10px] font-bold text-muted-foreground">
              {purchases?.purchases?.length || 0} فاتورة
            </span>
          </div>

          {!purchases?.purchases?.length ? (
            <p className="py-3 text-center text-xs text-muted-foreground">لا توجد فواتير شراء في هذه الفترة.</p>
          ) : (
            <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
              {purchases.purchases.map((row) => (
                <div
                  key={row.id}
                  className="flex items-center justify-between rounded-xl bg-muted/30 p-2 text-xs border border-border/40"
                >
                  <div className="min-w-0">
                    <p className="font-bold text-foreground text-[11px] truncate">
                      {row.supplierName}
                      {row.supplierInvoiceNumber && (
                        <span className="mr-1 text-[9.5px] text-muted-foreground">
                          (رقم: {row.supplierInvoiceNumber})
                        </span>
                      )}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      مرجع: <span className="font-mono" dir="ltr">{row.reference}</span>
                    </p>
                  </div>
                  <span
                    className={cn(
                      "shrink-0 font-black tabular-nums",
                      row.settlement.outstanding > 0 ? "text-rose-600 dark:text-rose-400" : "text-foreground"
                    )}
                  >
                    {money(row.settlement.outstanding > 0 ? row.settlement.outstanding : row.settlement.total)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* مدفوعات الموردين */}
        <div className="rounded-2xl border border-border/80 bg-card p-3.5 sm:p-4 shadow-2xs space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <CreditCard className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              <h3 className="text-xs font-black text-foreground">سجل سدادات الموردين</h3>
            </div>
            <span className="text-[10px] font-bold text-muted-foreground">
              {purchases?.supplierPayments?.length || 0} دفعة
            </span>
          </div>

          {!purchases?.supplierPayments?.length ? (
            <p className="py-3 text-center text-xs text-muted-foreground">لا توجد دفعات مسجلة للموردين في هذه الفترة.</p>
          ) : (
            <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
              {purchases.supplierPayments.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between rounded-xl bg-muted/30 p-2 text-xs border border-border/40"
                >
                  <div className="min-w-0">
                    <p className="font-bold text-foreground text-[11px] truncate">{p.supplierName}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {p.date} · مرجع: <span className="font-mono" dir="ltr">{p.reference}</span>
                    </p>
                  </div>
                  <span className="shrink-0 font-black tabular-nums text-rose-600 dark:text-rose-400">
                    -{formatNumber(p.amount)} {curLabel}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* تكاليف مباشرة */}
        <div className="rounded-2xl border border-border/80 bg-card p-3.5 sm:p-4 shadow-2xs space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <DollarSign className="h-4 w-4 text-primary" />
              <h3 className="text-xs font-black text-foreground">تكاليف ومصروفات التنفيذ المباشرة</h3>
            </div>
            <span className="text-[10px] font-bold text-muted-foreground">
              {purchases?.directExpenses?.length || 0} عملية
            </span>
          </div>

          {!purchases?.directExpenses?.length ? (
            <p className="py-3 text-center text-xs text-muted-foreground">لا توجد تكاليف مباشرة مسجلة في هذه الفترة.</p>
          ) : (
            <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
              {purchases.directExpenses.map((exp) => (
                <div
                  key={exp.id}
                  className="flex items-center justify-between rounded-xl bg-muted/30 p-2 text-xs border border-border/40"
                >
                  <div className="min-w-0">
                    <p className="font-bold text-foreground text-[11px] truncate">
                      {exp.beneficiary || exp.category || "تكلفة إنتاج"}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {exp.date} · مسدَّد: {formatNumber(exp.paid)} {curLabel}
                    </p>
                  </div>
                  <span className="shrink-0 font-black tabular-nums text-foreground">
                    {money(exp.amount)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Cash movement view
  return (
    <div className="space-y-3.5" dir="rtl">
      {/* إحصائيات السيولة الثلاثية */}
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-3 text-center shadow-2xs space-y-1">
          <p className="text-[10px] font-bold text-emerald-700 dark:text-emerald-300">وارد نقدي</p>
          <p className="text-xs sm:text-sm font-black text-emerald-700 dark:text-emerald-300 tabular-nums">
            {money(cash?.totalInflow)}
          </p>
        </div>
        <div className="rounded-2xl border border-rose-500/30 bg-rose-500/5 p-3 text-center shadow-2xs space-y-1">
          <p className="text-[10px] font-bold text-rose-700 dark:text-rose-300">منصرف نقدي</p>
          <p className="text-xs sm:text-sm font-black text-rose-700 dark:text-rose-300 tabular-nums">
            {money(cash?.totalOutflow)}
          </p>
        </div>
        <div className="rounded-2xl border border-primary/30 bg-primary/5 p-3 text-center shadow-2xs space-y-1">
          <p className="text-[10px] font-bold text-primary">صافي التدفق</p>
          <p className="text-xs sm:text-sm font-black text-primary tabular-nums">
            {money(cash?.net)}
          </p>
        </div>
      </div>

      {/* سجل حركات الخزينة والبنك */}
      <div className="rounded-2xl border border-border/80 bg-card p-3.5 sm:p-4 shadow-2xs space-y-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <ArrowLeftRight className="h-4 w-4 text-primary" />
            <h3 className="text-xs font-black text-foreground">حركات النقدية والبنك (دفتر الأستاذ)</h3>
          </div>
          <span className="text-[10px] font-bold text-muted-foreground">
            {cash?.lines?.length || 0} حركة
          </span>
        </div>

        {!cash?.lines?.length ? (
          <p className="py-3 text-center text-xs text-muted-foreground">لا توجد حركات نقدية مسجلة في هذه الفترة.</p>
        ) : (
          <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
            {cash.lines.slice(0, 60).map((line) => (
              <div
                key={line.id}
                className={cn(
                  "flex items-center justify-between rounded-xl p-2 text-xs border",
                  line.reversed ? "opacity-50 line-through bg-muted/20 border-border/30" : "bg-muted/30 border-border/40"
                )}
              >
                <div className="min-w-0">
                  <p className="font-bold text-foreground text-[11px] truncate">
                    {line.accountName}
                    {line.reference && (
                      <span className="mr-1.5 font-mono text-[10px] text-muted-foreground" dir="ltr">
                        ({line.reference})
                      </span>
                    )}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    {line.date}
                    {line.reversed && <span className="mr-1 text-rose-500 font-bold">· ملغاة</span>}
                  </p>
                </div>
                <span
                  className={cn(
                    "shrink-0 font-black tabular-nums",
                    line.reversed
                      ? "text-muted-foreground"
                      : line.inflow > 0
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-rose-600 dark:text-rose-400"
                  )}
                >
                  {line.inflow > 0 ? `+${formatNumber(line.inflow)}` : `-${formatNumber(line.outflow)}`} {curLabel}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
