import React from "react";
import { formatNumber } from "@/lib/printCalculator";
import { getCurrencyShortLabel } from "@/lib/currency/currencyFormat";
import type { AppCurrency } from "@/lib/currency/types";
import { InvoicesStats } from "./types";

interface InvoicesStatsHeaderProps {
  stats: InvoicesStats;
}

const CURRENCY_ORDER: AppCurrency[] = ["SDG", "USD", "SAR", "EGP"];

function normalizeZero(value: number | undefined | null): number {
  const n = Number(value) || 0;
  return Math.abs(n) < 0.005 ? 0 : n;
}

/**
 * شريط الإحصائيات السريعة لأرشيف الفواتير
 * يعرض إجمالي المبالغ حسب العملة، عدد فواتير المطالبات، وإجمالي السجلات
 */
export const InvoicesStatsHeader: React.FC<InvoicesStatsHeaderProps> = ({ stats }) => {
  const currencyEntries = CURRENCY_ORDER.map(
    (cur) => [cur, normalizeZero(stats.totalsByCurrency?.[cur])] as const
  ).filter(([, amt]) => Math.abs(amt) > 0.001);

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-center w-full min-w-0">
      <div className="col-span-2 sm:col-span-1 rounded-xl border border-border bg-card p-2.5 shadow-2xs min-w-0">
        <span className="text-[10px] font-bold text-muted-foreground">إجمالي القيمة المفوترة</span>
        {currencyEntries.length === 0 ? (
          <p className="font-mono text-sm font-black text-primary mt-0.5 tabular-nums break-words">
            <bdi dir="ltr">0</bdi>{" "}
            <span className="font-sans text-[10.5px] font-bold">{getCurrencyShortLabel("SDG")}</span>
          </p>
        ) : currencyEntries.length === 1 ? (
          <p className="font-mono text-sm font-black text-primary mt-0.5 tabular-nums break-words">
            <bdi dir="ltr">{formatNumber(currencyEntries[0][1])}</bdi>{" "}
            <span className="font-sans text-[10.5px] font-bold">
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
                <bdi dir="ltr">{formatNumber(amt)}</bdi>
                <span className="font-sans text-[9px] font-bold">
                  {getCurrencyShortLabel(cur)}
                </span>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-border bg-card p-2.5 shadow-2xs min-w-0">
        <span className="text-[10px] font-bold text-muted-foreground">فواتير المطالبات</span>
        <p className="font-mono text-sm font-black text-foreground mt-0.5 tabular-nums">
          <bdi dir="ltr">{stats.customCount}</bdi>{" "}
          <span className="font-sans text-[10px] font-normal">فاتورة</span>
        </p>
      </div>

      <div className="rounded-xl border border-border bg-card p-2.5 shadow-2xs min-w-0">
        <span className="text-[10px] font-bold text-muted-foreground">إجمالي السجلات</span>
        <p className="font-mono text-sm font-black text-foreground mt-0.5 tabular-nums">
          <bdi dir="ltr">{stats.totalCount}</bdi>{" "}
          <span className="font-sans text-[10px] font-normal">فاتورة</span>
        </p>
      </div>
    </div>
  );
};
