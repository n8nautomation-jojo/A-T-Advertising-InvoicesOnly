/**
 * ═══════════════════════════════════════════════════════════════
 * Official Letter Repository — SQLite CRUD (`official_letters`)
 * ═══════════════════════════════════════════════════════════════
 * Authoritative persistence for bilingual official corporate letters.
 * All mutations execute inside the FIFO SQLite write lock and notify
 * the backup scheduler on completion.
 */

import { getDb } from "@/lib/database";
import { withDbWriteLock } from "@/lib/database/writeLock";
import { notifyDataChanged } from "@/lib/backup/notify";
import type { OfficialLetter } from "@/lib/letters/types";

function rowToOfficialLetter(row: any): OfficialLetter {
  const language = row.language === "en" ? "en" : "ar";
  return {
    id: String(row.id),
    reference: String(row.reference ?? "TA-001"),
    language,
    date: String(row.date ?? ""),
    showLetterTitle: row.show_letter_title === 1 || row.show_letter_title === true,
    letterTitle: String(row.letter_title ?? ""),
    recipientHonorific: String(row.recipient_honorific ?? ""),
    recipientName: String(row.recipient_name ?? ""),
    recipientTitle: row.recipient_title ? String(row.recipient_title) : undefined,
    salutation: String(row.salutation ?? ""),
    subject: String(row.subject ?? ""),
    body: String(row.body ?? ""),
    closingPhrase: String(row.closing_phrase ?? ""),
    signatoryName: String(row.signatory_name ?? ""),
    signatoryTitle: String(row.signatory_title ?? ""),
    includeSignature: row.include_signature !== 0 && row.include_signature !== false,
    includeStamp: row.include_stamp !== 0 && row.include_stamp !== false,
    includeQr: row.include_qr !== 0 && row.include_qr !== false,
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? row.created_at ?? ""),
  };
}

export async function getAllOfficialLetters(): Promise<OfficialLetter[]> {
  const db = await getDb();
  const res = await db.query(
    "SELECT * FROM official_letters ORDER BY updated_at DESC, created_at DESC"
  );
  return (res.values ?? []).map(rowToOfficialLetter);
}

export async function upsertOfficialLetter(letter: OfficialLetter): Promise<void> {
  await withDbWriteLock(async () => {
    const db = await getDb();
    await db.run(
      `INSERT INTO official_letters (
        id, reference, language, date, show_letter_title, letter_title,
        recipient_honorific, recipient_name, recipient_title,
        salutation, subject, body, closing_phrase,
        signatory_name, signatory_title,
        include_signature, include_stamp, include_qr,
        created_at, updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET
        reference           = excluded.reference,
        language            = excluded.language,
        date                = excluded.date,
        show_letter_title   = excluded.show_letter_title,
        letter_title        = excluded.letter_title,
        recipient_honorific = excluded.recipient_honorific,
        recipient_name      = excluded.recipient_name,
        recipient_title     = excluded.recipient_title,
        salutation          = excluded.salutation,
        subject             = excluded.subject,
        body                = excluded.body,
        closing_phrase      = excluded.closing_phrase,
        signatory_name      = excluded.signatory_name,
        signatory_title     = excluded.signatory_title,
        include_signature   = excluded.include_signature,
        include_stamp       = excluded.include_stamp,
        include_qr          = excluded.include_qr,
        updated_at          = excluded.updated_at`,
      [
        letter.id,
        letter.reference,
        letter.language === "en" ? "en" : "ar",
        letter.date,
        letter.showLetterTitle ? 1 : 0,
        letter.letterTitle ?? "",
        letter.recipientHonorific ?? "",
        letter.recipientName ?? "",
        letter.recipientTitle ?? null,
        letter.salutation ?? "",
        letter.subject ?? "",
        letter.body ?? "",
        letter.closingPhrase ?? "",
        letter.signatoryName ?? "",
        letter.signatoryTitle ?? "",
        letter.includeSignature !== false ? 1 : 0,
        letter.includeStamp !== false ? 1 : 0,
        letter.includeQr !== false ? 1 : 0,
        letter.createdAt,
        letter.updatedAt,
      ]
    );
  });
  notifyDataChanged();
}

export async function deleteOfficialLetter(id: string): Promise<void> {
  await withDbWriteLock(async () => {
    const db = await getDb();
    await db.run("DELETE FROM official_letters WHERE id = ?", [id]);
  });
  notifyDataChanged();
}
