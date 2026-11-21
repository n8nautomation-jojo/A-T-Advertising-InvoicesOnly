import React, { useEffect, useMemo, useState } from "react";
import { Search, X, Check, Building2, Plus } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  useCustomers,
  findOrCreateCustomerByName,
  getAllCustomerFinancialSummaries,
  CUSTOMER_TYPE_CONFIG,
  PRIMARY_CUSTOMER_TYPES,
  type CustomerRecord,
  type CustomerType,
} from "@/lib/customersStore";
import {
  findCustomerMatch,
  normalizeCustomerName,
  normalizePhoneDigits,
} from "@/lib/customers/customerMatching";
import { formatNumber } from "@/lib/printCalculator";
import { getCurrencyShortLabel } from "@/lib/currency/currencyFormat";
import { sanitizeCurrency } from "@/lib/currency/types";
import {
  getCustomerCurrencyBuckets,
  type LiveBalancesMap,
} from "./CustomersDirectoryViews";
import { playTapSound, playSuccessSound } from "@/lib/soundEffects";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedCustomerId?: string | null;
  onSelect: (customer: CustomerRecord) => void;
  initialQuery?: string;
  startInAddMode?: boolean;
}

export function CustomerPickerModal({
  open,
  onOpenChange,
  selectedCustomerId,
  onSelect,
  initialQuery,
  startInAddMode = false,
}: Props) {
  const customers = useCustomers();
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");

  // Inline Quick Add state
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newType, setNewType] = useState<CustomerType>("company");
  const [isSaving, setIsSaving] = useState(false);
  const [liveBalances, setLiveBalances] = useState<LiveBalancesMap>({});

  useEffect(() => {
    if (open) {
      const seed = (initialQuery || "").trim();
      setSearch(seed);
      setNewName(seed);
      setNewPhone("");
      setTypeFilter("all");
      setIsAddingNew(Boolean(startInAddMode));
      let cancelled = false;
      void getAllCustomerFinancialSummaries()
        .then((map) => {
          if (!cancelled) setLiveBalances(map);
        })
        .catch(() => {
          // keep fallback balance when DB is unavailable in web preview
        });
      return () => {
        cancelled = true;
      };
    } else {
      setSearch("");
      setTypeFilter("all");
      setIsAddingNew(false);
      setNewName("");
      setNewPhone("");
    }
  }, [open, initialQuery, startInAddMode]);

  const activeCustomers = useMemo(() => {
    return customers.filter((c) => !c.isArchived);
  }, [customers]);

  const filteredCustomers = useMemo(() => {
    const normQ = normalizeCustomerName(search);
    const phoneQ = normalizePhoneDigits(search);
    const addrQ = search.trim().toLowerCase();
    return activeCustomers.filter((c) => {
      const matchSearch =
        (!normQ && !phoneQ && !addrQ) ||
        (Boolean(normQ) && normalizeCustomerName(c.name).includes(normQ)) ||
        (phoneQ.length >= 2 && normalizePhoneDigits(c.phone).includes(phoneQ)) ||
        (Boolean(addrQ) && Boolean(c.address) && c.address.toLowerCase().includes(addrQ));
      const matchType = typeFilter === "all" || c.type === typeFilter;
      return matchSearch && matchType;
    });
  }, [activeCustomers, search, typeFilter]);

  const hasExactActiveMatch = useMemo(() => {
    const q = search.trim();
    if (!q) return false;
    return Boolean(findCustomerMatch(customers, q).exactActive);
  }, [customers, search]);

  const handleQuickAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || isSaving) return;

    setIsSaving(true);
    try {
      const outcome = await findOrCreateCustomerByName({
        name: newName.trim(),
        phone: newPhone.trim(),
        type: newType,
      });
      playSuccessSound();
      if (outcome.created) {
        toast.success(`تمت إضافة العميل "${outcome.customer.name}" واختياره للفاتورة`);
      } else if (outcome.unarchived) {
        toast.success(`تمت استعادة العميل "${outcome.customer.name}" من الأرشيف وربطه بالفاتورة`);
      } else {
        toast.success(`تم الربط بالعميل المسجل مسبقاً "${outcome.customer.name}"`);
      }
      setIsAddingNew(false);
      setNewName("");
      setNewPhone("");
      onSelect(outcome.customer);
      onOpenChange(false);
    } catch {
      toast.error("تعذر إضافة العميل الجديد");
    } finally {
      setIsSaving(false);
    }
  };

  const fieldStyle =
    "h-10 w-full rounded-xl border border-border/80 bg-background px-3 text-xs font-bold text-foreground outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        dir="rtl"
        className="max-w-lg w-[95vw] p-0 rounded-2xl bg-card border-border/80 shadow-2xl max-h-[85vh] flex flex-col overflow-hidden"
      >
        <DialogHeader className="p-4 pl-14 sm:p-5 sm:pl-16 border-b border-border/60 bg-muted/20 text-right flex flex-row items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary/10 text-primary border border-primary/20 shrink-0">
              <Building2 className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <DialogTitle className="text-sm sm:text-base font-black text-foreground truncate">
                سجل العملاء المعتمدين
              </DialogTitle>
              <DialogDescription className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">
                اختر العميل لربط الفاتورة بملفه التجاري والمالي
              </DialogDescription>
            </div>
          </div>

          <Button
            type="button"
            size="sm"
            onClick={() => {
              playTapSound();
              if (!isAddingNew && search.trim() && !newName.trim()) {
                setNewName(search.trim());
              }
              setIsAddingNew(!isAddingNew);
            }}
            className="h-8 px-2.5 sm:px-3 text-[11px] sm:text-xs font-black gap-1 rounded-xl bg-primary hover:bg-primary/90 text-white shrink-0 shadow-xs active:scale-[0.97] touch-manipulation cursor-pointer whitespace-nowrap"
          >
            {isAddingNew ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
            <span>{isAddingNew ? "قائمة العملاء" : "عميل جديد"}</span>
          </Button>
        </DialogHeader>

        {isAddingNew ? (
          /* نموذج إضافة عميل سريع دون مغادرة الشاشة */
          <form onSubmit={handleQuickAdd} className="p-4 sm:p-5 space-y-3.5 flex-1 overflow-y-auto">
            <div className="space-y-1.5">
              <label className="text-[11px] font-black text-foreground flex items-center gap-1">
                <span>اسم العميل / الوكالة أو الشركة</span>
                <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                required
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="مثال: شركة النيل الحديثة"
                className={fieldStyle}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-[11px] font-black text-foreground">رقم الهاتف للتواصل والواتساب</label>
                <input
                  type="tel"
                  dir="ltr"
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                  placeholder="09XXXXXXXX"
                  className={fieldStyle}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-black text-foreground">التصنيف التجاري</label>
                <select
                  value={newType}
                  onChange={(e) => setNewType(e.target.value as CustomerType)}
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

            <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-border/50">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsAddingNew(false)}
                className="h-9 text-xs font-bold rounded-xl border-border/80 text-foreground cursor-pointer"
              >
                إلغاء
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={isSaving || !newName.trim()}
                className="h-9 px-5 text-xs font-black rounded-xl bg-primary hover:bg-primary/90 text-white shadow-xs active:scale-[0.97] touch-manipulation cursor-pointer"
              >
                {isSaving ? "جاري الحفظ..." : "حفظ واختيار العميل"}
              </Button>
            </div>
          </form>
        ) : (
          /* قائمة البحث والاختيار */
          <div className="p-4 sm:p-5 flex flex-col flex-1 min-h-0 gap-3">
            {/* حقل البحث */}
            <div className="relative">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="ابحث بالاسم أو رقم الهاتف..."
                className="h-9.5 w-full rounded-xl border border-border/80 bg-secondary/35 pr-9 pl-8 text-xs font-bold text-foreground placeholder:text-muted-foreground/60 outline-none transition-colors focus:border-primary focus:bg-background focus:ring-1 focus:ring-primary"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {/* تصنيفات سريعة */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none text-[11px]">
              {[
                { key: "all", label: "الكل" },
                { key: "company", label: "شركة" },
                { key: "institution", label: "مؤسسة" },
                { key: "client", label: "زبون" },
                { key: "individual", label: "أفراد" },
              ].map((tab) => {
                const active = typeFilter === tab.key;
                return (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => {
                      playTapSound();
                      setTypeFilter(tab.key);
                    }}
                    className={`px-3 py-1 rounded-full font-bold shrink-0 transition-all cursor-pointer touch-manipulation active:scale-95 ${
                      active
                        ? "bg-primary text-white shadow-2xs"
                        : "bg-secondary/70 text-muted-foreground hover:bg-secondary hover:text-foreground border border-border/50"
                    }`}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>

            {/* قائمة العملاء */}
            <div className="flex-1 overflow-y-auto min-h-[220px] max-h-[360px] space-y-1.5 pr-0.5 divide-y divide-border/30">
              {filteredCustomers.length === 0 ? (
                <div className="py-10 px-4 text-center text-xs font-bold text-muted-foreground border border-dashed border-border/70 rounded-2xl space-y-3">
                  <p>{search.trim() ? `لا توجد نتائج مطابقة لـ «${search.trim()}»` : "لا يوجد عملاء مسجلون حالياً"}</p>
                  {search.trim().length > 0 && !hasExactActiveMatch && (
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => {
                        playTapSound();
                        setNewName(search.trim());
                        setIsAddingNew(true);
                      }}
                      className="h-8 px-4 rounded-xl text-xs font-black gap-1.5 bg-primary hover:bg-primary/90 text-white cursor-pointer"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      <span>إضافة «{search.trim()}» كعميل جديد</span>
                    </Button>
                  )}
                </div>
              ) : (
                <>
                  {filteredCustomers.map((cust) => {
                    const isSelected = selectedCustomerId === cust.id;
                    const cfg = CUSTOMER_TYPE_CONFIG[cust.type] || CUSTOMER_TYPE_CONFIG.individual;
                    const live = liveBalances[cust.id];
                    const buckets = getCustomerCurrencyBuckets(cust, live, "ALL");
                    const debtBuckets = buckets.filter((b) => b.outstanding > 0.009);
                    const fallbackCreditAmount = !live && cust.balance < -0.009
                      ? Math.abs(cust.balance)
                      : live && !live.byCurrency && live.outstanding < -0.009
                        ? Math.abs(live.outstanding)
                        : 0;
                    const fallbackCreditCurrency = sanitizeCurrency(
                      live?.primaryCurrency ?? cust.openingBalanceCurrency,
                      "SDG"
                    );

                    return (
                      <button
                        type="button"
                        key={cust.id}
                        dir="rtl"
                        onClick={() => {
                          playTapSound();
                          onSelect(cust);
                          onOpenChange(false);
                        }}
                        className={`w-full text-right p-3 rounded-xl cursor-pointer transition-all flex items-center justify-between gap-3 ${
                          isSelected
                            ? "bg-primary/10 border border-primary/30 shadow-2xs"
                            : "hover:bg-secondary/50 border border-transparent"
                        }`}
                      >
                        <div className="min-w-0 flex-1 text-right">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-black text-xs text-foreground truncate">
                              {cust.name}
                            </span>
                            <span
                              className={`rounded-full px-2 py-0.5 text-[9.5px] font-bold border ${cfg.bg} ${cfg.color} border-current/20 shrink-0`}
                            >
                              {cfg.label}
                            </span>
                          </div>

                          {(cust.phone || cust.address) && (
                            <div className="flex items-center gap-2.5 mt-1 text-[11px] text-muted-foreground">
                              {cust.phone ? (
                                <bdi dir="ltr" className="font-mono font-bold text-primary/80">
                                  {cust.phone}
                                </bdi>
                              ) : null}
                              {cust.address ? <span className="truncate">{cust.address}</span> : null}
                            </div>
                          )}
                        </div>

                        <div className="text-left shrink-0">
                          {debtBuckets.length > 0 ? (
                            <div className="space-y-0.5">
                              {debtBuckets.map((b) => (
                                <div
                                  key={b.currency}
                                  className="text-[11px] font-mono font-black text-rose-600 dark:text-rose-400 tabular-nums leading-tight whitespace-nowrap"
                                >
                                  {formatNumber(b.outstanding)} {getCurrencyShortLabel(b.currency)}
                                </div>
                              ))}
                              <span className="text-[9.5px] block font-sans text-rose-600/75 font-bold">
                                مديونية
                              </span>
                            </div>
                          ) : fallbackCreditAmount > 0.009 ? (
                            <div className="text-[11px] font-mono font-black text-emerald-600 dark:text-emerald-400 tabular-nums whitespace-nowrap">
                              {formatNumber(fallbackCreditAmount)} {getCurrencyShortLabel(fallbackCreditCurrency)}
                              <span className="text-[9.5px] block font-sans text-emerald-600/75 font-bold">
                                رصيد مقدم
                              </span>
                            </div>
                          ) : (
                            <span className="text-[11px] text-muted-foreground font-bold">متزن (0)</span>
                          )}
                        </div>

                        {isSelected && (
                          <div className="grid h-6 w-6 place-items-center rounded-full bg-primary text-white shrink-0 shadow-2xs">
                            <Check className="h-3.5 w-3.5" />
                          </div>
                        )}
                      </button>
                    );
                  })}
                  {search.trim().length > 0 && !hasExactActiveMatch && (
                    <div className="pt-2">
                      <button
                        type="button"
                        onClick={() => {
                          playTapSound();
                          setNewName(search.trim());
                          setIsAddingNew(true);
                        }}
                        className="w-full flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-primary/40 bg-primary/5 py-2.5 text-xs font-black text-primary hover:bg-primary/10 transition cursor-pointer"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        <span>إضافة «{search.trim()}» كعميل جديد</span>
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
