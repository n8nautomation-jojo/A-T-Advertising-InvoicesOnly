import React from "react";
import { Calendar, Printer, Edit3 } from "lucide-react";
import { formatNumber } from "@/lib/printCalculator";
import { CustomInvoice } from "@/lib/billing/types";
import { InvoiceRecord } from "@/lib/invoicesStore";
import { ProformaInvoice } from "@/lib/proforma/types";
import { settlementFor, useSettlementVersion } from "@/lib/financeStore";
import { getCurrencyShortLabel } from "@/lib/currency/currencyFormat";
import { UnifiedInvoiceRecord } from "./types";

interface InvoiceRecordCardProps {
  item: UnifiedInvoiceRecord;
  onPreviewCustom: (inv: CustomInvoice) => void;
  onPreviewCalc: (inv: InvoiceRecord) => void;
  onPreviewProforma: (inv: ProformaInvoice) => void;
  onEditCustom: (inv: CustomInvoice) => void;
  onEditProforma: (inv: ProformaInvoice) => void;
}

/**
 * بطاقة عرض الفاتورة الفردية في سجل وأرشيف الفواتير الموحد
 * تدعم الفواتير المخصصة، إيصالات الحاسبة، والفواتير المبدئية Proforma A4
 */
export const InvoiceRecordCard: React.FC<InvoiceRecordCardProps> = ({
  item,
  onPreviewCustom,
  onPreviewCalc,
  onPreviewProforma,
  onEditCustom,
  onEditProforma,
}) => {
  useSettlementVersion();
  const isCustom = item.kind === "custom";
  const isProforma = item.kind === "proforma";
  const isEditable = isCustom || isProforma;
  const hasSettlement = isCustom && (item.type === "sales" || item.type === "purchase");
  const settlement = hasSettlement ? settlementFor(item.id, Number(item.total) || 0) : null;
  const isPaid = Boolean(settlement && settlement.outstanding <= 0.009);
  const isPartial = Boolean(settlement && settlement.paid > 0.009 && settlement.outstanding > 0.009);

  const handlePreview = () => {
    if (item.kind === "proforma") {
      onPreviewProforma(item.raw as ProformaInvoice);
    } else if (item.kind === "custom") {
      onPreviewCustom(item.raw as CustomInvoice);
    } else {
      onPreviewCalc(item.raw as InvoiceRecord);
    }
  };

  const handleEdit = () => {
    if (item.kind === "proforma") {
      onEditProforma(item.raw as ProformaInvoice);
    } else if (item.kind === "custom") {
      onEditCustom(item.raw as CustomInvoice);
    }
  };

  const cleanTotal = Math.abs(Number(item.total) || 0) < 0.005 ? 0 : Number(item.total) || 0;
  const accentBorder =
    isCustom && item.type === "sales"
      ? "border-r-emerald-600"
      : isCustom && item.type === "purchase"
      ? "border-r-purple-600"
      : isProforma || (isCustom && item.type === "proforma")
      ? "border-r-[#C5A059]"
      : "border-r-primary";

  return (
    <div
      className={`rounded-2xl border border-border/75 border-r-[3.5px] ${accentBorder} bg-card hover:border-primary/40 p-3 space-y-2 shadow-2xs transition-all w-full min-w-0`}
    >
      {/* رأس البطاقة: رقم الفاتورة ونوع السجل وحالة السداد والتاريخ */}
      <div className="flex flex-wrap items-center justify-between gap-1.5 border-b border-border/50 pb-1.5 min-w-0">
        <div className="flex flex-wrap items-center gap-1.5 min-w-0">
          <bdi dir="ltr" className="font-mono font-black text-primary text-xs tabular-nums">
            {/^(INV|PINV|RCV|PAY)-/.test(item.serial) ? item.serial : `#${item.serial}`}
          </bdi>
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9.5px] font-black border ${item.badgeColor}`}
          >
            {item.typeLabel}
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

        <div className="flex items-center gap-1 text-[10px] text-muted-foreground font-mono shrink-0">
          <Calendar className="h-3 w-3 text-muted-foreground/70 shrink-0" />
          <bdi dir="ltr" className="tabular-nums">
            {item.date}
          </bdi>
        </div>
      </div>

      {/* بيانات العميل وإجمالي القيمة (بدون قص أو إخفاء للاسم أو القيمة) */}
      <div className="flex flex-wrap items-start justify-between gap-2 text-xs pt-0.5 min-w-0">
        <div className="min-w-0 flex-1">
          <p className="font-black text-foreground text-xs leading-snug break-words">
            {item.customerName}
          </p>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            عدد البنود:{" "}
            <bdi dir="ltr" className="font-mono font-bold">
              {item.itemsCount}
            </bdi>{" "}
            بند
          </p>
        </div>

        <div className="text-left font-mono shrink-0 space-y-0.5">
          <p className="font-black text-primary text-sm leading-tight tabular-nums">
            <bdi dir="ltr">{formatNumber(cleanTotal)}</bdi>{" "}
            <bdi dir="ltr" className="text-[9.5px] font-extrabold text-muted-foreground uppercase">
              {item.currency || "SDG"}
            </bdi>
          </p>
          {settlement && settlement.outstanding > 0.009 && (
            <p
              className={`font-sans text-[10px] font-bold leading-tight ${
                item.type === "purchase"
                  ? "text-rose-600 dark:text-rose-400"
                  : "text-amber-600 dark:text-amber-400"
              }`}
            >
              <span>متبقي </span>
              <bdi dir="ltr" className="font-mono font-black tabular-nums">
                {formatNumber(settlement.outstanding)}
              </bdi>{" "}
              <span>{getCurrencyShortLabel(item.currency)}</span>
            </p>
          )}
        </div>
      </div>

      {/* أزرار العمليات (معاينة وطباعة + تعديل) */}
      <div className="pt-2 border-t border-border/50 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={handlePreview}
          className="inline-flex flex-1 min-w-[130px] items-center justify-center gap-1.5 rounded-xl border border-border/80 bg-secondary/80 hover:bg-primary hover:text-white hover:border-primary/50 py-2 px-3 text-xs font-black text-foreground transition-all duration-150 active:scale-[0.97] shadow-2xs touch-manipulation min-h-[40px] cursor-pointer"
        >
          <Printer className="h-4 w-4 shrink-0" />
          <span>معاينة وطباعة</span>
        </button>

        {isEditable && (
          <button
            type="button"
            onClick={handleEdit}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-[#C5A059]/40 bg-[#C5A059]/10 hover:bg-[#C5A059] hover:text-white text-[#C5A059] dark:text-[#E0BC75] px-3.5 py-2 text-xs font-black transition-all duration-150 active:scale-[0.97] shadow-2xs touch-manipulation min-h-[40px] cursor-pointer"
            title="تعديل بيانات وبنود الفاتورة"
          >
            <Edit3 className="h-3.5 w-3.5 shrink-0" />
            <span>تعديل</span>
          </button>
        )}
      </div>
    </div>
  );
};
