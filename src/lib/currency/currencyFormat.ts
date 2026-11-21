import { AppCurrency, DEFAULT_CURRENCY, SUPPORTED_CURRENCIES, sanitizeCurrency } from "./types";
import { formatNumber } from "@/lib/printCalculator";

export interface FormatCurrencyOptions {
  showIso?: boolean;
  decimals?: number;
  useFixedDecimals?: boolean;
}

/**
 * تنسيق المبالغ المالية مع كود الآيزو للعملة المحددة
 * مثال: formatCurrencyAmount(65000, "SDG") -> "65,000.00 SDG"
 */
export function formatCurrencyAmount(
  amount: number | undefined | null,
  currency: AppCurrency = DEFAULT_CURRENCY,
  options: FormatCurrencyOptions = {}
): string {
  const { showIso = true, decimals = 2, useFixedDecimals = true } = options;
  const safeCurrency = sanitizeCurrency(currency);
  const rawNum = typeof amount === "number" && Number.isFinite(amount) ? amount : 0;
  const num = Object.is(rawNum, -0) ? 0 : rawNum;
  const safeDecimals = Number.isInteger(decimals) && decimals >= 0 && decimals <= 6 ? decimals : 2;

  // تنسيق الأرقام مع فواصل الآلاف
  let formattedNumber: string;
  if (useFixedDecimals) {
    const isNegative = num < 0;
    const absFixed = Math.abs(num).toFixed(safeDecimals);
    const [intPart, decPart] = absFixed.split(".");
    const withCommas = Number(intPart).toLocaleString("en-US");
    const signed = isNegative && Number(absFixed) !== 0 ? `-${withCommas}` : withCommas;
    formattedNumber = decPart !== undefined ? `${signed}.${decPart}` : signed;
  } else {
    formattedNumber = formatNumber(num);
  }

  if (!showIso) {
    return formattedNumber;
  }

  return `${formattedNumber} ${safeCurrency}`;
}

/**
 * جلب اسم العملة المترجم
 */
export function getCurrencyDisplayName(
  currency: AppCurrency = DEFAULT_CURRENCY,
  locale: "ar" | "en" = "ar"
): string {
  const safeCurrency = sanitizeCurrency(currency);
  const conf = SUPPORTED_CURRENCIES[safeCurrency];
  return locale === "en" ? conf.nameEn : conf.nameAr;
}

/**
 * الرمز المختصر الموحّد للعملة في واجهات التطبيق:
 * SDG -> "ج.س" | USD -> "$" | SAR -> "ر.س" | EGP -> "ج.م"
 */
export function getCurrencyShortLabel(currency?: string | null): string {
  const safeCurrency = sanitizeCurrency(currency, DEFAULT_CURRENCY);
  return SUPPORTED_CURRENCIES[safeCurrency]?.symbol ?? safeCurrency;
}

