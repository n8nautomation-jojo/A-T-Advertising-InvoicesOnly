import React from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { ChevronLeft, FileSpreadsheet, Landmark } from "lucide-react";
import { useBankTreasury } from "@/lib/bankTreasuryStore";
import { formatNumber } from "@/lib/printCalculator";
import { getCurrencyShortLabel } from "@/lib/currency/currencyFormat";
import { CURRENCY_LIST, type AppCurrency } from "@/lib/currency/types";

interface BankBalanceGreetingWidgetProps {
  /** عند التمرير من صفحة المالية لربط التبديل مع فلتر العملة بالصفحة */
  syncedCurrency?: AppCurrency;
  onCurrencySelected?: (currency: AppCurrency) => void;
  compact?: boolean;
}

function normalizeZero(value: number | undefined | null): number {
  const n = Number(value) || 0;
  return Math.abs(n) < 0.005 ? 0 : n;
}

/**
 * مستطيل الرصيد البنكي التفاعلي بجوار رسالة الترحيب (وفي صفحة المالية).
 * يعرض الرصيد البنكي الحي للعملة النشطة، وينقل المستخدم مباشرة إلى الصفحة المستقلة
 * لتفاصيل الحسابات البنكية أو صفحة كشف الحساب دون أي نافذة منبثقة (UX-001, UX-002).
 */
export function BankBalanceGreetingWidget({
  syncedCurrency,
  onCurrencySelected,
  compact = false,
}: BankBalanceGreetingWidgetProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { activeCurrency, setActiveCurrency, byCurrency } = useBankTreasury();

  const displayCurrency = syncedCurrency ?? activeCurrency;
  const summary = byCurrency[displayCurrency];
  const curShort = getCurrencyShortLabel(displayCurrency);
  const accNumber = summary.primaryAccount.accountNumber;
  const cleanBalance = normalizeZero(summary.balance);

  const navigateToBankPage = (view: "accounts" | "statement") => {
    setActiveCurrency(displayCurrency);
    void navigate({
      to: "/bank-accounts",
      search: {
        view,
        currency: displayCurrency,
        from: location.pathname || "/",
      },
    });
  };

  const handlePickCurrency = (e: React.MouseEvent, code: AppCurrency) => {
    e.stopPropagation();
    setActiveCurrency(code);
    onCurrencySelected?.(code);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      data-testid="bank-balance-greeting-widget"
      onClick={() => navigateToBankPage("accounts")}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          navigateToBankPage("accounts");
        }
      }}
      title="اضغط للانتقال إلى صفحة الحسابات الأربعة وكشف الحساب البنكي ومطابقة الرصيد"
      className={`group relative rounded-2xl border border-emerald-600/30 dark:border-emerald-500/30 bg-white/95 dark:bg-card/95 hover:border-emerald-600/60 shadow-xs hover:shadow-sm transition-all cursor-pointer select-none text-right w-full sm:w-auto max-w-full min-w-0 ${
        compact ? "px-3 py-2" : "px-3.5 py-2.5 sm:min-w-[265px]"
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-emerald-500/12 text-[#16A34A] dark:text-emerald-400 border border-emerald-500/25">
            <Landmark className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[10.5px] font-black text-muted-foreground">
                الرصيد البنكي
              </span>
              {accNumber && (
                <bdi
                  dir="ltr"
                  className="rounded bg-muted px-1.5 py-0.2 text-[9.5px] font-mono font-bold text-muted-foreground"
                >
                  #{accNumber}
                </bdi>
              )}
            </div>
            <p
              data-testid="bank-greeting-live-balance"
              className={`text-sm sm:text-base font-mono font-black tabular-nums leading-tight break-words ${
                cleanBalance < 0
                  ? "text-[#DC2626] dark:text-rose-400"
                  : "text-[#16A34A] dark:text-emerald-400"
              }`}
            >
              <bdi dir="ltr">{formatNumber(cleanBalance)}</bdi>{" "}
              <span className="font-sans text-xs sm:text-sm">{curShort}</span>
            </p>
          </div>
        </div>

        <button
          type="button"
          data-testid="bank-greeting-direct-statement-btn"
          onClick={(e) => {
            e.stopPropagation();
            navigateToBankPage("statement");
          }}
          className="inline-flex items-center gap-0.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/25 px-2 py-1 text-[10px] font-black text-emerald-700 dark:text-emerald-300 shrink-0 transition-colors cursor-pointer"
        >
          <FileSpreadsheet className="h-3 w-3" />
          <span>كشف الحساب</span>
          <ChevronLeft className="h-3 w-3" />
        </button>
      </div>

      {/* 4-Currency Quick Selector Pills inside the rectangle */}
      <div className="mt-2 pt-1.5 border-t border-border/50 flex flex-wrap items-center justify-between gap-1.5">
        <div className="flex flex-wrap items-center gap-1">
          {CURRENCY_LIST.map((cfg) => {
            const active = cfg.code === displayCurrency;
            return (
              <button
                key={cfg.code}
                type="button"
                data-testid={`widget-currency-pill-${cfg.code}`}
                onClick={(e) => handlePickCurrency(e, cfg.code)}
                className={`rounded-md px-1.5 py-0.5 text-[9.5px] font-mono font-black transition-all cursor-pointer ${
                  active
                    ? "bg-[#C62828] text-white shadow-2xs"
                    : "bg-muted/60 text-muted-foreground hover:text-foreground hover:bg-muted"
                }`}
              >
                {cfg.code}
              </button>
            );
          })}
        </div>
        <span className="text-[9.5px] font-bold text-muted-foreground group-hover:text-primary transition-colors">
          4 حسابات ‹
        </span>
      </div>
    </div>
  );
}

export default BankBalanceGreetingWidget;
