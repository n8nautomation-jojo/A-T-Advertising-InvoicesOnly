import React, { useEffect } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Edit3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type {
  CustomInvoice,
  CustomInvoiceItem,
  CustomInvoiceType,
} from "@/lib/billing/types";
import { StandardInvoiceViewer } from "./StandardInvoiceViewer";
import { CustomInvoiceTypeSelector } from "./dialog/CustomInvoiceTypeSelector";
import { CustomInvoiceMetaSection } from "./dialog/CustomInvoiceMetaSection";
import { CustomInvoiceDialogHeader } from "./dialog/CustomInvoiceDialogHeader";
import { CustomInvoiceDialogFooter } from "./dialog/CustomInvoiceDialogFooter";
import { CustomInvoiceItemsTable } from "./dialog/CustomInvoiceItemsTable";
import { registerBackHandler } from "@/lib/backButtonHandler";
import { playTapSound } from "@/lib/soundEffects";
import { useCustomInvoiceForm } from "./dialog/useCustomInvoiceForm";
import type { CustomerRecord } from "@/lib/customersStore";
import { router } from "@/router";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialType?: CustomInvoiceType;
  initialItems?: CustomInvoiceItem[];
  invoiceToEdit?: CustomInvoice | null;
  onSaved?: (invoice: CustomInvoice) => void;
  initialCustomerId?: string | null;
  initialCustomer?: CustomerRecord | null;
  initialSupplierId?: string | null;
  initialSupplier?: { id: string; name: string; phone?: string } | null;
}

/**
 * نافذة إصدار وتعديل الفواتير التجارية المعتمدة (مبيعات / عروض أسعار / مشتريات):
 * - تدعم كافة الأنشطة والمبيعات والخدمات التجارية العامة
 * - إدخال بيانات فائق البساطة والوضوح بمرشدات بصرية واضحة
 * - زر معاينة الفاتورة A4 بارز ومباشر في الترويسة وأسفل جدول البنود
 */
export function CustomInvoiceDialog({
  open,
  onOpenChange,
  initialType = "sales",
  initialItems,
  invoiceToEdit,
  onSaved,
  initialCustomerId,
  initialCustomer,
  initialSupplierId,
  initialSupplier,
}: Props) {
  useEffect(() => {
    if (!open) return;
    const unregister = registerBackHandler(() => {
      onOpenChange(false);
      return true;
    });
    return unregister;
  }, [open, onOpenChange]);

  const form = useCustomInvoiceForm({
    open,
    onOpenChange,
    initialType,
    initialItems,
    invoiceToEdit,
    onSaved,
    initialCustomerId,
    initialCustomer,
    initialSupplierId,
    initialSupplier,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="w-full sm:max-w-4xl h-[100dvh] sm:h-[90vh] max-h-[100dvh] sm:max-h-[90vh] flex flex-col p-0 overflow-hidden bg-card border-border/80 rounded-none sm:rounded-3xl shadow-2xl"
        dir="rtl"
      >
        {/* ترويسة النافذة مع شريط التبديل البارز جداً للمعاينة */}
        <CustomInvoiceDialogHeader
          type={form.type}
          invoiceToEdit={invoiceToEdit}
          savedReference={form.savedReference}
          serial={form.serial}
          activeTab={form.activeTab}
          onTabChange={form.setActiveTab}
          itemsCount={form.items.length}
        />

        <Tabs
          value={form.activeTab}
          onValueChange={(v) => {
            playTapSound();
            form.setActiveTab(v as any);
          }}
          className="w-full flex-1 flex flex-col min-h-0 overflow-hidden"
        >
          {/* تبويب 1: إدخال وتعديل البيانات */}
          <TabsContent
            value="edit"
            className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-3.5 m-0 scroll-smooth touch-pan-y min-h-0"
          >
            {/* محدد نوع الفاتورة */}
            <CustomInvoiceTypeSelector type={form.type} onChange={form.setType} />

            {/* القسم 1: بيانات العميل والمستند والتاريخ والعملة والخيارات الإضافية */}
            <CustomInvoiceMetaSection
              type={form.type}
              partyName={form.partyName}
              setPartyName={form.setPartyName}
              partyEnName={form.partyEnName}
              setPartyEnName={form.setPartyEnName}
              attn={form.attn}
              setAttn={form.setAttn}
              date={form.date}
              setDate={form.setDate}
              reference={form.savedReference}
              fallbackSerial={form.type === "proforma" ? form.serial : undefined}
              language={form.language}
              setLanguage={form.setLanguage}
              currency={form.currency}
              setCurrency={form.setCurrency}
              customerId={form.customerId}
              setCustomerId={form.setCustomerId}
              phone={form.phone}
              setPhone={form.setPhone}
              saveAsNewCustomer={form.saveAsNewCustomer}
              setSaveAsNewCustomer={form.setSaveAsNewCustomer}
              newCustomerType={form.newCustomerType}
              setNewCustomerType={form.setNewCustomerType}
              newCustomerAddress={form.newCustomerAddress}
              setNewCustomerAddress={form.setNewCustomerAddress}
              isCustomerLocked={form.isCustomerLocked}
              onOpenCustomerProfile={(cid) => {
                onOpenChange(false);
                void router.navigate({ to: "/customers", search: { id: cid } });
              }}
              supplierId={form.supplierId}
              setSupplierId={form.setSupplierId}
              supplierInvoiceNumber={form.supplierInvoiceNumber}
              setSupplierInvoiceNumber={form.setSupplierInvoiceNumber}
            />

            {/* القسم 2: بنود الفاتورة والخدمات والملخص المالي مع زر المعاينة المباشر */}
            <CustomInvoiceItemsTable
              items={form.items}
              onItemsChange={form.setItems}
              totalAmount={form.totalAmount}
              totalInWords={form.totalInWords}
              currency={form.currency}
              onPreviewClick={() => form.setActiveTab("preview")}
            />
          </TabsContent>

          {/* تبويب 2: معاينة الفاتورة الرسمية A4 قبل الطباعة أو المشاركة */}
          <TabsContent
            value="preview"
            className="flex-1 overflow-hidden p-2 sm:p-4 bg-muted/30 m-0 min-h-0 flex flex-col space-y-2"
          >
            {/* شريط أدوات المعاينة السريع (بدون تكرار لأزرار التذييل السفلي أو قص على الموبايل) */}
            <div className="flex items-center justify-between gap-2 bg-card px-2.5 py-1.5 sm:px-3 rounded-xl border border-border/80 shadow-2xs shrink-0">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  playTapSound();
                  form.setActiveTab("edit");
                }}
                className="h-8 px-3 rounded-lg text-xs font-black gap-1.5 cursor-pointer shrink-0"
              >
                <Edit3 className="h-3.5 w-3.5 text-primary" />
                <span>العودة للتعديل</span>
              </Button>

              <span className="text-[11px] font-bold text-muted-foreground truncate">
                معاينة A4 مطابقة للطباعة
              </span>
            </div>

            {/* عارض الفاتورة الرسمية */}
            <div className="w-full max-w-3xl mx-auto flex-1 min-h-0 shadow-lg rounded-2xl overflow-hidden border border-border/70 bg-white dark:bg-card">
              <StandardInvoiceViewer invoice={form.previewInvoice} />
            </div>
          </TabsContent>
        </Tabs>

        {/* شريط الإجراءات السفلي الدائم */}
        <CustomInvoiceDialogFooter
          type={form.type}
          isProcessing={form.isProcessing}
          onSave={form.handleSave}
          onSaveAndPrint={form.handleSaveAndPrint}
          onSaveAndShareWhatsApp={form.handleSaveAndShareWhatsApp}
          onConvertToSales={form.type === "proforma" ? () => void form.handleConvertToSales() : undefined}
          onClose={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

export default CustomInvoiceDialog;
