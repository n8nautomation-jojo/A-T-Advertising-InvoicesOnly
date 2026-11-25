import React, { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Wallet } from "lucide-react";
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
import { notifyFinanceUpdated } from "@/lib/financeStore";
import { getLocalIsoDate } from "@/lib/dateUtils";
import {
  ensureAccountForCurrency,
  getAllAccounts,
  getDefaultAccountId,
} from "@/lib/repositories/FinancialAccountRepository";
import { getAllSuppliers, type Supplier } from "@/lib/repositories/SupplierRepository";
import {
  createExpense,
  payExpense,
  EXPENSE_KIND_LABELS,
  type Expense,
  type ExpenseKind,
  type ExpenseWithSettlement,
} from "@/lib/repositories/ExpenseRepository";
import {
  getPreferredAccountForCurrency,
  PAYMENT_METHOD_LABELS,
  type FinancialAccount,
  type PaymentMethod,
} from "@/lib/domain/finance";
import { formatNumber } from "@/lib/printCalculator";
import { getCurrencyShortLabel } from "@/lib/currency/currencyFormat";
import {
  CURRENCY_LIST,
  DEFAULT_CURRENCY,
  sanitizeCurrency,
  type AppCurrency,
} from "@/lib/currency/types";
import { sanitizePositiveDecimal } from "./shared/numericInput";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** عند تمرير مصروف: النافذة تسجّل سداداً بدل إنشاء مصروف جديد */
  settleExpense?: (Expense | ExpenseWithSettlement) | null;
  defaultCurrency?: AppCurrency;
  onSaved?: () => void;
}

/**
 * مصروف جديد (مباشر أو تشغيلي) مع خصم فوري اختياري من الحساب البنكي، أو سداد مصروف قائم.
 */
export function ExpenseDialog({
  open,
  onOpenChange,
  settleExpense,
  defaultCurrency = DEFAULT_CURRENCY,
  onSaved,
}: Props) {
  const isSettlement = Boolean(settleExpense);

  const [accounts, setAccounts] = useState<FinancialAccount[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [kind, setKind] = useState<ExpenseKind>("operating");
  const [currency, setCurrency] = useState<AppCurrency>(defaultCurrency);
  const [supplierId, setSupplierId] = useState<string | null>(null);
  const [beneficiary, setBeneficiary] = useState("");
  const [category, setCategory] = useState("");
  const [amount, setAmount] = useState("");
  const [expenseDate, setExpenseDate] = useState(() => getLocalIsoDate());
  const [evidenceRef, setEvidenceRef] = useState("");
  const [notes, setNotes] = useState("");
  const [accountId, setAccountId] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("bank_transfer");
  const [deductNow, setDeductNow] = useState(true);
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [busy, setBusy] = useState(false);

  const activeCurrency: AppCurrency = sanitizeCurrency(
    settleExpense?.currency ?? currency,
    DEFAULT_CURRENCY
  );
  const currencyLabel = getCurrencyShortLabel(activeCurrency);
  const selectableAccounts = useMemo(
    () =>
      accounts.filter(
        (a) => sanitizeCurrency(a.currency, DEFAULT_CURRENCY) === activeCurrency
      ),
    [accounts, activeCurrency]
  );
  const requiresAccount = isSettlement || deductNow;
  const noMatchingAccount = requiresAccount && !loadingAccounts && selectableAccounts.length === 0;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoadingAccounts(true);
    void (async () => {
      try {
        let [accountList, supplierList] = await Promise.all([getAllAccounts(), getAllSuppliers()]);
        if (accountList.length === 0) {
          await getDefaultAccountId();
          accountList = await getAllAccounts();
        }
        if (cancelled) return;
        setAccounts(accountList);
        setSuppliers(supplierList);
        const targetCur = sanitizeCurrency(
          settleExpense?.currency ?? defaultCurrency,
          DEFAULT_CURRENCY
        );
        const preferredAcc = getPreferredAccountForCurrency(accountList, targetCur);
        const matching = accountList.filter(
          (a) => sanitizeCurrency(a.currency, DEFAULT_CURRENCY) === targetCur
        );
        setAccountId((current) =>
          current && matching.some((a) => a.id === current)
            ? current
            : preferredAcc?.id ?? matching[0]?.id ?? ""
        );
      } catch (err) {
        if (!cancelled) {
          console.error("[ExpenseDialog] init failed:", err);
          toast.error("تعذّر تحميل الحسابات والموردين.");
        }
      } finally {
        if (!cancelled) setLoadingAccounts(false);
      }
    })();

    const today = getLocalIsoDate();
    if (settleExpense) {
      const remainingToPay =
        (settleExpense as ExpenseWithSettlement).settlement?.outstanding ?? settleExpense.amount;
      setAmount(String(remainingToPay));
      setCurrency(sanitizeCurrency(settleExpense.currency, DEFAULT_CURRENCY));
      setExpenseDate(today);
      setMethod("bank_transfer");
      setNotes("");
    } else {
      setKind("operating");
      setCurrency(sanitizeCurrency(defaultCurrency, DEFAULT_CURRENCY));
      setSupplierId(null);
      setBeneficiary("");
      setCategory("");
      setAmount("");
      setExpenseDate(today);
      setEvidenceRef("");
      setNotes("");
      setMethod("bank_transfer");
      setDeductNow(true);
    }

    return () => {
      cancelled = true;
    };
  }, [open, settleExpense, defaultCurrency]);

  useEffect(() => {
    if (!open || loadingAccounts) return;
    const preferredAcc = getPreferredAccountForCurrency(accounts, activeCurrency);
    setAccountId((current) =>
      current && selectableAccounts.some((a) => a.id === current)
        ? current
        : preferredAcc?.id ?? selectableAccounts[0]?.id ?? ""
    );
  }, [open, loadingAccounts, selectableAccounts, accounts, activeCurrency]);

  const handleProvisionAccount = async () => {
    try {
      const acc = await ensureAccountForCurrency(activeCurrency);
      const updated = await getAllAccounts();
      setAccounts(updated);
      setAccountId(acc.id);
      toast.success(`تم تفعيل الحساب «${acc.name}» بعملة ${currencyLabel}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "تعذّر تفعيل الحساب.");
    }
  };

  const handleSave = async () => {
    const value = Number(amount) || 0;
    if (!(value > 0)) {
      toast.error(
        isSettlement ? "مبلغ السداد يجب أن يكون أكبر من صفر" : "قيمة المصروف يجب أن تكون أكبر من صفر"
      );
      return;
    }
    if (requiresAccount && (!accountId || !selectableAccounts.some((a) => a.id === accountId))) {
      toast.error(`يجب تحديد حساب مالي بعملة ${activeCurrency} (${currencyLabel})`);
      return;
    }

    setBusy(true);
    try {
      const effectiveDate = expenseDate || getLocalIsoDate();
      if (settleExpense) {
        const payment = await payExpense({
          expenseId: settleExpense.id,
          amount: value,
          currency: settleExpense.currency,
          paidAt: effectiveDate,
          method,
          accountId,
          notes: notes.trim() || undefined,
        });
        toast.success(
          `تم تسجيل السداد ${payment.reference} بمبلغ ${formatNumber(payment.amount)} ${currencyLabel}`
        );
      } else {
        const nowIso = new Date().toISOString();
        const expense = await createExpense(
          {
            kind,
            supplierId,
            beneficiary: beneficiary.trim() || undefined,
            category: category.trim() || undefined,
            amount: value,
            currency,
            expenseDate: effectiveDate,
            evidenceRef: evidenceRef.trim() || undefined,
            notes: notes.trim() || undefined,
          },
          nowIso
        );

        if (deductNow && accountId) {
          await payExpense(
            {
              expenseId: expense.id,
              amount: value,
              currency,
              paidAt: effectiveDate,
              method,
              accountId,
              notes: notes.trim() || undefined,
            },
            nowIso
          );
          toast.success(
            `تم تسجيل وسداد ${EXPENSE_KIND_LABELS[expense.kind]} بمبلغ ${formatNumber(expense.amount)} ${currencyLabel} وخصمه من الرصيد`
          );
        } else {
          toast.success(
            `تم تسجيل ${EXPENSE_KIND_LABELS[expense.kind]} بمبلغ ${formatNumber(expense.amount)} ${currencyLabel} — لم يُسدَّد بعد`
          );
        }
      }
      await notifyFinanceUpdated();
      onSaved?.();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "تعذّر حفظ المصروف.");
    } finally {
      setBusy(false);
    }
  };

  const settleOutstanding = settleExpense
    ? (settleExpense as ExpenseWithSettlement).settlement?.outstanding ?? settleExpense.amount
    : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-sm font-black">
            {isSettlement ? "سداد مصروف" : "مصروف جديد"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {isSettlement && settleExpense ? (
            <>
              <div className="rounded-2xl border border-border/60 bg-muted/20 p-3 text-xs space-y-1">
                <p className="font-black text-foreground">
                  {settleExpense.beneficiary || settleExpense.category || "مصروف"}
                </p>
                <p className="text-muted-foreground">
                  {EXPENSE_KIND_LABELS[settleExpense.kind]} · الإجمالي{" "}
                  {formatNumber(settleExpense.amount)} {currencyLabel} · المتبقي للسداد{" "}
                  <strong className="text-foreground">
                    {formatNumber(settleOutstanding)} {currencyLabel}
                  </strong>
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <label className="text-[11px] font-black text-foreground">
                    مبلغ السداد ({currencyLabel}) <span className="text-rose-500">*</span>
                  </label>
                  <Input
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => setAmount(sanitizePositiveDecimal(e.target.value))}
                    className="h-10 rounded-xl text-xs font-bold bg-background text-center tabular-nums"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] font-black text-foreground">تاريخ السداد</label>
                  <Input
                    type="date"
                    value={expenseDate}
                    onChange={(e) => setExpenseDate(e.target.value)}
                    className="h-10 rounded-xl text-xs font-mono font-bold bg-background text-right"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <label className="text-[11px] font-black text-foreground">الطريقة</label>
                  <Select value={method} onValueChange={(v) => setMethod(v as PaymentMethod)}>
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
                    الحساب المالي <span className="text-rose-500">*</span>
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
                      لا يوجد حساب مالي بعملة {activeCurrency} ({currencyLabel}).
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
              <div className="space-y-1.5">
                <label className="text-[11px] font-black text-foreground">ملاحظات (اختياري)</label>
                <Input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="رقم سند الصرف أو ملاحظة…"
                  className="h-10 rounded-xl text-xs font-bold bg-background text-right"
                />
              </div>
            </>
          ) : (
            <>
              <div className="space-y-1.5">
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-black text-foreground">نوع المصروف</label>
                    <Select value={kind} onValueChange={(v) => setKind(v as ExpenseKind)}>
                      <SelectTrigger className="h-10 rounded-xl text-xs font-bold bg-background text-right">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent dir="rtl">
                        <SelectItem value="operating">{EXPENSE_KIND_LABELS.operating}</SelectItem>
                        <SelectItem value="direct">{EXPENSE_KIND_LABELS.direct}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-black text-foreground">العملة</label>
                    <Select value={currency} onValueChange={(v) => setCurrency(v as AppCurrency)}>
                      <SelectTrigger className="h-10 rounded-xl text-xs font-bold bg-background text-right">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent dir="rtl">
                        {CURRENCY_LIST.map((cur) => (
                          <SelectItem key={cur.code} value={cur.code}>
                            {cur.flag} {cur.code} ({cur.nameAr})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <label className="text-[11px] font-black text-foreground">
                    المبلغ ({currencyLabel}) <span className="text-rose-500">*</span>
                  </label>
                  <Input
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => setAmount(sanitizePositiveDecimal(e.target.value))}
                    className="h-10 rounded-xl text-xs font-bold bg-background text-center tabular-nums"
                    placeholder="0"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] font-black text-foreground">التاريخ</label>
                  <Input
                    type="date"
                    value={expenseDate}
                    onChange={(e) => setExpenseDate(e.target.value)}
                    className="h-10 rounded-xl text-xs font-mono font-bold bg-background text-right"
                  />
                </div>
              </div>

              <div className="rounded-xl border border-border/70 bg-muted/20 p-2.5 space-y-2">
                <button
                  type="button"
                  onClick={() => setDeductNow((v) => !v)}
                  className="w-full flex items-center justify-between gap-2 text-right"
                >
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-black text-foreground">
                    <Wallet className="h-3.5 w-3.5 text-rose-600" />
                    خصم فوري من رصيد الحساب البنكي / الخزينة
                  </span>
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-black transition-colors ${
                      deductNow
                        ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {deductNow && <CheckCircle2 className="h-3 w-3" />}
                    {deductNow ? "مفعّل (خصم فوري)" : "آجل (بدون خصم الآن)"}
                  </span>
                </button>

                {deductNow && (
                  <div className="grid grid-cols-2 gap-2 pt-1 border-t border-border/50">
                    <div className="space-y-1">
                      <label className="text-[10px] font-black text-muted-foreground">طريقة الصرف</label>
                      <Select value={method} onValueChange={(v) => setMethod(v as PaymentMethod)}>
                        <SelectTrigger className="h-9 rounded-lg text-xs font-bold bg-background text-right">
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
                    <div className="space-y-1">
                      <label className="text-[10px] font-black text-muted-foreground">الحساب المخصوم منه</label>
                      <Select
                        value={accountId || "__none__"}
                        onValueChange={(v) => setAccountId(v === "__none__" ? "" : v)}
                        disabled={noMatchingAccount}
                      >
                        <SelectTrigger className="h-9 rounded-lg text-xs font-bold bg-background text-right">
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
                )}

                {noMatchingAccount && (
                  <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 flex items-center justify-between gap-2 text-[10.5px] font-bold text-amber-800 dark:text-amber-300">
                    <span>لا يوجد حساب مالي بعملة {activeCurrency} ({currencyLabel}).</span>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => void handleProvisionAccount()}
                      className="h-7 rounded-lg text-[10px] font-black border-amber-500/40 shrink-0"
                    >
                      تفعيل الحساب
                    </Button>
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-black text-foreground">المستفيد / جهة الصرف</label>
                <Input
                  value={beneficiary}
                  onChange={(e) => setBeneficiary(e.target.value)}
                  placeholder="إيجار، كهرباء، وقود، عمولة، سائق…"
                  className="h-10 rounded-xl text-xs font-bold bg-background text-right"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <label className="text-[11px] font-black text-foreground">التصنيف</label>
                  <Input
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    placeholder="تشغيل، تركيب، نقل، خدمات"
                    className="h-10 rounded-xl text-xs font-bold bg-background text-right"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] font-black text-foreground">المورد (اختياري)</label>
                  <Select value={supplierId ?? "__none__"} onValueChange={(v) => setSupplierId(v === "__none__" ? null : v)}>
                    <SelectTrigger className="h-10 rounded-xl text-xs font-bold bg-background text-right">
                      <SelectValue placeholder="بلا مورد" />
                    </SelectTrigger>
                    <SelectContent dir="rtl">
                      <SelectItem value="__none__">بلا مورد</SelectItem>
                      {suppliers.map((supplier) => (
                        <SelectItem key={supplier.id} value={supplier.id}>
                          {supplier.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <label className="text-[11px] font-black text-foreground">مرجع أو إثبات</label>
                  <Input
                    value={evidenceRef}
                    onChange={(e) => setEvidenceRef(e.target.value)}
                    placeholder="رقم إيصال أو إثبات"
                    className="h-10 rounded-xl text-xs font-bold bg-background text-right"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] font-black text-foreground">ملاحظات (اختياري)</label>
                  <Input
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="تفاصيل إضافية…"
                    className="h-10 rounded-xl text-xs font-bold bg-background text-right"
                  />
                </div>
              </div>
            </>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} className="flex-1 h-10 rounded-xl text-xs font-bold">
            إلغاء
          </Button>
          <Button
            type="button"
            onClick={() => void handleSave()}
            disabled={busy || noMatchingAccount || (requiresAccount && loadingAccounts)}
            className="flex-1 h-10 rounded-xl text-xs font-bold"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin me-1" />}
            {isSettlement ? "تسجيل السداد" : deductNow ? "حفظ وخصم من الرصيد" : "حفظ كمستحق آجل"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ExpenseDialog;
