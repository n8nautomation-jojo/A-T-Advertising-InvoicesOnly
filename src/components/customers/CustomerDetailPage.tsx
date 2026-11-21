import React, { useState, useMemo, useEffect, useDeferredValue, useRef, Suspense, lazy } from "react";
import {
  Building2,
  Printer,
  Plus,
  Pencil,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  ArrowUp,
  Wallet,
  ArrowDownLeft,
  Loader2,
  FileText,
  FileSignature,
  Eye,
  Edit2,
} from "lucide-react";
import { PageShell } from "@/components/layout/PageShell";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  CUSTOMER_TYPE_CONFIG,
  type CustomerRecord,
  getCustomerFinancialSummary,
  getCustomerInvoicesList,
  updateCustomer,
  type CustomerFinancialProfile,
  type CustomerInvoiceItemRow,
} from "@/lib/customersStore";
import { normalizeCustomerName } from "@/lib/customers/customerMatching";
import { getCustomInvoice, useCustomInvoices } from "@/lib/billing/store";
import type { CustomInvoice } from "@/lib/billing/types";
import {
  getCustomerStatement,
  type CustomerStatement,
} from "@/lib/repositories/ReportsRepository";
import { printCustomerStatement } from "@/lib/customerStatementExport";
import { getCustomInvoiceById } from "@/lib/repositories/CustomInvoiceRepository";
import { formatNumber } from "@/lib/printCalculator";
import { getCurrencyShortLabel } from "@/lib/currency/currencyFormat";
import { SUPPORTED_CURRENCIES, sanitizeCurrency } from "@/lib/currency/types";
import { playTapSound } from "@/lib/soundEffects";
import { CustomerDialog } from "./CustomerDialog";
import {
  CustomerDetailInvoicesTab,
  type InvoiceSortKey,
  type InvoiceStatusFilter,
} from "./CustomerDetailInvoicesTab";
import {
  CustomerDetailStatementTab,
  type StatementTypeFilter,
} from "./CustomerDetailStatementTab";
import { ReceiptDialog } from "@/components/finance/ReceiptDialog";
import { BillingPreviewModal } from "@/components/billing/BillingPreviewModal";
import { CustomInvoiceDialog } from "@/components/billing/CustomInvoiceDialog";
const LazyLetterIssuerDialog = lazy(() =>
  import("@/components/letters/LetterIssuerDialog").then((m) => ({
    default: m.LetterIssuerDialog,
  }))
);
import {
  printCustomInvoiceDocument,
  shareCustomInvoiceViaWhatsApp,
} from "@/components/billing/CustomInvoicePrintButton";

interface Props {
  customer: CustomerRecord;
  onBack: () => void;
  onCustomerUpdated?: () => void;
  onCreateInvoice?: (customer: CustomerRecord) => void;
  onCreateProforma?: (customer: CustomerRecord) => void;
}

/**
 * CustomerDetailPage: صفحة مساحة عمل العميل المستقلة الكاملة (PRD & CEO Standard)
 */
export function CustomerDetailPage({
  customer,
  onBack,
  onCustomerUpdated,
  onCreateInvoice,
  onCreateProforma,
}: Props) {
  const [activeTab, setActiveTab] = useState<"invoices" | "statement" | "info">("invoices");
  const [financialProfile, setFinancialProfile] = useState<CustomerFinancialProfile | null>(null);
  const [invoices, setInvoices] = useState<CustomerInvoiceItemRow[]>([]);
  const [statement, setStatement] = useState<CustomerStatement | null>(null);
  const [statementsByCurrency, setStatementsByCurrency] = useState<Record<string, CustomerStatement>>({});
  const [statementViewAllCurrencies, setStatementViewAllCurrencies] = useState(true);
  const [selectedCurrency, setSelectedCurrency] = useState<string>(() =>
    sanitizeCurrency(customer.openingBalanceCurrency, "SDG")
  );
  const selectedCurrencyRef = useRef<string>(
    sanitizeCurrency(customer.openingBalanceCurrency, "SDG")
  );
  const hasLoadedProfileForCustomerRef = useRef<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const [isSummaryCollapsed, setIsSummaryCollapsed] = useState(false);

  const [invoiceStatusFilter, setInvoiceStatusFilter] = useState<InvoiceStatusFilter>("all");
  const [invoiceSearch, setInvoiceSearch] = useState("");
  const deferredInvoiceSearch = useDeferredValue(invoiceSearch);
  const [invoiceSort, setInvoiceSort] = useState<InvoiceSortKey>("date-desc");
  const [invoicePage, setInvoicePage] = useState(1);
  const [invoicePageSize, setInvoicePageSize] = useState(20);
  const [invoiceViewMode, setInvoiceViewMode] = useState<"table" | "cards">("table");

  const [statementSearch, setStatementSearch] = useState("");
  const deferredStatementSearch = useDeferredValue(statementSearch);
  const [statementTypeFilter, setStatementTypeFilter] = useState<StatementTypeFilter>("all");
  const [statementFrom, setStatementFrom] = useState("");
  const [statementTo, setStatementTo] = useState("");
  const [statementPage, setStatementPage] = useState(1);
  const [statementPageSize, setStatementPageSize] = useState(20);

  const [showScrollTop, setShowScrollTop] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [receiptDialogOpen, setReceiptDialogOpen] = useState(false);
  const [letterDialogOpen, setLetterDialogOpen] = useState(false);
  const [targetReceiptInvoiceId, setTargetReceiptInvoiceId] = useState<string | null>(null);
  const [isExportingStatement, setIsExportingStatement] = useState(false);
  const [previewInvoice, setPreviewInvoice] = useState<CustomInvoice | null>(null);
  const [editingInvoice, setEditingInvoice] = useState<CustomInvoice | null>(null);

  const allCustomInvoices = useCustomInvoices();
  const customerProformas = useMemo(() => {
    const normCustName = normalizeCustomerName(customer.name);
    return allCustomInvoices.filter(
      (inv) =>
        inv.meta.type === "proforma" &&
        !inv.cancelledAt &&
        (inv.customerId === customer.id ||
          (!inv.customerId && Boolean(normCustName) && normalizeCustomerName(inv.meta.partyName) === normCustName))
    );
  }, [allCustomInvoices, customer.id, customer.name]);

  const loadAllCustomerData = async (fromOverride?: string, toOverride?: string) => {
    if (!customer?.id) return;
    setIsLoading(true);
    try {
      const [profile, invs] = await Promise.all([
        getCustomerFinancialSummary(customer.id),
        getCustomerInvoicesList(customer.id),
      ]);
      setFinancialProfile(profile);
      setInvoices(invs);

      const isInitialForCustomer = hasLoadedProfileForCustomerRef.current !== customer.id;
      hasLoadedProfileForCustomerRef.current = customer.id;

      const primaryCur = sanitizeCurrency(profile.primaryCurrency, "SDG");
      const prevCur = selectedCurrencyRef.current;
      const availableCurs = Object.keys(profile.summariesByCurrency || {});
      const effectiveCur =
        !isInitialForCustomer && prevCur && availableCurs.includes(prevCur)
          ? prevCur
          : primaryCur;

      selectedCurrencyRef.current = effectiveCur;
      setSelectedCurrency(effectiveCur);

      const effectiveFrom = fromOverride !== undefined ? fromOverride : statementFrom;
      const effectiveTo = toOverride !== undefined ? toOverride : statementTo;
      const currenciesToFetch = availableCurs.length > 0 ? availableCurs : [effectiveCur];
      const fetchedEntries = await Promise.all(
        currenciesToFetch.map(async (cur) => {
          const s = await getCustomerStatement(
            customer.id,
            { from: effectiveFrom || undefined, to: effectiveTo || undefined },
            cur
          );
          return [cur, s] as const;
        })
      );
      const nextByCur: Record<string, CustomerStatement> = {};
      for (const [cur, s] of fetchedEntries) {
        if (s) nextByCur[cur] = s;
      }
      setStatementsByCurrency(nextByCur);
      setStatement(nextByCur[effectiveCur] || fetchedEntries[0]?.[1] || null);
    } catch (err) {
      console.error("[CustomerDetailPage] Failed to load customer data:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!customer?.id) return;
    void loadAllCustomerData();
    const handleFinanceChange = () => {
      void loadAllCustomerData();
    };
    if (typeof window !== "undefined") {
      window.addEventListener("finance-changed", handleFinanceChange);
      return () => window.removeEventListener("finance-changed", handleFinanceChange);
    }
  }, [customer?.id]);

  const handleCurrencyChange = async (cur: string) => {
    playTapSound();
    selectedCurrencyRef.current = cur;
    setSelectedCurrency(cur);
    setInvoicePage(1);
    if (statementsByCurrency[cur]) {
      setStatement(statementsByCurrency[cur]);
    }
    if (customer?.id) {
      const stmt = await getCustomerStatement(
        customer.id,
        { from: statementFrom || undefined, to: statementTo || undefined },
        cur
      );
      setStatement(stmt);
      if (stmt) {
        setStatementsByCurrency((prev) => ({ ...prev, [cur]: stmt }));
      }
    }
  };

  const handleStatementRangeChange = async (fromVal: string, toVal: string) => {
    setStatementFrom(fromVal);
    setStatementTo(toVal);
    setStatementPage(1);
    if (customer?.id) {
      const availableCurs = Object.keys(financialProfile?.summariesByCurrency || {});
      const currenciesToFetch = availableCurs.length > 0 ? availableCurs : [selectedCurrency];
      const fetchedEntries = await Promise.all(
        currenciesToFetch.map(async (cur) => {
          const s = await getCustomerStatement(
            customer.id,
            { from: fromVal || undefined, to: toVal || undefined },
            cur
          );
          return [cur, s] as const;
        })
      );
      const nextByCur: Record<string, CustomerStatement> = {};
      for (const [cur, s] of fetchedEntries) {
        if (s) nextByCur[cur] = s;
      }
      setStatementsByCurrency(nextByCur);
      setStatement(nextByCur[selectedCurrency] || fetchedEntries[0]?.[1] || null);
    }
  };

  const currentInvoicesForCurrency = useMemo(() => {
    return selectedCurrency
      ? invoices.filter((inv) => (inv.currency || "SDG") === selectedCurrency)
      : invoices;
  }, [invoices, selectedCurrency]);

  const invoiceStatusCounts = useMemo(() => {
    return {
      all: currentInvoicesForCurrency.length,
      unpaid: currentInvoicesForCurrency.filter((i) => i.status === "unpaid").length,
      partial: currentInvoicesForCurrency.filter((i) => i.status === "partial").length,
      overdue: currentInvoicesForCurrency.filter((i) => i.status === "overdue").length,
      paid: currentInvoicesForCurrency.filter((i) => i.status === "paid").length,
    };
  }, [currentInvoicesForCurrency]);

  const processedInvoices = useMemo(() => {
    let list = currentInvoicesForCurrency;

    if (invoiceStatusFilter !== "all") {
      list = list.filter((i) => i.status === invoiceStatusFilter);
    }

    const q = (deferredInvoiceSearch || "").trim().toLowerCase();
    if (q) {
      list = list.filter((inv) => {
        const refMatch = (inv.reference || "").toLowerCase().includes(q);
        const serialMatch = String(inv.serial || "").includes(q);
        const dateMatch = (inv.date || "").includes(q);
        const dueDateMatch = (inv.dueDate || "").includes(q);
        const amountMatch = String(inv.totalAmount || "").includes(q);
        const remainingMatch = String(inv.remainingAmount || "").includes(q);
        return refMatch || serialMatch || dateMatch || dueDateMatch || amountMatch || remainingMatch;
      });
    }

    const sorted = [...list];
    if (invoiceSort === "date-desc") {
      sorted.sort((a, b) => b.date.localeCompare(a.date));
    } else if (invoiceSort === "date-asc") {
      sorted.sort((a, b) => a.date.localeCompare(b.date));
    } else if (invoiceSort === "debt-desc") {
      sorted.sort((a, b) => b.remainingAmount - a.remainingAmount);
    } else if (invoiceSort === "amount-desc") {
      sorted.sort((a, b) => b.totalAmount - a.totalAmount);
    } else if (invoiceSort === "amount-asc") {
      sorted.sort((a, b) => a.totalAmount - b.totalAmount);
    }

    return sorted;
  }, [currentInvoicesForCurrency, invoiceStatusFilter, deferredInvoiceSearch, invoiceSort]);

  const totalInvoicePages = Math.max(1, Math.ceil(processedInvoices.length / invoicePageSize));
  const paginatedInvoices = useMemo(() => {
    const start = (invoicePage - 1) * invoicePageSize;
    return processedInvoices.slice(start, start + invoicePageSize);
  }, [processedInvoices, invoicePage, invoicePageSize]);

  const pageFinancials = useMemo(() => {
    let pageTotal = 0;
    let pageRemaining = 0;
    for (const inv of paginatedInvoices) {
      pageTotal += inv.totalAmount || 0;
      pageRemaining += inv.remainingAmount || 0;
    }
    return { pageTotal, pageRemaining };
  }, [paginatedInvoices]);

  useEffect(() => {
    setInvoicePage(1);
  }, [deferredInvoiceSearch, invoiceStatusFilter, selectedCurrency, invoiceSort, invoicePageSize]);

  const processedStatementLines = useMemo(() => {
    if (!statement?.lines) return [];
    let lines = statement.lines;

    if (statementTypeFilter !== "all") {
      lines = lines.filter((l) => l.kind === statementTypeFilter);
    }

    const q = (deferredStatementSearch || "").trim().toLowerCase();
    if (q) {
      lines = lines.filter((l) => {
        const labelMatch = (l.label || "").toLowerCase().includes(q);
        const refMatch = (l.reference || "").toLowerCase().includes(q);
        const notesMatch = (l.notes || "").toLowerCase().includes(q);
        const dateMatch = (l.date || "").includes(q);
        const debitMatch = String(l.debit || "").includes(q);
        const creditMatch = String(l.credit || "").includes(q);
        return labelMatch || refMatch || notesMatch || dateMatch || debitMatch || creditMatch;
      });
    }

    return lines;
  }, [statement?.lines, statementTypeFilter, deferredStatementSearch]);

  const totalStatementPages = Math.max(1, Math.ceil(processedStatementLines.length / statementPageSize));
  const paginatedStatementLines = useMemo(() => {
    const start = (statementPage - 1) * statementPageSize;
    return processedStatementLines.slice(start, start + statementPageSize);
  }, [processedStatementLines, statementPage, statementPageSize]);

  useEffect(() => {
    setStatementPage(1);
  }, [deferredStatementSearch, statementTypeFilter, statementPageSize]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    setShowScrollTop(e.currentTarget.scrollTop > 240);
  };

  const scrollToTop = () => {
    scrollContainerRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  };

  const orderedActiveStatements = useMemo(() => {
    const orderedKeys = Object.keys(SUPPORTED_CURRENCIES);
    const list: CustomerStatement[] = [];
    for (const key of orderedKeys) {
      if (statementsByCurrency[key]) {
        list.push(statementsByCurrency[key]);
      }
    }
    for (const [key, stmt] of Object.entries(statementsByCurrency)) {
      if (!orderedKeys.includes(key) && stmt) {
        list.push(stmt);
      }
    }
    return list;
  }, [statementsByCurrency]);

  const handlePrintStatement = async () => {
    if (!statement || isExportingStatement) return;
    setIsExportingStatement(true);
    try {
      const multiList =
        orderedActiveStatements.length > 1 && statementViewAllCurrencies
          ? orderedActiveStatements
          : undefined;
      await printCustomerStatement(statement, customer, selectedCurrency, multiList);
      toast.success("تم إرسال كشف الحساب للطباعة");
    } catch (err: any) {
      toast.error(err?.message || "تعذر طباعة كشف الحساب");
    } finally {
      setIsExportingStatement(false);
    }
  };

  const resolveFullCustomInvoice = async (invoiceId: string): Promise<CustomInvoice | undefined> => {
    const inMemory = getCustomInvoice(invoiceId);
    if (inMemory) return inMemory;
    return await getCustomInvoiceById(invoiceId);
  };

  const handleInvoicePreview = async (invoiceId: string) => {
    playTapSound();
    try {
      const fullInv = await resolveFullCustomInvoice(invoiceId);
      if (!fullInv) {
        toast.error("تعذر العثور على الفاتورة الأصلية");
        return;
      }
      setPreviewInvoice(fullInv);
    } catch {
      toast.error("تعذرت معاينة الفاتورة");
    }
  };

  const handleInvoiceEdit = async (invoiceId: string) => {
    playTapSound();
    try {
      const fullInv = await resolveFullCustomInvoice(invoiceId);
      if (!fullInv) {
        toast.error("تعذر العثور على الفاتورة الأصلية");
        return;
      }
      setEditingInvoice(fullInv);
    } catch {
      toast.error("تعذر فتح الفاتورة للتعديل");
    }
  };

  const handleInvoicePrint = async (invoiceId: string) => {
    playTapSound();
    try {
      const fullInv = await resolveFullCustomInvoice(invoiceId);
      if (!fullInv) {
        toast.error("تعذر العثور على الفاتورة الأصلية");
        return;
      }
      await printCustomInvoiceDocument(fullInv);
    } catch {
      toast.error("تعذرت طباعة الفاتورة");
    }
  };

  const handleInvoiceShare = async (invoiceId: string) => {
    playTapSound();
    try {
      const fullInv = await resolveFullCustomInvoice(invoiceId);
      if (!fullInv) {
        toast.error("تعذر العثور على الفاتورة الأصلية");
        return;
      }
      await shareCustomInvoiceViaWhatsApp(fullInv);
    } catch {
      toast.error("تعذرت مشاركة الفاتورة");
    }
  };

  const typeConfig = CUSTOMER_TYPE_CONFIG[customer.type] || CUSTOMER_TYPE_CONFIG.company;
  const currentSummary = financialProfile?.summariesByCurrency[selectedCurrency] || {
    currency: selectedCurrency,
    totalInvoiced: 0,
    totalPaid: 0,
    outstanding: 0,
    advanceCredit: 0,
    totalInvoicesCount: 0,
    paidInvoicesCount: 0,
    partialInvoicesCount: 0,
    unpaidInvoicesCount: 0,
    overdueInvoicesCount: 0,
  };

  return (
    <PageShell>
      <main
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="w-full flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-3 py-3 md:px-6 md:py-5 min-w-0 scroll-smooth touch-pan-y pb-36 md:pb-16"
        dir="rtl"
      >
        <div className="mx-auto max-w-7xl space-y-3.5 sm:space-y-4 w-full">
          {/* 1. مسار التنقل والترويسة التنفيذية العريضة */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between bg-card/90 backdrop-blur-md p-3.5 sm:p-4 rounded-2xl border border-border/70 shadow-2xs border-r-4 border-r-primary">
            <div>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-bold mb-1.5 flex-wrap">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    playTapSound();
                    onBack();
                  }}
                  className="h-7 px-2 -mr-2 text-xs font-black text-primary hover:bg-primary/10 gap-1 rounded-lg cursor-pointer"
                >
                  <ArrowRight className="h-3.5 w-3.5" />
                  <span>دليل العملاء</span>
                </Button>
                <span>/</span>
                <span className="text-foreground font-black">{customer.name}</span>
                <span className="text-[10px] text-muted-foreground font-mono">({customer.id})</span>
              </div>

              <div className="flex items-center gap-2.5 flex-wrap">
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary/10 text-primary border border-primary/20 shrink-0">
                  <Building2 className="h-4.5 w-4.5" />
                </span>
                <h1 className="text-base sm:text-lg md:text-xl font-black text-foreground tracking-tight">
                  {customer.name}
                </h1>
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-black border ${typeConfig.bg} ${typeConfig.color} border-current/20`}
                >
                  {typeConfig.label}
                </span>
                {customer.isArchived && (
                  <span className="rounded-full bg-muted text-muted-foreground border border-border px-2 py-0.5 text-[9.5px] font-black">
                    مؤرشف
                  </span>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap shrink-0">
              <Button
                type="button"
                onClick={() => {
                  playTapSound();
                  onCreateInvoice?.(customer);
                }}
                className="h-9 px-3.5 rounded-xl font-black text-xs gap-1.5 bg-primary hover:bg-primary/90 text-white shadow-xs shadow-primary/30 active:scale-[0.97] transition-all touch-manipulation cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>إصدار فاتورة</span>
              </Button>

              {onCreateProforma && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    playTapSound();
                    onCreateProforma(customer);
                  }}
                  className="h-9 px-3 rounded-xl font-bold text-xs gap-1.5 border-[#C5A059]/40 text-[#9A7835] dark:text-[#dfbe7e] bg-[#C5A059]/5 hover:bg-[#C5A059]/15 active:scale-[0.97] transition-all cursor-pointer"
                >
                  <FileText className="h-3.5 w-3.5" />
                  <span>عرض سعر</span>
                </Button>
              )}

              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  playTapSound();
                  setTargetReceiptInvoiceId(null);
                  setReceiptDialogOpen(true);
                }}
                className="h-9 px-3 rounded-xl font-bold text-xs gap-1.5 border-emerald-500/30 text-emerald-600 bg-emerald-500/5 hover:bg-emerald-500/15 active:scale-[0.97] transition-all cursor-pointer"
              >
                <ArrowDownLeft className="h-3.5 w-3.5" />
                <span>تحصيل سند قبض</span>
              </Button>

              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  playTapSound();
                  setLetterDialogOpen(true);
                }}
                className="h-9 px-3 rounded-xl font-bold text-xs gap-1.5 border-border/80 text-foreground hover:bg-secondary active:scale-[0.97] transition-all cursor-pointer"
                title="إصدار خطاب رسمي لهذا العميل"
              >
                <FileSignature className="h-3.5 w-3.5 text-primary" />
                <span>إصدار خطاب</span>
              </Button>

              <Button
                type="button"
                variant="outline"
                disabled={isExportingStatement || !statement}
                onClick={handlePrintStatement}
                className="h-9 px-3 rounded-xl text-xs font-bold gap-1.5 border-border/80 text-foreground hover:bg-secondary active:scale-[0.97] cursor-pointer"
                title="طباعة كشف الحساب المالي (A4 رسمي)"
              >
                <Printer className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="hidden sm:inline">طباعة الكشف</span>
              </Button>

              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  playTapSound();
                  setEditDialogOpen(true);
                }}
                className="h-9 w-9 p-0 rounded-xl text-muted-foreground hover:bg-secondary hover:text-foreground cursor-pointer"
                title="تعديل بيانات العميل"
              >
                <Pencil className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* 2. مركز القيادة المالية للعميل والعملات المتعددة */}
          <div className="rounded-2xl border border-border/70 bg-card p-3 sm:p-4 shadow-2xs space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-border/50 pb-2.5">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-black text-foreground flex items-center gap-1.5">
                  <Wallet className="h-4 w-4 text-primary" />
                  <span>السجل المالي بالعملة:</span>
                </span>

                <div className="flex items-center gap-1 bg-secondary/60 p-0.5 rounded-xl border border-border/60">
                  {Object.keys(financialProfile?.summariesByCurrency || { [selectedCurrency]: {} }).map((cur) => (
                    <button
                      key={cur}
                      type="button"
                      onClick={() => void handleCurrencyChange(cur)}
                      className={`px-2.5 py-1 text-xs rounded-lg font-mono font-bold transition-all cursor-pointer inline-flex items-center gap-1 ${
                        selectedCurrency === cur
                          ? "bg-primary text-white shadow-2xs"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <span>{cur}</span>
                      <span
                        className={`font-sans text-[10px] ${
                          selectedCurrency === cur ? "text-white/85" : "text-muted-foreground/80"
                        }`}
                      >
                        ({getCurrencyShortLabel(cur)})
                      </span>
                    </button>
                  ))}
                </div>

                {isLoading && <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />}
              </div>

              <button
                type="button"
                onClick={() => {
                  playTapSound();
                  setIsSummaryCollapsed(!isSummaryCollapsed);
                }}
                className="inline-flex items-center gap-1 text-[11px] font-bold text-muted-foreground hover:text-foreground px-2 py-1 rounded-lg bg-secondary/40 hover:bg-secondary cursor-pointer self-end sm:self-auto"
              >
                <span>{isSummaryCollapsed ? "عرض تفاصيل المؤشرات" : "طي المؤشرات"}</span>
                {isSummaryCollapsed ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
              </button>
            </div>

            {Object.keys(financialProfile?.summariesByCurrency || {}).length > 1 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {Object.entries(financialProfile?.summariesByCurrency || {}).map(([cur, sum]) => {
                  const code = sanitizeCurrency(cur, "SDG");
                  const conf = SUPPORTED_CURRENCIES[code];
                  const curLabel = getCurrencyShortLabel(code);
                  const isFocused = selectedCurrency === cur;
                  return (
                    <button
                      key={cur}
                      type="button"
                      onClick={() => void handleCurrencyChange(cur)}
                      className={`text-right rounded-xl border p-2.5 space-y-1.5 transition-all cursor-pointer ${
                        isFocused
                          ? "border-primary bg-primary/[0.04] ring-1 ring-primary/30"
                          : "border-border/60 bg-secondary/25 hover:border-primary/40"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 border-b border-border/40 pb-1">
                        <span className="inline-flex items-center gap-1 text-[11px] font-black text-foreground">
                          <span aria-hidden="true">{conf.flag}</span>
                          <span>{conf.nameAr}</span>
                        </span>
                        <span className="rounded-md bg-primary/10 border border-primary/20 px-1.5 py-0.5 text-[9.5px] font-mono font-black text-primary">
                          {code} ({curLabel})
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-1.5 text-[10.5px] font-mono">
                        <div>
                          <span className="text-[9.5px] text-muted-foreground font-sans block">الفواتير</span>
                          <strong className="text-foreground font-black tabular-nums">
                            {formatNumber(sum.totalInvoiced)} {curLabel}
                          </strong>
                        </div>
                        <div>
                          <span className="text-[9.5px] text-muted-foreground font-sans block">المسدد</span>
                          <strong className="text-emerald-600 dark:text-emerald-400 font-black tabular-nums">
                            {formatNumber(sum.totalPaid)} {curLabel}
                          </strong>
                        </div>
                        <div>
                          <span className="text-[9.5px] text-muted-foreground font-sans block">المستحق</span>
                          <strong
                            className={`font-black tabular-nums ${
                              sum.outstanding > 0.009
                                ? "text-rose-600 dark:text-rose-400"
                                : "text-emerald-600 dark:text-emerald-400"
                            }`}
                          >
                            {formatNumber(sum.outstanding)} {curLabel}
                          </strong>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {isSummaryCollapsed ? (
              <div className="flex flex-wrap items-center justify-between gap-3 text-xs px-2 py-1 bg-secondary/30 rounded-xl font-mono">
                <div>
                  <span className="text-muted-foreground font-sans text-[11px]">المفوتر: </span>
                  <strong className="text-foreground font-black">
                    {formatNumber(currentSummary.totalInvoiced)} {getCurrencyShortLabel(selectedCurrency)}{" "}
                    <span className="text-[10px] font-normal text-muted-foreground">({selectedCurrency})</span>
                  </strong>
                </div>
                <div>
                  <span className="text-muted-foreground font-sans text-[11px]">المسدد: </span>
                  <strong className="text-emerald-600 dark:text-emerald-400 font-black">
                    {formatNumber(currentSummary.totalPaid)} {getCurrencyShortLabel(selectedCurrency)}{" "}
                    <span className="text-[10px] font-normal">({selectedCurrency})</span>
                  </strong>
                </div>
                <div>
                  <span className="text-muted-foreground font-sans text-[11px]">المتبقي القائم: </span>
                  <strong className={currentSummary.outstanding > 0.009 ? "text-rose-600 font-black" : "text-emerald-600 font-bold"}>
                    {formatNumber(currentSummary.outstanding)} {getCurrencyShortLabel(selectedCurrency)}{" "}
                    <span className="text-[10px] font-normal">({selectedCurrency})</span>
                  </strong>
                </div>
                <div className="text-[11px] font-sans text-muted-foreground">
                  إجمالي الفواتير: <span className="font-bold text-foreground">{currentSummary.totalInvoicesCount}</span>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div className="rounded-xl border border-border/60 bg-secondary/35 p-3 space-y-1">
                  <span className="text-[10.5px] font-bold text-muted-foreground block">إجمالي الفواتير الصادرة</span>
                  <p className="font-mono text-base sm:text-lg font-black text-foreground tabular-nums">
                    {formatNumber(currentSummary.totalInvoiced)}{" "}
                    <span className="text-[10px] font-normal text-muted-foreground">
                      {getCurrencyShortLabel(selectedCurrency)} ({selectedCurrency})
                    </span>
                  </p>
                  <span className="text-[10px] text-muted-foreground block">
                    {currentSummary.totalInvoicesCount} فاتورة محررة
                  </span>
                </div>

                <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 space-y-1">
                  <span className="text-[10.5px] font-bold text-emerald-700 dark:text-emerald-400 block">إجمالي المبالغ المدفوعة</span>
                  <p className="font-mono text-base sm:text-lg font-black text-emerald-600 dark:text-emerald-400 tabular-nums">
                    {formatNumber(currentSummary.totalPaid)}{" "}
                    <span className="text-[10px] font-normal">
                      {getCurrencyShortLabel(selectedCurrency)} ({selectedCurrency})
                    </span>
                  </p>
                  <span className="text-[10px] text-emerald-600/80 block">
                    {currentSummary.paidInvoicesCount} مسددة بالكامل
                  </span>
                </div>

                <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-3 space-y-1">
                  <span className="text-[10.5px] font-bold text-rose-700 dark:text-rose-400 block">المبالغ المستحقة (مديونية)</span>
                  <p className="font-mono text-base sm:text-lg font-black text-rose-600 dark:text-rose-400 tabular-nums">
                    {formatNumber(currentSummary.outstanding)}{" "}
                    <span className="text-[10px] font-normal">
                      {getCurrencyShortLabel(selectedCurrency)} ({selectedCurrency})
                    </span>
                  </p>
                  <span className="text-[10px] text-rose-600/80 block">
                    {currentSummary.overdueInvoicesCount > 0
                      ? `${currentSummary.overdueInvoicesCount} متأخرة عن السداد`
                      : "لا توجد متأخرات حرجة"}
                  </span>
                </div>

                <div className="rounded-xl border border-border/60 bg-secondary/35 p-3 space-y-1">
                  <span className="text-[10.5px] font-bold text-muted-foreground block">أرصدة مقدمة / دفعات دائنة</span>
                  <p className="font-mono text-base sm:text-lg font-black text-foreground tabular-nums">
                    {formatNumber(currentSummary.advanceCredit)}{" "}
                    <span className="text-[10px] font-normal text-muted-foreground">
                      {getCurrencyShortLabel(selectedCurrency)} ({selectedCurrency})
                    </span>
                  </p>
                  <span className="text-[10px] text-muted-foreground block">
                    {currentSummary.partialInvoicesCount} فاتورة بسداد جزئي
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* 3. تبويبات مساحة العمل الكاملة */}
          <div className="rounded-2xl border border-border/70 bg-card p-1 shadow-2xs flex items-center gap-1.5 text-xs font-black overflow-x-auto scrollbar-none touch-pan-x overscroll-x-contain select-none">
            {[
              { key: "invoices" as const, label: `سجل الفواتير (${currentInvoicesForCurrency.length})` },
              { key: "statement" as const, label: `كشف الحساب المالي (${selectedCurrency}) (${statement?.lines.length || 0})` },
              { key: "info" as const, label: "بيانات العميل والافتتاحي" },
            ].map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => {
                  playTapSound();
                  setActiveTab(tab.key);
                }}
                className={`px-4 py-2 rounded-xl transition-all cursor-pointer touch-manipulation active:scale-95 shrink-0 ${
                  activeTab === tab.key
                    ? "bg-primary text-white shadow-2xs"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* 4. محتوى مساحة العمل الكامل */}
          <div className="space-y-3">
            {activeTab === "invoices" && (
              <CustomerDetailInvoicesTab
                invoiceSearch={invoiceSearch}
                setInvoiceSearch={setInvoiceSearch}
                deferredInvoiceSearch={deferredInvoiceSearch}
                invoiceSort={invoiceSort}
                setInvoiceSort={setInvoiceSort}
                invoicePageSize={invoicePageSize}
                setInvoicePageSize={setInvoicePageSize}
                invoiceViewMode={invoiceViewMode}
                setInvoiceViewMode={setInvoiceViewMode}
                invoiceStatusFilter={invoiceStatusFilter}
                setInvoiceStatusFilter={setInvoiceStatusFilter}
                invoiceStatusCounts={invoiceStatusCounts}
                processedInvoices={processedInvoices}
                paginatedInvoices={paginatedInvoices}
                invoicePage={invoicePage}
                setInvoicePage={setInvoicePage}
                totalInvoicePages={totalInvoicePages}
                pageFinancials={pageFinancials}
                selectedCurrency={selectedCurrency}
                onCollectInvoice={(invId) => {
                  playTapSound();
                  setTargetReceiptInvoiceId(invId);
                  setReceiptDialogOpen(true);
                }}
                onPreviewInvoice={(invId) => void handleInvoicePreview(invId)}
                onEditInvoice={(invId) => void handleInvoiceEdit(invId)}
                onPrintInvoice={(invId) => void handleInvoicePrint(invId)}
                onShareInvoice={(invId) => void handleInvoiceShare(invId)}
              />
            )}

            {activeTab === "invoices" && customerProformas.length > 0 && (
              <div className="rounded-2xl border border-[#C5A059]/30 bg-card p-3.5 space-y-2.5 shadow-2xs">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-[#C5A059]" />
                    <span className="text-xs font-black text-foreground">
                      عروض الأسعار المرتبطة بالعميل ({customerProformas.length})
                    </span>
                  </div>
                  <span className="text-[10px] font-bold text-muted-foreground">
                    استرشادية — لا تدخل ضمن حساب المديونية
                  </span>
                </div>
                <div className="divide-y divide-border/40">
                  {customerProformas.map((pf) => (
                    <div
                      key={pf.id}
                      className="flex flex-wrap items-center justify-between gap-2 py-2 text-xs"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-mono font-black text-primary" dir="ltr">
                          {pf.reference || `#${pf.meta.serial}`}
                        </span>
                        <span className="text-muted-foreground font-mono text-[11px]">
                          {pf.meta.date}
                        </span>
                        <span className="font-mono font-bold text-foreground tabular-nums">
                          {formatNumber(pf.totalAmount)} {getCurrencyShortLabel(pf.currency)} ({sanitizeCurrency(pf.currency, "SDG")})
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => setPreviewInvoice(pf)}
                          className="h-7 px-2 rounded-lg text-[11px] font-bold gap-1 cursor-pointer"
                        >
                          <Eye className="h-3.5 w-3.5" />
                          <span>معاينة</span>
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => setEditingInvoice(pf)}
                          className="h-7 px-2 rounded-lg text-[11px] font-bold gap-1 text-blue-600 cursor-pointer"
                        >
                          <Edit2 className="h-3.5 w-3.5" />
                          <span>تعديل</span>
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {activeTab === "statement" && (
              <CustomerDetailStatementTab
                statementSearch={statementSearch}
                setStatementSearch={setStatementSearch}
                statementTypeFilter={statementTypeFilter}
                setStatementTypeFilter={setStatementTypeFilter}
                statementFrom={statementFrom}
                statementTo={statementTo}
                onStatementRangeChange={handleStatementRangeChange}
                statementPageSize={statementPageSize}
                setStatementPageSize={setStatementPageSize}
                selectedCurrency={selectedCurrency}
                paginatedStatementLines={paginatedStatementLines}
                processedStatementLinesCount={processedStatementLines.length}
                statementPage={statementPage}
                setStatementPage={setStatementPage}
                totalStatementPages={totalStatementPages}
                allStatements={orderedActiveStatements}
                onSelectCurrency={(cur) => void handleCurrencyChange(cur)}
                statementViewAllCurrencies={statementViewAllCurrencies}
                onToggleViewAllCurrencies={setStatementViewAllCurrencies}
              />
            )}

            {activeTab === "info" && (
              <div className="rounded-2xl border border-border/70 bg-card p-4 sm:p-5 space-y-4 text-xs shadow-2xs">
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                  <div>
                    <span className="text-[10.5px] text-muted-foreground font-bold">معرف العميل في النظام (ID)</span>
                    <p className="font-mono font-bold text-foreground mt-0.5 text-xs">{customer.id}</p>
                  </div>
                  <div>
                    <span className="text-[10.5px] text-muted-foreground font-bold">تاريخ التسجيل</span>
                    <p className="font-mono font-bold text-foreground mt-0.5 text-xs">
                      {customer.createdAt.slice(0, 10)}
                    </p>
                  </div>
                  <div>
                    <span className="text-[10.5px] text-muted-foreground font-bold">رقم الهاتف</span>
                    <p className="font-mono font-bold text-primary mt-0.5 text-xs" dir="ltr">
                      {customer.phone || "—"}
                    </p>
                  </div>
                </div>

                {customer.openingBalance ? (
                  <div className="border-t border-border/50 pt-3">
                    <span className="text-[10.5px] text-muted-foreground font-bold">حركة الرصيد الافتتاحي</span>
                    <p className="font-bold text-foreground mt-0.5 text-xs">
                      {formatNumber(customer.openingBalance)}{" "}
                      {getCurrencyShortLabel(customer.openingBalanceCurrency)} (
                      {sanitizeCurrency(customer.openingBalanceCurrency, "SDG")}){" "}
                      ({customer.openingBalanceType === "credit" ? "رصيد دائن / دفعة مقدمة" : "مديونية سابقة مستحقة"})
                    </p>
                    {customer.openingBalanceNotes && (
                      <p className="text-[11px] text-muted-foreground mt-0.5">{customer.openingBalanceNotes}</p>
                    )}
                  </div>
                ) : null}

                {customer.notes && (
                  <div className="border-t border-border/50 pt-3">
                    <span className="text-[10.5px] text-muted-foreground font-bold">ملاحظات وشروط خاصة</span>
                    <p className="text-foreground mt-0.5 text-xs">{customer.notes}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {showScrollTop && (
          <button
            type="button"
            onClick={scrollToTop}
            className="fixed bottom-20 md:bottom-8 left-6 z-40 p-2.5 rounded-full bg-primary text-white shadow-xl hover:bg-primary/90 transition-all cursor-pointer touch-manipulation active:scale-95 animate-in fade-in flex items-center justify-center border border-white/20"
            title="العودة لأعلى الصفحة"
          >
            <ArrowUp className="h-4 w-4" />
          </button>
        )}
      </main>

      <CustomerDialog
        open={editDialogOpen}
        onClose={() => setEditDialogOpen(false)}
        initialData={customer}
        onSave={async (updatedData) => {
          await updateCustomer(customer.id, updatedData);
          setEditDialogOpen(false);
          onCustomerUpdated?.();
          void loadAllCustomerData();
        }}
      />

      <ReceiptDialog
        open={receiptDialogOpen}
        onOpenChange={setReceiptDialogOpen}
        initialCustomerId={customer.id}
        initialInvoiceId={targetReceiptInvoiceId}
        defaultCurrency={sanitizeCurrency(selectedCurrency, "SDG")}
        onRecorded={() => {
          void loadAllCustomerData();
          onCustomerUpdated?.();
        }}
      />

      {previewInvoice && (
        <BillingPreviewModal
          invoice={previewInvoice}
          open={Boolean(previewInvoice)}
          onOpenChange={(open) => {
            if (!open) setPreviewInvoice(null);
          }}
          onEdit={(inv) => {
            setPreviewInvoice(null);
            setEditingInvoice(inv);
          }}
        />
      )}

      {editingInvoice && (
        <CustomInvoiceDialog
          open={Boolean(editingInvoice)}
          onOpenChange={(open) => {
            if (!open) setEditingInvoice(null);
          }}
          initialType={editingInvoice.meta.type || "sales"}
          invoiceToEdit={editingInvoice}
          onSaved={(saved) => {
            setEditingInvoice(null);
            setPreviewInvoice(saved);
            void loadAllCustomerData();
            onCustomerUpdated?.();
          }}
        />
      )}

      {letterDialogOpen && (
        <Suspense fallback={null}>
          <LazyLetterIssuerDialog
            open={letterDialogOpen}
            onOpenChange={setLetterDialogOpen}
            initialRecipientName={customer.name}
          />
        </Suspense>
      )}
    </PageShell>
  );
}
