import React, { useState, useEffect } from "react";
import { UserPlus, Pencil, Building2, Phone, MapPin, Wallet, FileText } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  CUSTOMER_TYPE_CONFIG,
  PRIMARY_CUSTOMER_TYPES,
  useCustomers,
  type CustomerRecord,
  type CustomerType,
} from "@/lib/customersStore";
import { findCustomerMatch } from "@/lib/customers/customerMatching";
import { AppCurrency } from "@/lib/currency/types";
import { getLocalIsoDate } from "@/lib/dateUtils";
import { sanitizePositiveDecimal } from "@/components/finance/shared/numericInput";

interface Props {
  open: boolean;
  onClose: () => void;
  onSave: (data: Omit<CustomerRecord, "id" | "createdAt" | "totalOrders" | "totalSpent">) => void;
  initialData?: CustomerRecord | null;
}

const SUPPORTED_CURRENCIES: { code: AppCurrency; label: string }[] = [
  { code: "SDG", label: "جنيه سوداني (SDG)" },
  { code: "USD", label: "دولار أمريكي (USD)" },
  { code: "SAR", label: "ريال سعودي (SAR)" },
  { code: "EGP", label: "جنيه مصري (EGP)" },
];

export function CustomerDialog({ open, onClose, onSave, initialData }: Props) {
  const customers = useCustomers();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [type, setType] = useState<CustomerType>("company");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");

  // Opening balance fields
  const [openingBalance, setOpeningBalance] = useState("0");
  const [openingCurrency, setOpeningCurrency] = useState<AppCurrency>("SDG");
  const [openingType, setOpeningType] = useState<"debit" | "credit">("debit");
  const [openingDate, setOpeningDate] = useState(() => getLocalIsoDate());
  const [openingNotes, setOpeningNotes] = useState("");

  useEffect(() => {
    const today = getLocalIsoDate();
    if (initialData) {
      setName(initialData.name || "");
      setPhone(initialData.phone || "");
      setType(initialData.type || "company");
      setAddress(initialData.address || "");
      setNotes(initialData.notes || "");
      setOpeningBalance(String(Math.max(0, initialData.openingBalance ?? (initialData.balance ? Math.abs(initialData.balance) : 0))));
      setOpeningCurrency((initialData.openingBalanceCurrency as AppCurrency) || "SDG");
      setOpeningType(initialData.openingBalanceType || (initialData.balance < 0 ? "credit" : "debit"));
      setOpeningDate(initialData.openingBalanceDate || initialData.createdAt?.slice(0, 10) || today);
      setOpeningNotes(initialData.openingBalanceNotes || "");
    } else {
      setName("");
      setPhone("");
      setType("company");
      setAddress("");
      setNotes("");
      setOpeningBalance("0");
      setOpeningCurrency("SDG");
      setOpeningType("debit");
      setOpeningDate(today);
      setOpeningNotes("");
    }
  }, [initialData, open]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const opBalNum = Math.max(0, parseFloat(openingBalance) || 0);
    const computedLegacyBalance = opBalNum > 0 ? (openingType === "debit" ? opBalNum : -opBalNum) : 0;

    onSave({
      name: name.trim(),
      phone: phone.trim(),
      type,
      address: address.trim(),
      balance: computedLegacyBalance,
      notes: notes.trim() || undefined,
      openingBalance: opBalNum,
      openingBalanceCurrency: openingCurrency,
      openingBalanceType: openingType,
      openingBalanceDate: opBalNum > 0 ? openingDate : undefined,
      openingBalanceNotes: opBalNum > 0 ? openingNotes.trim() || undefined : undefined,
      isArchived: initialData?.isArchived ?? false,
    });
    onClose();
  };

  const fieldStyle =
    "h-10 w-full rounded-xl border border-border/80 bg-background px-3 text-xs font-bold text-foreground outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary";

  const duplicateMatch =
    !initialData && name.trim().length >= 2 ? findCustomerMatch(customers, name) : null;

  return (
    <Dialog open={open} onOpenChange={(val) => { if (!val) onClose(); }}>
      <DialogContent
        dir="rtl"
        className="max-w-lg w-[95vw] p-0 rounded-2xl bg-card border-border/80 shadow-2xl overflow-hidden max-h-[90vh] flex flex-col"
      >
        <div className="p-4 pl-12 sm:p-5 sm:pl-14 border-b border-border/60 bg-muted/20 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary/10 text-primary border border-primary/20 shrink-0">
              {initialData ? <Pencil className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />}
            </span>
            <div>
              <DialogTitle className="text-sm sm:text-base font-black text-foreground">
                {initialData ? "تعديل ملف العميل" : "إضافة عميل جديد"}
              </DialogTitle>
              <DialogDescription className="text-[11px] text-muted-foreground mt-0.5">
                سجل بيانات التواصل والتصنيف التجاري والرصيد المالي الموثق
              </DialogDescription>
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
          <div className="space-y-1.5">
            <label className="text-[11px] font-black text-foreground flex items-center gap-1">
              <span>اسم العميل / الوكالة أو الشركة</span>
              <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              required
              autoFocus={!initialData}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="مثال: وكالة الأفق للدعاية والإعلان"
              className={fieldStyle}
            />
            {duplicateMatch?.exactActive && (
              <p className="rounded-xl border border-[#C5A059]/40 bg-[#C5A059]/10 px-3 py-1.5 text-[11px] font-bold text-[#9A7835] dark:text-[#dfbe7e]">
                تنبيه: يوجد عميل مسجل بنفس الاسم «{duplicateMatch.exactActive.name}». يفضّل اختياره بدلاً من إنشاء سجل مكرر.
              </p>
            )}
            {!duplicateMatch?.exactActive && duplicateMatch?.exactArchived && (
              <p className="rounded-xl border border-border/80 bg-secondary/40 px-3 py-1.5 text-[11px] font-bold text-muted-foreground">
                تنبيه: العميل «{duplicateMatch.exactArchived.name}» موجود في الأرشيف ويمكن استعادته من قائمة المؤرشفين.
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-[11px] font-black text-foreground flex items-center gap-1">
                <Phone className="h-3 w-3 text-muted-foreground" />
                <span>رقم الهاتف للتواصل والواتساب</span>
              </label>
              <input
                type="tel"
                dir="ltr"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="09XXXXXXXX"
                className={fieldStyle}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] font-black text-foreground flex items-center gap-1">
                <Building2 className="h-3 w-3 text-muted-foreground" />
                <span>تصنيف العميل</span>
              </label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as CustomerType)}
                className={fieldStyle}
              >
                {PRIMARY_CUSTOMER_TYPES.map((k) => (
                  <option key={k} value={k}>
                    {CUSTOMER_TYPE_CONFIG[k].label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] font-black text-foreground flex items-center gap-1">
              <MapPin className="h-3 w-3 text-muted-foreground" />
              <span>العنوان / المنطقة أو المدينة</span>
            </label>
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="مثال: الخرطوم - بورتسودان - السوق العربي"
              className={fieldStyle}
            />
          </div>

          <div className="rounded-2xl border border-border/80 bg-secondary/25 p-3.5 space-y-3">
            <div className="flex items-center justify-between border-b border-border/50 pb-2">
              <div className="flex items-center gap-1.5">
                <Wallet className="h-4 w-4 text-[#C5A059]" />
                <span className="text-xs font-black text-foreground">الرصيد الافتتاحي (حركة مالية محاسبية)</span>
              </div>
              <span className="text-[10px] font-mono text-muted-foreground">Opening Balance</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-muted-foreground">قيمة الرصيد</label>
                <input
                  type="text"
                  inputMode="decimal"
                  pattern="[0-9]*[.,]?[0-9]*"
                  value={openingBalance}
                  onChange={(e) => setOpeningBalance(sanitizePositiveDecimal(e.target.value))}
                  placeholder="0"
                  className={fieldStyle}
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold text-muted-foreground">العملة</label>
                <select
                  value={openingCurrency}
                  onChange={(e) => setOpeningCurrency(e.target.value as AppCurrency)}
                  className={fieldStyle}
                >
                  {SUPPORTED_CURRENCIES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold text-muted-foreground">طبيعة الرصيد</label>
                <select
                  value={openingType}
                  onChange={(e) => setOpeningType(e.target.value as "debit" | "credit")}
                  className={fieldStyle}
                >
                  <option value="debit">مدين (مستحق على العميل)</option>
                  <option value="credit">دائن (رصيد مقدم للعميل)</option>
                </select>
              </div>
            </div>

            {parseFloat(openingBalance) > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-2 border-t border-border/40">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-muted-foreground">تاريخ الرصيد الافتتاحي</label>
                  <input
                    type="date"
                    value={openingDate}
                    onChange={(e) => setOpeningDate(e.target.value)}
                    className={fieldStyle}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-muted-foreground">بيان / سبب الرصيد الافتتاحي</label>
                  <input
                    type="text"
                    value={openingNotes}
                    onChange={(e) => setOpeningNotes(e.target.value)}
                    placeholder="مثال: رصيد مرحل من الدفاتر السابقة"
                    className={fieldStyle}
                  />
                </div>
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] font-black text-foreground flex items-center gap-1">
              <FileText className="h-3 w-3 text-muted-foreground" />
              <span>ملاحظات وشروط خاصة بالعميل</span>
            </label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="مثال: خصم وكالة 10%، سداد أسبوعي..."
              className="w-full rounded-xl border border-border/80 bg-background p-2.5 text-xs font-bold text-foreground outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary"
            />
          </div>

          <div className="flex items-center justify-between gap-2.5 pt-3 border-t border-border/60">
            <Button
              type="submit"
              className="h-10 px-6 rounded-xl font-black text-xs bg-primary hover:bg-primary/90 text-white shadow-xs shadow-primary/30 active:scale-[0.97] touch-manipulation cursor-pointer"
            >
              {initialData ? "تحديث بيانات العميل" : "حفظ العميل"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              className="h-10 px-5 rounded-xl font-bold text-xs border-border/80 text-foreground hover:bg-secondary active:scale-[0.97] touch-manipulation cursor-pointer"
            >
              إلغاء
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
