/**
 * ═══════════════════════════════════════════════════════════════
 * Local calendar date utilities (timezone-safe)
 * ═══════════════════════════════════════════════════════════════
 * Pure module: avoids UTC midnight shifts (e.g. 00:00–01:59 UTC+2 in Sudan
 * shifting to the previous day/year when using `toISOString().slice(0, 10)`).
 */

const ARABIC_INDIC_MAP: Record<string, string> = {
  "٠": "0",
  "١": "1",
  "٢": "2",
  "٣": "3",
  "٤": "4",
  "٥": "5",
  "٦": "6",
  "٧": "7",
  "٨": "8",
  "٩": "9",
  "۰": "0",
  "۱": "1",
  "۲": "2",
  "۳": "3",
  "۴": "4",
  "۵": "5",
  "۶": "6",
  "۷": "7",
  "۸": "8",
  "۹": "9",
};

function toAsciiDigits(input: string): string {
  return input.replace(/[٠-٩۰-۹]/g, (ch) => ARABIC_INDIC_MAP[ch] ?? ch);
}

function normalizeDate(date: Date): Date {
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function pad4(value: number): string {
  return String(value).padStart(4, "0");
}

/** Returns `YYYY-MM-DD` in the device's local calendar timezone. */
export function getLocalIsoDate(date: Date = new Date()): string {
  const safe = normalizeDate(date);
  return `${pad4(safe.getFullYear())}-${pad2(safe.getMonth() + 1)}-${pad2(safe.getDate())}`;
}

/** Returns the 4-digit calendar year in the device's local timezone. */
export function getLocalYear(date: Date = new Date()): number {
  return normalizeDate(date).getFullYear();
}

function isValidCalendarYmd(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (year < 1970 || year > 2200 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const dt = new Date(Date.UTC(year, month - 1, day));
  return (
    !Number.isNaN(dt.getTime()) &&
    dt.getUTCFullYear() === year &&
    dt.getUTCMonth() === month - 1 &&
    dt.getUTCDate() === day
  );
}

/**
 * Parses a date string (`YYYY-MM-DD`, `YYYY/MM/DD`, `DD/MM/YYYY`, `DD-MM-YYYY`,
 * or ISO timestamp, with ASCII or Arabic-Indic digits) into canonical `YYYY-MM-DD`.
 * Never overwrites a valid historical date with today; only uses `fallback` if unparseable.
 */
export function normalizeIsoDate(raw: unknown, fallback?: string): string {
  const tryParse = (value: unknown): string | null => {
    if (value == null) return null;
    const cleaned = toAsciiDigits(String(value).trim());
    if (!cleaned) return null;

    // 1) YYYY-MM-DD or YYYY/MM/DD (optionally followed by T... or space...)
    const ymd = cleaned.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if (ymd) {
      const y = Number(ymd[1]);
      const m = Number(ymd[2]);
      const d = Number(ymd[3]);
      if (isValidCalendarYmd(y, m, d)) {
        return `${pad4(y)}-${pad2(m)}-${pad2(d)}`;
      }
    }

    // 2) DD/MM/YYYY or DD-MM-YYYY
    const dmy = cleaned.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
    if (dmy) {
      const d = Number(dmy[1]);
      const m = Number(dmy[2]);
      const y = Number(dmy[3]);
      if (isValidCalendarYmd(y, m, d)) {
        return `${pad4(y)}-${pad2(m)}-${pad2(d)}`;
      }
    }

    // 3) Fallback Date.parse for valid timestamps (e.g. "25-Nov-2026" or RFC strings)
    const parsed = new Date(cleaned);
    if (!Number.isNaN(parsed.getTime())) {
      const y = parsed.getUTCFullYear();
      const m = parsed.getUTCMonth() + 1;
      const d = parsed.getUTCDate();
      if (isValidCalendarYmd(y, m, d)) {
        return `${pad4(y)}-${pad2(m)}-${pad2(d)}`;
      }
    }

    return null;
  };

  return tryParse(raw) ?? tryParse(fallback) ?? getLocalIsoDate();
}

/**
 * Shifts an ISO date (`YYYY-MM-DD`) by `deltaDays` safely in UTC without ever throwing.
 */
export function shiftIsoDateDays(isoDate: string, deltaDays: number): string {
  const normalized = normalizeIsoDate(isoDate);
  const parts = normalized.split("-").map(Number);
  if (parts.length !== 3 || !isValidCalendarYmd(parts[0], parts[1], parts[2])) {
    return normalized;
  }
  const dt = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  dt.setUTCDate(dt.getUTCDate() + Math.trunc(Number(deltaDays) || 0));
  if (Number.isNaN(dt.getTime())) {
    return normalized;
  }
  return `${pad4(dt.getUTCFullYear())}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}
