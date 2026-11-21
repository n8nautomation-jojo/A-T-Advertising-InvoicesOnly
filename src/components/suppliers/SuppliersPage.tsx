import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  FileText,
  Pencil,
  Phone,
  Plus,
  Receipt,
  RefreshCw,
  Search,
  ShoppingBag,
  Truck,
  Wallet,
  X,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { PageShell } from "@/components/layout/PageShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  createSupplier,
  getAllSuppliers,
  getSupplierOutstandingMap,
  updateSupplier,
  type Supplier,
} from "@/lib/repositories/SupplierRepository";
import { formatNumber } from "@/lib/printCalculator";
import { getCurrencyShortLabel } from "@/lib/currency/currencyFormat";
import { SupplierPaymentDialog } from "@/components/finance/SupplierPaymentDialog";
import { CurrencySelector } from "@/components/currency/CurrencySelector";
import { DEFAULT_CURRENCY, SUPPORTED_CURRENCIES, type AppCurrency } from "@/lib/currency/types";
import { CustomInvoiceDialog } from "@/components/billing/CustomInvoiceDialog";
import { BillingPreviewModal } from "@/components/billing/BillingPreviewModal";
import type { CustomInvoice } from "@/lib/billing/types";

/**
 * الموردون (PRD §7.1): شركات الطباعة ومقدّمو الخدمات، مع رصيد مشتق من
 * فواتير الشراء والمدفوعات — باستعلام تجميعي واحد بدون N+1.
 */
export function SuppliersPage() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [outstanding, setOutstanding] = useState<Record<string, number>>({});
  const [currency, setCurrency] = useState<AppCurrency>(DEFAULT_CURRENCY);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [paySupplierId, setPaySupplierId] = useState<string | null>(null);
  const [purchaseSupplier, setPurchaseSupplier] = useState<Supplier | null>(null);
  const [previewInvoice, setPreviewInvoice] = useState<CustomInvoice | null>(null);
  const [editingInvoice, setEditingInvoice] = useState<CustomInvoice | null>(null);
  const didAutoSelectCurrencyRef = useRef(false);

  const currencyLabel = getCurrencyShortLabel(currency);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, outstandingMap] = await Promise.all([
        getAllSuppliers(),
        getSupplierOutstandingMap(currency),
      ]);
      if (!didAutoSelectCurrencyRef.current) {
        const currentTotal = Object.values(outstandingMap).reduce(
          (sum, val) => sum + (Number(val) || 0),
          0
        );
        if (currentTotal > 0) {
          didAutoSelectCurrencyRef.current = true;
        } else if (currency === "SDG") {
          const otherCurrencies = (Object.keys(SUPPORTED_CURRENCIES) as AppCurrency[]).filter(
            (c) => c !== "SDG"
          );
          const otherMaps = await Promise.all(
            otherCurrencies.map(async (cur) => ({
              cur,
              map: await getSupplierOutstandingMap(cur),
            }))
          );
          const active = otherMaps.find(
            ({ map }) =>
              Object.values(map).reduce((sum, val) => sum + (Number(val) || 0), 0) > 0
          );
          if (active) {
            didAutoSelectCurrencyRef.current = true;
            setSuppliers(list);
            setOutstanding(active.map);
            setCurrency(active.cur);
            return;
          }
        }
      }
      setSuppliers(list);
      setOutstanding(outstandingMap);
    } catch (err) {
      console.error("[SuppliersPage] load failed:", err);
      toast.error("تعذّر تحميل بيانات الموردين");
    } finally {
      setLoading(false);
    }
  }, [currency]);

  useEffect(() => {
    void load();
    const onRefresh = () => {
      void load();
    };
    window.addEventListener("native-storage-ready", onRefresh);
    window.addEventListener("finance-changed", onRefresh);
    return () => {
      window.removeEventListener("native-storage-ready", onRefresh);
      window.removeEventListener("finance-changed", onRefresh);
    };
  }, [load]);

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error("اسم المورد مطلوب");
      return;
    }
    try {
      if (editing) {
        await updateSupplier(editing.id, { name, phone });
        toast.success("تم تحديث المورد");
      } else {
        await createSupplier({ name, phone });
        toast.success("تم إضافة المورد");
      }
      setName("");
      setPhone("");
      setEditing(null);
      await load();
    } catch (err) {
      toast.error("تعذّر الحفظ", {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  };

  const stats = useMemo(() => {
    const withBalance = suppliers.filter((s) => (outstanding[s.id] ?? 0) > 0).length;
    const totalOutstanding = suppliers.reduce((sum, s) => sum + (outstanding[s.id] ?? 0), 0);
    return {
      total: suppliers.length,
      withBalance,
      totalOutstanding,
    };
  }, [suppliers, outstanding]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return suppliers;
    return suppliers.filter(
      (s) => s.name.toLowerCase().includes(q) || (s.phone ?? "").toLowerCase().includes(q)
    );
  }, [suppliers, query]);

  return (
    <PageShell>
      <main
        className="w-full flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-3 py-3 md:px-6 md:py-5 min-w-0 scroll-smooth touch-pan-y pb-36 md:pb-16"
        dir="rtl"
      >
        <div className="mx-auto max-w-7xl space-y-3.5 w-full">
          {/* 1. ترويسة الصفحة التنفيذية */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-card/90 backdrop-blur-md p-3.5 sm:p-4 rounded-2xl border border-border/70 shadow-2xs border-r-4 border-r-primary">
            <div className="flex items-start gap-2.5">
              <Link
                to="/"
                aria-label="رجوع"
                className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-border bg-secondary text-foreground transition-all hover:border-primary/40 hover:text-primary active:scale-95 touch-manipulation"
              >
                <ArrowRight className="h-4 w-4" />
              </Link>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary/10 text-primary border border-primary/20 shrink-0">
                    <Truck className="h-4 w-4" />
                  </span>
                  <h1 className="text-base sm:text-lg font-black text-foreground tracking-tight">
                    إدارة الموردين والمستحقات
                  </h1>
                  <span className="text-[11px] font-mono font-black text-primary px-2.5 py-0.5 rounded-full bg-primary/10 border border-primary/20 tabular-nums shrink-0">
                    {stats.total} مورد
                  </span>
                </div>
                <p className="text-[11px] sm:text-xs text-muted-foreground font-medium mt-1">
                  شركات التنفيذ والخدمات الإعلانية ومتابعة أرصدة المشتريات والسداد
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap self-end sm:self-center">
              <CurrencySelector
                label="العملة:"
                dropdownTitle="اختر عملة الأرصدة"
                value={currency}
                onChange={(c) => {
                  didAutoSelectCurrencyRef.current = true;
                  setCurrency(c);
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void load()}
                disabled={loading}
                aria-label="تحديث"
                className="h-8 px-3 rounded-xl gap-1.5 text-xs font-bold text-muted-foreground"
              >
                <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
                <span>تحديث</span>
              </Button>
            </div>
          </div>

          {/* 2. مؤشرات الأداء */}
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            <div className="rounded-2xl border border-border/70 bg-card/90 p-3 sm:p-3.5 shadow-2xs space-y-1">
              <span className="text-[11px] font-bold text-muted-foreground flex items-center gap-1.5">
                <Truck className="h-3.5 w-3.5 text-primary" />
                <span>إجمالي الموردين</span>
              </span>
              <p className="font-mono text-lg sm:text-xl font-black text-foreground tabular-nums">
                {stats.total}
              </p>
            </div>

            <div className="rounded-2xl border border-amber-500/30 bg-amber-500/[0.04] p-3 sm:p-3.5 shadow-2xs space-y-1">
              <span className="text-[11px] font-bold text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
                <Receipt className="h-3.5 w-3.5" />
                <span>لديهم مستحقات</span>
              </span>
              <p className="font-mono text-lg sm:text-xl font-black text-amber-600 dark:text-amber-400 tabular-nums">
                {stats.withBalance}
              </p>
            </div>

            <div className="col-span-2 sm:col-span-1 rounded-2xl border border-rose-500/30 bg-rose-500/[0.04] p-3 sm:p-3.5 shadow-2xs space-y-1">
              <span className="text-[11px] font-bold text-rose-600 dark:text-rose-400 flex items-center gap-1.5">
                <Wallet className="h-3.5 w-3.5" />
                <span>إجمالي المستحقات</span>
              </span>
              <p className="font-mono text-base sm:text-lg font-black text-rose-600 dark:text-rose-400 tabular-nums">
                {formatNumber(stats.totalOutstanding)}{" "}
                <span className="text-[10px] font-normal">{currencyLabel}</span>
              </p>
            </div>
          </div>

          {/* 3. نموذج إضافة أو تعديل مورد */}
          <div className="rounded-2xl border border-border/70 bg-card/90 backdrop-blur-md p-3.5 sm:p-4 shadow-2xs space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-black text-foreground flex items-center gap-1.5">
                <Plus className="h-3.5 w-3.5 text-primary" />
                <span>{editing ? `تعديل بيانات المورد: ${editing.name}` : "إضافة مورد جديد"}</span>
              </p>
              {editing && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setEditing(null);
                    setName("");
                    setPhone("");
                  }}
                  className="h-7 rounded-lg px-2 text-[11px] font-bold text-muted-foreground"
                >
                  إلغاء التعديل
                </Button>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_180px_auto] gap-2">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="اسم المورد أو الجهة المنفّذة"
                className="h-10 rounded-xl text-xs font-bold bg-background text-right"
              />
              <Input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="رقم الهاتف"
                className="h-10 rounded-xl text-xs font-bold bg-background text-right font-mono"
              />
              <Button
                type="button"
                onClick={() => void handleSave()}
                className="h-10 rounded-xl px-4 gap-1.5 text-xs font-black bg-primary hover:bg-primary/90 text-white shadow-xs shadow-primary/20"
              >
                {editing ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                <span>{editing ? "حفظ التعديل" : "إضافة مورد"}</span>
              </Button>
            </div>
          </div>

          {/* 4. قائمة الموردين مع البحث */}
          <div className="rounded-2xl border border-border/70 bg-card/90 backdrop-blur-md p-3 sm:p-4 shadow-2xs space-y-3">
            <div className="relative w-full md:max-w-sm">
              <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="ابحث باسم المورد أو رقم الهاتف..."
                className="h-9 rounded-xl pr-9 pl-8 text-xs font-bold bg-background text-right"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  aria-label="مسح البحث"
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {filtered.length === 0 ? (
              <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border/70 bg-muted/20 p-8 text-center">
                <Truck className="h-8 w-8 text-muted-foreground" />
                <p className="text-sm font-black text-foreground">
                  {suppliers.length === 0 ? "لا يوجد موردون بعد" : "لا توجد نتائج مطابقة للبحث"}
                </p>
                <p className="text-xs leading-relaxed text-muted-foreground max-w-md">
                  سجّل الموردين ومقدّمي الخدمات الإعلانية لتسجيل فواتير الشراء ومدفوعاتها بشكل تلقائي.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                {filtered.map((supplier) => {
                  const balance = outstanding[supplier.id] ?? 0;
                  return (
                    <div
                      key={supplier.id}
                      className="rounded-2xl border border-border/70 bg-card p-3.5 shadow-2xs transition-all hover:border-primary/40 flex flex-col justify-between gap-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1 space-y-1">
                          <p className="truncate text-sm font-black text-foreground">
                            {supplier.name}
                          </p>
                          <p className="flex items-center gap-1.5 text-[11px] font-bold text-muted-foreground">
                            <Phone className="h-3 w-3 shrink-0 text-primary/70" />
                            {supplier.phone ? (
                              <bdi dir="ltr" className="font-mono">{supplier.phone}</bdi>
                            ) : (
                              <span>بدون رقم هاتف</span>
                            )}
                          </p>
                        </div>

                        <div className="shrink-0 rounded-xl border border-border/60 bg-muted/20 px-2.5 py-1.5 text-center">
                          <p className="text-[9.5px] font-bold text-muted-foreground">
                            المستحق ({currencyLabel})
                          </p>
                          <p
                            className={cn(
                              "font-mono text-xs font-black tabular-nums mt-0.5",
                              balance > 0 ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400"
                            )}
                          >
                            {formatNumber(balance)}
                          </p>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 border-t border-border/50 pt-2.5">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setEditing(supplier);
                            setName(supplier.name);
                            setPhone(supplier.phone ?? "");
                          }}
                          className="h-8 rounded-xl gap-1 text-[11px] font-bold"
                        >
                          <Pencil className="h-3 w-3" />
                          <span>تعديل</span>
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          asChild
                          className="h-8 rounded-xl gap-1 text-[11px] font-bold"
                        >
                          <Link
                            to="/reports"
                            search={{ tab: "statements", supplierId: supplier.id, currency }}
                          >
                            <FileText className="h-3 w-3 text-primary" />
                            <span>كشف حساب</span>
                          </Link>
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => setPurchaseSupplier(supplier)}
                          className="h-8 rounded-xl gap-1 text-[11px] font-bold"
                        >
                          <ShoppingBag className="h-3 w-3 text-amber-600" />
                          <span>فاتورة شراء</span>
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => setPaySupplierId(supplier.id)}
                          className="h-8 rounded-xl gap-1 text-[11px] font-black bg-primary hover:bg-primary/90 text-white"
                        >
                          <Receipt className="h-3 w-3" />
                          <span>تسجيل دفعة</span>
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </main>

      <SupplierPaymentDialog
        open={Boolean(paySupplierId)}
        onOpenChange={(open) => !open && setPaySupplierId(null)}
        initialSupplierId={paySupplierId}
        defaultCurrency={currency}
      />

      <CustomInvoiceDialog
        open={Boolean(purchaseSupplier)}
        onOpenChange={(open) => !open && setPurchaseSupplier(null)}
        initialType="purchase"
        initialCurrency={currency}
        initialSupplierId={purchaseSupplier?.id}
        initialSupplier={purchaseSupplier}
        onSaved={(saved) => {
          setPurchaseSupplier(null);
          setPreviewInvoice(saved);
          void load();
        }}
      />

      {previewInvoice && (
        <BillingPreviewModal
          invoice={previewInvoice}
          open={Boolean(previewInvoice)}
          onOpenChange={(open) => !open && setPreviewInvoice(null)}
          onEdit={(inv) => {
            setPreviewInvoice(null);
            setEditingInvoice(inv);
          }}
        />
      )}

      {editingInvoice && (
        <CustomInvoiceDialog
          open={Boolean(editingInvoice)}
          onOpenChange={(open) => !open && setEditingInvoice(null)}
          initialType={editingInvoice.meta.type || "purchase"}
          invoiceToEdit={editingInvoice}
          onSaved={(saved) => {
            setEditingInvoice(null);
            setPreviewInvoice(saved);
            void load();
          }}
        />
      )}
    </PageShell>
  );
}

export default SuppliersPage;
