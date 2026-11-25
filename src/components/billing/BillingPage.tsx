import React, { Suspense, lazy, useState } from "react";
import { PageShell } from "@/components/layout/PageShell";
import { BillingCards } from "./BillingCards";
import { BillingArchiveTable } from "./BillingArchiveTable";
import { ReceiptDialog } from "@/components/finance/ReceiptDialog";
import { SupplierPaymentDialog } from "@/components/finance/SupplierPaymentDialog";
import { CustomInvoiceDialog } from "./CustomInvoiceDialog";
import { useCustomInvoices } from "@/lib/billing/store";
import type { CustomInvoice, CustomInvoiceType } from "@/lib/billing/types";
import type { ProformaInvoice } from "@/lib/proforma/types";
import type { InvoiceRecord } from "@/lib/invoicesStore";
import { InvoicesModalsManager } from "@/components/invoices/InvoicesModalsManager";
import { useUnifiedInvoices } from "@/components/invoices/useUnifiedInvoices";
import { Receipt, Plus, FileSignature } from "lucide-react";
import { Button } from "@/components/ui/button";

const LetterIssuerDialog = lazy(() => import("@/components/letters/LetterIssuerDialog"));

export function BillingPage() {
  const invoices = useCustomInvoices();
  const { stats } = useUnifiedInvoices();

  const [customDialogOpen, setCustomDialogOpen] = useState(false);
  const [letterDialogOpen, setLetterDialogOpen] = useState(false);
  const [receiptInvoiceId, setReceiptInvoiceId] = useState<string | null>(null);
  const [supplierPaymentInvoiceId, setSupplierPaymentInvoiceId] = useState<string | null>(null);
  const [dialogType, setDialogType] = useState<CustomInvoiceType>("sales");
  const [editingCustomInvoice, setEditingCustomInvoice] = useState<CustomInvoice | null>(null);

  const [previewCalcInvoice, setPreviewCalcInvoice] = useState<InvoiceRecord | null>(null);
  const [previewCustomInvoice, setPreviewCustomInvoice] = useState<CustomInvoice | null>(null);
  const [previewProformaInvoice, setPreviewProformaInvoice] = useState<ProformaInvoice | null>(null);
  const [editingProformaInvoice, setEditingProformaInvoice] = useState<ProformaInvoice | null>(null);

  const handleOpenCreate = (type: CustomInvoiceType) => {
    setEditingCustomInvoice(null);
    setDialogType(type);
    setCustomDialogOpen(true);
  };

  const handleEditCustomInvoice = (inv: CustomInvoice) => {
    setEditingCustomInvoice(inv);
    setDialogType(inv.meta.type);
    setCustomDialogOpen(true);
  };

  return (
    <PageShell>
      <main
        className="w-full flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-y-contain px-3 py-3 md:px-6 md:py-5 min-w-0 pb-36 md:pb-16"
        dir="rtl"
      >
        <div className="mx-auto max-w-7xl space-y-3 sm:space-y-4 w-full max-w-full">
          {/* شريط رأس قسم الفواتير التنفيذي المدمج (بدون مساحات مهدورة) */}
          <div className="flex items-center justify-between gap-3 bg-card/90 backdrop-blur-md p-3 sm:p-4 rounded-2xl border border-border/70 shadow-2xs border-r-4 border-r-primary">
            <div>
              <div className="flex items-center gap-2">
                <span className="grid h-8 w-8 place-items-center rounded-xl bg-primary/10 text-primary border border-primary/20 shrink-0">
                  <Receipt className="h-4 w-4" />
                </span>
                <h1 className="text-sm sm:text-base md:text-lg font-black text-foreground tracking-tight">
                  مركز الفواتير والمطالبات المالية
                </h1>
                <span className="text-[10.5px] sm:text-[11px] font-mono font-black text-primary px-2 py-0.5 rounded-full bg-primary/10 border border-primary/20 tabular-nums shrink-0">
                  {stats.totalCount} فاتورة
                </span>
              </div>
              <p className="text-[10.5px] sm:text-xs text-muted-foreground font-medium mt-1 leading-snug">
                إصدار وتوثيق عروض الأسعار وفواتير المبيعات والمشتريات A4 المعتمدة
              </p>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <Button
                type="button"
                variant="outline"
                onClick={() => setLetterDialogOpen(true)}
                className="h-9 px-3 sm:px-3.5 rounded-xl font-black text-xs gap-1.5 border-[#C5A059]/60 bg-card hover:bg-primary/5 text-primary active:scale-[0.98] transition-all cursor-pointer"
              >
                <FileSignature className="h-4 w-4 text-[#C5A059]" />
                <span>إصدار خطاب</span>
              </Button>
              <Button
                onClick={() => handleOpenCreate("sales")}
                className="hidden md:inline-flex h-9 px-4 rounded-xl font-black text-xs gap-1.5 bg-primary hover:bg-primary/90 text-white shadow-xs shadow-primary/30 active:scale-[0.98] transition-all cursor-pointer"
              >
                <Plus className="h-4 w-4" />
                <span>إصدار فاتورة بيع جديدة</span>
              </Button>
            </div>
          </div>

          <BillingCards invoices={invoices} onCreateClick={handleOpenCreate} />

          <div className="space-y-2 pt-1">
            <BillingArchiveTable
              invoices={invoices}
              onEditCustom={handleEditCustomInvoice}
              onPreviewCustom={(inv) => setPreviewCustomInvoice(inv)}
              onEditProforma={(proforma) => setEditingProformaInvoice(proforma)}
              onPreviewProforma={(proforma) => setPreviewProformaInvoice(proforma)}
              onRecordPayment={(invoiceId) => setReceiptInvoiceId(invoiceId)}
              onRecordPurchasePayment={(invoiceId) => setSupplierPaymentInvoiceId(invoiceId)}
              onPreviewCalc={(calc) => setPreviewCalcInvoice(calc)}
              onCreateNew={handleOpenCreate}
            />
          </div>

          <ReceiptDialog
            open={Boolean(receiptInvoiceId)}
            onOpenChange={(open) => !open && setReceiptInvoiceId(null)}
            initialInvoiceId={receiptInvoiceId}
          />

          <SupplierPaymentDialog
            open={Boolean(supplierPaymentInvoiceId)}
            onOpenChange={(open) => !open && setSupplierPaymentInvoiceId(null)}
            initialInvoiceId={supplierPaymentInvoiceId}
          />

          <CustomInvoiceDialog
            open={customDialogOpen}
            onOpenChange={(open) => {
              setCustomDialogOpen(open);
              if (!open) setEditingCustomInvoice(null);
            }}
            initialType={dialogType}
            invoiceToEdit={editingCustomInvoice}
            onSaved={(saved) => {
              setCustomDialogOpen(false);
              setEditingCustomInvoice(null);
              setPreviewCustomInvoice(saved);
            }}
          />

          <InvoicesModalsManager
            previewCalcInvoice={previewCalcInvoice}
            setPreviewCalcInvoice={setPreviewCalcInvoice}
            previewCustomInvoice={previewCustomInvoice}
            setPreviewCustomInvoice={setPreviewCustomInvoice}
            editingCustomInvoice={null}
            setEditingCustomInvoice={(inv) => {
              if (inv) handleEditCustomInvoice(inv);
              else setEditingCustomInvoice(null);
            }}
            previewProformaInvoice={previewProformaInvoice}
            setPreviewProformaInvoice={setPreviewProformaInvoice}
            editingProformaInvoice={editingProformaInvoice}
            setEditingProformaInvoice={setEditingProformaInvoice}
          />

          {letterDialogOpen && (
            <Suspense fallback={null}>
              <LetterIssuerDialog
                open={letterDialogOpen}
                onOpenChange={setLetterDialogOpen}
              />
            </Suspense>
          )}
        </div>
      </main>
    </PageShell>
  );
}
