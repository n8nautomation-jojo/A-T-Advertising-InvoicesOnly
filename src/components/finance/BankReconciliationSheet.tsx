import React, { useEffect, useMemo, useState } from "react";
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Building2,
  CheckCircle2,
  Loader2,
  Scale,
  Settings2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { getLocalIsoDate } from "@/lib/dateUtils";
import { notifyFinanceUpdated } from "@/lib/financeStore";
import { formatNumber } from "@/lib/printCalculator";
import { getCurrencyDisplayName, getCurrencyShortLabel } from "@/lib/currency/currencyFormat";
import type { AppCurrency } from "@/lib/currency/types";
import type { FinancialAccount } from "@/lib/domain/finance";
import {
  ensureAccountForCurrency,
  reconcileBankAccountBalance,
  recordExternalBankMovement,
  updateAccount,
} from "@/lib/repositories/FinancialAccountRepository";
import { sanitizePositiveDecimal } from "./shared/numericInput";

interface BankReconciliationSheetProps {
  currency: AppCurrency;
  account: FinancialAccount;
  currentBalance: number;
  onBack?: () => void;
  onCompleted: () => void;
  hideInlineBack?: boolean;
}

type ModeTab = "reconcile" | "external" | "details";

export function BankReconciliationSheet({
  currency,
  account,
  currentBalance,
  onBack,
  onCompleted,
  hideInlineBack = false,
}: BankReconciliationSheetProps) {
  const [mode, setMode] = useState<ModeTab>("reconcile");
  const [actualInput, setActualInput] = useState(() => String(currentBalance > 0 ? currentBalance : ""));
  const [occurredAt, setOccurredAt] = useState(() => getLocalIsoDate());
  const [notes, setNotes] = useState("");

  const [extDirection, setExtDirection] = useState<"in" | "out">("in");
  const [extAmount, setExtAmount] = useState("");
  const [extNotes, setExtNotes] = useState("");

  const [accName, setAccName] = useState(account.name);
  const [accNumber, setAccNumber] = useState(account.accountNumber ?? "");
  const [busy, setBusy] = useState(false);

  const curLabel = getCurrencyShortLabel(currency);
  const curDisplay = getCurrencyDisplayName(currency, "ar");

  useEffect(() => {
    setAccName(account.name);
    setAccNumber(account.accountNumber ?? "");
    setActualInput(currentBalance > 0 ? String(currentBalance) : "");
  }, [account, currentBalance]);

  const parsedActual = actualInput === "" ? null : Number(actualInput);
  const delta = useMemo(() => {
    if (parsedActual === null || !Number.isFinite(parsedActual)) return null;
    return Math.round((parsedActual - currentBalance) * 100) / 100;
  }, [parsedActual, currentBalance]);

  const handleSaveReconciliation = async () => {
    if (parsedActual === null || !Number.isFinite(parsedActual) || parsedActual < 0) {
      toast.error("يرجى إدخال الرصيد البنكي الفعلي الصحيح (صفر أو أكثر)");
      return;
    }
    setBusy(true);
    try {
      const ensured = await ensureAccountForCurrency(currency);
      const res = await reconcileBankAccountBalance({
        accountId: ensured.id,
        actualBalance: parsedActual,
        occurredAt,
        notes: notes.trim() || undefined,
      });
      await notifyFinanceUpdated();
      if (!res.adjusted) {
        toast.info("الرصيد في التطبيق مطابق بالفعل للرصيد البنكي الفعلي");
      } else if (res.sourceType === "opening_balance") {
        toast.success(
          `تم تأسيس الرصيد البنكي الافتتاحي بقيمة ${formatNumber(res.newBalance)} ${curLabel}`
        );
      } else {
        const sign = res.delta > 0 ? "+" : "";
        toast.success(
          `تمت مطابقة الحساب البنكي (${sign}${formatNumber(res.delta)} ${curLabel}) — الرصيد الجديد ${formatNumber(res.newBalance)} ${curLabel}`
        );
      }
      onCompleted();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "تعذّر حفظ مطابقة الرصيد.");
    } finally {
      setBusy(false);
    }
  };

  const handleSaveExternal = async () => {
    const val = Number(extAmount) || 0;
    if (!(val > 0)) {
      toast.error("أدخل قيمة الحركة البنكية الخارجية");
      return;
    }
    setBusy(true);
    try {
      const ensured = await ensureAccountForCurrency(currency);
      const res = await recordExternalBankMovement({
        accountId: ensured.id,
        direction: extDirection,
        amount: val,
        occurredAt,
        notes: extNotes.trim() || undefined,
      });
      await notifyFinanceUpdated();
      toast.success(
        extDirection === "in"
          ? `تم تسجيل إيداع خارجي (+${formatNumber(val)} ${curLabel}) — الرصيد الآن ${formatNumber(res.newBalance)} ${curLabel}`
          : `تم تسجيل خصم خارجي (-${formatNumber(val)} ${curLabel}) — الرصيد الآن ${formatNumber(res.newBalance)} ${curLabel}`
      );
      onCompleted();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "تعذّر تسجيل الحركة الخارجية.");
    } finally {
      setBusy(false);
    }
  };

  const handleSaveDetails = async () => {
    if (!accName.trim()) {
      toast.error("اسم الحساب مطلوب");
      return;
    }
    setBusy(true);
    try {
      const ensured = await ensureAccountForCurrency(currency);
      await updateAccount(ensured.id, {
        name: accName.trim(),
        accountNumber: accNumber.trim(),
      });
      await notifyFinanceUpdated();
      toast.success("تم تحديث بيانات الحساب البنكي بنجاح");
      onCompleted();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "تعذّر تحديث بيانات الحساب.");
    } finally {
      setBusy(false);
    }
  };

  const cleanCurrentBalance = Math.abs(currentBalance) < 0.005 ? 0 : currentBalance;

  return (
    <div className="space-y-3.5 w-full max-w-full min-w-0" dir="rtl">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-3">
        <div className="min-w-0">
          <h3 className="text-sm sm:text-base font-black text-foreground break-words">
            مطابقة وإدارة حساب {curDisplay}
          </h3>
          <p className="text-[11px] font-bold text-muted-foreground mt-0.5 break-words">
            <span>الرصيد الدفتري الحالي بالتطبيق: </span>
            <span className="font-mono font-black text-emerald-600 dark:text-emerald-400">
              <bdi dir="ltr">{formatNumber(cleanCurrentBalance)}</bdi> {curLabel}
            </span>
          </p>
        </div>
        {!hideInlineBack && onBack && (
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1 rounded-lg border border-[#B91C1C]/40 bg-white dark:bg-card px-3 py-1.5 text-xs font-black text-[#B91C1C] shadow-2xs hover:bg-rose-50 dark:hover:bg-rose-950/30 cursor-pointer"
          >
            <ArrowRight className="h-3.5 w-3.5 shrink-0" />
            <span>رجوع</span>
          </button>
        )}
      </div>

      {/* Mode Switcher (wraps cleanly on narrow phones) */}
      <div className="flex flex-wrap gap-1.5 rounded-xl bg-muted/50 p-1 w-full min-w-0">
        <button
          type="button"
          onClick={() => setMode("reconcile")}
          className={`flex-1 min-w-[96px] flex items-center justify-center gap-1 rounded-lg py-2 px-2 text-[11px] font-black transition-all cursor-pointer ${
            mode === "reconcile"
              ? "bg-card text-foreground shadow-xs"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Scale className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
          <span>مطابقة الرصيد</span>
        </button>
        <button
          type="button"
          onClick={() => setMode("external")}
          className={`flex-1 min-w-[116px] flex items-center justify-center gap-1 rounded-lg py-2 px-2 text-[11px] font-black transition-all cursor-pointer ${
            mode === "external"
              ? "bg-card text-foreground shadow-xs"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <ArrowDownLeft className="h-3.5 w-3.5 text-primary shrink-0" />
          <span>إيداع / سحب خارجي</span>
        </button>
        <button
          type="button"
          onClick={() => setMode("details")}
          className={`flex-1 min-w-[96px] flex items-center justify-center gap-1 rounded-lg py-2 px-2 text-[11px] font-black transition-all cursor-pointer ${
            mode === "details"
              ? "bg-card text-foreground shadow-xs"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Settings2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span>رقم الحساب</span>
        </button>
      </div>

      {mode === "reconcile" && (
        <div className="rounded-2xl border border-border/70 bg-card p-3.5 space-y-3">
          <div className="rounded-xl bg-primary/[0.05] border border-primary/15 p-2.5 text-[11px] leading-relaxed font-medium text-muted-foreground">
            أدخل <strong className="text-foreground">الرصيد الفعلي الموجود في حسابك بالبنك الآن</strong>.
            سيحسب النظام الفارق محاسبياً تلقائياً ويسجله في كشف الحساب دون خلطه مع مبيعات الفواتير.
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div className="space-y-1.5">
              <label className="text-[11px] font-black text-foreground">
                الرصيد الفعلي في البنك الآن ({curLabel}) *
              </label>
              <Input
                inputMode="decimal"
                data-testid={`reconcile-actual-input-${currency}`}
                value={actualInput}
                onChange={(e) => setActualInput(sanitizePositiveDecimal(e.target.value))}
                placeholder="مثال: 1200"
                className="h-11 rounded-xl text-sm font-mono font-black text-center tabular-nums bg-background"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[11px] font-black text-foreground">تاريخ المطابقة</label>
              <Input
                type="date"
                value={occurredAt}
                onChange={(e) => setOccurredAt(e.target.value)}
                className="h-11 rounded-xl text-xs font-mono font-bold bg-background text-right"
              />
            </div>
          </div>

          {delta !== null && (
            <div
              className={`rounded-xl border p-2.5 text-xs font-bold ${
                Math.abs(delta) < 0.005
                  ? "border-border bg-muted/30 text-muted-foreground"
                  : delta > 0
                  ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300"
                  : "border-rose-500/35 bg-rose-500/10 text-rose-800 dark:text-rose-300"
              }`}
            >
              {Math.abs(delta) < 0.005 ? (
                <span>✓ الرصيد البنكي الفعلي مطابق تماماً لرصيد التطبيق ({formatNumber(currentBalance)} {curLabel}).</span>
              ) : currentBalance === 0 && delta > 0 ? (
                <span>
                  سيتم اعتماد <strong>+{formatNumber(delta)} {curLabel}</strong> كرصيد بنكي افتتاحي أساسي، ومن بعده ستُخصم المشتريات والمصروفات وتُضاف التحصيلات آلياً.
                </span>
              ) : delta > 0 ? (
                <span>
                  فارق موجب (<strong>+{formatNumber(delta)} {curLabel}</strong>): سيتم تسجيل قيد تغذية / تحويل خارجي وارد باللون الأخضر ليصبح الرصيد <strong>{formatNumber(parsedActual ?? 0)} {curLabel}</strong>.
                </span>
              ) : (
                <span>
                  فارق سالب (<strong>{formatNumber(delta)} {curLabel}</strong>): سيتم تسجيل قيد خصم / عمولات أو مصروف خارجي باللون الأحمر ليصبح الرصيد <strong>{formatNumber(parsedActual ?? 0)} {curLabel}</strong>.
                </span>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-[11px] font-black text-foreground">بيان / سبب التحديث (اختياري)</label>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="مثال: رصيد افتتاحي، تحويل خارجي وارد، عمولات بنكية…"
              className="h-10 rounded-xl text-xs font-bold bg-background text-right"
            />
          </div>

          <Button
            type="button"
            disabled={busy || parsedActual === null}
            onClick={() => void handleSaveReconciliation()}
            data-testid={`reconcile-submit-btn-${currency}`}
            className="w-full h-10 rounded-xl text-xs font-black gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            <span>اعتماد وتحديث الرصيد البنكي</span>
          </Button>
        </div>
      )}

      {mode === "external" && (
        <div className="rounded-2xl border border-border/70 bg-card p-3.5 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setExtDirection("in")}
              className={`flex items-center justify-center gap-1.5 rounded-xl border py-2.5 text-xs font-black transition-all ${
                extDirection === "in"
                  ? "border-emerald-600 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                  : "border-border bg-background text-muted-foreground"
              }`}
            >
              <ArrowDownLeft className="h-4 w-4" />
              <span>+ إيداع خارجي وارد</span>
            </button>
            <button
              type="button"
              onClick={() => setExtDirection("out")}
              className={`flex items-center justify-center gap-1.5 rounded-xl border py-2.5 text-xs font-black transition-all ${
                extDirection === "out"
                  ? "border-rose-600 bg-rose-500/15 text-rose-700 dark:text-rose-300"
                  : "border-border bg-background text-muted-foreground"
              }`}
            >
              <ArrowUpRight className="h-4 w-4" />
              <span>- سحب / عمولة بنكية</span>
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <label className="text-[11px] font-black text-foreground">المبلغ ({curLabel}) *</label>
              <Input
                inputMode="decimal"
                value={extAmount}
                onChange={(e) => setExtAmount(sanitizePositiveDecimal(e.target.value))}
                placeholder="0"
                className="h-10 rounded-xl text-sm font-mono font-black text-center tabular-nums bg-background"
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
            <label className="text-[11px] font-black text-foreground">البيان / التفاصيل</label>
            <Input
              value={extNotes}
              onChange={(e) => setExtNotes(e.target.value)}
              placeholder={
                extDirection === "in"
                  ? "تحويل خارجي من طرف آخر خارج الفواتير…"
                  : "عمولة تحويل، دمغة بنكك، أو سحب شخصي…"
              }
              className="h-10 rounded-xl text-xs font-bold bg-background text-right"
            />
          </div>

          <Button
            type="button"
            disabled={busy || !(Number(extAmount) > 0)}
            onClick={() => void handleSaveExternal()}
            className={`w-full h-10 rounded-xl text-xs font-black text-white ${
              extDirection === "in"
                ? "bg-emerald-600 hover:bg-emerald-700"
                : "bg-rose-600 hover:bg-rose-700"
            }`}
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin me-1" />}
            {extDirection === "in" ? "تسجيل الإيداع الخارجي في الكشف" : "تسجيل الخصم الخارجي في الكشف"}
          </Button>
        </div>
      )}

      {mode === "details" && (
        <div className="rounded-2xl border border-border/70 bg-card p-3.5 space-y-3">
          <div className="space-y-1.5">
            <label className="text-[11px] font-black text-foreground">اسم الحساب البنكي / الخزينة</label>
            <Input
              value={accName}
              onChange={(e) => setAccName(e.target.value)}
              placeholder="مثال: حساب توفير بنك الخرطوم"
              className="h-10 rounded-xl text-xs font-bold bg-background text-right"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-[11px] font-black text-foreground">رقم الحساب البنكي / IBAN</label>
            <Input
              value={accNumber}
              onChange={(e) => setAccNumber(e.target.value)}
              dir="ltr"
              placeholder="مثال: 3283046 أو SD23..."
              className="h-10 rounded-xl text-xs font-mono font-bold bg-background text-left"
            />
          </div>
          <Button
            type="button"
            disabled={busy || !accName.trim()}
            onClick={() => void handleSaveDetails()}
            className="w-full h-10 rounded-xl text-xs font-black gap-1.5"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Building2 className="h-4 w-4" />}
            <span>حفظ بيانات الحساب</span>
          </Button>
        </div>
      )}
    </div>
  );
}
