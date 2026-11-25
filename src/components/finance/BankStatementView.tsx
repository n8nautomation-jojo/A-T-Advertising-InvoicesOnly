import React, { useCallback, useEffect, useState } from "react";
import { ArrowDown, ArrowUp, FileSpreadsheet, Loader2, Scale } from "lucide-react";
import { formatNumber } from "@/lib/printCalculator";
import { getCurrencyDisplayName, getCurrencyShortLabel } from "@/lib/currency/currencyFormat";
import type { AppCurrency } from "@/lib/currency/types";
import {
  getBankAccountStatement,
  type BankStatementItem,
  type BankStatementPeriod,
  type BankStatementReport,
} from "@/lib/repositories/LedgerRepository";

interface BankStatementViewProps {
  currency: AppCurrency;
  accountId?: string;
  onBack: () => void;
  onOpenReconcile: () => void;
}

const PERIOD_TABS: Array<{ id: BankStatementPeriod; label: string }> = [
  { id: "last5", label: "آخر 5 معاملات" },
  { id: "7d", label: "آخر 7 أيام" },
  { id: "30d", label: "آخر 30 يوم" },
  { id: "90d", label: "آخر 3 شهور" },
  { id: "all", label: "الكل" },
];

const EMBLEM_WORD: Record<AppCurrency, string> = {
  SDG: "جنيه",
  USD: "USD",
  SAR: "ريال",
  EGP: "ج.م",
};

const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatBankakDate(iso: string): string {
  const parts = iso.slice(0, 10).split("-");
  if (parts.length !== 3) return iso;
  const [y, m, d] = parts;
  const monthName = MONTHS_EN[(Number(m) || 1) - 1] ?? m;
  return `${d}-${monthName}-${y}`;
}

export function BankStatementView({
  currency,
  accountId,
  onBack,
  onOpenReconcile,
}: BankStatementViewProps) {
  const [period, setPeriod] = useState<BankStatementPeriod>("last5");
  const [report, setReport] = useState<BankStatementReport | null>(null);
  const [loading, setLoading] = useState(true);

  const curShort = getCurrencyShortLabel(currency);
  const curName = getCurrencyDisplayName(currency, "ar");

  const loadStatement = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getBankAccountStatement({
        currency,
        accountId,
        period,
      });
      setReport(data);
    } catch {
      setReport({
        currency,
        accountId: accountId ?? null,
        accountName: `حساب ${curName}`,
        period,
        currentBalance: 0,
        periodInflow: 0,
        periodOutflow: 0,
        totalCount: 0,
        items: [],
      });
    } finally {
      setLoading(false);
    }
  }, [currency, accountId, period, curName]);

  useEffect(() => {
    void loadStatement();
    const onChanged = () => {
      void loadStatement();
    };
    window.addEventListener("finance-changed", onChanged);
    return () => window.removeEventListener("finance-changed", onChanged);
  }, [loadStatement]);

  return (
    <div className="space-y-3" dir="rtl" data-testid={`bank-statement-view-${currency}`}>
      {/* Bankak-inspired Header Bar */}
      <div className="flex items-center justify-between gap-2 bg-slate-100/90 dark:bg-muted/40 rounded-xl px-3.5 py-2.5 border border-border/60">
        <div>
          <h3 className="text-sm sm:text-base font-black text-slate-900 dark:text-white">
            عرض كشف الحساب — {curName}
          </h3>
          {report?.accountNumber && (
            <p className="text-[10.5px] font-mono font-bold text-muted-foreground" dir="ltr">
              الحساب: {report.accountNumber}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onOpenReconcile}
            className="inline-flex items-center gap-1 rounded-lg border border-emerald-600/35 bg-emerald-500/10 px-2.5 py-1.5 text-[11px] font-black text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20"
          >
            <Scale className="h-3.5 w-3.5" />
            <span>مطابقة الرصيد</span>
          </button>
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1 rounded-lg border border-[#B91C1C]/45 bg-white dark:bg-card px-3 py-1.5 text-xs font-black text-[#B91C1C] shadow-2xs hover:bg-rose-50 dark:hover:bg-rose-950/30"
          >
            <span>رجوع</span>
            <span aria-hidden="true">‹</span>
          </button>
        </div>
      </div>

      {/* Live Balance & Period In/Out Summary Strip */}
      <div className="grid grid-cols-3 gap-2 rounded-xl border border-border/70 bg-white dark:bg-card p-2.5 shadow-2xs text-center">
        <div>
          <p className="text-[10px] font-bold text-muted-foreground">الرصيد الحالي</p>
          <p
            className="text-xs sm:text-sm font-mono font-black text-[#16A34A] dark:text-emerald-400 tabular-nums"
            dir="ltr"
          >
            {formatNumber(report?.currentBalance ?? 0)} {curShort}
          </p>
        </div>
        <div className="border-x border-border/50">
          <p className="text-[10px] font-bold text-muted-foreground">الوارد (+)</p>
          <p className="text-xs sm:text-sm font-mono font-black text-[#16A34A] dark:text-emerald-400 tabular-nums" dir="ltr">
            +{formatNumber(report?.periodInflow ?? 0)}
          </p>
        </div>
        <div>
          <p className="text-[10px] font-bold text-muted-foreground">المنصرف (-)</p>
          <p className="text-xs sm:text-sm font-mono font-black text-[#DC2626] dark:text-rose-400 tabular-nums" dir="ltr">
            -{formatNumber(report?.periodOutflow ?? 0)}
          </p>
        </div>
      </div>

      {/* Period Filter Tabs (Bankak Reference Style) */}
      <div className="flex items-center border-b border-slate-200 dark:border-border overflow-x-auto no-scrollbar bg-white dark:bg-card rounded-t-xl px-1">
        {PERIOD_TABS.map((tab) => {
          const active = period === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setPeriod(tab.id)}
              data-testid={`statement-tab-${tab.id}`}
              className={`shrink-0 flex-1 min-w-[92px] py-2.5 px-2 text-[11.5px] transition-all border-b-2 touch-manipulation ${
                active
                  ? "border-[#C62828] text-slate-900 dark:text-white font-black"
                  : "border-transparent text-slate-500 dark:text-muted-foreground font-bold hover:text-foreground"
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Statement Cards List */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-10 gap-2 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
          <span className="text-xs font-bold">جارٍ تحميل كشف الحساب…</span>
        </div>
      ) : !report || report.items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-white/70 dark:bg-card/50 py-10 px-4 text-center space-y-2">
          <FileSpreadsheet className="h-9 w-9 mx-auto text-muted-foreground/45" />
          <p className="text-xs sm:text-sm font-black text-foreground">
            لا توجد معاملات بنكية مسجلة في هذه الفترة بعملة {curName}
          </p>
          <p className="text-[11px] font-medium text-muted-foreground max-w-sm mx-auto">
            أدخل رصيدك البنكي الفعلي من زر «مطابقة الرصيد» أعلاه، وسيتم تسجيل كافة التحصيلات والمشتريات والمصروفات هنا تلقائياً.
          </p>
        </div>
      ) : (
        <div className="space-y-2.5 max-h-[52vh] overflow-y-auto overscroll-y-contain pr-0.5">
          {report.items.map((item) => (
            <StatementTransactionCard key={item.id} item={item} curShort={curShort} />
          ))}
        </div>
      )}
    </div>
  );
}

function StatementTransactionCard({
  item,
  curShort,
}: {
  item: BankStatementItem;
  curShort: string;
}) {
  const isIn = item.direction === "in";
  const emblemText = EMBLEM_WORD[item.currency] ?? item.currency;

  return (
    <div
      data-testid={`statement-row-${item.direction}`}
      className="flex items-center justify-between gap-3 rounded-xl border border-slate-200/90 dark:border-border/80 bg-white dark:bg-card px-3.5 py-3 shadow-xs transition-colors"
    >
      {/* Right Side (RTL Start): Circular Currency Emblem with Incoming ↓ (Green) or Outgoing ↑ (Red) */}
      <div className="flex items-center gap-3 min-w-0">
        <div className="relative shrink-0 h-11 w-11 flex items-center justify-center">
          <div
            className={`h-10 w-10 rounded-full border-2 flex items-center justify-center ${
              isIn
                ? "border-[#16A34A] bg-emerald-50/70 dark:bg-emerald-950/30"
                : "border-[#DC2626] bg-rose-50/70 dark:bg-rose-950/30"
            }`}
          >
            <span
              className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-[9px] font-black text-white ${
                isIn ? "bg-[#16A34A]" : "bg-[#DC2626]"
              }`}
            >
              {emblemText}
            </span>
          </div>
          <span
            className={`absolute -top-1 -left-1 h-4.5 w-4.5 rounded-full bg-white dark:bg-card flex items-center justify-center shadow-2xs ${
              isIn ? "text-[#16A34A]" : "text-[#DC2626]"
            }`}
          >
            {isIn ? <ArrowDown className="h-3.5 w-3.5 stroke-[2.75]" /> : <ArrowUp className="h-3.5 w-3.5 stroke-[2.75]" />}
          </span>
        </div>

        {/* Center Details: Date + Description + Running Balance */}
        <div className="min-w-0 space-y-0.5 text-right">
          <p className="text-xs font-mono font-bold text-slate-700 dark:text-slate-200" dir="ltr">
            {formatBankakDate(item.occurredAt)}
          </p>
          <p className="text-xs font-black text-slate-900 dark:text-white truncate">
            {item.title}
          </p>
          {item.subtitle && (
            <p className="text-[10.5px] font-medium text-slate-500 dark:text-muted-foreground truncate">
              {item.subtitle}
            </p>
          )}
          <p className="text-[10px] font-bold text-slate-400 dark:text-muted-foreground/80">
            الرصيد بعد الحركة:{" "}
            <span className="font-mono tabular-nums" dir="ltr">
              {formatNumber(item.runningBalance)} {curShort}
            </span>
          </p>
        </div>
      </div>

      {/* Left Side (RTL End): Bold Signed Green (+) or Red (-) Amount */}
      <div className="shrink-0 text-left">
        <p
          data-testid={`statement-amount-${item.direction}`}
          className={`text-sm sm:text-[15px] font-mono font-black tabular-nums whitespace-nowrap ${
            isIn
              ? "text-[#16A34A] dark:text-emerald-400"
              : "text-[#DC2626] dark:text-rose-400"
          }`}
          dir="ltr"
        >
          {isIn ? "+" : "-"}
          {curShort} {formatNumber(item.amount)}
        </p>
        {item.reference && (
          <p className="text-[9.5px] font-mono text-muted-foreground mt-0.5" dir="ltr">
            {item.reference}
          </p>
        )}
      </div>
    </div>
  );
}
