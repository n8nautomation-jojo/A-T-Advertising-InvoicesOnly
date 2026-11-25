import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowRight, ArrowUp, FileSpreadsheet, Layers, Loader2, Scale } from "lucide-react";
import { formatNumber } from "@/lib/printCalculator";
import { getCurrencyDisplayName, getCurrencyShortLabel } from "@/lib/currency/currencyFormat";
import { CURRENCY_LIST, type AppCurrency } from "@/lib/currency/types";
import {
  filterBankStatementItemsByPeriod,
  getBankAccountStatement,
  getCombinedBankStatement,
  type BankStatementItem,
  type BankStatementPeriod,
  type BankStatementReport,
  type CombinedBankStatementReport,
  type CombinedCurrencySummary,
} from "@/lib/repositories/LedgerRepository";

export type BankStatementCurrencyFilter = AppCurrency | "ALL";

interface BankStatementViewProps {
  currency: BankStatementCurrencyFilter;
  accountId?: string;
  onBack?: () => void;
  onOpenReconcile: () => void;
  /** يتيح التبديل بين All والعملات الأربعة مباشرة أسفل الهيدر الأحمر */
  onChangeCurrency?: (currency: BankStatementCurrencyFilter) => void;
  /** إخفاء زر الرجوع الداخلي عندما توفر الصفحة المستقلة زر رجوع واحد في ترويستها */
  hideInlineBack?: boolean;
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
  purchase_invoice: "فاتورة مشتريات",
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
  const parts = String(iso || "").slice(0, 10).split("-");
  if (parts.length !== 3) return String(iso || "");
  const [y, m, d] = parts;
  const monthName = MONTHS_EN[(Number(m) || 1) - 1] ?? m;
  return `${d}-${monthName}-${y}`;
}

/** يمنع ظهور الصفر السالب (-0) في أي رقم مالي معروض */
function normalizeZero(value: number | undefined | null): number {
  const n = Number(value) || 0;
  return Math.abs(n) < 0.005 ? 0 : n;
}

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function buildEmptyCombinedReport(): CombinedBankStatementReport {
  const byCurrency = {} as Record<AppCurrency, CombinedCurrencySummary>;
  for (const cfg of CURRENCY_LIST) {
    byCurrency[cfg.code] = {
      currency: cfg.code,
      accountName: `حساب ${cfg.nameAr}`,
      currentBalance: 0,
      periodInflow: 0,
      periodOutflow: 0,
      totalCount: 0,
    };
  }
  return {
    period: "all",
    byCurrency,
    totalCount: 0,
    items: [],
  };
}

export function BankStatementView({
  currency,
  accountId,
  onBack,
  onOpenReconcile,
  onChangeCurrency,
  hideInlineBack = false,
}: BankStatementViewProps) {
  const isAllMode = currency === "ALL";
  const [period, setPeriod] = useState<BankStatementPeriod>("last5");
  const [fullSingleReport, setFullSingleReport] = useState<BankStatementReport | null>(null);
  const [fullCombinedReport, setFullCombinedReport] = useState<CombinedBankStatementReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const curShort = isAllMode ? "" : getCurrencyShortLabel(currency);
  const curName = isAllMode ? "جميع العملات" : getCurrencyDisplayName(currency, "ar");

  /**
   * جلب السجل الكامل مرة واحدة عند تغيير العملة أو تحديث المالية، ثم تطبيق فلاتر الفترة
   * (آخر 5 معاملات، آخر 7 أيام، آخر 30 يوم، آخر 3 شهور، الكل) لحظياً وبدون أي أخطاء أو سباق استعلامات.
   */
  const loadStatement = useCallback(async () => {
    const reqId = ++requestIdRef.current;
    setLoading(true);
    setErrorMessage(null);
    try {
      if (currency === "ALL") {
        const combined = await getCombinedBankStatement({ period: "all" });
        if (reqId !== requestIdRef.current) return;
        setFullCombinedReport(combined);
        setFullSingleReport(null);
      } else {
        const data = await getBankAccountStatement({
          currency,
          accountId,
          period: "all",
        });
        if (reqId !== requestIdRef.current) return;
        setFullSingleReport(data);
        setFullCombinedReport(null);
      }
    } catch {
      if (reqId !== requestIdRef.current) return;
      if (currency === "ALL") {
        setFullCombinedReport(buildEmptyCombinedReport());
        setFullSingleReport(null);
      } else {
        setFullSingleReport({
          currency,
          accountId: accountId ?? null,
          accountName: `حساب ${curName}`,
          period: "all",
          currentBalance: 0,
          periodInflow: 0,
          periodOutflow: 0,
          totalCount: 0,
          items: [],
        });
        setFullCombinedReport(null);
      }
      setErrorMessage("تعذّر تحميل بيانات كشف الحساب حالياً.");
    } finally {
      if (reqId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, [currency, accountId, curName]);

  useEffect(() => {
    void loadStatement();
    const onChanged = () => {
      void loadStatement();
    };
    window.addEventListener("finance-changed", onChanged);
    return () => window.removeEventListener("finance-changed", onChanged);
  }, [loadStatement]);

  // تطبيق فلتر الفترة الزمنية بأمان تام (لا يرمي أي خطأ حتى لو كان النظام جديداً أو فيه معاملات اليوم فقط)
  const filteredItems = useMemo<BankStatementItem[]>(() => {
    const sourceItems = isAllMode
      ? fullCombinedReport?.items ?? []
      : fullSingleReport?.items ?? [];
    return filterBankStatementItemsByPeriod(sourceItems, period);
  }, [isAllMode, fullCombinedReport, fullSingleReport, period]);

  const singleMetrics = useMemo(() => {
    const currentBalance = normalizeZero(fullSingleReport?.currentBalance);
    const periodInflow = normalizeZero(
      round2(filteredItems.reduce((s, item) => s + (item.direction === "in" ? item.amount : 0), 0))
    );
    const periodOutflow = normalizeZero(
      round2(filteredItems.reduce((s, item) => s + (item.direction === "out" ? item.amount : 0), 0))
    );
    return { currentBalance, periodInflow, periodOutflow };
  }, [fullSingleReport, filteredItems]);

  const combinedSummaries = useMemo<CombinedCurrencySummary[]>(() => {
    const base = fullCombinedReport?.byCurrency ?? buildEmptyCombinedReport().byCurrency;
    return CURRENCY_LIST.map((cfg) => {
      const entry = base[cfg.code];
      const curItems = filteredItems.filter((i) => i.currency === cfg.code);
      return {
        ...entry,
        currentBalance: normalizeZero(entry?.currentBalance),
        periodInflow: normalizeZero(
          round2(curItems.reduce((s, item) => s + (item.direction === "in" ? item.amount : 0), 0))
        ),
        periodOutflow: normalizeZero(
          round2(curItems.reduce((s, item) => s + (item.direction === "out" ? item.amount : 0), 0))
        ),
      };
    });
  }, [fullCombinedReport, filteredItems]);

  return (
    <div
      className="w-full max-w-full min-w-0 space-y-3"
      dir="rtl"
      data-testid={`bank-statement-view-${currency}`}
    >
      {/* Currency Selector Bar right below the crimson header (with All option) */}
      {onChangeCurrency && (
        <div
          className="flex flex-wrap items-center justify-between gap-2 w-full min-w-0"
          aria-label="اختيار الحساب البنكي"
          data-testid="statement-currency-switcher"
        >
          <div className="flex flex-wrap items-center gap-1.5 min-w-0">
            <button
              type="button"
              data-testid="statement-currency-btn-ALL"
              onClick={() => onChangeCurrency("ALL")}
              className={`inline-flex items-center gap-1 rounded-xl px-3 py-1.5 text-xs font-black border transition-colors cursor-pointer touch-manipulation ${
                isAllMode
                  ? "bg-[#C62828] text-white border-[#B71C1C] shadow-xs"
                  : "bg-white dark:bg-card text-slate-700 dark:text-muted-foreground border-border/70 hover:text-foreground"
              }`}
            >
              <Layers className="h-3.5 w-3.5 shrink-0" />
              <bdi dir="ltr" className="font-mono">
                All
              </bdi>
            </button>

            {CURRENCY_LIST.map((cfg) => {
              const active = !isAllMode && cfg.code === currency;
              return (
                <button
                  key={cfg.code}
                  type="button"
                  data-testid={`statement-currency-btn-${cfg.code}`}
                  onClick={() => onChangeCurrency(cfg.code)}
                  className={`inline-flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-xs font-black border transition-colors cursor-pointer touch-manipulation ${
                    active
                      ? "bg-[#C62828] text-white border-[#B71C1C] shadow-xs"
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

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              data-testid="statement-reconcile-btn"
              onClick={onOpenReconcile}
              className="inline-flex items-center gap-1 rounded-xl border border-emerald-600/35 bg-emerald-500/10 px-3 py-1.5 text-xs font-black text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20 transition-colors cursor-pointer touch-manipulation"
            >
              <Scale className="h-3.5 w-3.5 shrink-0" />
              <span>مطابقة الرصيد</span>
            </button>
            {!hideInlineBack && onBack && (
              <button
                type="button"
                onClick={onBack}
                className="inline-flex items-center gap-1 rounded-xl border border-[#B91C1C]/45 bg-white dark:bg-card px-3 py-1.5 text-xs font-black text-[#B91C1C] shadow-2xs hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors cursor-pointer"
              >
                <ArrowRight className="h-3.5 w-3.5 shrink-0" />
                <span>رجوع</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Prominent Hero Financial Summary Section (الرصيد الحالي · الوارد (+) · المنصرف (-)) */}
      {isAllMode ? (
        <section
          data-testid="bank-statement-summary"
          className="rounded-2xl border-2 border-emerald-600/25 dark:border-emerald-500/30 bg-white dark:bg-card p-4 sm:p-5 shadow-sm w-full min-w-0 space-y-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-2.5">
            <h2 className="text-sm sm:text-base font-black text-foreground">
              ملخص جميع الحسابات البنكية (All)
            </h2>
            <span className="text-[11px] font-bold text-muted-foreground">
              أرصدة محدثة لكل عملة بشكل مستقل
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 w-full min-w-0">
            {combinedSummaries.map((entry) => {
              const cfg = CURRENCY_LIST.find((c) => c.code === entry.currency)!;
              const shortLbl = getCurrencyShortLabel(entry.currency);
              return (
                <div
                  key={entry.currency}
                  data-testid={`combined-summary-${entry.currency}`}
                  className="rounded-xl border border-border/70 bg-slate-50/70 dark:bg-muted/25 p-3 space-y-2 min-w-0"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 text-xs font-black text-foreground">
                      <span aria-hidden="true">{cfg.flag}</span>
                      <span>{cfg.nameAr}</span>
                    </span>
                    <bdi
                      dir="ltr"
                      className="rounded-md bg-[#C62828]/10 text-[#B71C1C] dark:text-rose-300 px-1.5 py-0.5 text-[10px] font-mono font-black"
                    >
                      {entry.currency}
                    </bdi>
                  </div>

                  <p
                    className={`text-lg sm:text-xl font-mono font-black tabular-nums leading-tight break-words ${
                      entry.currentBalance < 0
                        ? "text-[#DC2626] dark:text-rose-400"
                        : "text-[#16A34A] dark:text-emerald-400"
                    }`}
                  >
                    <bdi dir="ltr">{formatNumber(entry.currentBalance)}</bdi>{" "}
                    <span className="font-sans text-xs sm:text-sm">{shortLbl}</span>
                  </p>

                  <div className="grid grid-cols-2 gap-2 pt-1.5 border-t border-border/50 text-[11px]">
                    <div className="min-w-0">
                      <span className="text-[10px] font-bold text-muted-foreground block">الوارد (+)</span>
                      <span className="font-mono font-black text-[#16A34A] dark:text-emerald-400 tabular-nums break-words">
                        <bdi dir="ltr">
                          {entry.periodInflow > 0 ? `+${formatNumber(entry.periodInflow)}` : "0"}
                        </bdi>{" "}
                        <span className="font-sans text-[10px]">{shortLbl}</span>
                      </span>
                    </div>
                    <div className="min-w-0">
                      <span className="text-[10px] font-bold text-muted-foreground block">المنصرف (-)</span>
                      <span className="font-mono font-black text-[#DC2626] dark:text-rose-400 tabular-nums break-words">
                        <bdi dir="ltr">
                          {entry.periodOutflow > 0 ? `-${formatNumber(entry.periodOutflow)}` : "0"}
                        </bdi>{" "}
                        <span className="font-sans text-[10px]">{shortLbl}</span>
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ) : (
        <section
          data-testid="bank-statement-summary"
          className="rounded-2xl border-2 border-emerald-600/25 dark:border-emerald-500/30 bg-white dark:bg-card p-4 sm:p-5 shadow-sm w-full min-w-0 space-y-3.5"
        >
          {/* Hero Current Balance */}
          <div className="text-center space-y-1 pb-3 border-b border-border/60">
            <div className="flex flex-wrap items-center justify-center gap-2 text-xs font-bold text-muted-foreground">
              <span>الرصيد الحالي — {curName}</span>
              {fullSingleReport?.accountNumber && (
                <bdi
                  dir="ltr"
                  className="rounded-md bg-muted px-1.5 py-0.5 text-[10.5px] font-mono font-bold text-muted-foreground tabular-nums"
                >
                  #{fullSingleReport.accountNumber}
                </bdi>
              )}
            </div>
            <p
              data-testid="statement-summary-balance"
              className={`text-2xl sm:text-3xl font-mono font-black tabular-nums leading-tight break-words ${
                singleMetrics.currentBalance < 0
                  ? "text-[#DC2626] dark:text-rose-400"
                  : "text-[#16A34A] dark:text-emerald-400"
              }`}
            >
              <bdi dir="ltr">{formatNumber(singleMetrics.currentBalance)}</bdi>{" "}
              <span className="font-sans text-base sm:text-lg font-black">{curShort}</span>
            </p>
          </div>

          {/* Hero Inflow (+) & Outflow (-) Prominent Tiles */}
          <div className="grid grid-cols-2 gap-2.5 sm:gap-3 text-center w-full min-w-0">
            <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/[0.06] p-3 min-w-0">
              <p className="text-[11px] sm:text-xs font-black text-emerald-800 dark:text-emerald-300">
                الوارد (+)
              </p>
              <p
                data-testid="statement-summary-inflow"
                className="text-sm sm:text-lg font-mono font-black text-[#16A34A] dark:text-emerald-400 tabular-nums break-words mt-1"
              >
                <bdi dir="ltr">
                  {singleMetrics.periodInflow > 0 ? `+${formatNumber(singleMetrics.periodInflow)}` : "0"}
                </bdi>{" "}
                <span className="font-sans text-xs">{curShort}</span>
              </p>
            </div>

            <div className="rounded-xl border border-rose-500/25 bg-rose-500/[0.06] p-3 min-w-0">
              <p className="text-[11px] sm:text-xs font-black text-rose-800 dark:text-rose-300">
                المنصرف (-)
              </p>
              <p
                data-testid="statement-summary-outflow"
                className="text-sm sm:text-lg font-mono font-black text-[#DC2626] dark:text-rose-400 tabular-nums break-words mt-1"
              >
                <bdi dir="ltr">
                  {singleMetrics.periodOutflow > 0 ? `-${formatNumber(singleMetrics.periodOutflow)}` : "0"}
                </bdi>{" "}
                <span className="font-sans text-xs">{curShort}</span>
              </p>
            </div>
          </div>
        </section>
      )}

      {/* Period Filter Tabs (Default: last5 — all 5 visible without horizontal overflow) */}
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
              className={`flex-1 basis-[30%] sm:basis-0 py-2 px-1.5 text-[11px] sm:text-[11.5px] text-center leading-tight transition-all border-b-2 touch-manipulation cursor-pointer ${
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

      {/* Compact Previous Transactions Container (scaled down so Hero Summary remains primary focus) */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-7 gap-2 text-muted-foreground rounded-xl border border-border/60 bg-white/70 dark:bg-card/50">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
          <span className="text-xs font-bold">جارٍ تحميل كشف الحساب…</span>
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-white/70 dark:bg-card/50 py-7 px-4 text-center space-y-1.5">
          <FileSpreadsheet className="h-7 w-7 mx-auto text-muted-foreground/45" />
          <p className="text-xs font-black text-foreground">
            لا توجد معاملات بنكية مسجلة في هذه الفترة {isAllMode ? "" : `بعملة ${curName}`}
          </p>
          <p className="text-[10.5px] font-medium text-muted-foreground max-w-sm mx-auto">
            أدخل رصيدك البنكي الفعلي من زر «مطابقة الرصيد» أعلاه، وسيتم تسجيل كافة التحصيلات والمشتريات والمصروفات هنا تلقائياً.
          </p>
        </div>
      ) : (
        <div
          data-testid="bank-statement-transactions-list"
          className="max-h-[38vh] sm:max-h-[42vh] overflow-y-auto overscroll-y-contain rounded-xl border border-border/60 bg-slate-50/70 dark:bg-muted/20 p-2 space-y-1.5 w-full min-w-0"
        >
          {filteredItems.map((item) => (
            <StatementTransactionCard
              key={`${item.currency}-${item.id}`}
              item={item}
              curShort={getCurrencyShortLabel(item.currency)}
              showCurrencyTag={isAllMode}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function StatementTransactionCard({
  item,
  curShort,
  showCurrencyTag,
}: {
  item: BankStatementItem;
  curShort: string;
  showCurrencyTag: boolean;
}) {
  const isIn = item.direction === "in";
  const emblemText = EMBLEM_WORD[item.currency] ?? item.currency;
  const cleanAmount = normalizeZero(item.amount);
  const cleanRunning = normalizeZero(item.runningBalance);
  const typeBadge = SOURCE_TYPE_LABELS[item.sourceType];

  return (
    <div
      data-testid={`statement-row-${item.direction}`}
      className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 rounded-lg border border-slate-200/90 dark:border-border/80 bg-white dark:bg-card px-2.5 py-2 sm:px-3 shadow-2xs transition-colors w-full min-w-0"
    >
      {/* Right Side (RTL Start): Circular Currency Emblem + Transaction Details */}
      <div className="flex items-start gap-2 min-w-0 flex-1">
        <div className="relative shrink-0 h-9 w-9 flex items-center justify-center mt-0.5">
          <div
            className={`h-8.5 w-8.5 rounded-full border-2 flex items-center justify-center ${
              isIn
                ? "border-[#16A34A] bg-emerald-50/70 dark:bg-emerald-950/30"
                : "border-[#DC2626] bg-rose-50/70 dark:bg-rose-950/30"
            }`}
          >
            <span
              className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-[8px] font-black text-white ${
                isIn ? "bg-[#16A34A]" : "bg-[#DC2626]"
              }`}
            >
              {emblemText}
            </span>
          </div>
          <span
            className={`absolute -top-1 -left-1 h-4 w-4 rounded-full bg-white dark:bg-card flex items-center justify-center shadow-2xs ${
              isIn ? "text-[#16A34A]" : "text-[#DC2626]"
            }`}
          >
            {isIn ? (
              <ArrowDown className="h-3 w-3 stroke-[2.75]" />
            ) : (
              <ArrowUp className="h-3 w-3 stroke-[2.75]" />
            )}
          </span>
        </div>

        {/* Center Details: Original Date + Type + Full Title + Subtitle + Running Balance */}
        <div className="min-w-0 flex-1 space-y-0.5 text-right">
          <div className="flex flex-wrap items-center gap-1">
            <bdi
              dir="ltr"
              className="text-[11px] font-mono font-bold text-slate-700 dark:text-slate-200 tabular-nums"
            >
              {formatBankakDate(item.occurredAt)}
            </bdi>
            {typeBadge && (
              <span
                className={`rounded-md px-1.5 py-0.2 text-[9px] font-black ${
                  isIn
                    ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                    : "bg-rose-500/10 text-rose-700 dark:text-rose-400"
                }`}
              >
                {typeBadge}
              </span>
            )}
            {showCurrencyTag && (
              <bdi
                dir="ltr"
                className="rounded-md bg-slate-100 dark:bg-muted px-1 py-0.2 text-[9px] font-mono font-black text-slate-600 dark:text-muted-foreground"
              >
                {item.currency}
              </bdi>
            )}
          </div>

          <p className="text-[11.5px] font-black text-slate-900 dark:text-white leading-snug break-words">
            {item.title}
          </p>

          {item.subtitle && (
            <p className="text-[10.5px] font-medium text-slate-500 dark:text-muted-foreground leading-snug break-words">
              {item.subtitle}
            </p>
          )}

          <p className="text-[10px] font-bold text-slate-500 dark:text-muted-foreground/90 break-words">
            <span>الرصيد بعد الحركة: </span>
            <bdi dir="ltr" className="font-mono font-black tabular-nums text-slate-700 dark:text-slate-200">
              {formatNumber(cleanRunning)}
            </bdi>{" "}
            <span>{curShort}</span>
          </p>
        </div>
      </div>

      {/* Left Side (RTL End on sm+, compact bottom bar on mobile): Signed Amount + Reference */}
      <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-start gap-1.5 border-t sm:border-t-0 border-border/50 pt-1.5 sm:pt-0 sm:shrink-0 text-left">
        <p
          className={`text-xs sm:text-sm font-mono font-black tabular-nums leading-tight ${
            isIn ? "text-[#16A34A] dark:text-emerald-400" : "text-[#DC2626] dark:text-rose-400"
          }`}
        >
          <bdi dir="ltr">
            {cleanAmount === 0 ? "0" : `${isIn ? "+" : "-"}${formatNumber(cleanAmount)}`}
          </bdi>{" "}
          <span className="font-sans text-[10.5px] font-black">{curShort}</span>
        </p>

        {item.reference && (
          <bdi
            dir="ltr"
            className="text-[9.5px] font-mono font-bold text-slate-500 dark:text-muted-foreground tabular-nums break-all sm:text-left"
          >
            {item.reference}
          </bdi>
        )}
      </div>
    </div>
  );
}

export default BankStatementView;
