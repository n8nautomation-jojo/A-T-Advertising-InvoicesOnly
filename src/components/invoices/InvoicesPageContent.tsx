import { useEffect, useMemo, useRef, useState, useDeferredValue } from "react";
import { Link } from "@tanstack/react-router";
import { PlusCircle, ArrowUpDown } from "lucide-react";
import type { InvoiceRecord } from "@/lib/invoicesStore";
import type { CustomInvoice } from "@/lib/billing/types";
import type { ProformaInvoice } from "@/lib/proforma/types";
import { CURRENCY_LIST } from "@/lib/currency/types";
import { formatNumber } from "@/lib/printCalculator";
import { useUnifiedInvoices } from "./useUnifiedInvoices";
import { InvoicesStatsHeader } from "./InvoicesStatsHeader";
import { InvoicesSearchBar } from "./InvoicesSearchBar";
import { InvoiceRecordCard } from "./InvoiceRecordCard";
import { InvoicePaginationBar } from "./InvoicePaginationBar";
import { InvoicesEmptyState } from "./InvoicesEmptyState";
import { InvoicesModalsManager } from "./InvoicesModalsManager";

type ArchiveSortOrder = "date-desc" | "date-asc" | "amount-desc";

/**
 * محتوى شاشة سجل وأرشيف الفواتير والمطالبات الشاملة لكافة مصادر النظام
 * تشمل: الفواتير المبدئية Proforma A4 + فواتير المبيعات والمطالبات + إيصالات الحاسبة
 * مصممة بترقيم صفحات ثابت الـ DOM لدعم 100,000+ فاتورة بسلاسة فائقة.
 */
export function InvoicesPageContent() {
  const listTopRef = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [filterType, setFilterType] = useState("all");
  const [currencyFilter, setCurrencyFilter] = useState("ALL");
  const [sortOrder, setSortOrder] = useState<ArchiveSortOrder>("date-desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // الحالات النشطة للنوافذ المنبثقة
  const [previewCalcInvoice, setPreviewCalcInvoice] = useState<InvoiceRecord | null>(null);
  const [previewCustomInvoice, setPreviewCustomInvoice] = useState<CustomInvoice | null>(null);
  const [editingCustomInvoice, setEditingCustomInvoice] = useState<CustomInvoice | null>(null);
  const [previewProformaInvoice, setPreviewProformaInvoice] = useState<ProformaInvoice | null>(null);
  const [editingProformaInvoice, setEditingProformaInvoice] = useState<ProformaInvoice | null>(null);

  // استخدام الخطاف الموحد لإدارة البيانات مع معالجة غير معطلة لواجهة الإدخال
  const { filteredRecords, stats } = useUnifiedInvoices(deferredSearch, filterType, currencyFilter);

  const sortedRecords = useMemo(() => {
    if (sortOrder === "date-desc") return filteredRecords;
    const copy = [...filteredRecords];
    if (sortOrder === "date-asc") {
      copy.sort((a, b) => {
        const dc = (a.date || "").localeCompare(b.date || "");
        if (dc !== 0) return dc;
        return a.serial.localeCompare(b.serial, undefined, { numeric: true });
      });
    } else if (sortOrder === "amount-desc") {
      copy.sort((a, b) => (Number(b.total) || 0) - (Number(a.total) || 0));
    }
    return copy;
  }, [filteredRecords, sortOrder]);

  useEffect(() => {
    setPage(1);
  }, [deferredSearch, filterType, currencyFilter, sortOrder, pageSize]);

  const totalPages = Math.max(1, Math.ceil(sortedRecords.length / pageSize));
  const safePage = Math.min(page, totalPages);

  const pageItems = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return sortedRecords.slice(start, start + pageSize);
  }, [sortedRecords, safePage, pageSize]);

  const handlePageChange = (nextPage: number) => {
    setPage(nextPage);
    if (listTopRef.current && typeof listTopRef.current.scrollIntoView === "function") {
      try {
        listTopRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
      } catch {
        // ignore jsdom unsupported options
      }
    }
  };

  return (
    <div className="mx-auto max-w-7xl w-full min-w-0 p-3 space-y-3" dir="rtl">
      {/* 1. الترويسة الرئيسية وزر إنشاء فاتورة جديدة */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-2xl border border-border bg-card p-3 shadow-xs border-r-4 border-r-primary w-full min-w-0">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm sm:text-base font-black text-foreground leading-snug break-words">
            سجل وأرشيف الفواتير والمطالبات
          </h2>
          <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug break-words">
            سجل موحد ودائم لكافة فواتير المبيعات، المشتريات، وعروض الأسعار (
            <bdi dir="ltr" className="font-mono font-bold">
              {formatNumber(stats.totalCount)}
            </bdi>{" "}
            فاتورة محفوظة)
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Link
            to="/billing"
            className="inline-flex h-9.5 items-center gap-1.5 rounded-xl bg-primary px-3.5 text-xs font-black text-primary-foreground shadow-xs shadow-primary/25 transition-all active:scale-95 touch-manipulation hover:bg-primary/90"
          >
            <PlusCircle className="h-4 w-4 shrink-0" />
            <span>إصدار فاتورة جديدة</span>
          </Link>
        </div>
      </div>

      {/* 2. مؤشرات الإجماليات المالية */}
      <InvoicesStatsHeader stats={stats} />

      {/* 3. صندوق البحث والفرز مع شبكة البطاقات والترقيم الذكي لـ 100,000+ فاتورة */}
      <div
        ref={listTopRef}
        className="rounded-2xl border border-border bg-card shadow-xs overflow-hidden w-full min-w-0"
      >
        <div className="p-3 space-y-2.5">
          <InvoicesSearchBar
            search={search}
            setSearch={setSearch}
            filterType={filterType}
            setFilterType={setFilterType}
          />

          <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <select
                aria-label="تصفية الأرشيف حسب العملة"
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

              <div className="inline-flex items-center gap-1 h-8 rounded-xl border border-border/60 bg-background px-2">
                <ArrowUpDown className="h-3 w-3 text-muted-foreground shrink-0" />
                <select
                  aria-label="ترتيب الأرشيف"
                  value={sortOrder}
                  onChange={(e) => setSortOrder(e.target.value as ArchiveSortOrder)}
                  className="bg-transparent text-[11px] font-black text-foreground outline-hidden cursor-pointer"
                >
                  <option value="date-desc">الأحدث تاريخاً</option>
                  <option value="date-asc">الأقدم تاريخاً</option>
                  <option value="amount-desc">الأعلى قيمة</option>
                </select>
              </div>
            </div>

            <span className="text-[11px] font-bold text-muted-foreground">
              النتائج:{" "}
              <bdi dir="ltr" className="font-mono font-black text-foreground tabular-nums">
                {formatNumber(sortedRecords.length)}
              </bdi>
            </span>
          </div>

          {/* شبكة بطاقات الفواتير مع DOM ثابت خفيف */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 pt-1 min-w-0">
            {sortedRecords.length === 0 ? (
              <InvoicesEmptyState />
            ) : (
              pageItems.map((item) => (
                <InvoiceRecordCard
                  key={`${item.kind}-${item.id}`}
                  item={item}
                  onPreviewCustom={setPreviewCustomInvoice}
                  onPreviewCalc={setPreviewCalcInvoice}
                  onPreviewProforma={setPreviewProformaInvoice}
                  onEditCustom={setEditingCustomInvoice}
                  onEditProforma={setEditingProformaInvoice}
                />
              ))
            )}
          </div>
        </div>

        <InvoicePaginationBar
          page={safePage}
          totalPages={totalPages}
          pageSize={pageSize}
          totalCount={sortedRecords.length}
          onPageChange={handlePageChange}
          onPageSizeChange={(nextSize) => setPageSize(nextSize)}
        />
      </div>

      {/* 4. مدير النوافذ المنبثقة والمعاينة والطباعة */}
      <InvoicesModalsManager
        previewCalcInvoice={previewCalcInvoice}
        setPreviewCalcInvoice={setPreviewCalcInvoice}
        previewCustomInvoice={previewCustomInvoice}
        setPreviewCustomInvoice={setPreviewCustomInvoice}
        editingCustomInvoice={editingCustomInvoice}
        setEditingCustomInvoice={setEditingCustomInvoice}
        previewProformaInvoice={previewProformaInvoice}
        setPreviewProformaInvoice={setPreviewProformaInvoice}
        editingProformaInvoice={editingProformaInvoice}
        setEditingProformaInvoice={setEditingProformaInvoice}
      />
    </div>
  );
}
