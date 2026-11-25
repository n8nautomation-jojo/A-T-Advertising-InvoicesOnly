import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";
import { isValidCurrency, type AppCurrency } from "@/lib/currency/types";

export type BankAccountsView = "accounts" | "statement" | "reconcile";
export type BankStatementCurrencyFilter = AppCurrency | "ALL";

export interface BankAccountsRouteSearch {
  view?: BankAccountsView;
  currency?: BankStatementCurrencyFilter;
  from?: string;
}

function parseView(val: unknown): BankAccountsView | undefined {
  if (val === "accounts" || val === "statement" || val === "reconcile") return val;
  return undefined;
}

function parseCurrencyFilter(val: unknown): BankStatementCurrencyFilter | undefined {
  if (val === "ALL" || val === "all") return "ALL";
  if (isValidCurrency(val)) return val;
  return undefined;
}

export const Route = createFileRoute("/bank-accounts")({
  validateSearch: (search: Record<string, unknown>): BankAccountsRouteSearch => ({
    view: parseView(search.view),
    currency: parseCurrencyFilter(search.currency),
    from: typeof search.from === "string" && search.from.startsWith("/") ? search.from : undefined,
  }),
  component: lazyRouteComponent(
    () => import("@/components/finance/BankAccountsPage"),
    "BankAccountsPage"
  ),
});
