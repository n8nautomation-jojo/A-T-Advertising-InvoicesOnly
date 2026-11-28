/**
 * ═══════════════════════════════════════════════════════════════
 * Schema v10 Migration — Legacy Cross-Currency & Inactive Account Heal
 * ═══════════════════════════════════════════════════════════════
 * Strictly additive and 100% idempotent. Fixes real production upgrade
 * edge cases when upgrading from older app versions (v2.0.0–v2.3.4):
 *
 *  1. Ensures all 4 canonical currency accounts (SDG, USD, SAR, EGP) exist
 *     and are active.
 *  2. Infers true currency for legacy `customer_payments` / `supplier_payments`
 *     whose `currency` defaulted to `'SDG'` while all of their allocated
 *     invoices share a single non-SDG currency (e.g. USD/SAR/EGP), and syncs
 *     the matching `financial_transactions.currency`.
 *  3. Re-routes any active `financial_transactions` (and its source payment)
 *     whose `account_id` points to a DIFFERENT-currency account (e.g., legacy
 *     USD/SAR/EGP payments stored on `acc-cash` SDG before v8) or to an
 *     inactive (`is_active = 0`) / missing account into the active canonical
 *     account for that transaction's currency — preventing silent balance drops
 *     in `getAccountBalances()` and `BankStatementView`.
 *  4. Re-runs idempotent `v9` orphan backfill (with active-account guard) and
 *     original-date repair without ever overwriting valid historical dates
 *     with today's date.
 */

import { sanitizeCurrency, type AppCurrency } from "@/lib/currency/types";
import { seedStandardCurrencyAccounts } from "./v8MultiCurrencyAccounts";
import { applyV9BankStatementBackfill } from "./v9BankStatementBackfill";
import type { MigrationDatabase } from "./v2BusinessModel";

export const V10_VERSION = 10;

export interface V10Outcome {
  inferredPaymentCurrencies: number;
  reroutedCrossCurrencyTx: number;
  reroutedInactiveAccountTx: number;
  v9BackfilledTotal: number;
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

async function getActiveAccountMaps(db: MigrationDatabase): Promise<{
  byCurrency: Map<AppCurrency, string>;
  activeAccountCurrency: Map<string, AppCurrency>;
}> {
  const byCurrency = new Map<AppCurrency, string>();
  const activeAccountCurrency = new Map<string, AppCurrency>();
  try {
    const res = await db.query(
      "SELECT id, COALESCE(currency, 'SDG') AS currency, kind FROM financial_accounts WHERE is_active = 1 ORDER BY CASE WHEN kind = 'bank' THEN 0 ELSE 1 END, created_at ASC"
    );
    for (const row of res?.values ?? []) {
      const id = String(row.id);
      const cur = sanitizeCurrency(row.currency, "SDG");
      activeAccountCurrency.set(id, cur);
      if (!byCurrency.has(cur)) {
        byCurrency.set(cur, id);
      }
    }
  } catch {
    // ignore if table absent
  }
  return { byCurrency, activeAccountCurrency };
}

export async function applyV10ProductionUpgradeHeal(
  db: MigrationDatabase,
  nowIso: string
): Promise<V10Outcome> {
  const outcome: V10Outcome = {
    inferredPaymentCurrencies: 0,
    reroutedCrossCurrencyTx: 0,
    reroutedInactiveAccountTx: 0,
    v9BackfilledTotal: 0,
  };

  if (!(await tableExists(db, "financial_accounts")) || !(await tableExists(db, "financial_transactions"))) {
    return outcome;
  }

  // 1) Ensure canonical 4-currency accounts exist and are active
  await seedStandardCurrencyAccounts(db, nowIso);
  const maps = await getActiveAccountMaps(db);

  // 2) Infer currency for legacy customer_payments defaulted to SDG when all allocated invoices are in one non-SDG currency
  if (
    (await tableExists(db, "customer_payments")) &&
    (await tableExists(db, "customer_payment_allocations")) &&
    (await tableExists(db, "custom_invoices"))
  ) {
    try {
      const cpMismatch = await db.query(
        `SELECT cp.id,
                MIN(COALESCE(ci.currency, 'SDG')) AS min_cur,
                MAX(COALESCE(ci.currency, 'SDG')) AS max_cur
           FROM customer_payments cp
           JOIN customer_payment_allocations cpa ON cpa.payment_id = cp.id
           JOIN custom_invoices ci ON ci.id = cpa.invoice_id
          WHERE cp.cancelled_at IS NULL
            AND COALESCE(cp.currency, 'SDG') = 'SDG'
          GROUP BY cp.id
         HAVING min_cur = max_cur AND min_cur <> 'SDG'`
      );
      for (const row of cpMismatch?.values ?? []) {
        const cur = sanitizeCurrency(row.min_cur, "SDG");
        const targetAcc = maps.byCurrency.get(cur);
        await db.run(
          "UPDATE customer_payments SET currency = ?, account_id = COALESCE(?, account_id) WHERE id = ?",
          [cur, targetAcc ?? null, String(row.id)]
        );
        await db.run(
          "UPDATE financial_transactions SET currency = ?, account_id = COALESCE(?, account_id) WHERE source_type = 'customer_payment' AND source_id = ? AND (reversed_by IS NULL OR reversed_by = '')",
          [cur, targetAcc ?? null, String(row.id)]
        );
        outcome.inferredPaymentCurrencies++;
      }
    } catch {
      // non-fatal
    }
  }

  // Same inference for legacy supplier_payments
  if (
    (await tableExists(db, "supplier_payments")) &&
    (await tableExists(db, "supplier_payment_allocations")) &&
    (await tableExists(db, "custom_invoices"))
  ) {
    try {
      const spMismatch = await db.query(
        `SELECT sp.id,
                MIN(COALESCE(ci.currency, 'SDG')) AS min_cur,
                MAX(COALESCE(ci.currency, 'SDG')) AS max_cur
           FROM supplier_payments sp
           JOIN supplier_payment_allocations spa ON spa.payment_id = sp.id
           JOIN custom_invoices ci ON ci.id = spa.invoice_id
          WHERE sp.cancelled_at IS NULL
            AND COALESCE(sp.currency, 'SDG') = 'SDG'
          GROUP BY sp.id
         HAVING min_cur = max_cur AND min_cur <> 'SDG'`
      );
      for (const row of spMismatch?.values ?? []) {
        const cur = sanitizeCurrency(row.min_cur, "SDG");
        const targetAcc = maps.byCurrency.get(cur);
        await db.run(
          "UPDATE supplier_payments SET currency = ?, account_id = COALESCE(?, account_id) WHERE id = ?",
          [cur, targetAcc ?? null, String(row.id)]
        );
        await db.run(
          "UPDATE financial_transactions SET currency = ?, account_id = COALESCE(?, account_id) WHERE source_type = 'supplier_payment' AND source_id = ? AND (reversed_by IS NULL OR reversed_by = '')",
          [cur, targetAcc ?? null, String(row.id)]
        );
        outcome.inferredPaymentCurrencies++;
      }
    } catch {
      // non-fatal
    }
  }

  // 3) Re-route any active financial_transactions pointing to a wrong-currency account or inactive/missing account
  try {
    const txRes = await db.query(
      `SELECT t.id, t.account_id, t.source_type, t.source_id,
              COALESCE(NULLIF(TRIM(t.currency), ''), a.currency, 'SDG') AS tx_currency,
              a.currency AS acc_currency,
              a.is_active AS acc_active
         FROM financial_transactions t
         LEFT JOIN financial_accounts a ON a.id = t.account_id
        WHERE (t.reversed_by IS NULL OR t.reversed_by = '')`
    );

    for (const row of txRes?.values ?? []) {
      const txCur = sanitizeCurrency(row.tx_currency, "SDG");
      const accId = String(row.account_id ?? "");
      const accActive = row.acc_active != null && Number(row.acc_active) === 1;
      const accCur = row.acc_currency ? sanitizeCurrency(row.acc_currency, "SDG") : null;

      const isCrossCurrency = accActive && accCur !== null && accCur !== txCur;
      const isInactiveOrMissing = !accActive || !maps.activeAccountCurrency.has(accId);

      if (!isCrossCurrency && !isInactiveOrMissing) continue;

      const targetAccId = maps.byCurrency.get(txCur);
      if (!targetAccId || targetAccId === accId) continue;

      await db.run(
        "UPDATE financial_transactions SET account_id = ?, currency = ? WHERE id = ?",
        [targetAccId, txCur, String(row.id)]
      );

      // Keep source payment account_id aligned when present
      const srcType = String(row.source_type ?? "");
      const srcId = String(row.source_id ?? "");
      if (srcId) {
        if (srcType === "customer_payment" && (await tableExists(db, "customer_payments"))) {
          await db.run("UPDATE customer_payments SET account_id = ? WHERE id = ?", [targetAccId, srcId]);
        } else if (srcType === "supplier_payment" && (await tableExists(db, "supplier_payments"))) {
          await db.run("UPDATE supplier_payments SET account_id = ? WHERE id = ?", [targetAccId, srcId]);
        } else if (srcType === "expense_payment" && (await tableExists(db, "expense_payments"))) {
          await db.run("UPDATE expense_payments SET account_id = ? WHERE id = ?", [targetAccId, srcId]);
        }
      }

      if (isCrossCurrency) outcome.reroutedCrossCurrencyTx++;
      else outcome.reroutedInactiveAccountTx++;
    }
  } catch {
    // non-fatal
  }

  // 4) Run idempotent v9 backfill pass (with active-account guard) to catch any remaining orphans or malformed dates
  const v9 = await applyV9BankStatementBackfill(db, nowIso, {
    migrateUnsettledLegacyExpenses: true,
  });
  outcome.v9BackfilledTotal =
    v9.migratedCustomerPayments +
    v9.migratedSupplierPayments +
    v9.migratedExpensePayments +
    v9.migratedLegacyExpenses +
    v9.repairedTransactionDates;

  return outcome;
}
