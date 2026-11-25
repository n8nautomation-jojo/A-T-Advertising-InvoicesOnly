import React, { useCallback, useEffect, useState } from "react";
import { ArrowDown, ArrowRight, ArrowUp, FileSpreadsheet, Loader2, Scale } from "lucide-react";
import { formatNumber } from "@/lib/printCalculator";
import { getCurrencyDisplayName, getCurrencyShortLabel } from "@/lib/currency/currencyFormat";
import { CURRENCY_LIST, type AppCurrency } from "@/lib/currency/types";
import {
  getBankAccountStatement,
  type BankStatementItem,
  type BankStatementPeriod,
  type BankStatementReport,
} from "@/lib/repositories/LedgerRepository";

interface BankStatementViewProps {
  currency: AppCurrency;
  accountId?: string;
  onBack?: () => void;
  onOpenReconcile: () => void;
  /** عند التمرير في الصفحة المستقلة يتيح التبديل بين الحسابات الأربعة مباشرة داخل كشف الحساب */
  onChangeCurrency?: (currency: AppCurrency) => void;
  /** إخفاء زر الرجوع الداخلي عندما توفر الصفحة المستقلة زر رجوع واحد في ترويستها */
  hideInlineBack?: boolean;
  /** عند العرض داخل صفحة كاملة مستقلة يُستخدم التمرير الرأسي الطبيعي للصفحة بدل حاوية مقيدة الارتفاع */
  standalonePage?: boolean;
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

const SOURCE_TYPE_LABELS: Record<string, string> = {
  customer_payment: "تحصيل مبيعات",
  supplier_payment: "سداد مشتريات",
  expense_payment: "مصروف",
  opening_balance: "رصيد افتتاحي",
  bank_reconciliation: "مطابقة بنكية",
  external_deposit: "إيداع خارجي",
  external_withdrawal: "سحب / عمولة خارجية",
  transfer_in: "تحويل وارد",
  transfer_out: "تحويل صادر",
};

const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatBankakDate(iso: string): string {
  const parts = iso.slice(0, 10).split("-");
  if (parts.length !== 3) return iso;
  const [y, m, d] = parts;
  const monthName = MONTHS_EN[(Number(m) || 1) - 1] ?? m;
  return `${d}-${monthName}-${y}`;
}

/** يمنع ظهور الصفر السالب (-0) في أي رقم مالي معروض */
function normalizeZero(value: number | undefined | null): number {
  const n = Number(value) || 0;
  return Math.abs(n) < 0.005 ? 0 : n;
}

export function BankStatementView({
  currency,
  accountId,
  onBack,
  onOpenReconcile,
  onChangeCurrency,
  hideInlineBack = false,
  standalonePage = false,
}: BankStatementViewProps) {
  const [period, setPeriod] = useState<BankStatementPeriod>("last5");
  const [report, setReport] = useState<BankStatementReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const curShort = getCurrencyShortLabel(currency);
  const curName = getCurrencyDisplayName(currency, "ar");

  const loadStatement = useCallback(async () => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const data = await getBankAccountStatement({
        currency,
        accountId,
        period,
      });
      setReport(data);
    } catch {
      setErrorMessage("تعذّر تحميل بيانات كشف الحساب حالياً.");
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

  const currentBalance = normalizeZero(report?.currentBalance);
  const periodInflow = normalizeZero(report?.periodInflow);
  const periodOutflow = normalizeZero(report?.periodOutflow);

  return (
    <div
      className="w-full max-w-full min-w-0 space-y-3"
      dir="rtl"
      data-testid={`bank-statement-view-${currency}`}
    >
      {/* Bankak-inspired Header Bar (Responsive wrap — zero horizontal overflow) */}
      <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-100/90 dark:bg-muted/40 rounded-xl px-3 py-2.5 sm:px-3.5 border border-border/60 w-full min-w-0">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm sm:text-base font-black text-slate-900 dark:text-white leading-snug break-words">
            عرض كشف الحساب — {curName}
          </h3>
          {report?.accountNumber && (
            <p className="text-[11px] font-bold text-muted-foreground mt-0.5 break-words">
              <span>الحساب: </span>
              <bdi dir="ltr" className="font-mono tabular-nums">
                {report.accountNumber}
              </bdi>
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={onOpenReconcile}
            className="inline-flex items-center gap-1 rounded-lg border border-emerald-600/35 bg-emerald-500/10 px-2.5 py-1.5 text-[11px] font-black text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20 transition-colors cursor-pointer"
          >
            <Scale className="h-3.5 w-3.5 shrink-0" />
            <span>مطابقة الرصيد</span>
          </button>
          {!hideInlineBack && onBack && (
            <button
              type="button"
              onClick={onBack}
              className="inline-flex items-center gap-1 rounded-lg border border-[#B91C1C]/45 bg-white dark:bg-card px-3 py-1.5 text-xs font-black text-[#B91C1C] shadow-2xs hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors cursor-pointer"
            >
              <ArrowRight className="h-3.5 w-3.5 shrink-0" />
              <span>رجوع</span>
            </button>
          )}
        </div>
      </div>

      {/* Optional Account Switcher for Direct Statement Access */}
      {onChangeCurrency && (
        <div
          className="flex flex-wrap items-center gap-1.5"
          aria-label="اختيار الحساب البنكي"
          data-testid="statement-currency-switcher"
        >
          {CURRENCY_LIST.map((cfg) => {
            const active = cfg.code === currency;
            return (
              <button
                key={cfg.code}
                type="button"
                data-testid={`statement-currency-btn-${cfg.code}`}
                onClick={() => onChangeCurrency(cfg.code)}
                className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-black border transition-colors cursor-pointer ${
                  active
                    ? "bg-[#C62828] text-white border-[#B71C1C] shadow-2xs"
                    : "bg-white dark:bg-card text-slate-700 dark:text-muted-foreground border-border/70 hover:text-foreground"
                }`}
              >
                <span aria-hidden="true">{cfg.flag}</span>
                <bdi dir="ltr" className="font-mono">
                  {cfg.code}
                </bdi>
              </button>
            );
          })}
        </div>
      )}

      {/* Live Balance & Period In/Out Summary Strip (UX-004: Responsive Grid + Zero -0 Fix) */}
      <div
        data-testid="bank-statement-summary"
        className="grid grid-cols-2 sm:grid-cols-3 rounded-xl border border-border/70 bg-white dark:bg-card p-2.5 sm:p-3 shadow-2xs text-center w-full min-w-0 gap-y-2.5 sm:gap-y-0"
      >
        <div className="col-span-2 sm:col-span-1 min-w-0 px-1.5">
          <p className="text-[10.5px] font-bold text-muted-foreground">الرصيد الحالي</p>
          <p
            data-testid="statement-summary-balance"
            className={`text-sm sm:text-[15px] font-mono font-black tabular-nums break-words mt-0.5 ${
              currentBalance < 0
                ? "text-[#DC2626] dark:text-rose-400"
                : "text-[#16A34A] dark:text-emerald-400"
            }`}
          >
            <bdi dir="ltr">{formatNumber(currentBalance)}</bdi>{" "}
            <span className="font-sans text-xs">{curShort}</span>
          </p>
        </div>

        <div className="min-w-0 border-t sm:border-t-0 sm:border-x border-border/50 pt-2 sm:pt-0 px-1.5">
          <p className="text-[10.5px] font-bold text-muted-foreground">الوارد (+)</p>
          <p
            data-testid="statement-summary-inflow"
            className="text-xs sm:text-sm font-mono font-black text-[#16A34A] dark:text-emerald-400 tabular-nums break-words mt-0.5"
          >
            <bdi dir="ltr">{periodInflow > 0 ? `+${formatNumber(periodInflow)}` : "0"}</bdi>{" "}
            <span className="font-sans text-[11px]">{curShort}</span>
          </p>
        </div>

        <div className="min-w-0 border-t border-r sm:border-t-0 sm:border-r-0 border-border/50 pt-2 sm:pt-0 px-1.5">
          <p className="text-[10.5px] font-bold text-muted-foreground">المنصرف (-)</p>
          <p
            data-testid="statement-summary-outflow"
            className="text-xs sm:text-sm font-mono font-black text-[#DC2626] dark:text-rose-400 tabular-nums break-words mt-0.5"
          >
            <bdi dir="ltr">{periodOutflow > 0 ? `-${formatNumber(periodOutflow)}` : "0"}</bdi>{" "}
            <span className="font-sans text-[11px]">{curShort}</span>
          </p>
        </div>
      </div>

      {/* Period Filter Tabs (UX-006: Preserves Bankak style, wraps cleanly with zero horizontal scroll) */}
      <div
        data-testid="bank-statement-period-tabs"
        className="flex flex-wrap items-stretch border-b border-slate-200 dark:border-border bg-white dark:bg-card rounded-t-xl px-1 w-full min-w-0"
      >
        {PERIOD_TABS.map((tab) => {
          const active = period === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setPeriod(tab.id)}
              data-testid={`statement-tab-${tab.id}`}
              className={`flex-1 basis-[30%] sm:basis-0 py-2 sm:py-2.5 px-1.5 text-[11px] sm:text-[11.5px] text-center leading-tight transition-all border-b-2 touch-manipulation cursor-pointer ${
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

      {errorMessage && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs font-bold text-amber-800 dark:text-amber-300">
          {errorMessage}
        </div>
      )}

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
        <div
          className={
            standalonePage
              ? "space-y-2.5 w-full min-w-0"
              : "space-y-2.5 max-h-[52vh] overflow-y-auto overscroll-y-contain pr-0.5 w-full min-w-0"
          }
        >
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
  const cleanAmount = normalizeZero(item.amount);
  const cleanRunning = normalizeZero(item.runningBalance);
  const typeBadge = SOURCE_TYPE_LABELS[item.sourceType];

  return (
    <div
      data-testid={`statement-row-${item.direction}`}
      className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2.5 rounded-xl border border-slate-200/90 dark:border-border/80 bg-white dark:bg-card px-3 py-3 sm:px-3.5 shadow-xs transition-colors w-full min-w-0"
    >
      {/* Right Side (RTL Start): Circular Currency Emblem + Full Transaction Details */}
      <div className="flex items-start gap-2.5 sm:gap-3 min-w-0 flex-1">
        <div className="relative shrink-0 h-11 w-11 flex items-center justify-center mt-0.5">
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
            {isIn ? (
              <ArrowDown className="h-3.5 w-3.5 stroke-[2.75]" />
            ) : (
              <ArrowUp className="h-3.5 w-3.5 stroke-[2.75]" />
            )}
          </span>
        </div>

        {/* Center Details: Date + Type + Full Title + Full Subtitle/Invoice + Running Balance (NO truncation) */}
        <div className="min-w-0 flex-1 space-y-1 text-right">
          <div className="flex flex-wrap items-center gap-1.5">
            <bdi
              dir="ltr"
              className="text-xs font-mono font-bold text-slate-700 dark:text-slate-200 tabular-nums"
            >
              {formatBankakDate(item.occurredAt)}
            </bdi>
            {typeBadge && (
              <span
                className={`rounded-md px-1.5 py-0.5 text-[9.5px] font-black ${
                  isIn
                    ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                    : "bg-rose-500/10 text-rose-700 dark:text-rose-400"
                }`}
              >
                {typeBadge}
              </span>
            )}
          </div>

          <p className="text-xs font-black text-slate-900 dark:text-white leading-snug break-words">
            {item.title}
          </p>

          {item.subtitle && (
            <p className="text-[11px] font-medium text-slate-500 dark:text-muted-foreground leading-snug break-words">
              {item.subtitle}
            </p>
          )}

          <p className="text-[10.5px] font-bold text-slate-500 dark:text-muted-foreground/90 break-words">
            <span>الرصيد بعد الحركة: </span>
            <bdi dir="ltr" className="font-mono font-black tabular-nums text-slate-700 dark:text-slate-200">
              {formatNumber(cleanRunning)}
            </bdi>{" "}
            <span>{curShort}</span>
          </p>
        </div>
      </div>

      {/* Left Side (RTL End on sm+, full bottom strip on mobile): Signed Green (+) / Red (-) Amount + Reference */}
      <div className="flex flex-row-reverse sm:flex-col items-center sm:items-end justify-between gap-2 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-100 dark:border-border/50 shrink-0 min-w-0 sm:max-w-[42%]">
        <p
          data-testid={`statement-amount-${item.direction}`}
          className={`text-sm sm:text-[15px] font-mono font-black tabular-nums leading-tight ${
            isIn
              ? "text-[#16A34A] dark:text-emerald-400"
              : "text-[#DC2626] dark:text-rose-400"
          }`}
        >
          <bdi dir="ltr">
            {cleanAmount === 0 ? "0" : `${isIn ? "+" : "-"}${formatNumber(cleanAmount)}`}
          </bdi>{" "}
          <span className="font-sans text-xs">{curShort}</span>
        </p>

        {item.reference && (
          <p className="text-[10px] font-mono font-bold text-muted-foreground break-all text-right sm:text-left">
            <bdi dir="ltr">{item.reference}</bdi>
          </p>
        )}
      </div>
    </div>
  );
}
