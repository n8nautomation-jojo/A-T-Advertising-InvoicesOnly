import React, { useState, useRef, useEffect } from "react";
import { Coins, Check, ChevronDown } from "lucide-react";
import {
  AppCurrency,
  CURRENCY_LIST,
  DEFAULT_CURRENCY,
  SUPPORTED_CURRENCIES,
} from "@/lib/currency/types";
import { playTapSound } from "@/lib/soundEffects";

interface Props {
  value?: AppCurrency;
  onChange: (currency: AppCurrency) => void;
  locale?: "ar" | "en";
  label?: string;
  dropdownTitle?: string;
  className?: string;
  disabled?: boolean;
}

/**
 * محدد العملة المستقل والمتجاوب لجميع شاشات إنشاء وتحرير الفواتير
 */
export function CurrencySelector({
  value = DEFAULT_CURRENCY,
  onChange,
  locale = "ar",
  label,
  dropdownTitle,
  className = "",
  disabled = false,
}: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedConfig = SUPPORTED_CURRENCIES[value] || SUPPORTED_CURRENCIES[DEFAULT_CURRENCY];

  // إغلاق القائمة عند النقر خارجها
  useEffect(() => {
    function handleClickOutside(event: MouseEvent | TouchEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("touchstart", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
    };
  }, [isOpen]);

  const handleSelect = (code: AppCurrency) => {
    playTapSound();
    onChange(code);
    setIsOpen(false);
  };

  const isRtl = locale === "ar";
  const resolvedLabel = label !== undefined ? label : isRtl ? "عملة الفاتورة:" : "Currency:";
  const resolvedTitle = dropdownTitle ?? (isRtl ? "اختر عملة الفاتورة" : "Select Invoice Currency");

  return (
    <div
      ref={containerRef}
      className={`relative inline-block text-right ${className}`}
      dir={isRtl ? "rtl" : "ltr"}
    >
      <div className="flex items-center gap-1.5">
        {resolvedLabel ? (
          <span className="text-[11px] font-bold text-muted-foreground whitespace-nowrap">
            {resolvedLabel}
          </span>
        ) : null}

        {/* Trigger Button */}
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            if (!disabled) {
              playTapSound();
              setIsOpen((prev) => !prev);
            }
          }}
          className={`h-7.5 px-2.5 py-1 rounded-xl border border-border/80 bg-secondary/70 hover:bg-secondary text-foreground text-[11px] font-black inline-flex items-center gap-1.5 transition-all shadow-2xs cursor-pointer select-none focus:outline-none focus:ring-2 focus:ring-primary/40 ${
            isOpen ? "ring-2 ring-primary border-primary bg-primary/10 text-primary" : ""
          } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          title={resolvedTitle}
        >
          <span className="text-xs leading-none">{selectedConfig.flag}</span>
          <span className="font-mono font-bold tracking-tight">{selectedConfig.code}</span>
          <span className="text-[10px] text-muted-foreground font-semibold hidden xs:inline max-w-[85px] truncate">
            ({isRtl ? selectedConfig.nameAr : selectedConfig.nameEn})
          </span>
          <ChevronDown
            className={`h-3 w-3 text-muted-foreground transition-transform duration-200 ${
              isOpen ? "rotate-180 text-primary" : ""
            }`}
          />
        </button>
      </div>

      {/* Dropdown Menu */}
      {isOpen && (
        <div
          role="listbox"
          aria-label={isRtl ? "قائمة العملات المدعومة" : "Supported currencies"}
          className="absolute z-50 mt-1 min-w-[210px] sm:min-w-[230px] rounded-xl border border-border bg-popover/95 p-1 text-popover-foreground shadow-xl backdrop-blur-md animate-in fade-in zoom-in-95 duration-100 top-full end-0"
        >
          <div className="px-2 py-1 border-b border-border/40 text-[9.5px] font-bold text-muted-foreground uppercase tracking-wider flex items-center justify-between">
            <span>{resolvedTitle}</span>
            <Coins className="h-3 w-3 text-primary opacity-80" />
          </div>

          <div className="py-1 space-y-0.5">
            {CURRENCY_LIST.map((c) => {
              const isSelected = c.code === value;
              return (
                <button
                  key={c.code}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => handleSelect(c.code)}
                  className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer select-none text-right ${
                    isSelected
                      ? "bg-primary text-primary-foreground font-black shadow-xs"
                      : "hover:bg-muted text-foreground"
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm leading-none">{c.flag}</span>
                    <span className="font-mono font-black text-xs">{c.code}</span>
                    <span
                      className={`text-[10.5px] truncate font-medium ${
                        isSelected ? "text-primary-foreground/90" : "text-muted-foreground"
                      }`}
                    >
                      {isRtl ? c.nameAr : c.nameEn}
                    </span>
                  </div>

                  {isSelected && (
                    <Check className="h-3.5 w-3.5 shrink-0 ml-1 text-primary-foreground" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

