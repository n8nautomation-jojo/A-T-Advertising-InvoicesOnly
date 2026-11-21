import React from "react";
import {
  ChevronRight,
  ChevronLeft,
  ChevronsRight,
  ChevronsLeft,
  Calendar,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { StatementLine } from "@/lib/repositories/ReportsRepository";
import { formatNumber } from "@/lib/printCalculator";
import { playTapSound } from "@/lib/soundEffects";
import { getLocalIsoDate } from "@/lib/dateUtils";

export type StatementTypeFilter = "all" | "invoice" | "receipt" | "opening_balance";

interface CustomerDetailStatementTabProps {
  statementSearch: string;
  setStatementSearch: (v: string) => void;
  statementTypeFilter: StatementTypeFilter;
  setStatementTypeFilter: (f: StatementTypeFilter) => void;
  statementFrom?: string;
  statementTo?: string;
  onStatementRangeChange?: (from: string, to: string) => void;
  statementPageSize: number;
  setStatementPageSize: (n: number) => void;
  selectedCurrency: string;
  paginatedStatementLines: StatementLine[];
  processedStatementLinesCount: number;
  statementPage: number;
  setStatementPage: React.Dispatch<React.SetStateAction<number>>;
  totalStatementPages: number;
}

export function CustomerDetailStatementTab({
  statementSearch,
  setStatementSearch,
  statementTypeFilter,
  setStatementTypeFilter,
  statementFrom = "",
  statementTo = "",
  onStatementRangeChange,
  statementPageSize,
  setStatementPageSize,
  selectedCurrency,
  paginatedStatementLines,
  processedStatementLinesCount,
  statementPage,
  setStatementPage,
  totalStatementPages,
}: CustomerDetailStatementTabProps) {
  const applyPreset = (preset: "month" | "year" | "all") => {
    if (!onStatementRangeChange) return;
    playTapSound();
    if (preset === "all") {
      onStatementRangeChange("", "");
      return;
    }
    const today = getLocalIsoDate();
    if (preset === "month") {
      onStatementRangeChange(`${today.slice(0, 7)}-01`, today);
    } else {
      onStatementRangeChange(`${today.slice(0, 4)}-01-01`, today);
    }
  };

  return (
    <div className="space-y-3">
      {onStatementRangeChange && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 bg-card p-3 rounded-2xl border border-border/70 shadow-2xs">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="inline-flex items-center gap-1 text-[11px] font-black text-foreground">
              <Calendar className="h-3.5 w-3.5 text-primary" />
              <span>فترة الكشف:</span>
            </span>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-bold text-muted-foreground">من</span>
              <Input
                type="date"
                aria-label="فترة الكشف من تاريخ"
                value={statementFrom}
                onChange={(e) => onStatementRangeChange(e.target.value, statementTo)}
                className="h-8 w-[132px] rounded-lg text-[11px] font-mono bg-background"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-bold text-muted-foreground">إلى</span>
              <Input
                type="date"
                aria-label="فترة الكشف إلى تاريخ"
                value={statementTo}
                onChange={(e) => onStatementRangeChange(statementFrom, e.target.value)}
                className="h-8 w-[132px] rounded-lg text-[11px] font-mono bg-background"
              />
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => applyPreset("month")}
              className="rounded-lg px-2.5 py-1 text-[10.5px] font-bold bg-secondary/70 hover:bg-primary/10 hover:text-primary transition-colors cursor-pointer"
            >
              هذا الشهر
            </button>
            <button
              type="button"
              onClick={() => applyPreset("year")}
              className="rounded-lg px-2.5 py-1 text-[10.5px] font-bold bg-secondary/70 hover:bg-primary/10 hover:text-primary transition-colors cursor-pointer"
            >
              هذا العام
            </button>
            <button
              type="button"
              onClick={() => applyPreset("all")}
              className={`rounded-lg px-2.5 py-1 text-[10.5px] font-bold transition-colors cursor-pointer ${
                !statementFrom && !statementTo
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary/70 hover:bg-primary/10 hover:text-primary"
              }`}
            >
              الكل
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 bg-card p-3 rounded-2xl border border-border/70 shadow-2xs">
        <div className="relative flex-1">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input
            type="text"
            placeholder="بحث في الحركات: البيان، المرجع، المبلغ..."
            value={statementSearch}
            onChange={(e) => setStatementSearch(e.target.value)}
            className="h-9.5 pr-8 pl-8 text-xs bg-secondary/40 rounded-xl border-border/70 placeholder:text-muted-foreground/70"
          />
          {statementSearch && (
            <button
              type="button"
              onClick={() => setStatementSearch("")}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground text-xs p-1 cursor-pointer"
            >
              ✕
            </button>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0 justify-between sm:justify-end flex-wrap">
          <div className="flex items-center gap-1 bg-secondary/60 p-0.5 rounded-xl border border-border/60">
            {[
              { key: "all" as const, label: "الكل" },
              { key: "invoice" as const, label: "فواتير" },
              { key: "receipt" as const, label: "سندات" },
              { key: "opening_balance" as const, label: "افتتاحي" },
            ].map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => {
                  playTapSound();
                  setStatementTypeFilter(item.key);
                }}
                className={`px-3 py-1.5 text-xs rounded-lg font-bold transition-all cursor-pointer ${
                  statementTypeFilter === item.key
                    ? "bg-card text-foreground shadow-2xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1 bg-secondary/50 px-2 py-1.5 rounded-xl border border-border/60">
            <span className="text-[10px] text-muted-foreground font-bold">عرض:</span>
            <select
              aria-label="عدد أسطر كشف الحساب لكل صفحة"
              value={statementPageSize}
              onChange={(e) => setStatementPageSize(Number(e.target.value))}
              className="bg-transparent text-xs font-bold text-foreground border-none outline-hidden cursor-pointer"
            >
              <option value={20}>20</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-border/70 overflow-hidden bg-card shadow-2xs">
        <div className="overflow-x-auto max-h-[640px] overscroll-contain touch-pan-x">
          <table className="w-full text-right text-xs">
            <thead className="sticky top-0 bg-muted/95 backdrop-blur-xs text-muted-foreground text-[11px] border-b border-border/70 z-10 shadow-xs">
              <tr>
                <th className="py-3 px-3.5 font-black">التاريخ</th>
                <th className="py-3 px-3.5 font-black">البيان والحركة</th>
                <th className="py-3 px-3.5 font-black text-center">المرجع</th>
                <th className="py-3 px-3.5 font-black text-left" dir="ltr">مدين (+) [{selectedCurrency}]</th>
                <th className="py-3 px-3.5 font-black text-left" dir="ltr">دائن (-) [{selectedCurrency}]</th>
                <th className="py-3 px-3.5 font-black text-left" dir="ltr">الرصيد الجاري [{selectedCurrency}]</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40 font-mono text-[11px]">
              {paginatedStatementLines.length > 0 ? (
                paginatedStatementLines.map((line, idx) => (
                  <tr key={line.id || idx} className="hover:bg-muted/20 transition-colors">
                    <td className="py-3 px-3.5 text-muted-foreground font-sans">{line.date}</td>
                    <td className="py-3 px-3.5 font-sans font-bold text-foreground">
                      {line.label}
                      {line.notes && (
                        <span className="block text-[10px] text-muted-foreground font-normal">
                          {line.notes}
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-3.5 text-center text-primary font-bold" dir="ltr">
                      {line.reference || "—"}
                    </td>
                    <td className="py-3 px-3.5 text-left text-rose-600 font-bold tabular-nums text-xs" dir="ltr">
                      {line.debit > 0 ? formatNumber(line.debit) : "—"}
                    </td>
                    <td className="py-3 px-3.5 text-left text-emerald-600 font-bold tabular-nums text-xs" dir="ltr">
                      {line.credit > 0 ? formatNumber(line.credit) : "—"}
                    </td>
                    <td
                      className={`py-3 px-3.5 text-left font-black tabular-nums text-xs ${
                        line.runningBalance > 0
                          ? "text-rose-600"
                          : line.runningBalance < 0
                          ? "text-emerald-600"
                          : "text-foreground"
                      }`}
                      dir="ltr"
                    >
                      {formatNumber(line.runningBalance)}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="py-16 text-center text-muted-foreground font-sans font-bold">
                    لا توجد حركات مالية مسجلة في كشف الحساب
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {totalStatementPages > 1 && (
        <div className="flex items-center justify-between pt-2 border-t border-border/60 text-xs bg-card p-3 rounded-2xl border shadow-2xs">
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={statementPage <= 1}
              onClick={() => {
                playTapSound();
                setStatementPage(1);
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
              disabled={statementPage <= 1}
              onClick={() => {
                playTapSound();
                setStatementPage((p) => Math.max(1, p - 1));
              }}
              className="h-8.5 w-8.5 p-0 rounded-xl cursor-pointer"
              title="الصفحة السابقة"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>

            <div className="px-3.5 py-1.5 bg-secondary/60 rounded-xl font-mono font-bold text-foreground text-xs border border-border/50">
              صفحة {statementPage} من {totalStatementPages}
            </div>

            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={statementPage >= totalStatementPages}
              onClick={() => {
                playTapSound();
                setStatementPage((p) => Math.min(totalStatementPages, p + 1));
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
              disabled={statementPage >= totalStatementPages}
              onClick={() => {
                playTapSound();
                setStatementPage(totalStatementPages);
              }}
              className="h-8.5 w-8.5 p-0 rounded-xl cursor-pointer"
              title="الصفحة الأخيرة"
            >
              <ChevronsLeft className="h-4 w-4" />
            </Button>
          </div>

          <div className="text-muted-foreground text-xs">
            إجمالي الحركات: <span className="font-bold text-foreground">{processedStatementLinesCount}</span>
          </div>
        </div>
      )}
    </div>
  );
}
