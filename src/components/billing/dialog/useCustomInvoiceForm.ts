import { useState, useEffect, useRef, useMemo } from "react";
import type {
  CustomInvoice,
  CustomInvoiceItem,
  CustomInvoiceMeta,
  CustomInvoiceType,
} from "@/lib/billing/types";
import { INVOICE_TYPE_LABELS } from "@/lib/billing/types";
import {
  calculateCustomInvoiceTotals,
  convertProformaToSalesInvoice,
  saveCustomInvoice,
} from "@/lib/billing/store";
import { AppCurrency, sanitizeCurrency } from "@/lib/currency/types";
import { detectInvoiceLanguage } from "@/lib/billing/languageHelper";
import { getLocalIsoDate } from "@/lib/dateUtils";
import {
  findOrCreateCustomerByName,
  getCustomersSnapshot,
  type CustomerRecord,
  type CustomerType,
} from "@/lib/customersStore";
import { settlementFor, useSettlementVersion } from "@/lib/financeStore";
import { router } from "@/router";
import {
  printCustomInvoiceDocument,
  saveCustomInvoiceAsPdf,
  shareCustomInvoiceViaWhatsApp,
} from "../CustomInvoicePrintButton";
import { toast } from "sonner";
import { playSuccessSound, playErrorSound } from "@/lib/soundEffects";

interface UseCustomInvoiceFormParams {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialType?: CustomInvoiceType;
  initialCurrency?: AppCurrency;
  initialItems?: CustomInvoiceItem[];
  invoiceToEdit?: CustomInvoice | null;
  onSaved?: (invoice: CustomInvoice) => void;
  initialCustomerId?: string | null;
  initialCustomer?: CustomerRecord | null;
  initialSupplierId?: string | null;
  initialSupplier?: { id: string; name: string; phone?: string } | null;
}

const DEFAULT_SALUTATION = "بعد التحية والاحترام ،،،،،،،،";
const DEFAULT_CLOSING_NOTE = "لكم جزيل الشكر والتقدير ،،،،،،،،،،،،،،،،،،،،،،،";
const DEFAULT_ACCOUNT_NUMBER = "3283046";
const DEFAULT_ACCOUNT_NAME = "طارق عثمان علي";
const DEFAULT_SIGNATORY_TITLE = "الإدارة";

export function useCustomInvoiceForm({
  open,
  onOpenChange,
  initialType = "sales",
  initialCurrency,
  initialItems,
  invoiceToEdit,
  onSaved,
  initialCustomerId,
  initialCustomer,
  initialSupplierId,
  initialSupplier,
}: UseCustomInvoiceFormParams) {
  const [activeTab, setActiveTab] = useState<"edit" | "preview">("edit");
  const [type, setType] = useState<CustomInvoiceType>(initialType);
  const [serial, setSerial] = useState<string>("");
  const [customerId, setCustomerId] = useState<string | null>(invoiceToEdit?.customerId ?? null);
  const [supplierId, setSupplierId] = useState<string | null>(invoiceToEdit?.supplierId ?? null);
  const [supplierInvoiceNumber, setSupplierInvoiceNumber] = useState(invoiceToEdit?.supplierInvoiceNumber ?? "");
  const [savedReference, setSavedReference] = useState<string | undefined>(invoiceToEdit?.reference);
  const [currentInvoiceId, setCurrentInvoiceId] = useState<string | null>(invoiceToEdit?.id || null);
  const [date, setDate] = useState<string>("");
  const [partyName, setPartyName] = useState<string>("");
  const [partyEnName, setPartyEnName] = useState<string>("");
  const [attn, setAttn] = useState<string>("");
  const [phone, setPhone] = useState<string | undefined>(undefined);
  const [notes, setNotes] = useState<string | undefined>(undefined);
  const [dueDate, setDueDate] = useState<string | undefined>(undefined);
  const [discount, setDiscount] = useState<number | undefined>(undefined);
  const [salutation, setSalutation] = useState<string>(DEFAULT_SALUTATION);
  const [closingNote, setClosingNote] = useState<string>(DEFAULT_CLOSING_NOTE);
  const [accountNumber, setAccountNumber] = useState<string>(DEFAULT_ACCOUNT_NUMBER);
  const [accountName, setAccountName] = useState<string>(DEFAULT_ACCOUNT_NAME);
  const [signatoryTitle, setSignatoryTitle] = useState<string>(DEFAULT_SIGNATORY_TITLE);
  const [language, setLanguage] = useState<"auto" | "ar" | "en">("auto");
  const [currency, setCurrency] = useState<AppCurrency>("SDG");
  const [items, setItems] = useState<CustomInvoiceItem[]>([]);
  const [saveAsNewCustomer, setSaveAsNewCustomer] = useState(false);
  const [newCustomerType, setNewCustomerType] = useState<CustomerType>("client");
  const [newCustomerAddress, setNewCustomerAddress] = useState<string>("");
  const [isProcessing, setIsProcessing] = useState(false);
  const draftIdRef = useRef<string>("");
  const saveLockRef = useRef(false);

  const settlementVersion = useSettlementVersion();

  const isCustomerLocked = useMemo(() => {
    void settlementVersion;
    if (!invoiceToEdit || invoiceToEdit.meta.type !== "sales") return false;
    return settlementFor(invoiceToEdit.id, Number(invoiceToEdit.totalAmount) || 0).paid > 0.009;
  }, [invoiceToEdit, settlementVersion]);

  const isCurrencyLocked = useMemo(() => {
    void settlementVersion;
    if (!invoiceToEdit) return false;
    if (invoiceToEdit.meta.type !== "sales" && invoiceToEdit.meta.type !== "purchase") return false;
    return settlementFor(invoiceToEdit.id, Number(invoiceToEdit.totalAmount) || 0).paid > 0.009;
  }, [invoiceToEdit, settlementVersion]);

  useEffect(() => {
    if (!open) return;
    saveLockRef.current = false;
    setIsProcessing(false);
    setSaveAsNewCustomer(false);
    setNewCustomerType("client");
    setNewCustomerAddress("");

    if (invoiceToEdit) {
      draftIdRef.current = invoiceToEdit.id;
      setCurrentInvoiceId(invoiceToEdit.id);
      setType(invoiceToEdit.meta.type || "sales");
      setSerial(invoiceToEdit.meta.serial || "");
      setSavedReference(invoiceToEdit.reference);
      setCustomerId(invoiceToEdit.customerId ?? null);
      setSupplierId(invoiceToEdit.supplierId ?? null);
      setSupplierInvoiceNumber(invoiceToEdit.supplierInvoiceNumber ?? "");
      setDate(invoiceToEdit.meta.date || getLocalIsoDate());
      setPartyName(invoiceToEdit.meta.partyName || "");
      setPartyEnName(invoiceToEdit.meta.partyEnName || "");
      setAttn(invoiceToEdit.meta.attn || "");
      setPhone(invoiceToEdit.meta.phone);
      setNotes(invoiceToEdit.meta.notes);
      setDueDate(invoiceToEdit.meta.dueDate);
      setDiscount(invoiceToEdit.meta.discount);
      setSalutation(invoiceToEdit.meta.salutation || DEFAULT_SALUTATION);
      setClosingNote(invoiceToEdit.meta.closingNote || DEFAULT_CLOSING_NOTE);
      setAccountNumber(invoiceToEdit.meta.accountNumber || DEFAULT_ACCOUNT_NUMBER);
      setAccountName(invoiceToEdit.meta.accountName || DEFAULT_ACCOUNT_NAME);
      setSignatoryTitle(invoiceToEdit.meta.signatoryTitle || DEFAULT_SIGNATORY_TITLE);
      setLanguage(invoiceToEdit.meta.language || "auto");
      setCurrency(sanitizeCurrency(invoiceToEdit.currency || invoiceToEdit.meta.currency, "SDG"));
      setItems(invoiceToEdit.items || []);
    } else {
      draftIdRef.current = `custom-inv-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setCurrentInvoiceId(null);
      setType(initialType);
      setSerial("");
      setSavedReference(undefined);
      const prefilledSupplierId: string | null = initialSupplierId ?? initialSupplier?.id ?? null;
      setSupplierId(prefilledSupplierId);
      setSupplierInvoiceNumber("");
      setDate(getLocalIsoDate());

      const prefilledCustomerId: string | null = initialCustomerId ?? initialCustomer?.id ?? null;
      const resolvedCustomer =
        initialCustomer ??
        (prefilledCustomerId
          ? getCustomersSnapshot().find((c) => c.id === prefilledCustomerId) ?? null
          : null);
      const prefilledPartyName =
        resolvedCustomer?.name ?? (initialType === "purchase" ? initialSupplier?.name ?? "" : "");

      setCustomerId(prefilledCustomerId);
      setPartyName(prefilledPartyName);
      setPartyEnName("");
      setAttn("");
      setPhone(resolvedCustomer?.phone || initialSupplier?.phone || undefined);
      setNotes(undefined);
      setDueDate(undefined);
      setDiscount(undefined);
      setSalutation(DEFAULT_SALUTATION);
      setClosingNote(DEFAULT_CLOSING_NOTE);
      setAccountNumber(DEFAULT_ACCOUNT_NUMBER);
      setAccountName(DEFAULT_ACCOUNT_NAME);
      setSignatoryTitle(DEFAULT_SIGNATORY_TITLE);
      setLanguage("auto");
      setCurrency(
        sanitizeCurrency(initialCurrency || resolvedCustomer?.openingBalanceCurrency, "SDG")
      );

      if (initialItems && initialItems.length > 0) {
        setItems(initialItems);
      } else {
        setItems([
          {
            id: `item-${Date.now()}-1`,
            description: "",
            qty: 1,
            unitPrice: 0,
            total: 0,
          },
        ]);
      }
    }
    setActiveTab("edit");
  }, [open, invoiceToEdit, initialType, initialCurrency, initialItems, initialCustomerId, initialCustomer, initialSupplierId, initialSupplier]);

  const effectiveLang = useMemo(
    () => detectInvoiceLanguage(language, partyName, partyEnName, items),
    [language, partyName, partyEnName, items]
  );
  const isRtl = effectiveLang === "ar";
  const { totalAmount, totalInWords, subtotal } = useMemo(
    () => calculateCustomInvoiceTotals(items, currency, isRtl, discount),
    [items, currency, isRtl, discount]
  );

  const buildCurrentInvoice = (): CustomInvoice => {
    const meta: CustomInvoiceMeta = {
      serial: serial || "001",
      type,
      date: date || getLocalIsoDate(),
      partyName: (partyName || "").trim(),
      partyEnName: (partyEnName || "").trim() || undefined,
      attn: (attn || "").trim() || undefined,
      phone: (phone || "").trim() || undefined,
      notes,
      dueDate,
      discount,
      language,
      currency,
      salutation: salutation || DEFAULT_SALUTATION,
      closingNote: closingNote || DEFAULT_CLOSING_NOTE,
      accountNumber: accountNumber || DEFAULT_ACCOUNT_NUMBER,
      accountName: accountName || DEFAULT_ACCOUNT_NAME,
      signatoryTitle: signatoryTitle || DEFAULT_SIGNATORY_TITLE,
    };

    const stableId =
      currentInvoiceId ||
      invoiceToEdit?.id ||
      draftIdRef.current ||
      (draftIdRef.current = `custom-inv-${serial || Date.now()}-${Math.random().toString(36).slice(2, 7)}`);

    return {
      id: stableId,
      meta,
      items: items.map((it) => ({
        ...it,
        qty: it.qty || 1,
      })),
      totalAmount,
      subtotal,
      totalInWords,
      currency,
      supplierId: type === "purchase" ? supplierId ?? undefined : undefined,
      supplierInvoiceNumber: type === "purchase" ? supplierInvoiceNumber.trim() || undefined : undefined,
      customerId: type !== "purchase" ? customerId ?? undefined : undefined,
      reference: savedReference ?? invoiceToEdit?.reference,
      referenceAssignedAt: invoiceToEdit?.referenceAssignedAt,
      createdAt: invoiceToEdit?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  };

  const validateAndBuild = (): CustomInvoice | null => {
    const finalParty = (partyName || "").trim() || (partyEnName || "").trim();
    if (!finalParty) {
      playErrorSound();
      toast.error("حقل مطلوب", {
        description: "يرجى إدخال اسم العميل أو الجهة الاعتبارية",
      });
      return null;
    }
    const hasValidItem = items.some((item) => (item?.description || "").trim().length > 0);
    if (!hasValidItem) {
      playErrorSound();
      toast.error("حقل مطلوب", {
        description: "يرجى كتابة تفاصيل بند واحد على الأقل",
      });
      return null;
    }
    return buildCurrentInvoice();
  };

  const resolveCustomerBeforeSave = async (invoice: CustomInvoice): Promise<{
    invoice: CustomInvoice;
    customerOutcome: { customer: CustomerRecord; created: boolean; unarchived: boolean } | null;
  }> => {
    if (invoice.meta.type === "purchase" || invoice.customerId || !saveAsNewCustomer) {
      return { invoice, customerOutcome: null };
    }
    const candidateName = (invoice.meta.partyName || invoice.meta.partyEnName || "").trim();
    if (!candidateName) {
      return { invoice, customerOutcome: null };
    }
    const outcome = await findOrCreateCustomerByName({
      name: candidateName,
      phone: invoice.meta.phone,
      type: newCustomerType,
      address: newCustomerAddress,
    });
    setCustomerId(outcome.customer.id);
    setSaveAsNewCustomer(false);
    setNewCustomerAddress("");
    return {
      invoice: {
        ...invoice,
        customerId: outcome.customer.id,
        meta: {
          ...invoice.meta,
          phone: invoice.meta.phone || outcome.customer.phone || undefined,
        },
      },
      customerOutcome: outcome,
    };
  };

  const runLockedSave = async (
    describeSuccess: (saved: CustomInvoice) => string,
    afterSave: (saved: CustomInvoice) => Promise<unknown> | unknown
  ) => {
    if (saveLockRef.current || isProcessing) return;
    const invoice = validateAndBuild();
    if (!invoice) return;

    saveLockRef.current = true;
    setIsProcessing(true);
    try {
      const { invoice: resolvedInvoice, customerOutcome } = await resolveCustomerBeforeSave(invoice);
      const saved = await saveCustomInvoice(resolvedInvoice);
      draftIdRef.current = saved.id;
      setCurrentInvoiceId(saved.id);
      setSavedReference(saved.reference);
      playSuccessSound();
      const baseDesc = describeSuccess(saved);
      const description = customerOutcome?.created
        ? `${baseDesc} · وتمت إضافة «${customerOutcome.customer.name}» لدليل العملاء`
        : customerOutcome?.unarchived
        ? `${baseDesc} · وتمت استعادة «${customerOutcome.customer.name}» من الأرشيف`
        : baseDesc;

      toast.success("تم حفظ الفاتورة", {
        description,
        ...(customerOutcome
          ? {
              action: {
                label: "فتح ملف العميل",
                onClick: () =>
                  void router.navigate({
                    to: "/customers",
                    search: { id: customerOutcome.customer.id },
                  }),
              },
            }
          : {}),
      });
      onSaved?.(saved);
      await afterSave(saved);
    } catch (err) {
      playErrorSound();
      toast.error("تعذّر حفظ الفاتورة", {
        description: err instanceof Error ? err.message : "خطأ غير متوقع أثناء حفظ الفاتورة.",
      });
    } finally {
      saveLockRef.current = false;
      setIsProcessing(false);
    }
  };

  const handleSave = () =>
    runLockedSave(
      (saved) => `تم حفظ ${INVOICE_TYPE_LABELS[type]} بالمرجع ${saved.reference || "—"}`,
      () => onOpenChange(false)
    );

  const handleSaveAndPrint = () =>
    runLockedSave(
      (saved) => `تم حفظ ${INVOICE_TYPE_LABELS[type]} بالمرجع ${saved.reference || "—"} وجاري تشغيل أمر الطباعة...`,
      (saved) => printCustomInvoiceDocument(saved)
    );

  const handleSaveAndExportPdf = () =>
    runLockedSave(
      (saved) => `تم حفظ ${INVOICE_TYPE_LABELS[type]} بالمرجع ${saved.reference || "—"} وجاري تصدير وحفظ ملف PDF...`,
      (saved) => saveCustomInvoiceAsPdf(saved)
    );

  const handleSaveAndShareWhatsApp = () =>
    runLockedSave(
      (saved) => `تم حفظ ${INVOICE_TYPE_LABELS[type]} بالمرجع ${saved.reference || "—"} وجاري مشاركتها عبر واتساب...`,
      (saved) => shareCustomInvoiceViaWhatsApp(saved)
    );

  const handleConvertToSales = async () => {
    if (saveLockRef.current || isProcessing || type !== "proforma") return;
    const invoice = validateAndBuild();
    if (!invoice) return;

    saveLockRef.current = true;
    setIsProcessing(true);
    try {
      const { invoice: resolvedInvoice, customerOutcome } = await resolveCustomerBeforeSave(invoice);
      const savedProforma = await saveCustomInvoice(resolvedInvoice);
      draftIdRef.current = savedProforma.id;
      setCurrentInvoiceId(savedProforma.id);
      setSavedReference(savedProforma.reference);

      const { salesInvoice, alreadyConverted } = await convertProformaToSalesInvoice(savedProforma, {
        customerId: savedProforma.customerId ?? customerId,
      });
      playSuccessSound();
      toast.success(
        alreadyConverted ? "العرض محوَّل مسبقاً" : "تم التحويل إلى فاتورة مبيعات",
        {
          description: customerOutcome?.created
            ? `فاتورة المبيعات ${salesInvoice.reference || "—"} محفوظة وتمت إضافة «${customerOutcome.customer.name}» لدليل العملاء.`
            : `فاتورة المبيعات بالمرجع ${salesInvoice.reference || "—"} محفوظة في سجل المبيعات.`,
        }
      );
      onSaved?.(salesInvoice);
      onOpenChange(false);
    } catch (err) {
      playErrorSound();
      toast.error("تعذّر التحويل إلى فاتورة مبيعات", {
        description: err instanceof Error ? err.message : "خطأ غير متوقع أثناء التحويل.",
      });
    } finally {
      saveLockRef.current = false;
      setIsProcessing(false);
    }
  };

  const previewInvoice = buildCurrentInvoice();

  return {
    activeTab,
    setActiveTab,
    type,
    setType,
    serial,
    customerId,
    setCustomerId,
    supplierId,
    setSupplierId,
    supplierInvoiceNumber,
    setSupplierInvoiceNumber,
    savedReference,
    date,
    setDate,
    partyName,
    setPartyName,
    partyEnName,
    setPartyEnName,
    attn,
    setAttn,
    phone: phone || "",
    setPhone: (v: string) => setPhone(v || undefined),
    saveAsNewCustomer,
    setSaveAsNewCustomer,
    newCustomerType,
    setNewCustomerType,
    newCustomerAddress,
    setNewCustomerAddress,
    isCustomerLocked,
    isCurrencyLocked,
    language,
    setLanguage,
    currency,
    setCurrency,
    items,
    setItems,
    isProcessing,
    totalAmount,
    totalInWords,
    previewInvoice,
    handleSave,
    handleSaveAndPrint,
    handleSaveAndExportPdf,
    handleSaveAndShareWhatsApp,
    handleConvertToSales,
  };
}

export default useCustomInvoiceForm;
