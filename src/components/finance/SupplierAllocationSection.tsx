import React from "react";
import { Plus, SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatNumber } from "@/lib/printCalculator";
import { getCurrencyShortLabel } from "@/lib/currency/currencyFormat";
import { sanitizePositiveDecimal } from "./shared/numericInput";
import type { AllocationFormRow } from "./shared/allocateFifo";

export interface SupplierInvoiceSummary {
  invoiceId: string;
  reference: string;
  currency?: string;
  settlement: {
    outstanding: number;
  };
}

interface SupplierAllocationSectionProps {
  openInvoices: SupplierInvoiceSummary[];
  rows: AllocationFormRow[];
  setRows: React.Dispatch<React.SetStateAction<AllocationFormRow[]>>;
  paymentAmount: number;
  allocatedTotal: number;
  currencyLabel?: string;
  onAddRow: () => void;
  onAutoAllocate: () => void;
}

export function SupplierAllocationSection({
  openInvoices,
  rows,
  setRows,
  paymentAmount,
  allocatedTotal,
  currencyLabel = getCurrencyShortLabel("SDG"),
  onAddRow,
  onAutoAllocate,
}: SupplierAllocationSectionProps) {
  const allAllocated = openInvoices.length === 0 || rows.length >= openInvoices.length;

  return (
    <div className="rounded-2xl border border-border/60 bg-muted/20 p-3 space-y-2">
      <div className="flex items-center justify-between gap-1.5 flex-wrap">
        <p className="text-[11px] font-black text-foreground">تخصيص لفواتير الشراء</p>
        <div className="flex items-center gap-1">
          {openInvoices.length > 0 && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={onAutoAllocate}
              className="h-7 rounded-lg gap-1 text-[10px] font-black text-primary px-2"
            >
              <SlidersHorizontal className="h-3 w-3" />
              توزيع تلقائي
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onAddRow}
            disabled={allAllocated}
            className="h-7 rounded-lg gap-1 text-[10px] font-bold"
          >
            <Plus className="h-3 w-3" />
            إضافة
          </Button>
        </div>
      </div>

      {openInvoices.length === 0 ? (
        <p className="text-[10px] text-muted-foreground">
          لا توجد فواتير شراء بمبالغ متبقية لهذا المورد.
        </p>
      ) : (
        rows.map((row, index) => (
          <div key={`${row.invoiceId}-${index}`} className="flex items-center gap-2">
            <Select
              value={row.invoiceId}
              onValueChange={(v) =>
                setRows((c) => c.map((r, i) => (i === index ? { ...r, invoiceId: v } : r)))
              }
            >
              <SelectTrigger className="h-9 flex-1 rounded-lg text-[11px] font-bold bg-background text-right">
                <SelectValue />
              </SelectTrigger>
              <SelectContent dir="rtl">
                {openInvoices.map((inv) => (
                  <SelectItem key={inv.invoiceId} value={inv.invoiceId}>
                    <span className="font-mono text-[10px]" dir="ltr">
                      {inv.reference}
                    </span>
                    <span className="mx-1.5">·</span>
                    متبقي {formatNumber(inv.settlement.outstanding)}{" "}
                    {inv.currency ? getCurrencyShortLabel(inv.currency) : currencyLabel}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              inputMode="decimal"
              value={row.amount}
              onChange={(e) =>
                setRows((c) =>
                  c.map((r, i) =>
                    i === index ? { ...r, amount: sanitizePositiveDecimal(e.target.value) } : r
                  )
                )
              }
              placeholder="0"
              className="h-9 w-24 rounded-lg text-[11px] font-bold bg-background text-center tabular-nums"
            />
            <Button
              type="button"
              size="sm"
              variant="ghost"
              aria-label="حذف"
              onClick={() => setRows((c) => c.filter((_, i) => i !== index))}
              className="h-9 w-9 rounded-lg p-0 text-muted-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))
      )}

      {paymentAmount > 0 && (
        <p className="text-[10px] font-bold text-muted-foreground">
          المخصَّص: {formatNumber(allocatedTotal)} {currencyLabel} · غير مخصَّص:{" "}
          {formatNumber(Math.max(0, paymentAmount - allocatedTotal))} {currencyLabel}
        </p>
      )}
    </div>
  );
}
