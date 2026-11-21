import React, { useEffect, useMemo, useRef, useState } from "react";
import { X, Calendar, User, Users } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { CustomInvoiceType } from "@/lib/billing/types";
import { AppCurrency } from "@/lib/currency/types";
import { CurrencySelector } from "@/components/currency/CurrencySelector";
import {
  unarchiveCustomer,
  useCustomers,
  type CustomerRecord,
  type CustomerType,
} from "@/lib/customersStore";
import {
  findCustomerMatch,
  normalizeCustomerName,
} from "@/lib/customers/customerMatching";
import { CustomerPickerModal } from "@/components/customers/CustomerPickerModal";
import { InvoiceCustomerLinkStrip } from "./InvoiceCustomerLinkStrip";
import { CustomInvoiceAdvancedFields } from "./CustomInvoiceAdvancedFields";
import { getLocalIsoDate } from "@/lib/dateUtils";
import { playTapSound } from "@/lib/soundEffects";
import { toast } from "sonner";

interface Props {
  type: CustomInvoiceType;
  partyName: string;
  setPartyName: (v: string) => void;
  partyEnName: string;
  setPartyEnName: (v: string) => void;
  attn: string;
  setAttn: (v: string) => void;
  date: string;
  setDate: (v: string) => void;
  reference?: string | undefined;
  fallbackSerial?: string | undefined;
  language: "auto" | "ar" | "en";
  setLanguage: (v: "auto" | "ar" | "en") => void;
  currency?: AppCurrency;
  setCurrency: (v: AppCurrency) => void;
  customerId?: string | null;
  setCustomerId?: (id: string | null) => void;
  phone?: string;
  setPhone?: (v: string) => void;
  saveAsNewCustomer?: boolean;
  setSaveAsNewCustomer?: (v: boolean) => void;
  newCustomerType?: CustomerType;
  setNewCustomerType?: (t: CustomerType) => void;
  newCustomerAddress?: string;
  setNewCustomerAddress?: (v: string) => void;
  isCustomerLocked?: boolean;
  isCurrencyLocked?: boolean;
  onOpenCustomerProfile?: (customerId: string) => void;
  supplierId?: string | null;
  setSupplierId?: (id: string | null) => void;
  supplierInvoiceNumber?: string;
  setSupplierInvoiceNumber?: (v: string) => void;
}

export function CustomInvoiceMetaSection({
  type,
  partyName,
  setPartyName,
  partyEnName,
  setPartyEnName,
  attn,
  setAttn,
  date,
  setDate,
  reference,
  fallbackSerial,
  language,
  setLanguage,
  currency = "SDG",
  setCurrency,
  customerId,
  setCustomerId,
  phone = "",
  setPhone,
  saveAsNewCustomer = false,
  setSaveAsNewCustomer,
  newCustomerType = "client",
  setNewCustomerType,
  newCustomerAddress = "",
  setNewCustomerAddress,
  isCustomerLocked = false,
  isCurrencyLocked = false,
  onOpenCustomerProfile,
  supplierId,
  setSupplierId,
  supplierInvoiceNumber,
  setSupplierInvoiceNumber,
}: Props) {
  const isPurchase = type === "purchase";
  const customers = useCustomers();
  const [customerPickerOpen, setCustomerPickerOpen] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(
    Boolean(attn.trim() || partyEnName.trim() || (isPurchase && (supplierId || supplierInvoiceNumber?.trim())))
  );
  const suggestionsWrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showSuggestions) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (suggestionsWrapRef.current && !suggestionsWrapRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [showSuggestions]);

  const linkedCustomer = useMemo(
    () => (!isPurchase && customerId ? customers.find((c) => c.id === customerId) ?? null : null),
    [isPurchase, customerId, customers]
  );

  const matchResult = useMemo(
    () => (isPurchase ? { exactActive: null, exactArchived: null, suggestions: [] } : findCustomerMatch(customers, partyName)),
    [isPurchase, customers, partyName]
  );

  const matchedCustomers = partyName.trim().length > 0 && !isPurchase ? matchResult.suggestions : [];

  const handleSelectCustomer = (customer: CustomerRecord) => {
    playTapSound();
    setPartyName(customer.name);
    setCustomerId?.(customer.id);
    setSaveAsNewCustomer?.(false);
    if (customer.phone && setPhone) {
      setPhone(customer.phone);
    }
    setShowSuggestions(false);
  };

  const handleUnlinkCustomer = () => {
    if (isCustomerLocked) return;
    setCustomerId?.(null);
  };

  const handleRestoreAndLink = async (archived: CustomerRecord) => {
    try {
      await unarchiveCustomer(archived.id);
      handleSelectCustomer({ ...archived, isArchived: false });
      toast.success(`تمت استعادة «${archived.name}» من الأرشيف وربط الفاتورة بملفه`);
    } catch {
      toast.error("تعذّرت استعادة العميل من الأرشيف");
    }
  };

  const setRelativeDate = (offsetDays: number) => {
    playTapSound();
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    setDate(getLocalIsoDate(d));
  };

  const todayStr = getLocalIsoDate();

  return (
    <div
      className="rounded-2xl border border-border/80 bg-card p-3 sm:p-4 space-y-3.5 shadow-2xs select-text"
      dir="rtl"
    >
      {/* 1. ترويسة القسم الإرشادية مع اللغات والعملات */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 border-b border-border/50 pb-2.5">
        <div>
          <div className="flex items-center gap-1.5">
            <span className="grid h-5 w-5 place-items-center rounded-md bg-primary/10 text-primary text-[11px] font-black">
              1
            </span>
            <span className="text-xs sm:text-sm font-black text-foreground">
              {isPurchase ? "بيانات المورد والمستند" : "بيانات العميل والمستند"}
            </span>
          </div>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            حدد اسم الجهة والعملة وتاريخ الإصدار
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
          <div className="inline-flex rounded-xl border border-border/80 bg-secondary/60 p-0.5 shadow-2xs">
            {(["ar", "auto", "en"] as const).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setLanguage(l)}
                className={`px-2.5 py-1 rounded-lg text-[10.5px] font-black transition cursor-pointer ${
                  language === l
                    ? "bg-primary text-white shadow-2xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {l === "ar" ? "عربي" : l === "auto" ? "تلقائي" : "EN"}
              </button>
            ))}
          </div>

          <div className="flex flex-col items-end gap-0.5">
            <CurrencySelector
              value={currency}
              onChange={setCurrency}
              locale={language === "en" ? "en" : "ar"}
              disabled={isCurrencyLocked}
              dropdownTitle={
                isCurrencyLocked
                  ? "العملة مقفلة لوجود مدفوعات مسجلة على الفاتورة"
                  : undefined
              }
            />
            {isCurrencyLocked && (
              <span className="text-[9.5px] font-bold text-amber-600 dark:text-amber-400">
                العملة مقفلة لوجود مدفوعات مسجلة
              </span>
            )}
          </div>
        </div>
      </div>

      {/* 2. اسم العميل / الجهة مع شريط القرار الذكي */}
      <div className="space-y-2 relative">
        <div className="flex items-center justify-between">
          <Label className="text-[11px] font-black text-foreground flex items-center gap-1.5 text-right">
            <User className="h-3.5 w-3.5 text-primary" />
            <span>{isPurchase ? "اسم المورد / المحل أو الجهة" : "اسم العميل / الشركة أو الجهة"}</span>
            <span className="text-rose-500 font-bold">*</span>
          </Label>
        </div>

        <div className="flex items-center gap-2">
          <div ref={suggestionsWrapRef} className="relative flex-1">
            <Input
              value={partyName}
              onChange={(e) => {
                const val = e.target.value;
                setPartyName(val);
                if (!isPurchase) setShowSuggestions(true);
                if (!isCustomerLocked && customerId && setCustomerId) {
                  const currentLinked = customers.find((c) => c.id === customerId);
                  if (
                    currentLinked &&
                    normalizeCustomerName(currentLinked.name) !== normalizeCustomerName(val)
                  ) {
                    setCustomerId(null);
                  }
                }
              }}
              onFocus={() => {
                if (!isPurchase && !isCustomerLocked) setShowSuggestions(true);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") setShowSuggestions(false);
              }}
              placeholder={
                isPurchase
                  ? "اكتب اسم المورد أو المحل التجاري..."
                  : "اكتب اسم العميل أو اضغط على «العملاء» للاختيار..."
              }
              className={`h-10 text-xs sm:text-sm rounded-xl font-bold bg-background text-right ${
                partyName && !isCustomerLocked ? "pl-8" : ""
              }`}
            />
            {partyName && !isCustomerLocked && (
              <button
                type="button"
                onClick={() => {
                  setPartyName("");
                  setCustomerId?.(null);
                  setSaveAsNewCustomer?.(false);
                  setShowSuggestions(false);
                }}
                aria-label="مسح الاسم"
                className="absolute left-2 top-1/2 -translate-y-1/2 grid h-6 w-6 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}

            {/* قائمة الاقتراحات تظهر فقط عند وجود عملاء مطابقين فعلياً لمنع التداخل مع زر الإضافة التلقائية */}
            {showSuggestions && !isCustomerLocked && !isPurchase && matchedCustomers.length > 0 && (
              <div className="absolute z-30 top-full mt-1 w-full rounded-xl border border-border bg-card shadow-xl overflow-hidden py-1">
                <div className="px-2.5 py-1 text-[10px] font-bold text-muted-foreground bg-muted/40 border-b border-border/50">
                  عملاء مطابقون في السجل (اضغط للاختيار الفوري):
                </div>
                {matchedCustomers.map((cust) => (
                  <button
                    key={cust.id}
                    type="button"
                    onClick={() => handleSelectCustomer(cust)}
                    className="w-full text-right px-3 py-2 text-xs font-bold hover:bg-primary/10 hover:text-primary transition flex items-center justify-between cursor-pointer border-b border-border/20 last:border-0"
                  >
                    <span>{cust.name}</span>
                    {cust.phone && (
                      <span className="text-[10px] font-mono text-muted-foreground" dir="ltr">
                        {cust.phone}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {!isPurchase && (
            <Button
              type="button"
              variant="outline"
              disabled={isCustomerLocked}
              onClick={() => {
                playTapSound();
                setShowSuggestions(false);
                setCustomerPickerOpen(true);
              }}
              className="h-10 px-3.5 rounded-xl border border-primary/40 bg-primary/10 hover:bg-primary hover:text-white text-primary text-xs font-black gap-1.5 shrink-0 active:scale-95 shadow-2xs cursor-pointer transition-all disabled:opacity-50"
              title={isCustomerLocked ? "العميل مقفل لوجود مدفوعات على الفاتورة" : "اختيار عميل مسجل من السجل"}
            >
              <Users className="h-4 w-4" />
              <span>العملاء</span>
            </Button>
          )}
        </div>

        {!isPurchase && setSaveAsNewCustomer && setPhone && setNewCustomerType && (
          <InvoiceCustomerLinkStrip
            partyName={partyName}
            linkedCustomer={linkedCustomer}
            exactActiveMatch={matchResult.exactActive}
            exactArchivedMatch={matchResult.exactArchived}
            isCustomerLocked={isCustomerLocked}
            saveAsNewCustomer={saveAsNewCustomer}
            setSaveAsNewCustomer={(next) => {
              setShowSuggestions(false);
              setSaveAsNewCustomer(next);
            }}
            phone={phone}
            setPhone={setPhone}
            newCustomerType={newCustomerType}
            setNewCustomerType={setNewCustomerType}
            address={newCustomerAddress}
            setAddress={setNewCustomerAddress}
            onLinkCustomer={handleSelectCustomer}
            onUnlinkCustomer={handleUnlinkCustomer}
            onRestoreAndLink={handleRestoreAndLink}
            onOpenCustomerProfile={onOpenCustomerProfile}
          />
        )}
      </div>

      {/* 3. شبكة التاريخ والمرجع */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-0.5">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label className="text-[11px] font-black text-foreground flex items-center gap-1.5 text-right">
              <Calendar className="h-3 w-3 text-primary" />
              <span>تاريخ الفاتورة</span>
            </Label>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setRelativeDate(0)}
                className={`px-2 py-0.5 rounded-lg text-[10px] font-black transition cursor-pointer ${
                  date === todayStr
                    ? "bg-primary text-white"
                    : "bg-secondary text-muted-foreground hover:text-foreground"
                }`}
              >
                اليوم
              </button>
              <button
                type="button"
                onClick={() => setRelativeDate(-1)}
                className="px-2 py-0.5 rounded-lg text-[10px] font-black bg-secondary text-muted-foreground hover:text-foreground transition cursor-pointer"
              >
                أمس
              </button>
            </div>
          </div>
          <Input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="h-10 text-xs sm:text-sm rounded-xl font-mono font-bold bg-background text-right"
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-[11px] font-black text-foreground block text-right">
            المرجع الرسمي (Invoice Reference)
          </Label>
          <div
            dir="ltr"
            className={`flex h-10 items-center justify-center rounded-xl border font-mono text-xs sm:text-sm font-black ${
              reference
                ? "border-primary/40 bg-primary/5 text-primary"
                : "border-dashed border-border/80 bg-muted/40 text-muted-foreground"
            }`}
          >
            {reference || (fallbackSerial ? `#${fallbackSerial}` : "يُولَّد تلقائياً عند الحفظ")}
          </div>
        </div>
      </div>

      {/* 4. قسم الخيارات الإضافية القابل للطي */}
      <CustomInvoiceAdvancedFields
        isPurchase={isPurchase}
        showAdvanced={showAdvanced}
        onToggleAdvanced={() => setShowAdvanced(!showAdvanced)}
        attn={attn}
        setAttn={setAttn}
        partyEnName={partyEnName}
        setPartyEnName={setPartyEnName}
        supplierId={supplierId}
        setSupplierId={setSupplierId}
        supplierInvoiceNumber={supplierInvoiceNumber}
        setSupplierInvoiceNumber={setSupplierInvoiceNumber}
        onSupplierSelectedName={setPartyName}
      />

      {!isPurchase && (
        <CustomerPickerModal
          open={customerPickerOpen}
          onOpenChange={setCustomerPickerOpen}
          selectedCustomerId={customerId}
          initialQuery={partyName}
          onSelect={handleSelectCustomer}
        />
      )}
    </div>
  );
}

export default CustomInvoiceMetaSection;
