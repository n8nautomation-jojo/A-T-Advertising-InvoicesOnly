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
import type { StatementLine, CustomerStatement } from "@/lib/repositories/ReportsRepository";
import { formatNumber } from "@/lib/printCalculator";
import { playTapSound } from "@/lib/soundEffects";
import { getLocalIsoDate } from "@/lib/dateUtils";
import { getCurrencyShortLabel } from "@/lib/currency/currencyFormat";
import { SUPPORTED_CURRENCIES, sanitizeCurrency } from "@/lib/currency/types";

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
  allStatements?: CustomerStatement[];
  onSelectCurrency?: (currency: string) => void;
  statementViewAllCurrencies?: boolean;
  onToggleViewAllCurrencies?: (all: boolean) => void;
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
  allStatements = [],
  onSelectCurrency,
  statementViewAllCurrencies = false,
  onToggleViewAllCurrencies,
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

  const hasMultiCurrencies = allStatements.length > 1;
  const showAllSeparated = hasMultiCurrencies && statementViewAllCurrencies;

  const filterLinesForStatement = (lines: StatementLine[]) => {
    let list = lines || [];
    if (statementTypeFilter !== "all") {
      list = list.filter((l) => l.kind === statementTypeFilter);
    }
    const q = (statementSearch || "").trim().toLowerCase();
    if (q) {
      list = list.filter(
        (l) =>
          (l.label || "").toLowerCase().includes(q) ||
          (l.reference || "").toLowerCase().includes(q) ||
          (l.date || "").includes(q) ||
          (l.notes || "").toLowerCase().includes(q) ||
          String(l.debit || "").includes(q) ||
          String(l.credit || "").includes(q)
      );
    }
    return list;
  };

  return (
    <div className="space-y-3">
      {hasMultiCurrencies && (
        <div className="rounded-2xl border border-border/70 bg-card p-3 sm:p-3.5 shadow-2xs space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 pb-2">
            <span className="text-xs font-black text-foreground">
              ملخص إجمالي المستحقات في كشف الحساب حسب كل عملة (مفصولة)
            </span>
            {onToggleViewAllCurrencies && (
              <div className="flex items-center gap-1 bg-secondary/60 p-0.5 rounded-xl border border-border/60 text-[11px]">
                <button
                  type="button"
                  onClick={() => {
                    playTapSound();
                    onToggleViewAllCurrencies(true);
                  }}
                  className={`px-2.5 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                    showAllSeparated
                      ? "bg-primary text-white shadow-2xs"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  عرض كل العملات مفصولة ({allStatements.length})
                </button>
                <button
                  type="button"
                  onClick={() => {
                    playTapSound();
                    onToggleViewAllCurrencies(false);
                  }}
                  className={`px-2.5 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                    !showAllSeparated
                      ? "bg-primary text-white shadow-2xs"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  عملة واحدة ({selectedCurrency})
                </button>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {allStatements.map((stmt) => {
              const code = sanitizeCurrency(stmt.currency, "SDG");
              const conf = SUPPORTED_CURRENCIES[code];
              const curLabel = getCurrencyShortLabel(code);
              const net = stmt.netBalance ?? stmt.outstanding ?? 0;
              const isSelected = !showAllSeparated && selectedCurrency === code;
              return (
                <button
                  key={code}
                  type="button"
                  onClick={() => {
                    playTapSound();
                    onSelectCurrency?.(code);
                    onToggleViewAllCurrencies?.(false);
                  }}
                  className={`text-right rounded-xl border p-2.5 space-y-1.5 transition-all cursor-pointer ${
                    isSelected
                      ? "border-primary bg-primary/[0.04] ring-1 ring-primary/30"
                      : "border-border/60 bg-secondary/25 hover:border-primary/40"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1 text-[11px] font-black text-foreground">
                      <span aria-hidden="true">{conf.flag}</span>
                      <span>{conf.nameAr}</span>
                    </span>
                    <span className="rounded-md bg-primary/10 border border-primary/20 px-1.5 py-0.5 text-[9.5px] font-mono font-black text-primary">
                      {code} ({curLabel})
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2 text-[10.5px] font-mono">
                    <span className="text-muted-foreground font-sans">
                      المطلوب بـ {conf.nameAr}:
                    </span>
                    <strong
                      className={
                        net > 0.009
                          ? "text-rose-600 dark:text-rose-400 font-black text-xs"
                          : "text-emerald-600 dark:text-emerald-400 font-black text-xs"
                      }
                    >
                      {net > 0.009
                        ? `${formatNumber(net)} ${curLabel}`
                        : net < -0.009
                        ? `رصيد دائن ${formatNumber(Math.abs(net))} ${curLabel}`
                        : `متزن (0 ${curLabel})`}
                    </strong>
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground font-mono border-t border-border/40 pt-1">
                    <span>
                      مدين: <strong className="text-foreground">{formatNumber(stmt.totalInvoiced || 0)}</strong>
                    </span>
                    <span>
                      دائن: <strong className="text-emerald-600">{formatNumber(stmt.totalCollected || 0)}</strong>
                    </span>
                    <span className="font-sans">{stmt.lines.length} حركة</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
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

      {showAllSeparated ? (
        <div className="space-y-3">
          {allStatements.map((stmt) => {
            const code = sanitizeCurrency(stmt.currency, "SDG");
            const conf = SUPPORTED_CURRENCIES[code];
            const curLabel = getCurrencyShortLabel(code);
            const filteredLines = filterLinesForStatement(stmt.lines);
            const netBal = stmt.netBalance ?? stmt.outstanding ?? 0;

            return (
              <div
                key={code}
                className="rounded-2xl border border-border/70 overflow-hidden bg-card shadow-2xs"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 bg-primary/[0.06] border-b border-border/60 px-3.5 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className="text-sm leading-none" aria-hidden="true">
                      {conf.flag}
                    </span>
                    <span className="text-xs font-black text-foreground">
                      كشف حركات {conf.nameAr} ({code})
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-[11px] font-mono">
                    <span className="text-muted-foreground font-sans">صافي المطلوب:</span>
                    <strong
                      className={
                        netBal > 0.009
                          ? "text-rose-600 dark:text-rose-400 font-black"
                          : "text-emerald-600 dark:text-emerald-400 font-black"
                      }
                    >
                      {formatNumber(Math.abs(netBal))} {curLabel}
                      {netBal > 0.009 ? " عليه" : netBal < -0.009 ? " له" : ""}
                    </strong>
                  </div>
                </div>

                <div className="overflow-x-auto max-h-[420px] overscroll-contain touch-pan-x">
                  <table className="w-full text-right text-xs">
                    <thead className="sticky top-0 bg-muted/95 backdrop-blur-xs text-muted-foreground text-[11px] border-b border-border/70 z-10 shadow-xs">
                      <tr>
                        <th className="py-2.5 px-3 font-black">التاريخ</th>
                        <th className="py-2.5 px-3 font-black">البيان والحركة</th>
                        <th className="py-2.5 px-3 font-black text-center">المرجع</th>
                        <th className="py-2.5 px-3 font-black text-left" dir="ltr">مدين (+) [{code}]</th>
                        <th className="py-2.5 px-3 font-black text-left" dir="ltr">دائن (-) [{code}]</th>
                        <th className="py-2.5 px-3 font-black text-left" dir="ltr">الرصيد [{code}]</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/40 font-mono text-[11px]">
                      {filteredLines.length > 0 ? (
                        filteredLines.map((line, idx) => (
                          <tr key={line.id || idx} className="hover:bg-muted/20 transition-colors">
                            <td className="py-2.5 px-3 text-muted-foreground font-sans">{line.date}</td>
                            <td className="py-2.5 px-3 font-sans font-bold text-foreground">
                              {line.label}
                              {line.notes && (
                                <span className="block text-[10px] text-muted-foreground font-normal">
                                  {line.notes}
                                </span>
                              )}
                            </td>
                            <td className="py-2.5 px-3 text-center text-primary font-bold" dir="ltr">
                              {line.reference || "—"}
                            </td>
                            <td className="py-2.5 px-3 text-left text-rose-600 font-bold tabular-nums text-xs" dir="ltr">
                              {line.debit > 0 ? formatNumber(line.debit) : "—"}
                            </td>
                            <td className="py-2.5 px-3 text-left text-emerald-600 font-bold tabular-nums text-xs" dir="ltr">
                              {line.credit > 0 ? formatNumber(line.credit) : "—"}
                            </td>
                            <td
                              className={`py-2.5 px-3 text-left font-black tabular-nums text-xs ${
                                line.runningBalance > 0
                                  ? "text-rose-600"
                                  : line.runningBalance < 0
                                  ? "text-emerald-600"
                                  : "text-foreground"
                              }`}
                              dir="ltr"
                            >
                              {formatNumber(line.runningBalance)} {curLabel}
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={6} className="py-10 text-center text-muted-foreground font-sans font-bold">
                            لا توجد حركات مطابقة لهذه العملة
                          </td>
                        </tr>
                      )}
                    </tbody>
                    <tfoot>
                      <tr className="bg-secondary/40 border-t border-border/70 font-mono text-[11px] font-black">
                        <td colSpan={3} className="py-2.5 px-3 font-sans text-foreground">
                          إجمالي حركات {conf.nameAr} ({code})
                        </td>
                        <td className="py-2.5 px-3 text-left text-rose-600 tabular-nums" dir="ltr">
                          {formatNumber(stmt.totalInvoiced || 0)}
                        </td>
                        <td className="py-2.5 px-3 text-left text-emerald-600 tabular-nums" dir="ltr">
                          {formatNumber(stmt.totalCollected || 0)}
                        </td>
                        <td className="py-2.5 px-3 text-left text-foreground tabular-nums" dir="ltr">
                          {formatNumber(netBal)} {curLabel}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
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
      )}

      {!showAllSeparated && totalStatementPages > 1 && (
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
