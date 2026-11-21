/**
 * ═══════════════════════════════════════════════════════════════
 * Executive Account Statement Document Engine (Corporate A4)
 * ═══════════════════════════════════════════════════════════════
 * Banking-grade Arabic RTL customer financial statement designed
 * for T.A Advertising Solution on standard A4 (210mm x 297mm).
 * Follows strict 3-token corporate palette (#0D4A39, #C5A059, neutrals),
 * zero metric duplication, full BiDi isolation, and XSS escaping.
 */

import type { CustomerStatement } from "@/lib/repositories/ReportsRepository";
import type { CustomerRecord } from "@/lib/customersStore";
import { formatNumber } from "@/lib/printCalculator";
import { triggerPrintWithElement, shareInvoiceViaWhatsApp } from "@/lib/pdfExport";
import {
  TA_LOGO_GREEN_BASE64,
  TA_SIGNATURE_TARIG_BASE64,
  TA_QR_CODE_BASE64,
} from "@/assets/invoiceImagesBase64";
import { escapeHtml } from "@/lib/security/htmlEscape";
import { getCompanyProfileSnapshot } from "@/lib/settings/companyProfileStore";
import { getLocalIsoDate } from "@/lib/dateUtils";
import { getInvoiceTafqeet } from "@/lib/proforma/tafqeet";
import type { AppCurrency } from "@/lib/currency/types";
import { toast } from "sonner";

const MIN_LEDGER_TABLE_ROWS = 10;

function toAppCurrency(currency: string): AppCurrency {
  if (currency === "USD" || currency === "SAR" || currency === "EGP" || currency === "SDG") {
    return currency;
  }
  return "SDG";
}

function formatDisplayDate(iso?: string): string {
  const clean = (iso || "").trim().slice(0, 10);
  return clean ? clean.replace(/-/g, " / ") : "";
}

export function buildStatementDomElement(
  statement: CustomerStatement,
  customer: CustomerRecord,
  currency = statement.currency || "SDG"
): HTMLElement {
  const container = document.createElement("div");
  const isSinglePage = statement.lines.length <= MIN_LEDGER_TABLE_ROWS;

  // Exclude "invoice-paper" so pdfExport.ts never applies A5 landscape heuristics
  container.className =
    "statement-print-root standard-invoice-sheet statement-print-document font-sans text-right";
  container.dir = "rtl";
  container.style.cssText = `
    width: 210mm;
    min-height: 297mm;
    height: ${isSinglePage ? "297mm" : "auto"};
    margin: 0 auto;
    padding: 15mm 18mm 13mm 18mm;
    background: #ffffff;
    color: #0f172a;
    box-sizing: border-box;
    position: relative;
    font-family: 'Tajawal', 'Cairo', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    line-height: 1.35;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
  `;

  const companyProfile = getCompanyProfileSnapshot();
  const safeCompanyPhone = escapeHtml(companyProfile.phone);
  const safeCompanyEmail = escapeHtml(companyProfile.email);
  const safeCompanyAddress = escapeHtml(companyProfile.addressAr);

  const localIsoDate = getLocalIsoDate();
  const todayStr = localIsoDate.replace(/-/g, " / ");
  const resolvedCurrency = toAppCurrency(currency);

  const earliestMovementDate = statement.lines.find((l) => Boolean(l.date))?.date;
  const createdDateIso = customer.createdAt ? String(customer.createdAt).slice(0, 10) : "";
  const effectiveFromIso =
    statement.periodFrom || earliestMovementDate || createdDateIso || localIsoDate;
  const effectiveToIso = statement.periodTo || localIsoDate;
  const safePeriodFrom = escapeHtml(formatDisplayDate(effectiveFromIso));
  const safePeriodTo = escapeHtml(formatDisplayDate(effectiveToIso));

  const shortCustCode = (customer.id || statement.customerId || "CUST")
    .replace(/[^A-Za-z0-9]/g, "")
    .slice(-4)
    .toUpperCase() || "0001";
  const statementRef = `STMT-${localIsoDate.replace(/-/g, "").slice(2)}-${shortCustCode}`;
  const safeStatementRef = escapeHtml(statementRef);
  const safeCustomerCode = escapeHtml(`C-${shortCustCode}`);
  const safeCreatedAt = escapeHtml(formatDisplayDate(createdDateIso) || todayStr);

  const currencyLabel =
    resolvedCurrency === "USD"
      ? "دولار أمريكي (USD)"
      : resolvedCurrency === "SAR"
      ? "ريال سعودي (SAR)"
      : resolvedCurrency === "EGP"
      ? "جنيه مصري (EGP)"
      : "جنيه سوداني (SDG)";
  const currencySymbol = resolvedCurrency === "USD" ? "$" : currency;

  const customerTypeLabel =
    customer.type === "company"
      ? "شركة"
      : customer.type === "institution" ||
        customer.type === "agency" ||
        customer.type === "internal"
      ? "مؤسسة"
      : customer.type === "client"
      ? "زبون"
      : "أفراد";

  const safeCurrencyLabel = escapeHtml(currencyLabel);
  const safeCurrencySymbol = escapeHtml(currencySymbol);
  const safeCustomerName = escapeHtml(statement.customerName);
  const safeCustomerTypeLabel = escapeHtml(customerTypeLabel);
  const safeCustomerPhone = customer.phone?.trim() ? escapeHtml(customer.phone.trim()) : "غير مسجل";
  const safeCustomerAddress = customer.address?.trim() ? escapeHtml(customer.address.trim()) : "";
  const safeTodayStr = escapeHtml(todayStr);

  const openingRowAmount =
    (statement.broughtForwardBalance ?? 0) !== 0
      ? Number(statement.broughtForwardBalance)
      : Number(statement.openingBalance) || 0;
  const totalInvoiced = Number(statement.totalInvoiced) || 0;
  const totalCollected = Number(statement.totalCollected) || 0;
  const netBal = statement.netBalance ?? statement.outstanding ?? 0;
  const absNetBal = Math.abs(netBal);
  const tafqeetText =
    netBal === 0
      ? "الحساب متزن بالكامل ومسدد"
      : getInvoiceTafqeet(absNetBal, true, resolvedCurrency);
  const safeTafqeetText = escapeHtml(tafqeetText);

  const netStatusLabel =
    netBal > 0
      ? "صافي الرصيد المستحق"
      : netBal < 0
      ? "صافي الرصيد الدائن للعميل"
      : "الرصيد النهائي";
  const netStatusHint =
    netBal > 0
      ? "مديونية مستحقة على العميل"
      : netBal < 0
      ? "رصيد دائن / دفعة مقدمة لصالح العميل"
      : "الحساب متزن بالكامل ومسدد";
  const netAmountColor = netBal > 0 ? "#991b1b" : "#0D4A39";
  const tafqeetHeading =
    netBal > 0
      ? "صافي المستحق بالحروف:"
      : netBal < 0
      ? "الرصيد الدائن بالحروف:"
      : "الوضع المالي للحساب:";

  const monoStyle =
    "font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace; font-variant-numeric: tabular-nums;";

  // 1. صفوف القيود المحاسبية الفعلية
  const rowsHtml = statement.lines
    .map((line, idx) => {
      const bg = idx % 2 === 0 ? "#ffffff" : "#f8faf9";
      const balanceColor =
        line.runningBalance > 0
          ? "#991b1b"
          : line.runningBalance < 0
          ? "#0D4A39"
          : "#0f172a";
      const safeDate = escapeHtml(line.date);
      const safeLabel = escapeHtml(line.label);
      const safeNotes = line.notes?.trim() ? escapeHtml(line.notes.trim()) : "";
      const safeReference = line.reference?.trim() ? escapeHtml(line.reference.trim()) : "—";

      return `
        <tr style="background: ${bg}; border-bottom: 1px solid #e2e8f0; height: 30px;">
          <td style="padding: 5px 6px; font-size: 10.5px; font-weight: 700; color: #64748b; text-align: center; border-left: 1px solid #e2e8f0; ${monoStyle}">${idx + 1}</td>
          <td style="padding: 5px 8px; font-size: 10.5px; font-weight: 700; color: #334155; text-align: center; border-left: 1px solid #e2e8f0; ${monoStyle}"><bdi dir="ltr">${safeDate}</bdi></td>
          <td style="padding: 5px 10px; font-size: 11px; font-weight: 800; color: #0f172a; text-align: right; border-left: 1px solid #e2e8f0;">
            <span>${safeLabel}</span>
            ${
              safeNotes
                ? `<bdi dir="auto" style="display: inline-block; font-size: 9.5px; font-weight: 600; color: #64748b; margin-right: 6px;">(${safeNotes})</bdi>`
                : ""
            }
          </td>
          <td style="padding: 5px 8px; font-size: 10.5px; font-weight: 700; color: #0D4A39; text-align: center; border-left: 1px solid #e2e8f0; ${monoStyle}"><bdi dir="ltr">${safeReference}</bdi></td>
          <td style="padding: 5px 8px; font-size: 11px; font-weight: 700; color: ${line.debit > 0 ? "#991b1b" : "#94a3b8"}; text-align: left; border-left: 1px solid #e2e8f0; ${monoStyle}"><bdi dir="ltr">${
        line.debit > 0 ? escapeHtml(formatNumber(line.debit)) : "—"
      }</bdi></td>
          <td style="padding: 5px 8px; font-size: 11px; font-weight: 700; color: ${line.credit > 0 ? "#0D4A39" : "#94a3b8"}; text-align: left; border-left: 1px solid #e2e8f0; ${monoStyle}"><bdi dir="ltr">${
        line.credit > 0 ? escapeHtml(formatNumber(line.credit)) : "—"
      }</bdi></td>
          <td style="padding: 5px 8px; font-size: 11px; font-weight: 900; color: ${balanceColor}; text-align: left; ${monoStyle}"><bdi dir="ltr">${escapeHtml(
        formatNumber(line.runningBalance)
      )}</bdi></td>
        </tr>
      `;
    })
    .join("");

  // 2. صفوف فارغة منظمة بدون نقاط زخرفية للحفاظ على تناسق ورقة A4
  const emptyRowsCount = Math.max(0, MIN_LEDGER_TABLE_ROWS - statement.lines.length);
  let emptyRowsHtml = "";
  for (let i = 0; i < emptyRowsCount; i++) {
    const isFirstEmpty = i === 0 && statement.lines.length === 0;
    const isLastEmpty = i === emptyRowsCount - 1;
    emptyRowsHtml += `
      <tr style="background: #ffffff; border-bottom: ${isLastEmpty ? "none" : "1px solid #f1f5f9"}; height: 30px;">
        <td style="padding: 5px 6px; border-left: 1px solid #f1f5f9;"></td>
        <td style="padding: 5px 8px; border-left: 1px solid #f1f5f9;"></td>
        <td style="padding: 5px 10px; border-left: 1px solid #f1f5f9; color: #94a3b8; font-size: 10.5px; font-weight: 600;">${
          isFirstEmpty ? "لا توجد معاملات مالية مسجلة لهذه الفترة" : ""
        }</td>
        <td style="padding: 5px 8px; border-left: 1px solid #f1f5f9;"></td>
        <td style="padding: 5px 8px; border-left: 1px solid #f1f5f9;"></td>
        <td style="padding: 5px 8px; border-left: 1px solid #f1f5f9;"></td>
        <td style="padding: 5px 8px;"></td>
      </tr>
    `;
  }

  container.innerHTML = `
    <!-- 1. الترويسة المؤسسية الرسمية -->
    <div style="display: grid; grid-template-columns: 165px 1fr 165px; align-items: center; gap: 10px; min-height: 68px; margin-bottom: 8px;">
      <div style="display: flex; align-items: center; justify-content: flex-start;">
        <img src="${TA_LOGO_GREEN_BASE64}" alt="T.A Advertising Solution" style="height: 66px; width: auto; object-fit: contain;" />
      </div>

      <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center;">
        <div style="font-size: 21px; font-weight: 900; color: #0D4A39; line-height: 1.15;">
          كشف حساب مالي
        </div>
        <div style="width: 56px; height: 2px; background: #C5A059; margin: 4px 0 3px 0; border-radius: 1px;"></div>
        <div style="font-size: 9px; font-weight: 800; color: #475569; letter-spacing: 1.4px; text-transform: uppercase;">
          STATEMENT OF ACCOUNT
        </div>
      </div>

      <div style="border: 1px solid #cbd5e1; border-top: 2px solid #0D4A39; border-radius: 6px; padding: 6px 10px; background: #f8faf9; font-size: 9.5px; line-height: 1.5;">
        <div style="display: flex; justify-content: space-between; align-items: center; gap: 6px;">
          <span style="color: #64748b; font-weight: 800;">رقم الكشف:</span>
          <bdi dir="ltr" style="color: #0D4A39; font-weight: 900; white-space: nowrap; ${monoStyle}">${safeStatementRef}</bdi>
        </div>
        <div style="display: flex; justify-content: space-between; align-items: center; gap: 6px; margin-top: 2px; padding-top: 2px; border-top: 1px solid #e2e8f0;">
          <span style="color: #64748b; font-weight: 800;">الإصدار:</span>
          <bdi dir="ltr" style="color: #0f172a; font-weight: 800; white-space: nowrap; ${monoStyle}">${safeTodayStr}</bdi>
        </div>
      </div>
    </div>

    <!-- شريط بيانات التواصل الرسمي (متصل بإعدادات الشركة) -->
    <div style="margin: 0 0 10px 0; min-height: 30px; padding: 5px 14px; background: #f4f7f6; border-top: 2px solid #0D4A39; border-bottom: 1px solid #cbd5e1; border-radius: 4px; font-size: 10.5px; font-weight: 700; color: #0f172a; display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 12px;">
      <span style="font-weight: 800; color: #0f172a; text-align: right;">${safeCompanyAddress}</span>
      <div style="text-align: center;"><bdi dir="ltr" style="font-weight: 800; color: #334155;">${safeCompanyEmail}</bdi></div>
      <div style="text-align: left; white-space: nowrap;"><bdi dir="ltr" style="font-weight: 800; color: #0f172a; ${monoStyle}">${safeCompanyPhone}</bdi></div>
    </div>

    <!-- 2. بطاقتا البيانات التنفيذية: بيانات العميل + ملخص الكشف والفترة (متزنة بدون فراغات) -->
    <div style="display: grid; grid-template-columns: 1.05fr 1.15fr; gap: 10px; margin-bottom: 10px; align-items: stretch;">
      <!-- بطاقة العميل (يمين) -->
      <div style="border: 1px solid #cbd5e1; border-top: 2.5px solid #0D4A39; border-radius: 6px; padding: 9px 12px; background: #ffffff; display: flex; flex-direction: column; justify-content: space-between; gap: 5px;">
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px;">
          <span style="color: #475569; font-weight: 800; font-size: 10px;">بيانات العميل والحساب</span>
          <span style="font-size: 9px; font-weight: 800; background: #f0f5f3; color: #0D4A39; border: 1px solid #c5d6d1; padding: 1px 7px; border-radius: 4px;">
            ${safeCustomerTypeLabel}
          </span>
        </div>

        <div style="font-weight: 900; font-size: 14.5px; color: #0f172a; line-height: 1.25;">
          ${safeCustomerName}
        </div>

        <div style="display: flex; flex-direction: column; gap: 3.5px; font-size: 10px; border-top: 1px dashed #e2e8f0; padding-top: 5px;">
          <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px;">
            <span style="color: #64748b; font-weight: 700;">كود الحساب:</span>
            <bdi dir="ltr" style="font-weight: 800; color: #0D4A39; ${monoStyle}">${safeCustomerCode}</bdi>
          </div>
          <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px;">
            <span style="color: #64748b; font-weight: 700;">رقم الهاتف:</span>
            <bdi dir="ltr" style="font-weight: 800; color: #0f172a; ${monoStyle}">${safeCustomerPhone}</bdi>
          </div>
          ${
            safeCustomerAddress
              ? `<div style="display: flex; justify-content: space-between; align-items: center; gap: 8px;"><span style="color: #64748b; font-weight: 700;">العنوان:</span><span style="font-weight: 700; color: #334155;">${safeCustomerAddress}</span></div>`
              : `<div style="display: flex; justify-content: space-between; align-items: center; gap: 8px;"><span style="color: #64748b; font-weight: 700;">تاريخ فتح الملف:</span><bdi dir="ltr" style="font-weight: 700; color: #334155; ${monoStyle}">${safeCreatedAt}</bdi></div>`
          }
          <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px;">
            <span style="color: #64748b; font-weight: 700;">عدد القيود في الفترة:</span>
            <span style="font-weight: 800; color: #0f172a;">${statement.lines.length} حركة</span>
          </div>
        </div>
      </div>

      <!-- بطاقة ملخص كشف الحساب والفترة المحددة (يسار) -->
      <div style="border: 1px solid #cbd5e1; border-top: 2.5px solid #C5A059; border-radius: 6px; padding: 9px 12px; background: #fafcfb; display: flex; flex-direction: column; justify-content: space-between; gap: 5px;">
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px;">
          <span style="color: #475569; font-weight: 800; font-size: 10px;">ملخص كشف الحساب والفترة</span>
          <span style="font-size: 9px; font-weight: 800; background: #fef9ee; color: #854d0e; border: 1px solid #e9d5a1; padding: 1px 7px; border-radius: 4px;">
            فترة محددة
          </span>
        </div>

        <div style="display: flex; flex-direction: column; gap: 3px; font-size: 10px;">
          <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px;">
            <span style="color: #64748b; font-weight: 700;">نطاق الفترة:</span>
            <span style="font-weight: 800; color: #0f172a;">
              من <bdi dir="ltr" style="${monoStyle}">${safePeriodFrom}</bdi> إلى <bdi dir="ltr" style="${monoStyle}">${safePeriodTo}</bdi>
            </span>
          </div>
          <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px;">
            <span style="color: #64748b; font-weight: 700;">العملة المحاسبية:</span>
            <span style="font-weight: 800; color: #0D4A39;">${safeCurrencyLabel}</span>
          </div>
          <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px;">
            <span style="color: #64748b; font-weight: 700;">الرصيد الافتتاحي / المرحل:</span>
            <bdi dir="ltr" style="font-weight: 800; color: #334155; ${monoStyle}">${escapeHtml(formatNumber(openingRowAmount))} ${safeCurrencySymbol}</bdi>
          </div>
          <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px;">
            <span style="color: #64748b; font-weight: 700;">حركة الفترة (مدين / دائن):</span>
            <span style="font-weight: 800;">
              <bdi dir="ltr" style="color: #991b1b; ${monoStyle}">${escapeHtml(formatNumber(totalInvoiced))}</bdi>
              <span style="color: #94a3b8; margin: 0 3px;">/</span>
              <bdi dir="ltr" style="color: #0D4A39; ${monoStyle}">${escapeHtml(formatNumber(totalCollected))}</bdi>
            </span>
          </div>
        </div>

        <div style="border-top: 1px solid #e2e8f0; background: #f0f5f3; border-radius: 4px; padding: 5px 8px; display: flex; justify-content: space-between; align-items: center; gap: 8px;">
          <div>
            <div style="font-size: 10px; font-weight: 900; color: #0f172a;">${netStatusLabel}</div>
            <div style="font-size: 8.5px; font-weight: 700; color: #475569;">${netStatusHint}</div>
          </div>
          <bdi dir="ltr" style="font-size: 15px; font-weight: 900; color: ${netAmountColor}; white-space: nowrap; ${monoStyle}">
            ${escapeHtml(formatNumber(absNetBal))} <span style="font-size: 10px; font-weight: 800;">${safeCurrencySymbol}</span>
          </bdi>
        </div>
      </div>
    </div>

    <!-- 3. جدول كشف الحساب المحاسبي التفصيلي -->
    <div style="flex: 1; min-height: 410px; display: flex; flex-direction: column; justify-content: space-between; border: 1px solid #cbd5e1; border-radius: 6px; overflow: hidden; margin-bottom: 9px; background: #ffffff;">
      <table style="width: 100%; border-collapse: collapse; height: 100%;">
        <thead>
          <tr style="background: #0D4A39; color: #ffffff; height: 34px; border-bottom: 2px solid #C5A059;">
            <th style="padding: 5px 5px; width: 30px; text-align: center; font-size: 10px; font-weight: 800; border-left: 1px solid rgba(255,255,255,0.16);">#</th>
            <th style="padding: 5px 6px; width: 82px; text-align: center; font-size: 10px; font-weight: 800; border-left: 1px solid rgba(255,255,255,0.16);">التاريخ</th>
            <th style="padding: 5px 10px; text-align: right; font-size: 10.5px; font-weight: 800; border-left: 1px solid rgba(255,255,255,0.16);">البيان وتفاصيل المعاملة المالية</th>
            <th style="padding: 5px 6px; width: 76px; text-align: center; font-size: 10px; font-weight: 800; border-left: 1px solid rgba(255,255,255,0.16);">المرجع</th>
            <th style="padding: 5px 6px; width: 84px; text-align: left; font-size: 10px; font-weight: 800; border-left: 1px solid rgba(255,255,255,0.16);">مدين</th>
            <th style="padding: 5px 6px; width: 84px; text-align: left; font-size: 10px; font-weight: 800; border-left: 1px solid rgba(255,255,255,0.16);">دائن</th>
            <th style="padding: 5px 6px; width: 96px; text-align: left; font-size: 10px; font-weight: 800;">الرصيد التراكمي</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
          ${emptyRowsHtml}
        </tbody>
        <tfoot>
          <tr style="background: #f4f7f6; border-top: 2px solid #0D4A39; height: 34px; font-weight: 900; font-size: 11px;">
            <td colspan="4" style="padding: 5px 10px; text-align: right; color: #0D4A39; border-left: 1px solid #cbd5e1;">
              إجماليات الحركة للفترة (<bdi dir="ltr" style="${monoStyle}">${safePeriodFrom} — ${safePeriodTo}</bdi>) (${safeCurrencySymbol}):
            </td>
            <td style="padding: 5px 6px; color: #991b1b; text-align: left; border-left: 1px solid #cbd5e1; ${monoStyle}"><bdi dir="ltr">${escapeHtml(formatNumber(totalInvoiced))}</bdi></td>
            <td style="padding: 5px 6px; color: #0D4A39; text-align: left; border-left: 1px solid #cbd5e1; ${monoStyle}"><bdi dir="ltr">${escapeHtml(formatNumber(totalCollected))}</bdi></td>
            <td style="padding: 5px 6px; color: ${netAmountColor}; text-align: left; ${monoStyle}"><bdi dir="ltr">${escapeHtml(formatNumber(netBal))}</bdi></td>
          </tr>
        </tfoot>
      </table>
    </div>

    <!-- 4. شريط التفقيط الرسمي وبيانات الحساب البنكي المعتمد (محاذاة متوسطة بالكامل) -->
    <div style="background: #f8faf9; border: 1px solid #cbd5e1; border-radius: 6px; padding: 8px 14px; margin-bottom: 9px; font-size: 10px; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; gap: 4px;">
      <div style="width: 100%; text-align: center;">
        <span style="color: #475569; font-weight: 800;">${tafqeetHeading} </span>
        <span style="color: #0f172a; font-weight: 900;">${safeTafqeetText}</span>
      </div>
      <div style="width: 68%; border-top: 1px dashed #cbd5e1; margin: 1px auto;"></div>
      <div style="font-size: 9.5px; color: #0D4A39; font-weight: 800; text-align: center;">
        الحساب المعتمد للسداد: بنك الخرطوم <bdi dir="ltr" style="${monoStyle}">3283046</bdi> (طارق عثمان / تي ايه للدعايه والاعلان)
      </div>
      <div style="font-size: 8.5px; color: #475569; font-weight: 600; text-align: center;">
        ملاحظة محاسبية: يُعد هذا الكشف مطابقاً وصحيحاً ما لم يرد إشعار خطي بأي ملاحظات خلال 7 أيام من تاريخ الإصدار.
      </div>
    </div>

    <!-- 5. التذييل الرسمي المتوازن: اعتماد العميل + رمز QR + إدارة الحسابات المالية -->
    <div style="display: grid; grid-template-columns: 1fr 84px 1fr; gap: 14px; align-items: stretch; padding-top: 8px; border-top: 1px solid #cbd5e1; margin-bottom: 4px;">
      <!-- اعتماد واستلام العميل -->
      <div style="border: 1px solid #cbd5e1; border-radius: 6px; padding: 8px 12px; height: 86px; display: flex; flex-direction: column; justify-content: space-between; box-sizing: border-box; background: #ffffff;">
        <div style="font-weight: 800; font-size: 10.5px; color: #0f172a; border-bottom: 1px solid #f1f5f9; padding-bottom: 3px;">اعتماد واستلام العميل</div>
        <div style="flex: 1;"></div>
        <div style="display: flex; justify-content: space-between; align-items: center; font-size: 9px; color: #64748b; font-weight: 700; border-top: 1px solid #e2e8f0; padding-top: 4px;">
          <span>التوقيع والختم الرسمي</span>
          <span>التاريخ: .... / .... / 202</span>
        </div>
      </div>

      <!-- رمز QR للتوثيق -->
      <div style="width: 84px; height: 86px; padding: 5px; background: #ffffff; border: 1px solid #cbd5e1; border-radius: 6px; display: flex; align-items: center; justify-content: center; box-sizing: border-box;">
        <img src="${TA_QR_CODE_BASE64}" alt="QR Code" style="width: 100%; height: 100%; object-fit: contain;" />
      </div>

      <!-- إدارة الحسابات المالية: طارق عثمان علي وتحته المسمى الوظيفي وبجانبهما التوقيع -->
      <div style="border: 1px solid #cbd5e1; border-radius: 6px; padding: 8px 12px; height: 86px; display: flex; flex-direction: column; justify-content: space-between; box-sizing: border-box; background: #ffffff;">
        <div style="font-weight: 800; font-size: 10.5px; color: #0f172a; border-bottom: 1px solid #f1f5f9; padding-bottom: 3px;">
          إدارة الحسابات المالية
        </div>
        <div style="flex: 1; display: flex; align-items: center; justify-content: space-between; gap: 10px; padding-top: 2px;">
          <div style="text-align: right;">
            <div style="font-weight: 900; font-size: 11.5px; color: #0D4A39; line-height: 1.25;">طارق عثمان علي</div>
            <div style="font-size: 9px; color: #475569; font-weight: 700; margin-top: 2px;">المدير المالي والتشغيلي المعتمد</div>
          </div>
          <div style="display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
            <img
              src="${TA_SIGNATURE_TARIG_BASE64}"
              alt="Signature"
              style="max-height: 44px; width: auto; object-fit: contain; pointer-events: none; mix-blend-mode: multiply;"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- السطر الإداري والقانوني المعتمد -->
    <div style="text-align: center; font-size: 8.5px; color: #64748b; font-weight: 700; padding-top: 3px;">
      نظام T.A Advertising Solution لإدارة الحسابات والمراسلات المالية — مستند رسمي صادر آلياً ومطابق للقيود المسجلة
    </div>
  `;

  return container;
}

function getStatementCurrencyMeta(currency: string): {
  code: AppCurrency;
  label: string;
  symbol: string;
} {
  const code = toAppCurrency(currency);
  if (code === "USD") return { code, label: "دولار أمريكي (USD)", symbol: "$" };
  if (code === "SAR") return { code, label: "ريال سعودي (SAR)", symbol: "ر.س" };
  if (code === "EGP") return { code, label: "جنيه مصري (EGP)", symbol: "ج.م" };
  return { code: "SDG", label: "جنيه سوداني (SDG)", symbol: "ج.س" };
}

/**
 * كشف حساب مالي متعدد العملات (A4 رسمي):
 * يفصل كل عملة (جنيه سوداني / دولار أمريكي / ريال سعودي / جنيه مصري)
 * في نافذة إجماليات مستقلة وجدول حركات مستقل تماماً مع التفقيط الخاص بكل عملة.
 */
export function buildMultiCurrencyStatementDomElement(
  statements: CustomerStatement[],
  customer: CustomerRecord
): HTMLElement {
  const validStatements = (statements || []).filter(Boolean);
  if (validStatements.length === 0) {
    throw new Error("لا توجد بيانات كشف حساب للطباعة.");
  }
  if (validStatements.length === 1) {
    const only = validStatements[0];
    return buildStatementDomElement(only, customer, only.currency || "SDG");
  }

  const container = document.createElement("div");
  container.className =
    "statement-print-root standard-invoice-sheet statement-print-document font-sans text-right";
  container.dir = "rtl";
  container.style.cssText = `
    width: 210mm;
    min-height: 297mm;
    height: auto;
    margin: 0 auto;
    padding: 14mm 16mm 12mm 16mm;
    background: #ffffff;
    color: #0f172a;
    box-sizing: border-box;
    position: relative;
    font-family: 'Tajawal', 'Cairo', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    line-height: 1.35;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
  `;

  const companyProfile = getCompanyProfileSnapshot();
  const safeCompanyPhone = escapeHtml(companyProfile.phone);
  const safeCompanyEmail = escapeHtml(companyProfile.email);
  const safeCompanyAddress = escapeHtml(companyProfile.addressAr);

  const localIsoDate = getLocalIsoDate();
  const todayStr = localIsoDate.replace(/-/g, " / ");
  const firstStmt = validStatements[0];

  const allDates = validStatements
    .flatMap((s) => s.lines.map((l) => l.date))
    .filter(Boolean)
    .sort();
  const createdDateIso = customer.createdAt ? String(customer.createdAt).slice(0, 10) : "";
  const effectiveFromIso =
    firstStmt.periodFrom || allDates[0] || createdDateIso || localIsoDate;
  const effectiveToIso = firstStmt.periodTo || localIsoDate;
  const safePeriodFrom = escapeHtml(formatDisplayDate(effectiveFromIso));
  const safePeriodTo = escapeHtml(formatDisplayDate(effectiveToIso));

  const shortCustCode =
    (customer.id || firstStmt.customerId || "CUST")
      .replace(/[^A-Za-z0-9]/g, "")
      .slice(-4)
      .toUpperCase() || "0001";
  const statementRef = `STMT-${localIsoDate.replace(/-/g, "").slice(2)}-${shortCustCode}-MC`;
  const safeStatementRef = escapeHtml(statementRef);
  const safeCustomerCode = escapeHtml(`C-${shortCustCode}`);
  const safeCreatedAt = escapeHtml(formatDisplayDate(createdDateIso) || todayStr);
  const safeCustomerName = escapeHtml(firstStmt.customerName || customer.name);
  const safeCustomerPhone = customer.phone?.trim() ? escapeHtml(customer.phone.trim()) : "غير مسجل";
  const safeCustomerAddress = customer.address?.trim() ? escapeHtml(customer.address.trim()) : "";
  const safeTodayStr = escapeHtml(todayStr);

  const customerTypeLabel =
    customer.type === "company"
      ? "شركة"
      : customer.type === "institution" ||
        customer.type === "agency" ||
        customer.type === "internal"
      ? "مؤسسة"
      : customer.type === "client"
      ? "زبون"
      : "أفراد";
  const safeCustomerTypeLabel = escapeHtml(customerTypeLabel);

  const includedCurrenciesText = validStatements
    .map((s) => getStatementCurrencyMeta(s.currency).label)
    .join(" · ");
  const totalLinesAll = validStatements.reduce((acc, s) => acc + s.lines.length, 0);

  const monoStyle =
    "font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace; font-variant-numeric: tabular-nums;";

  // 1. نوافذ ملخص إجمالي المبالغ المطلوبة لكل عملة منفصلة تماماً
  const currencySummaryCardsHtml = validStatements
    .map((stmt) => {
      const meta = getStatementCurrencyMeta(stmt.currency);
      const openingAmt =
        (stmt.broughtForwardBalance ?? 0) !== 0
          ? Number(stmt.broughtForwardBalance)
          : Number(stmt.openingBalance) || 0;
      const invoiced = Number(stmt.totalInvoiced) || 0;
      const collected = Number(stmt.totalCollected) || 0;
      const netBal = stmt.netBalance ?? stmt.outstanding ?? 0;
      const absNet = Math.abs(netBal);
      const netColor = netBal > 0 ? "#991b1b" : "#0D4A39";
      const statusTitle =
        netBal > 0
          ? `صافي المطلوب بـ ${meta.label}`
          : netBal < 0
          ? `رصيد دائن للعميل بـ ${meta.label}`
          : `الحساب متزن (${meta.code})`;
      const tafqeet =
        netBal === 0
          ? "الحساب متزن بالكامل ومسدد"
          : getInvoiceTafqeet(absNet, true, meta.code);

      return `
        <div style="border: 1px solid #cbd5e1; border-top: 2.5px solid #0D4A39; border-radius: 6px; padding: 8px 10px; background: #fafcfb; display: flex; flex-direction: column; justify-content: space-between; gap: 5px;">
          <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px;">
            <span style="font-size: 10.5px; font-weight: 900; color: #0D4A39;">${escapeHtml(meta.label)}</span>
            <span style="font-size: 9px; font-weight: 800; background: #f0f5f3; color: #0D4A39; border: 1px solid #c5d6d1; padding: 1px 6px; border-radius: 4px; ${monoStyle}">${escapeHtml(meta.code)}</span>
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px; font-size: 9.5px; text-align: center;">
            <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 4px; padding: 3px 4px;">
              <div style="color: #64748b; font-weight: 700; font-size: 8.5px;">افتتاحي</div>
              <bdi dir="ltr" style="font-weight: 800; color: #334155; ${monoStyle}">${escapeHtml(formatNumber(openingAmt))}</bdi>
            </div>
            <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 4px; padding: 3px 4px;">
              <div style="color: #64748b; font-weight: 700; font-size: 8.5px;">مدين (فواتير)</div>
              <bdi dir="ltr" style="font-weight: 800; color: #991b1b; ${monoStyle}">${escapeHtml(formatNumber(invoiced))}</bdi>
            </div>
            <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 4px; padding: 3px 4px;">
              <div style="color: #64748b; font-weight: 700; font-size: 8.5px;">دائن (مدفوع)</div>
              <bdi dir="ltr" style="font-weight: 800; color: #0D4A39; ${monoStyle}">${escapeHtml(formatNumber(collected))}</bdi>
            </div>
          </div>
          <div style="background: ${netBal > 0 ? "#fef2f2" : "#f0f5f3"}; border: 1px solid ${netBal > 0 ? "#fecaca" : "#c5d6d1"}; border-radius: 4px; padding: 5px 8px; display: flex; justify-content: space-between; align-items: center; gap: 6px;">
            <span style="font-size: 9.5px; font-weight: 900; color: #0f172a;">${escapeHtml(statusTitle)}</span>
            <bdi dir="ltr" style="font-size: 13.5px; font-weight: 900; color: ${netColor}; white-space: nowrap; ${monoStyle}">
              ${escapeHtml(formatNumber(absNet))} <span style="font-size: 9.5px;">${escapeHtml(meta.symbol)}</span>
            </bdi>
          </div>
          <div style="font-size: 8.5px; color: #475569; font-weight: 700; text-align: center; border-top: 1px dashed #e2e8f0; padding-top: 3px;">
            ${escapeHtml(tafqeet)}
          </div>
        </div>
      `;
    })
    .join("");

  // 2. جداول الحركة التفصيلية مفصولة تماماً حسب كل عملة
  const currencyLedgersHtml = validStatements
    .map((stmt, sectionIdx) => {
      const meta = getStatementCurrencyMeta(stmt.currency);
      const invoiced = Number(stmt.totalInvoiced) || 0;
      const collected = Number(stmt.totalCollected) || 0;
      const netBal = stmt.netBalance ?? stmt.outstanding ?? 0;
      const netColor = netBal > 0 ? "#991b1b" : "#0D4A39";
      const rowsHtml =
        stmt.lines.length > 0
          ? stmt.lines
              .map((line, idx) => {
                const bg = idx % 2 === 0 ? "#ffffff" : "#f8faf9";
                const balanceColor =
                  line.runningBalance > 0
                    ? "#991b1b"
                    : line.runningBalance < 0
                    ? "#0D4A39"
                    : "#0f172a";
                return `
                  <tr style="background: ${bg}; border-bottom: 1px solid #e2e8f0; height: 27px;">
                    <td style="padding: 4px 5px; font-size: 10px; font-weight: 700; color: #64748b; text-align: center; border-left: 1px solid #e2e8f0; ${monoStyle}">${idx + 1}</td>
                    <td style="padding: 4px 6px; font-size: 10px; font-weight: 700; color: #334155; text-align: center; border-left: 1px solid #e2e8f0; ${monoStyle}"><bdi dir="ltr">${escapeHtml(line.date)}</bdi></td>
                    <td style="padding: 4px 8px; font-size: 10.5px; font-weight: 800; color: #0f172a; text-align: right; border-left: 1px solid #e2e8f0;">
                      <span>${escapeHtml(line.label)}</span>
                      ${
                        line.notes?.trim()
                          ? `<bdi dir="auto" style="display: inline-block; font-size: 9px; font-weight: 600; color: #64748b; margin-right: 5px;">(${escapeHtml(line.notes.trim())})</bdi>`
                          : ""
                      }
                    </td>
                    <td style="padding: 4px 6px; font-size: 10px; font-weight: 700; color: #0D4A39; text-align: center; border-left: 1px solid #e2e8f0; ${monoStyle}"><bdi dir="ltr">${escapeHtml(line.reference?.trim() || "—")}</bdi></td>
                    <td style="padding: 4px 6px; font-size: 10.5px; font-weight: 700; color: ${line.debit > 0 ? "#991b1b" : "#94a3b8"}; text-align: left; border-left: 1px solid #e2e8f0; ${monoStyle}"><bdi dir="ltr">${line.debit > 0 ? escapeHtml(formatNumber(line.debit)) : "—"}</bdi></td>
                    <td style="padding: 4px 6px; font-size: 10.5px; font-weight: 700; color: ${line.credit > 0 ? "#0D4A39" : "#94a3b8"}; text-align: left; border-left: 1px solid #e2e8f0; ${monoStyle}"><bdi dir="ltr">${line.credit > 0 ? escapeHtml(formatNumber(line.credit)) : "—"}</bdi></td>
                    <td style="padding: 4px 6px; font-size: 10.5px; font-weight: 900; color: ${balanceColor}; text-align: left; ${monoStyle}"><bdi dir="ltr">${escapeHtml(formatNumber(line.runningBalance))}</bdi></td>
                  </tr>
                `;
              })
              .join("")
          : `
            <tr style="background: #ffffff; height: 28px;">
              <td colspan="7" style="padding: 6px; text-align: center; font-size: 10px; color: #94a3b8; font-weight: 600;">
                لا توجد حركات مسجلة بهذه العملة خلال الفترة المحددة
              </td>
            </tr>
          `;

      return `
        <div style="border: 1px solid #cbd5e1; border-radius: 6px; overflow: hidden; margin-bottom: 10px; background: #ffffff;">
          <div style="background: #f0f5f3; border-bottom: 1.5px solid #0D4A39; padding: 6px 10px; display: flex; justify-content: space-between; align-items: center;">
            <span style="font-size: 11px; font-weight: 900; color: #0D4A39;">
              ${sectionIdx + 1}. جدول حركات الحساب بعملة: ${escapeHtml(meta.label)}
            </span>
            <span style="font-size: 9.5px; font-weight: 800; color: #475569;">
              ${stmt.lines.length} حركة · الرمز: <bdi dir="ltr" style="${monoStyle}">${escapeHtml(meta.symbol)}</bdi>
            </span>
          </div>
          <table style="width: 100%; border-collapse: collapse;">
            <thead>
              <tr style="background: #0D4A39; color: #ffffff; height: 30px; border-bottom: 2px solid #C5A059;">
                <th style="padding: 4px 5px; width: 28px; text-align: center; font-size: 9.5px; font-weight: 800; border-left: 1px solid rgba(255,255,255,0.16);">#</th>
                <th style="padding: 4px 6px; width: 78px; text-align: center; font-size: 9.5px; font-weight: 800; border-left: 1px solid rgba(255,255,255,0.16);">التاريخ</th>
                <th style="padding: 4px 8px; text-align: right; font-size: 10px; font-weight: 800; border-left: 1px solid rgba(255,255,255,0.16);">البيان وتفاصيل المعاملة</th>
                <th style="padding: 4px 6px; width: 74px; text-align: center; font-size: 9.5px; font-weight: 800; border-left: 1px solid rgba(255,255,255,0.16);">المرجع</th>
                <th style="padding: 4px 6px; width: 80px; text-align: left; font-size: 9.5px; font-weight: 800; border-left: 1px solid rgba(255,255,255,0.16);">مدين (${escapeHtml(meta.symbol)})</th>
                <th style="padding: 4px 6px; width: 80px; text-align: left; font-size: 9.5px; font-weight: 800; border-left: 1px solid rgba(255,255,255,0.16);">دائن (${escapeHtml(meta.symbol)})</th>
                <th style="padding: 4px 6px; width: 92px; text-align: left; font-size: 9.5px; font-weight: 800;">الرصيد (${escapeHtml(meta.symbol)})</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
            <tfoot>
              <tr style="background: #f4f7f6; border-top: 2px solid #0D4A39; height: 30px; font-weight: 900; font-size: 10.5px;">
                <td colspan="4" style="padding: 4px 8px; text-align: right; color: #0D4A39; border-left: 1px solid #cbd5e1;">
                  إجمالي حركات ${escapeHtml(meta.label)} للفترة:
                </td>
                <td style="padding: 4px 6px; color: #991b1b; text-align: left; border-left: 1px solid #cbd5e1; ${monoStyle}"><bdi dir="ltr">${escapeHtml(formatNumber(invoiced))}</bdi></td>
                <td style="padding: 4px 6px; color: #0D4A39; text-align: left; border-left: 1px solid #cbd5e1; ${monoStyle}"><bdi dir="ltr">${escapeHtml(formatNumber(collected))}</bdi></td>
                <td style="padding: 4px 6px; color: ${netColor}; text-align: left; ${monoStyle}"><bdi dir="ltr">${escapeHtml(formatNumber(netBal))} ${escapeHtml(meta.symbol)}</bdi></td>
              </tr>
            </tfoot>
          </table>
        </div>
      `;
    })
    .join("");

  container.innerHTML = `
    <!-- 1. الترويسة المؤسسية الرسمية -->
    <div style="display: grid; grid-template-columns: 165px 1fr 165px; align-items: center; gap: 10px; min-height: 64px; margin-bottom: 8px;">
      <div style="display: flex; align-items: center; justify-content: flex-start;">
        <img src="${TA_LOGO_GREEN_BASE64}" alt="T.A Advertising Solution" style="height: 62px; width: auto; object-fit: contain;" />
      </div>

      <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center;">
        <div style="font-size: 19px; font-weight: 900; color: #0D4A39; line-height: 1.15;">
          كشف حساب مالي مفصّل حسب العملة
        </div>
        <div style="width: 64px; height: 2px; background: #C5A059; margin: 4px 0 3px 0; border-radius: 1px;"></div>
        <div style="font-size: 8.5px; font-weight: 800; color: #475569; letter-spacing: 1.2px; text-transform: uppercase;">
          MULTI-CURRENCY STATEMENT OF ACCOUNT
        </div>
      </div>

      <div style="border: 1px solid #cbd5e1; border-top: 2px solid #0D4A39; border-radius: 6px; padding: 6px 10px; background: #f8faf9; font-size: 9.5px; line-height: 1.5;">
        <div style="display: flex; justify-content: space-between; align-items: center; gap: 6px;">
          <span style="color: #64748b; font-weight: 800;">رقم الكشف:</span>
          <bdi dir="ltr" style="color: #0D4A39; font-weight: 900; white-space: nowrap; ${monoStyle}">${safeStatementRef}</bdi>
        </div>
        <div style="display: flex; justify-content: space-between; align-items: center; gap: 6px; margin-top: 2px; padding-top: 2px; border-top: 1px solid #e2e8f0;">
          <span style="color: #64748b; font-weight: 800;">الإصدار:</span>
          <bdi dir="ltr" style="color: #0f172a; font-weight: 800; white-space: nowrap; ${monoStyle}">${safeTodayStr}</bdi>
        </div>
      </div>
    </div>

    <!-- شريط بيانات التواصل الرسمي -->
    <div style="margin: 0 0 9px 0; min-height: 28px; padding: 4px 12px; background: #f4f7f6; border-top: 2px solid #0D4A39; border-bottom: 1px solid #cbd5e1; border-radius: 4px; font-size: 10px; font-weight: 700; color: #0f172a; display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 10px;">
      <span style="font-weight: 800; color: #0f172a; text-align: right;">${safeCompanyAddress}</span>
      <div style="text-align: center;"><bdi dir="ltr" style="font-weight: 800; color: #334155;">${safeCompanyEmail}</bdi></div>
      <div style="text-align: left; white-space: nowrap;"><bdi dir="ltr" style="font-weight: 800; color: #0f172a; ${monoStyle}">${safeCompanyPhone}</bdi></div>
    </div>

    <!-- 2. بطاقتا بيانات العميل والفترة -->
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 9px; align-items: stretch;">
      <div style="border: 1px solid #cbd5e1; border-top: 2.5px solid #0D4A39; border-radius: 6px; padding: 8px 11px; background: #ffffff; display: flex; flex-direction: column; justify-content: space-between; gap: 4px;">
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #e2e8f0; padding-bottom: 3px;">
          <span style="color: #475569; font-weight: 800; font-size: 9.5px;">بيانات العميل والحساب</span>
          <span style="font-size: 8.5px; font-weight: 800; background: #f0f5f3; color: #0D4A39; border: 1px solid #c5d6d1; padding: 1px 6px; border-radius: 4px;">${safeCustomerTypeLabel}</span>
        </div>
        <div style="font-weight: 900; font-size: 13.5px; color: #0f172a;">${safeCustomerName}</div>
        <div style="display: flex; flex-direction: column; gap: 2.5px; font-size: 9.5px; border-top: 1px dashed #e2e8f0; padding-top: 4px;">
          <div style="display: flex; justify-content: space-between;">
            <span style="color: #64748b; font-weight: 700;">كود الحساب:</span>
            <bdi dir="ltr" style="font-weight: 800; color: #0D4A39; ${monoStyle}">${safeCustomerCode}</bdi>
          </div>
          <div style="display: flex; justify-content: space-between;">
            <span style="color: #64748b; font-weight: 700;">رقم الهاتف:</span>
            <bdi dir="ltr" style="font-weight: 800; color: #0f172a; ${monoStyle}">${safeCustomerPhone}</bdi>
          </div>
          ${
            safeCustomerAddress
              ? `<div style="display: flex; justify-content: space-between;"><span style="color: #64748b; font-weight: 700;">العنوان:</span><span style="font-weight: 700; color: #334155;">${safeCustomerAddress}</span></div>`
              : `<div style="display: flex; justify-content: space-between;"><span style="color: #64748b; font-weight: 700;">تاريخ فتح الملف:</span><bdi dir="ltr" style="font-weight: 700; color: #334155; ${monoStyle}">${safeCreatedAt}</bdi></div>`
          }
        </div>
      </div>

      <div style="border: 1px solid #cbd5e1; border-top: 2.5px solid #C5A059; border-radius: 6px; padding: 8px 11px; background: #fafcfb; display: flex; flex-direction: column; justify-content: space-between; gap: 4px;">
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #e2e8f0; padding-bottom: 3px;">
          <span style="color: #475569; font-weight: 800; font-size: 9.5px;">نطاق الفترة والعملات المشمولة</span>
          <span style="font-size: 8.5px; font-weight: 800; background: #fef9ee; color: #854d0e; border: 1px solid #e9d5a1; padding: 1px 6px; border-radius: 4px;">فترة محددة</span>
        </div>
        <div style="display: flex; flex-direction: column; gap: 3px; font-size: 9.5px;">
          <div style="display: flex; justify-content: space-between;">
            <span style="color: #64748b; font-weight: 700;">نطاق الفترة:</span>
            <span style="font-weight: 800; color: #0f172a;">من <bdi dir="ltr" style="${monoStyle}">${safePeriodFrom}</bdi> إلى <bdi dir="ltr" style="${monoStyle}">${safePeriodTo}</bdi></span>
          </div>
          <div style="display: flex; justify-content: space-between; gap: 8px;">
            <span style="color: #64748b; font-weight: 700; white-space: nowrap;">العملات المفصولة:</span>
            <span style="font-weight: 800; color: #0D4A39; text-align: left;">${escapeHtml(includedCurrenciesText)}</span>
          </div>
          <div style="display: flex; justify-content: space-between;">
            <span style="color: #64748b; font-weight: 700;">إجمالي القيود المسجلة:</span>
            <span style="font-weight: 800; color: #0f172a;">${totalLinesAll} حركة (${validStatements.length} عملات)</span>
          </div>
        </div>
        <div style="font-size: 8.5px; color: #475569; font-weight: 700; background: #f0f5f3; border-radius: 4px; padding: 4px 6px; text-align: center;">
          كل عملة محاسبية مفصولة بالكامل في رصيدها وجدولها دون أي خلط أو جمع بين العملات
        </div>
      </div>
    </div>

    <!-- 3. ملخص إجمالي المبالغ المطلوبة حسب كل عملة (نوافذ مفصولة) -->
    <div style="margin-bottom: 10px;">
      <div style="font-size: 10.5px; font-weight: 900; color: #0D4A39; margin-bottom: 5px;">
        ملخص إجمالي المستحقات والمبالغ المطلوبة حسب كل عملة:
      </div>
      <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px;">
        ${currencySummaryCardsHtml}
      </div>
    </div>

    <!-- 4. الجداول التفصيلية المفصولة لكل عملة -->
    <div style="flex: 1;">
      ${currencyLedgersHtml}
    </div>

    <!-- 5. بيانات الحساب البنكي المعتمد وملاحظة المطابقة -->
    <div style="background: #f8faf9; border: 1px solid #cbd5e1; border-radius: 6px; padding: 7px 12px; margin-bottom: 8px; font-size: 9.5px; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; gap: 3px;">
      <div style="font-size: 9.5px; color: #0D4A39; font-weight: 800; text-align: center;">
        الحساب المعتمد للسداد: بنك الخرطوم <bdi dir="ltr" style="${monoStyle}">3283046</bdi> (طارق عثمان / تي ايه للدعايه والاعلان)
      </div>
      <div style="font-size: 8.5px; color: #475569; font-weight: 600; text-align: center;">
        ملاحظة محاسبية: يُعد هذا الكشف مطابقاً وصحيحاً ما لم يرد إشعار خطي بأي ملاحظات خلال 7 أيام من تاريخ الإصدار.
      </div>
    </div>

    <!-- 6. التذييل الرسمي المتوازن -->
    <div style="display: grid; grid-template-columns: 1fr 84px 1fr; gap: 14px; align-items: stretch; padding-top: 7px; border-top: 1px solid #cbd5e1; margin-bottom: 3px;">
      <div style="border: 1px solid #cbd5e1; border-radius: 6px; padding: 8px 12px; height: 84px; display: flex; flex-direction: column; justify-content: space-between; box-sizing: border-box; background: #ffffff;">
        <div style="font-weight: 800; font-size: 10.5px; color: #0f172a; border-bottom: 1px solid #f1f5f9; padding-bottom: 3px;">اعتماد واستلام العميل</div>
        <div style="flex: 1;"></div>
        <div style="display: flex; justify-content: space-between; align-items: center; font-size: 9px; color: #64748b; font-weight: 700; border-top: 1px solid #e2e8f0; padding-top: 4px;">
          <span>التوقيع والختم الرسمي</span>
          <span>التاريخ: .... / .... / 202</span>
        </div>
      </div>

      <div style="width: 84px; height: 84px; padding: 5px; background: #ffffff; border: 1px solid #cbd5e1; border-radius: 6px; display: flex; align-items: center; justify-content: center; box-sizing: border-box;">
        <img src="${TA_QR_CODE_BASE64}" alt="QR Code" style="width: 100%; height: 100%; object-fit: contain;" />
      </div>

      <div style="border: 1px solid #cbd5e1; border-radius: 6px; padding: 8px 12px; height: 84px; display: flex; flex-direction: column; justify-content: space-between; box-sizing: border-box; background: #ffffff;">
        <div style="font-weight: 800; font-size: 10.5px; color: #0f172a; border-bottom: 1px solid #f1f5f9; padding-bottom: 3px;">
          إدارة الحسابات المالية
        </div>
        <div style="flex: 1; display: flex; align-items: center; justify-content: space-between; gap: 10px; padding-top: 2px;">
          <div style="text-align: right;">
            <div style="font-weight: 900; font-size: 11.5px; color: #0D4A39; line-height: 1.25;">طارق عثمان علي</div>
            <div style="font-size: 9px; color: #475569; font-weight: 700; margin-top: 2px;">المدير المالي والتشغيلي المعتمد</div>
          </div>
          <div style="display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
            <img
              src="${TA_SIGNATURE_TARIG_BASE64}"
              alt="Signature"
              style="max-height: 44px; width: auto; object-fit: contain; pointer-events: none; mix-blend-mode: multiply;"
            />
          </div>
        </div>
      </div>
    </div>

    <div style="text-align: center; font-size: 8.5px; color: #64748b; font-weight: 700; padding-top: 2px;">
      نظام T.A Advertising Solution لإدارة الحسابات والمراسلات المالية — مستند رسمي صادر آلياً ومطابق للقيود المسجلة
    </div>
  `;

  return container;
}

export async function printCustomerStatement(
  statement: CustomerStatement,
  customer: CustomerRecord,
  currency = statement.currency || "SDG",
  allStatements?: CustomerStatement[]
): Promise<boolean> {
  const isMulti = Array.isArray(allStatements) && allStatements.length > 1;
  const container = isMulti
    ? buildMultiCurrencyStatementDomElement(allStatements, customer)
    : buildStatementDomElement(statement, customer, currency);
  container.id = "customer-statement-print-mount";

  const mountWrapper = document.createElement("div");
  mountWrapper.id = "customer-statement-print-wrapper";
  mountWrapper.style.cssText =
    "position: fixed; left: -9999px; top: 0; width: 0; height: 0; overflow: hidden; pointer-events: none; z-index: -9999;";
  mountWrapper.appendChild(container);
  document.body.appendChild(mountWrapper);

  const curSuffix = isMulti
    ? allStatements.map((s) => s.currency).join("-")
    : currency;
  const docTitle = `كشف-حساب-${statement.customerName.replace(/[\s/]/g, "_")}-${curSuffix}-${getLocalIsoDate()}`;

  document.body.classList.add("printing-custom-invoice");
  try {
    await triggerPrintWithElement(container, docTitle, "a4", () => {
      document.body.classList.remove("printing-custom-invoice");
      if (mountWrapper.parentNode) mountWrapper.parentNode.removeChild(mountWrapper);
    });
    return true;
  } catch {
    document.body.classList.remove("printing-custom-invoice");
    if (mountWrapper.parentNode) mountWrapper.parentNode.removeChild(mountWrapper);
    toast.error("تعذر طباعة كشف الحساب");
    return false;
  }
}

export async function shareCustomerStatementViaWhatsApp(
  statement: CustomerStatement,
  customer: CustomerRecord,
  currency = statement.currency || "SDG",
  allStatements?: CustomerStatement[]
): Promise<boolean> {
  const isMulti = Array.isArray(allStatements) && allStatements.length > 1;
  const container = isMulti
    ? buildMultiCurrencyStatementDomElement(allStatements, customer)
    : buildStatementDomElement(statement, customer, currency);
  container.id = "customer-statement-share-mount";

  const mountWrapper = document.createElement("div");
  mountWrapper.id = "customer-statement-share-wrapper";
  mountWrapper.style.cssText =
    "position: fixed; left: -9999px; top: 0; width: 0; height: 0; overflow: hidden; pointer-events: none; z-index: -9999;";
  mountWrapper.appendChild(container);
  document.body.appendChild(mountWrapper);

  const curSuffix = isMulti
    ? allStatements.map((s) => s.currency).join("-")
    : currency;
  const docTitle = `كشف-حساب-${statement.customerName.replace(/[\s/]/g, "_")}-${curSuffix}`;

  try {
    await shareInvoiceViaWhatsApp(container, {
      filename: docTitle,
      format: "a4",
      partyName: statement.customerName,
      invoiceRef: "كشف حساب",
      totalAmount: isMulti ? undefined : (statement.netBalance ?? statement.outstanding),
      currency: isMulti ? undefined : currency,
      invoiceTypeLabel: isMulti ? "كشف حساب متعدد العملات" : "كشف حساب",
      isRtl: true,
    });
    if (mountWrapper.parentNode) mountWrapper.parentNode.removeChild(mountWrapper);
    return true;
  } catch {
    if (mountWrapper.parentNode) mountWrapper.parentNode.removeChild(mountWrapper);
    toast.error("تعذر مشاركة كشف الحساب عبر واتساب");
    return false;
  }
}
