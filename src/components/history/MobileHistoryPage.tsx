import { PageShell } from "@/components/layout/PageShell";
import { InvoicesPageContent } from "@/components/invoices/InvoicesPageContent";

/**
 * شاشة أرشيف الفواتير والمطالبات (نسخة الفواتير والحاسبة المعتمدة):
 * مخصصة حصرياً لأرشيف الفواتير والمطالبات (مبيعات، مبدئية، مشتريات)
 * بدون أي أقسام أو تبويبات لأوامر التشغيل والورشة.
 */
export function MobileHistoryPage() {
  return (
    <PageShell>
      <div className="flex flex-1 flex-col overflow-hidden bg-background" dir="rtl">
        <main className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-y-contain pb-28 md:pb-12">
          <InvoicesPageContent />
        </main>
      </div>
    </PageShell>
  );
}

export default MobileHistoryPage;
