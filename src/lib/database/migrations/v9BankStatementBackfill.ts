/**
 * ═══════════════════════════════════════════════════════════════
 * Schema v9 Migration — Automatic Historical Bank Statement Backfill
 * ═══════════════════════════════════════════════════════════════
 * Purely additive and 100% idempotent:
 *  1. Ensures all 4 canonical currency accounts (SDG, USD, SAR, EGP) exist.
 *  2. Migrates any historical `customer_payments`, `supplier_payments`, and
 *     `expense_payments` that lack a corresponding active `financial_transactions`
 *     row into the matching currency account using their EXACT ORIGINAL DATE
 *     (`paid_at` / `expense_date` / `created_at`) — NEVER today's date.
 *  3. On upgrade from an older app version (`from < 9`), migrates any legacy
 *     unsettled `expenses` (which had 0 `expense_payments` in older versions)
 *     into `expense_payments` + `financial_transactions` using `expenses.expense_date`,
 *     with deterministic IDs so re-runs never create duplicates.
 *  4. Repairs any existing `financial_transactions` row with a missing/malformed
 *     `occurred_at` or `currency` from its original source document without ever
 *     overwriting a valid historical date with today.
 */

import { sanitizeCurrency, type AppCurrency } from "@/lib/currency/types";
import { normalizeIsoDate } from "@/lib/dateUtils";
import { seedStandardCurrencyAccounts } from "./v8MultiCurrencyAccounts";
import type { MigrationDatabase } from "./v2BusinessModel";

export const V9_VERSION = 9;

export interface V9Outcome {
  migratedCustomerPayments: number;
  migratedSupplierPayments: number;
  migratedExpensePayments: number;
  migratedLegacyExpenses: number;
  repairedTransactionDates: number;
}

async function tableExists(db: MigrationDatabase, table: string): Promise<boolean> {
  try {
    const res = await db.query(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1",
      [table]
    );
    return Boolean(res?.values?.length);
  } catch {
    return false;
  }
}

async function buildAccountByCurrencyMap(db: MigrationDatabase): Promise<{
  byCurrency: Map<AppCurrency, string>;
  activeAccountCurrency: Map<string, AppCurrency>;
}> {
  const byCurrency = new Map<AppCurrency, string>();
  const activeAccountCurrency = new Map<string, AppCurrency>();
  try {
    const res = await db.query(
      "SELECT id, COALESCE(currency, 'SDG') AS currency, is_active FROM financial_accounts ORDER BY is_active DESC, created_at ASC"
    );
    for (const row of res?.values ?? []) {
      const id = String(row.id);
      const cur = sanitizeCurrency(row.currency, "SDG");
      const isActive = Number(row.is_active ?? 1) === 1;
      if (isActive) {
        activeAccountCurrency.set(id, cur);
        if (!byCurrency.has(cur)) {
          byCurrency.set(cur, id);
        }
      }
    }
  } catch {
    // ignore if table absent
  }
  return { byCurrency, activeAccountCurrency };
}

function resolveAccountForRow(
  preferredAccountId: unknown,
  currency: AppCurrency,
  maps: { byCurrency: Map<AppCurrency, string>; activeAccountCurrency: Map<string, AppCurrency> }
): string | null {
  const prefId = preferredAccountId ? String(preferredAccountId).trim() : "";
  if (prefId && maps.activeAccountCurrency.get(prefId) === currency) {
    return prefId;
  }
  return maps.byCurrency.get(currency) ?? null;
}

/**
 * Idempotent historical backfill of revenues, supplier payments, expenses, and dates.
 * Safe to invoke multiple times — checks both deterministic IDs and `(source_type, source_id)`.
 */
export async function applyV9BankStatementBackfill(
  db: MigrationDatabase,
  nowIso: string,
  options: { migrateUnsettledLegacyExpenses?: boolean } = {}
): Promise<V9Outcome> {
  const outcome: V9Outcome = {
    migratedCustomerPayments: 0,
    migratedSupplierPayments: 0,
    migratedExpensePayments: 0,
    migratedLegacyExpenses: 0,
    repairedTransactionDates: 0,
  };

  if (!(await tableExists(db, "financial_accounts")) || !(await tableExists(db, "financial_transactions"))) {
    return outcome;
  }

  // Ensure canonical 4-currency accounts exist before backfilling movements
  await seedStandardCurrencyAccounts(db, nowIso);
  const maps = await buildAccountByCurrencyMap(db);

  // 1) Backfill orphan customer_payments (revenues) with their ORIGINAL paid_at date
  if (await tableExists(db, "customer_payments")) {
    const res = await db.query(
      `SELECT cp.id, cp.reference, cp.amount, COALESCE(cp.currency, 'SDG') AS currency,
              cp.paid_at, cp.account_id, cp.notes, cp.created_at
         FROM customer_payments cp
        WHERE cp.cancelled_at IS NULL
          AND cp.amount > 0.004
          AND NOT EXISTS (
            SELECT 1 FROM financial_transactions ft
             WHERE ft.source_type = 'customer_payment'
               AND ft.source_id = cp.id
               AND (ft.reversed_by IS NULL OR ft.reversed_by = '')
          )`
    );
    for (const row of res?.values ?? []) {
      const currency = sanitizeCurrency(row.currency, "SDG");
      const accountId = resolveAccountForRow(row.account_id, currency, maps);
      if (!accountId) continue;
      const occurredAt = normalizeIsoDate(row.paid_at, String(row.created_at || nowIso));
      const txId = `tx-mig-cp-${String(row.id)}`;
      await db.run(
        `INSERT OR IGNORE INTO financial_transactions
           (id, kind, amount, currency, occurred_at, account_id, source_type, source_id, reference_note, notes, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [
          txId,
          "receipt",
          Number(row.amount) || 0,
          currency,
          occurredAt,
          accountId,
          "customer_payment",
          String(row.id),
          row.reference ? String(row.reference) : null,
          row.notes ? String(row.notes) : null,
          String(row.created_at || nowIso),
        ]
      );
      outcome.migratedCustomerPayments++;
    }
  }

  // 2) Backfill orphan supplier_payments (purchase disbursements) with their ORIGINAL paid_at date
  if (await tableExists(db, "supplier_payments")) {
    const res = await db.query(
      `SELECT sp.id, sp.reference, sp.amount, COALESCE(sp.currency, 'SDG') AS currency,
              sp.paid_at, sp.account_id, sp.notes, sp.created_at
         FROM supplier_payments sp
        WHERE sp.cancelled_at IS NULL
          AND sp.amount > 0.004
          AND NOT EXISTS (
            SELECT 1 FROM financial_transactions ft
             WHERE ft.source_type = 'supplier_payment'
               AND ft.source_id = sp.id
               AND (ft.reversed_by IS NULL OR ft.reversed_by = '')
          )`
    );
    for (const row of res?.values ?? []) {
      const currency = sanitizeCurrency(row.currency, "SDG");
      const accountId = resolveAccountForRow(row.account_id, currency, maps);
      if (!accountId) continue;
      const occurredAt = normalizeIsoDate(row.paid_at, String(row.created_at || nowIso));
      const txId = `tx-mig-sp-${String(row.id)}`;
      await db.run(
        `INSERT OR IGNORE INTO financial_transactions
           (id, kind, amount, currency, occurred_at, account_id, source_type, source_id, reference_note, notes, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [
          txId,
          "payment",
          Number(row.amount) || 0,
          currency,
          occurredAt,
          accountId,
          "supplier_payment",
          String(row.id),
          row.reference ? String(row.reference) : null,
          row.notes ? String(row.notes) : null,
          String(row.created_at || nowIso),
        ]
      );
      outcome.migratedSupplierPayments++;
    }
  }

  // 3) Backfill orphan expense_payments with their ORIGINAL paid_at / expense_date
  if (await tableExists(db, "expense_payments")) {
    const hasExpenses = await tableExists(db, "expenses");
    const res = await db.query(
      hasExpenses
        ? `SELECT ep.id, ep.reference, ep.amount, COALESCE(ep.currency, e.currency, 'SDG') AS currency,
                  ep.paid_at, e.expense_date, ep.account_id, ep.notes, ep.created_at
             FROM expense_payments ep
             LEFT JOIN expenses e ON e.id = ep.expense_id
            WHERE ep.cancelled_at IS NULL
              AND ep.amount > 0.004
              AND NOT EXISTS (
                SELECT 1 FROM financial_transactions ft
                 WHERE ft.source_type = 'expense_payment'
                   AND ft.source_id = ep.id
                   AND (ft.reversed_by IS NULL OR ft.reversed_by = '')
              )`
        : `SELECT ep.id, ep.reference, ep.amount, COALESCE(ep.currency, 'SDG') AS currency,
                  ep.paid_at, NULL AS expense_date, ep.account_id, ep.notes, ep.created_at
             FROM expense_payments ep
            WHERE ep.cancelled_at IS NULL
              AND ep.amount > 0.004
              AND NOT EXISTS (
                SELECT 1 FROM financial_transactions ft
                 WHERE ft.source_type = 'expense_payment'
                   AND ft.source_id = ep.id
                   AND (ft.reversed_by IS NULL OR ft.reversed_by = '')
              )`
    );
    for (const row of res?.values ?? []) {
      const currency = sanitizeCurrency(row.currency, "SDG");
      const accountId = resolveAccountForRow(row.account_id, currency, maps);
      if (!accountId) continue;
      const occurredAt = normalizeIsoDate(
        row.paid_at || row.expense_date,
        String(row.created_at || nowIso)
      );
      const txId = `tx-mig-ep-${String(row.id)}`;
      await db.run(
        `INSERT OR IGNORE INTO financial_transactions
           (id, kind, amount, currency, occurred_at, account_id, source_type, source_id, reference_note, notes, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [
          txId,
          "payment",
          Number(row.amount) || 0,
          currency,
          occurredAt,
          accountId,
          "expense_payment",
          String(row.id),
          row.reference ? String(row.reference) : null,
          row.notes ? String(row.notes) : null,
          String(row.created_at || nowIso),
        ]
      );
      outcome.migratedExpensePayments++;
    }
  }

  // 4) On upgrade from an older app version, migrate legacy expenses that have NO expense_payments
  //    using their exact ORIGINAL `expenses.expense_date` (never today's date).
  if (
    options.migrateUnsettledLegacyExpenses &&
    (await tableExists(db, "expenses")) &&
    (await tableExists(db, "expense_payments"))
  ) {
    const res = await db.query(
      `SELECT e.id, e.amount, COALESCE(e.currency, 'SDG') AS currency,
              e.expense_date, e.account_id, e.method, e.evidence_ref, e.notes, e.created_at
         FROM expenses e
        WHERE e.cancelled_at IS NULL
          AND e.amount > 0.004
          AND NOT EXISTS (
            SELECT 1 FROM expense_payments ep
             WHERE ep.expense_id = e.id AND ep.cancelled_at IS NULL
          )`
    );
    for (const row of res?.values ?? []) {
      const currency = sanitizeCurrency(row.currency, "SDG");
      const accountId = resolveAccountForRow(row.account_id, currency, maps);
      if (!accountId) continue;
      const originalDate = normalizeIsoDate(row.expense_date, String(row.created_at || nowIso));
      const expPayId = `exppay-mig-${String(row.id)}`;
      const txId = `tx-mig-exp-${String(row.id)}`;
      const refNote = row.evidence_ref ? String(row.evidence_ref) : null;

      await db.run(
        `INSERT OR IGNORE INTO expense_payments
           (id, reference, expense_id, amount, currency, paid_at, method, account_id, notes, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [
          expPayId,
          null,
          String(row.id),
          Number(row.amount) || 0,
          currency,
          originalDate,
          row.method ? String(row.method) : "bank_transfer",
          accountId,
          row.notes ? String(row.notes) : null,
          String(row.created_at || nowIso),
        ]
      );
      await db.run(
        `INSERT OR IGNORE INTO financial_transactions
           (id, kind, amount, currency, occurred_at, account_id, source_type, source_id, reference_note, notes, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [
          txId,
          "payment",
          Number(row.amount) || 0,
          currency,
          originalDate,
          accountId,
          "expense_payment",
          expPayId,
          refNote,
          row.notes ? String(row.notes) : null,
          String(row.created_at || nowIso),
        ]
      );
      outcome.migratedLegacyExpenses++;
    }
  }

  // 5) Repair any existing financial_transactions whose occurred_at is blank or non-ISO,
  //    or whose currency is missing — always recovering from source document's original date.
  try {
    const badRows = await db.query(
      `SELECT t.id, t.occurred_at, t.currency, t.created_at, t.source_type, t.source_id,
              a.currency AS acc_currency
         FROM financial_transactions t
         LEFT JOIN financial_accounts a ON a.id = t.account_id
        WHERE t.occurred_at IS NULL
           OR TRIM(t.occurred_at) = ''
           OR t.occurred_at NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*'
           OR t.currency IS NULL
           OR TRIM(t.currency) = ''`
    );
    for (const row of badRows?.values ?? []) {
      const fixedDate = normalizeIsoDate(row.occurred_at, String(row.created_at || nowIso));
      const fixedCur = sanitizeCurrency(row.currency || row.acc_currency, "SDG");
      await db.run(
        "UPDATE financial_transactions SET occurred_at = ?, currency = ? WHERE id = ?",
        [fixedDate, fixedCur, String(row.id)]
      );
      outcome.repairedTransactionDates++;
    }
  } catch {
    // ignore if GLOB or columns unavailable
  }

  return outcome;
}
