import React from "react";
import { FileText, TrendingUp, ShoppingBag } from "lucide-react";
import type { CustomInvoiceType, CustomInvoice } from "@/lib/billing/types";
import { formatAccountingNumber } from "./StandardInvoiceDocument";
import { useProformaInvoices } from "@/lib/proforma/store";
import { getCurrencyShortLabel } from "@/lib/currency/currencyFormat";
import { type AppCurrency, sanitizeCurrency } from "@/lib/currency/types";

interface Props {
  invoices: CustomInvoice[];
  onCreateClick: (type: CustomInvoiceType) => void;
}

const CURRENCY_ORDER: AppCurrency[] = ["SDG", "USD", "SAR", "EGP"];

interface BillingModuleCard {
  type: CustomInvoiceType;
  title: string;
  description: string;
  count: number;
  totalsByCurrency: Partial<Record<AppCurrency, number>>;
  icon: typeof TrendingUp;
  gradient: string;
  borderGlow: string;
  badgeClass: string;
}

function groupTotalsByCurrency(
  items: Array<{ totalAmount?: number; currency?: string; meta?: { currency?: string } }>
): Partial<Record<AppCurrency, number>> {
  const totals: Partial<Record<AppCurrency, number>> = {};
  for (const item of items) {
    const amount = Number(item?.totalAmount) || 0;
    const cur = sanitizeCurrency(item?.currency || item?.meta?.currency, "SDG");
    totals[cur] = Math.round(((totals[cur] || 0) + amount) * 100) / 100;
  }
  return totals;
}

/**
 * درج بطاقات الفواتير التنفيذية — أيقونات كبيرة بتدرج لوني ووصف إرشادي أسفلها
 * مطابق 100% لتصميم الصفحة الرئيسية وأقسام الوكالة لتسهيل تجربة الاستخدام (UI/UX)
 */
export function BillingCards({ invoices, onCreateClick }: Props) {
  const officialProformas = useProformaInvoices();
  const safeInvoices = Array.isArray(invoices) ? invoices : [];
  const proformaInvoices = safeInvoices.filter((i) => i?.meta?.type === "proforma");
  const salesInvoices = safeInvoices.filter((i) => i?.meta?.type === "sales");
  const purchaseInvoices = safeInvoices.filter((i) => i?.meta?.type === "purchase");

  const totalsProforma = groupTotalsByCurrency([
    ...proformaInvoices,
    ...(officialProformas || []),
  ]);
  const totalsSales = groupTotalsByCurrency(salesInvoices);
  const totalsPurchase = groupTotalsByCurrency(purchaseInvoices);

  const CARDS: BillingModuleCard[] = [
    {
      type: "sales",
      title: "فاتورة مبيعات",
      description: "إصدار فوري A4 للعملاء التجاريين",
      count: salesInvoices.length,
      totalsByCurrency: totalsSales,
      icon: TrendingUp,
      gradient: "from-[#168063] to-[#22A07E]",
      borderGlow: "hover:border-primary/50 hover:shadow-primary/10",
      badgeClass: "bg-primary/10 text-primary border-primary/20",
    },
    {
      type: "proforma",
      title: "عرض سعر / مبدئية",
      description: "تسعير ومبدئية وتحويل لمبيعات",
      count: proformaInvoices.length + (officialProformas || []).length,
      totalsByCurrency: totalsProforma,
      icon: FileText,
      gradient: "from-[#C5A059] to-[#E3C588]",
      borderGlow: "hover:border-[#C5A059]/50 hover:shadow-[#C5A059]/10",
      badgeClass: "bg-[#C5A059]/10 text-[#C5A059] border-[#C5A059]/20",
    },
    {
      type: "purchase",
      title: "فاتورة مشتريات",
      description: "تسجيل فواتير ومصروفات الموردين",
      count: purchaseInvoices.length,
      totalsByCurrency: totalsPurchase,
      icon: ShoppingBag,
      gradient: "from-slate-700 to-slate-900",
      borderGlow: "hover:border-slate-500/50 hover:shadow-slate-500/10",
      badgeClass: "bg-slate-500/10 text-slate-400 border-slate-500/20",
    },
  ];

  return (
    <nav
      aria-label="أنواع الفواتير وإصدارها السريع"
      dir="rtl"
      className="grid grid-cols-3 gap-2 sm:gap-3.5"
    >
      {CARDS.map((card) => {
        const Icon = card.icon;
        const currencyEntries = CURRENCY_ORDER.map(
          (cur) => [cur, card.totalsByCurrency[cur] || 0] as const
        ).filter(([, amt]) => Math.abs(amt) > 0.001);

        return (
          <button
            key={card.type}
            type="button"
            onClick={() => onCreateClick(card.type)}
            className={`group relative flex flex-col items-center justify-between rounded-2xl border border-border/70 bg-card/95 dark:bg-card/90 p-2 sm:p-3.5 text-center shadow-2xs transition-all duration-150 hover:-translate-y-0.5 hover:shadow-xs active:scale-[0.96] touch-manipulation min-h-[132px] sm:min-h-[152px] cursor-pointer ${card.borderGlow}`}
          >
            {/* الأيقونة الكبيرة بتدرج لوني مريح وحلقة نقية متطابقة مع الصفحة الرئيسية */}
            <span
              className={`grid h-11 w-11 sm:h-14 sm:w-14 shrink-0 place-items-center rounded-2xl bg-gradient-to-br ${card.gradient} text-white shadow-sm shadow-black/10 ring-1 ring-white/20 dark:ring-white/10 transition-transform duration-200 group-hover:scale-105`}
            >
              <Icon className="h-5 w-5 sm:h-7 sm:w-7 stroke-[2.2]" />
            </span>

            {/* اسم نوع الفاتورة */}
            <span className="mt-1.5 text-[11px] sm:text-[13px] font-black text-foreground group-hover:text-primary transition-colors leading-tight line-clamp-1">
              {card.title}
            </span>

            {/* الوصف الإرشادي أسفل الأيقونة */}
            <span className="mt-0.5 text-[9px] sm:text-[10.5px] font-medium text-muted-foreground/80 leading-snug line-clamp-2 px-0.5">
              {card.description}
            </span>

            {/* شريط الإحصائيات والمبلغ الإجمالي المحدث مباشرة */}
            <div className="mt-1.5 pt-1 flex items-center justify-center gap-1 w-full flex-wrap">
              <span
                className={`inline-flex items-center gap-0.5 rounded-full px-1.5 sm:px-2 py-0.5 text-[8.5px] sm:text-[10px] font-mono font-black border tabular-nums ${card.badgeClass}`}
              >
                <span>{card.count}</span>
                <span className="font-sans text-[8px] sm:text-[9px]">فاتورة</span>
              </span>
              <div className="hidden sm:flex items-center justify-center gap-1 flex-wrap">
                {currencyEntries.length === 0 ? (
                  <span className="inline-flex items-center rounded-md bg-muted/60 px-1.5 py-0.5 text-[10px] font-mono font-bold text-foreground tabular-nums">
                    0
                    <span className="mr-0.5 font-sans text-[8.5px] text-muted-foreground">
                      {getCurrencyShortLabel("SDG")}
                    </span>
                  </span>
                ) : (
                  currencyEntries.map(([cur, amt]) => (
                    <span
                      key={cur}
                      className="inline-flex items-center rounded-md bg-muted/60 px-1.5 py-0.5 text-[10px] font-mono font-bold text-foreground tabular-nums"
                    >
                      {formatAccountingNumber(amt)}
                      <span className="mr-0.5 font-sans text-[8.5px] text-muted-foreground">
                        {getCurrencyShortLabel(cur)}
                      </span>
                    </span>
                  ))
                )}
              </div>
            </div>
          </button>
        );
      })}
    </nav>
  );
}

export default BillingCards;
