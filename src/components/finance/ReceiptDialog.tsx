import React, { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { addCustomer, useCustomers } from "@/lib/customersStore";
import { getAllAccounts, getDefaultAccountId } from "@/lib/repositories/FinancialAccountRepository";
import {
  getCustomerAccount,
  getOpenSalesInvoices,
  type CustomerAccount,
  type OpenSalesInvoiceRow,
} from "@/lib/repositories/LedgerRepository";
import { recordCustomerReceipt } from "@/lib/repositories/PaymentRepository";
import { notifyFinanceUpdated } from "@/lib/financeStore";
import { getLocalIsoDate } from "@/lib/dateUtils";
import { PAYMENT_METHOD_LABELS, type FinancialAccount, type PaymentMethod } from "@/lib/domain/finance";
import { formatNumber } from "@/lib/printCalculator";
import { getCurrencyShortLabel } from "@/lib/currency/currencyFormat";
import { DEFAULT_CURRENCY, sanitizeCurrency, type AppCurrency } from "@/lib/currency/types";
import { CurrencySelector } from "@/components/currency/CurrencySelector";
import {
  ReceiptCustomerSelectorSection,
  ReceiptInvoiceAllocationsSection,
} from "./ReceiptDialogSections";
import { sanitizePositiveDecimal } from "./shared/numericInput";
import { allocateInvoicesFifo, type AllocationFormRow } from "./shared/allocateFifo";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** فاتورة محددة مسبقاً (تسجيل دفعة من سياق الفاتورة — PRD §7.3) */
  initialInvoiceId?: string | null;
  /** عميل محدد مسبقاً عند الفتح من بطاقة عميل أو ذمم */
  initialCustomerId?: string | null;
  /** العملة الافتراضية للتحصيل (تُقفل تلقائياً على عملة الفاتورة عند تحديد فاتورة) */
  defaultCurrency?: AppCurrency;
  onRecorded?: () => void;
}

function resolveCustomerIdForInvoice(
  invoice: OpenSalesInvoiceRow,
  customers: { id: string; name: string }[]
): string {
  if (invoice.customerId && customers.some((c) => c.id === invoice.customerId)) {
    return invoice.customerId;
  }
  const normalizedParty = invoice.customerName.trim().toLowerCase();
  if (!normalizedParty) return "";
  return customers.find((c) => c.name.trim().toLowerCase() === normalizedParty)?.id ?? "";
}

/**
 * تسجيل تحصيل من العميل مع تخصيص صريح للفواتير (PRD §6.2، §4.2).
 * المبلغ غير المخصَّص يبقى دفعة مقدّمة مشروعة، لا خطأ.
 */
export function ReceiptDialog({
  open,
  onOpenChange,
  initialInvoiceId,
  initialCustomerId,
  defaultCurrency,
  onRecorded,
}: Props) {
  const customers = useCustomers();
  const customersRef = useRef(customers);
  customersRef.current = customers;

  const [accounts, setAccounts] = useState<FinancialAccount[]>([]);
  const [openInvoices, setOpenInvoices] = useState<OpenSalesInvoiceRow[]>([]);
  const [customerSummary, setCustomerSummary] = useState<CustomerAccount | null>(null);
  const [loadingInit, setLoadingInit] = useState(false);

  const [currency, setCurrency] = useState<AppCurrency>(() =>
    sanitizeCurrency(defaultCurrency, DEFAULT_CURRENCY)
  );
  const [customerId, setCustomerId] = useState("");
  const [amount, setAmount] = useState("");
  const [paidAt, setPaidAt] = useState(() => getLocalIsoDate());
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [accountId, setAccountId] = useState("");
  const [notes, setNotes] = useState("");
  const [rows, setRows] = useState<AllocationFormRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);
  const [unmatchedInvoiceCustomer, setUnmatchedInvoiceCustomer] = useState<string | null>(null);

  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickCustomerName, setQuickCustomerName] = useState("");
  const [quickCustomerPhone, setQuickCustomerPhone] = useState("");
  const [creatingCustomer, setCreatingCustomer] = useState(false);

  const isCurrencyLocked = Boolean(initialInvoiceId);
  const currencyLabel = getCurrencyShortLabel(currency);

  const selectableAccounts = useMemo(
    () => accounts.filter((a) => sanitizeCurrency(a.currency, DEFAULT_CURRENCY) === currency),
    [accounts, currency]
  );
  const noMatchingAccount = !loadingInit && selectableAccounts.length === 0;

  useEffect(() => {
    if (!open) {
      setDuplicateWarning(null);
      setQuickAddOpen(false);
      return;
    }

    let cancelled = false;
    setLoadingInit(true);
    setNotes("");
    setMethod("cash");
    setPaidAt(getLocalIsoDate());
    setDuplicateWarning(null);
    setQuickAddOpen(false);
    setUnmatchedInvoiceCustomer(null);

    void (async () => {
      try {
        let [accountList, invoices] = await Promise.all([getAllAccounts(), getOpenSalesInvoices()]);
        if (accountList.length === 0) {
          await getDefaultAccountId();
          accountList = await getAllAccounts();
        }
        if (cancelled) return;

        setAccounts(accountList);
        setOpenInvoices(invoices);

        const fallbackCurrency = sanitizeCurrency(defaultCurrency, DEFAULT_CURRENCY);
        if (initialInvoiceId) {
          const invoice = invoices.find((inv) => inv.id === initialInvoiceId);
          const resolvedCurrency = invoice
            ? sanitizeCurrency(invoice.currency, fallbackCurrency)
            : fallbackCurrency;
          const matching = accountList.filter(
            (a) => sanitizeCurrency(a.currency, DEFAULT_CURRENCY) === resolvedCurrency
          );
          setCurrency(resolvedCurrency);
          setAccountId((current) =>
            current && matching.some((a) => a.id === current) ? current : matching[0]?.id ?? ""
          );

          const matchedCustomerId = invoice
            ? resolveCustomerIdForInvoice(invoice, customersRef.current)
            : initialCustomerId ?? "";
          setRows([{ invoiceId: initialInvoiceId, amount: invoice ? String(invoice.settlement.outstanding) : "" }]);
          setAmount(invoice ? String(invoice.settlement.outstanding) : "");
          setCustomerId(matchedCustomerId);
          if (invoice && !matchedCustomerId && invoice.customerName.trim()) {
            setUnmatchedInvoiceCustomer(invoice.customerName.trim());
            setQuickCustomerName(invoice.customerName.trim());
          }
        } else {
          const matching = accountList.filter(
            (a) => sanitizeCurrency(a.currency, DEFAULT_CURRENCY) === fallbackCurrency
          );
          setCurrency(fallbackCurrency);
          setAccountId((current) =>
            current && matching.some((a) => a.id === current) ? current : matching[0]?.id ?? ""
          );
          setCustomerId(initialCustomerId ?? "");
          setRows([]);
          setAmount("");
        }
      } catch (err) {
        if (!cancelled) {
          console.error("[ReceiptDialog] init failed:", err);
          toast.error("تعذّر تحميل بيانات التحصيل.");
        }
      } finally {
        if (!cancelled) setLoadingInit(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, initialInvoiceId, initialCustomerId, defaultCurrency]);

  useEffect(() => {
    if (!open || loadingInit) return;
    setAccountId((current) =>
      current && selectableAccounts.some((a) => a.id === current)
        ? current
        : selectableAccounts[0]?.id ?? ""
    );
  }, [open, loadingInit, selectableAccounts]);

  useEffect(() => {
    if (!open || !customerId) {
      setCustomerSummary(null);
      return;
    }
    let cancelled = false;
    void getCustomerAccount(customerId, currency)
      .then((summary) => {
        if (!cancelled) setCustomerSummary(summary);
      })
      .catch(() => {
        if (!cancelled) setCustomerSummary(null);
      });
    return () => {
      cancelled = true;
    };
  }, [open, customerId, currency]);

  const selectedCustomer = useMemo(
    () => customers.find((c) => c.id === customerId) ?? null,
    [customers, customerId]
  );

  const customerOpenInvoices = useMemo(() => {
    if (!customerId) return [];
    const targetName = selectedCustomer?.name.trim().toLowerCase() ?? "";
    return openInvoices.filter(
      (inv) =>
        sanitizeCurrency(inv.currency, DEFAULT_CURRENCY) === currency &&
        (inv.customerId === customerId ||
          (Boolean(targetName) && inv.customerName.trim().toLowerCase() === targetName))
    );
  }, [openInvoices, customerId, selectedCustomer, currency]);

  const allocatedTotal = useMemo(
    () => rows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0),
    [rows]
  );
  const paymentAmount = Number(amount) || 0;
  const remaining = Math.max(0, paymentAmount - allocatedTotal);

  const unallocatedCustomerInvoices = useMemo(() => {
    const usedIds = new Set(rows.map((r) => r.invoiceId));
    return customerOpenInvoices.filter((inv) => !usedIds.has(inv.id));
  }, [customerOpenInvoices, rows]);

  const handleCurrencyChange = (next: AppCurrency) => {
    if (isCurrencyLocked) return;
    const safe = sanitizeCurrency(next, DEFAULT_CURRENCY);
    setCurrency(safe);
    setRows([]);
    setDuplicateWarning(null);
  };

  const handleSelectCustomer = (nextId: string) => {
    setCustomerId(nextId);
    setDuplicateWarning(null);
    setUnmatchedInvoiceCustomer(null);
    if (!nextId) {
      setRows([]);
    } else {
      const nextCust = customers.find((c) => c.id === nextId);
      const nextName = nextCust?.name.trim().toLowerCase() ?? "";
      setRows((current) =>
        current.filter((row) => {
          const inv = openInvoices.find((i) => i.id === row.invoiceId);
          if (!inv || sanitizeCurrency(inv.currency, DEFAULT_CURRENCY) !== currency) return false;
          return (
            inv.customerId === nextId ||
            (Boolean(nextName) && inv.customerName.trim().toLowerCase() === nextName)
          );
        })
      );
    }
  };

  const handleQuickAddCustomer = async () => {
    const trimmedName = quickCustomerName.trim();
    if (!trimmedName) {
      toast.error("أدخل اسم العميل أولاً");
      return;
    }
    setCreatingCustomer(true);
    try {
      const created = await addCustomer({
        name: trimmedName,
        phone: quickCustomerPhone.trim(),
        type: "individual",
        address: "",
        balance: 0,
      });
      setCustomerId(created.id);
      setQuickCustomerName("");
      setQuickCustomerPhone("");
      setQuickAddOpen(false);
      setUnmatchedInvoiceCustomer(null);
      toast.success(`تمت إضافة العميل «${created.name}» واختياره`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "تعذّر إضافة العميل.");
    } finally {
      setCreatingCustomer(false);
    }
  };

  const addRow = () => {
    const candidate = unallocatedCustomerInvoices[0];
    if (!candidate) return;
    const suggested =
      paymentAmount > 0
        ? Math.min(Math.max(remaining, 0), candidate.settlement.outstanding)
        : candidate.settlement.outstanding;

    setRows((current) => [
      ...current,
      { invoiceId: candidate.id, amount: suggested > 0 ? String(suggested) : String(candidate.settlement.outstanding) },
    ]);

    if (!(paymentAmount > 0)) {
      setAmount(String(candidate.settlement.outstanding));
    }
  };

  const handlePickInvoiceToPay = (invId: string) => {
    const candidate = customerOpenInvoices.find((inv) => inv.id === invId);
    if (!candidate) return;
    if (rows.some((r) => r.invoiceId === invId)) return;

    const suggested =
      paymentAmount > 0
        ? Math.min(Math.max(remaining, 0), candidate.settlement.outstanding)
        : candidate.settlement.outstanding;

    setRows((current) => [
      ...current,
      { invoiceId: candidate.id, amount: suggested > 0 ? String(suggested) : String(candidate.settlement.outstanding) },
    ]);

    if (!(paymentAmount > 0)) {
      setAmount(String(candidate.settlement.outstanding));
    }
  };

  const handlePayFullInvoice = (index: number) => {
    const row = rows[index];
    if (!row) return;
    const inv = customerOpenInvoices.find((i) => i.id === row.invoiceId);
    if (!inv) return;
    const fullAmount = inv.settlement.outstanding;
    const updated = rows.map((r, i) => (i === index ? { ...r, amount: String(fullAmount) } : r));
    const newTotal = updated.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
    setRows(updated);
    if (newTotal > (Number(amount) || 0)) {
      setAmount(String(newTotal));
    }
  };

  const autoAllocateCustomerInvoices = () => {
    const fifo = allocateInvoicesFifo(
      customerOpenInvoices.map((inv) => ({ id: inv.id, outstanding: inv.settlement.outstanding })),
      paymentAmount
    );
    setRows(fifo.rows);
    if (fifo.suggestedAmount !== undefined) {
      setAmount(fifo.suggestedAmount);
    }
  };

  const handleSave = async (confirmDuplicate = false) => {
    if (!customerId) {
      toast.error("يجب اختيار العميل");
      return;
    }
    if (!(paymentAmount > 0)) {
      toast.error("قيمة الدفعة يجب أن تكون أكبر من صفر");
      return;
    }
    if (!accountId) {
      toast.error("يجب تحديد الحساب المالي المستلم");
      return;
    }
    if (allocatedTotal > paymentAmount + 0.009) {
      toast.error("مجموع التخصيصات يتجاوز قيمة الدفعة");
      return;
    }

    const selectedAccount = selectableAccounts.find((a) => a.id === accountId);
    if (!selectedAccount) {
      toast.error(`لا يوجد حساب مالي مختار بعملة ${currency} (${currencyLabel})`);
      return;
    }

    const activeAllocations = rows
      .filter((row) => Number(row.amount) > 0)
      .map((row) => ({ invoiceId: row.invoiceId, amount: Number(row.amount) }));

    setBusy(true);
    try {
      const { payment } = await recordCustomerReceipt({
        customerId,
        amount: paymentAmount,
        currency,
        paidAt,
        method,
        accountId: selectedAccount.id,
        notes: notes.trim() || undefined,
        allocations: activeAllocations,
        confirmDuplicate,
      });
      setDuplicateWarning(null);
      const curLabel = getCurrencyShortLabel(payment.currency);
      toast.success(`تم تسجيل التحصيل ${payment.reference} بمبلغ ${formatNumber(payment.amount)} ${curLabel}`);
      await notifyFinanceUpdated();
      onRecorded?.();
      onOpenChange(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : "تعذّر تسجيل الدفعة.";
      const code = (err as { code?: string })?.code;
      if (!confirmDuplicate && (code === "DUPLICATE_PAYMENT" || /مطابقة/.test(message))) {
        setDuplicateWarning(message);
      } else {
        toast.error(message);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-md max-h-safe-dialog overflow-y-auto">
        <DialogHeader className="border-b border-border/50 pb-2.5 mb-1">
          <DialogTitle className="text-base sm:text-lg font-black text-slate-900 dark:text-white">
            تحصيل من عميل
          </DialogTitle>
        </DialogHeader>

        {loadingInit ? (
          <div className="flex flex-col items-center justify-center py-8 gap-2 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <span className="text-xs font-bold">جارٍ تجهيز بيانات التحصيل…</span>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2 rounded-xl border border-border/60 bg-muted/20 px-3 py-2">
              <span className="text-[11px] font-black text-foreground">
                عملة التحصيل{" "}
                {isCurrencyLocked && (
                  <span className="text-[10px] font-bold text-muted-foreground">(مطابقة للفاتورة)</span>
                )}
              </span>
              <CurrencySelector
                label=""
                dropdownTitle="اختر عملة التحصيل"
                value={currency}
                onChange={handleCurrencyChange}
                disabled={isCurrencyLocked}
              />
            </div>

            <ReceiptCustomerSelectorSection
              customers={customers}
              customerId={customerId}
              onSelectCustomer={handleSelectCustomer}
              unmatchedInvoiceCustomer={unmatchedInvoiceCustomer}
              quickAddOpen={quickAddOpen}
              setQuickAddOpen={setQuickAddOpen}
              quickCustomerName={quickCustomerName}
              setQuickCustomerName={setQuickCustomerName}
              quickCustomerPhone={quickCustomerPhone}
              setQuickCustomerPhone={setQuickCustomerPhone}
              creatingCustomer={creatingCustomer}
              onQuickAddCustomer={() => void handleQuickAddCustomer()}
              customerSummary={customerSummary}
              currencyLabel={currencyLabel}
            />

            <div className="grid grid-cols-2 gap-2">
              <Field label={`المبلغ (${currencyLabel})`} required>
                <Input
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => {
                    setAmount(sanitizePositiveDecimal(e.target.value));
                    setDuplicateWarning(null);
                  }}
                  className="h-10 rounded-xl text-xs font-bold bg-background text-center tabular-nums"
                  placeholder="0"
                />
              </Field>
              <Field label="التاريخ" required>
                <Input
                  type="date"
                  value={paidAt}
                  onChange={(e) => {
                    setPaidAt(e.target.value);
                    setDuplicateWarning(null);
                  }}
                  className="h-10 rounded-xl text-xs font-mono font-bold bg-background text-right"
                />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Field label="طريقة الدفع">
                <Select
                  value={method}
                  onValueChange={(v) => {
                    setMethod(v as PaymentMethod);
                    setDuplicateWarning(null);
                  }}
                >
                  <SelectTrigger className="h-10 rounded-xl text-xs font-bold bg-background text-right">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent dir="rtl">
                    {(Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[]).map((key) => (
                      <SelectItem key={key} value={key}>
                        {PAYMENT_METHOD_LABELS[key]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="الحساب المستلم" required>
                <Select
                  value={accountId || "__none__"}
                  onValueChange={(v) => setAccountId(v === "__none__" ? "" : v)}
                  disabled={noMatchingAccount}
                >
                  <SelectTrigger className="h-10 rounded-xl text-xs font-bold bg-background text-right">
                    <SelectValue placeholder="اختر الحساب" />
                  </SelectTrigger>
                  <SelectContent dir="rtl">
                    <SelectItem value="__none__">— اختر الحساب —</SelectItem>
                    {selectableAccounts.map((account) => (
                      <SelectItem key={account.id} value={account.id}>
                        {account.name} ({getCurrencyShortLabel(account.currency)})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>

            {noMatchingAccount && (
              <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-2.5 flex items-start gap-2 text-[11px] font-bold text-amber-800 dark:text-amber-300">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>
                  لا يوجد حساب مالي بعملة {currency} ({currencyLabel}). يرجى إضافة حساب مالي بهذه العملة من صفحة المالية أولاً.
                </span>
              </div>
            )}

            <ReceiptInvoiceAllocationsSection
              customerId={customerId}
              customerOpenInvoices={customerOpenInvoices}
              unallocatedCustomerInvoices={unallocatedCustomerInvoices}
              rows={rows}
              setRows={setRows}
              paymentAmount={paymentAmount}
              allocatedTotal={allocatedTotal}
              remaining={remaining}
              onAddRow={addRow}
              onPickInvoiceToPay={handlePickInvoiceToPay}
              onPayFullInvoice={handlePayFullInvoice}
              onAutoAllocate={autoAllocateCustomerInvoices}
              currencyLabel={currencyLabel}
            />

            <Field label="ملاحظات (اختياري)">
              <Input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="رقم إيصال، اسم المسلّم، أو ملاحظة…"
                className="h-10 rounded-xl text-xs font-bold bg-background text-right"
              />
            </Field>

            {duplicateWarning && (
              <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 space-y-2">
                <div className="flex items-start gap-2 text-[11px] font-bold text-amber-800 dark:text-amber-300">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>{duplicateWarning}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    disabled={busy}
                    onClick={() => void handleSave(true)}
                    className="flex-1 h-8 rounded-lg gap-1 text-[11px] font-black bg-amber-600 hover:bg-amber-700 text-white"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    تأكيد التسجيل رغم التكرار
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setDuplicateWarning(null)}
                    className="h-8 rounded-lg text-[11px] font-bold"
                  >
                    تراجع
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} className="flex-1 h-10 rounded-xl text-xs font-bold">
            إلغاء
          </Button>
          <Button
            type="button"
            onClick={() => void handleSave(false)}
            disabled={busy || loadingInit || noMatchingAccount}
            className="flex-1 h-10 rounded-xl text-xs font-bold"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin me-1" />}
            تسجيل التحصيل
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-[11px] font-black text-foreground">
        {label} {required && <span className="text-rose-500">*</span>}
      </label>
      {children}
    </div>
  );
}

export default ReceiptDialog;
