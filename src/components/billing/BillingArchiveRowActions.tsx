import React from "react";
import {
  Printer,
  Edit2,
  Trash2,
  Copy,
  Eye,
  Receipt,
  Wallet,
  ArrowLeftRight,
  Share2,
  Loader2,
} from "lucide-react";
import type { CustomInvoice } from "@/lib/billing/types";
import type { ProformaInvoice } from "@/lib/proforma/types";
import type { InvoiceRecord } from "@/lib/invoicesStore";
import type { UnifiedInvoiceRecord } from "@/components/invoices/types";

interface BillingArchiveRowActionsProps {
  rec: UnifiedInvoiceRecord;
  outstanding: number;
  convertingId: string | null;
  sharingId: string | null;
  variant?: "table" | "card";
  onRecordPayment?: (invoiceId: string) => void;
  onRecordPurchasePayment?: (invoiceId: string) => void;
  onConvertProformaToSales: (rec: UnifiedInvoiceRecord) => void;
  onPreviewCustom: (invoice: CustomInvoice) => void;
  onPreviewProforma?: (invoice: ProformaInvoice) => void;
  onPreviewCalc?: (invoice: InvoiceRecord) => void;
  onPrintCustom: (invoice: CustomInvoice) => void;
  onShareCustom: (rec: UnifiedInvoiceRecord) => void;
  onEditCustom: (invoice: CustomInvoice) => void;
  onEditProforma?: (invoice: ProformaInvoice) => void;
  onDuplicate: (rec: UnifiedInvoiceRecord) => void;
  onRequestDelete: (rec: UnifiedInvoiceRecord) => void;
}

export function BillingArchiveRowActions({
  rec,
  outstanding,
  convertingId,
  sharingId,
  variant = "table",
  onRecordPayment,
  onRecordPurchasePayment,
  onConvertProformaToSales,
  onPreviewCustom,
  onPreviewProforma,
  onPreviewCalc,
  onPrintCustom,
  onShareCustom,
  onEditCustom,
  onEditProforma,
  onDuplicate,
  onRequestDelete,
}: BillingArchiveRowActionsProps) {
  const isCustom = rec.kind === "custom";
  const isProforma = rec.kind === "proforma";
  const isCalc = rec.kind === "calculator";

  const handlePreview = () => {
    if (isProforma && onPreviewProforma) onPreviewProforma(rec.raw);
    else if (isCustom) onPreviewCustom(rec.raw);
    else if (isCalc && onPreviewCalc) onPreviewCalc(rec.raw);
  };

  const handlePrint = () => {
    if (isProforma && onPreviewProforma) onPreviewProforma(rec.raw);
    else if (isCustom) onPrintCustom(rec.raw);
    else if (isCalc && onPreviewCalc) onPreviewCalc(rec.raw);
  };

  const handleEdit = () => {
    if (isProforma && onEditProforma) onEditProforma(rec.raw);
    else if (isCustom) onEditCustom(rec.raw);
  };

  if (variant === "card") {
    const canCollect = isCustom && rec.type === "sales" && outstanding > 0 && Boolean(onRecordPayment);
    const canPaySupplier =
      isCustom && rec.type === "purchase" && outstanding > 0 && Boolean(onRecordPurchasePayment);
    const canConvert = isProforma || (isCustom && rec.type === "proforma");

    return (
      <div className="flex items-center justify-between gap-2 pt-2 border-t border-border/50 w-full min-w-0">
        {/* Primary CTA on RTL start */}
        <div className="flex items-center gap-1.5 shrink-0">
          {canCollect && onRecordPayment ? (
            <button
              type="button"
              onClick={() => onRecordPayment(rec.id)}
              title="تسجيل دفعة تحصيل"
              className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-emerald-500/35 bg-emerald-500/10 hover:bg-emerald-600 hover:text-white px-2.5 text-[11px] font-black text-emerald-700 dark:text-emerald-300 transition-all cursor-pointer active:scale-95 touch-manipulation whitespace-nowrap"
            >
              <Receipt className="h-3.5 w-3.5 shrink-0" />
              <span>تحصيل</span>
            </button>
          ) : canPaySupplier && onRecordPurchasePayment ? (
            <button
              type="button"
              onClick={() => onRecordPurchasePayment(rec.id)}
              title="سداد فاتورة المشتريات"
              className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-rose-500/35 bg-rose-500/10 hover:bg-rose-600 hover:text-white px-2.5 text-[11px] font-black text-rose-700 dark:text-rose-300 transition-all cursor-pointer active:scale-95 touch-manipulation whitespace-nowrap"
            >
              <Wallet className="h-3.5 w-3.5 shrink-0" />
              <span>سداد</span>
            </button>
          ) : canConvert ? (
            <button
              type="button"
              disabled={convertingId === rec.id}
              onClick={() => onConvertProformaToSales(rec)}
              title="تحويل إلى فاتورة مبيعات"
              className="inline-flex h-8 items-center gap-1 rounded-xl border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-600 hover:text-white px-2.5 text-[11px] font-black text-emerald-700 dark:text-emerald-300 transition-all cursor-pointer active:scale-95 disabled:opacity-50 touch-manipulation whitespace-nowrap"
            >
              <ArrowLeftRight className="h-3.5 w-3.5 shrink-0" />
              <span>لمبيعات</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={handlePreview}
              title="معاينة المستند"
              className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-border/70 bg-secondary/70 hover:bg-primary hover:text-white hover:border-primary px-2.5 text-[11px] font-black text-foreground transition-all cursor-pointer active:scale-95 touch-manipulation whitespace-nowrap"
            >
              <Eye className="h-3.5 w-3.5 shrink-0" />
              <span>معاينة</span>
            </button>
          )}
        </div>

        {/* Compact Horizontal Utility Icons on RTL end */}
        <div className="flex flex-nowrap items-center gap-0.5 shrink-0">
          {(canCollect || canPaySupplier || canConvert) && (
            <button
              type="button"
              onClick={handlePreview}
              title="معاينة المستند"
              aria-label="معاينة المستند"
              className="h-8 w-8 rounded-xl flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors active:scale-90 cursor-pointer touch-manipulation"
            >
              <Eye className="h-4 w-4" />
            </button>
          )}

          <button
            type="button"
            onClick={handlePrint}
            title="طباعة سريعة / PDF"
            aria-label="طباعة سريعة"
            className="h-8 w-8 rounded-xl flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors active:scale-90 cursor-pointer touch-manipulation"
          >
            <Printer className="h-4 w-4" />
          </button>

          {isCustom && (
            <button
              type="button"
              disabled={sharingId === rec.id}
              onClick={() => onShareCustom(rec)}
              title="مشاركة الفاتورة عبر واتساب"
              aria-label="مشاركة عبر واتساب"
              className="h-8 w-8 rounded-xl flex items-center justify-center text-muted-foreground hover:text-[#25D366] hover:bg-[#25D366]/10 transition-colors active:scale-90 disabled:opacity-60 cursor-pointer touch-manipulation"
            >
              {sharingId === rec.id ? (
                <Loader2 className="h-4 w-4 animate-spin text-[#25D366]" />
              ) : (
                <Share2 className="h-4 w-4" />
              )}
            </button>
          )}

          {(isCustom || isProforma) && (
            <button
              type="button"
              onClick={handleEdit}
              title="تعديل الفاتورة"
              aria-label="تعديل الفاتورة"
              className="h-8 w-8 rounded-xl flex items-center justify-center text-muted-foreground hover:text-blue-500 hover:bg-blue-500/10 transition-colors active:scale-90 cursor-pointer touch-manipulation"
            >
              <Edit2 className="h-4 w-4" />
            </button>
          )}

          {isCustom && (
            <button
              type="button"
              onClick={() => onDuplicate(rec)}
              title="نسخ وتكرار الفاتورة"
              aria-label="نسخ وتكرار الفاتورة"
              className="h-8 w-8 rounded-xl flex items-center justify-center text-muted-foreground hover:text-amber-500 hover:bg-amber-500/10 transition-colors active:scale-90 cursor-pointer touch-manipulation"
            >
              <Copy className="h-4 w-4" />
            </button>
          )}

          <button
            type="button"
            onClick={() => onRequestDelete(rec)}
            title="حذف الفاتورة"
            aria-label="حذف الفاتورة"
            className="h-8 w-8 rounded-xl flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors active:scale-90 cursor-pointer touch-manipulation"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  // Table mode: strictly flex-nowrap single horizontal row (never stacks vertically)
  return (
    <div className="flex flex-nowrap items-center justify-center gap-0.5 whitespace-nowrap">
      {isCustom && rec.type === "sales" && outstanding > 0 && onRecordPayment && (
        <button
          type="button"
          onClick={() => onRecordPayment(rec.id)}
          title="تسجيل دفعة تحصيل"
          className="h-8 w-8 shrink-0 rounded-lg flex items-center justify-center text-emerald-600 hover:bg-emerald-500/10 transition-colors active:scale-90 cursor-pointer"
        >
          <Receipt className="h-4 w-4" />
        </button>
      )}

      {isCustom && rec.type === "purchase" && outstanding > 0 && onRecordPurchasePayment && (
        <button
          type="button"
          onClick={() => onRecordPurchasePayment(rec.id)}
          title="سداد فاتورة المشتريات"
          className="h-8 w-8 shrink-0 rounded-lg flex items-center justify-center text-rose-600 hover:bg-rose-500/10 transition-colors active:scale-90 cursor-pointer"
        >
          <Wallet className="h-4 w-4" />
        </button>
      )}

      {(isProforma || (isCustom && rec.type === "proforma")) && (
        <button
          type="button"
          disabled={convertingId === rec.id}
          onClick={() => onConvertProformaToSales(rec)}
          title="تحويل إلى فاتورة مبيعات"
          className="h-8 shrink-0 px-2 rounded-lg inline-flex items-center gap-1 text-[10.5px] font-black text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/25 transition-colors active:scale-95 disabled:opacity-50 cursor-pointer whitespace-nowrap"
        >
          <ArrowLeftRight className="h-3.5 w-3.5" />
          <span>لمبيعات</span>
        </button>
      )}

      <button
        type="button"
        onClick={handlePreview}
        title="معاينة المستند"
        className="h-8 w-8 shrink-0 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors active:scale-90 cursor-pointer"
      >
        <Eye className="h-4 w-4" />
      </button>

      <button
        type="button"
        onClick={handlePrint}
        title="طباعة سريعة / PDF"
        className="h-8 w-8 shrink-0 rounded-lg flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors active:scale-90 cursor-pointer"
      >
        <Printer className="h-4 w-4" />
      </button>

      {isCustom && (
        <button
          type="button"
          disabled={sharingId === rec.id}
          onClick={() => onShareCustom(rec)}
          title="مشاركة الفاتورة عبر واتساب"
          className="h-8 w-8 shrink-0 rounded-lg flex items-center justify-center text-muted-foreground hover:text-[#25D366] hover:bg-[#25D366]/10 transition-colors active:scale-90 disabled:opacity-60 cursor-pointer"
        >
          {sharingId === rec.id ? (
            <Loader2 className="h-4 w-4 animate-spin text-[#25D366]" />
          ) : (
            <Share2 className="h-4 w-4" />
          )}
        </button>
      )}

      {(isCustom || isProforma) && (
        <button
          type="button"
          onClick={handleEdit}
          title="تعديل الفاتورة"
          className="h-8 w-8 shrink-0 rounded-lg flex items-center justify-center text-muted-foreground hover:text-blue-500 hover:bg-blue-500/10 transition-colors active:scale-90 cursor-pointer"
        >
          <Edit2 className="h-4 w-4" />
        </button>
      )}

      {isCustom && (
        <button
          type="button"
          onClick={() => onDuplicate(rec)}
          title="نسخ وتكرار الفاتورة"
          className="h-8 w-8 shrink-0 rounded-lg flex items-center justify-center text-muted-foreground hover:text-amber-500 hover:bg-amber-500/10 transition-colors active:scale-90 cursor-pointer"
        >
          <Copy className="h-4 w-4" />
        </button>
      )}

      <button
        type="button"
        onClick={() => onRequestDelete(rec)}
        title="حذف الفاتورة"
        className="h-8 w-8 shrink-0 rounded-lg flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors active:scale-90 cursor-pointer"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}
