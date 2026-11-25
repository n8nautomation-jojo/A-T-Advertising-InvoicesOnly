/**
 * ═══════════════════════════════════════════════════════════════
 * Schema v8 Migration — 4-Currency Canonical Bank/Treasury Accounts
 * ═══════════════════════════════════════════════════════════════
 * Purely additive and idempotent:
 *  1. Adds optional `account_number TEXT` column to `financial_accounts`
 *     so each currency account can store its Bank Account / IBAN number.
 *  2. Ensures an active account exists for each of the 4 supported
 *     currencies (`SDG`, `USD`, `SAR`, `EGP`) with `opening_balance = 0`,
 *     so recording receipts, supplier payments, or expenses in ANY
 *     currency never blocks on manual account setup (PRD §13.2).
 */

import { STANDARD_CURRENCY_ACCOUNTS, V8_ADDED_COLUMNS } from "../schema";
import type { MigrationDatabase } from "./v2BusinessModel";

export const V8_VERSION = 8;

async function tableColumns(db: MigrationDatabase, table: string): Promise<Set<string>> {
  const names = new Set<string>();
  try {
    const res = await db.query(`PRAGMA table_info(${table})`);
    for (const row of res?.values ?? []) {
      if (row?.name) names.add(String(row.name));
    }
  } catch {
    // table absent
  }
  return names;
}

export async function addV8AccountColumns(db: MigrationDatabase): Promise<string[]> {
  const added: string[] = [];
  for (const [table, columns] of Object.entries(V8_ADDED_COLUMNS)) {
    const existing = await tableColumns(db, table);
    if (existing.size === 0) continue;
    for (const col of columns) {
      if (existing.has(col.name)) continue;
      await db.execute(`ALTER TABLE ${table} ADD COLUMN ${col.name} ${col.ddl};`, false);
      added.push(`${table}.${col.name}`);
    }
  }
  return added;
}

export async function seedStandardCurrencyAccounts(
  db: MigrationDatabase,
  nowIso: string
): Promise<number> {
  let seeded = 0;
  const cols = await tableColumns(db, "financial_accounts");
  if (cols.size === 0) return 0;

  const hasCurrency = cols.has("currency");
  const hasAccountNumber = cols.has("account_number");

  for (const spec of STANDARD_CURRENCY_ACCOUNTS) {
    const existingRes = hasCurrency
      ? await db.query(
          "SELECT id FROM financial_accounts WHERE is_active = 1 AND COALESCE(currency, 'SDG') = ? LIMIT 1",
          [spec.currency]
        )
      : spec.currency === "SDG"
      ? await db.query("SELECT id FROM financial_accounts WHERE is_active = 1 LIMIT 1")
      : { values: [] };

    if (existingRes?.values?.length) {
      if (hasAccountNumber && spec.defaultAccountNumber) {
        const existingId = String(existingRes.values[0].id);
        await db.run(
          "UPDATE financial_accounts SET account_number = ? WHERE id = ? AND (account_number IS NULL OR account_number = '')",
          [spec.defaultAccountNumber, existingId]
        );
      }
      continue;
    }

    if (hasCurrency && hasAccountNumber) {
      await db.run(
        `INSERT OR IGNORE INTO financial_accounts
           (id, name, kind, currency, account_number, opening_balance, is_active, created_at)
         VALUES (?,?,?,?,?,?,?,?)`,
        [spec.id, spec.name, spec.kind, spec.currency, spec.defaultAccountNumber, 0, 1, nowIso]
      );
    } else if (hasCurrency) {
      await db.run(
        `INSERT OR IGNORE INTO financial_accounts
           (id, name, kind, currency, opening_balance, is_active, created_at)
         VALUES (?,?,?,?,?,?,?)`,
        [spec.id, spec.name, spec.kind, spec.currency, 0, 1, nowIso]
      );
    } else if (spec.currency === "SDG") {
      await db.run(
        `INSERT OR IGNORE INTO financial_accounts
           (id, name, kind, opening_balance, is_active, created_at)
         VALUES (?,?,?,?,?,?)`,
        [spec.id, spec.name, spec.kind, 0, 1, nowIso]
      );
    }
    seeded++;
  }

  return seeded;
}

export interface V8Outcome {
  columnsAdded: string[];
  accountsSeeded: number;
}

export async function applyV8MultiCurrencyAccounts(
  db: MigrationDatabase,
  nowIso: string
): Promise<V8Outcome> {
  const columnsAdded = await addV8AccountColumns(db);
  const accountsSeeded = await seedStandardCurrencyAccounts(db, nowIso);
  return { columnsAdded, accountsSeeded };
}
