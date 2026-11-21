import {
  FileText,
  Calendar,
  User,
  Phone,
  Building,
  MapPin,
  Check,
} from "lucide-react";
import {
  CLIENT_TYPES,
  type InvoiceMeta,
  type ClientType,
  type InvoiceLine,
  invoiceTotal,
} from "@/lib/invoice/types";
import { formatNumber } from "@/lib/printCalculator";
import { CurrencySelector } from "@/components/currency/CurrencySelector";
import { getCurrencyShortLabel } from "@/lib/currency/currencyFormat";
import { sanitizeCurrency } from "@/lib/currency/types";

interface Props {
  meta: InvoiceMeta;
  onChange: (m: InvoiceMeta) => void;
  lines?: InvoiceLine[];
}

const inputClass =
  "h-9.5 w-full rounded-xl border border-border bg-background px-3 text-xs font-semibold text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 placeholder:text-muted-foreground/60";

/** نموذج بيانات الفاتورة — مخصص ومحسن لسطح المكتب والهاتف */
export function InvoiceForm({ meta, onChange, lines }: Props) {
  const set = <K extends keyof InvoiceMeta>(k: K, v: InvoiceMeta[K]) =>
    onChange({ ...meta, [k]: v });

  const toggle = (c: ClientType) =>
    set(
      "clientTypes",
      meta.clientTypes.includes(c)
        ? meta.clientTypes.filter((x) => x !== c)
        : [...meta.clientTypes, c]
    );

  const total = lines ? invoiceTotal(lines) : 0;

  return (
    <div className="space-y-3" dir="rtl">
      {/* Row 1: Serial + Date */}
      <div className="grid grid-cols-2 gap-2.5">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-bold text-muted-foreground flex items-center gap-1">
            <FileText className="h-3 w-3 text-primary" />
            رقم الفاتورة
          </span>
          <input
            className={`${inputClass} font-mono font-bold`}
            type="tel"
            inputMode="numeric"
            value={meta.serial}
            onChange={(e) => set("serial", e.target.value)}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-bold text-muted-foreground flex items-center gap-1">
            <Calendar className="h-3 w-3 text-primary" />
            التاريخ
          </span>
          <input
            type="date"
            className={`${inputClass} font-mono`}
            value={meta.date}
            onChange={(e) => set("date", e.target.value)}
          />
        </label>
      </div>

      {/* Row 1.5: Currency selector */}
      <div className="flex items-center justify-between rounded-xl border border-border/70 bg-card/80 p-2 px-3 shadow-2xs">
        <span className="text-[11px] font-bold text-muted-foreground">عملة الحساب والفاتورة:</span>
        <CurrencySelector
          value={sanitizeCurrency(meta.currency, "SDG")}
          onChange={(c) => set("currency", c)}
          locale="ar"
        />
      </div>

      {/* Row 2: Customer Name */}
      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-bold text-muted-foreground flex items-center gap-1">
          <User className="h-3 w-3 text-primary" />
          اسم العميل / الجهة
        </span>
        <input
          className={inputClass}
          placeholder="مثال: وكالة الأفق للدعاية"
          value={meta.customerName}
          onChange={(e) => set("customerName", e.target.value)}
        />
      </label>

      {/* Row 3: Phone + Branch */}
      <div className="grid grid-cols-2 gap-2.5">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-bold text-muted-foreground flex items-center gap-1">
            <Phone className="h-3 w-3 text-primary" />
            رقم الهاتف
          </span>
          <input
            className={`${inputClass} font-mono`}
            type="tel"
            dir="ltr"
            placeholder="09XXXXXXXX"
            value={meta.phone}
            onChange={(e) => set("phone", e.target.value)}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-bold text-muted-foreground flex items-center gap-1">
            <Building className="h-3 w-3 text-primary" />
            فرع الطباعة
          </span>
          <input
            className={inputClass}
            value={meta.branch}
            onChange={(e) => set("branch", e.target.value)}
          />
        </label>
      </div>

      {/* Row 4: Shipping Address */}
      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-bold text-muted-foreground flex items-center gap-1">
          <MapPin className="h-3 w-3 text-primary" />
          مكان التسليم / الشحن إلى
        </span>
        <input
          className={inputClass}
          placeholder="مثال: الخرطوم - شارع الستين"
          value={meta.shipTo}
          onChange={(e) => set("shipTo", e.target.value)}
        />
      </label>

      {/* Row 5: Client Type selection */}
      <div className="space-y-1 pt-1">
        <span className="text-[11px] font-bold text-muted-foreground">تصنيف العميل في الفاتورة:</span>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
          {CLIENT_TYPES.map((c) => {
            const on = meta.clientTypes.includes(c.key);
            return (
              <button
                key={c.key}
                type="button"
                onClick={() => toggle(c.key)}
                className={`h-8.5 rounded-xl border text-[11px] font-bold transition active:scale-95 flex items-center justify-center gap-1 ${
                  on
                    ? "border-primary bg-primary text-primary-foreground shadow-xs"
                    : "border-border bg-secondary/50 text-foreground hover:bg-secondary"
                }`}
              >
                {on && <Check className="h-3 w-3" />}
                <span>{c.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Summary Box */}
      {lines && lines.length > 0 && (
        <div className="rounded-2xl border border-border/80 bg-secondary/40 p-3 mt-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground font-medium">عدد بنود الفاتورة:</span>
            <span className="font-mono font-bold text-foreground">{lines.length} بند</span>
          </div>
          <div className="flex items-center justify-between text-xs mt-1 border-t border-border/60 pt-1.5">
            <span className="font-bold text-foreground">إجمالي القيمة:</span>
            <span className="font-mono font-black text-primary text-base">
              {formatNumber(total)}{" "}
              <span className="text-[10px] font-normal text-muted-foreground">
                {getCurrencyShortLabel(meta.currency)}
              </span>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
