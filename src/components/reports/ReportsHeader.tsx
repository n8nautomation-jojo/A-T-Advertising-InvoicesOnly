import React from "react";
import { ArrowRight, RefreshCw, Calendar, BarChart3 } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { CurrencySelector } from "@/components/currency/CurrencySelector";
import { DEFAULT_CURRENCY, type AppCurrency } from "@/lib/currency/types";

interface Props {
  from: string;
  to: string;
  currency?: AppCurrency;
  onCurrencyChange?: (c: AppCurrency) => void;
  onFromChange: (val: string) => void;
  onToChange: (val: string) => void;
  onQuickPreset: (preset: "today" | "month" | "year" | "all") => void;
  onRefresh: () => void;
  loading: boolean;
}

export function ReportsHeader({
  from,
  to,
  currency = DEFAULT_CURRENCY,
  onCurrencyChange,
  onFromChange,
  onToChange,
  onQuickPreset,
  onRefresh,
  loading,
}: Props) {
  return (
    <header className="space-y-3 shrink-0" dir="rtl">
      {/* الشريط العلوي التنفيذي */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2.5">
          <Link
            to="/"
            aria-label="الرجوع للرئيسية"
            className="grid h-10 w-10 place-items-center rounded-xl border border-border/80 bg-card text-foreground shadow-2xs transition-all hover:border-primary/50 hover:text-primary active:scale-95 touch-manipulation"
          >
            <ArrowRight className="h-5 w-5" />
          </Link>
          <div>
            <h1 className="text-base sm:text-lg font-black tracking-tight text-foreground flex items-center gap-1.5">
              <span>التقارير المالية والتشغيلية</span>
              <BarChart3 className="h-4 w-4 text-[#C5A059]" />
            </h1>
            <p className="text-[11px] font-medium text-muted-foreground">
              مؤشرات حية، تحليل الربحية، والتدفقات النقدية
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {onCurrencyChange && (
            <CurrencySelector
              label="العملة:"
              dropdownTitle="اختر عملة التقارير"
              value={currency}
              onChange={onCurrencyChange}
            />
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onRefresh}
            disabled={loading}
            aria-label="تحديث البيانات"
            className="h-8 w-8 rounded-xl p-0 border-border/80 bg-card text-foreground shadow-2xs hover:border-primary/40 hover:text-primary active:scale-95 touch-manipulation"
          >
            <RefreshCw className={cn("h-4 w-4 text-foreground", loading && "animate-spin text-primary")} />
          </Button>
        </div>
      </div>

      {/* شريط الفلاتر السريعة واختيار التاريخ */}
      <div className="rounded-2xl border border-border/70 bg-card/95 p-3 shadow-2xs space-y-2.5">
        <div className="flex items-center justify-between gap-1.5 flex-wrap">
          <div className="flex items-center gap-1 text-[11px] font-bold text-muted-foreground">
            <Calendar className="h-3.5 w-3.5 text-primary" />
            <span>نطاق التقرير:</span>
          </div>

          {/* أزرار الفلترة السريعة الفورية */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => onQuickPreset("today")}
              className="rounded-lg px-2.5 py-1 text-[10.5px] font-bold transition-all bg-secondary/80 hover:bg-primary/10 hover:text-primary active:scale-95 touch-manipulation text-foreground"
            >
              اليوم
            </button>
            <button
              type="button"
              onClick={() => onQuickPreset("month")}
              className="rounded-lg px-2.5 py-1 text-[10.5px] font-bold transition-all bg-secondary/80 hover:bg-primary/10 hover:text-primary active:scale-95 touch-manipulation text-foreground"
            >
              هذا الشهر
            </button>
            <button
              type="button"
              onClick={() => onQuickPreset("year")}
              className="rounded-lg px-2.5 py-1 text-[10.5px] font-bold transition-all bg-secondary/80 hover:bg-primary/10 hover:text-primary active:scale-95 touch-manipulation text-foreground"
            >
              هذا العام
            </button>
            <button
              type="button"
              onClick={() => onQuickPreset("all")}
              className={cn(
                "rounded-lg px-2.5 py-1 text-[10.5px] font-bold transition-all active:scale-95 touch-manipulation",
                !from && !to
                  ? "bg-primary text-primary-foreground shadow-2xs"
                  : "bg-secondary/80 text-foreground hover:bg-primary/10 hover:text-primary"
              )}
            >
              الكل
            </button>
          </div>
        </div>

        {/* مدخلات التاريخ الدقيقة */}
        <div className="grid grid-cols-2 gap-2 pt-0.5 border-t border-border/40">
          <div className="space-y-0.5">
            <label className="text-[10px] font-bold text-muted-foreground">من تاريخ</label>
            <Input
              type="date"
              value={from}
              onChange={(e) => onFromChange(e.target.value)}
              className="h-8 rounded-lg text-[11px] font-mono bg-background text-right"
            />
          </div>
          <div className="space-y-0.5">
            <label className="text-[10px] font-bold text-muted-foreground">إلى تاريخ</label>
            <Input
              type="date"
              value={to}
              onChange={(e) => onToChange(e.target.value)}
              className="h-8 rounded-lg text-[11px] font-mono bg-background text-right"
            />
          </div>
        </div>
      </div>
    </header>
  );
}
