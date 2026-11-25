import { useEffect, useState, useDeferredValue } from "react";
import { Link } from "@tanstack/react-router";
import { PlusCircle } from "lucide-react";
import type { InvoiceRecord } from "@/lib/invoicesStore";
import type { CustomInvoice } from "@/lib/billing/types";
import type { ProformaInvoice } from "@/lib/proforma/types";
import { useUnifiedInvoices } from "./useUnifiedInvoices";
import { InvoicesStatsHeader } from "./InvoicesStatsHeader";
import { InvoicesSearchBar } from "./InvoicesSearchBar";
import { InvoiceRecordCard } from "./InvoiceRecordCard";
import { InvoicesEmptyState } from "./InvoicesEmptyState";
import { InvoicesModalsManager } from "./InvoicesModalsManager";

/**
 * محتوى شاشة سجل وأرشيف الفواتير والمطالبات الشاملة لكافة مصادر النظام
 * تشمل: الفواتير المبدئية Proforma A4 + فواتير المبيعات والمطالبات + إيصالات الحاسبة
 */
export function InvoicesPageContent() {
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [filterType, setFilterType] = useState("all");

  // الحالات النشطة للنوافذ المنبثقة
  const [previewCalcInvoice, setPreviewCalcInvoice] = useState<InvoiceRecord | null>(null);
  const [previewCustomInvoice, setPreviewCustomInvoice] = useState<CustomInvoice | null>(null);
  const [editingCustomInvoice, setEditingCustomInvoice] = useState<CustomInvoice | null>(null);
  const [previewProformaInvoice, setPreviewProformaInvoice] = useState<ProformaInvoice | null>(null);
  const [editingProformaInvoice, setEditingProformaInvoice] = useState<ProformaInvoice | null>(null);

  // استخدام الخطاف الموحد لإدارة البيانات مع معالجة غير معطلة لواجهة الإدخال
  const { filteredRecords, stats } = useUnifiedInvoices(deferredSearch, filterType);

  // تقطيع القائمة المعروضة تدريجياً لضمان خفة الـ DOM وسرعة الاستجابة اللحظية
  const [visibleCount, setVisibleCount] = useState(40);

  useEffect(() => {
    setVisibleCount(40);
  }, [deferredSearch, filterType]);

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
              {stats.totalCount}
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

      {/* 3. صندوق البحث والفرز مع شبكة البطاقات */}
      <div className="rounded-2xl border border-border bg-card p-3 shadow-xs space-y-2.5 w-full min-w-0">
        <InvoicesSearchBar
          search={search}
          setSearch={setSearch}
          filterType={filterType}
          setFilterType={setFilterType}
        />

        {/* شبكة بطاقات الفواتير مع التقطيع الذكي الخفيف */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 pt-1 min-w-0">
          {filteredRecords.length === 0 ? (
            <InvoicesEmptyState />
          ) : (
            filteredRecords.slice(0, visibleCount).map((item) => (
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

        {/* زر عرض المزيد إذا كان هناك سجلات إضافية في الأرشيف */}
        {filteredRecords.length > visibleCount && (
          <div className="flex flex-col items-center justify-center pt-2 pb-1">
            <button
              type="button"
              onClick={() => setVisibleCount((prev) => prev + 40)}
              className="px-4 py-2 rounded-xl text-xs font-black bg-primary/10 hover:bg-primary/20 text-primary border border-primary/25 transition-all cursor-pointer active:scale-95"
            >
              عرض المزيد من الفواتير ({filteredRecords.length - visibleCount} فاتورة إضافية)
            </button>
          </div>
        )}
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
