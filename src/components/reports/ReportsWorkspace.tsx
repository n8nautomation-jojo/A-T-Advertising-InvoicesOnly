import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { useSearch } from "@tanstack/react-router";
import { PageShell } from "@/components/layout/PageShell";
import { useCustomers } from "@/lib/customersStore";
import { getAllSuppliers, type Supplier } from "@/lib/repositories/SupplierRepository";
import {
  getCashMovementReport,
  getCustomerCollectionsReport,
  getCustomerStatement,
  getFinancialPerformanceReport,
  getPurchasesReport,
  getSalesPerformance,
  getSupplierStatement,
  type CashMovementReport,
  type CustomerCollectionsReport,
  type CustomerStatement,
  type FinancialPerformanceReport,
  type PurchasesReport,
  type SalesPerformance,
  type SupplierStatement,
} from "@/lib/repositories/ReportsRepository";
import { DEFAULT_CURRENCY, isValidCurrency, type AppCurrency } from "@/lib/currency/types";

import { ReportsHeader } from "./ReportsHeader";
import { ReportsIconCards, type ReportTab } from "./ReportsIconCards";
import { ReportsPerformanceView } from "./ReportsPerformanceView";
import { ReportsSalesCollectionsView } from "./ReportsSalesCollectionsView";
import { ReportsPurchasesProjectsView } from "./ReportsPurchasesProjectsView";
import { ReportsStatementsView } from "./ReportsStatementsView";

export function ReportsWorkspace() {
  const customers = useCustomers();
  const routeSearch = useSearch({ strict: false }) as {
    tab?: ReportTab;
    customerId?: string;
    supplierId?: string;
    currency?: AppCurrency;
  };
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<ReportTab>(routeSearch?.tab ?? "performance");
  const [currency, setCurrency] = useState<AppCurrency>(() =>
    isValidCurrency(routeSearch?.currency) ? routeSearch.currency : DEFAULT_CURRENCY
  );

  const [sales, setSales] = useState<SalesPerformance | null>(null);
  const [collections, setCollections] = useState<CustomerCollectionsReport | null>(null);
  const [purchases, setPurchases] = useState<PurchasesReport | null>(null);
  const [performance, setPerformance] = useState<FinancialPerformanceReport | null>(null);
  const [cash, setCash] = useState<CashMovementReport | null>(null);

  const [statementCustomerId, setStatementCustomerId] = useState<string | null>(
    routeSearch?.customerId ?? null
  );
  const [statement, setStatement] = useState<CustomerStatement | null>(null);
  const [statementSupplierId, setStatementSupplierId] = useState<string | null>(
    routeSearch?.supplierId ?? null
  );
  const [supplierStatement, setSupplierStatement] = useState<SupplierStatement | null>(null);

  useEffect(() => {
    if (routeSearch?.tab) setActiveTab(routeSearch.tab);
    if (isValidCurrency(routeSearch?.currency)) {
      setCurrency(routeSearch.currency);
    }
    if (routeSearch?.customerId) {
      setActiveTab("statements");
      setStatementCustomerId(routeSearch.customerId);
    }
    if (routeSearch?.supplierId) {
      setActiveTab("statements");
      setStatementSupplierId(routeSearch.supplierId);
    }
  }, [routeSearch?.tab, routeSearch?.currency, routeSearch?.customerId, routeSearch?.supplierId]);

  const range = useMemo(() => ({ from: from || undefined, to: to || undefined }), [from, to]);

  const loadSuppliers = useCallback(async () => {
    try {
      setSuppliers(await getAllSuppliers());
    } catch (err) {
      console.warn("[Reports] suppliers failed:", err);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [
        salesData,
        collectionsData,
        purchasesData,
        performanceData,
        cashData,
      ] = await Promise.all([
        getSalesPerformance(range, currency),
        getCustomerCollectionsReport(range, undefined, currency),
        getPurchasesReport(range, currency),
        getFinancialPerformanceReport(range, currency),
        getCashMovementReport(range, currency),
      ]);
      setSales(salesData);
      setCollections(collectionsData);
      setPurchases(purchasesData);
      setPerformance(performanceData);
      setCash(cashData);
    } catch (err) {
      console.error("[Reports] load failed:", err);
    } finally {
      setLoading(false);
    }
  }, [range, currency]);

  useEffect(() => {
    void load();
    void loadSuppliers();
    const onRefresh = () => {
      void load();
      void loadSuppliers();
    };
    window.addEventListener("native-storage-ready", onRefresh);
    window.addEventListener("finance-changed", onRefresh);
    return () => {
      window.removeEventListener("native-storage-ready", onRefresh);
      window.removeEventListener("finance-changed", onRefresh);
    };
  }, [load, loadSuppliers]);

  useEffect(() => {
    if (!statementCustomerId) {
      setStatement(null);
      return;
    }
    let cancelled = false;
    void getCustomerStatement(statementCustomerId, range, currency)
      .then((res) => {
        if (!cancelled) setStatement(res);
      })
      .catch((err) => {
        console.error("[Reports] customer statement failed:", err);
      });
    return () => {
      cancelled = true;
    };
  }, [statementCustomerId, range, currency]);

  useEffect(() => {
    if (!statementSupplierId) {
      setSupplierStatement(null);
      return;
    }
    let cancelled = false;
    void getSupplierStatement(statementSupplierId, range, currency)
      .then((res) => {
        if (!cancelled) setSupplierStatement(res);
      })
      .catch((err) => {
        console.error("[Reports] supplier statement failed:", err);
      });
    return () => {
      cancelled = true;
    };
  }, [statementSupplierId, range, currency]);

  const handleQuickPreset = (preset: "today" | "month" | "year" | "all") => {
    if (preset === "all") {
      setFrom("");
      setTo("");
      return;
    }
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

    if (preset === "today") {
      setFrom(todayStr);
      setTo(todayStr);
    } else if (preset === "month") {
      setFrom(`${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`);
      setTo(todayStr);
    } else if (preset === "year") {
      setFrom(`${now.getFullYear()}-01-01`);
      setTo(todayStr);
    }
  };

  const metrics = useMemo(
    () => ({
      netProfit: performance?.netProfit ?? 0,
      salesTotal: sales?.totalSales ?? 0,
      collectedTotal: collections?.collectedTotal ?? 0,
      purchasesTotal: purchases?.purchaseTotal ?? 0,
      cashNet: cash?.net ?? 0,
    }),
    [performance, sales, collections, purchases, cash]
  );

  return (
    <PageShell>
      <main className="mx-auto flex w-full max-w-md flex-1 min-h-0 flex-col gap-4 overflow-y-auto overflow-x-hidden px-3.5 sm:px-4 py-4 pb-36 md:max-w-4xl md:pb-16 overscroll-y-contain">
        <ReportsHeader
          from={from}
          to={to}
          currency={currency}
          onCurrencyChange={setCurrency}
          onFromChange={setFrom}
          onToChange={setTo}
          onQuickPreset={handleQuickPreset}
          onRefresh={() => {
            void load();
            void loadSuppliers();
          }}
          loading={loading}
        />

        <ReportsIconCards
          activeTab={activeTab}
          onSelectTab={setActiveTab}
          currency={currency}
          metrics={metrics}
        />

        {loading && !sales ? (
          <div className="flex flex-col items-center justify-center py-12 gap-2 text-muted-foreground">
            <Loader2 className="h-7 w-7 animate-spin text-primary" />
            <span className="text-xs font-bold">جاري تحميل بيانات التقرير...</span>
          </div>
        ) : (
          <div className="space-y-4 pt-1 transition-all duration-200">
            {activeTab === "performance" && (
              <ReportsPerformanceView performance={performance} currency={currency} />
            )}

            {(activeTab === "sales" || activeTab === "collections") && (
              <ReportsSalesCollectionsView
                type={activeTab}
                sales={sales}
                collections={collections}
                currency={currency}
              />
            )}

            {(activeTab === "purchases" || activeTab === "cash") && (
              <ReportsPurchasesProjectsView
                type={activeTab}
                purchases={purchases}
                cash={cash}
                currency={currency}
              />
            )}

            {activeTab === "statements" && (
              <ReportsStatementsView
                customers={customers}
                suppliers={suppliers}
                statementCustomerId={statementCustomerId}
                statementSupplierId={statementSupplierId}
                statement={statement}
                supplierStatement={supplierStatement}
                currency={currency}
                onCurrencyChange={setCurrency}
                onSelectCustomer={setStatementCustomerId}
                onSelectSupplier={setStatementSupplierId}
              />
            )}
          </div>
        )}
      </main>
    </PageShell>
  );
}

export default ReportsWorkspace;
