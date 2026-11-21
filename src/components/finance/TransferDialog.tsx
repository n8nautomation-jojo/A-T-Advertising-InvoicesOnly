import React, { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowLeftRight, Loader2 } from "lucide-react";
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
import { getAccountBalances } from "@/lib/repositories/FinancialAccountRepository";
import { recordTransfer } from "@/lib/repositories/PaymentRepository";
import { notifyFinanceUpdated } from "@/lib/financeStore";
import { getLocalIsoDate } from "@/lib/dateUtils";
import type { AccountBalanceReport } from "@/lib/domain/finance";
import { formatNumber } from "@/lib/printCalculator";
import { getCurrencyShortLabel } from "@/lib/currency/currencyFormat";
import { DEFAULT_CURRENCY, sanitizeCurrency } from "@/lib/currency/types";
import { sanitizePositiveDecimal } from "./shared/numericInput";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRecorded?: () => void;
}

/**
 * تحويل داخلي بين حسابين (PRD §10.1).
 * ينقل النقد ولا يُحتسب إيراداً ولا مصروفاً — لذلك لا يظهر في الربحية إطلاقاً.
 */
export function TransferDialog({ open, onOpenChange, onRecorded }: Props) {
  const [accounts, setAccounts] = useState<AccountBalanceReport[]>([]);
  const [fromAccountId, setFromAccountId] = useState("");
  const [toAccountId, setToAccountId] = useState("");
  const [amount, setAmount] = useState("");
  const [occurredAt, setOccurredAt] = useState(() => getLocalIsoDate());
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const fromAccountReport = useMemo(
    () => accounts.find((r) => r.account.id === fromAccountId) ?? null,
    [accounts, fromAccountId]
  );
  const fromCurrency = sanitizeCurrency(fromAccountReport?.account.currency, DEFAULT_CURRENCY);
  const fromCurrencyLabel = getCurrencyShortLabel(fromCurrency);

  const destinationAccounts = useMemo(
    () =>
      accounts.filter(
        (a) =>
          a.account.id !== fromAccountId &&
          sanitizeCurrency(a.account.currency, DEFAULT_CURRENCY) === fromCurrency
      ),
    [accounts, fromAccountId, fromCurrency]
  );

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      try {
        const reports = await getAccountBalances();
        if (cancelled) return;
        setAccounts(reports);
        const initialFrom =
          reports.find((r) => {
            const cur = sanitizeCurrency(r.account.currency, DEFAULT_CURRENCY);
            return reports.some(
              (other) =>
                other.account.id !== r.account.id &&
                sanitizeCurrency(other.account.currency, DEFAULT_CURRENCY) === cur
            );
          }) ?? reports[0];
        const initialFromId = initialFrom?.account.id ?? "";
        const initialCur = sanitizeCurrency(initialFrom?.account.currency, DEFAULT_CURRENCY);
        const initialTo = reports.find(
          (r) =>
            r.account.id !== initialFromId &&
            sanitizeCurrency(r.account.currency, DEFAULT_CURRENCY) === initialCur
        );
        setFromAccountId(initialFromId);
        setToAccountId(initialTo?.account.id ?? "");
        setAmount("");
        setNotes("");
        setOccurredAt(getLocalIsoDate());
      } catch (err) {
        if (!cancelled) {
          console.error("[TransferDialog] init failed:", err);
          toast.error("تعذّر تحميل الحسابات المالية.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setToAccountId((current) =>
      current && destinationAccounts.some((r) => r.account.id === current)
        ? current
        : destinationAccounts[0]?.account.id ?? ""
    );
  }, [open, fromAccountId, destinationAccounts]);

  const handleSave = async () => {
    const value = Number(amount) || 0;
    if (!fromAccountId || !toAccountId) {
      toast.error("يجب تحديد الحساب المحوَّل منه والحساب المحوَّل إليه");
      return;
    }
    if (fromAccountId === toAccountId) {
      toast.error("يجب اختيار حسابين مختلفين لإجراء التحويل");
      return;
    }
    if (!destinationAccounts.some((r) => r.account.id === toAccountId)) {
      toast.error("يلزم وجود حسابين على الأقل بنفس العملة للتحويل");
      return;
    }
    if (!(value > 0)) {
      toast.error("مبلغ التحويل يجب أن يكون أكبر من صفر");
      return;
    }
    setBusy(true);
    try {
      await recordTransfer({
        fromAccountId,
        toAccountId,
        amount: value,
        currency: fromCurrency,
        occurredAt,
        notes: notes.trim() || undefined,
      });
      toast.success("تم تسجيل التحويل الداخلي — لا يُحتسب إيراداً ولا مصروفاً");
      await notifyFinanceUpdated();
      onRecorded?.();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "تعذّر تنفيذ التحويل.");
    } finally {
      setBusy(false);
    }
  };

  const needsTwoAccounts = accounts.length < 2;
  const noSameCurrencyDestination =
    !needsTwoAccounts && Boolean(fromAccountId) && destinationAccounts.length === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm font-black">
            <ArrowLeftRight className="h-4 w-4 text-primary" />
            تحويل بين حسابين
          </DialogTitle>
        </DialogHeader>

        {needsTwoAccounts ? (
          <p className="rounded-xl bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">
            تحتاج حسابين ماليين على الأقل لإجراء تحويل. أضف حساباً بنكياً أو نقدياً آخر من صفحة المالية.
          </p>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-[11px] font-black text-foreground">من حساب</label>
              <Select value={fromAccountId} onValueChange={setFromAccountId}>
                <SelectTrigger className="h-10 rounded-xl text-xs font-bold bg-background text-right">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent dir="rtl">
                  {accounts.map((report) => (
                    <SelectItem key={report.account.id} value={report.account.id}>
                      {report.account.name} ({formatNumber(report.balance)}{" "}
                      {getCurrencyShortLabel(report.account.currency)})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] font-black text-foreground">إلى حساب</label>
              <Select
                value={toAccountId || "__none__"}
                onValueChange={(v) => setToAccountId(v === "__none__" ? "" : v)}
                disabled={noSameCurrencyDestination}
              >
                <SelectTrigger className="h-10 rounded-xl text-xs font-bold bg-background text-right">
                  <SelectValue placeholder="اختر الحساب المستلم" />
                </SelectTrigger>
                <SelectContent dir="rtl">
                  <SelectItem value="__none__">— اختر الحساب —</SelectItem>
                  {destinationAccounts.map((report) => (
                    <SelectItem key={report.account.id} value={report.account.id}>
                      {report.account.name} ({formatNumber(report.balance)}{" "}
                      {getCurrencyShortLabel(report.account.currency)})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {noSameCurrencyDestination && (
              <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-2.5 flex items-start gap-2 text-[11px] font-bold text-amber-800 dark:text-amber-300">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>
                  يلزم وجود حسابين على الأقل بنفس العملة للتحويل ({fromCurrency} - {fromCurrencyLabel}).
                </span>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <label className="text-[11px] font-black text-foreground">
                  المبلغ ({fromCurrencyLabel})
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
                  value={occurredAt}
                  onChange={(e) => setOccurredAt(e.target.value)}
                  className="h-10 rounded-xl text-xs font-mono font-bold bg-background text-right"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] font-black text-foreground">ملاحظات</label>
              <Input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="h-10 rounded-xl text-xs font-bold bg-background text-right"
              />
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} className="flex-1 h-10 rounded-xl text-xs font-bold">
            إلغاء
          </Button>
          <Button
            type="button"
            onClick={() => void handleSave()}
            disabled={busy || needsTwoAccounts || noSameCurrencyDestination || !toAccountId}
            className="flex-1 h-10 rounded-xl text-xs font-bold"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin me-1" />}
            تنفيذ التحويل
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default TransferDialog;
