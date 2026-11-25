import React, { useState, useMemo, useEffect, useDeferredValue, useRef } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import {
  Search,
  UserPlus,
  Users,
  X,
  Building2,
  Receipt,
  Wallet,
  RefreshCw,
  ChevronDown,
  ArrowUpDown,
  ArrowUp,
} from "lucide-react";
import { PageShell } from "@/components/layout/PageShell";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  useCustomers,
  addCustomer,
  updateCustomer,
  deleteCustomer,
  archiveCustomer,
  checkCanDeleteCustomer,
  getAllCustomerFinancialSummaries,
  type CustomerRecord,
} from "@/lib/customersStore";
import { formatNumber } from "@/lib/printCalculator";
import { CustomerDialog } from "./CustomerDialog";
import { CustomerDetailPage } from "./CustomerDetailPage";
import {
  CustomersDirectoryTable,
  CustomersMobileCards,
  getCustomerCurrencyBuckets,
  type LiveBalancesMap,
} from "./CustomersDirectoryViews";
import { CustomInvoiceDialog } from "@/components/billing/CustomInvoiceDialog";
import type { CustomInvoiceType } from "@/lib/billing/types";
import { getCurrencyShortLabel } from "@/lib/currency/currencyFormat";
import {
  SUPPORTED_CURRENCIES,
  sanitizeCurrency,
  type AppCurrency,
} from "@/lib/currency/types";
import { playTapSound, playDeleteSound, playSuccessSound } from "@/lib/soundEffects";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const ALL_CURRENCIES = Object.keys(SUPPORTED_CURRENCIES) as AppCurrency[];

function round2(v: number): number {
  return Math.round((Number(v) || 0) * 100) / 100;
}

const TABS: { key: string; label: string }[] = [
  { key: "all", label: "كل العملاء" },
  { key: "debtors", label: "العملاء المدينون" },
  { key: "company", label: "شركات" },
  { key: "institution", label: "مؤسسات" },
  { key: "client", label: "زبائن" },
  { key: "individual", label: "أفراد" },
  { key: "archived", label: "المؤرشفين" },
];

export function CustomersPage() {
  const customers = useCustomers();
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [typeFilter, setTypeFilter] = useState("all");
  const [currencyFilter, setCurrencyFilter] = useState<"ALL" | AppCurrency>("ALL");
  const [customerSort, setCustomerSort] = useState<"debt-desc" | "spent-desc" | "name-asc" | "date-desc">("debt-desc");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<CustomerRecord | null>(null);
  const [pendingDeleteCustomer, setPendingDeleteCustomer] = useState<CustomerRecord | null>(null);
  const [loadingBalances, setLoadingBalances] = useState(false);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const mainScrollRef = useRef<HTMLElement>(null);

  const [liveBalances, setLiveBalances] = useState<LiveBalancesMap>({});
  const { id: selectedCustomerId } = useSearch({ from: "/customers" });
  const navigate = useNavigate();

  const selectedProfileCustomer = useMemo(
    () => (selectedCustomerId ? customers.find((c) => c.id === selectedCustomerId) ?? null : null),
    [customers, selectedCustomerId]
  );

  const [invoiceDialogOpen, setInvoiceDialogOpen] = useState(false);
  const [invoiceDialogType, setInvoiceDialogType] = useState<CustomInvoiceType>("sales");
  const [invoiceTargetCustomer, setInvoiceTargetCustomer] = useState<CustomerRecord | null>(null);

  const loadLiveBalances = async () => {
    setLoadingBalances(true);
    try {
      const map = await getAllCustomerFinancialSummaries();
      setLiveBalances(map);
    } catch (err) {
      console.warn("[CustomersPage] failed to load live balances:", err);
    } finally {
      setLoadingBalances(false);
    }
  };

  useEffect(() => {
    void loadLiveBalances();
    const handleFinanceChange = () => void loadLiveBalances();
    if (typeof window !== "undefined") {
      window.addEventListener("finance-changed", handleFinanceChange);
      window.addEventListener("native-storage-ready", handleFinanceChange);
      return () => {
        window.removeEventListener("finance-changed", handleFinanceChange);
        window.removeEventListener("native-storage-ready", handleFinanceChange);
      };
    }
  }, []);

  const activeCurrencies = useMemo(() => {
    const set = new Set<AppCurrency>();
    for (const c of customers) {
      if (c.isArchived) continue;
      const live = liveBalances[c.id];
      if (live?.byCurrency) {
        for (const code of ALL_CURRENCIES) {
          const b = live.byCurrency[code];
          if (b && (b.invoiced > 0.009 || b.outstanding > 0.009 || b.collected > 0.009)) {
            set.add(code);
          }
        }
      } else if (live) {
        if (live.invoiced > 0.009 || live.outstanding > 0.009 || live.collected > 0.009) {
          set.add(sanitizeCurrency(live.primaryCurrency ?? c.openingBalanceCurrency, "SDG"));
        }
      } else if ((c.totalSpent || 0) > 0.009 || Math.abs(c.balance || 0) > 0.009) {
        set.add(sanitizeCurrency(c.openingBalanceCurrency, "SDG"));
      }
      if ((c.openingBalance || 0) > 0.009 && c.openingBalanceCurrency) {
        set.add(sanitizeCurrency(c.openingBalanceCurrency, "SDG"));
      }
    }
    return ALL_CURRENCIES.filter((cur) => set.has(cur));
  }, [customers, liveBalances]);

  const filtered = useMemo(() => {
    const hasActivityInCurrency = (c: CustomerRecord, cur: AppCurrency): boolean => {
      const live = liveBalances[c.id];
      if (live?.byCurrency) {
        const b = live.byCurrency[cur];
        if (b && (b.invoiced > 0.009 || b.outstanding > 0.009 || b.collected > 0.009)) {
          return true;
        }
        return Boolean(
          c.openingBalanceCurrency && sanitizeCurrency(c.openingBalanceCurrency, "SDG") === cur
        );
      }
      const fallbackCur = sanitizeCurrency(live?.primaryCurrency ?? c.openingBalanceCurrency, "SDG");
      return fallbackCur === cur;
    };

    return customers.filter((c) => {
      const q = (deferredSearch || "").trim().toLowerCase();
      const matchSearch =
        !q ||
        c.name.toLowerCase().includes(q) ||
        (c.phone && c.phone.includes(q)) ||
        (c.address && c.address.toLowerCase().includes(q));

      if (!matchSearch) return false;

      if (typeFilter === "archived") {
        if (!c.isArchived) return false;
        return currencyFilter === "ALL" || hasActivityInCurrency(c, currencyFilter);
      }
      if (c.isArchived) {
        return false;
      }
      if (typeFilter === "debtors") {
        const buckets = getCustomerCurrencyBuckets(c, liveBalances[c.id], currencyFilter);
        return buckets.some((b) => b.outstanding > 0.009);
      }

      if (currencyFilter !== "ALL" && !hasActivityInCurrency(c, currencyFilter)) {
        return false;
      }

      if (typeFilter === "all") {
        return true;
      }
      if (typeFilter === "institution") {
        return c.type === "institution" || c.type === "agency" || c.type === "internal";
      }
      return c.type === typeFilter;
    });
  }, [customers, deferredSearch, typeFilter, currencyFilter, liveBalances]);

  const sortedAndFiltered = useMemo(() => {
    const list = [...filtered];
    const getSortMetric = (c: CustomerRecord, field: "outstanding" | "invoiced") => {
      const buckets = getCustomerCurrencyBuckets(c, liveBalances[c.id], currencyFilter);
      if (currencyFilter !== "ALL") {
        return buckets[0]?.[field] ?? 0;
      }
      return buckets.reduce((max, b) => Math.max(max, b[field] || 0), 0);
    };

    if (customerSort === "debt-desc") {
      list.sort((a, b) => getSortMetric(b, "outstanding") - getSortMetric(a, "outstanding"));
    } else if (customerSort === "spent-desc") {
      list.sort((a, b) => getSortMetric(b, "invoiced") - getSortMetric(a, "invoiced"));
    } else if (customerSort === "name-asc") {
      list.sort((a, b) => a.name.localeCompare(b.name, "ar"));
    } else if (customerSort === "date-desc") {
      list.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
    }
    return list;
  }, [filtered, customerSort, currencyFilter, liveBalances]);

  const [visibleCount, setVisibleCount] = useState(30);

  useEffect(() => {
    setVisibleCount(30);
  }, [deferredSearch, typeFilter, currencyFilter, customerSort]);

  const visibleCustomers = useMemo(() => {
    return sortedAndFiltered.slice(0, visibleCount);
  }, [sortedAndFiltered, visibleCount]);

  const stats = useMemo(() => {
    const activeCustomers = customers.filter((c) => !c.isArchived);

    const invoicedByCurrency: Record<AppCurrency, number> = {
      SDG: 0,
      USD: 0,
      SAR: 0,
      EGP: 0,
    };
    const debtByCurrency: Record<AppCurrency, number> = {
      SDG: 0,
      USD: 0,
      SAR: 0,
      EGP: 0,
    };
    let debtorsCount = 0;

    for (const c of activeCustomers) {
      const buckets = getCustomerCurrencyBuckets(c, liveBalances[c.id], "ALL");
      let hasDebt = false;
      for (const b of buckets) {
        invoicedByCurrency[b.currency] = round2(invoicedByCurrency[b.currency] + (b.invoiced || 0));
        debtByCurrency[b.currency] = round2(debtByCurrency[b.currency] + (b.outstanding || 0));
        if (b.outstanding > 0.009) {
          hasDebt = true;
        }
      }
      if (hasDebt) debtorsCount++;
    }

    const agencyCount = activeCustomers.filter((c) => c.type === "agency").length;
    const companyCount = activeCustomers.filter((c) => c.type === "company").length;

    return {
      total: activeCustomers.length,
      agencyCount,
      companyCount,
      commercialCount: agencyCount + companyCount,
      invoicedByCurrency,
      debtByCurrency,
      debtorsCount,
    };
  }, [customers, liveBalances]);

  const singleActiveCurrency = activeCurrencies.length === 1 ? activeCurrencies[0] : null;

  const handleSave = async (data: Omit<CustomerRecord, "id" | "createdAt" | "totalOrders" | "totalSpent">) => {
    try {
      if (editingCustomer) {
        await updateCustomer(editingCustomer.id, data);
        playSuccessSound();
        toast.success("تم تحديث بيانات العميل بنجاح");
      } else {
        await addCustomer(data);
        playSuccessSound();
        toast.success("تمت إضافة العميل الجديد بنجاح");
      }
      setEditingCustomer(null);
      void loadLiveBalances();
    } catch (err) {
      toast.error("تعذّر حفظ بيانات العميل", {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  };

  const handleDeleteRequest = async (c: CustomerRecord) => {
    playTapSound();
    const check = await checkCanDeleteCustomer(c.id);
    if (!check.allowed) {
      playDeleteSound();
      toast.error("لا يمكن حذف هذا العميل", {
        description: check.reason,
        action: {
          label: "أرشفة العميل",
          onClick: async () => {
            await archiveCustomer(c.id);
            toast.info(`تم نقل العميل "${c.name}" إلى الأرشيف`);
            void loadLiveBalances();
          },
        },
        duration: 8000,
      });
      return;
    }

    setPendingDeleteCustomer(c);
  };

  const executeDeleteCustomer = async (c: CustomerRecord) => {
    try {
      await deleteCustomer(c.id);
      playDeleteSound();
      toast.info(`تم حذف العميل "${c.name}" نهائياً`);
      void loadLiveBalances();
    } catch (err: any) {
      toast.error(err?.message || "تعذّر حذف العميل");
    } finally {
      setPendingDeleteCustomer(null);
    }
  };

  const handleOpenProfile = (c: CustomerRecord) => {
    playTapSound();
    void navigate({ to: "/customers", search: { id: c.id } });
  };

  const handleBackToDirectory = () => {
    playTapSound();
    void navigate({ to: "/customers", search: {} });
    void loadLiveBalances();
  };

  const handleOpenInvoiceCreation = (c: CustomerRecord, type: CustomInvoiceType = "sales") => {
    playTapSound();
    setInvoiceTargetCustomer(c);
    setInvoiceDialogType(type);
    setInvoiceDialogOpen(true);
  };

  if (selectedProfileCustomer) {
    return (
      <>
        <CustomerDetailPage
          customer={selectedProfileCustomer}
          onBack={handleBackToDirectory}
          onCustomerUpdated={() => void loadLiveBalances()}
          onCreateInvoice={(c) => handleOpenInvoiceCreation(c, "sales")}
          onCreateProforma={(c) => handleOpenInvoiceCreation(c, "proforma")}
        />

        <CustomInvoiceDialog
          open={invoiceDialogOpen}
          onOpenChange={(open) => {
            setInvoiceDialogOpen(open);
            if (!open) {
              setInvoiceTargetCustomer(null);
              void loadLiveBalances();
            }
          }}
          initialType={invoiceDialogType}
          initialCustomer={invoiceTargetCustomer || selectedProfileCustomer}
          initialCustomerId={invoiceTargetCustomer?.id || selectedProfileCustomer?.id}
          initialCurrency={
            currencyFilter !== "ALL"
              ? currencyFilter
              : liveBalances[(invoiceTargetCustomer || selectedProfileCustomer)?.id || ""]?.primaryCurrency
          }
          onSaved={() => {
            void loadLiveBalances();
          }}
        />
      </>
    );
  }

  return (
    <PageShell>
      <main
        ref={mainScrollRef}
        onScroll={(e) => {
          setShowScrollTop(e.currentTarget.scrollTop > 300);
        }}
        className="w-full flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-y-contain px-3 py-3 md:px-6 md:py-5 min-w-0 pb-28 md:pb-12"
        dir="rtl"
      >
        <div className="mx-auto max-w-7xl space-y-3.5 sm:space-y-4 w-full">
          {/* 1. ترويسة الصفحة التنفيذية المعتمدة لشركة T.A */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-card p-3.5 sm:p-4 rounded-2xl border border-border/70 shadow-2xs border-r-4 border-r-primary">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary/10 text-primary border border-primary/20 shrink-0">
                  <Users className="h-4.5 w-4.5" />
                </span>
                <h1 className="text-base sm:text-lg font-black text-foreground tracking-tight">
                  دليل العملاء والحسابات المالية
                </h1>
                <span className="text-[11px] font-mono font-black text-primary px-2.5 py-0.5 rounded-full bg-primary/10 border border-primary/20 tabular-nums shrink-0">
                  {stats.total} عميل نشط
                </span>
              </div>
              <p className="text-[11px] sm:text-xs text-muted-foreground font-medium mt-1">
                إدارة ملفات العملاء التجارية، الفواتير، التحصيلات، والمتابعة المالية اللحظية
              </p>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  playTapSound();
                  void loadLiveBalances();
                }}
                disabled={loadingBalances}
                aria-label="تحديث الأرصدة"
                className="h-9 w-9 rounded-xl p-0 text-muted-foreground border-border/80 hover:bg-secondary cursor-pointer"
              >
                <RefreshCw className={cn("h-4 w-4", loadingBalances && "animate-spin")} />
              </Button>

              <Button
                type="button"
                onClick={() => {
                  playTapSound();
                  setEditingCustomer(null);
                  setDialogOpen(true);
                }}
                className="h-9 px-4 rounded-xl font-black text-xs gap-1.5 bg-primary hover:bg-primary/90 text-white shadow-xs shadow-primary/30 active:scale-[0.97] transition-all touch-manipulation cursor-pointer"
              >
                <UserPlus className="h-4 w-4" />
                <span>إضافة عميل جديد</span>
              </Button>
            </div>
          </div>

          {/* 2. مؤشرات الأداء المالي ونوافذ العملات المفصولة (Separated Per-Currency Windows) */}
          <div className="space-y-2.5">
            <div className="grid grid-cols-2 gap-2.5">
              <div className="rounded-2xl border border-border/70 bg-card p-3 sm:p-3.5 shadow-2xs space-y-1">
                <span className="text-[11px] font-bold text-muted-foreground flex items-center gap-1.5">
                  <Users className="h-3.5 w-3.5 text-primary" />
                  <span>إجمالي العملاء النشطين</span>
                </span>
                <p className="font-mono text-lg sm:text-xl font-black text-foreground tabular-nums">
                  {stats.total}
                </p>
              </div>

              <div className="rounded-2xl border border-border/70 bg-card p-3 sm:p-3.5 shadow-2xs space-y-1">
                <span className="text-[11px] font-bold text-[#C5A059] flex items-center gap-1.5">
                  <Building2 className="h-3.5 w-3.5" />
                  <span>الوكالات والشركات</span>
                </span>
                <p className="font-mono text-lg sm:text-xl font-black text-[#C5A059] tabular-nums">
                  {stats.commercialCount}
                </p>
              </div>
            </div>

            {(() => {
              const windowCurrencies: AppCurrency[] =
                currencyFilter !== "ALL"
                  ? [currencyFilter]
                  : ALL_CURRENCIES.filter(
                      (cur) =>
                        (stats.invoicedByCurrency[cur] || 0) > 0.009 ||
                        (stats.debtByCurrency[cur] || 0) > 0.009
                    );
              const displayedCurrencies: AppCurrency[] =
                windowCurrencies.length > 0
                  ? windowCurrencies
                  : [singleActiveCurrency || "SDG"];

              return (
                <div
                  className={cn(
                    "grid gap-2.5",
                    displayedCurrencies.length === 1
                      ? "grid-cols-1"
                      : "grid-cols-1 sm:grid-cols-2"
                  )}
                >
                  {displayedCurrencies.map((cur) => {
                    const conf = SUPPORTED_CURRENCIES[cur];
                    const curLabel = getCurrencyShortLabel(cur);
                    const invoicedVal = stats.invoicedByCurrency[cur] || 0;
                    const debtVal = stats.debtByCurrency[cur] || 0;
                    const isFocused = currencyFilter === cur;

                    return (
                      <div
                        key={cur}
                        role="button"
                        tabIndex={0}
                        onClick={() => {
                          playTapSound();
                          setCurrencyFilter((prev) => (prev === cur ? "ALL" : cur));
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            playTapSound();
                            setCurrencyFilter((prev) => (prev === cur ? "ALL" : cur));
                          }
                        }}
                        className={cn(
                          "rounded-2xl border bg-card p-3 sm:p-3.5 shadow-2xs space-y-2.5 transition-all cursor-pointer",
                          isFocused
                            ? "border-primary ring-1 ring-primary/30 bg-primary/[0.02]"
                            : "border-border/70 hover:border-primary/40"
                        )}
                      >
                        <div className="flex items-center justify-between gap-2 border-b border-border/50 pb-2">
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm leading-none" aria-hidden="true">
                              {conf.flag}
                            </span>
                            <span className="text-xs font-black text-foreground">
                              {conf.nameAr}
                            </span>
                          </div>
                          <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 border border-primary/20 px-2 py-0.5 text-[10px] font-mono font-black text-primary">
                            {cur} ({curLabel})
                          </span>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          <div className="rounded-xl border border-border/60 bg-secondary/30 p-2.5 space-y-1">
                            <span className="text-[10.5px] font-bold text-muted-foreground flex items-center gap-1">
                              <Receipt className="h-3 w-3 text-primary shrink-0" />
                              <span>إجمالي الفواتير</span>
                            </span>
                            <p className="font-mono text-base sm:text-lg font-black text-foreground tabular-nums leading-tight">
                              {formatNumber(invoicedVal)}{" "}
                              <span className="text-[10px] text-muted-foreground font-normal">
                                {curLabel}
                              </span>
                            </p>
                          </div>

                          <div
                            className={cn(
                              "rounded-xl border p-2.5 space-y-1",
                              debtVal > 0.009
                                ? "border-rose-500/25 bg-rose-500/[0.05]"
                                : "border-emerald-500/20 bg-emerald-500/[0.04]"
                            )}
                          >
                            <span
                              className={cn(
                                "text-[10.5px] font-bold flex items-center gap-1",
                                debtVal > 0.009
                                  ? "text-rose-600 dark:text-rose-400"
                                  : "text-emerald-600 dark:text-emerald-400"
                              )}
                            >
                              <Wallet className="h-3 w-3 shrink-0" />
                              <span>إجمالي المستحقات</span>
                            </span>
                            <p
                              className={cn(
                                "font-mono text-base sm:text-lg font-black tabular-nums leading-tight",
                                debtVal > 0.009
                                  ? "text-rose-600 dark:text-rose-400"
                                  : "text-emerald-600 dark:text-emerald-400"
                              )}
                            >
                              {formatNumber(debtVal)}{" "}
                              <span className="text-[10px] font-normal opacity-80">
                                {curLabel}
                              </span>
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>

          {/* 3. شريط البحث والتصنيف والفلترة السريعة */}
          <div className="rounded-2xl border border-border/70 bg-card p-3 sm:p-4 shadow-2xs space-y-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2 flex-1 max-w-lg">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="text"
                    placeholder="بحث باسم العميل، الهاتف، أو العنوان..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="h-10 w-full rounded-xl border border-border/80 bg-secondary/35 pr-9 pl-8 text-xs font-bold text-foreground placeholder:text-muted-foreground/60 outline-none transition-colors focus:border-primary focus:bg-background focus:ring-1 focus:ring-primary"
                  />
                  {search && (
                    <button
                      type="button"
                      onClick={() => {
                        playTapSound();
                        setSearch("");
                      }}
                      className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-1.5 bg-secondary/50 px-2.5 h-10 rounded-xl border border-border/80 shrink-0">
                  <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <select
                    aria-label="ترتيب قائمة العملاء"
                    value={customerSort}
                    onChange={(e) => setCustomerSort(e.target.value as any)}
                    className="bg-transparent text-xs font-bold text-foreground border-none outline-hidden cursor-pointer"
                  >
                    <option value="debt-desc">الأعلى مديونية</option>
                    <option value="spent-desc">الأعلى تعاملاً</option>
                    <option value="name-asc">أبجدياً (أ - ي)</option>
                    <option value="date-desc">الأحدث تسجيلاً</option>
                  </select>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-1.5 w-full min-w-0">
                {TABS.map((tab) => {
                  const active = typeFilter === tab.key;
                  return (
                    <button
                      key={tab.key}
                      type="button"
                      onClick={() => {
                        playTapSound();
                        setTypeFilter(tab.key);
                      }}
                      className={`rounded-full px-3 py-1.5 text-xs font-bold transition-all cursor-pointer touch-manipulation active:scale-95 ${
                        active
                          ? "bg-primary text-white shadow-2xs"
                          : "bg-secondary/70 text-muted-foreground hover:bg-secondary hover:text-foreground border border-border/50"
                      }`}
                    >
                      {tab.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-1.5 border-t border-border/50 pt-2.5 w-full min-w-0">
              <span className="text-[11px] font-black text-muted-foreground shrink-0 ml-1">
                العملة:
              </span>
              <button
                type="button"
                onClick={() => {
                  playTapSound();
                  setCurrencyFilter("ALL");
                }}
                aria-pressed={currencyFilter === "ALL"}
                className={cn(
                  "shrink-0 rounded-full px-3 py-1 text-[11px] font-bold transition-all cursor-pointer touch-manipulation active:scale-95",
                  currencyFilter === "ALL"
                    ? "bg-primary text-white shadow-2xs"
                    : "bg-secondary/70 text-muted-foreground hover:bg-secondary hover:text-foreground border border-border/50"
                )}
              >
                الكل
              </button>
              {ALL_CURRENCIES.map((cur) => {
                const active = currencyFilter === cur;
                const hasActivity = activeCurrencies.includes(cur);
                return (
                  <button
                    key={cur}
                    type="button"
                    onClick={() => {
                      playTapSound();
                      setCurrencyFilter(cur);
                    }}
                    aria-pressed={active}
                    className={cn(
                      "shrink-0 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-mono font-bold transition-all cursor-pointer touch-manipulation active:scale-95",
                      active
                        ? "bg-primary text-white shadow-2xs"
                        : "bg-secondary/70 text-muted-foreground hover:bg-secondary hover:text-foreground border border-border/50"
                    )}
                  >
                    <span>{cur}</span>
                    <span
                      className={cn(
                        "font-sans text-[10px]",
                        active ? "text-white/85" : "text-muted-foreground/80"
                      )}
                    >
                      ({getCurrencyShortLabel(cur)})
                    </span>
                    {hasActivity && !active && (
                      <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                    )}
                  </button>
                );
              })}
            </div>

            <CustomersDirectoryTable
              totalMatchedCount={sortedAndFiltered.length}
              visibleCustomers={visibleCustomers}
              liveBalances={liveBalances}
              selectedCurrency={currencyFilter}
              onOpenProfile={handleOpenProfile}
              onCreateInvoice={handleOpenInvoiceCreation}
              onEditCustomer={(c) => {
                setEditingCustomer(c);
                setDialogOpen(true);
              }}
              onDeleteCustomer={(c) => void handleDeleteRequest(c)}
            />

            <CustomersMobileCards
              totalMatchedCount={sortedAndFiltered.length}
              visibleCustomers={visibleCustomers}
              liveBalances={liveBalances}
              selectedCurrency={currencyFilter}
              onOpenProfile={handleOpenProfile}
              onCreateInvoice={handleOpenInvoiceCreation}
              onEditCustomer={(c) => {
                setEditingCustomer(c);
                setDialogOpen(true);
              }}
              onDeleteCustomer={(c) => void handleDeleteRequest(c)}
            />

            {sortedAndFiltered.length > visibleCount && (
              <div className="flex justify-center pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    playTapSound();
                    setVisibleCount((prev) => prev + 30);
                  }}
                  className="rounded-xl px-5 py-2 text-xs font-bold gap-2 border-border/80 text-foreground hover:bg-secondary cursor-pointer transition active:scale-95"
                >
                  <ChevronDown className="h-4 w-4" />
                  <span>
                    عرض المزيد من العملاء (المتبقي: {sortedAndFiltered.length - visibleCount})
                  </span>
                </Button>
              </div>
            )}
          </div>
        </div>

        {showScrollTop && (
          <button
            type="button"
            onClick={() => {
              playTapSound();
              mainScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
            }}
            className="fixed bottom-20 md:bottom-8 left-5 z-40 p-2.5 rounded-full bg-primary text-white shadow-xl hover:bg-primary/90 transition-all cursor-pointer touch-manipulation active:scale-95 animate-in fade-in flex items-center justify-center border border-white/20"
            title="العودة لأعلى الصفحة"
          >
            <ArrowUp className="h-4 w-4" />
          </button>
        )}
      </main>

      <CustomerDialog
        open={dialogOpen}
        onClose={() => {
          setDialogOpen(false);
          setEditingCustomer(null);
        }}
        onSave={handleSave}
        initialData={editingCustomer}
      />

      <CustomInvoiceDialog
        open={invoiceDialogOpen}
        onOpenChange={(open) => {
          setInvoiceDialogOpen(open);
          if (!open) {
            setInvoiceTargetCustomer(null);
            void loadLiveBalances();
          }
        }}
        initialType={invoiceDialogType}
        initialCustomer={invoiceTargetCustomer}
        initialCustomerId={invoiceTargetCustomer?.id}
        initialCurrency={
          currencyFilter !== "ALL"
            ? currencyFilter
            : invoiceTargetCustomer
            ? liveBalances[invoiceTargetCustomer.id]?.primaryCurrency
            : undefined
        }
        onSaved={() => {
          void loadLiveBalances();
        }}
      />

      <AlertDialog
        open={Boolean(pendingDeleteCustomer)}
        onOpenChange={(open) => !open && setPendingDeleteCustomer(null)}
      >
        <AlertDialogContent dir="rtl" className="rounded-3xl">
          <AlertDialogHeader className="text-right">
            <AlertDialogTitle className="font-black text-base">
              تأكيد حذف العميل نهائياً
            </AlertDialogTitle>
            <AlertDialogDescription className="text-xs leading-relaxed">
              {pendingDeleteCustomer
                ? `هل أنت متأكد من الحذف النهائي للعميل "${pendingDeleteCustomer.name}"؟ (لا توجد عليه أي معاملات سابقة)`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:justify-start">
            <AlertDialogCancel className="rounded-xl text-xs font-bold">إلغاء</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => pendingDeleteCustomer && void executeDeleteCustomer(pendingDeleteCustomer)}
              className="rounded-xl text-xs font-black bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              تأكيد الحذف
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageShell>
  );
}
