/**
 * ═══════════════════════════════════════════════════════════════
 * Versioned schema migration runner
 * ═══════════════════════════════════════════════════════════════
 * The authoritative version marker is `db_meta.schema_version`, which the app
 * already maintains; `PRAGMA user_version` is mirrored so the native backup
 * engine reports the same number in its manifests.
 *
 * Every step is additive and re-runnable. A step that fails leaves the recorded
 * version untouched, so the next launch retries instead of running on a
 * half-migrated database.
 */

import type { MigrationDatabase } from "./v2BusinessModel";
import {
  V2_VERSION,
  addMissingColumns,
  backfillInvoiceReferences,
  ensureColumnIndexes,
  ensureSchemaV2,
  verifySequenceConsistency,
  type BackfillReport,
} from "./v2BusinessModel";
import { V3_VERSION, applyV3 } from "./v3Finance";
import { V4_VERSION, applyV4 } from "./v4Currency";
import { V5_VERSION, applyV5 } from "./v5CustomerModule";
import { V6_VERSION, applyV6MultiCurrency } from "./v6MultiCurrency";
import { V7_VERSION, applyV7OfficialLetters } from "./v7OfficialLetters";
import { V8_VERSION, applyV8MultiCurrencyAccounts } from "./v8MultiCurrencyAccounts";
import { V9_VERSION, applyV9BankStatementBackfill } from "./v9BankStatementBackfill";
import { V10_VERSION, applyV10ProductionUpgradeHeal } from "./v10ProductionUpgradeHeal";

export const SCHEMA_VERSION = V10_VERSION;

export interface MigrationOutcome {
  from: number;
  to: number;
  applied: string[];
  backfill: BackfillReport | null;
  warnings: string[];
}

function readNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
}

/** Current recorded schema version (defaults to 1 for a v1/fresh database). */
export async function getStoredSchemaVersion(db: MigrationDatabase): Promise<number> {
  try {
    const res = await db.query("SELECT value FROM db_meta WHERE key = 'schema_version' LIMIT 1");
    const fromMeta = readNumber(res?.values?.[0]?.value);
    if (fromMeta) return fromMeta;
  } catch {
    // db_meta missing (very old or fresh database)
  }
  try {
    const res = await db.query("PRAGMA user_version");
    const row = res?.values?.[0];
    const fromPragma = readNumber(row?.user_version ?? (row ? Object.values(row)[0] : null));
    if (fromPragma) return fromPragma;
  } catch {
    // ignore
  }
  return 1;
}

async function setStoredSchemaVersion(db: MigrationDatabase, version: number, nowIso: string): Promise<void> {
  await db.run("INSERT OR REPLACE INTO db_meta(key, value) VALUES('schema_version', ?)", [String(version)]);
  await db.run("INSERT OR REPLACE INTO db_meta(key, value) VALUES('schema_migrated_at', ?)", [nowIso]);
  const pragma = `PRAGMA user_version = ${Math.max(0, Math.trunc(version))};`;
  try {
    await db.execute(pragma, false);
  } catch {
    try {
      await db.query(pragma);
    } catch (err) {
      console.warn("[Migration] could not mirror user_version:", err);
    }
  }
}

/**
 * Applies every pending migration in order.
 * Never throws for a recoverable problem: callers get a report and the app
 * continues with whatever version was successfully reached.
 */
export async function runPendingMigrations(
  db: MigrationDatabase,
  options: { nowIso?: string } = {}
): Promise<MigrationOutcome> {
  const nowIso = options.nowIso ?? new Date().toISOString();
  const outcome: MigrationOutcome = {
    from: await getStoredSchemaVersion(db),
    to: 1,
    applied: [],
    backfill: null,
    warnings: [],
  };

  let haltUpgrade = false;

  // Idempotent self-heal runs only when upgrading from an older schema version,
  // avoiding unnecessary table scans and customer rewrites on every cold launch.
  if (outcome.from < SCHEMA_VERSION) {
    try {
      await ensureSchemaV2(db);
      // Column-dependent indexes run immediately when v2 columns already exist;
      // on a v1 -> v2 upgrade they run right after addMissingColumns(db) below.
      if (outcome.from >= V2_VERSION) {
        await ensureColumnIndexes(db);
      }
    } catch (err) {
      outcome.warnings.push(`ensureSchemaV2: ${String(err)}`);
    }
  }

  if (!haltUpgrade && outcome.from < V2_VERSION) {
    try {
      const addedColumns = await addMissingColumns(db);
      const indexes = await ensureColumnIndexes(db);
      outcome.backfill = await backfillInvoiceReferences(db, nowIso);
      const counters = await verifySequenceConsistency(db, nowIso);
      await setStoredSchemaVersion(db, V2_VERSION, nowIso);
      outcome.applied.push(
        `v2 (columns: ${addedColumns.length}, indexes: ${indexes.length}, references: ${outcome.backfill.assigned}, counters: ${counters})`
      );
    } catch (err) {
      haltUpgrade = true;
      outcome.warnings.push(`v2: ${String(err)}`);
      console.error("[Migration] v2 failed; version left unchanged for a retry:", err);
    }
  }

  if (!haltUpgrade && outcome.from < V3_VERSION) {
    try {
      const v3 = await applyV3(db, nowIso);
      await setStoredSchemaVersion(db, V3_VERSION, nowIso);
      outcome.applied.push(
        `v3 (expense settlements, default account ${v3.accountSeeded ? "created" : "present"})`
      );
    } catch (err) {
      haltUpgrade = true;
      outcome.warnings.push(`v3: ${String(err)}`);
      console.error("[Migration] v3 failed; version left unchanged for a retry:", err);
    }
  }

  if (!haltUpgrade && outcome.from < V4_VERSION) {
    try {
      const v4 = await applyV4(db);
      await setStoredSchemaVersion(db, V4_VERSION, nowIso);
      outcome.applied.push(`v4 (currency columns: ${v4.columnsAdded.length})`);
    } catch (err) {
      haltUpgrade = true;
      outcome.warnings.push(`v4: ${String(err)}`);
      console.error("[Migration] v4 failed; version left unchanged for a retry:", err);
    }
  }

  if (!haltUpgrade && outcome.from < V5_VERSION) {
    try {
      const v5 = await applyV5(db);
      await setStoredSchemaVersion(db, V5_VERSION, nowIso);
      outcome.applied.push(
        `v5 (customer module: columns=${v5.columnsAdded.length}, reconciled=${v5.reconciledInvoices})`
      );
    } catch (err) {
      haltUpgrade = true;
      outcome.warnings.push(`v5: ${String(err)}`);
      console.error("[Migration] v5 failed; version left unchanged for a retry:", err);
    }
  }

  if (!haltUpgrade && outcome.from < V6_VERSION) {
    try {
      // Ensure v3 default account & tables exist before adding v6 currency columns.
      if (outcome.from >= V3_VERSION) {
        await applyV3(db, nowIso);
      }
      const v6 = await applyV6MultiCurrency(db);
      await setStoredSchemaVersion(db, V6_VERSION, nowIso);
      outcome.applied.push(
        `v6 (multi-currency: columns=${v6.columnsAdded.length}, indexes=${v6.indexesCreated}, backfilled=${v6.backfilledRows})`
      );
    } catch (err) {
      haltUpgrade = true;
      outcome.warnings.push(`v6: ${String(err)}`);
      console.error("[Migration] v6 failed; version left unchanged for a retry:", err);
    }
  }

  if (!haltUpgrade && outcome.from < V7_VERSION) {
    try {
      const v7 = await applyV7OfficialLetters(db, nowIso);
      await setStoredSchemaVersion(db, V7_VERSION, nowIso);
      outcome.applied.push(
        `v7 (official_letters: ready=${v7.tableReady}, migrated=${v7.migratedLetters})`
      );
    } catch (err) {
      haltUpgrade = true;
      outcome.warnings.push(`v7: ${String(err)}`);
      console.error("[Migration] v7 failed; version left unchanged for a retry:", err);
    }
  }

  if (!haltUpgrade && outcome.from < V8_VERSION) {
    try {
      const v8 = await applyV8MultiCurrencyAccounts(db, nowIso);
      await setStoredSchemaVersion(db, V8_VERSION, nowIso);
      outcome.applied.push(
        `v8 (4-currency accounts: columns=${v8.columnsAdded.length}, seeded=${v8.accountsSeeded})`
      );
    } catch (err) {
      haltUpgrade = true;
      outcome.warnings.push(`v8: ${String(err)}`);
      console.error("[Migration] v8 failed; version left unchanged for a retry:", err);
    }
  }

  if (!haltUpgrade && outcome.from < V9_VERSION) {
    try {
      const v9 = await applyV9BankStatementBackfill(db, nowIso, {
        migrateUnsettledLegacyExpenses: true,
      });
      await setStoredSchemaVersion(db, V9_VERSION, nowIso);
      outcome.applied.push(
        `v9 (bank backfill: cp=${v9.migratedCustomerPayments}, sp=${v9.migratedSupplierPayments}, ep=${v9.migratedExpensePayments}, exp=${v9.migratedLegacyExpenses}, dates=${v9.repairedTransactionDates})`
      );
    } catch (err) {
      haltUpgrade = true;
      outcome.warnings.push(`v9: ${String(err)}`);
      console.error("[Migration] v9 failed; version left unchanged for a retry:", err);
    }
  }

  if (!haltUpgrade && outcome.from < V10_VERSION) {
    try {
      const v10 = await applyV10ProductionUpgradeHeal(db, nowIso);
      await setStoredSchemaVersion(db, V10_VERSION, nowIso);
      outcome.applied.push(
        `v10 (upgrade heal: inferredCur=${v10.inferredPaymentCurrencies}, crossCur=${v10.reroutedCrossCurrencyTx}, inactive=${v10.reroutedInactiveAccountTx}, v9Heal=${v10.v9BackfilledTotal})`
      );
    } catch (err) {
      haltUpgrade = true;
      outcome.warnings.push(`v10: ${String(err)}`);
      console.error("[Migration] v10 failed; version left unchanged for a retry:", err);
    }
  }

  outcome.to = await getStoredSchemaVersion(db);
  return outcome;
}
/** Re-runs only the reference backfill (used after a legacy JSON import). */
export async function backfillReferencesOnly(
  db: MigrationDatabase,
  nowIso = new Date().toISOString()
): Promise<BackfillReport> {
  await ensureSchemaV2(db);
  await addMissingColumns(db);
  await ensureColumnIndexes(db);
  const report = await backfillInvoiceReferences(db, nowIso);
  await verifySequenceConsistency(db, nowIso);
  return report;
}

export { V2_VERSION, V3_VERSION, V4_VERSION, V5_VERSION, V6_VERSION, V7_VERSION, V8_VERSION, V9_VERSION, V10_VERSION };
export type { MigrationDatabase };
