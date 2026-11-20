import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";
import type { ReportTab } from "@/components/reports/ReportsIconCards";

export interface ReportsRouteSearch {
  tab?: ReportTab;
  customerId?: string;
  supplierId?: string;
}

const VALID_TABS = new Set<string>(["performance", "sales", "collections", "purchases", "cash", "statements"]);

export const Route = createFileRoute("/reports")({
  validateSearch: (search: Record<string, unknown>): ReportsRouteSearch => ({
    tab: typeof search.tab === "string" && VALID_TABS.has(search.tab) ? (search.tab as ReportTab) : undefined,
    customerId: typeof search.customerId === "string" && search.customerId.trim() ? search.customerId : undefined,
    supplierId: typeof search.supplierId === "string" && search.supplierId.trim() ? search.supplierId : undefined,
  }),
  component: lazyRouteComponent(() => import("@/components/reports/ReportsWorkspace"), "ReportsWorkspace"),
});
