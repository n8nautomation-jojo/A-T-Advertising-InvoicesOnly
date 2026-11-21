import { TA_LOGO_GREEN_BASE64, TA_STAMP_BASE64 } from "@/assets/invoiceImagesBase64";
import { formatNumber } from "@/lib/printCalculator";
import { CLIENT_TYPES, invoiceTotal, type Invoice, type InvoiceLine } from "@/lib/invoice/types";
import { getCompanyEmail } from "@/lib/settings/companyProfileStore";
import { formatBiDiDimensions } from "@/lib/bidiUtils";
import { getCurrencyShortLabel } from "@/lib/currency/currencyFormat";
import { sanitizeCurrency } from "@/lib/currency/types";

// مقاسات ورقة A5 عرضية قياسية بالنسبة 1.414 (210mm × 148mm)
export const INVOICE_WIDTH = 760; // px
export const INVOICE_HEIGHT = 536; // px
export const INVOICE_ASPECT = 760 / 536;
export const ITEMS_PER_PAGE = 9; // 9 أسطر للمقاسات لكل فاتورة/صفحة

const fmtDate = (iso: string) => {
  const [y, m, d] = (iso || "").split("-");
  return y ? `${d} / ${m} / ${y}م` : "";
};

interface Props {
  invoice: Invoice;
  pageIndex?: number;
  isPrintMode?: boolean;
}

/** مكون صفحة واحدة من فاتورة A5 العرضية بـ 9 أسطر وثلاثة تواقيع */
function InvoiceSheet({
  invoice,
  pageLines,
  pageNumber,
  totalPages,
  startIndex,
}: {
  invoice: Invoice;
  pageLines: InvoiceLine[];
  pageNumber: number;
  totalPages: number;
  startIndex: number;
}) {
  const { meta } = invoice;
  const currency = sanitizeCurrency(invoice.currency || meta.currency, "SDG");
  const grandTotal = invoiceTotal(invoice.lines);
  const pageTotal = invoiceTotal(pageLines);

  const totalArea = invoice.lines.reduce(
    (s, l) => s + (l.width * l.height * l.qty) / 10000,
    0
  );
  const totalPieces = invoice.lines.reduce((s, l) => s + (l.qty || 1), 0);

  // تعبئة الأسطر الفارغة حتى تكتمل 9 أسطر دائماً
  const emptyRowsCount = Math.max(0, ITEMS_PER_PAGE - pageLines.length);

  return (
    <div
      className="invoice-paper"
      dir="rtl"
      style={{
        width: INVOICE_WIDTH,
        minHeight: INVOICE_HEIGHT,
      }}
    >
      {/* 1. الترويسة الرئيسية */}
      <header className="inv-header">
        {/* الشعار واسم المطبعة بتباعد احترافي */}
        <div className="inv-header-right">
          <img src={TA_LOGO_GREEN_BASE64} alt="T.A Advertising Solution" className="inv-logo" />
          <div className="inv-brand-text">
            <div className="inv-brand-ar">T.A للدعاية والإعلان</div>
            <div className="inv-brand-en">T.A ADVERTISING SOLUTION</div>
            <div className="text-[9px] font-mono text-muted-foreground/80 leading-none pt-0.5" dir="ltr">
              {getCompanyEmail()}
            </div>
          </div>
        </div>

        {/* نوع المستند والفرع والصفحة — عنوان بارز وأكبر */}
        <div className="inv-badge-box">
          <span className="inv-badge">طلب تشغيل وطباعة</span>
          <span className="inv-branch-tag">
            {meta.branch ? `فرع ${meta.branch}` : "الخرطوم - بورتسودان"}
            {totalPages > 1 && ` · (صفحة ${pageNumber} من ${totalPages})`}
          </span>
        </div>

        {/* رقم الفاتورة فقط */}
        <div className="inv-serial-card">
          <div className="inv-serial">
            <span>رقم الفاتورة:</span>
            <span className="inv-serial-no">#{meta.serial}</span>
          </div>
        </div>
      </header>

      {/* 2. شبكة بيانات العميل والتسليم والتاريخ */}
      <section className="inv-meta-grid">
        <div className="inv-meta-cell">
          <b>العميل / الجهة:</b>
          <span>{meta.customerName || "عميل نقدي"}</span>
        </div>
        <div className="inv-meta-cell">
          <b>رقم الهاتف:</b>
          <span dir="ltr">{meta.phone || "---"}</span>
        </div>
        <div className="inv-meta-cell">
          <b>مكان الشحن:</b>
          <span>{meta.shipTo || "استلام من الفرع"}</span>
        </div>
        <div className="inv-meta-cell">
          <b>التاريخ:</b>
          <span className="font-mono text-[11px] whitespace-nowrap">{fmtDate(meta.date)}</span>
        </div>

        <div className="inv-checks-row">
          <span className="text-[10px] text-muted-foreground font-bold">تصنيف العميل:</span>
          {CLIENT_TYPES.map((c) => {
            const isChecked = meta.clientTypes.includes(c.key);
            return (
              <span key={c.key} className="inv-check">
                <span className="inv-box">{isChecked ? "✓" : ""}</span>
                <span>{c.label}</span>
              </span>
            );
          })}
        </div>
      </section>

      {/* 3. جدول بنود الطباعة والمقاسات — بالترتيب المعتمد (القياس، العدد، الخام، البيان، السعر، القيمة) */}
      <div className="inv-table-wrap">
        <table className="inv-table">
          <thead>
            <tr>
              <th style={{ width: 32 }}>م</th>
              <th style={{ width: 105 }}>القياس (سم)</th>
              <th style={{ width: 68 }}>العدد</th>
              <th style={{ width: 85 }}>الخام</th>
              <th>البيان وتفاصيل العمل</th>
              <th style={{ width: 95 }}>السعر</th>
              <th style={{ width: 115 }}>القيمة ({getCurrencyShortLabel(currency)})</th>
            </tr>
          </thead>
          <tbody>
            {pageLines.map((l, i) => (
              <tr key={i}>
                <td className="inv-num font-bold">{startIndex + i + 1}</td>
                <td className="inv-num font-bold" dir="ltr">
                  {l.width} × {l.height}
                </td>
                <td className="inv-num font-black">{l.qty}</td>
                <td className="font-bold">{l.material}</td>
                <td className="inv-desc">
                  <bdi dir="auto" className="block truncate w-full" style={{ unicodeBidi: "isolate" }}>
                    {formatBiDiDimensions(l.description || "بند طباعة")}
                  </bdi>
                </td>
                <td className="inv-num font-bold">{formatNumber(l.unitPrice)}</td>
                <td className="inv-num inv-strong font-black text-foreground">{formatNumber(l.total)}</td>
              </tr>
            ))}

            {/* تعبئة الأسطر الفارغة لتكملة الـ 9 أسطر دائماً */}
            {Array.from({ length: emptyRowsCount }).map((_, idx) => (
              <tr key={`empty-${idx}`}>
                <td className="inv-num text-muted-foreground/30">{startIndex + pageLines.length + idx + 1}</td>
                <td>-</td>
                <td>-</td>
                <td>-</td>
                <td className="inv-desc text-muted-foreground/30">---</td>
                <td>-</td>
                <td>-</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="inv-total-row">
              <td colSpan={6} className="inv-total-label">
                <div className="flex items-center justify-between px-2">
                  <span>
                    {totalPages > 1 && pageNumber < totalPages
                      ? `إجمالي الصفحة ${pageNumber} (مرحّل)`
                      : "الإجمالي الكلي المستحق"}
                  </span>
                  <span className="text-[9.5px] font-normal text-muted-foreground">
                    (إجمالي المساحة: {totalArea.toFixed(2)} م² · عدد القطع: {totalPieces})
                  </span>
                </div>
              </td>
              <td className="inv-total-val text-center">
                {formatNumber(totalPages > 1 && pageNumber < totalPages ? pageTotal : grandTotal)}{" "}
                <span className="text-xs font-bold font-mono mr-1">{currency}</span>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* 4. تذييل الفاتورة والتواقيع الثلاثة فقط (المصمم، المحاسب، الطابع) */}
      <footer className="inv-footer">
        <div className="inv-signs">
          <div>
            <div className="text-[10px] text-muted-foreground font-bold">اعتماد التصميم</div>
            <div className="inv-sign-box">توقيع المصمم</div>
          </div>
          <div>
            <div className="text-[10px] text-muted-foreground font-bold">الحسابات والقبض</div>
            <div className="inv-sign-box">توقيع المحاسب</div>
          </div>
          <div>
            <div className="text-[10px] text-muted-foreground font-bold">التنفيذ والمطابقة</div>
            <div className="inv-sign-box">توقيع الطابع</div>
          </div>
        </div>

        <div className="flex items-center justify-between mt-1">
          <p className="inv-note flex-1">
            ملحوظة: البضاعة التي لا تُستلم خلال 15 يوماً من تاريخ الطباعة المطبعة غير مسؤولة عنها. هذه الفاتورة سند رسمي ومعتمد.
          </p>
          <img
            src={TA_STAMP_BASE64}
            alt="Official Stamp"
            className="h-[62px] w-auto object-contain select-none opacity-90 ml-2"
          />
        </div>
      </footer>
    </div>
  );
}

/** ورقة الفاتورة A5 العرضية (Landscape) بتنسيق T.A Advertising المعتمد */
export function InvoiceDocument({ invoice, pageIndex = 0, isPrintMode = false }: Props) {
  const lines = invoice.lines || [];
  const totalPages = Math.max(1, Math.ceil(lines.length / ITEMS_PER_PAGE));

  // في وضع الطباعة: يتم إخراج كل الصفحات وكل صفحة في ورقة A5 عرضية مستقلة
  if (isPrintMode) {
    return (
      <>
        {Array.from({ length: totalPages }).map((_, pIdx) => {
          const start = pIdx * ITEMS_PER_PAGE;
          const pageLines = lines.slice(start, start + ITEMS_PER_PAGE);
          return (
            <div key={`print-page-${pIdx}`} className="invoice-print-page">
              <InvoiceSheet
                invoice={invoice}
                pageLines={pageLines}
                pageNumber={pIdx + 1}
                totalPages={totalPages}
                startIndex={start}
              />
            </div>
          );
        })}
      </>
    );
  }

  // في وضع المعاينة للشاشة: عرض الصفحة المحددة بـ 9 أسطر
  const validPageIndex = Math.min(Math.max(0, pageIndex), totalPages - 1);
  const start = validPageIndex * ITEMS_PER_PAGE;
  const pageLines = lines.slice(start, start + ITEMS_PER_PAGE);

  return (
    <InvoiceSheet
      invoice={invoice}
      pageLines={pageLines}
      pageNumber={validPageIndex + 1}
      totalPages={totalPages}
      startIndex={start}
    />
  );
}
