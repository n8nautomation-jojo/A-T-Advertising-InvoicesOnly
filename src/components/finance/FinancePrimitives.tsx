import React from "react";
import { Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { formatNumber } from "@/lib/printCalculator";
import { getCurrencyShortLabel } from "@/lib/currency/currencyFormat";

export interface CancelTarget {
  kind: "receipt" | "supplier_payment";
  id: string;
  reference: string;
  partyName: string;
  amount: number;
  currency?: string;
}

export function Metric({
  label,
  value,
  tone,
  currencyLabel = getCurrencyShortLabel("SDG"),
  icon,
  className,
  onClick,
}: {
  label: string;
  value: string;
  tone: "primary" | "warn" | "danger";
  currencyLabel?: string;
  icon?: React.ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-2xl border p-3 sm:p-3.5 shadow-2xs space-y-1 text-right transition-all hover:shadow-sm active:scale-[0.99] cursor-pointer",
        tone === "primary" && "border-primary/30 bg-primary/[0.04] hover:border-primary/50",
        tone === "warn" && "border-amber-500/30 bg-amber-500/[0.04] hover:border-amber-500/50",
        tone === "danger" && "border-rose-500/30 bg-rose-500/[0.04] hover:border-rose-500/50",
        className
      )}
    >
      <p className="flex items-center gap-1.5 text-[11px] font-bold text-muted-foreground">
        {icon}
        <span>{label}</span>
      </p>
      <p className="font-mono text-base sm:text-lg font-black tabular-nums text-foreground">
        {value} <span className="text-[10px] font-sans font-normal text-muted-foreground">{currencyLabel}</span>
      </p>
    </button>
  );
}

export function Card({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="surface-panel space-y-2">
      <p className="surface-panel-title">
        {icon}
        {title}
      </p>
      <div className="row-sep">{children}</div>
    </div>
  );
}

export function Row({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="data-row">
      <span className="data-row-label">{label}</span>
      <span
        className={cn(
          "font-mono tabular-nums",
          strong ? "font-black text-foreground" : "font-bold text-foreground"
        )}
      >
        {value}
      </span>
    </div>
  );
}

export function List<T>({
  items,
  emptyLabel,
  render,
}: {
  items: T[];
  emptyLabel: string;
  render: (item: T) => {
    key?: string;
    title: string;
    titleIsCode?: boolean;
    subtitle: string;
    amount: number;
    currency?: string;
    muted?: boolean;
    actionLabel?: string;
    onAction?: () => void;
  };
}) {
  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border/70 bg-muted/20 p-6 text-center">
        <p className="text-xs font-bold text-muted-foreground">{emptyLabel}</p>
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-2xl border border-border/70 bg-card divide-y divide-border/50">
      {items.map((item, index) => {
        const row = render(item);
        const currencyLabel = getCurrencyShortLabel(row.currency);
        return (
          <div key={row.key ?? index} className="flex items-center justify-between gap-2.5 p-3.5 text-right">
            <div className="min-w-0 flex-1">
              <p
                className={cn(
                  "truncate text-xs font-bold",
                  row.titleIsCode && "font-mono",
                  row.muted ? "text-muted-foreground line-through" : "text-foreground"
                )}
              >
                {row.titleIsCode ? <bdi dir="ltr">{row.title}</bdi> : row.title}
              </p>
              <p className="truncate text-[11px] text-muted-foreground mt-0.5">{row.subtitle}</p>
            </div>
            <div className="flex items-center gap-2.5 shrink-0">
              <div className="text-left">
                <span
                  className={cn(
                    "font-mono text-xs sm:text-sm font-black tabular-nums",
                    row.muted
                      ? "text-muted-foreground"
                      : row.amount < 0
                      ? "text-rose-600 dark:text-rose-400"
                      : "text-emerald-600 dark:text-emerald-400"
                  )}
                >
                  {row.amount < 0 ? "-" : "+"}
                  {formatNumber(Math.abs(row.amount))}
                </span>
                <p className="text-[9.5px] text-muted-foreground">{currencyLabel}</p>
              </div>
              {row.actionLabel && row.onAction && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={row.onAction}
                  className="h-8 rounded-lg px-2 text-[10.5px] font-bold text-rose-600 hover:text-rose-700 hover:bg-rose-500/10 gap-1"
                >
                  <RotateCcw className="h-3 w-3" />
                  <span>{row.actionLabel}</span>
                </Button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function CancelPaymentAlertDialog({
  cancelTarget,
  cancelReason,
  setCancelReason,
  cancelling,
  onClose,
  onConfirm,
}: {
  cancelTarget: CancelTarget | null;
  cancelReason: string;
  setCancelReason: (v: string) => void;
  cancelling: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={Boolean(cancelTarget)} onOpenChange={(v) => !v && !cancelling && onClose()}>
      <AlertDialogContent dir="rtl">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-right text-sm font-black">
            إلغاء السند المالي {cancelTarget?.reference}
          </AlertDialogTitle>
          <AlertDialogDescription className="text-right text-xs leading-relaxed">
            سيتم إنشاء قيد عكسي لإلغاء {cancelTarget?.kind === "receipt" ? "تحصيل العميل" : "دفعة المورد"} «
            {cancelTarget?.partyName}» بمبلغ {formatNumber(cancelTarget?.amount ?? 0)}{" "}
            {getCurrencyShortLabel(cancelTarget?.currency)} وإعادة الرصيد المتبقي إلى
            الفواتير المرتبطة.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-1.5 py-1">
          <label className="text-[11px] font-black text-foreground">سبب الإلغاء (اختياري)</label>
          <Input
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
            placeholder="مثال: خطأ في المبلغ أو ارتداد التحويل البنكي"
            className="h-9 rounded-xl text-xs font-bold bg-background text-right"
          />
        </div>
        <AlertDialogFooter className="gap-2 sm:justify-start">
          <AlertDialogCancel disabled={cancelling} className="rounded-xl text-xs font-bold">
            تراجع
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={cancelling}
            onClick={(e) => {
              e.preventDefault();
              onConfirm();
            }}
            className="rounded-xl text-xs font-black bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {cancelling && <Loader2 className="h-3.5 w-3.5 animate-spin me-1" />}
            تأكيد الإلغاء والعكس
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
