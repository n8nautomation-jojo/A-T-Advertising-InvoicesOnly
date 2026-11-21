import React from "react";
import { formatNumber } from "@/lib/printCalculator";
import { getCurrencyShortLabel } from "@/lib/currency/currencyFormat";
import type { AppCurrency } from "@/lib/currency/types";
import { InvoicesStats } from "./types";

interface InvoicesStatsHeaderProps {
  stats: InvoicesStats;
}

const CURRENCY_ORDER: AppCurrency[] = ["SDG", "USD", "SAR", "EGP"];

/**
 * شريط الإحصائيات السريعة لأرشيف الفواتير
 * يعرض إجمالي المبالغ حسب العملة، عدد فواتير المطالبات، وإجمالي السجلات
 */
export const InvoicesStatsHeader: React.FC<InvoicesStatsHeaderProps> = ({ stats }) => {
  const currencyEntries = CURRENCY_ORDER.map(
    (cur) => [cur, stats.totalsByCurrency?.[cur] ?? 0] as const
  ).filter(([, amt]) => Math.abs(amt) > 0.001);

  return (
    <div className="grid grid-cols-3 gap-2 text-center">
      <div className="rounded-xl border border-border bg-card p-2.5 shadow-2xs">
        <span className="text-[10px] font-bold text-muted-foreground">إجمالي القيمة المفوترة</span>
        {currencyEntries.length === 0 ? (
          <p className="font-mono text-sm font-black text-primary mt-0.5 truncate">
            0 <span className="text-[10px] font-normal">{getCurrencyShortLabel("SDG")}</span>
          </p>
        ) : currencyEntries.length === 1 ? (
          <p className="font-mono text-sm font-black text-primary mt-0.5 truncate">
            {formatNumber(currencyEntries[0][1])}{" "}
            <span className="text-[10px] font-normal">
              {getCurrencyShortLabel(currencyEntries[0][0])}
            </span>
          </p>
        ) : (
          <div className="mt-1 flex flex-wrap items-center justify-center gap-1">
            {currencyEntries.map(([cur, amt]) => (
              <span
                key={cur}
                className="inline-flex items-baseline gap-0.5 rounded-md bg-primary/10 px-1.5 py-0.5 font-mono text-[11px] font-black text-primary tabular-nums"
              >
                {formatNumber(amt)}
                <span className="font-sans text-[9px] font-bold">
                  {getCurrencyShortLabel(cur)}
                </span>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-border bg-card p-2.5 shadow-2xs">
        <span className="text-[10px] font-bold text-muted-foreground">فواتير المطالبات</span>
        <p className="font-mono text-sm font-black text-foreground mt-0.5">
          {stats.customCount} <span className="text-[10px] font-normal">فاتورة</span>
        </p>
      </div>

      <div className="rounded-xl border border-border bg-card p-2.5 shadow-2xs">
        <span className="text-[10px] font-bold text-muted-foreground">إجمالي السجلات</span>
        <p className="font-mono text-sm font-black text-foreground mt-0.5">
          {stats.totalCount} <span className="text-[10px] font-normal">فاتورة</span>
        </p>
      </div>
    </div>
  );
};
