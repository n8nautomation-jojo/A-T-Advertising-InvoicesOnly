import React from "react";
import type { LucideIcon } from "lucide-react";
import {
  TrendingUp,
  Receipt,
  Wallet,
  Truck,
  ArrowLeftRight,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatNumber } from "@/lib/printCalculator";
import { getCurrencyShortLabel } from "@/lib/currency/currencyFormat";
import { DEFAULT_CURRENCY, type AppCurrency } from "@/lib/currency/types";

export type ReportTab =
  | "performance"
  | "sales"
  | "collections"
  | "purchases"
  | "cash"
  | "statements";

interface ReportCardItem {
  id: ReportTab;
  title: string;
  description: string;
  badge: string;
  icon: LucideIcon;
  gradient: string;
}

interface Props {
  activeTab: ReportTab;
  onSelectTab: (tab: ReportTab) => void;
  currency?: AppCurrency;
  metrics: {
    netProfit: number;
    salesTotal: number;
    collectedTotal: number;
    purchasesTotal: number;
    cashNet: number;
  };
}

export function ReportsIconCards({
  activeTab,
  onSelectTab,
  currency = DEFAULT_CURRENCY,
  metrics,
}: Props) {
  const curLabel = getCurrencyShortLabel(currency);
  const cards: ReportCardItem[] = [
    {
      id: "performance",
      title: "الأداء المالي",
      description: "الهوامش وصافي الربح",
      badge: `${formatNumber(metrics.netProfit)} ${curLabel}`,
      icon: TrendingUp,
      gradient: "from-[#168063] to-[#22A07E]",
    },
    {
      id: "sales",
      title: "المبيعات",
      description: "حجم الفواتير والمبيعات",
      badge: `${formatNumber(metrics.salesTotal)} ${curLabel}`,
      icon: Receipt,
      gradient: "from-blue-600 to-indigo-600",
    },
    {
      id: "collections",
      title: "التحصيلات والذمم",
      description: "المحصل والديون القائمة",
      badge: `${formatNumber(metrics.collectedTotal)} ${curLabel}`,
      icon: Wallet,
      gradient: "from-amber-500 to-orange-600",
    },
    {
      id: "purchases",
      title: "المشتريات والتكاليف",
      description: "فواتير الموردين والإنتاج",
      badge: `${formatNumber(metrics.purchasesTotal)} ${curLabel}`,
      icon: Truck,
      gradient: "from-rose-500 to-red-600",
    },
    {
      id: "cash",
      title: "الحركة النقدية",
      description: "التدفق النقدي والسيولة",
      badge: `${formatNumber(metrics.cashNet)} ${curLabel}`,
      icon: ArrowLeftRight,
      gradient: "from-cyan-600 to-sky-700",
    },
    {
      id: "statements",
      title: "كشوف الحسابات",
      description: "كشف العميل والمورد",
      badge: "كشف فوري",
      icon: Users,
      gradient: "from-[#0D4A39] to-[#071914]",
    },
  ];

  return (
    <section aria-label="أقسام التقارير" dir="rtl" className="space-y-2 shrink-0">
      <div className="flex items-center justify-between px-1">
        <span className="text-[11px] font-black tracking-tight text-muted-foreground">
          اختر التقرير المطلوب:
        </span>
        <span className="text-[10px] font-bold text-primary">
          {cards.find((c) => c.id === activeTab)?.title}
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 sm:gap-3">
        {cards.map((card) => {
          const Icon = card.icon;
          const isActive = activeTab === card.id;

          return (
            <button
              key={card.id}
              type="button"
              onClick={() => onSelectTab(card.id)}
              className={cn(
                "group relative flex flex-col items-center justify-between rounded-2xl p-3 sm:p-3.5 text-center transition-all duration-200 active:scale-[0.96] touch-manipulation min-h-[135px] sm:min-h-[145px]",
                isActive
                  ? "border-2 border-primary bg-primary/8 shadow-sm shadow-primary/15 ring-2 ring-primary/20"
                  : "border border-border/70 bg-card/95 hover:border-primary/45 hover:bg-muted/25 shadow-2xs"
              )}
            >
              {/* مؤشر نشط بالزاوية */}
              {isActive && (
                <span className="absolute top-2 left-2 flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
                </span>
              )}

              {/* الأيقونة الكبيرة بتدرج لوني فخم وحلقة مضيئة */}
              <span
                className={cn(
                  "grid h-12 w-12 sm:h-14 sm:w-14 shrink-0 place-items-center rounded-2xl bg-gradient-to-br shadow-sm shadow-black/10 ring-1 ring-white/20 dark:ring-white/10 transition-transform duration-200 group-hover:scale-105",
                  card.gradient,
                  "text-white"
                )}
              >
                <Icon className="h-6 w-6 sm:h-7 sm:w-7 stroke-[2.2]" />
              </span>

              {/* نصوص العنوان والوصف */}
              <div className="mt-2 w-full space-y-0.5">
                <p
                  className={cn(
                    "text-xs sm:text-[13px] font-black leading-tight transition-colors line-clamp-1",
                    isActive ? "text-primary" : "text-foreground group-hover:text-primary"
                  )}
                >
                  {card.title}
                </p>
                <p className="text-[10px] text-muted-foreground line-clamp-1 font-medium">
                  {card.description}
                </p>
              </div>

              {/* بادج الرقم الإحصائي المباشر */}
              <div className="mt-2 w-full">
                <span
                  className={cn(
                    "block w-full truncate rounded-lg py-1 px-1.5 text-[10px] font-bold tabular-nums border transition-colors",
                    isActive
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-muted/60 text-foreground border-border/50"
                  )}
                >
                  {card.badge}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
