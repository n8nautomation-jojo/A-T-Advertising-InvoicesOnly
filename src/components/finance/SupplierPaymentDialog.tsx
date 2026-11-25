import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, UserPlus } from "lucide-react";
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
import { getCustomInvoiceById } from "@/lib/repositories/CustomInvoiceRepository";
import {
  ensureAccountForCurrency,
  getAllAccounts,
  getDefaultAccountId,
} from "@/lib/repositories/FinancialAccountRepository";
import { getInvoiceSettlement } from "@/lib/repositories/LedgerRepository";
import {
  createSupplier,
  findOrCreateSupplierByName,
  getAllSuppliers,
  getSupplierAccount,
  linkUnlinkedPurchaseInvoiceToSupplier,
  normalizeSupplierName,
  type SupplierAccount,
  type Supplier,
} from "@/lib/repositories/SupplierRepository";
import { recordSupplierPayment } from "@/lib/repositories/PaymentRepository";
import { notifyFinanceUpdated } from "@/lib/financeStore";
import { getLocalIsoDate } from "@/lib/dateUtils";
import {
  getPreferredAccountForCurrency,
  PAYMENT_METHOD_LABELS,
  type FinancialAccount,
  type PaymentMethod,
} from "@/lib/domain/finance";
import { formatNumber } from "@/lib/printCalculator";
import { getCurrencyShortLabel } from "@/lib/currency/currencyFormat";
import { DEFAULT_CURRENCY, sanitizeCurrency, type AppCurrency } from "@/lib/currency/types";
import { CurrencySelector } from "@/components/currency/CurrencySelector";
import { SupplierAllocationSection } from "./SupplierAllocationSection";
import { sanitizePositiveDecimal } from "./shared/numericInput";
import { allocateInvoicesFifo, type AllocationFormRow } from "./shared/allocateFifo";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialSupplierId?: string | null;
  initialInvoiceId?: string | null;
  defaultCurrency?: AppCurrency;
  onRecorded?: () => void;
}

/** تسجيل دفعة لمورد مقابل فواتير الشراء (§7.3) — تقلّل الالتزام وتخصم من الرصيد البنكي معاً. */
export function SupplierPaymentDialog({
  open,
  onOpenChange,
  initialSupplierId,
  initialInvoiceId,
  defaultCurrency,
  onRecorded,
}: Props) {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [accounts, setAccounts] = useState<FinancialAccount[]>([]);
  const [account, setAccount] = useState<SupplierAccount | null>(null);
  const [loadingInit, setLoadingInit] = useState(false);
  const [currency, setCurrency] = useState<AppCurrency>(() =>
    sanitizeCurrency(defaultCurrency, DEFAULT_CURRENCY)
  );
  const [supplierId, setSupplierId] = useState("");
  const [amount, setAmount] = useState("");
  const [paidAt, setPaidAt] = useState(() => getLocalIsoDate());
  const [method, setMethod] = useState<PaymentMethod>("bank_transfer");
  const [accountId, setAccountId] = useState("");
  const [notes, setNotes] = useState("");
  const [rows, setRows] = useState<AllocationFormRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickSupplierName, setQuickSupplierName] = useState("");
  const [creatingSupplier, setCreatingSupplier] = useState(false);
  const appliedInitialInvoiceRef = useRef<string | null>(null);

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
      appliedInitialInvoiceRef.current = null;
      return;
    }
    let cancelled = false;
    setLoadingInit(true);
    setSupplierId(initialSupplierId ?? "");
    setNotes("");
    setMethod("bank_transfer");
    setPaidAt(getLocalIsoDate());
    setRows([]);
    setAmount("");
    setDuplicateWarning(null);
    setQuickAddOpen(false);
    setQuickSupplierName("");
    appliedInitialInvoiceRef.current = null;

    void (async () => {
      try {
        const fallbackCurrency = sanitizeCurrency(defaultCurrency, DEFAULT_CURRENCY);
        let [supplierList, accountList, directInvoice, directSettlement] = await Promise.all([
          getAllSuppliers(),
          getAllAccounts(),
          initialInvoiceId ? getCustomInvoiceById(initialInvoiceId).catch(() => undefined) : Promise.resolve(undefined),
          initialInvoiceId ? getInvoiceSettlement(initialInvoiceId, "purchase").catch(() => null) : Promise.resolve(null),
        ]);
        if (accountList.length === 0) {
          await getDefaultAccountId();
          accountList = await getAllAccounts();
        }
        if (cancelled) return;

        let resolvedCurrency = fallbackCurrency;
        let resolvedSupplierId = initialSupplierId ?? "";

        if (initialInvoiceId && directInvoice) {
          resolvedCurrency = sanitizeCurrency(directInvoice.meta.currency, fallbackCurrency);
          const invSupplierId = (directInvoice as unknown as { supplierId?: string }).supplierId;
          if (invSupplierId && supplierList.some((s) => s.id === invSupplierId)) {
            resolvedSupplierId = invSupplierId;
          } else if (!resolvedSupplierId) {
            const partyName = String(directInvoice.meta.partyName ?? "").trim();
            const normParty = normalizeSupplierName(partyName);
            const matchedSup = normParty
              ? supplierList.find((s) => normalizeSupplierName(s.name) === normParty)
              : undefined;
            if (matchedSup) {
              resolvedSupplierId = matchedSup.id;
              await linkUnlinkedPurchaseInvoiceToSupplier(initialInvoiceId, matchedSup.id).catch(() => {});
            } else if (partyName) {
              const autoCreated = await findOrCreateSupplierByName(partyName, directInvoice.meta.phone);
              await linkUnlinkedPurchaseInvoiceToSupplier(initialInvoiceId, autoCreated.id).catch(() => {});
              supplierList = await getAllSuppliers();
              resolvedSupplierId = autoCreated.id;
            }
          }

          if (directInvoice.meta.date) {
            setPaidAt(directInvoice.meta.date);
          }

          if (directSettlement && directSettlement.outstanding > 0) {
            appliedInitialInvoiceRef.current = initialInvoiceId;
            setRows([{ invoiceId: initialInvoiceId, amount: String(directSettlement.outstanding) }]);
            setAmount(String(directSettlement.outstanding));
          }
        } else if (initialInvoiceId && initialSupplierId) {
          const supData = await getSupplierAccount(initialSupplierId).catch(() => null);
          const matchedInitInvoice = supData?.invoices.find((inv) => inv.invoiceId === initialInvoiceId);
          if (matchedInitInvoice) {
            resolvedCurrency = sanitizeCurrency(matchedInitInvoice.currency, fallbackCurrency);
          }
        }

        if (cancelled) return;

        setSuppliers(supplierList);
        setAccounts(accountList);
        setSupplierId(resolvedSupplierId);
        setCurrency(resolvedCurrency);
        const preferred = getPreferredAccountForCurrency(accountList, resolvedCurrency);
        const matching = accountList.filter(
          (a) => sanitizeCurrency(a.currency, DEFAULT_CURRENCY) === resolvedCurrency
        );
        setAccountId((current) =>
          current && matching.some((a) => a.id === current)
            ? current
            : preferred?.id ?? matching[0]?.id ?? ""
        );
      } catch (err) {
        if (!cancelled) {
          console.error("[SupplierPaymentDialog] init failed:", err);
          toast.error("تعذّر تحميل قائمة الموردين والحسابات.");
        }
      } finally {
        if (!cancelled) setLoadingInit(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, initialSupplierId, initialInvoiceId, defaultCurrency]);

  useEffect(() => {
    if (!open || loadingInit) return;
    const preferred = getPreferredAccountForCurrency(accounts, currency);
    setAccountId((current) =>
      current && selectableAccounts.some((a) => a.id === current)
        ? current
        : preferred?.id ?? selectableAccounts[0]?.id ?? ""
    );
  }, [open, loadingInit, selectableAccounts, accounts, currency]);

  const loadSupplier = useCallback(
    async (id: string, cur: AppCurrency) => {
      if (!id) {
        setAccount(null);
        return;
      }
      try {
        const data = await getSupplierAccount(id, cur);
        setAccount(data);
        if (initialInvoiceId && appliedInitialInvoiceRef.current !== initialInvoiceId) {
          const invoice = data.invoices.find((inv) => inv.invoiceId === initialInvoiceId);
          if (invoice) {
            appliedInitialInvoiceRef.current = initialInvoiceId;
            setRows([{ invoiceId: invoice.invoiceId, amount: String(invoice.settlement.outstanding) }]);
            setAmount(String(invoice.settlement.outstanding));
          }
        }
      } catch (err) {
        console.error("[SupplierPaymentDialog] loadSupplier failed:", err);
        setAccount(null);
      }
    },
    [initialInvoiceId]
  );

  useEffect(() => {
    if (!open || loadingInit) return;
    void loadSupplier(supplierId, currency);
  }, [open, loadingInit, supplierId, currency, loadSupplier]);

  const openInvoices = useMemo(
    () =>
      (account?.invoices ?? []).filter(
        (inv) =>
          inv.settlement.outstanding > 0 &&
          sanitizeCurrency(inv.currency, DEFAULT_CURRENCY) === currency
      ),
    [account, currency]
  );
  const allocatedTotal = rows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
  const paymentAmount = Number(amount) || 0;
  const remaining = Math.max(0, paymentAmount - allocatedTotal);

  const handleMainAmountChange = (rawVal: string) => {
    const cleaned = sanitizePositiveDecimal(rawVal);
    setAmount(cleaned);
    setDuplicateWarning(null);

    if (rows.length === 1) {
      const targetRow = rows[0];
      const inv = openInvoices.find((i) => i.invoiceId === targetRow.invoiceId);
      const numeric = Number(cleaned) || 0;
      const capped =
        inv && inv.settlement.outstanding > 0
          ? Math.min(numeric, inv.settlement.outstanding)
          : numeric;
      setRows([
        {
          invoiceId: targetRow.invoiceId,
          amount: cleaned === "" ? "" : capped > 0 ? String(capped) : "",
        },
      ]);
    }
  };

  const handleRowAmountChange = (index: number, cleanedRowVal: string) => {
    setDuplicateWarning(null);
    const prevRowVal = rows[index]?.amount ?? "";
    const nextRows = rows.map((r, i) => (i === index ? { ...r, amount: cleanedRowVal } : r));
    setRows(nextRows);

    const nextAllocated = nextRows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
    if (nextRows.length === 1 && (amount === prevRowVal || amount === "")) {
      setAmount(cleanedRowVal);
    } else if (nextAllocated > (Number(amount) || 0)) {
      setAmount(String(Math.round(nextAllocated * 100) / 100));
    }
  };

  const handleCurrencyChange = (next: AppCurrency) => {
    if (isCurrencyLocked) return;
    setCurrency(sanitizeCurrency(next, DEFAULT_CURRENCY));
    setRows([]);
    setDuplicateWarning(null);
  };

  const handleQuickAddSupplier = async () => {
    const trimmed = quickSupplierName.trim();
    if (!trimmed) {
      toast.error("أدخل اسم المورد أولاً");
      return;
    }
    setCreatingSupplier(true);
    try {
      const created = await createSupplier({ name: trimmed });
      if (initialInvoiceId) {
        await linkUnlinkedPurchaseInvoiceToSupplier(initialInvoiceId, created.id).catch(() => {});
      }
      const list = await getAllSuppliers();
      setSuppliers(list);
      setSupplierId(created.id);
      setQuickSupplierName("");
      setQuickAddOpen(false);
      toast.success(`تمت إضافة المورد «${created.name}» واختياره`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "تعذّر إضافة المورد.");
    } finally {
      setCreatingSupplier(false);
    }
  };

  const handleProvisionAccount = async () => {
    try {
      const acc = await ensureAccountForCurrency(currency);
      const updated = await getAllAccounts();
      setAccounts(updated);
      setAccountId(acc.id);
      toast.success(`تم تفعيل الحساب «${acc.name}» بعملة ${currencyLabel}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "تعذّر تفعيل الحساب.");
    }
  };

  const addRow = () => {
    const usedIds = new Set(rows.map((r) => r.invoiceId));
    const candidate = openInvoices.find((inv) => !usedIds.has(inv.invoiceId));
    if (!candidate) return;
    const suggested =
      paymentAmount > 0
        ? Math.min(Math.max(remaining, 0), candidate.settlement.outstanding)
        : candidate.settlement.outstanding;
    setRows((c) => [...c, { invoiceId: candidate.invoiceId, amount: suggested > 0 ? String(suggested) : "" }]);
    if (!(paymentAmount > 0)) {
      setAmount(String(candidate.settlement.outstanding));
    }
  };

  const autoAllocate = () => {
    const fifo = allocateInvoicesFifo(
      openInvoices.map((inv) => ({ id: inv.invoiceId, outstanding: inv.settlement.outstanding })),
      paymentAmount
    );
    setRows(fifo.rows);
    if (fifo.suggestedAmount !== undefined) {
      setAmount(fifo.suggestedAmount);
    }
  };

  const handleSave = async (confirmDuplicate = false) => {
    if (!supplierId) {
      toast.error("يجب اختيار المورد");
      return;
    }
    if (!(paymentAmount > 0)) {
      toast.error("قيمة الدفعة يجب أن تكون أكبر من صفر");
      return;
    }
    if (!accountId) {
      toast.error("يجب تحديد الحساب المالي");
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
    setBusy(true);
    try {
      const { payment } = await recordSupplierPayment({
        supplierId,
        amount: paymentAmount,
        currency,
        paidAt,
        method,
        accountId: selectedAccount.id,
        notes: notes.trim() || undefined,
        allocations: rows
          .filter((row) => Number(row.amount) > 0)
          .map((row) => ({ invoiceId: row.invoiceId, amount: Number(row.amount) })),
        confirmDuplicate,
      });
      setDuplicateWarning(null);
      toast.success(
        `تم تسجيل الدفعة ${payment.reference} بمبلغ ${formatNumber(payment.amount)} ${getCurrencyShortLabel(payment.currency)}`
      );
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
      <DialogContent dir="rtl" className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-sm font-black">سداد فاتورة مشتريات / دفعة لمورد</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2 rounded-xl border border-border/60 bg-muted/20 px-3 py-2">
            <span className="text-[11px] font-black text-foreground">
              عملة الدفعة{" "}
              {isCurrencyLocked && (
                <span className="text-[10px] font-bold text-muted-foreground">(مطابقة للفاتورة)</span>
              )}
            </span>
            <CurrencySelector
              label=""
              dropdownTitle="اختر عملة الدفعة"
              value={currency}
              onChange={handleCurrencyChange}
              disabled={isCurrencyLocked}
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <label className="text-[11px] font-black text-foreground">
                المورد <span className="text-rose-500">*</span>
              </label>
              <button
                type="button"
                onClick={() => setQuickAddOpen((v) => !v)}
                className="inline-flex items-center gap-1 text-[10.5px] font-black text-primary hover:underline"
              >
                <UserPlus className="h-3 w-3" />
                <span>{quickAddOpen ? "إغلاق الإضافة" : "مورد جديد"}</span>
              </button>
            </div>
            <Select
              value={supplierId || "__none__"}
              onValueChange={(v) => {
                const next = v === "__none__" ? "" : v;
                setSupplierId(next);
                setRows([]);
                setDuplicateWarning(null);
              }}
            >
              <SelectTrigger className="h-10 rounded-xl text-xs font-bold bg-background text-right">
                <SelectValue placeholder="اختر المورد" />
              </SelectTrigger>
              <SelectContent dir="rtl">
                <SelectItem value="__none__">— اختر المورد —</SelectItem>
                {suppliers.map((supplier) => (
                  <SelectItem key={supplier.id} value={supplier.id}>
                    {supplier.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {quickAddOpen && (
              <div className="rounded-xl border border-primary/25 bg-primary/[0.04] p-2.5 flex items-center gap-2">
                <Input
                  value={quickSupplierName}
                  onChange={(e) => setQuickSupplierName(e.target.value)}
                  placeholder="اسم المورد *"
                  className="h-9 rounded-lg text-xs font-bold bg-background text-right flex-1"
                />
                <Button
                  type="button"
                  size="sm"
                  disabled={creatingSupplier || !quickSupplierName.trim()}
                  onClick={() => void handleQuickAddSupplier()}
                  className="h-9 rounded-lg text-[11px] font-black shrink-0"
                >
                  حفظ واختيار
                </Button>
              </div>
            )}

            {account && (
              <p className="text-[10px] font-bold text-muted-foreground">
                إجمالي الالتزام {formatNumber(account.totalObligations)} {currencyLabel} · المدفوع{" "}
                {formatNumber(account.totalPaid)} {currencyLabel} · المتبقي{" "}
                {formatNumber(account.outstanding)} {currencyLabel}
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <label className="text-[11px] font-black text-foreground">
                المبلغ ({currencyLabel}) <span className="text-rose-500">*</span>
              </label>
              <Input
                inputMode="decimal"
                value={amount}
                onChange={(e) => handleMainAmountChange(e.target.value)}
                className="h-10 rounded-xl text-xs font-bold bg-background text-center tabular-nums"
                placeholder="0"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[11px] font-black text-foreground">التاريخ</label>
              <Input
                type="date"
                value={paidAt}
                onChange={(e) => {
                  setPaidAt(e.target.value);
                  setDuplicateWarning(null);
                }}
                className="h-10 rounded-xl text-xs font-mono font-bold bg-background text-right"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <label className="text-[11px] font-black text-foreground">الطريقة</label>
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
            </div>
            <div className="space-y-1.5">
              <label className="text-[11px] font-black text-foreground">
                الحساب المخصوم منه <span className="text-rose-500">*</span>
              </label>
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
                  {selectableAccounts.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.name} ({getCurrencyShortLabel(item.currency)})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {noMatchingAccount && (
            <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-2.5 space-y-2 text-[11px] font-bold text-amber-800 dark:text-amber-300">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>
                  لا يوجد حساب مالي بعملة {currency} ({currencyLabel}). يرجى إضافة حساب مالي بهذه العملة من صفحة المالية أولاً.
                </span>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void handleProvisionAccount()}
                className="h-7 rounded-lg text-[10.5px] font-black border-amber-500/40"
              >
                تفعيل حساب {currencyLabel} تلقائياً
              </Button>
            </div>
          )}

          <SupplierAllocationSection
            openInvoices={openInvoices}
            rows={rows}
            setRows={setRows}
            onRowAmountChange={handleRowAmountChange}
            paymentAmount={paymentAmount}
            allocatedTotal={allocatedTotal}
            currencyLabel={currencyLabel}
            onAddRow={addRow}
            onAutoAllocate={autoAllocate}
          />

          <div className="space-y-1.5">
            <label className="text-[11px] font-black text-foreground">ملاحظات (اختياري)</label>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="رقم إيصال المورد أو ملاحظة…"
              className="h-10 rounded-xl text-xs font-bold bg-background text-right"
            />
          </div>

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
            تسجيل الدفعة
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default SupplierPaymentDialog;
