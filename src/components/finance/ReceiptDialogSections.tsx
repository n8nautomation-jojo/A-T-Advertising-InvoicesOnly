import React from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Plus,
  Receipt,
  SlidersHorizontal,
  UserPlus,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { CustomerRecord } from "@/lib/customersStore";
import type { CustomerAccount, OpenSalesInvoiceRow } from "@/lib/repositories/LedgerRepository";
import { formatNumber } from "@/lib/printCalculator";
import { getCurrencyShortLabel } from "@/lib/currency/currencyFormat";
import { sanitizePositiveDecimal } from "./shared/numericInput";
import type { AllocationFormRow } from "./shared/allocateFifo";

interface ReceiptCustomerSelectorProps {
  customers: CustomerRecord[];
  customerId: string;
  onSelectCustomer: (id: string) => void;
  unmatchedInvoiceCustomer: string | null;
  quickAddOpen: boolean;
  setQuickAddOpen: React.Dispatch<React.SetStateAction<boolean>>;
  quickCustomerName: string;
  setQuickCustomerName: (v: string) => void;
  quickCustomerPhone: string;
  setQuickCustomerPhone: (v: string) => void;
  creatingCustomer: boolean;
  onQuickAddCustomer: () => void;
  customerSummary: CustomerAccount | null;
  currencyLabel?: string;
}

export function ReceiptCustomerSelectorSection({
  customers,
  customerId,
  onSelectCustomer,
  unmatchedInvoiceCustomer,
  quickAddOpen,
  setQuickAddOpen,
  quickCustomerName,
  setQuickCustomerName,
  quickCustomerPhone,
  setQuickCustomerPhone,
  creatingCustomer,
  onQuickAddCustomer,
  customerSummary,
  currencyLabel = getCurrencyShortLabel("SDG"),
}: ReceiptCustomerSelectorProps) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <label className="text-[11px] font-black text-foreground">
          العميل <span className="text-rose-500">*</span>
        </label>
        <button
          type="button"
          onClick={() => setQuickAddOpen((v) => !v)}
          className="inline-flex items-center gap-1 text-[10.5px] font-black text-primary hover:underline touch-manipulation"
        >
          <UserPlus className="h-3 w-3" />
          <span>{quickAddOpen ? "إغلاق الإضافة السريعة" : "عميل جديد"}</span>
        </button>
      </div>

      <Select
        value={customerId || "__none__"}
        onValueChange={(v) => onSelectCustomer(v === "__none__" ? "" : v)}
      >
        <SelectTrigger className="h-10 rounded-xl text-xs font-bold bg-background text-right">
          <SelectValue placeholder="اختر العميل" />
        </SelectTrigger>
        <SelectContent dir="rtl">
          <SelectItem value="__none__">— اختر العميل —</SelectItem>
          {customers.map((customer) => (
            <SelectItem key={customer.id} value={customer.id}>
              {customer.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {unmatchedInvoiceCustomer && !customerId && (
        <div className="flex items-center justify-between gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-2 text-[10.5px]">
          <span className="font-bold text-amber-800 dark:text-amber-300">
            الفاتورة باسم «{unmatchedInvoiceCustomer}» غير مسجل بقائمة العملاء.
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={creatingCustomer}
            onClick={onQuickAddCustomer}
            className="h-7 shrink-0 rounded-lg text-[10px] font-black border-amber-500/40"
          >
            إضافته تلقائياً
          </Button>
        </div>
      )}

      {quickAddOpen && (
        <div className="rounded-xl border border-primary/25 bg-primary/[0.04] p-2.5 space-y-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <Input
              value={quickCustomerName}
              onChange={(e) => setQuickCustomerName(e.target.value)}
              placeholder="اسم العميل *"
              className="h-9 rounded-lg text-xs font-bold bg-background text-right"
            />
            <Input
              value={quickCustomerPhone}
              onChange={(e) => setQuickCustomerPhone(e.target.value)}
              placeholder="رقم الهاتف (اختياري)"
              inputMode="tel"
              className="h-9 rounded-lg text-xs font-bold bg-background text-right"
            />
          </div>
          <Button
            type="button"
            size="sm"
            disabled={creatingCustomer || !quickCustomerName.trim()}
            onClick={onQuickAddCustomer}
            className="w-full h-8 rounded-lg text-[11px] font-black"
          >
            {creatingCustomer && <Loader2 className="h-3 w-3 animate-spin me-1" />}
            حفظ العميل واختياره للتحصيل
          </Button>
        </div>
      )}

      {customerSummary && (
        <p className="text-[10px] font-bold text-muted-foreground">
          مفوتر {formatNumber(customerSummary.invoicedTotal)} · محصّل{" "}
          {formatNumber(customerSummary.collectedTotal)} · متبقي{" "}
          <span className="text-foreground font-black">
            {formatNumber(customerSummary.outstanding)} {currencyLabel}
          </span>
        </p>
      )}
    </div>
  );
}

interface ReceiptInvoiceAllocationsProps {
  customerId: string;
  customerOpenInvoices: OpenSalesInvoiceRow[];
  unallocatedCustomerInvoices: OpenSalesInvoiceRow[];
  rows: AllocationFormRow[];
  setRows: React.Dispatch<React.SetStateAction<AllocationFormRow[]>>;
  paymentAmount: number;
  allocatedTotal: number;
  remaining: number;
  onAddRow: () => void;
  onPickInvoiceToPay: (invId: string) => void;
  onPayFullInvoice: (index: number) => void;
  onAutoAllocate: () => void;
  currencyLabel?: string;
}

export function ReceiptInvoiceAllocationsSection({
  customerId,
  customerOpenInvoices,
  unallocatedCustomerInvoices,
  rows,
  setRows,
  paymentAmount,
  allocatedTotal,
  remaining,
  onAddRow,
  onPickInvoiceToPay,
  onPayFullInvoice,
  onAutoAllocate,
  currencyLabel = getCurrencyShortLabel("SDG"),
}: ReceiptInvoiceAllocationsProps) {
  return (
    <div className="rounded-2xl border border-border/70 bg-card p-3.5 space-y-3 shadow-xs">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="h-6 w-6 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
            <Receipt className="h-3.5 w-3.5" />
          </div>
          <div>
            <h4 className="text-xs font-black text-foreground">سداد فواتير العميل</h4>
            <p className="text-[10px] text-muted-foreground">
              اختر الفاتورة التي يريد العميل سدادها من هذه الدفعة
            </p>
          </div>
        </div>

        {customerOpenInvoices.length > 0 && (
          <span className="inline-flex items-center rounded-full bg-primary/10 text-primary px-2.5 py-0.5 text-[10.5px] font-black">
            {customerOpenInvoices.length} فواتير مستحقة
          </span>
        )}
      </div>

      {!customerId ? (
        <div className="rounded-xl border border-dashed border-border bg-muted/30 p-3 text-center">
          <p className="text-xs font-bold text-muted-foreground">
            يرجى اختيار العميل أولاً لعرض قائمة فواتيره المستحقة واختيار ما يريد سداده.
          </p>
        </div>
      ) : customerOpenInvoices.length === 0 ? (
        <div className="rounded-xl border border-border/60 bg-muted/20 p-3 flex items-start gap-2.5">
          <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <p className="text-xs font-bold text-foreground">لا توجد فواتير مستحقة على هذا العميل</p>
            <p className="text-[10.5px] leading-relaxed text-muted-foreground">
              لا توجد فواتير مبيعات معلقة لهذا العميل حالياً. سيتم قيد هذا المبلغ كدفعة مقدمة (رصيد دائن) في حسابه تلقائياً.
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-2.5">
          {unallocatedCustomerInvoices.length > 0 ? (
            <div className="space-y-2">
              <Select
                value="__none__"
                onValueChange={(val) => {
                  if (val && val !== "__none__") {
                    onPickInvoiceToPay(val);
                  }
                }}
              >
                <SelectTrigger className="w-full h-10 rounded-xl text-xs font-bold bg-background border-primary/40 hover:border-primary text-right">
                  <SelectValue placeholder="— اضغط لاختيار الفاتورة المراد سدادها —" />
                </SelectTrigger>
                <SelectContent dir="rtl" className="max-h-60">
                  <SelectItem value="__none__" disabled className="text-xs font-bold text-muted-foreground">
                    — اضغط لاختيار الفاتورة المراد سدادها —
                  </SelectItem>
                  {unallocatedCustomerInvoices.map((inv) => {
                    const curLabel = getCurrencyShortLabel(inv.currency);
                    return (
                      <SelectItem key={inv.id} value={inv.id} className="py-2">
                        <div className="flex items-center justify-between gap-3 text-xs w-full">
                          <div className="flex items-center gap-1.5 font-mono font-black text-primary" dir="ltr">
                            <span>{inv.reference}</span>
                          </div>
                          <span className="text-[10px] text-muted-foreground">{inv.date}</span>
                          <span className="font-bold text-foreground">
                            المتبقي: {formatNumber(inv.settlement.outstanding)} {curLabel}
                          </span>
                        </div>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>

              <div className="flex items-center justify-between gap-2 flex-wrap text-[10.5px]">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={onAddRow}
                  disabled={unallocatedCustomerInvoices.length === 0}
                  className="h-8 rounded-xl gap-1 font-bold border-border/80 text-foreground hover:bg-secondary"
                >
                  <Plus className="h-3 w-3" />
                  إضافة فاتورة
                </Button>
                {customerOpenInvoices.length > 1 && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={onAutoAllocate}
                    className="h-8 rounded-xl gap-1 font-bold border-primary/30 text-primary hover:bg-primary/10 mr-auto"
                  >
                    <SlidersHorizontal className="h-3 w-3" />
                    توزيع تلقائي للمبلغ
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-2.5 text-center">
              <p className="text-xs font-bold text-emerald-700 dark:text-emerald-400">
                ✓ تم إدراج جميع فواتير العميل المستحقة
              </p>
            </div>
          )}

          {rows.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-muted/20 p-3 text-center">
              <p className="text-[11px] font-bold text-muted-foreground">
                لم يتم اختيار أي فاتورة للسداد حتى الآن. اختر الفاتورة من القائمة أعلاه أو سجّل المبلغ كدفعة مقدّمة.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {rows.map((row, index) => {
                const invoice = customerOpenInvoices.find((inv) => inv.id === row.invoiceId);
                const rowAmount = Number(row.amount) || 0;
                const outstanding = invoice?.settlement.outstanding ?? 0;
                const isFull = rowAmount >= outstanding && outstanding > 0;
                const curLabel = invoice?.currency
                  ? getCurrencyShortLabel(invoice.currency)
                  : currencyLabel;

                return (
                  <div
                    key={row.invoiceId}
                    className="rounded-xl border border-border/80 bg-background p-2.5 space-y-2 transition-all"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-mono text-xs font-black text-primary" dir="ltr">
                          {invoice?.reference ?? row.invoiceId}
                        </span>
                        {invoice?.date && (
                          <span className="text-[10px] text-muted-foreground">({invoice.date})</span>
                        )}
                        {isFull ? (
                          <span className="rounded-md bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 px-1.5 py-0.5 text-[9.5px] font-black">
                            سداد كامل
                          </span>
                        ) : rowAmount > 0 ? (
                          <span className="rounded-md bg-amber-500/10 text-amber-700 dark:text-amber-400 px-1.5 py-0.5 text-[9.5px] font-black">
                            سداد جزئي
                          </span>
                        ) : null}
                      </div>

                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        aria-label="إلغاء اختيار هذه الفاتورة"
                        onClick={() => setRows((current) => current.filter((_, i) => i !== index))}
                        className="h-7 w-7 rounded-lg p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>

                    <div className="flex items-center justify-between gap-2 pt-1 border-t border-border/40">
                      <div className="text-[10.5px]">
                        <span className="text-muted-foreground">المتبقي على الفاتورة: </span>
                        <span className="font-black text-foreground tabular-nums">
                          {formatNumber(outstanding)} {curLabel}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5">
                        {!isFull && (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => onPayFullInvoice(index)}
                            className="h-8 rounded-lg text-[10px] font-black text-primary border-primary/30 hover:bg-primary/5 px-2"
                          >
                            سداد كامل الفاتورة
                          </Button>
                        )}
                        <div className="flex items-center gap-1">
                          <span className="text-[10px] font-bold text-muted-foreground">المسدد:</span>
                          <Input
                            inputMode="decimal"
                            value={row.amount}
                            onChange={(e) =>
                              setRows((current) =>
                                current.map((r, i) =>
                                  i === index
                                    ? { ...r, amount: sanitizePositiveDecimal(e.target.value) }
                                    : r
                                )
                              )
                            }
                            placeholder="0"
                            className="h-8 w-24 rounded-lg text-xs font-bold text-center tabular-nums bg-background"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {paymentAmount > 0 && (
            <div className="rounded-xl bg-muted/40 p-2.5 flex items-center justify-between gap-2 text-[10.5px] font-bold">
              <span>
                المسدد للفواتير:{" "}
                <strong className="text-foreground">
                  {formatNumber(allocatedTotal)} {currencyLabel}
                </strong>
              </span>
              {remaining > 0 ? (
                <span className="text-muted-foreground">
                  متبقي كدفعة مقدمة:{" "}
                  <strong className="text-primary">
                    {formatNumber(remaining)} {currencyLabel}
                  </strong>
                </span>
              ) : (
                <span className="text-emerald-700 dark:text-emerald-400 font-black">
                  ✓ تمت تسوية كامل المبلغ
                </span>
              )}
            </div>
          )}

          {allocatedTotal > paymentAmount + 0.009 && (
            <p className="flex items-center gap-1.5 rounded-xl border border-destructive/30 bg-destructive/10 p-2 text-[10.5px] font-black text-destructive">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              مجموع المبالغ المسددة للفواتير ({formatNumber(allocatedTotal)}) يتجاوز إجمالي سند القبض ({formatNumber(paymentAmount)}).
            </p>
          )}
        </div>
      )}
    </div>
  );
}
