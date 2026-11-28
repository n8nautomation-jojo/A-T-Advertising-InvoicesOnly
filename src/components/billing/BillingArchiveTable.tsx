import React, { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  Search,
  FileText,
  TrendingUp,
  ShoppingBag,
  Calculator,
  UserCheck,
  UserPlus,
  LayoutGrid,
  List,
  ArrowUpDown,
  Calendar,
  X,
} from "lucide-react";
import { Input } from "@/components/ui/input";
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
import type { CustomInvoice, CustomInvoiceType } from "@/lib/billing/types";
import type { ProformaInvoice } from "@/lib/proforma/types";
import type { InvoiceRecord } from "@/lib/invoicesStore";
import {
  convertProformaToSalesInvoice,
  deleteCustomInvoice,
  linkCustomInvoiceToCustomer,
  saveCustomInvoice,
} from "@/lib/billing/store";
import {
  findOrCreateCustomerByName,
  useCustomers,
  type CustomerRecord,
} from "@/lib/customersStore";
import { normalizeCustomerName } from "@/lib/customers/customerMatching";
import { deleteProformaInvoice } from "@/lib/proforma/store";
import { deleteInvoice } from "@/lib/invoicesStore";
import { getLocalIsoDate } from "@/lib/dateUtils";
import { router } from "@/router";
import { formatAccountingNumber } from "./StandardInvoiceDocument";
import {
  printCustomInvoiceDocument,
  shareCustomInvoiceViaWhatsApp,
} from "./CustomInvoicePrintButton";
import { BillingArchiveRowActions } from "./BillingArchiveRowActions";
import { toast } from "sonner";
import { useUnifiedInvoices } from "@/components/invoices/useUnifiedInvoices";
import { InvoicePaginationBar } from "@/components/invoices/InvoicePaginationBar";
import { settlementFor, useSettlementVersion } from "@/lib/financeStore";
import type { UnifiedInvoiceRecord } from "@/components/invoices/types";
import { getCurrencyShortLabel } from "@/lib/currency/currencyFormat";
import { CURRENCY_LIST } from "@/lib/currency/types";
import { formatNumber } from "@/lib/printCalculator";

type ArchivePaymentFilter = "all" | "unpaid" | "partial" | "paid";
type ArchiveSortKey = "date-desc" | "date-asc" | "amount-desc" | "debt-desc";

interface Props {
  invoices?: CustomInvoice[];
  onEditCustom: (invoice: CustomInvoice) => void;
  onPreviewCustom: (invoice: CustomInvoice) => void;
  onEditProforma?: (invoice: ProformaInvoice) => void;
  onPreviewProforma?: (invoice: ProformaInvoice) => void;
  onRecordPayment?: (invoiceId: string) => void;
  onRecordPurchasePayment?: (invoiceId: string) => void;
  onPreviewCalc?: (invoice: InvoiceRecord) => void;
  onCreateNew?: (type: CustomInvoiceType) => void;
}

function getDefaultViewMode(): "cards" | "table" {
  if (typeof window !== "undefined" && window.innerWidth < 768) {
    return "cards";
  }
  return "table";
}

function getDefaultPageSize(): number {
  if (typeof window !== "undefined" && window.innerWidth < 768) {
    return 25;
  }
  return 50;
}

export function BillingArchiveTable({
  onEditCustom,
  onPreviewCustom,
  onEditProforma,
  onPreviewProforma,
  onRecordPayment,
  onRecordPurchasePayment,
  onPreviewCalc,
}: Props) {
  const customers = useCustomers();
  const { customersById, customersByNormName } = useMemo(() => {
    const byId = new Map<string, CustomerRecord>();
    const byName = new Map<string, CustomerRecord>();
    for (const c of customers) {
      byId.set(c.id, c);
      if (!c.isArchived) {
        const norm = normalizeCustomerName(c.name);
        if (norm && !byName.has(norm)) {
          byName.set(norm, c);
        }
      }
    }
    return { customersById: byId, customersByNormName: byName };
  }, [customers]);

  const containerRef = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [selectedType, setSelectedType] = useState<string>("all");
  const [paymentFilter, setPaymentFilter] = useState<ArchivePaymentFilter>("all");
  const [currencyFilter, setCurrencyFilter] = useState<string>("ALL");
  const [sortKey, setSortKey] = useState<ArchiveSortKey>("date-desc");
  const [viewMode, setViewMode] = useState<"cards" | "table">(getDefaultViewMode);
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(getDefaultPageSize);

  const [convertingId, setConvertingId] = useState<string | null>(null);
  const [sharingId, setSharingId] = useState<string | null>(null);
  const [linkingInvoiceId, setLinkingInvoiceId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<UnifiedInvoiceRecord | null>(null);

  useEffect(() => {
    setPage(1);
  }, [deferredSearch, selectedType, paymentFilter, currencyFilter, sortKey, pageSize]);

  const handleOpenCustomerProfile = (customerId: string) => {
    void router.navigate({ to: "/customers", search: { id: customerId } });
  };

  const handleSaveWalkInAsCustomer = async (inv: CustomInvoice) => {
    const partyName = (inv.meta.partyName || inv.meta.partyEnName || "").trim();
    if (!partyName || linkingInvoiceId) return;
    setLinkingInvoiceId(inv.id);
    try {
      const { customer, created, unarchived } = await findOrCreateCustomerByName({
        name: partyName,
        phone: inv.meta.phone,
        type: "client",
      });
      await linkCustomInvoiceToCustomer(inv.id, customer.id);
      const statusText = created
        ? `تمت إضافة «${customer.name}» لدليل العملاء وربط الفاتورة بملفه`
        : unarchived
        ? `تمت استعادة «${customer.name}» من الأرشيف وربط الفاتورة بملفه`
        : `تم ربط الفاتورة بملف «${customer.name}» المسجّل مسبقاً`;

      toast.success("تم التوثيق والربط بنجاح", {
        description: statusText,
        action: {
          label: "فتح ملف العميل",
          onClick: () => handleOpenCustomerProfile(customer.id),
        },
      });
    } catch (err) {
      toast.error("تعذّر ربط الفاتورة بملف عميل", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setLinkingInvoiceId(null);
    }
  };

  const handleConvertProformaToSales = async (rec: UnifiedInvoiceRecord) => {
    if (convertingId) return;
    if (!(rec.kind === "proforma" || (rec.kind === "custom" && rec.type === "proforma"))) return;
    setConvertingId(rec.id);
    try {
      const { salesInvoice, alreadyConverted } = await convertProformaToSalesInvoice(
        rec.raw as CustomInvoice | ProformaInvoice
      );
      toast.success(
        alreadyConverted ? "العرض محوَّل مسبقاً" : "تم التحويل إلى فاتورة مبيعات",
        {
          description: `فاتورة المبيعات ${salesInvoice.reference || "—"} محفوظة في سجل المبيعات.`,
        }
      );
    } catch (err) {
      toast.error("تعذّر التحويل إلى فاتورة مبيعات", {
        description: err instanceof Error ? err.message : "خطأ غير متوقع.",
      });
    } finally {
      setConvertingId(null);
    }
  };

  const settlementVersion = useSettlementVersion();
  const unifiedResult = useUnifiedInvoices(
    deferredSearch,
    selectedType,
    currencyFilter
  );
  const baseFiltered = unifiedResult.filteredRecords ?? [];
  const countsByType = useMemo(() => {
    if (unifiedResult.countsByType) return unifiedResult.countsByType;
    const c = { all: baseFiltered.length, sales: 0, purchase: 0, proforma: 0, calculator: 0 };
    for (const r of baseFiltered) {
      if (r.type === "sales") c.sales += 1;
      else if (r.type === "purchase") c.purchase += 1;
      else if (r.type === "proforma") c.proforma += 1;
      else if (r.type === "calculator") c.calculator += 1;
    }
    return c;
  }, [unifiedResult.countsByType, baseFiltered]);

  // Payment status filtering & sorting (O(N), zero extra allocations when default)
  const processedRecords = useMemo(() => {
    void settlementVersion;
    let list = baseFiltered;

    if (paymentFilter !== "all") {
      list = list.filter((rec) => {
        if (rec.kind !== "custom" || (rec.type !== "sales" && rec.type !== "purchase")) {
          return false;
        }
        const st = settlementFor(rec.id, Number(rec.total) || 0);
        if (paymentFilter === "paid") return st.outstanding <= 0.009;
        if (paymentFilter === "partial") return st.paid > 0.009 && st.outstanding > 0.009;
        // unpaid = any open balance (unpaid + partial)
        return st.outstanding > 0.009;
      });
    }

    if (sortKey === "date-desc") {
      return list;
    }

    const sorted = [...list];
    if (sortKey === "date-asc") {
      sorted.sort((a, b) => {
        const dc = (a.date || "").localeCompare(b.date || "");
        if (dc !== 0) return dc;
        return a.serial.localeCompare(b.serial, undefined, { numeric: true });
      });
    } else if (sortKey === "amount-desc") {
      sorted.sort((a, b) => (Number(b.total) || 0) - (Number(a.total) || 0));
    } else if (sortKey === "debt-desc") {
      sorted.sort((a, b) => {
        const remA =
          a.kind === "custom" && (a.type === "sales" || a.type === "purchase")
            ? settlementFor(a.id, Number(a.total) || 0).outstanding
            : 0;
        const remB =
          b.kind === "custom" && (b.type === "sales" || b.type === "purchase")
            ? settlementFor(b.id, Number(b.total) || 0).outstanding
            : 0;
        return remB - remA;
      });
    }
    return sorted;
  }, [baseFiltered, paymentFilter, sortKey, settlementVersion]);

  const totalPages = Math.max(1, Math.ceil(processedRecords.length / pageSize));
  const safePage = Math.min(page, totalPages);

  const pageRecords = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return processedRecords.slice(start, start + pageSize);
  }, [processedRecords, safePage, pageSize]);

  const handlePageChange = (nextPage: number) => {
    setPage(nextPage);
    if (containerRef.current && typeof containerRef.current.scrollIntoView === "function") {
      try {
        containerRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
      } catch {
        // ignore jsdom scrollIntoView unsupported options
      }
    }
  };

  const executeDelete = async (rec: UnifiedInvoiceRecord) => {
    try {
      if (rec.kind === "proforma") await deleteProformaInvoice(rec.id);
      else if (rec.kind === "custom") await deleteCustomInvoice(rec.id);
      else if (rec.kind === "calculator") deleteInvoice(rec.id);
      toast.success("تم الحذف", { description: `تم حذف ${rec.typeLabel} #${rec.serial} بنجاح` });
    } catch (err) {
      toast.error("تعذّر الحذف", { description: err instanceof Error ? err.message : undefined });
    } finally {
      setPendingDelete(null);
    }
  };

  const handleDuplicate = async (rec: UnifiedInvoiceRecord) => {
    if (rec.kind !== "custom") {
      toast("تنبيه", { description: "يمكن تكرار فواتير المبيعات والمشتريات السريعة مباشرة من هنا" });
      return;
    }
    const inv = rec.raw as CustomInvoice;
    // BUG-009: Preserve original customer/party name untouched on duplication and never stack "(نسخة)"
    const cleanPartyName =
      String(inv.meta.partyName ?? "")
        .replace(/(?:\s*\(نسخة\))+$/g, "")
        .trim() || inv.meta.partyName;

    const duplicated: CustomInvoice = {
      ...inv,
      id: `custom-inv-${Date.now()}`,
      reference: undefined,
      referenceAssignedAt: undefined,
      meta: { ...inv.meta, partyName: cleanPartyName, date: getLocalIsoDate() },
      items: (inv.items || []).map((item, index) => ({
        ...item,
        id: `dup-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 6)}`,
      })),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    try {
      const saved = await saveCustomInvoice(duplicated);
      toast.success("تم تكرار الفاتورة", { description: `تم إنشاء نسخة جديدة بالمرجع ${saved.reference || "—"}` });
    } catch (err) {
      toast.error("تعذّر تكرار الفاتورة", { description: err instanceof Error ? err.message : "خطأ غير متوقع." });
    }
  };

  const handlePrintCustom = async (invoice: CustomInvoice) => {
    try {
      await printCustomInvoiceDocument(invoice);
    } catch (err) {
      toast.error("تعذّرت الطباعة", {
        description: err instanceof Error ? err.message : "حدث خطأ غير متوقع أثناء الطباعة.",
      });
    }
  };

  const handleShareCustom = async (rec: UnifiedInvoiceRecord) => {
    if (sharingId || rec.kind !== "custom") return;
    setSharingId(rec.id);
    try {
      await shareCustomInvoiceViaWhatsApp(rec.raw as CustomInvoice);
    } catch (err) {
      toast.error("تعذّرت المشاركة", {
        description: err instanceof Error ? err.message : "حدث خطأ أثناء مشاركة الفاتورة.",
      });
    } finally {
      setSharingId(null);
    }
  };

  const renderCustomerCell = (rec: UnifiedInvoiceRecord) => {
    const isCustom = rec.kind === "custom";
    const isProforma = rec.kind === "proforma";

    if (isCustom && rec.type !== "purchase") {
      const linkedCustomer = rec.raw.customerId ? customersById.get(rec.raw.customerId) : undefined;
      const matchedByName = !linkedCustomer
        ? customersByNormName.get(normalizeCustomerName(rec.customerName))
        : undefined;

      if (linkedCustomer) {
        return (
          <button
            type="button"
            onClick={() => handleOpenCustomerProfile(linkedCustomer.id)}
            className="inline-flex items-start gap-1.5 text-right text-foreground hover:text-primary transition-colors cursor-pointer group/cust leading-snug break-words"
            title="فتح ملف العميل وكشف الحساب"
          >
            <UserCheck className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
            <span className="group-hover/cust:underline break-words">{rec.customerName}</span>
          </button>
        );
      }

      return (
        <div className="space-y-1 min-w-0">
          <span className="block leading-snug break-words">{rec.customerName}</span>
          <div className="flex flex-wrap items-center gap-1">
            {!matchedByName && (
              <span className="rounded-full border border-border/70 bg-secondary/60 px-1.5 py-0.2 text-[9.5px] font-bold text-muted-foreground whitespace-nowrap">
                عابر
              </span>
            )}
            <button
              type="button"
              disabled={linkingInvoiceId === rec.id}
              onClick={() => void handleSaveWalkInAsCustomer(rec.raw)}
              className="inline-flex items-center gap-1 rounded-lg border border-primary/30 bg-primary/5 px-1.5 py-0.5 text-[10px] font-black text-primary hover:bg-primary hover:text-white transition-colors cursor-pointer disabled:opacity-50 whitespace-nowrap"
              title={
                matchedByName
                  ? `ربط هذه الفاتورة بملف ${matchedByName.name}`
                  : "حفظ في دليل العملاء وربط الفاتورة"
              }
            >
              <UserPlus className="h-3 w-3 shrink-0" />
              <span>{matchedByName ? "ربط بملفه" : "حفظ كعميل"}</span>
            </button>
          </div>
        </div>
      );
    }

    if (isProforma) {
      const matched = customersByNormName.get(normalizeCustomerName(rec.customerName));
      return matched ? (
        <button
          type="button"
          onClick={() => handleOpenCustomerProfile(matched.id)}
          className="inline-flex items-start gap-1.5 text-right text-foreground hover:text-primary hover:underline transition-colors cursor-pointer leading-snug break-words"
          title="فتح ملف العميل"
        >
          <UserCheck className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
          <span className="break-words">{rec.customerName}</span>
        </button>
      ) : (
        <span className="block leading-snug break-words">{rec.customerName}</span>
      );
    }

    return <span className="block leading-snug break-words">{rec.customerName}</span>;
  };

  return (
    <div
      ref={containerRef}
      className="rounded-2xl sm:rounded-3xl border border-border/60 bg-card/95 shadow-md overflow-hidden w-full max-w-full"
      dir="rtl"
    >
      {/* Top Toolbar: Type Tabs + View Switcher + Search + Multi-Filters */}
      <div className="p-3 sm:p-4 border-b border-border/50 space-y-2.5 bg-card">
        {/* Row 1: Type Tabs + View Mode Toggle */}
        <div className="flex flex-wrap items-center justify-between gap-2 min-w-0">
          <div className="flex items-center gap-1 p-1 rounded-2xl bg-muted/60 overflow-x-auto scrollbar-none overscroll-x-contain flex-nowrap min-w-0 flex-1 sm:flex-initial">
            {(
              [
                { id: "all", label: "كافة الفواتير", count: countsByType.all },
                { id: "sales", label: "فواتير مبيعات", count: countsByType.sales },
                { id: "purchase", label: "فواتير مشتريات", count: countsByType.purchase },
                { id: "proforma", label: "فواتير مبدئية", count: countsByType.proforma },
              ] as const
            ).map((tab) => {
              const active = selectedType === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setSelectedType(tab.id)}
                  className={`shrink-0 inline-flex items-center gap-1.5 whitespace-nowrap px-2.5 sm:px-3 py-1.5 rounded-xl text-xs font-black transition-all touch-manipulation active:scale-95 cursor-pointer ${
                    active
                      ? "bg-card text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <span>{tab.label}</span>
                  <bdi
                    dir="ltr"
                    className={`rounded-full px-1.5 py-0.2 text-[10px] font-mono tabular-nums ${
                      active ? "bg-primary/10 text-primary" : "bg-background/60 text-muted-foreground"
                    }`}
                  >
                    {formatNumber(tab.count)}
                  </bdi>
                </button>
              );
            })}
          </div>

          {/* Cards / Table View Mode Toggle */}
          <div
            className="flex items-center bg-muted/70 p-0.5 rounded-xl border border-border/60 shrink-0"
            role="group"
            aria-label="نمط عرض الفواتير"
          >
            <button
              type="button"
              data-testid="billing-view-cards-btn"
              onClick={() => setViewMode("cards")}
              className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-black transition-all cursor-pointer touch-manipulation ${
                viewMode === "cards"
                  ? "bg-card text-primary shadow-2xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              title="عرض البطاقات الذكية (مثالي للهاتف)"
            >
              <LayoutGrid className="h-3.5 w-3.5 shrink-0" />
              <span className="hidden xs:inline">بطاقات</span>
            </button>
            <button
              type="button"
              data-testid="billing-view-table-btn"
              onClick={() => setViewMode("table")}
              className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-black transition-all cursor-pointer touch-manipulation ${
                viewMode === "table"
                  ? "bg-card text-primary shadow-2xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              title="عرض الجدول المالي عالي الكثافة"
            >
              <List className="h-3.5 w-3.5 shrink-0" />
              <span className="hidden xs:inline">جدول</span>
            </button>
          </div>
        </div>

        {/* Row 2: Search Bar + Compact Currency / Sort / Payment Filters */}
        <div className="flex flex-col lg:flex-row items-stretch lg:items-center gap-2 min-w-0">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="بحث فوري برقم الفاتورة، اسم العميل، التاريخ، أو العملة..."
              className="h-9.5 pr-9 pl-8 rounded-xl text-xs font-bold bg-background border-border/60 text-right"
              dir="rtl"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                aria-label="مسح البحث"
                className="absolute left-2 top-1/2 -translate-y-1/2 grid h-6 w-6 place-items-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted cursor-pointer"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1.5 shrink-0">
            {/* Payment Status Pills */}
            <div className="flex items-center gap-1 rounded-xl bg-muted/50 p-0.5 border border-border/50">
              {(
                [
                  { id: "all", label: "الكل" },
                  { id: "unpaid", label: "غير مسددة" },
                  { id: "partial", label: "جزئي" },
                  { id: "paid", label: "مسددة" },
                ] as const
              ).map((st) => (
                <button
                  key={st.id}
                  type="button"
                  onClick={() => setPaymentFilter(st.id)}
                  className={`px-2 py-1 rounded-lg text-[10.5px] font-black transition-all cursor-pointer touch-manipulation whitespace-nowrap ${
                    paymentFilter === st.id
                      ? "bg-primary text-primary-foreground shadow-2xs"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {st.label}
                </button>
              ))}
            </div>

            {/* Currency Filter */}
            <select
              aria-label="تصفية حسب العملة"
              value={currencyFilter}
              onChange={(e) => setCurrencyFilter(e.target.value)}
              className="h-8 rounded-xl border border-border/60 bg-background px-2 text-[11px] font-black text-foreground outline-hidden cursor-pointer"
            >
              <option value="ALL">كل العملات</option>
              {CURRENCY_LIST.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.flag} {c.code}
                </option>
              ))}
            </select>

            {/* Sort Selector */}
            <div className="inline-flex items-center gap-1 h-8 rounded-xl border border-border/60 bg-background px-2">
              <ArrowUpDown className="h-3 w-3 text-muted-foreground shrink-0" />
              <select
                aria-label="ترتيب الفواتير"
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value as ArchiveSortKey)}
                className="bg-transparent text-[11px] font-black text-foreground outline-hidden cursor-pointer"
              >
                <option value="date-desc">الأحدث تاريخاً</option>
                <option value="date-asc">الأقدم تاريخاً</option>
                <option value="amount-desc">الأعلى قيمة</option>
                <option value="debt-desc">الأعلى متبقي</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content: Empty State | Upgraded Executive Cards | Single-Line High-Density Table */}
      {processedRecords.length === 0 ? (
        <div className="py-12 px-4 text-center text-muted-foreground">
          <div className="flex flex-col items-center justify-center space-y-2">
            <FileText className="h-10 w-10 text-muted-foreground/40" />
            <p className="text-sm font-bold text-foreground">لا توجد فواتير مطابقة للبحث أو الفلترة</p>
            <p className="text-xs text-muted-foreground">
              جرّب تغيير نوع الفاتورة أو مسح نص البحث لعرض جميع السجلات المحفوظة
            </p>
          </div>
        </div>
      ) : viewMode === "cards" ? (
        <div
          data-testid="billing-archive-cards-grid"
          className="grid grid-cols-1 md:grid-cols-2 gap-2.5 p-3 sm:p-4 bg-muted/15 w-full min-w-0"
        >
          {pageRecords.map((rec) => {
            const isCustom = rec.kind === "custom";
            const isProforma = rec.kind === "proforma";
            const isCalc = rec.kind === "calculator";
            const settlement = settlementFor(rec.id, Number(rec.total) || 0);
            const hasSettlement = isCustom && (rec.type === "sales" || rec.type === "purchase");
            const isPaid = hasSettlement && settlement.outstanding <= 0.009;
            const isPartial =
              hasSettlement && settlement.paid > 0.009 && settlement.outstanding > 0.009;

            const accentBorder =
              isCustom && rec.type === "sales"
                ? "border-r-emerald-600"
                : isCustom && rec.type === "purchase"
                ? "border-r-purple-600"
                : isProforma || (isCustom && rec.type === "proforma")
                ? "border-r-[#C5A059]"
                : "border-r-primary";

            return (
              <article
                key={`${rec.kind}-${rec.id}`}
                data-testid="billing-invoice-card"
                className={`rounded-2xl border border-border/75 border-r-[3.5px] ${accentBorder} bg-card hover:border-primary/40 p-3 space-y-2 shadow-2xs transition-all w-full min-w-0`}
              >
                {/* Top Strip: Invoice # + Type Badge + Settlement Status + Date */}
                <div className="flex items-center justify-between gap-2 pb-1.5 border-b border-border/45 min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                    <bdi dir="ltr" className="font-mono font-black text-primary text-xs tabular-nums">
                      {/^(INV|PINV|RCV|PAY|EXP)-/.test(rec.serial) ? rec.serial : `#${rec.serial}`}
                    </bdi>
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9.5px] font-black border ${rec.badgeColor}`}
                    >
                      {isProforma && <FileText className="h-2.5 w-2.5 shrink-0" />}
                      {isCustom && rec.type === "sales" && <TrendingUp className="h-2.5 w-2.5 shrink-0" />}
                      {isCustom && rec.type === "purchase" && <ShoppingBag className="h-2.5 w-2.5 shrink-0" />}
                      {isCalc && <Calculator className="h-2.5 w-2.5 shrink-0" />}
                      <span>{rec.typeLabel}</span>
                    </span>
                    {hasSettlement && (
                      <span
                        className={`rounded-full px-1.5 py-0.5 text-[9px] font-black border ${
                          isPaid
                            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                            : isPartial
                            ? "border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                            : "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300"
                        }`}
                      >
                        {isPaid ? "مسدَّدة" : isPartial ? "جزئي" : "غير مسددة"}
                      </span>
                    )}
                  </div>

                  <span className="inline-flex items-center gap-1 text-[10px] font-mono font-bold text-muted-foreground shrink-0">
                    <Calendar className="h-3 w-3 opacity-70 shrink-0" />
                    <bdi dir="ltr" className="tabular-nums">
                      {rec.date}
                    </bdi>
                  </span>
                </div>

                {/* Body: Customer Name + Items Count (right) | Total + Remaining (left) */}
                <div className="flex items-start justify-between gap-2.5 min-w-0">
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="font-black text-xs sm:text-sm text-foreground">
                      {renderCustomerCell(rec)}
                    </div>
                    <p className="text-[10px] font-bold text-muted-foreground">
                      {rec.itemsCount > 0 ? `${rec.itemsCount} بند مسجل` : "تفاصيل عامة"}
                    </p>
                  </div>

                  <div className="text-left shrink-0 space-y-0.5">
                    <p className="font-mono font-black text-sm text-foreground leading-tight tabular-nums">
                      <bdi dir="ltr">{formatAccountingNumber(rec.total)}</bdi>{" "}
                      <bdi dir="ltr" className="text-[10px] font-bold text-muted-foreground uppercase">
                        {rec.currency || "SDG"}
                      </bdi>
                    </p>
                    {hasSettlement && settlement.outstanding > 0.009 && (
                      <p
                        className={`text-[10.5px] font-bold leading-tight ${
                          rec.type === "purchase"
                            ? "text-rose-600 dark:text-rose-400"
                            : "text-amber-600 dark:text-amber-400"
                        }`}
                      >
                        <span>متبقي </span>
                        <bdi dir="ltr" className="font-mono font-black tabular-nums">
                          {formatAccountingNumber(settlement.outstanding)}
                        </bdi>{" "}
                        <span>{getCurrencyShortLabel(rec.currency)}</span>
                      </p>
                    )}
                  </div>
                </div>

                {/* Footer: Single-Row Compact FinTech Action Bar */}
                <BillingArchiveRowActions
                  variant="card"
                  rec={rec}
                  outstanding={settlement.outstanding}
                  convertingId={convertingId}
                  sharingId={sharingId}
                  onRecordPayment={onRecordPayment}
                  onRecordPurchasePayment={onRecordPurchasePayment}
                  onConvertProformaToSales={(r) => void handleConvertProformaToSales(r)}
                  onPreviewCustom={onPreviewCustom}
                  onPreviewProforma={onPreviewProforma}
                  onPreviewCalc={onPreviewCalc}
                  onPrintCustom={(inv) => void handlePrintCustom(inv)}
                  onShareCustom={(r) => void handleShareCustom(r)}
                  onEditCustom={onEditCustom}
                  onEditProforma={onEditProforma}
                  onDuplicate={(r) => void handleDuplicate(r)}
                  onRequestDelete={(r) => setPendingDelete(r)}
                />
              </article>
            );
          })}
        </div>
      ) : (
        <div
          className="overflow-x-auto overscroll-x-contain w-full max-w-full"
          data-testid="billing-archive-scroll-box"
        >
          <table className="w-full text-right text-xs table-auto">
            <thead>
              <tr className="bg-muted/40 text-muted-foreground font-black border-b border-border/50 h-10 sm:h-11">
                <th className="py-2 px-2.5 sm:px-3.5 text-center whitespace-nowrap">الرقم</th>
                <th className="py-2 px-2.5 sm:px-3.5 whitespace-nowrap">نوع الفاتورة</th>
                <th className="py-2 px-2.5 sm:px-3.5 min-w-[140px] sm:min-w-[175px]">العميل / الجهة</th>
                <th className="hidden md:table-cell py-2 px-3 text-center whitespace-nowrap">التاريخ</th>
                <th className="hidden lg:table-cell py-2 px-3 whitespace-nowrap">البنود</th>
                <th className="py-2 px-2.5 sm:px-3.5 text-left whitespace-nowrap">إجمالي القيمة</th>
                <th className="py-2 px-2.5 sm:px-3.5 text-center whitespace-nowrap">الإجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {pageRecords.map((rec) => {
                const isCustom = rec.kind === "custom";
                const isProforma = rec.kind === "proforma";
                const isCalc = rec.kind === "calculator";
                const settlement = settlementFor(rec.id, Number(rec.total) || 0);

                return (
                  <tr
                    key={`${rec.kind}-${rec.id}`}
                    className="hover:bg-muted/30 transition-colors group text-foreground font-bold align-middle"
                  >
                    <td className="py-2.5 px-2.5 sm:px-3.5 text-center whitespace-nowrap">
                      <bdi dir="ltr" className="font-mono font-black text-primary text-[11px] sm:text-xs">
                        {/^(INV|PINV|RCV|PAY|EXP)-/.test(rec.serial) ? rec.serial : `#${rec.serial}`}
                      </bdi>
                      <span className="md:hidden block mt-0.5 text-[10px] font-mono text-muted-foreground">
                        <bdi dir="ltr">{rec.date}</bdi>
                      </span>
                    </td>

                    <td className="py-2.5 px-2.5 sm:px-3.5 whitespace-nowrap">
                      <span
                        className={`inline-flex items-center gap-1 px-2 sm:px-2.5 py-0.5 rounded-full text-[10px] sm:text-[10.5px] font-black border ${rec.badgeColor}`}
                      >
                        {isProforma && <FileText className="h-3 w-3 shrink-0" />}
                        {isCustom && rec.type === "sales" && <TrendingUp className="h-3 w-3 shrink-0" />}
                        {isCustom && rec.type === "purchase" && <ShoppingBag className="h-3 w-3 shrink-0" />}
                        {isCalc && <Calculator className="h-3 w-3 shrink-0" />}
                        <span>{rec.typeLabel}</span>
                      </span>
                      <span className="lg:hidden block mt-0.5 text-[10px] font-medium text-muted-foreground">
                        {rec.itemsCount > 0 ? `${rec.itemsCount} بند` : "تفاصيل عامة"}
                      </span>
                    </td>

                    <td className="py-2.5 px-2.5 sm:px-3.5 font-black text-xs sm:text-sm text-foreground min-w-[140px] sm:min-w-[175px] max-w-[260px]">
                      {renderCustomerCell(rec)}
                    </td>

                    <td className="hidden md:table-cell py-2.5 px-3 text-center font-mono text-muted-foreground whitespace-nowrap">
                      <bdi dir="ltr">{rec.date}</bdi>
                    </td>

                    <td className="hidden lg:table-cell py-2.5 px-3 max-w-[160px] truncate text-muted-foreground">
                      {rec.itemsCount > 0 ? `${rec.itemsCount} بند مسجل` : "تفاصيل عامة"}
                    </td>

                    <td className="py-2.5 px-2.5 sm:px-3.5 text-left font-mono text-xs sm:text-sm whitespace-nowrap">
                      <span className="font-black text-foreground">
                        <bdi dir="ltr" className="tabular-nums">
                          {formatAccountingNumber(rec.total)}
                        </bdi>{" "}
                        <span className="text-[10px] font-mono font-bold text-muted-foreground uppercase">
                          {rec.currency || "SDG"}
                        </span>
                      </span>
                      {isCustom && (rec.type === "sales" || rec.type === "purchase") && (
                        <span
                          className={`mt-0.5 block text-[10px] font-sans font-bold ${
                            settlement.outstanding > 0
                              ? rec.type === "purchase"
                                ? "text-rose-600 dark:text-rose-400"
                                : "text-amber-600 dark:text-amber-400"
                              : "text-emerald-600 dark:text-emerald-400"
                          }`}
                        >
                          {settlement.outstanding > 0 ? (
                            <>
                              <span>متبقي </span>
                              <bdi dir="ltr" className="font-mono tabular-nums">
                                {formatAccountingNumber(settlement.outstanding)}
                              </bdi>{" "}
                              <span>{getCurrencyShortLabel(rec.currency)}</span>
                            </>
                          ) : (
                            "مسدَّدة"
                          )}
                        </span>
                      )}
                    </td>

                    <td className="py-2.5 px-2 sm:px-3 text-center whitespace-nowrap">
                      <BillingArchiveRowActions
                        variant="table"
                        rec={rec}
                        outstanding={settlement.outstanding}
                        convertingId={convertingId}
                        sharingId={sharingId}
                        onRecordPayment={onRecordPayment}
                        onRecordPurchasePayment={onRecordPurchasePayment}
                        onConvertProformaToSales={(r) => void handleConvertProformaToSales(r)}
                        onPreviewCustom={onPreviewCustom}
                        onPreviewProforma={onPreviewProforma}
                        onPreviewCalc={onPreviewCalc}
                        onPrintCustom={(inv) => void handlePrintCustom(inv)}
                        onShareCustom={(r) => void handleShareCustom(r)}
                        onEditCustom={onEditCustom}
                        onEditProforma={onEditProforma}
                        onDuplicate={(r) => void handleDuplicate(r)}
                        onRequestDelete={(r) => setPendingDelete(r)}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* 100k-Scale Constant-DOM Pagination Bar */}
      <InvoicePaginationBar
        page={safePage}
        totalPages={totalPages}
        pageSize={pageSize}
        totalCount={processedRecords.length}
        onPageChange={handlePageChange}
        onPageSizeChange={(nextSize) => setPageSize(nextSize)}
      />

      <AlertDialog open={Boolean(pendingDelete)} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent dir="rtl" className="rounded-3xl">
          <AlertDialogHeader className="text-right">
            <AlertDialogTitle className="font-black text-base">
              تأكيد حذف المستند
            </AlertDialogTitle>
            <AlertDialogDescription className="text-xs leading-relaxed">
              {pendingDelete
                ? `هل أنت متأكد من حذف ${pendingDelete.typeLabel} #${pendingDelete.serial} لـ «${pendingDelete.customerName}»؟`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:justify-start">
            <AlertDialogCancel className="rounded-xl text-xs font-bold">إلغاء</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => pendingDelete && void executeDelete(pendingDelete)}
              className="rounded-xl text-xs font-black bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              تأكيد الحذف
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
