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

  return (
    <div className="flex items-center justify-center gap-1">
      {isCustom && rec.type === "sales" && outstanding > 0 && onRecordPayment && (
        <button
          type="button"
          onClick={() => onRecordPayment(rec.id)}
          title="تسجيل دفعة تحصيل"
          className="h-8 w-8 rounded-lg flex items-center justify-center text-emerald-600 hover:bg-emerald-500/10 transition-colors active:scale-90"
        >
          <Receipt className="h-4 w-4" />
        </button>
      )}

      {isCustom && rec.type === "purchase" && outstanding > 0 && onRecordPurchasePayment && (
        <button
          type="button"
          onClick={() => onRecordPurchasePayment(rec.id)}
          title="سداد فاتورة المشتريات"
          className="h-8 w-8 rounded-lg flex items-center justify-center text-rose-600 hover:bg-rose-500/10 transition-colors active:scale-90"
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
          className="h-8 px-2 rounded-lg inline-flex items-center gap-1 text-[10.5px] font-black text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/25 transition-colors active:scale-95 disabled:opacity-50"
        >
          <ArrowLeftRight className="h-3.5 w-3.5" />
          <span>لمبيعات</span>
        </button>
      )}

      <button
        type="button"
        onClick={() => {
          if (isProforma && onPreviewProforma) onPreviewProforma(rec.raw);
          else if (isCustom) onPreviewCustom(rec.raw);
          else if (isCalc && onPreviewCalc) onPreviewCalc(rec.raw);
        }}
        title="معاينة المستند"
        className="h-8 w-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors active:scale-90"
      >
        <Eye className="h-4 w-4" />
      </button>

      <button
        type="button"
        onClick={() => {
          if (isProforma && onPreviewProforma) onPreviewProforma(rec.raw);
          else if (isCustom) onPrintCustom(rec.raw);
          else if (isCalc && onPreviewCalc) onPreviewCalc(rec.raw);
        }}
        title="طباعة سريعة / PDF"
        className="h-8 w-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors active:scale-90"
      >
        <Printer className="h-4 w-4" />
      </button>

      {isCustom && (
        <button
          type="button"
          disabled={sharingId === rec.id}
          onClick={() => onShareCustom(rec)}
          title="مشاركة الفاتورة عبر واتساب"
          className="h-8 w-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-[#25D366] hover:bg-[#25D366]/10 transition-colors active:scale-90 disabled:opacity-60"
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
          onClick={() => {
            if (isProforma && onEditProforma) onEditProforma(rec.raw);
            else if (isCustom) onEditCustom(rec.raw);
          }}
          title="تعديل الفاتورة"
          className="h-8 w-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-blue-500 hover:bg-blue-500/10 transition-colors active:scale-90"
        >
          <Edit2 className="h-4 w-4" />
        </button>
      )}

      {isCustom && (
        <button
          type="button"
          onClick={() => onDuplicate(rec)}
          title="نسخ وتكرار الفاتورة"
          className="h-8 w-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-amber-500 hover:bg-amber-500/10 transition-colors active:scale-90"
        >
          <Copy className="h-4 w-4" />
        </button>
      )}

      <button
        type="button"
        onClick={() => onRequestDelete(rec)}
        title="حذف الفاتورة"
        className="h-8 w-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors active:scale-90"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}
