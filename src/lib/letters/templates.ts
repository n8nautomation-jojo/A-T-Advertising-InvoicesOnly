/**
 * ═══════════════════════════════════════════════════════════════
 * Unified Official Corporate Letterhead Defaults (AR / EN)
 * ═══════════════════════════════════════════════════════════════
 * Single flexible legal & corporate letterhead template for
 * T.A Advertising Solution. Users edit only the key details
 * (recipient, subject, optional title, body) in Arabic or English.
 */

import { getLocalIsoDate } from "@/lib/dateUtils";
import type { LetterLanguage, OfficialLetter } from "./types";

export const DEFAULT_SIGNATORY_NAME_AR = "طارق عثمان علي";
export const DEFAULT_SIGNATORY_TITLE_AR = "المدير العام — T.A Advertising Solution";
export const DEFAULT_SALUTATION_AR = "السلام عليكم ورحمة الله وبركاته،،،";
export const DEFAULT_CLOSING_AR = "وتفضلوا بقبول فائق الاحترام والتقدير،،،";

export const DEFAULT_SIGNATORY_NAME_EN = "Tarig Osman Ali";
export const DEFAULT_SIGNATORY_TITLE_EN = "General Manager — T.A Advertising Solution";
export const DEFAULT_SALUTATION_EN = "Dear Sir / Madam,";
export const DEFAULT_CLOSING_EN = "Yours sincerely,";

export const RECIPIENT_HONORIFIC_OPTIONS_AR = [
  "السادة /",
  "السيد /",
  "إدارة /",
  "إلى من يهمه الأمر",
] as const;

export const RECIPIENT_HONORIFIC_OPTIONS_EN = [
  "Messrs.",
  "Mr. / Ms.",
  "Management of",
  "To Whom It May Concern",
] as const;

export const DEFAULT_SUBJECT_AR = "طلب سداد دفعة مقدمة للبدء في التنفيذ";
export const DEFAULT_SUBJECT_EN = "Request for Advance Payment to Commence Execution";

export const DEFAULT_BODY_AR = [
  "تهديكم T.A Advertising Solution أطيب التحيات، وتثمّن عالياً ثقتكم وتعاونكم المستمر معنا.",
  "بالإشارة إلى الفاتورة / عرض السعر المعتمد رقم [رقم الفاتورة] وتفاصيل الأعمال المتفق عليها، نرجو من سيادتكم التكرم بسداد الدفعة المقدمة بنسبة [النسبة %] من إجمالي قيمة الفاتورة والبالغة [المبلغ]، وذلك ليتسنى لفريقنا الفني الجدولة والبدء الفوري في إجراءات التنفيذ والإنتاج وفق أعلى معايير الجودة والالتزام بالجدول الزمني المحدد.",
  "نشكر لكم حسن تعاونكم وسرعة استجابتكم، ونسعد دائماً بخدمتكم وتقديم أفضل الحلول الإعلانية المتكاملة.",
].join("\n\n");

export const DEFAULT_BODY_EN = [
  "T.A Advertising Solution extends its warmest greetings and sincerely appreciates your valued trust and continued cooperation.",
  "With reference to the approved Invoice / Quotation No. [Invoice No.] and the agreed scope of work, we kindly request settlement of the advance payment of [Percentage %] of the total invoice value amounting to [Amount], enabling our technical team to schedule and immediately commence execution and production in accordance with the agreed timeline and highest quality standards.",
  "We thank you for your kind cooperation and prompt response, and we remain committed to delivering excellence in all your advertising solutions.",
].join("\n\n");

export function createOfficialLetter(
  reference: string,
  language: LetterLanguage = "ar",
  overrides?: Partial<OfficialLetter>
): OfficialLetter {
  const isEn = language === "en";
  const nowIso = new Date().toISOString();
  return {
    id: `ltr-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    reference,
    language,
    date: getLocalIsoDate(),
    showLetterTitle: false,
    letterTitle: "",
    recipientHonorific: isEn ? "Messrs." : "السادة /",
    recipientName: "",
    recipientTitle: "",
    salutation: isEn ? DEFAULT_SALUTATION_EN : DEFAULT_SALUTATION_AR,
    subject: isEn ? DEFAULT_SUBJECT_EN : DEFAULT_SUBJECT_AR,
    body: isEn ? DEFAULT_BODY_EN : DEFAULT_BODY_AR,
    closingPhrase: isEn ? DEFAULT_CLOSING_EN : DEFAULT_CLOSING_AR,
    signatoryName: isEn ? DEFAULT_SIGNATORY_NAME_EN : DEFAULT_SIGNATORY_NAME_AR,
    signatoryTitle: isEn ? DEFAULT_SIGNATORY_TITLE_EN : DEFAULT_SIGNATORY_TITLE_AR,
    includeSignature: true,
    includeStamp: true,
    includeQr: true,
    createdAt: nowIso,
    updatedAt: nowIso,
    ...overrides,
  };
}
