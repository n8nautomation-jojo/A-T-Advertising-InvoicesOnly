import { useCallback, useEffect, useSyncExternalStore } from "react";
import { STANDARD_CURRENCY_ACCOUNTS } from "@/lib/database/schema";
import {
  CURRENCY_LIST,
  DEFAULT_CURRENCY,
  sanitizeCurrency,
  type AppCurrency,
} from "@/lib/currency/types";
import {
  getPreferredAccountForCurrency,
  type AccountBalanceReport,
  type FinancialAccount,
} from "@/lib/domain/finance";
import {
  ensureStandardCurrencyAccounts,
  getAccountBalances,
} from "@/lib/repositories/FinancialAccountRepository";
import { getUnpaidPurchaseTotalsByCurrency } from "@/lib/repositories/LedgerRepository";

export interface CurrencyBankSummary {
  currency: AppCurrency;
  balance: number;
  inflow: number;
  outflow: number;
  primaryAccount: FinancialAccount;
  accounts: AccountBalanceReport[];
}

interface BankTreasurySnapshot {
  loaded: boolean;
  activeCurrency: AppCurrency;
  byCurrency: Record<AppCurrency, CurrencyBankSummary>;
}

const STORAGE_CURRENCY_KEY = "ta_bank_widget_currency";

function readInitialCurrency(): AppCurrency {
  if (typeof window === "undefined") return DEFAULT_CURRENCY;
  try {
    return sanitizeCurrency(window.localStorage.getItem(STORAGE_CURRENCY_KEY), DEFAULT_CURRENCY);
  } catch {
    return DEFAULT_CURRENCY;
  }
}

function buildFallbackByCurrency(): Record<AppCurrency, CurrencyBankSummary> {
  const nowIso = "2026-01-01T00:00:00.000Z";
  const map = {} as Record<AppCurrency, CurrencyBankSummary>;
  for (const cfg of CURRENCY_LIST) {
    const spec = STANDARD_CURRENCY_ACCOUNTS.find((s) => s.currency === cfg.code);
    const fallbackAccount: FinancialAccount = {
      id: spec?.id ?? `acc-bank-${cfg.code.toLowerCase()}`,
      name: spec?.name ?? `حساب ${cfg.nameAr}`,
      kind: (spec?.kind ?? "bank") as FinancialAccount["kind"],
      currency: cfg.code,
      accountNumber: spec?.defaultAccountNumber || undefined,
      openingBalance: 0,
      isActive: true,
      createdAt: nowIso,
    };
    map[cfg.code] = {
      currency: cfg.code,
      balance: 0,
      inflow: 0,
      outflow: 0,
      primaryAccount: fallbackAccount,
      accounts: [],
    };
  }
  return map;
}

let snapshot: BankTreasurySnapshot = {
  loaded: false,
  activeCurrency: readInitialCurrency(),
  byCurrency: buildFallbackByCurrency(),
};

const listeners = new Set<() => void>();
let inflightRefresh: Promise<void> | null = null;

function emit() {
  listeners.forEach((fn) => fn());
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function getSnapshot(): BankTreasurySnapshot {
  return snapshot;
}

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export function setActiveBankWidgetCurrency(currency: AppCurrency): void {
  const safe = sanitizeCurrency(currency, DEFAULT_CURRENCY);
  if (snapshot.activeCurrency === safe) return;
  snapshot = { ...snapshot, activeCurrency: safe };
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_CURRENCY_KEY, safe);
    } catch {
      // ignore storage quota errors
    }
  }
  emit();
}

export async function refreshBankTreasury(): Promise<void> {
  if (inflightRefresh) return inflightRefresh;
  inflightRefresh = (async () => {
    try {
      let [reports, unpaidPurchases] = await Promise.all([
        getAccountBalances(),
        getUnpaidPurchaseTotalsByCurrency(),
      ]);
      const presentCurrencies = new Set(
        reports.map((r) => sanitizeCurrency(r.account.currency, DEFAULT_CURRENCY))
      );
      if (presentCurrencies.size < CURRENCY_LIST.length) {
        await ensureStandardCurrencyAccounts().catch(() => {});
        reports = await getAccountBalances();
      }

      const nextByCur = buildFallbackByCurrency();
      for (const cfg of CURRENCY_LIST) {
        const curReports = reports.filter(
          (r) => sanitizeCurrency(r.account.currency, DEFAULT_CURRENCY) === cfg.code
        );
        const unpaidPur = unpaidPurchases[cfg.code] ?? 0;
        if (curReports.length > 0) {
          const preferred =
            getPreferredAccountForCurrency(
              curReports.map((r) => r.account),
              cfg.code
            ) ?? curReports[0].account;
          const ledgerBalance = round2(curReports.reduce((s, r) => s + r.balance, 0));
          const ledgerInflow = round2(curReports.reduce((s, r) => s + r.inflow, 0));
          const ledgerOutflow = round2(curReports.reduce((s, r) => s + r.outflow, 0));
          nextByCur[cfg.code] = {
            currency: cfg.code,
            balance: round2(ledgerBalance - unpaidPur),
            inflow: ledgerInflow,
            outflow: round2(ledgerOutflow + unpaidPur),
            primaryAccount: preferred,
            accounts: curReports,
          };
        } else if (unpaidPur > 0.004) {
          nextByCur[cfg.code] = {
            ...nextByCur[cfg.code],
            balance: round2(-unpaidPur),
            outflow: unpaidPur,
          };
        }
      }

      snapshot = {
        ...snapshot,
        loaded: true,
        byCurrency: nextByCur,
      };
      emit();
    } catch {
      // Browser/no-SQLite preview mode: keep zero-balance fallback safely
      if (!snapshot.loaded) {
        snapshot = { ...snapshot, loaded: true };
        emit();
      }
    } finally {
      inflightRefresh = null;
    }
  })();
  return inflightRefresh;
}

export function resetBankTreasuryForTests(): void {
  snapshot = {
    loaded: false,
    activeCurrency: DEFAULT_CURRENCY,
    byCurrency: buildFallbackByCurrency(),
  };
  emit();
}

if (typeof window !== "undefined") {
  window.addEventListener("native-storage-ready", () => {
    void refreshBankTreasury();
  });
  window.addEventListener("finance-changed", () => {
    void refreshBankTreasury();
  });
}

export function useBankTreasury() {
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    if (!state.loaded) {
      void refreshBankTreasury();
    }
  }, [state.loaded]);

  const setCurrency = useCallback((cur: AppCurrency) => {
    setActiveBankWidgetCurrency(cur);
  }, []);

  return {
    loaded: state.loaded,
    activeCurrency: state.activeCurrency,
    setActiveCurrency: setCurrency,
    currentSummary: state.byCurrency[state.activeCurrency],
    byCurrency: state.byCurrency,
    refresh: refreshBankTreasury,
  };
}
