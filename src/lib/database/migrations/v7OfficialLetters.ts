/**
 * ═══════════════════════════════════════════════════════════════
 * Schema v7 Migration — Official Corporate Letters (`official_letters`)
 * ═══════════════════════════════════════════════════════════════
 * Purely additive and idempotent:
 *  1. Creates the `official_letters` table and its date/reference indexes.
 *  2. Migrates any legacy JSON array stored in `settings` under key
 *     `'ta_official_letters_v1'` into rows in `official_letters` using
 *     `INSERT OR IGNORE` so re-running never overwrites newer rows.
 */

import { CREATE_SCHEMA_V7 } from "../schema";
import type { MigrationDatabase } from "./v2BusinessModel";

export const V7_VERSION = 7;

const LEGACY_LETTERS_SETTINGS_KEY = "ta_official_letters_v1";

export interface V7Outcome {
  tableReady: boolean;
  migratedLetters: number;
}

async function tableExists(db: MigrationDatabase, table: string): Promise<boolean> {
  const res = await db.query(
    "SELECT name FROM sqlite_master WHERE type='table' AND name = ? LIMIT 1",
    [table]
  );
  return Boolean(res?.values?.length);
}

/** Idempotent DDL for the v7 `official_letters` table and indexes. */
export async function ensureSchemaV7(db: MigrationDatabase): Promise<boolean> {
  for (const statement of CREATE_SCHEMA_V7) {
    await db.execute(statement + ";", false);
  }
  return tableExists(db, "official_letters");
}

function toStringOrDefault(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function toNonEmptyStringOrDefault(value: unknown, fallback: string): string {
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }
  return fallback;
}

/**
 * Migrates legacy letters stored as a JSON array in `settings` under
 * `'ta_official_letters_v1'` into the dedicated `official_letters` table.
 */
export async function migrateLegacyOfficialLetters(
  db: MigrationDatabase,
  nowIso: string
): Promise<number> {
  if (!(await tableExists(db, "settings"))) return 0;

  let raw = "";
  try {
    const res = await db.query("SELECT value FROM settings WHERE key = ? LIMIT 1", [
      LEGACY_LETTERS_SETTINGS_KEY,
    ]);
    raw = typeof res?.values?.[0]?.value === "string" ? res.values[0].value : "";
  } catch (err) {
    console.warn("[Migration v7] could not read legacy official letters setting:", err);
    return 0;
  }

  if (!raw || !raw.trim()) return 0;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.warn("[Migration v7] invalid JSON in legacy official letters setting:", err);
    return 0;
  }

  if (!Array.isArray(parsed) || parsed.length === 0) return 0;

  const fallbackDate = nowIso.slice(0, 10);
  let migratedLetters = 0;

  for (const entry of parsed) {
    if (!entry || typeof entry !== "object") continue;
    const item = entry as Record<string, unknown>;
    const id = typeof item.id === "string" ? item.id.trim() : "";
    if (!id) continue;

    const language = item.language === "en" ? "en" : "ar";
    const reference = toNonEmptyStringOrDefault(item.reference, "TA-001").trim();
    const date = toNonEmptyStringOrDefault(item.date, fallbackDate).trim();
    const letterTitle = toStringOrDefault(item.letterTitle, "");
    const showLetterTitle =
      typeof item.showLetterTitle === "boolean"
        ? item.showLetterTitle
        : letterTitle.trim().length > 0;
    const recipientHonorific = toNonEmptyStringOrDefault(
      item.recipientHonorific,
      language === "en" ? "Messrs." : "السادة /"
    );
    const recipientName = toStringOrDefault(item.recipientName, "");
    const recipientTitle =
      typeof item.recipientTitle === "string" && item.recipientTitle.trim().length > 0
        ? item.recipientTitle
        : null;
    const salutation = toNonEmptyStringOrDefault(
      item.salutation,
      language === "en" ? "Dear Sir / Madam," : "السلام عليكم ورحمة الله وبركاته،،،"
    );
    const subject = toStringOrDefault(item.subject, "");
    const body = toStringOrDefault(item.body, "");
    const closingPhrase = toNonEmptyStringOrDefault(
      item.closingPhrase,
      language === "en" ? "Yours sincerely," : "وتفضلوا بقبول فائق الاحترام والتقدير،،،"
    );
    const signatoryName = toNonEmptyStringOrDefault(
      item.signatoryName,
      language === "en" ? "Tarig Osman Ali" : "طارق عثمان علي"
    );
    const signatoryTitle = toNonEmptyStringOrDefault(
      item.signatoryTitle,
      language === "en"
        ? "General Manager — T.A Advertising Solution"
        : "المدير العام — T.A Advertising Solution"
    );
    const includeSignature = item.includeSignature !== false ? 1 : 0;
    const includeStamp = item.includeStamp !== false ? 1 : 0;
    const includeQr = item.includeQr !== false ? 1 : 0;
    const createdAt = toNonEmptyStringOrDefault(item.createdAt, nowIso);
    const updatedAt = toNonEmptyStringOrDefault(item.updatedAt, createdAt);

    try {
      const res = await db.run(
        `INSERT OR IGNORE INTO official_letters (
          id, reference, language, date, show_letter_title, letter_title,
          recipient_honorific, recipient_name, recipient_title,
          salutation, subject, body, closing_phrase,
          signatory_name, signatory_title,
          include_signature, include_stamp, include_qr,
          created_at, updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          id,
          reference,
          language,
          date,
          showLetterTitle ? 1 : 0,
          letterTitle,
          recipientHonorific,
          recipientName,
          recipientTitle,
          salutation,
          subject,
          body,
          closingPhrase,
          signatoryName,
          signatoryTitle,
          includeSignature,
          includeStamp,
          includeQr,
          createdAt,
          updatedAt,
        ]
      );
      const changes = Number((res as { changes?: { changes?: number } })?.changes?.changes ?? 0);
      migratedLetters += changes;
    } catch (err) {
      console.warn(`[Migration v7] could not migrate official letter ${id}:`, err);
    }
  }

  return migratedLetters;
}

export async function applyV7OfficialLetters(
  db: MigrationDatabase,
  nowIso = new Date().toISOString()
): Promise<V7Outcome> {
  const tableReady = await ensureSchemaV7(db);
  const migratedLetters = tableReady ? await migrateLegacyOfficialLetters(db, nowIso) : 0;
  return { tableReady, migratedLetters };
}
