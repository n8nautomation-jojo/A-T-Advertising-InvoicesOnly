import React, { useEffect, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { formatNumber } from "@/lib/printCalculator";

interface InvoicePaginationBarProps {
  page: number;
  totalPages: number;
  pageSize: number;
  totalCount: number;
  pageSizeOptions?: number[];
  onPageChange: (nextPage: number) => void;
  onPageSizeChange?: (nextSize: number) => void;
  itemLabel?: string;
}

/**
 * High-scale pagination bar designed for 100,000+ invoice records.
 * Keeps DOM size strictly bounded to `pageSize` while offering instant page jump,
 * first/prev/next/last navigation, and responsive Arabic RTL layout.
 */
export function InvoicePaginationBar({
  page,
  totalPages,
  pageSize,
  totalCount,
  pageSizeOptions = [25, 50, 100],
  onPageChange,
  onPageSizeChange,
  itemLabel = "فاتورة",
}: InvoicePaginationBarProps) {
  const [jumpValue, setJumpValue] = useState(String(page));

  useEffect(() => {
    setJumpValue(String(page));
  }, [page]);

  if (totalCount === 0) return null;

  const startIdx = Math.min((page - 1) * pageSize + 1, totalCount);
  const endIdx = Math.min(page * pageSize, totalCount);

  const commitJump = (raw: string) => {
    const num = Math.floor(Number(raw));
    if (!Number.isFinite(num) || num < 1) {
      setJumpValue(String(page));
      return;
    }
    const clamped = Math.min(totalPages, Math.max(1, num));
    if (clamped !== page) {
      onPageChange(clamped);
    } else {
      setJumpValue(String(clamped));
    }
  };

  return (
    <div
      data-testid="invoice-pagination-bar"
      dir="rtl"
      className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5 border-t border-border/50 bg-muted/20 px-3 py-2.5 sm:px-4 text-xs w-full min-w-0"
    >
      {/* Range + Page Size */}
      <div className="flex flex-wrap items-center justify-between sm:justify-start gap-2 text-muted-foreground min-w-0">
        <span className="text-[11px] font-bold leading-snug">
          عرض{" "}
          <bdi dir="ltr" className="font-mono font-black text-foreground tabular-nums">
            {formatNumber(startIdx)} - {formatNumber(endIdx)}
          </bdi>{" "}
          من{" "}
          <bdi dir="ltr" className="font-mono font-black text-foreground tabular-nums">
            {formatNumber(totalCount)}
          </bdi>{" "}
          {itemLabel}
        </span>

        {onPageSizeChange && (
          <div className="inline-flex items-center gap-1 rounded-xl border border-border/60 bg-background px-2 py-1 text-[11px]">
            <span className="text-muted-foreground font-bold">في الصفحة:</span>
            <select
              aria-label="عدد الفواتير لكل صفحة"
              data-testid="pagination-page-size"
              value={pageSize}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
              className="bg-transparent font-mono font-black text-foreground outline-hidden cursor-pointer"
            >
              {pageSizeOptions.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Navigation Controls */}
      {totalPages > 1 && (
        <div className="flex flex-wrap items-center justify-between sm:justify-end gap-2 min-w-0">
          <div className="flex items-center gap-1">
            <button
              type="button"
              data-testid="pagination-first"
              disabled={page <= 1}
              onClick={() => onPageChange(1)}
              aria-label="الصفحة الأولى"
              title="الصفحة الأولى"
              className="grid h-8 w-8 place-items-center rounded-xl border border-border/60 bg-card text-foreground hover:bg-secondary disabled:opacity-40 disabled:pointer-events-none transition-colors cursor-pointer touch-manipulation active:scale-95"
            >
              <ChevronsRight className="h-4 w-4" />
            </button>
            <button
              type="button"
              data-testid="pagination-prev"
              disabled={page <= 1}
              onClick={() => onPageChange(Math.max(1, page - 1))}
              aria-label="الصفحة السابقة"
              title="الصفحة السابقة"
              className="grid h-8 w-8 place-items-center rounded-xl border border-border/60 bg-card text-foreground hover:bg-secondary disabled:opacity-40 disabled:pointer-events-none transition-colors cursor-pointer touch-manipulation active:scale-95"
            >
              <ChevronRight className="h-4 w-4" />
            </button>

            <div className="px-2.5 py-1 rounded-xl bg-card border border-border/60 text-[11px] font-bold text-foreground whitespace-nowrap">
              صفحة{" "}
              <bdi dir="ltr" className="font-mono font-black text-primary tabular-nums">
                {formatNumber(page)}
              </bdi>{" "}
              /{" "}
              <bdi dir="ltr" className="font-mono font-black tabular-nums">
                {formatNumber(totalPages)}
              </bdi>
            </div>

            <button
              type="button"
              data-testid="pagination-next"
              disabled={page >= totalPages}
              onClick={() => onPageChange(Math.min(totalPages, page + 1))}
              aria-label="الصفحة التالية"
              title="الصفحة التالية"
              className="grid h-8 w-8 place-items-center rounded-xl border border-border/60 bg-card text-foreground hover:bg-secondary disabled:opacity-40 disabled:pointer-events-none transition-colors cursor-pointer touch-manipulation active:scale-95"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              data-testid="pagination-last"
              disabled={page >= totalPages}
              onClick={() => onPageChange(totalPages)}
              aria-label="الصفحة الأخيرة"
              title="الصفحة الأخيرة"
              className="grid h-8 w-8 place-items-center rounded-xl border border-border/60 bg-card text-foreground hover:bg-secondary disabled:opacity-40 disabled:pointer-events-none transition-colors cursor-pointer touch-manipulation active:scale-95"
            >
              <ChevronsLeft className="h-4 w-4" />
            </button>
          </div>

          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="font-bold whitespace-nowrap">انتقال:</span>
            <Input
              type="number"
              inputMode="numeric"
              aria-label="انتقال سريع إلى صفحة"
              data-testid="pagination-jump-input"
              min={1}
              max={totalPages}
              value={jumpValue}
              onChange={(e) => {
                setJumpValue(e.target.value);
                const val = Math.floor(Number(e.target.value));
                if (Number.isFinite(val) && val >= 1 && val <= totalPages) {
                  onPageChange(val);
                }
              }}
              onBlur={(e) => commitJump(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  commitJump(jumpValue);
                }
              }}
              className="h-8 w-16 text-center text-xs font-mono font-black bg-card rounded-xl border-border/60 px-1.5"
            />
          </div>
        </div>
      )}
    </div>
  );
}
