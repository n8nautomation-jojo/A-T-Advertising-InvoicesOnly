import React from "react";
import { Search, X } from "lucide-react";
import { INVOICES_FILTER_TABS } from "./types";

interface InvoicesSearchBarProps {
  search: string;
  setSearch: (s: string) => void;
  filterType: string;
  setFilterType: (f: string) => void;
}

/**
 * صندوق البحث الذكي وشريط تصنيف أنواع الفواتير (مبيعات، مشتريات، حاسبة)
 */
export const InvoicesSearchBar: React.FC<InvoicesSearchBarProps> = ({
  search,
  setSearch,
  filterType,
  setFilterType,
}) => {
  return (
    <div className="space-y-2.5">
      {/* حقل البحث بالرقم أو العميل */}
      <div className="relative">
        <Search className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          placeholder="بحث برقم الفاتورة، اسم العميل، أو نوع السجل..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-10.5 sm:h-11 w-full rounded-xl border border-border/80 bg-secondary/35 pr-10 pl-9 text-xs sm:text-sm font-bold text-foreground placeholder:text-muted-foreground/60 outline-none transition-all duration-150 focus:bg-background focus:border-primary focus:ring-2 focus:ring-primary/20 touch-manipulation"
        />
        {search && (
          <button
            type="button"
            onClick={() => setSearch("")}
            className="absolute left-3 top-1/2 -translate-y-1/2 grid h-6 w-6 place-items-center rounded-lg bg-secondary text-muted-foreground hover:text-foreground touch-manipulation active:scale-90"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* ألسنة التصفية السريعة (تلتف بمرونة بدون تمرير أفقي مقصوص) */}
      <div className="flex flex-wrap items-center gap-1.5 border-t border-border/50 pt-2 w-full min-w-0">
        {INVOICES_FILTER_TABS.map((tab) => {
          const active = filterType === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setFilterType(tab.key)}
              className={`rounded-xl px-3 py-1.5 text-xs font-bold transition-all duration-150 touch-manipulation active:scale-95 cursor-pointer ${
                active
                  ? "bg-primary text-primary-foreground shadow-md shadow-primary/25 font-black ring-1 ring-primary/40"
                  : "bg-secondary/70 text-muted-foreground hover:bg-secondary hover:text-foreground border border-border/50"
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
    </div>
  );
};
