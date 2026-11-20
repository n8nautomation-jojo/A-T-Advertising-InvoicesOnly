import React, { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
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
import { getAllAccounts, getDefaultAccountId } from "@/lib/repositories/FinancialAccountRepository";
import { getAllSuppliers, type Supplier } from "@/lib/repositories/SupplierRepository";
import { createExpense, payExpense, EXPENSE_KIND_LABELS, type Expense, type ExpenseKind } from "@/lib/repositories/ExpenseRepository";
import { PAYMENT_METHOD_LABELS, type FinancialAccount, type PaymentMethod } from "@/lib/domain/finance";
import { formatNumber } from "@/lib/printCalculator";
import {
  CURRENCY_LIST,
  DEFAULT_CURRENCY,
  SUPPORTED_CURRENCIES,
  type AppCurrency,
} from "@/lib/currency/types";
import { sanitizePositiveDecimal } from "./shared/numericInput";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** عند تمرير مصروف: النافذة تسجّل سداداً بدل إنشاء مصروف جديد */
  settleExpense?: Expense | null;
  defaultCurrency?: AppCurrency;
  onSaved?: () => void;
}

/**
 * مصروف جديد (مباشر أو تشغيلي) أو سداد مصروف قائم.
 * التسجيل لا يعني الدفع، والسداد هو ما يحرّك النقد فعلاً (PRD §7.5).
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
  const [kind, setKind] = useState<ExpenseKind>("direct");
  const [currency, setCurrency] = useState<AppCurrency>(defaultCurrency);
  const [supplierId, setSupplierId] = useState<string | null>(null);
  const [beneficiary, setBeneficiary] = useState("");
  const [category, setCategory] = useState("");
  const [amount, setAmount] = useState("");
  const [expenseDate, setExpenseDate] = useState(() => getLocalIsoDate());
  const [evidenceRef, setEvidenceRef] = useState("");
  const [notes, setNotes] = useState("");
  const [accountId, setAccountId] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [busy, setBusy] = useState(false);

  const activeCurrency: AppCurrency = settleExpense?.currency ?? currency;
  const currencyLabel =
    activeCurrency === "SDG" ? "ج.س" : SUPPORTED_CURRENCIES[activeCurrency]?.symbol ?? activeCurrency;
  const matchingAccounts = settleExpense
    ? accounts.filter((a) => (a.currency ?? "SDG") === settleExpense.currency)
    : accounts;
  const selectableAccounts = matchingAccounts.length > 0 ? matchingAccounts : accounts;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
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
        const preferred = settleExpense
          ? accountList.filter((a) => (a.currency ?? "SDG") === settleExpense.currency)
          : accountList;
        const pool = preferred.length > 0 ? preferred : accountList;
        setAccountId((current) =>
          current && pool.some((a) => a.id === current) ? current : pool[0]?.id || ""
        );
      } catch (err) {
        if (!cancelled) {
          console.error("[ExpenseDialog] init failed:", err);
          toast.error("تعذّر تحميل الحسابات والموردين.");
        }
      }
    })();

    const today = getLocalIsoDate();
    if (settleExpense) {
      setAmount(String(settleExpense.amount));
      setCurrency(settleExpense.currency);
      setExpenseDate(today);
      setMethod("cash");
      setNotes("");
    } else {
      setKind("direct");
      setCurrency(defaultCurrency);
      setSupplierId(null);
      setBeneficiary("");
      setCategory("");
      setAmount("");
      setExpenseDate(today);
      setEvidenceRef("");
      setNotes("");
    }

    return () => {
      cancelled = true;
    };
  }, [open, settleExpense, defaultCurrency]);

  const handleSave = async () => {
    const value = Number(amount) || 0;
    if (!(value > 0)) {
      toast.error(isSettlement ? "مبلغ السداد يجب أن يكون أكبر من صفر" : "قيمة المصروف يجب أن تكون أكبر من صفر");
      return;
    }
    if (isSettlement && !accountId) {
      toast.error("يجب تحديد الحساب المالي");
      return;
    }

    setBusy(true);
    try {
      if (settleExpense) {
        const payment = await payExpense({
          expenseId: settleExpense.id,
          amount: value,
          currency: settleExpense.currency,
          paidAt: expenseDate || getLocalIsoDate(),
          method,
          accountId,
          notes: notes.trim() || undefined,
        });
        toast.success(`تم تسجيل السداد ${payment.reference} بمبلغ ${formatNumber(payment.amount)} ${currencyLabel}`);
      } else {
        const expense = await createExpense(
          {
            kind,
            supplierId,
            beneficiary: beneficiary.trim() || undefined,
            category: category.trim() || undefined,
            amount: value,
            currency,
            expenseDate: expenseDate || getLocalIsoDate(),
            evidenceRef: evidenceRef.trim() || undefined,
            notes: notes.trim() || undefined,
          },
          new Date().toISOString()
        );
        toast.success(
          `تم تسجيل ${EXPENSE_KIND_LABELS[expense.kind]} بمبلغ ${formatNumber(expense.amount)} ${currencyLabel} — لم يُسدَّد بعد`
        );
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
                  {EXPENSE_KIND_LABELS[settleExpense.kind]} · قيمة المصروف {formatNumber(settleExpense.amount)}{" "}
                  {currencyLabel} · {settleExpense.expenseDate}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <label className="text-[11px] font-black text-foreground">
                    مبلغ السداد <span className="text-rose-500">*</span>
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
                  <Select value={accountId || "__none__"} onValueChange={(v) => setAccountId(v === "__none__" ? "" : v)}>
                    <SelectTrigger className="h-10 rounded-xl text-xs font-bold bg-background text-right">
                      <SelectValue placeholder="اختر الحساب" />
                    </SelectTrigger>
                    <SelectContent dir="rtl">
                      <SelectItem value="__none__">— اختر الحساب —</SelectItem>
                      {selectableAccounts.map((item) => (
                        <SelectItem key={item.id} value={item.id}>
                          {item.name} ({!item.currency || item.currency === "SDG" ? "ج.س" : item.currency})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
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
                        <SelectItem value="direct">{EXPENSE_KIND_LABELS.direct}</SelectItem>
                        <SelectItem value="operating">{EXPENSE_KIND_LABELS.operating}</SelectItem>
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
                <p className="text-[10px] leading-snug text-muted-foreground">
                  التكلفة المباشرة تخص التنفيذ والإنتاج، والمصروف التشغيلي يخص المصروفات التشغيلية العامة للشركة — ولا يُخلطان في أي حساب.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <label className="text-[11px] font-black text-foreground">
                    المبلغ <span className="text-rose-500">*</span>
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

              <div className="space-y-1.5">
                <label className="text-[11px] font-black text-foreground">المستفيد</label>
                <Input
                  value={beneficiary}
                  onChange={(e) => setBeneficiary(e.target.value)}
                  placeholder="فريق التركيب، سائق، فني…"
                  className="h-10 rounded-xl text-xs font-bold bg-background text-right"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <label className="text-[11px] font-black text-foreground">التصنيف</label>
                  <Input
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    placeholder="تركيب، نقل، خدمات"
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
              <p className="rounded-xl bg-amber-500/10 p-2 text-[10px] leading-relaxed text-amber-700 dark:text-amber-300">
                تسجيل المصروف يثبت التكلفة ولا يعني دفعها. يُسجَّل خروج النقد عند تنفيذ السداد.
              </p>
            </>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} className="flex-1 h-10 rounded-xl text-xs font-bold">
            إلغاء
          </Button>
          <Button type="button" onClick={() => void handleSave()} disabled={busy} className="flex-1 h-10 rounded-xl text-xs font-bold">
            {busy && <Loader2 className="h-4 w-4 animate-spin me-1" />}
            {isSettlement ? "تسجيل السداد" : "حفظ المصروف"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ExpenseDialog;
