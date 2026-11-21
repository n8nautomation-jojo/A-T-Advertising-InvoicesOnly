import React from "react";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  ACCOUNT_KIND_LABELS,
  type AccountBalanceReport,
  type AccountKind,
} from "@/lib/domain/finance";
import { formatNumber } from "@/lib/printCalculator";
import { getCurrencyShortLabel } from "@/lib/currency/currencyFormat";
import { CURRENCY_LIST, type AppCurrency } from "@/lib/currency/types";

interface FinanceAccountsTabProps {
  accounts: AccountBalanceReport[];
  newAccountName: string;
  setNewAccountName: (v: string) => void;
  newAccountKind: AccountKind;
  setNewAccountKind: (v: AccountKind) => void;
  newAccountCurrency: AppCurrency;
  setNewAccountCurrency: (v: AppCurrency) => void;
  creatingAccount: boolean;
  onCreateAccount: () => void;
}

export function FinanceAccountsTab({
  accounts,
  newAccountName,
  setNewAccountName,
  newAccountKind,
  setNewAccountKind,
  newAccountCurrency,
  setNewAccountCurrency,
  creatingAccount,
  onCreateAccount,
}: FinanceAccountsTabProps) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
        {accounts.map((report) => {
          const curLabel = getCurrencyShortLabel(report.account.currency);
          return (
            <div
              key={report.account.id}
              className="rounded-2xl border border-border/70 bg-card p-3.5 flex items-center justify-between gap-3"
            >
              <div className="min-w-0">
                <p className="text-xs sm:text-sm font-black text-foreground truncate">{report.account.name}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {ACCOUNT_KIND_LABELS[report.account.kind]} · وارد {formatNumber(report.inflow)} · صادر{" "}
                  {formatNumber(report.outflow)}
                </p>
              </div>
              <div className="text-left shrink-0">
                <span
                  className={cn(
                    "font-mono text-sm font-black tabular-nums",
                    report.balance < 0 ? "text-rose-600 dark:text-rose-400" : "text-foreground"
                  )}
                >
                  {formatNumber(report.balance)}
                </span>
                <p className="text-[10px] text-muted-foreground">{curLabel}</p>
              </div>
            </div>
          );
        })}
      </div>

      <div className="surface-panel space-y-2.5">
        <p className="surface-panel-title">إضافة حساب مالي جديد</p>
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_130px_130px_auto] gap-2">
          <Input
            value={newAccountName}
            onChange={(e) => setNewAccountName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onCreateAccount();
            }}
            placeholder="اسم الحساب (مثال: خزنة المكتب / حساب بنك الخرطوم)"
            className="h-10 rounded-xl text-xs font-bold bg-background text-right"
          />
          <Select
            dir="rtl"
            value={newAccountKind}
            onValueChange={(v) => setNewAccountKind(v as AccountKind)}
          >
            <SelectTrigger className="h-10 rounded-xl text-xs font-bold bg-background text-right">
              <SelectValue />
            </SelectTrigger>
            <SelectContent dir="rtl">
              <SelectItem value="cash" className="text-xs font-bold">نقدي</SelectItem>
              <SelectItem value="bank" className="text-xs font-bold">بنكي</SelectItem>
              <SelectItem value="other" className="text-xs font-bold">أخرى</SelectItem>
            </SelectContent>
          </Select>
          <Select
            dir="rtl"
            value={newAccountCurrency}
            onValueChange={(v) => setNewAccountCurrency(v as AppCurrency)}
          >
            <SelectTrigger className="h-10 rounded-xl text-xs font-bold bg-background text-right">
              <SelectValue />
            </SelectTrigger>
            <SelectContent dir="rtl">
              {CURRENCY_LIST.map((cur) => (
                <SelectItem key={cur.code} value={cur.code} className="text-xs font-bold">
                  {cur.flag} {cur.code}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            disabled={creatingAccount}
            onClick={onCreateAccount}
            className="h-10 rounded-xl px-4 gap-1.5 text-xs font-black bg-primary hover:bg-primary/90 text-white"
          >
            {creatingAccount ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            <span>إضافة حساب</span>
          </Button>
        </div>
      </div>
    </div>
  );
}
