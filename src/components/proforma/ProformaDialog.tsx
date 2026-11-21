import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Eye, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProformaForm } from "./ProformaForm";
import { ProformaDocument } from "./ProformaDocument";
import { ProformaViewer } from "./ProformaViewer";
import { ProformaDialogHeader, ProformaDialogFooter } from "./ProformaDialogChrome";
import { peekNextProformaSerial } from "@/lib/proforma/serial";
import {
  saveProformaInvoice,
  convertProformaToOperatingInvoice,
  calculateProformaTotals,
} from "@/lib/proforma/store";
import type { ProformaInvoice, ProformaLine, ProformaMeta } from "@/lib/proforma/types";
import { detectInvoiceLanguage } from "@/lib/billing/languageHelper";
import { sanitizeCurrency } from "@/lib/currency/types";
import { getLocalIsoDate } from "@/lib/dateUtils";
import { findOrCreateCustomerByName } from "@/lib/customersStore";
import { router } from "@/router";
import { registerBackHandler } from "@/lib/backButtonHandler";
import { playTapSound, playSuccessSound, playErrorSound } from "@/lib/soundEffects";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onClose: () => void;
  initialLines?: ProformaLine[];
  existingInvoice?: ProformaInvoice;
  onConverted?: () => void;
}

const EMPTY_PROFORMA_LINES: ProformaLine[] = [];
const today = () => getLocalIsoDate();

export function ProformaDialog({
  open,
  onClose,
  initialLines = EMPTY_PROFORMA_LINES,
  existingInvoice,
  onConverted,
}: Props) {
  const [tab, setTab] = useState<"edit" | "preview">("edit");
  const [saved, setSaved] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveAsNewCustomer, setSaveAsNewCustomer] = useState(false);
  const draftIdRef = useRef<string>("");
  const saveLockRef = useRef(false);
  const [currentId, setCurrentId] = useState<string | undefined>(existingInvoice?.id);
  const [meta, setMeta] = useState<ProformaMeta>({
    serial: "0001",
    date: today(),
    customerName: "",
    customerEnName: "",
    phone: "",
    branch: "امدرمان",
  });
  const [lines, setLines] = useState<ProformaLine[]>([]);

  useEffect(() => {
    if (!open) return;
    const unregister = registerBackHandler(() => {
      onClose();
      return true;
    });
    return unregister;
  }, [open, onClose]);

  useEffect(() => {
    if (open) {
      saveLockRef.current = false;
      setIsSaving(false);
      setSaveAsNewCustomer(false);
      if (existingInvoice) {
        draftIdRef.current = existingInvoice.id;
        setCurrentId(existingInvoice.id);
        setMeta({
          ...existingInvoice.meta,
          currency: sanitizeCurrency(existingInvoice.currency || existingInvoice.meta.currency, "SDG"),
        });
        setLines(existingInvoice.lines);
        setSaved(true);
        setTab("preview");
      } else {
        const nextSerial = peekNextProformaSerial();
        draftIdRef.current = `proforma-${nextSerial}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        setCurrentId(undefined);
        setMeta({
          serial: nextSerial,
          date: today(),
          customerName: "",
          customerEnName: "",
          phone: "",
          branch: "امدرمان",
          currency: "SDG",
          language: "auto",
        });
        setLines(initialLines);
        setSaved(false);
        setTab(initialLines.length > 0 ? "preview" : "edit");
      }
    }
  }, [open, existingInvoice, initialLines]);

  const activeInvoice: ProformaInvoice = useMemo(() => {
    const currency = sanitizeCurrency(meta.currency, "SDG");
    const isRtl =
      detectInvoiceLanguage(meta.language, meta.customerName, meta.customerEnName, lines) === "ar";
    const totals = calculateProformaTotals(lines, currency, isRtl);
    return {
      id: currentId || existingInvoice?.id || draftIdRef.current || `proforma-${meta.serial}`,
      meta: { ...meta, currency },
      lines,
      ...totals,
      currency,
      status: existingInvoice?.status || "draft",
      createdAt: existingInvoice?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }, [meta, lines, existingInvoice, currentId]);

  const validateRequiredFields = (): boolean => {
    const hasCustomer = Boolean(meta.customerName?.trim() || meta.customerEnName?.trim());
    if (!hasCustomer) {
      playErrorSound();
      toast.error("يرجى إدخال اسم العميل (بالعربية أو بالإنجليزية)");
      return false;
    }
    if (lines.length === 0) {
      playErrorSound();
      toast.error("يرجى إضافة بند واحد على الأقل في الفاتورة");
      return false;
    }
    return true;
  };

  const maybeSaveNewCustomer = async (effectiveMeta: ProformaMeta) => {
    if (!saveAsNewCustomer) return null;
    const candidateName = (effectiveMeta.customerName || effectiveMeta.customerEnName || "").trim();
    if (!candidateName) return null;
    const outcome = await findOrCreateCustomerByName({
      name: candidateName,
      phone: effectiveMeta.phone,
      type: "client",
    });
    setSaveAsNewCustomer(false);
    return outcome;
  };

  const handleSave = async () => {
    if (saveLockRef.current || isSaving) return;
    if (!validateRequiredFields()) return;

    const effectiveMeta: ProformaMeta = {
      ...meta,
      customerName: meta.customerName?.trim() || "",
      customerEnName: meta.customerEnName?.trim() || undefined,
    };

    const stableId =
      currentId ||
      existingInvoice?.id ||
      draftIdRef.current ||
      (draftIdRef.current = `proforma-${meta.serial}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);

    saveLockRef.current = true;
    setIsSaving(true);
    try {
      const customerOutcome = await maybeSaveNewCustomer(effectiveMeta);
      const savedRecord = await saveProformaInvoice(effectiveMeta, lines, stableId);
      draftIdRef.current = savedRecord.id;
      setCurrentId(savedRecord.id);
      setSaved(true);
      playSuccessSound();
      toast.success(`تم حفظ الفاتورة المبدئية #${meta.serial} بنجاح`, {
        ...(customerOutcome
          ? {
              description: customerOutcome.created
                ? `تمت إضافة «${customerOutcome.customer.name}» لدليل العملاء`
                : `تم ربط العرض بملف «${customerOutcome.customer.name}»`,
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
    } catch (err) {
      playErrorSound();
      toast.error(err instanceof Error ? `تعذّر الحفظ: ${err.message}` : "تعذّر حفظ الفاتورة المبدئية");
    } finally {
      saveLockRef.current = false;
      setIsSaving(false);
    }
  };

  const handleConvert = async () => {
    if (saveLockRef.current || isSaving) return;
    if (!validateRequiredFields()) return;

    saveLockRef.current = true;
    setIsSaving(true);
    try {
      let targetId =
        currentId ||
        existingInvoice?.id ||
        draftIdRef.current ||
        (draftIdRef.current = `proforma-${meta.serial}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
      const effectiveMeta: ProformaMeta = {
        ...meta,
        customerName: meta.customerName?.trim() || "",
        customerEnName: meta.customerEnName?.trim() || undefined,
      };
      await maybeSaveNewCustomer(effectiveMeta);
      if (!saved) {
        const created = await saveProformaInvoice(effectiveMeta, lines, targetId);
        targetId = created.id;
        draftIdRef.current = created.id;
        setCurrentId(created.id);
        setSaved(true);
      }
      if (targetId) {
        const res = await convertProformaToOperatingInvoice(targetId);
        if (res) {
          playSuccessSound();
          toast.success(`تم تحويل الفاتورة المبدئية إلى طلب تشغيل رقم #${res.invRecord.serial}`);
          onConverted?.();
          onClose();
          return;
        }
      }
    } catch (err) {
      playErrorSound();
      toast.error(err instanceof Error ? `تعذّر التحويل: ${err.message}` : "تعذّر تحويل الفاتورة المبدئية");
    } finally {
      saveLockRef.current = false;
      setIsSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="فاتورة مبدئية"
      className="fixed inset-0 z-50 flex flex-col bg-background pt-[env(safe-area-inset-top,0px)] pb-[env(safe-area-inset-bottom,0px)] pl-[env(safe-area-inset-left,0px)] pr-[env(safe-area-inset-right,0px)] md:items-center md:justify-center md:bg-black/75 md:p-4"
      dir="rtl"
    >
      <div className="flex h-full w-full flex-col bg-card md:h-[94vh] md:max-h-[920px] md:max-w-6xl lg:max-w-7xl md:rounded-3xl md:border md:border-border/80 md:shadow-2xl overflow-hidden">
        <ProformaDialogHeader
          serial={meta.serial}
          saved={saved}
          isSaving={isSaving}
          partyName={meta.customerName || meta.customerEnName}
          totalAmount={activeInvoice.totalAmount}
          currency={meta.currency || "SDG"}
          onSave={handleSave}
          onClose={onClose}
        />

        {/* Mobile Tabs Switcher */}
        <div className="mx-3 my-2 grid shrink-0 grid-cols-2 rounded-xl bg-secondary p-1 md:hidden">
          <Button
            variant="ghost"
            aria-pressed={tab === "edit"}
            onClick={() => {
              playTapSound();
              setTab("edit");
            }}
            className={`flex h-8 items-center justify-center gap-1.5 rounded-lg text-xs font-bold transition ${
              tab === "edit" ? "bg-card text-blue-600 dark:text-blue-400 shadow-xs font-black" : "text-muted-foreground"
            }`}
          >
            <Pencil className="h-3.5 w-3.5" />
            <span>البيانات والبنود</span>
          </Button>

          <Button
            variant="ghost"
            aria-pressed={tab === "preview"}
            onClick={() => {
              playTapSound();
              setTab("preview");
            }}
            className={`flex h-8 items-center justify-center gap-1.5 rounded-lg text-xs font-bold transition ${
              tab === "preview" ? "bg-card text-blue-600 dark:text-blue-400 shadow-xs font-black" : "text-muted-foreground"
            }`}
          >
            <Eye className="h-3.5 w-3.5" />
            <span>معاينة الفاتورة</span>
          </Button>
        </div>

        {/* Modal Body */}
        <div className="flex flex-1 min-h-0 overflow-hidden">
          <div
            className={`w-full md:w-[480px] lg:w-[530px] shrink-0 border-l border-border/70 bg-card overflow-hidden flex flex-col ${
              tab === "edit" ? "flex" : "hidden md:flex"
            }`}
          >
            <ProformaForm
              meta={meta}
              lines={lines}
              saveAsNewCustomer={saveAsNewCustomer}
              onSaveAsNewCustomerChange={setSaveAsNewCustomer}
              onMetaChange={(m) => {
                setMeta(m);
                setSaved(false);
              }}
              onLinesChange={(l) => {
                setLines(l);
                setSaved(false);
              }}
            />
          </div>

          <div
            className={`flex-1 min-w-0 bg-slate-950 overflow-hidden p-1 md:p-3 flex items-center justify-center ${
              tab === "preview" ? "flex" : "hidden md:flex"
            }`}
          >
            <ProformaViewer invoice={activeInvoice} isVisible={tab === "preview"} />
          </div>
        </div>

        <ProformaDialogFooter
          tab={tab}
          isSaving={isSaving}
          onConvert={handleConvert}
          onToggleTab={() => setTab(tab === "edit" ? "preview" : "edit")}
        />
      </div>

      {typeof document !== "undefined" &&
        createPortal(
          <div className="proforma-print-root">
            <ProformaDocument invoice={activeInvoice} />
          </div>,
          document.body
        )}
    </div>
  );
}
