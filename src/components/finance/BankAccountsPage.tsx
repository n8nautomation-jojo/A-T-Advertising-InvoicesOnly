import React, { useEffect, useState } from "react";
import { useNavigate, useRouter, useSearch } from "@tanstack/react-router";
import {
  ArrowRight,
  FileText,
  Landmark,
  Receipt,
  Scale,
  ShoppingBag,
  Wallet,
} from "lucide-react";
import { PageShell } from "@/components/layout/PageShell";
import { useBankTreasury } from "@/lib/bankTreasuryStore";
import { formatNumber } from "@/lib/printCalculator";
import { getCurrencyShortLabel } from "@/lib/currency/currencyFormat";
import { CURRENCY_LIST, sanitizeCurrency, type AppCurrency } from "@/lib/currency/types";
import type {
  BankAccountsRouteSearch,
  BankAccountsView,
  BankStatementCurrencyFilter,
} from "@/routes/bank-accounts";
import { BankStatementView } from "./BankStatementView";
import { BankReconciliationSheet } from "./BankReconciliationSheet";
import { ReceiptDialog } from "./ReceiptDialog";
import { SupplierPaymentDialog } from "./SupplierPaymentDialog";
import { ExpenseDialog } from "./ExpenseDialog";

const ACCOUNT_CARD_TITLES: Record<AppCurrency, string> = {
  SDG: "حساب الجنيه السوداني",
  USD: "حساب الدولار الأمريكي",
  SAR: "حساب الريال السعودي",
  EGP: "حساب الجنيه المصري",
};

const EMBLEM_BADGE: Record<AppCurrency, string> = {
  SDG: "جنيه",
  USD: "USD",
  SAR: "ريال",
  EGP: "ج.م",
};

function normalizeZero(value: number | undefined | null): number {
  const n = Number(value) || 0;
  return Math.abs(n) < 0.005 ? 0 : n;
}

interface BankAccountsPageProps {
  /** خصائص اختيارية للاختبار المباشر للمكون خارج Router إن لزم */
  initialViewOverride?: BankAccountsView;
  initialCurrencyOverride?: BankStatementCurrencyFilter;
}

/**
 * الصفحة المستقلة لكشف الحساب البنكي ومطابقة الرصيد (دون نافذة منبثقة Modal/Dialog).
 * تحافظ على الهوية البصرية واتجاه RTL مع هيدر علوي واضح ومباشر وشريط عملات يشمل خيار All.
 */
export function BankAccountsPage({
  initialViewOverride,
  initialCurrencyOverride,
}: BankAccountsPageProps = {}) {
  const navigate = useNavigate();
  const router = useRouter();
  const routeSearch = useSearch({ strict: false }) as BankAccountsRouteSearch | undefined;

  const { byCurrency, activeCurrency, setActiveCurrency, refresh } = useBankTreasury();

  const view: BankAccountsView = initialViewOverride ?? routeSearch?.view ?? "statement";
  const rawCur = initialCurrencyOverride ?? routeSearch?.currency ?? activeCurrency;
  const selectedCur: BankStatementCurrencyFilter =
    rawCur === "ALL" ? "ALL" : sanitizeCurrency(rawCur, "SDG");
  const reconcileCur: AppCurrency =
    selectedCur === "ALL" ? activeCurrency : selectedCur;
  const returnTo = routeSearch?.from;

  const [quickReceiptCur, setQuickReceiptCur] = useState<AppCurrency | null>(null);
  const [quickSupplierCur, setQuickSupplierCur] = useState<AppCurrency | null>(null);
  const [quickExpenseCur, setQuickExpenseCur] = useState<AppCurrency | null>(null);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (
      routeSearch?.currency &&
      routeSearch.currency !== "ALL" &&
      routeSearch.currency !== activeCurrency
    ) {
      setActiveCurrency(routeSearch.currency);
    }
  }, [routeSearch?.currency, activeCurrency, setActiveCurrency]);

  const navigateToView = (nextView: BankAccountsView, cur: BankStatementCurrencyFilter) => {
    if (cur !== "ALL") {
      setActiveCurrency(cur);
    }
    void navigate({
      to: "/bank-accounts",
      search: {
        view: nextView,
        currency: cur,
        from: returnTo,
      },
    });
  };

  const handleBack = () => {
    if (view === "reconcile") {
      navigateToView("statement", selectedCur);
      return;
    }
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.history.back();
      return;
    }
    const target = returnTo && returnTo.startsWith("/") ? returnTo : "/";
    void navigate({ to: target as "/" });
  };

  const selectedSummary = byCurrency[reconcileCur];

  return (
    <PageShell>
      <main
        dir="rtl"
        data-testid="bank-accounts-page"
        className="w-full flex-1 min-h-0 overflow-y-auto overscroll-y-contain px-3 py-3 md:px-6 md:py-5 min-w-0 pb-36 md:pb-16"
      >
        <div className="mx-auto max-w-4xl w-full min-w-0 space-y-3.5">
          {/* Top Crimson-Accented Banking Header: Enlarged prominent title, single Back button, no subtitle, no "كل الحسابات" */}
          <header className="bg-gradient-to-l from-[#B71C1C] to-[#D32F2F] text-white px-4 py-3.5 sm:px-5 sm:py-4 rounded-2xl shadow-sm w-full min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-2.5 min-w-0">
              <div className="flex items-center gap-2.5 sm:gap-3 min-w-0 flex-1">
                <button
                  type="button"
                  data-testid="bank-accounts-back-btn"
                  onClick={handleBack}
                  aria-label="رجوع"
                  className="inline-flex h-9 shrink-0 items-center gap-1 rounded-xl bg-white/15 hover:bg-white/25 border border-white/25 px-2.5 text-xs font-black text-white transition-colors active:scale-95 cursor-pointer touch-manipulation"
                >
                  <ArrowRight className="h-4 w-4 shrink-0" />
                  <span>رجوع</span>
                </button>

                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/15 border border-white/25">
                  <Landmark className="h-5 w-5 text-white" />
                </span>

                <h1 className="text-lg sm:text-xl font-black text-white leading-tight tracking-tight break-words min-w-0 flex-1">
                  {view === "statement"
                    ? "كشف الحساب البنكي"
                    : view === "reconcile"
                    ? "مطابقة وتغذية الرصيد البنكي"
                    : "تفاصيل الحسابات البنكية"}
                </h1>
              </div>
            </div>
          </header>

          {/* Dedicated View Content */}
          {view === "accounts" && (
            <div
              className="grid grid-cols-1 md:grid-cols-2 gap-3 w-full min-w-0"
              data-testid="bank-accounts-cards-list"
            >
              {CURRENCY_LIST.map((cfg) => {
                const summary = byCurrency[cfg.code];
                const curShort = getCurrencyShortLabel(cfg.code);
                const accNum = summary.primaryAccount.accountNumber;
                const isPrimary = cfg.code === activeCurrency;
                const cleanBalance = normalizeZero(summary.balance);

                return (
                  <div
                    key={cfg.code}
                    data-testid={`bank-account-card-${cfg.code}`}
                    className={`rounded-2xl border bg-white dark:bg-card shadow-xs overflow-hidden transition-all w-full min-w-0 flex flex-col justify-between ${
                      isPrimary
                        ? "border-[#C62828]/45 ring-1 ring-[#C62828]/15"
                        : "border-slate-200/90 dark:border-border/80"
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2.5 p-3.5 sm:p-4 min-w-0">
                      <div className="flex items-start gap-2.5 sm:gap-3 min-w-0 flex-1">
                        <div
                          className={`h-11 w-11 rounded-2xl flex flex-col items-center justify-center shrink-0 border ${
                            cfg.code === "SDG"
                              ? "bg-[#D32F2F] text-white border-[#B71C1C]"
                              : "bg-rose-50 dark:bg-rose-950/30 text-[#B71C1C] dark:text-rose-300 border-[#C62828]/30"
                          }`}
                        >
                          <Landmark className="h-4.5 w-4.5" />
                          <span className="text-[8.5px] font-mono font-black leading-none mt-0.5">
                            {cfg.code}
                          </span>
                        </div>

                        <div className="min-w-0 text-right space-y-0.5">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <h2 className="text-sm font-black text-[#B71C1C] dark:text-rose-400 leading-snug break-words">
                              {ACCOUNT_CARD_TITLES[cfg.code]}
                            </h2>
                            <span className="text-xs select-none">{cfg.flag}</span>
                          </div>
                          <p className="text-[11px] font-bold text-slate-600 dark:text-muted-foreground break-words">
                            {summary.primaryAccount.name}
                          </p>
                          <p className="text-[11px] font-bold text-slate-500 dark:text-muted-foreground break-words">
                            {accNum ? (
                              <>
                                <span>الحساب: </span>
                                <bdi dir="ltr" className="font-mono tabular-nums">
                                  {accNum}
                                </bdi>
                              </>
                            ) : (
                              <>
                                <span>العملة: </span>
                                <bdi dir="ltr" className="font-mono">
                                  {cfg.code}
                                </bdi>
                              </>
                            )}
                          </p>
                        </div>
                      </div>

                      <button
                        type="button"
                        data-testid={`bank-card-balance-${cfg.code}`}
                        onClick={() => navigateToView("statement", cfg.code)}
                        title={`عرض كشف حساب ${ACCOUNT_CARD_TITLES[cfg.code]}`}
                        className="shrink-0 flex flex-col items-end gap-1 text-left rounded-xl p-1 -m-1 hover:bg-emerald-500/5 transition-colors cursor-pointer"
                      >
                        <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border-2 border-[#C62828] bg-[#C62828] text-[8.5px] font-black text-white shadow-2xs">
                          {EMBLEM_BADGE[cfg.code]}
                        </span>
                        <p
                          className={`text-base sm:text-lg font-mono font-black tabular-nums leading-tight ${
                            cleanBalance < 0
                              ? "text-[#DC2626] dark:text-rose-400"
                              : "text-[#16A34A] dark:text-emerald-400"
                          }`}
                        >
                          <bdi dir="ltr">{formatNumber(cleanBalance)}</bdi>{" "}
                          <span className="font-sans text-xs sm:text-sm">{curShort}</span>
                        </p>
                      </button>
                    </div>

                    <div>
                      <div className="grid grid-cols-2 border-t border-slate-200/80 dark:border-border/70 bg-slate-50/60 dark:bg-muted/20 divide-x divide-x-reverse divide-slate-200 dark:divide-border/70">
                        <button
                          type="button"
                          data-testid={`open-statement-btn-${cfg.code}`}
                          onClick={() => navigateToView("statement", cfg.code)}
                          className="flex items-center justify-center gap-1.5 py-2.5 px-2 text-[11.5px] sm:text-xs font-black text-slate-800 dark:text-foreground hover:bg-slate-100 dark:hover:bg-muted/50 transition-colors cursor-pointer touch-manipulation text-center leading-snug"
                        >
                          <FileText className="h-4 w-4 shrink-0 text-slate-600 dark:text-muted-foreground" />
                          <span>عرض كشف الحساب</span>
                        </button>

                        <button
                          type="button"
                          data-testid={`open-reconcile-btn-${cfg.code}`}
                          onClick={() => navigateToView("reconcile", cfg.code)}
                          className="flex items-center justify-center gap-1.5 py-2.5 px-2 text-[11.5px] sm:text-xs font-black text-slate-800 dark:text-foreground hover:bg-slate-100 dark:hover:bg-muted/50 transition-colors cursor-pointer touch-manipulation text-center leading-snug"
                        >
                          <Scale className="h-4 w-4 shrink-0 text-[#16A34A]" />
                          <span>مطابقة وتحديث الرصيد</span>
                        </button>
                      </div>

                      <div className="grid grid-cols-3 gap-1 border-t border-slate-100 dark:border-border/40 bg-white dark:bg-card px-2 py-1.5">
                        <button
                          type="button"
                          onClick={() => setQuickReceiptCur(cfg.code)}
                          className="inline-flex items-center justify-center gap-1 rounded-lg py-1.5 px-1 text-[10.5px] font-black text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/10 transition-colors cursor-pointer"
                        >
                          <Receipt className="h-3 w-3 shrink-0" />
                          <span>+ تحصيل</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setQuickSupplierCur(cfg.code)}
                          className="inline-flex items-center justify-center gap-1 rounded-lg py-1.5 px-1 text-[10.5px] font-black text-rose-700 dark:text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer"
                        >
                          <ShoppingBag className="h-3 w-3 shrink-0" />
                          <span>- مشتريات</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setQuickExpenseCur(cfg.code)}
                          className="inline-flex items-center justify-center gap-1 rounded-lg py-1.5 px-1 text-[10.5px] font-black text-rose-700 dark:text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer"
                        >
                          <Wallet className="h-3 w-3 shrink-0" />
                          <span>- مصروف</span>
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {view === "statement" && (
            <BankStatementView
              currency={selectedCur}
              hideInlineBack
              standalonePage
              onChangeCurrency={(nextCur) => navigateToView("statement", nextCur)}
              onOpenReconcile={() => navigateToView("reconcile", reconcileCur)}
            />
          )}

          {view === "reconcile" && (
            <BankReconciliationSheet
              currency={reconcileCur}
              account={selectedSummary.primaryAccount}
              currentBalance={selectedSummary.balance}
              hideInlineBack
              onCompleted={() => navigateToView("statement", reconcileCur)}
            />
          )}
        </div>
      </main>

      {/* Connected Quick Action Dialogs */}
      <ReceiptDialog
        open={Boolean(quickReceiptCur)}
        onOpenChange={(v) => !v && setQuickReceiptCur(null)}
        defaultCurrency={quickReceiptCur ?? activeCurrency}
        onRecorded={() => void refresh()}
      />
      <SupplierPaymentDialog
        open={Boolean(quickSupplierCur)}
        onOpenChange={(v) => !v && setQuickSupplierCur(null)}
        defaultCurrency={quickSupplierCur ?? activeCurrency}
        onRecorded={() => void refresh()}
      />
      <ExpenseDialog
        open={Boolean(quickExpenseCur)}
        onOpenChange={(v) => !v && setQuickExpenseCur(null)}
        defaultCurrency={quickExpenseCur ?? activeCurrency}
        onSaved={() => void refresh()}
      />
    </PageShell>
  );
}

export default BankAccountsPage;
