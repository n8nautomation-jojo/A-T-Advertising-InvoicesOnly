import React from "react";
import {
  Printer,
  Share2,
  Eye,
  Edit2,
  ChevronRight,
  ChevronLeft,
  ChevronsRight,
  ChevronsLeft,
  ArrowUpDown,
  Search,
  LayoutGrid,
  List,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CustomerInvoiceItemRow } from "@/lib/customersStore";
import { formatNumber } from "@/lib/printCalculator";
import { playTapSound } from "@/lib/soundEffects";

export type InvoiceStatusFilter = "all" | "unpaid" | "partial" | "overdue" | "paid";
export type InvoiceSortKey = "date-desc" | "date-asc" | "debt-desc" | "amount-desc" | "amount-asc";

interface CustomerDetailInvoicesTabProps {
  invoiceSearch: string;
  setInvoiceSearch: (v: string) => void;
  deferredInvoiceSearch: string;
  invoiceSort: InvoiceSortKey;
  setInvoiceSort: (v: InvoiceSortKey) => void;
  invoicePageSize: number;
  setInvoicePageSize: (n: number) => void;
  invoiceViewMode: "table" | "cards";
  setInvoiceViewMode: (m: "table" | "cards") => void;
  invoiceStatusFilter: InvoiceStatusFilter;
  setInvoiceStatusFilter: (f: InvoiceStatusFilter) => void;
  invoiceStatusCounts: Record<InvoiceStatusFilter, number>;
  processedInvoices: CustomerInvoiceItemRow[];
  paginatedInvoices: CustomerInvoiceItemRow[];
  invoicePage: number;
  setInvoicePage: React.Dispatch<React.SetStateAction<number>>;
  totalInvoicePages: number;
  pageFinancials: { pageTotal: number; pageRemaining: number };
  selectedCurrency: string;
  onCollectInvoice: (invoiceId: string) => void;
  onPreviewInvoice?: (invoiceId: string) => void;
  onEditInvoice?: (invoiceId: string) => void;
  onPrintInvoice: (invoiceId: string) => void;
  onShareInvoice: (invoiceId: string) => void;
}

export function CustomerDetailInvoicesTab({
  invoiceSearch,
  setInvoiceSearch,
  deferredInvoiceSearch,
  invoiceSort,
  setInvoiceSort,
  invoicePageSize,
  setInvoicePageSize,
  invoiceViewMode,
  setInvoiceViewMode,
  invoiceStatusFilter,
  setInvoiceStatusFilter,
  invoiceStatusCounts,
  processedInvoices,
  paginatedInvoices,
  invoicePage,
  setInvoicePage,
  totalInvoicePages,
  pageFinancials,
  selectedCurrency,
  onCollectInvoice,
  onPreviewInvoice,
  onEditInvoice,
  onPrintInvoice,
  onShareInvoice,
}: CustomerDetailInvoicesTabProps) {
  return (
    <div className="space-y-3">
      {/* شريط الأدوات: البحث، الفرز، الترقيم، ونمط العرض */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 bg-card p-3 rounded-2xl border border-border/70 shadow-2xs">
        <div className="relative flex-1">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input
            type="text"
            placeholder="بحث سريع برقم الفاتورة، التاريخ، الاستحقاق، أو القيمة..."
            value={invoiceSearch}
            onChange={(e) => setInvoiceSearch(e.target.value)}
            className="h-9.5 pr-8 pl-8 text-xs bg-secondary/40 rounded-xl border-border/70 placeholder:text-muted-foreground/70"
          />
          {invoiceSearch && (
            <button
              type="button"
              onClick={() => setInvoiceSearch("")}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground text-xs p-1 cursor-pointer"
            >
              ✕
            </button>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0 justify-between sm:justify-end flex-wrap">
          <div className="flex items-center gap-1 bg-secondary/50 px-2 py-1.5 rounded-xl border border-border/60">
            <ArrowUpDown className="h-3 w-3 text-muted-foreground shrink-0" />
            <select
              aria-label="ترتيب الفواتير"
              value={invoiceSort}
              onChange={(e) => setInvoiceSort(e.target.value as InvoiceSortKey)}
              className="bg-transparent text-xs font-bold text-foreground border-none outline-hidden cursor-pointer"
            >
              <option value="date-desc">الأحدث تاريخاً</option>
              <option value="date-asc">الأقدم تاريخاً</option>
              <option value="debt-desc">الأعلى متبقي (مديونية)</option>
              <option value="amount-desc">الأعلى قيمة</option>
              <option value="amount-asc">الأقل قيمة</option>
            </select>
          </div>

          <div className="flex items-center gap-1 bg-secondary/50 px-2 py-1.5 rounded-xl border border-border/60">
            <span className="text-[10px] text-muted-foreground font-bold">عرض:</span>
            <select
              aria-label="عدد الفواتير لكل صفحة"
              value={invoicePageSize}
              onChange={(e) => setInvoicePageSize(Number(e.target.value))}
              className="bg-transparent text-xs font-bold text-foreground border-none outline-hidden cursor-pointer"
            >
              <option value={20}>20</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </div>

          <div className="flex items-center bg-secondary/70 p-0.5 rounded-xl border border-border/60">
            <button
              type="button"
              onClick={() => {
                playTapSound();
                setInvoiceViewMode("table");
              }}
              className={`p-1.5 rounded-lg transition-all cursor-pointer ${
                invoiceViewMode === "table"
                  ? "bg-card text-foreground shadow-2xs font-bold"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              title="عرض الجدول المالي عالي الكثافة (موصى به للأعداد الكبيرة)"
            >
              <List className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => {
                playTapSound();
                setInvoiceViewMode("cards");
              }}
              className={`p-1.5 rounded-lg transition-all cursor-pointer ${
                invoiceViewMode === "cards"
                  ? "bg-card text-foreground shadow-2xs font-bold"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              title="عرض البطاقات التنفيذية"
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* تبويبات الفلترة حسب الحالة مع أعداد حية */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs scrollbar-none touch-pan-x overscroll-x-contain select-none">
        {[
          { key: "all" as const, label: `كل الفواتير (${invoiceStatusCounts.all})` },
          { key: "unpaid" as const, label: `غير مسددة (${invoiceStatusCounts.unpaid})` },
          { key: "partial" as const, label: `مسددة جزئياً (${invoiceStatusCounts.partial})` },
          { key: "overdue" as const, label: `متأخرة (${invoiceStatusCounts.overdue})` },
          { key: "paid" as const, label: `مسددة بالكامل (${invoiceStatusCounts.paid})` },
        ].map((sub) => (
          <button
            key={sub.key}
            type="button"
            onClick={() => {
              playTapSound();
              setInvoiceStatusFilter(sub.key);
            }}
            className={`px-3.5 py-1.5 rounded-full font-bold shrink-0 transition-all cursor-pointer touch-manipulation active:scale-95 ${
              invoiceStatusFilter === sub.key
                ? "bg-primary text-white shadow-2xs"
                : "bg-secondary/60 text-muted-foreground hover:bg-secondary hover:text-foreground border border-border/50"
            }`}
          >
            {sub.label}
          </button>
        ))}
      </div>

      {processedInvoices.length > 0 && (
        <div className="flex flex-wrap items-center justify-between text-xs px-2 text-muted-foreground gap-2">
          <div>
            عرض{" "}
            <span className="font-bold text-foreground">
              {Math.min((invoicePage - 1) * invoicePageSize + 1, processedInvoices.length)} -{" "}
              {Math.min(invoicePage * invoicePageSize, processedInvoices.length)}
            </span>{" "}
            من إجمالي{" "}
            <span className="font-bold text-foreground">{processedInvoices.length}</span> فاتورة
            {deferredInvoiceSearch && (
              <span className="text-primary font-bold mr-1.5">
                (تمت التصفية حسب: "{deferredInvoiceSearch}")
              </span>
            )}
          </div>

          <div className="flex items-center gap-3 font-mono text-[11px]">
            <span>
              إجمالي الصفحة:{" "}
              <strong className="text-foreground font-black">{formatNumber(pageFinancials.pageTotal)}</strong>{" "}
              {selectedCurrency}
            </span>
            <span>
              المتبقي في الصفحة:{" "}
              <strong className={pageFinancials.pageRemaining > 0 ? "text-rose-600 font-bold" : "text-emerald-600 font-bold"}>
                {formatNumber(pageFinancials.pageRemaining)}
              </strong>{" "}
              {selectedCurrency}
            </span>
          </div>
        </div>
      )}

      {processedInvoices.length === 0 ? (
        <div className="py-16 text-center text-xs font-bold text-muted-foreground border border-dashed border-border/70 rounded-2xl bg-card">
          لا توجد فواتير مطابقة لهذا التصنيف أو نتيجة البحث
        </div>
      ) : invoiceViewMode === "table" ? (
        <div className="rounded-2xl border border-border/70 overflow-hidden bg-card shadow-2xs">
          <div className="overflow-x-auto max-h-[640px] overscroll-contain touch-pan-x">
            <table className="w-full text-right text-xs">
              <thead className="sticky top-0 bg-muted/95 backdrop-blur-xs text-muted-foreground text-[11px] border-b border-border/70 z-10 shadow-xs">
                <tr>
                  <th className="py-3 px-3.5 font-black">رقم الفاتورة</th>
                  <th className="py-3 px-3.5 font-black">التاريخ</th>
                  <th className="py-3 px-3.5 font-black text-left" dir="ltr">الإجمالي</th>
                  <th className="py-3 px-3.5 font-black text-left" dir="ltr">المتبقي</th>
                  <th className="py-3 px-3.5 font-black text-center">الحالة</th>
                  <th className="py-3 px-3.5 font-black text-center">الإجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40 font-mono text-[11px]">
                {paginatedInvoices.map((inv) => (
                  <tr key={inv.id} className="hover:bg-secondary/40 transition-colors">
                    <td className="py-3 px-3.5 font-black text-primary text-xs" dir="ltr">
                      {inv.reference || `#${inv.serial}`}
                    </td>
                    <td className="py-3 px-3.5 text-muted-foreground font-sans">
                      {inv.date}
                      {inv.dueDate && (
                        <span
                          className={`block text-[9.5px] ${
                            inv.status === "overdue" ? "text-rose-600 font-bold" : "text-muted-foreground/70"
                          }`}
                        >
                          الاستحقاق: {inv.dueDate}
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-3.5 text-left font-black tabular-nums text-foreground text-xs" dir="ltr">
                      {formatNumber(inv.totalAmount)} {inv.currency}
                    </td>
                    <td className="py-3 px-3.5 text-left font-black tabular-nums text-xs" dir="ltr">
                      {inv.remainingAmount > 0 ? (
                        <span className="text-rose-600 dark:text-rose-400">
                          {formatNumber(inv.remainingAmount)} {inv.currency}
                        </span>
                      ) : (
                        <span className="text-emerald-600 font-sans font-bold">مسددة</span>
                      )}
                    </td>
                    <td className="py-3 px-3.5 text-center">
                      <span
                        className={`inline-block rounded-full px-2.5 py-0.5 text-[9.5px] font-sans font-black border ${inv.statusBadgeColor}`}
                      >
                        {inv.statusLabel}
                      </span>
                    </td>
                    <td className="py-3 px-3.5 text-center font-sans">
                      <div className="flex items-center justify-center gap-1.5">
                        {inv.remainingAmount > 0 && (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => onCollectInvoice(inv.id)}
                            className="h-7 px-2.5 rounded-lg text-xs font-bold text-emerald-600 border-emerald-500/30 bg-emerald-500/5 hover:bg-emerald-500/15 cursor-pointer"
                            title="تحصيل دفعة لهذه الفاتورة"
                          >
                            تحصيل
                          </Button>
                        )}
                        {onPreviewInvoice && (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => onPreviewInvoice(inv.id)}
                            className="h-7 w-7 p-0 rounded-lg text-muted-foreground hover:text-foreground cursor-pointer"
                            title="معاينة الفاتورة"
                            aria-label="معاينة الفاتورة"
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        {onEditInvoice && (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => onEditInvoice(inv.id)}
                            className="h-7 w-7 p-0 rounded-lg text-muted-foreground hover:text-blue-600 cursor-pointer"
                            title="تعديل الفاتورة"
                            aria-label="تعديل الفاتورة"
                          >
                            <Edit2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => onPrintInvoice(inv.id)}
                          className="h-7 w-7 p-0 rounded-lg text-muted-foreground hover:text-foreground cursor-pointer"
                          title="طباعة الفاتورة"
                        >
                          <Printer className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => onShareInvoice(inv.id)}
                          className="h-7 w-7 p-0 rounded-lg text-emerald-600 hover:bg-emerald-500/10 cursor-pointer"
                          title="مشاركة الفاتورة عبر واتساب"
                        >
                          <Share2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {paginatedInvoices.map((inv) => (
            <div
              key={inv.id}
              className="rounded-2xl border border-border/70 bg-card hover:bg-secondary/30 transition-all p-4 space-y-3 shadow-2xs"
            >
              <div className="flex items-start justify-between gap-2 border-b border-border/40 pb-2.5">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-black text-sm text-primary" dir="ltr">
                      {inv.reference || `#${inv.serial}`}
                    </span>
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-[9.5px] font-black border ${inv.statusBadgeColor}`}
                    >
                      {inv.statusLabel}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    <span>التاريخ: {inv.date}</span>
                    {inv.dueDate && (
                      <span className={`mr-2 ${inv.status === "overdue" ? "text-rose-600 font-bold" : ""}`}>
                        الاستحقاق: {inv.dueDate}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-xl border border-border/60 bg-secondary/30 p-2.5">
                  <span className="text-[10px] text-muted-foreground font-bold block">إجمالي الفاتورة</span>
                  <p className="font-mono text-sm font-black text-foreground tabular-nums mt-0.5">
                    {formatNumber(inv.totalAmount)} {inv.currency}
                  </p>
                </div>
                <div className="rounded-xl border border-border/60 bg-secondary/30 p-2.5">
                  <span className="text-[10px] text-muted-foreground font-bold block">المتبقي المطلوب</span>
                  <p className="font-mono text-sm font-black tabular-nums mt-0.5">
                    {inv.remainingAmount > 0 ? (
                      <span className="text-rose-600 dark:text-rose-400">
                        {formatNumber(inv.remainingAmount)} {inv.currency}
                      </span>
                    ) : (
                      <span className="text-emerald-600 font-sans font-bold">مسددة بالكامل</span>
                    )}
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-between gap-2 pt-2 border-t border-border/40">
                {inv.remainingAmount > 0 ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => onCollectInvoice(inv.id)}
                    className="h-8 px-3 rounded-xl text-xs font-bold text-emerald-600 border-emerald-500/30 bg-emerald-500/5 hover:bg-emerald-500/15 cursor-pointer active:scale-95"
                  >
                    تحصيل دفعة
                  </Button>
                ) : (
                  <span className="text-xs text-muted-foreground font-medium">لا توجد مستحقات</span>
                )}

                <div className="flex items-center gap-1.5">
                  {onPreviewInvoice && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => onPreviewInvoice(inv.id)}
                      className="h-8 w-8 p-0 rounded-xl text-muted-foreground hover:text-foreground cursor-pointer"
                      title="معاينة الفاتورة"
                      aria-label="معاينة الفاتورة"
                    >
                      <Eye className="h-4 w-4" />
                    </Button>
                  )}

                  {onEditInvoice && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => onEditInvoice(inv.id)}
                      className="h-8 w-8 p-0 rounded-xl text-muted-foreground hover:text-blue-600 cursor-pointer"
                      title="تعديل الفاتورة"
                      aria-label="تعديل الفاتورة"
                    >
                      <Edit2 className="h-4 w-4" />
                    </Button>
                  )}

                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => onPrintInvoice(inv.id)}
                    className="h-8 w-8 p-0 rounded-xl text-muted-foreground hover:text-foreground cursor-pointer"
                    title="طباعة الفاتورة"
                  >
                    <Printer className="h-4 w-4" />
                  </Button>

                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => onShareInvoice(inv.id)}
                    className="h-8 w-8 p-0 rounded-xl text-emerald-600 hover:bg-emerald-500/10 cursor-pointer"
                    title="مشاركة الفاتورة عبر واتساب"
                  >
                    <Share2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {totalInvoicePages > 1 && (
        <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-border/60 text-xs bg-card p-3 rounded-2xl border shadow-2xs">
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={invoicePage <= 1}
              onClick={() => {
                playTapSound();
                setInvoicePage(1);
              }}
              className="h-8.5 w-8.5 p-0 rounded-xl cursor-pointer"
              title="الصفحة الأولى"
            >
              <ChevronsRight className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={invoicePage <= 1}
              onClick={() => {
                playTapSound();
                setInvoicePage((p) => Math.max(1, p - 1));
              }}
              className="h-8.5 w-8.5 p-0 rounded-xl cursor-pointer"
              title="الصفحة السابقة"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>

            <div className="px-3.5 py-1.5 bg-secondary/60 rounded-xl font-mono font-bold text-foreground text-xs border border-border/50">
              صفحة {invoicePage} من {totalInvoicePages}
            </div>

            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={invoicePage >= totalInvoicePages}
              onClick={() => {
                playTapSound();
                setInvoicePage((p) => Math.min(totalInvoicePages, p + 1));
              }}
              className="h-8.5 w-8.5 p-0 rounded-xl cursor-pointer"
              title="الصفحة التالية"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={invoicePage >= totalInvoicePages}
              onClick={() => {
                playTapSound();
                setInvoicePage(totalInvoicePages);
              }}
              className="h-8.5 w-8.5 p-0 rounded-xl cursor-pointer"
              title="الصفحة الأخيرة"
            >
              <ChevronsLeft className="h-4 w-4" />
            </Button>
          </div>

          <div className="flex items-center gap-2 text-muted-foreground text-xs">
            <span>انتقال سريع:</span>
            <Input
              type="number"
              min={1}
              max={totalInvoicePages}
              value={invoicePage}
              onChange={(e) => {
                const val = Number(e.target.value);
                if (val >= 1 && val <= totalInvoicePages) {
                  setInvoicePage(val);
                }
              }}
              className="h-8.5 w-18 text-center text-xs font-mono font-bold bg-secondary/50 rounded-xl border-border/70 p-1"
            />
          </div>
        </div>
      )}
    </div>
  );
}
