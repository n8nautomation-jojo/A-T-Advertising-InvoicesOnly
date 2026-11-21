import React, { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Calendar, Layers, Plus, Receipt, RefreshCw, Wallet } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { PageShell } from "@/components/layout/PageShell";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import {
  EXPENSE_KIND_LABELS,
  getExpensesWithSettlement,
  type ExpenseKind,
  type ExpenseWithSettlement,
} from "@/lib/repositories/ExpenseRepository";
import { SETTLEMENT_STATUS_LABELS, SETTLEMENT_STATUS_TONES } from "@/lib/domain/finance";
import { formatNumber } from "@/lib/printCalculator";
import { getCurrencyShortLabel } from "@/lib/currency/currencyFormat";
import { ExpenseDialog } from "@/components/finance/ExpenseDialog";
import { CurrencySelector } from "@/components/currency/CurrencySelector";
import { DEFAULT_CURRENCY, SUPPORTED_CURRENCIES, type AppCurrency } from "@/lib/currency/types";

/**
 * المصروفات (PRD §7.4، §7.5): تكاليف تنفيذ وإنتاج مباشرة ومصروفات تشغيلية،
 * مع تمييز واضح بين «مسجّل» و«مسدَّد».
 */
export function ExpensesPage() {
  const [rows, setRows] = useState<ExpenseWithSettlement[]>([]);
  const [currency, setCurrency] = useState<AppCurrency>(DEFAULT_CURRENCY);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [settleTarget, setSettleTarget] = useState<ExpenseWithSettlement | null>(null);
  const didAutoSelectCurrencyRef = useRef(false);

  const currencyLabel = getCurrencyShortLabel(currency);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const currentRows = await getExpensesWithSettlement(undefined, currency);
      if (!didAutoSelectCurrencyRef.current) {
        if (currentRows.length > 0) {
          didAutoSelectCurrencyRef.current = true;
        } else if (currency === "SDG") {
          const otherCurrencies = (Object.keys(SUPPORTED_CURRENCIES) as AppCurrency[]).filter(
            (c) => c !== "SDG"
          );
          const otherResults = await Promise.all(
            otherCurrencies.map(async (cur) => ({
              cur,
              items: await getExpensesWithSettlement(undefined, cur),
            }))
          );
          const active = otherResults.find(({ items }) => items.length > 0);
          if (active) {
            didAutoSelectCurrencyRef.current = true;
            setRows(active.items);
            setCurrency(active.cur);
            return;
          }
        }
      }
      setRows(currentRows);
    } catch (err) {
      console.error("[ExpensesPage] load failed:", err);
    } finally {
      setLoading(false);
    }
  }, [currency]);

  useEffect(() => {
    void load();
    const onRefresh = () => {
      void load();
    };
    window.addEventListener("native-storage-ready", onRefresh);
    window.addEventListener("finance-changed", onRefresh);
    return () => {
      window.removeEventListener("native-storage-ready", onRefresh);
      window.removeEventListener("finance-changed", onRefresh);
    };
  }, [load]);

  const direct = rows.filter((row) => row.kind === "direct");
  const operating = rows.filter((row) => row.kind === "operating");
  const totalDirect = direct.reduce((sum, row) => sum + row.amount, 0);
  const totalOperating = operating.reduce((sum, row) => sum + row.amount, 0);
  const unpaidTotal = rows
    .filter((row) => row.settlement.outstanding > 0)
    .reduce((sum, row) => sum + row.settlement.outstanding, 0);

  return (
    <PageShell>
      <main
        className="w-full flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-3 py-3 md:px-6 md:py-5 min-w-0 scroll-smooth touch-pan-y pb-36 md:pb-16"
        dir="rtl"
      >
        <div className="mx-auto max-w-7xl space-y-3.5 w-full">
          {/* 1. ترويسة الصفحة التنفيذية */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-card/90 backdrop-blur-md p-3.5 sm:p-4 rounded-2xl border border-border/70 shadow-2xs border-r-4 border-r-primary">
            <div className="flex items-start gap-2.5">
              <Link
                to="/"
                aria-label="رجوع"
                className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-border bg-secondary text-foreground transition-all hover:border-primary/40 hover:text-primary active:scale-95 touch-manipulation"
              >
                <ArrowRight className="h-4 w-4" />
              </Link>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary/10 text-primary border border-primary/20 shrink-0">
                    <Wallet className="h-4 w-4" />
                  </span>
                  <h1 className="text-base sm:text-lg font-black text-foreground tracking-tight">
                    إدارة المصروفات والتكاليف
                  </h1>
                  <span className="text-[11px] font-mono font-black text-primary px-2.5 py-0.5 rounded-full bg-primary/10 border border-primary/20 tabular-nums shrink-0">
                    {rows.length} بند
                  </span>
                </div>
                <p className="text-[11px] sm:text-xs text-muted-foreground font-medium mt-1">
                  الفصل بين تكاليف التنفيذ والإنتاج المباشرة والمصروفات التشغيلية للشركة وحالة سدادها
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap shrink-0">
              <CurrencySelector
                label="العملة:"
                dropdownTitle="اختر عملة العرض"
                value={currency}
                onChange={(c) => {
                  didAutoSelectCurrencyRef.current = true;
                  setCurrency(c);
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void load()}
                disabled={loading}
                aria-label="تحديث"
                className="h-8 w-8 rounded-xl p-0 text-muted-foreground"
              >
                <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
              </Button>
              <Button
                type="button"
                onClick={() => setCreateOpen(true)}
                className="h-9 px-4 rounded-xl gap-1.5 text-xs font-black bg-primary hover:bg-primary/90 text-white shadow-xs shadow-primary/30 flex-1 sm:flex-initial"
              >
                <Plus className="h-4 w-4" />
                <span>تسجيل مصروف</span>
              </Button>
            </div>
          </div>

          {/* 2. مؤشرات المصروفات */}
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            <Metric label="تكاليف تنفيذ وإنتاج مباشرة" value={formatNumber(totalDirect)} currencyLabel={currencyLabel} tone="primary" />
            <Metric label="مصروفات تشغيلية" value={formatNumber(totalOperating)} currencyLabel={currencyLabel} tone="muted" />
            <Metric label="غير مسدَّد حتى الآن" value={formatNumber(unpaidTotal)} currencyLabel={currencyLabel} tone="warn" className="col-span-2 sm:col-span-1" />
          </div>

          {/* 3. التبويبات والقائمة */}
          <div className="rounded-2xl border border-border/70 bg-card/90 backdrop-blur-md p-3 sm:p-4 shadow-2xs">
            {rows.length === 0 ? (
              <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border/70 bg-muted/20 p-8 text-center">
                <Wallet className="h-8 w-8 text-muted-foreground" />
                <p className="text-sm font-black text-foreground">لا توجد مصروفات مسجّلة بهذه العملة بعد</p>
                <p className="text-xs leading-relaxed text-muted-foreground max-w-md">
                  التكلفة المباشرة تخص التنفيذ والإنتاج، والمصروف التشغيلي يخص تشغيل الشركة العام. تسجيل المصروف يثبت التكلفة ولا يعني دفعها إلا عند السداد.
                </p>
              </div>
            ) : (
              <Tabs defaultValue="direct" dir="rtl" className="space-y-3">
                <TabsList className="grid w-full grid-cols-2 gap-1.5 rounded-xl bg-muted/60 p-1 h-auto">
                  {[
                    { value: "direct", label: `تكاليف تنفيذ وإنتاج مباشرة (${direct.length})` },
                    { value: "operating", label: `مصروفات تشغيلية (${operating.length})` },
                  ].map((tab) => (
                    <TabsTrigger
                      key={tab.value}
                      value={tab.value}
                      className="rounded-lg py-2 text-xs font-black data-[state=active]:bg-card data-[state=active]:text-primary data-[state=active]:shadow-xs whitespace-nowrap"
                    >
                      {tab.label}
                    </TabsTrigger>
                  ))}
                </TabsList>

                {(["direct", "operating"] as ExpenseKind[]).map((kind) => {
                  const list = kind === "direct" ? direct : operating;
                  return (
                    <TabsContent key={kind} value={kind} className="m-0">
                      {list.length === 0 ? (
                        <div className="rounded-2xl border border-dashed border-border/70 bg-muted/20 p-6 text-center">
                          <p className="text-xs font-bold text-muted-foreground">
                            لا توجد {EXPENSE_KIND_LABELS[kind]} مسجّلة حتى الآن.
                          </p>
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                          {list.map((row) => {
                            const rowCurLabel = getCurrencyShortLabel(row.currency);
                            return (
                              <div
                                key={row.id}
                                className="rounded-2xl border border-border/70 bg-card p-3.5 shadow-2xs flex flex-col justify-between gap-2.5 transition-all hover:border-primary/40"
                              >
                                <div className="flex items-start justify-between gap-2.5">
                                  <div className="min-w-0 flex-1 space-y-1">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <p className="truncate text-sm font-black text-foreground">
                                        {row.beneficiary || row.category || EXPENSE_KIND_LABELS[row.kind]}
                                      </p>
                                      <span
                                        className={cn(
                                          "rounded-full border px-2 py-0.5 text-[10px] font-bold shrink-0",
                                          SETTLEMENT_STATUS_TONES[row.settlement.status]
                                        )}
                                      >
                                        {SETTLEMENT_STATUS_LABELS[row.settlement.status]}
                                      </span>
                                    </div>

                                    <div className="flex items-center gap-3 flex-wrap text-[11px] text-muted-foreground">
                                      <span className="inline-flex items-center gap-1">
                                        <Calendar className="h-3 w-3 text-primary/70" />
                                        <bdi dir="ltr" className="font-mono">{row.expenseDate}</bdi>
                                      </span>
                                      {row.category && row.beneficiary && (
                                        <span className="inline-flex items-center gap-1">
                                          <Layers className="h-3 w-3 text-muted-foreground" />
                                          <span>{row.category}</span>
                                        </span>
                                      )}
                                    </div>
                                  </div>

                                  <div className="shrink-0 text-left">
                                    <p className="font-mono text-sm font-black tabular-nums text-foreground">
                                      {formatNumber(row.amount)}
                                    </p>
                                    <p className="text-[10px] text-muted-foreground">{rowCurLabel}</p>
                                  </div>
                                </div>

                                {(row.settlement.outstanding > 0 || row.settlement.paid > 0) && (
                                  <div className="flex items-center justify-between gap-2 border-t border-border/50 pt-2">
                                    <div className="text-[10.5px] font-bold text-amber-600 dark:text-amber-400">
                                      {row.settlement.paid > 0
                                        ? `مسدَّد ${formatNumber(row.settlement.paid)} ${rowCurLabel} · متبقي ${formatNumber(row.settlement.outstanding)} ${rowCurLabel}`
                                        : "بانتظار السداد النقدي"}
                                    </div>
                                    {row.settlement.outstanding > 0 && (
                                      <Button
                                        type="button"
                                        size="sm"
                                        onClick={() => setSettleTarget(row)}
                                        className="h-8 rounded-xl gap-1.5 text-[11px] font-black bg-primary hover:bg-primary/90 text-white"
                                      >
                                        <Receipt className="h-3.5 w-3.5" />
                                        <span>سداد</span>
                                      </Button>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </TabsContent>
                  );
                })}
              </Tabs>
            )}
          </div>
        </div>
      </main>

      <ExpenseDialog open={createOpen} onOpenChange={setCreateOpen} defaultCurrency={currency} onSaved={() => void load()} />
      <ExpenseDialog
        open={Boolean(settleTarget)}
        onOpenChange={(open) => !open && setSettleTarget(null)}
        settleExpense={settleTarget}
        onSaved={() => void load()}
      />
    </PageShell>
  );
}

function Metric({
  label,
  value,
  currencyLabel = getCurrencyShortLabel("SDG"),
  tone,
  className,
}: {
  label: string;
  value: string;
  currencyLabel?: string;
  tone: "primary" | "warn" | "muted";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border p-3 sm:p-3.5 shadow-2xs space-y-1",
        tone === "primary" && "border-primary/30 bg-primary/[0.04]",
        tone === "warn" && "border-amber-500/30 bg-amber-500/[0.04]",
        tone === "muted" && "border-border/70 bg-card/90",
        className
      )}
    >
      <p className="text-[11px] font-bold text-muted-foreground">{label}</p>
      <p className="font-mono text-base sm:text-lg font-black tabular-nums text-foreground">
        {value} <span className="text-[10px] font-sans font-normal text-muted-foreground">{currencyLabel}</span>
      </p>
    </div>
  );
}

export default ExpensesPage;
