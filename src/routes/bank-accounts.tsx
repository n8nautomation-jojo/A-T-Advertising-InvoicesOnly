import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";
import { isValidCurrency, type AppCurrency } from "@/lib/currency/types";

export type BankAccountsView = "accounts" | "statement" | "reconcile";

export interface BankAccountsRouteSearch {
  view?: BankAccountsView;
  currency?: AppCurrency;
  from?: string;
}

function parseView(val: unknown): BankAccountsView | undefined {
  if (val === "accounts" || val === "statement" || val === "reconcile") return val;
  return undefined;
}

export const Route = createFileRoute("/bank-accounts")({
  validateSearch: (search: Record<string, unknown>): BankAccountsRouteSearch => ({
    view: parseView(search.view),
    currency: isValidCurrency(search.currency) ? search.currency : undefined,
    from: typeof search.from === "string" && search.from.startsWith("/") ? search.from : undefined,
  }),
  component: lazyRouteComponent(
    () => import("@/components/finance/BankAccountsPage"),
    "BankAccountsPage"
  ),
});
