import React, { useEffect, useState } from "react";
import {
  FileText,
  Landmark,
  Receipt,
  Scale,
  ShoppingBag,
  Wallet,
  X,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useBankTreasury } from "@/lib/bankTreasuryStore";
import { formatNumber } from "@/lib/printCalculator";
import { getCurrencyShortLabel } from "@/lib/currency/currencyFormat";
import { CURRENCY_LIST, type AppCurrency } from "@/lib/currency/types";
import { BankStatementView } from "./BankStatementView";
import { BankReconciliationSheet } from "./BankReconciliationSheet";
import { ReceiptDialog } from "./ReceiptDialog";
import { SupplierPaymentDialog } from "./SupplierPaymentDialog";
import { ExpenseDialog } from "./ExpenseDialog";

interface BankAccountsHubModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialCurrency?: AppCurrency;
  initialView?: "accounts" | "statement" | "reconcile";
}

type HubView = "accounts" | "statement" | "reconcile";

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

export function BankAccountsHubModal({
  open,
  onOpenChange,
  initialCurrency,
  initialView = "accounts",
}: BankAccountsHubModalProps) {
  const { byCurrency, activeCurrency, setActiveCurrency, refresh } = useBankTreasury();

  const [view, setView] = useState<HubView>(initialView);
  const [selectedCur, setSelectedCur] = useState<AppCurrency>(initialCurrency ?? activeCurrency);

  const [quickReceiptCur, setQuickReceiptCur] = useState<AppCurrency | null>(null);
  const [quickSupplierCur, setQuickSupplierCur] = useState<AppCurrency | null>(null);
  const [quickExpenseCur, setQuickExpenseCur] = useState<AppCurrency | null>(null);

  useEffect(() => {
    if (!open) return;
    setView(initialView);
    if (initialCurrency) {
      setSelectedCur(initialCurrency);
    }
    void refresh();
  }, [open, initialCurrency, initialView, refresh]);

  const openStatementFor = (cur: AppCurrency) => {
    setSelectedCur(cur);
    setActiveCurrency(cur);
    setView("statement");
  };

  const openReconcileFor = (cur: AppCurrency) => {
    setSelectedCur(cur);
    setActiveCurrency(cur);
    setView("reconcile");
  };

  const selectedSummary = byCurrency[selectedCur];

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          dir="rtl"
          data-testid="bank-accounts-hub-modal"
          className="max-w-lg max-h-[92vh] overflow-y-auto overscroll-y-contain bg-slate-50 dark:bg-background p-0 gap-0 border-border/80"
        >
          {/* Top Crimson-Accented Banking Header */}
          <DialogHeader className="bg-gradient-to-l from-[#B71C1C] to-[#D32F2F] text-white px-4 py-3.5 rounded-t-lg">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-white/15 border border-white/25">
                  <Landmark className="h-4.5 w-4.5 text-white" />
                </span>
                <div className="text-right">
                  <DialogTitle className="text-sm sm:text-base font-black text-white">
                    {view === "accounts"
                      ? "تفاصيل الحسابات البنكية"
                      : view === "statement"
                      ? "كشف الحساب البنكي"
                      : "مطابقة وتغذية الرصيد البنكي"}
                  </DialogTitle>
                  <p className="text-[10.5px] font-bold text-white/85">
                    4 حسابات مستقلة (جنيه سوداني · دولار · ريال · جنيه مصري)
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => onOpenChange(false)}
                aria-label="إغلاق نافذة الحسابات"
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-white/15 hover:bg-white/25 text-white transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </DialogHeader>

          <div className="p-3.5 sm:p-4 space-y-3">
            {view === "accounts" && (
              <>
                <div className="space-y-3" data-testid="bank-accounts-cards-list">
                  {CURRENCY_LIST.map((cfg) => {
                    const summary = byCurrency[cfg.code];
                    const curShort = getCurrencyShortLabel(cfg.code);
                    const accNum = summary.primaryAccount.accountNumber;
                    const isPrimary = cfg.code === activeCurrency;

                    return (
                      <div
                        key={cfg.code}
                        data-testid={`bank-account-card-${cfg.code}`}
                        className={`rounded-2xl border bg-white dark:bg-card shadow-xs overflow-hidden transition-all ${
                          isPrimary
                            ? "border-[#C62828]/45 ring-1 ring-[#C62828]/15"
                            : "border-slate-200/90 dark:border-border/80"
                        }`}
                      >
                        {/* Upper Account Card Info (Bankak image_2.png layout) */}
                        <div className="flex items-start justify-between gap-3 p-3.5 sm:p-4">
                          {/* Right Side: Money Bag / Vault Icon + Account Title + Account Number */}
                          <div className="flex items-start gap-3 min-w-0">
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
                                <h4 className="text-sm font-black text-[#B71C1C] dark:text-rose-400">
                                  {ACCOUNT_CARD_TITLES[cfg.code]}
                                </h4>
                                <span className="text-xs select-none">{cfg.flag}</span>
                              </div>
                              <p className="text-[11px] font-bold text-slate-600 dark:text-muted-foreground">
                                {summary.primaryAccount.name}
                              </p>
                              <p
                                className="text-[11px] font-mono font-bold text-slate-500 dark:text-muted-foreground"
                                dir="ltr"
                              >
                                {accNum ? `الحساب - ${accNum}` : `العملة - ${cfg.code}`}
                              </p>
                            </div>
                          </div>

                          {/* Left Side: Circular Currency Emblem + Bold Green Live Balance */}
                          <div className="shrink-0 flex flex-col items-end gap-1 text-left">
                            <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border-2 border-[#C62828] bg-[#C62828] text-[8.5px] font-black text-white shadow-2xs">
                              {EMBLEM_BADGE[cfg.code]}
                            </span>
                            <p
                              data-testid={`bank-card-balance-${cfg.code}`}
                              className={`text-base sm:text-lg font-mono font-black tabular-nums ${
                                summary.balance < 0
                                  ? "text-[#DC2626] dark:text-rose-400"
                                  : "text-[#16A34A] dark:text-emerald-400"
                              }`}
                              dir="ltr"
                            >
                              {formatNumber(summary.balance)} {curShort}
                            </p>
                          </div>
                        </div>

                        {/* Middle Divider Action Row: عرض كشف الحساب | مطابقة الرصيد (image_2.png) */}
                        <div className="grid grid-cols-2 border-t border-slate-200/80 dark:border-border/70 bg-slate-50/60 dark:bg-muted/20 divide-x divide-x-reverse divide-slate-200 dark:divide-border/70">
                          <button
                            type="button"
                            data-testid={`open-statement-btn-${cfg.code}`}
                            onClick={() => openStatementFor(cfg.code)}
                            className="flex items-center justify-center gap-2 py-2.5 px-2 text-xs font-black text-slate-800 dark:text-foreground hover:bg-slate-100 dark:hover:bg-muted/50 transition-colors cursor-pointer touch-manipulation"
                          >
                            <FileText className="h-4 w-4 text-slate-600 dark:text-muted-foreground" />
                            <span>عرض كشف الحساب</span>
                          </button>

                          <button
                            type="button"
                            data-testid={`open-reconcile-btn-${cfg.code}`}
                            onClick={() => openReconcileFor(cfg.code)}
                            className="flex items-center justify-center gap-2 py-2.5 px-2 text-xs font-black text-slate-800 dark:text-foreground hover:bg-slate-100 dark:hover:bg-muted/50 transition-colors cursor-pointer touch-manipulation"
                          >
                            <Scale className="h-4 w-4 text-[#16A34A]" />
                            <span>مطابقة وتحديث الرصيد</span>
                          </button>
                        </div>

                        {/* Connected Operational Quick Actions for this Currency */}
                        <div className="grid grid-cols-3 gap-1 border-t border-slate-100 dark:border-border/40 bg-white dark:bg-card px-2.5 py-1.5">
                          <button
                            type="button"
                            onClick={() => setQuickReceiptCur(cfg.code)}
                            className="inline-flex items-center justify-center gap-1 rounded-lg py-1.5 text-[10.5px] font-black text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/10 transition-colors"
                          >
                            <Receipt className="h-3 w-3" />
                            <span>+ تحصيل</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setQuickSupplierCur(cfg.code)}
                            className="inline-flex items-center justify-center gap-1 rounded-lg py-1.5 text-[10.5px] font-black text-rose-700 dark:text-rose-400 hover:bg-rose-500/10 transition-colors"
                          >
                            <ShoppingBag className="h-3 w-3" />
                            <span>- مشتريات</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setQuickExpenseCur(cfg.code)}
                            className="inline-flex items-center justify-center gap-1 rounded-lg py-1.5 text-[10.5px] font-black text-rose-700 dark:text-rose-400 hover:bg-rose-500/10 transition-colors"
                          >
                            <Wallet className="h-3 w-3" />
                            <span>- مصروف</span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {view === "statement" && (
              <BankStatementView
                currency={selectedCur}
                onBack={() => setView("accounts")}
                onOpenReconcile={() => setView("reconcile")}
              />
            )}

            {view === "reconcile" && (
              <BankReconciliationSheet
                currency={selectedCur}
                account={selectedSummary.primaryAccount}
                currentBalance={selectedSummary.balance}
                onBack={() => setView("accounts")}
                onCompleted={() => setView("statement")}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Connected Quick Dialogs (100% unified with the rest of the app) */}
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
    </>
  );
}

export default BankAccountsHubModal;
