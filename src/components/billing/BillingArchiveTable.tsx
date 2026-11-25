import React, { useEffect, useMemo, useState } from "react";
import {
  Search,
  FileText,
  TrendingUp,
  ShoppingBag,
  Calculator,
  UserCheck,
  UserPlus,
  ChevronDown,
} from "lucide-react";
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
import type { CustomInvoice, CustomInvoiceType } from "@/lib/billing/types";
import type { ProformaInvoice } from "@/lib/proforma/types";
import type { InvoiceRecord } from "@/lib/invoicesStore";
import {
  convertProformaToSalesInvoice,
  deleteCustomInvoice,
  linkCustomInvoiceToCustomer,
  saveCustomInvoice,
} from "@/lib/billing/store";
import {
  findOrCreateCustomerByName,
  useCustomers,
  type CustomerRecord,
} from "@/lib/customersStore";
import { normalizeCustomerName } from "@/lib/customers/customerMatching";
import { deleteProformaInvoice } from "@/lib/proforma/store";
import { deleteInvoice } from "@/lib/invoicesStore";
import { getLocalIsoDate } from "@/lib/dateUtils";
import { router } from "@/router";
import { formatAccountingNumber } from "./StandardInvoiceDocument";
import {
  printCustomInvoiceDocument,
  shareCustomInvoiceViaWhatsApp,
} from "./CustomInvoicePrintButton";
import { BillingArchiveRowActions } from "./BillingArchiveRowActions";
import { toast } from "sonner";
import { useUnifiedInvoices } from "@/components/invoices/useUnifiedInvoices";
import { settlementFor, useSettlementVersion } from "@/lib/financeStore";
import type { UnifiedInvoiceRecord } from "@/components/invoices/types";
import { getCurrencyShortLabel } from "@/lib/currency/currencyFormat";

const ARCHIVE_PAGE_CHUNK = 50;

interface Props {
  invoices?: CustomInvoice[];
  onEditCustom: (invoice: CustomInvoice) => void;
  onPreviewCustom: (invoice: CustomInvoice) => void;
  onEditProforma?: (invoice: ProformaInvoice) => void;
  onPreviewProforma?: (invoice: ProformaInvoice) => void;
  onRecordPayment?: (invoiceId: string) => void;
  onRecordPurchasePayment?: (invoiceId: string) => void;
  onPreviewCalc?: (invoice: InvoiceRecord) => void;
  onCreateNew?: (type: CustomInvoiceType) => void;
}

export function BillingArchiveTable({
  onEditCustom,
  onPreviewCustom,
  onEditProforma,
  onPreviewProforma,
  onRecordPayment,
  onRecordPurchasePayment,
  onPreviewCalc,
}: Props) {
  const customers = useCustomers();
  const { customersById, customersByNormName } = useMemo(() => {
    const byId = new Map<string, CustomerRecord>();
    const byName = new Map<string, CustomerRecord>();
    for (const c of customers) {
      byId.set(c.id, c);
      if (!c.isArchived) {
        const norm = normalizeCustomerName(c.name);
        if (norm && !byName.has(norm)) {
          byName.set(norm, c);
        }
      }
    }
    return { customersById: byId, customersByNormName: byName };
  }, [customers]);

  const [search, setSearch] = useState("");
  const [selectedType, setSelectedType] = useState<string>("all");
  const [visibleCount, setVisibleCount] = useState<number>(ARCHIVE_PAGE_CHUNK);
  const [convertingId, setConvertingId] = useState<string | null>(null);
  const [sharingId, setSharingId] = useState<string | null>(null);
  const [linkingInvoiceId, setLinkingInvoiceId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<UnifiedInvoiceRecord | null>(null);

  useEffect(() => {
    setVisibleCount(ARCHIVE_PAGE_CHUNK);
  }, [search, selectedType]);

  const handleOpenCustomerProfile = (customerId: string) => {
    void router.navigate({ to: "/customers", search: { id: customerId } });
  };

  const handleSaveWalkInAsCustomer = async (inv: CustomInvoice) => {
    const partyName = (inv.meta.partyName || inv.meta.partyEnName || "").trim();
    if (!partyName || linkingInvoiceId) return;
    setLinkingInvoiceId(inv.id);
    try {
      const { customer, created, unarchived } = await findOrCreateCustomerByName({
        name: partyName,
        phone: inv.meta.phone,
        type: "client",
      });
      await linkCustomInvoiceToCustomer(inv.id, customer.id);
      const statusText = created
        ? `تمت إضافة «${customer.name}» لدليل العملاء وربط الفاتورة بملفه`
        : unarchived
        ? `تمت استعادة «${customer.name}» من الأرشيف وربط الفاتورة بملفه`
        : `تم ربط الفاتورة بملف «${customer.name}» المسجّل مسبقاً`;

      toast.success("تم التوثيق والربط بنجاح", {
        description: statusText,
        action: {
          label: "فتح ملف العميل",
          onClick: () => handleOpenCustomerProfile(customer.id),
        },
      });
    } catch (err) {
      toast.error("تعذّر ربط الفاتورة بملف عميل", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setLinkingInvoiceId(null);
    }
  };

  const handleConvertProformaToSales = async (rec: UnifiedInvoiceRecord) => {
    if (convertingId) return;
    if (!(rec.kind === "proforma" || (rec.kind === "custom" && rec.type === "proforma"))) return;
    setConvertingId(rec.id);
    try {
      const { salesInvoice, alreadyConverted } = await convertProformaToSalesInvoice(
        rec.raw as CustomInvoice | ProformaInvoice
      );
      toast.success(
        alreadyConverted ? "العرض محوَّل مسبقاً" : "تم التحويل إلى فاتورة مبيعات",
        {
          description: `فاتورة المبيعات ${salesInvoice.reference || "—"} محفوظة في سجل المبيعات.`,
        }
      );
    } catch (err) {
      toast.error("تعذّر التحويل إلى فاتورة مبيعات", {
        description: err instanceof Error ? err.message : "خطأ غير متوقع.",
      });
    } finally {
      setConvertingId(null);
    }
  };

  useSettlementVersion();
  const { filteredRecords } = useUnifiedInvoices(search, selectedType);

  const executeDelete = async (rec: UnifiedInvoiceRecord) => {
    try {
      if (rec.kind === "proforma") await deleteProformaInvoice(rec.id);
      else if (rec.kind === "custom") await deleteCustomInvoice(rec.id);
      else if (rec.kind === "calculator") deleteInvoice(rec.id);
      toast.success("تم الحذف", { description: `تم حذف ${rec.typeLabel} #${rec.serial} بنجاح` });
    } catch (err) {
      toast.error("تعذّر الحذف", { description: err instanceof Error ? err.message : undefined });
    } finally {
      setPendingDelete(null);
    }
  };

  const handleDuplicate = async (rec: UnifiedInvoiceRecord) => {
    if (rec.kind !== "custom") {
      toast("تنبيه", { description: "يمكن تكرار فواتير المبيعات والمشتريات السريعة مباشرة من هنا" });
      return;
    }
    const inv = rec.raw as CustomInvoice;
    // BUG-009: Preserve original customer/party name untouched on duplication and never stack "(نسخة)"
    const cleanPartyName =
      String(inv.meta.partyName ?? "")
        .replace(/(?:\s*\(نسخة\))+$/g, "")
        .trim() || inv.meta.partyName;

    const duplicated: CustomInvoice = {
      ...inv,
      id: `custom-inv-${Date.now()}`,
      reference: undefined,
      referenceAssignedAt: undefined,
      meta: { ...inv.meta, partyName: cleanPartyName, date: getLocalIsoDate() },
      items: (inv.items || []).map((item, index) => ({
        ...item,
        id: `dup-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 6)}`,
      })),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    try {
      const saved = await saveCustomInvoice(duplicated);
      toast.success("تم تكرار الفاتورة", { description: `تم إنشاء نسخة جديدة بالمرجع ${saved.reference || "—"}` });
    } catch (err) {
      toast.error("تعذّر تكرار الفاتورة", { description: err instanceof Error ? err.message : "خطأ غير متوقع." });
    }
  };

  const handlePrintCustom = async (invoice: CustomInvoice) => {
    try {
      await printCustomInvoiceDocument(invoice);
    } catch (err) {
      toast.error("تعذّرت الطباعة", {
        description: err instanceof Error ? err.message : "حدث خطأ غير متوقع أثناء الطباعة.",
      });
    }
  };

  const handleShareCustom = async (rec: UnifiedInvoiceRecord) => {
    if (sharingId || rec.kind !== "custom") return;
    setSharingId(rec.id);
    try {
      await shareCustomInvoiceViaWhatsApp(rec.raw as CustomInvoice);
    } catch (err) {
      toast.error("تعذّرت المشاركة", {
        description: err instanceof Error ? err.message : "حدث خطأ أثناء مشاركة الفاتورة.",
      });
    } finally {
      setSharingId(null);
    }
  };

  const visibleRecords = useMemo(
    () => filteredRecords.slice(0, visibleCount),
    [filteredRecords, visibleCount]
  );

  return (
    <div className="rounded-2xl sm:rounded-3xl border border-border/60 bg-card/95 shadow-md overflow-hidden w-full max-w-full" dir="rtl">
      <div className="p-3.5 sm:p-5 border-b border-border/50 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 md:gap-4">
        <div className="flex items-center gap-1 sm:gap-1.5 p-1 rounded-2xl bg-muted/60 w-full md:w-auto overflow-x-auto scrollbar-none overscroll-x-contain flex-nowrap shrink-0">
          {(
            [
              { id: "all", label: "كافة الفواتير" },
              { id: "sales", label: "فواتير مبيعات" },
              { id: "proforma", label: "فواتير مبدئية" },
              { id: "purchase", label: "فواتير مشتريات" },
            ] as const
          ).map((tab) => {
            const active = selectedType === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setSelectedType(tab.id)}
                className={`shrink-0 whitespace-nowrap px-3 sm:px-3.5 py-1.5 rounded-xl text-xs font-black transition-all touch-manipulation active:scale-95 ${
                  active
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        <div className="relative w-full md:w-72">
          <Search className="absolute right-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="بحث باسم العميل، الرقم، أو البنود..."
            className="h-10 pr-10 pl-3 rounded-2xl text-xs font-bold bg-background border-border/60 text-right"
            dir="rtl"
          />
        </div>
      </div>

      <div
        className="overflow-x-auto overscroll-x-contain w-full max-w-full"
        data-testid="billing-archive-scroll-box"
      >
        <table className="w-full text-right text-xs table-auto">
          <thead>
            <tr className="bg-muted/40 text-muted-foreground font-black border-b border-border/50 h-10 sm:h-11">
              <th className="py-2 px-2 sm:px-3.5 text-center whitespace-nowrap">الرقم</th>
              <th className="py-2 px-2 sm:px-3.5 whitespace-nowrap">نوع الفاتورة</th>
              <th className="py-2 px-2 sm:px-3.5 min-w-[140px] sm:min-w-[175px]">العميل / الجهة</th>
              <th className="hidden md:table-cell py-2 px-3 text-center whitespace-nowrap">التاريخ</th>
              <th className="hidden lg:table-cell py-2 px-3 whitespace-nowrap">البنود</th>
              <th className="py-2 px-2 sm:px-3.5 text-left whitespace-nowrap">إجمالي القيمة</th>
              <th className="py-2 px-2 sm:px-3.5 text-center whitespace-nowrap">الإجراءات</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/40">
            {filteredRecords.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-12 text-center text-muted-foreground">
                  <div className="flex flex-col items-center justify-center space-y-2">
                    <FileText className="h-10 w-10 text-muted-foreground/40" />
                    <p className="text-sm font-bold text-foreground">لا توجد فواتير مطابقة للبحث</p>
                    <p className="text-xs text-muted-foreground">
                      كافة الفواتير الصادرة والمحفوظة في النظام ستظهر هنا تلقائياً
                    </p>
                  </div>
                </td>
              </tr>
            ) : (
              visibleRecords.map((rec) => {
                const isCustom = rec.kind === "custom";
                const isProforma = rec.kind === "proforma";
                const isCalc = rec.kind === "calculator";
                const settlement = settlementFor(rec.id, Number(rec.total) || 0);

                return (
                  <tr
                    key={`${rec.kind}-${rec.id}`}
                    className="hover:bg-muted/30 transition-colors group text-foreground font-bold align-middle"
                  >
                    <td className="py-2.5 px-2 sm:px-3.5 text-center whitespace-nowrap">
                      <bdi dir="ltr" className="font-mono font-black text-primary text-[11px] sm:text-xs">
                        {/^(INV|PINV|RCV|PAY|EXP)-/.test(rec.serial) ? rec.serial : `#${rec.serial}`}
                      </bdi>
                      <span className="md:hidden block mt-0.5 text-[10px] font-mono text-muted-foreground">
                        <bdi dir="ltr">{rec.date}</bdi>
                      </span>
                    </td>

                    <td className="py-2.5 px-2 sm:px-3.5 whitespace-nowrap">
                      <span className={`inline-flex items-center gap-1 px-2 sm:px-2.5 py-0.5 rounded-full text-[10px] sm:text-[10.5px] font-black border ${rec.badgeColor}`}>
                        {isProforma && <FileText className="h-3 w-3 shrink-0" />}
                        {isCustom && rec.type === "sales" && <TrendingUp className="h-3 w-3 shrink-0" />}
                        {isCustom && rec.type === "purchase" && <ShoppingBag className="h-3 w-3 shrink-0" />}
                        {isCalc && <Calculator className="h-3 w-3 shrink-0" />}
                        <span>{rec.typeLabel}</span>
                      </span>
                      <span className="lg:hidden block mt-0.5 text-[10px] font-medium text-muted-foreground">
                        {rec.itemsCount > 0 ? `${rec.itemsCount} بند` : "تفاصيل عامة"}
                      </span>
                    </td>

                    <td className="py-2.5 px-2 sm:px-3.5 font-black text-xs sm:text-sm text-foreground min-w-[140px] sm:min-w-[175px] max-w-[260px]">
                      {isCustom && rec.type !== "purchase" ? (
                        (() => {
                          const linkedCustomer = rec.raw.customerId
                            ? customersById.get(rec.raw.customerId)
                            : undefined;
                          const matchedByName = !linkedCustomer
                            ? customersByNormName.get(normalizeCustomerName(rec.customerName))
                            : undefined;

                          if (linkedCustomer) {
                            return (
                              <button
                                type="button"
                                onClick={() => handleOpenCustomerProfile(linkedCustomer.id)}
                                className="inline-flex items-start gap-1.5 text-right text-foreground hover:text-primary transition-colors cursor-pointer group/cust leading-snug break-words"
                                title="فتح ملف العميل وكشف الحساب"
                              >
                                <UserCheck className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
                                <span className="group-hover/cust:underline break-words">{rec.customerName}</span>
                              </button>
                            );
                          }

                          return (
                            <div className="space-y-1 min-w-0">
                              <span className="block leading-snug break-words">{rec.customerName}</span>
                              <div className="flex flex-wrap items-center gap-1">
                                {!matchedByName && (
                                  <span className="rounded-full border border-border/70 bg-secondary/60 px-1.5 py-0.2 text-[9.5px] font-bold text-muted-foreground whitespace-nowrap">
                                    عابر
                                  </span>
                                )}
                                <button
                                  type="button"
                                  disabled={linkingInvoiceId === rec.id}
                                  onClick={() => void handleSaveWalkInAsCustomer(rec.raw)}
                                  className="inline-flex items-center gap-1 rounded-lg border border-primary/30 bg-primary/5 px-1.5 py-0.5 text-[10px] font-black text-primary hover:bg-primary hover:text-white transition-colors cursor-pointer disabled:opacity-50 whitespace-nowrap"
                                  title={
                                    matchedByName
                                      ? `ربط هذه الفاتورة بملف ${matchedByName.name}`
                                      : "حفظ في دليل العملاء وربط الفاتورة"
                                  }
                                >
                                  <UserPlus className="h-3 w-3 shrink-0" />
                                  <span>{matchedByName ? "ربط بملفه" : "حفظ كعميل"}</span>
                                </button>
                              </div>
                            </div>
                          );
                        })()
                      ) : isProforma ? (
                        (() => {
                          const matched = customersByNormName.get(normalizeCustomerName(rec.customerName));
                          return matched ? (
                            <button
                              type="button"
                              onClick={() => handleOpenCustomerProfile(matched.id)}
                              className="inline-flex items-start gap-1.5 text-right text-foreground hover:text-primary hover:underline transition-colors cursor-pointer leading-snug break-words"
                              title="فتح ملف العميل"
                            >
                              <UserCheck className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
                              <span className="break-words">{rec.customerName}</span>
                            </button>
                          ) : (
                            <span className="block leading-snug break-words">{rec.customerName}</span>
                          );
                        })()
                      ) : (
                        <span className="block leading-snug break-words">{rec.customerName}</span>
                      )}
                    </td>

                    <td className="hidden md:table-cell py-2.5 px-3 text-center font-mono text-muted-foreground whitespace-nowrap">
                      <bdi dir="ltr">{rec.date}</bdi>
                    </td>

                    <td className="hidden lg:table-cell py-2.5 px-3 max-w-[160px] truncate text-muted-foreground">
                      {rec.itemsCount > 0 ? `${rec.itemsCount} بند مسجل` : "تفاصيل عامة"}
                    </td>

                    <td className="py-2.5 px-2 sm:px-3.5 text-left font-mono text-xs sm:text-sm whitespace-nowrap">
                      <span className="font-black text-foreground">
                        <bdi dir="ltr" className="tabular-nums">{formatAccountingNumber(rec.total)}</bdi>{" "}
                        <span className="text-[10px] font-mono font-bold text-muted-foreground uppercase">{rec.currency || "SDG"}</span>
                      </span>
                      {isCustom && (rec.type === "sales" || rec.type === "purchase") && (
                        <span
                          className={`mt-0.5 block text-[10px] font-sans font-bold ${
                            settlement.outstanding > 0
                              ? rec.type === "purchase"
                                ? "text-rose-600 dark:text-rose-400"
                                : "text-amber-600 dark:text-amber-400"
                              : "text-emerald-600 dark:text-emerald-400"
                          }`}
                        >
                          {settlement.outstanding > 0 ? (
                            <>
                              <span>متبقي </span>
                              <bdi dir="ltr" className="font-mono tabular-nums">
                                {formatAccountingNumber(settlement.outstanding)}
                              </bdi>{" "}
                              <span>{getCurrencyShortLabel(rec.currency)}</span>
                            </>
                          ) : (
                            "مسدَّدة"
                          )}
                        </span>
                      )}
                    </td>

                    <td className="py-2.5 px-1.5 sm:px-3 text-center">
                      <BillingArchiveRowActions
                        rec={rec}
                        outstanding={settlement.outstanding}
                        convertingId={convertingId}
                        sharingId={sharingId}
                        onRecordPayment={onRecordPayment}
                        onRecordPurchasePayment={onRecordPurchasePayment}
                        onConvertProformaToSales={(r) => void handleConvertProformaToSales(r)}
                        onPreviewCustom={onPreviewCustom}
                        onPreviewProforma={onPreviewProforma}
                        onPreviewCalc={onPreviewCalc}
                        onPrintCustom={(inv) => void handlePrintCustom(inv)}
                        onShareCustom={(r) => void handleShareCustom(r)}
                        onEditCustom={onEditCustom}
                        onEditProforma={onEditProforma}
                        onDuplicate={(r) => void handleDuplicate(r)}
                        onRequestDelete={(r) => setPendingDelete(r)}
                      />
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {filteredRecords.length > visibleCount && (
        <div className="flex items-center justify-center border-t border-border/40 p-3">
          <button
            type="button"
            onClick={() => setVisibleCount((prev) => prev + ARCHIVE_PAGE_CHUNK)}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-black bg-primary/10 hover:bg-primary/20 text-primary border border-primary/25 transition-all cursor-pointer active:scale-95 touch-manipulation"
          >
            <ChevronDown className="h-4 w-4" />
            <span>
              عرض المزيد من الفواتير ({filteredRecords.length - visibleCount} فاتورة إضافية)
            </span>
          </button>
        </div>
      )}

      <AlertDialog open={Boolean(pendingDelete)} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent dir="rtl" className="rounded-3xl">
          <AlertDialogHeader className="text-right">
            <AlertDialogTitle className="font-black text-base">
              تأكيد حذف المستند
            </AlertDialogTitle>
            <AlertDialogDescription className="text-xs leading-relaxed">
              {pendingDelete
                ? `هل أنت متأكد من حذف ${pendingDelete.typeLabel} #${pendingDelete.serial} لـ «${pendingDelete.customerName}»؟`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:justify-start">
            <AlertDialogCancel className="rounded-xl text-xs font-bold">إلغاء</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => pendingDelete && void executeDelete(pendingDelete)}
              className="rounded-xl text-xs font-black bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              تأكيد الحذف
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
