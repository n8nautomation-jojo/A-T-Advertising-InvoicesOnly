/**
 * ═══════════════════════════════════════════════════════════════
 * Financial accounts (PRD §10)
 * ═══════════════════════════════════════════════════════════════
 * Balances are always DERIVED from ledger movements; nothing is cached here
 * (§10.2). Opening balance is the only stored figure, and it is explicit.
 */

import { getDb } from "@/lib/database";
import { withDbWriteLock } from "@/lib/database/writeLock";
import { STANDARD_CURRENCY_ACCOUNTS } from "@/lib/database/schema";
import { notifyDataChanged } from "@/lib/backup/notify";
import { getLocalIsoDate } from "@/lib/dateUtils";
import { appendAuditEntry } from "@/lib/repositories/AuditLogRepository";
import { sanitizeCurrency, type AppCurrency } from "@/lib/currency/types";
import {
  getPreferredAccountForCurrency,
  sanitizeMoney,
  type AccountBalanceReport,
  type AccountKind,
  type FinancialAccount,
} from "@/lib/domain/finance";

function round2(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function rowToAccount(row: any): FinancialAccount {
  return {
    id: String(row.id),
    name: String(row.name ?? ""),
    kind: (row.kind as AccountKind) ?? "cash",
    currency: sanitizeCurrency(row.currency, "SDG"),
    accountNumber: row.account_number ? String(row.account_number) : undefined,
    openingBalance: Number(row.opening_balance) || 0,
    isActive: Number(row.is_active ?? 1) === 1,
    notes: row.notes ?? undefined,
    createdAt: String(row.created_at),
  };
}

export async function getAllAccounts(includeInactive = false): Promise<FinancialAccount[]> {
  const db = await getDb();
  const res = await db.query(
    `SELECT * FROM financial_accounts ${includeInactive ? "" : "WHERE is_active = 1"} ORDER BY created_at ASC`
  );
  return (res.values ?? []).map(rowToAccount);
}

export async function getAccountById(id: string): Promise<FinancialAccount | undefined> {
  const db = await getDb();
  const res = await db.query("SELECT * FROM financial_accounts WHERE id = ? LIMIT 1", [id]);
  const row = res.values?.[0];
  return row ? rowToAccount(row) : undefined;
}

export async function createAccount(input: {
  name: string;
  kind: AccountKind;
  currency?: AppCurrency;
  accountNumber?: string;
  openingBalance?: number;
  notes?: string;
  nowIso?: string;
}): Promise<FinancialAccount> {
  const db = await getDb();
  const nowIso = input.nowIso ?? new Date().toISOString();
  const id = `acc-${nowIso.replace(/[^0-9]/g, "").slice(0, 14)}-${Math.random().toString(36).slice(2, 6)}`;
  const trimmedName = input.name.trim();
  const trimmedAccountNumber = input.accountNumber?.trim() || undefined;
  const rawOpening = Number(input.openingBalance ?? 0);
  if (!Number.isFinite(rawOpening)) {
    throw new Error("الرصيد الافتتاحي غير صالح");
  }
  const openingBalance = round2(rawOpening);
  const currency = sanitizeCurrency(input.currency, "SDG");
  await db.run(
    "INSERT INTO financial_accounts(id, name, kind, currency, account_number, opening_balance, is_active, notes, created_at) VALUES(?,?,?,?,?,?,?,?,?)",
    [id, trimmedName, input.kind, currency, trimmedAccountNumber ?? null, openingBalance, 1, input.notes ?? null, nowIso]
  );
  await appendAuditEntry({
    entityType: "financial_account",
    entityId: id,
    action: "create",
    details: { name: trimmedName, kind: input.kind, currency, accountNumber: trimmedAccountNumber, openingBalance },
    nowIso,
  });
  notifyDataChanged();
  return {
    id,
    name: trimmedName,
    kind: input.kind,
    currency,
    accountNumber: trimmedAccountNumber,
    openingBalance,
    isActive: true,
    notes: input.notes,
    createdAt: nowIso,
  };
}

export async function updateAccount(
  id: string,
  changes: { name?: string; kind?: AccountKind; accountNumber?: string; notes?: string; isActive?: boolean }
): Promise<void> {
  const db = await getDb();
  const current = await getAccountById(id);
  if (!current) throw new Error("الحساب المالي غير موجود");
  const nextName = changes.name?.trim() || current.name;
  const nextKind = changes.kind ?? current.kind;
  const nextAccountNumber =
    changes.accountNumber !== undefined
      ? changes.accountNumber.trim() || null
      : current.accountNumber ?? null;
  const nextNotes = changes.notes ?? current.notes ?? null;
  const nextActive = changes.isActive ?? current.isActive;
  if (current.isActive && !nextActive) {
    const report = await getAccountBalance(id);
    if (report && Math.abs(report.balance) > 0.009) {
      throw new Error(
        `لا يمكن تعطيل الحساب المالي «${current.name}» لأن رصيده الحالي (${report.balance}) غير صفري.`
      );
    }
  }
  await db.run(
    "UPDATE financial_accounts SET name = ?, kind = ?, account_number = ?, notes = ?, is_active = ? WHERE id = ?",
    [nextName, nextKind, nextAccountNumber, nextNotes, nextActive ? 1 : 0, id]
  );
  await appendAuditEntry({
    entityType: "financial_account",
    entityId: id,
    action: "update",
    details: {
      before: {
        name: current.name,
        kind: current.kind,
        accountNumber: current.accountNumber,
        isActive: current.isActive,
      },
      after: {
        name: nextName,
        kind: nextKind,
        accountNumber: nextAccountNumber,
        isActive: nextActive,
      },
    },
  });
  notifyDataChanged();
}

/**
 * Ensures an active account exists for a specific currency (`SDG`, `USD`, `SAR`, `EGP`).
 * Reactivates an existing account of that currency if all were deactivated, or creates the standard account.
 */
export async function ensureAccountForCurrency(
  currency: AppCurrency,
  nowIso = new Date().toISOString()
): Promise<FinancialAccount> {
  const cur = sanitizeCurrency(currency, "SDG");
  const all = await getAllAccounts(true);
  const preferredActive = getPreferredAccountForCurrency(all, cur);
  if (preferredActive) return preferredActive;

  const db = await getDb();
  const spec = STANDARD_CURRENCY_ACCOUNTS.find((s) => s.currency === cur);
  const inactiveMatch =
    (spec ? all.find((a) => a.id === spec.id) : undefined) ??
    all.find((a) => (a.currency ?? "SDG") === cur);

  if (inactiveMatch) {
    await db.run("UPDATE financial_accounts SET is_active = 1 WHERE id = ?", [inactiveMatch.id]);
    await appendAuditEntry({
      entityType: "financial_account",
      entityId: inactiveMatch.id,
      action: "reactivate",
      details: { currency: cur },
      nowIso,
    });
    notifyDataChanged();
    return (await getAccountById(inactiveMatch.id))!;
  }

  const id = spec?.id ?? `acc-bank-${cur.toLowerCase()}`;
  const name = spec?.name ?? `حساب ${cur}`;
  const kind = (spec?.kind ?? "bank") as AccountKind;
  const accountNumber = spec?.defaultAccountNumber || null;

  await db.run(
    `INSERT OR IGNORE INTO financial_accounts
       (id, name, kind, currency, account_number, opening_balance, is_active, created_at)
     VALUES (?,?,?,?,?,?,?,?)`,
    [id, name, kind, cur, accountNumber, 0, 1, nowIso]
  );
  await appendAuditEntry({
    entityType: "financial_account",
    entityId: id,
    action: "create",
    details: { name, kind, currency: cur, autoProvisioned: true },
    nowIso,
  });
  notifyDataChanged();
  return (await getAccountById(id))!;
}

/** Ensures all 4 canonical currency accounts (`SDG`, `USD`, `SAR`, `EGP`) have an active account. */
export async function ensureStandardCurrencyAccounts(
  nowIso = new Date().toISOString()
): Promise<FinancialAccount[]> {
  for (const spec of STANDARD_CURRENCY_ACCOUNTS) {
    await ensureAccountForCurrency(spec.currency as AppCurrency, nowIso);
  }
  return getAllAccounts();
}

export interface BankReconciliationOutcome {
  adjusted: boolean;
  accountId: string;
  currency: AppCurrency;
  previousBalance: number;
  newBalance: number;
  delta: number;
  sourceType: "opening_balance" | "bank_reconciliation";
  transactionId?: string | undefined;
  reference?: string | undefined;
}

/**
 * Smart Bank Reconciliation (No-Bank-API Accounting Standard):
 * User enters the real balance currently shown in their bank app (e.g. `1200` when app shows `1000`).
 * Automatically computes `delta = actualBalance - currentBalance` and posts an auditable
 * `opening_balance` (if first entry on a fresh account) or `bank_reconciliation` movement
 * without polluting sales invoice revenue (`CompanyProfitability`).
 */
export async function reconcileBankAccountBalance(
  input: {
    accountId: string;
    actualBalance: number;
    occurredAt?: string;
    notes?: string;
  },
  nowIso = new Date().toISOString()
): Promise<BankReconciliationOutcome> {
  const rawActual = Number(input.actualBalance);
  if (!Number.isFinite(rawActual)) {
    throw new Error("الرصيد الفعلي المدخل غير صالح");
  }
  const actualBalance = sanitizeMoney(rawActual);
  if (actualBalance < 0) {
    throw new Error("لا يمكن أن يكون الرصيد البنكي الفعلي بالسالب");
  }

  return withDbWriteLock(async () => {
    const db = await getDb();
    const report = await getAccountBalance(input.accountId);
    if (!report) {
      throw new Error("الحساب البنكي المحدد غير موجود");
    }
    const currency = sanitizeCurrency(report.account.currency, "SDG");
    const previousBalance = report.balance;
    const delta = round2(actualBalance - previousBalance);

    if (Math.abs(delta) < 0.005) {
      return {
        adjusted: false,
        accountId: input.accountId,
        currency,
        previousBalance,
        newBalance: previousBalance,
        delta: 0,
        sourceType: "bank_reconciliation",
      };
    }

    const txCountRes = await db.query(
      "SELECT COUNT(*) AS c FROM financial_transactions WHERE account_id = ? AND (reversed_by IS NULL OR reversed_by = '')",
      [input.accountId]
    );
    const hasPriorMovements = (Number(txCountRes.values?.[0]?.c) || 0) > 0;
    const isInitialSetup = !hasPriorMovements && Math.abs(report.account.openingBalance) < 0.005;

    const sourceType: "opening_balance" | "bank_reconciliation" = isInitialSetup
      ? "opening_balance"
      : "bank_reconciliation";
    const kind = delta > 0 ? "receipt" : "payment";
    const absAmount = round2(Math.abs(delta));
    const occurredAt = input.occurredAt || getLocalIsoDate();
    const shortSuffix = Math.random().toString(36).slice(2, 6).toUpperCase();
    const dateToken = occurredAt.replace(/[^0-9]/g, "").slice(0, 8) || "00000000";
    const reference =
      sourceType === "opening_balance"
        ? `OPN-${currency}-${dateToken}`
        : `ADJ-${currency}-${dateToken}-${shortSuffix}`;
    const txId = `tx-rec-${nowIso.replace(/[^0-9]/g, "").slice(0, 14)}-${shortSuffix.toLowerCase()}`;
    const defaultNote =
      sourceType === "opening_balance"
        ? "تأسيس الرصيد البنكي الافتتاحي الفعلي"
        : delta > 0
        ? "تسوية مطابقة بنكية موجبة (إيراد / تحويل خارجي وارد للحساب)"
        : "تسوية مطابقة بنكية سالبة (منصرف / عمولات بنكية خارجية)";
    const finalNotes = input.notes?.trim() || defaultNote;

    await db.beginTransaction();
    try {
      await db.run(
        `INSERT INTO financial_transactions
           (id, kind, amount, currency, occurred_at, account_id, source_type, source_id, reference_note, notes, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [
          txId,
          kind,
          absAmount,
          currency,
          occurredAt,
          input.accountId,
          sourceType,
          input.accountId,
          reference,
          finalNotes,
          nowIso,
        ],
        false
      );
      await db.commitTransaction();
    } catch (err) {
      try {
        await db.rollbackTransaction();
      } catch {
        // ignore
      }
      throw err;
    }

    await appendAuditEntry({
      entityType: "financial_account",
      entityId: input.accountId,
      action: sourceType,
      details: {
        currency,
        previousBalance,
        actualBalance,
        delta,
        reference,
        notes: finalNotes,
      },
      nowIso,
    });
    notifyDataChanged();

    return {
      adjusted: true,
      accountId: input.accountId,
      currency,
      previousBalance,
      newBalance: round2(previousBalance + delta),
      delta,
      sourceType,
      transactionId: txId,
      reference,
    };
  });
}

/**
 * Records a direct external bank deposit (`in`) or external bank withdrawal / bank charge (`out`)
 * that occurred outside the app's invoice cycle.
 */
export async function recordExternalBankMovement(
  input: {
    accountId: string;
    direction: "in" | "out";
    amount: number;
    occurredAt?: string;
    notes?: string;
  },
  nowIso = new Date().toISOString()
): Promise<{ transactionId: string; reference: string; newBalance: number; currency: AppCurrency }> {
  const rawAmount = Number(input.amount);
  if (!Number.isFinite(rawAmount) || rawAmount <= 0) {
    throw new Error("قيمة الحركة البنكية يجب أن تكون أكبر من صفر");
  }
  const amount = sanitizeMoney(rawAmount);

  return withDbWriteLock(async () => {
    const db = await getDb();
    const report = await getAccountBalance(input.accountId);
    if (!report) {
      throw new Error("الحساب البنكي المحدد غير موجود");
    }
    const currency = sanitizeCurrency(report.account.currency, "SDG");
    const kind = input.direction === "in" ? "receipt" : "payment";
    const sourceType = input.direction === "in" ? "external_deposit" : "external_withdrawal";
    const occurredAt = input.occurredAt || getLocalIsoDate();
    const shortSuffix = Math.random().toString(36).slice(2, 6).toUpperCase();
    const dateToken = occurredAt.replace(/[^0-9]/g, "").slice(0, 8) || "00000000";
    const prefix = input.direction === "in" ? "DEP" : "WDR";
    const reference = `${prefix}-${currency}-${dateToken}-${shortSuffix}`;
    const txId = `tx-ext-${nowIso.replace(/[^0-9]/g, "").slice(0, 14)}-${shortSuffix.toLowerCase()}`;
    const defaultNote =
      input.direction === "in"
        ? "إيداع / تحويل خارجي وارد للحساب البنكي"
        : "سحب / خصم أو عمولة بنكية خارجية";
    const finalNotes = input.notes?.trim() || defaultNote;

    await db.beginTransaction();
    try {
      await db.run(
        `INSERT INTO financial_transactions
           (id, kind, amount, currency, occurred_at, account_id, source_type, source_id, reference_note, notes, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [
          txId,
          kind,
          amount,
          currency,
          occurredAt,
          input.accountId,
          sourceType,
          input.accountId,
          reference,
          finalNotes,
          nowIso,
        ],
        false
      );
      await db.commitTransaction();
    } catch (err) {
      try {
        await db.rollbackTransaction();
      } catch {
        // ignore
      }
      throw err;
    }

    await appendAuditEntry({
      entityType: "financial_account",
      entityId: input.accountId,
      action: sourceType,
      details: { currency, direction: input.direction, amount, reference, notes: finalNotes },
      nowIso,
    });
    notifyDataChanged();

    const newBalance = round2(report.balance + (input.direction === "in" ? amount : -amount));
    return { transactionId: txId, reference, newBalance, currency };
  });
}

/** Single-account balance report via SQL SUM(CASE ...) aggregation (O(1) rows returned). */
export async function getAccountBalance(accountId: string): Promise<AccountBalanceReport | undefined> {
  const account = await getAccountById(accountId);
  if (!account) return undefined;
  const db = await getDb();
  const res = await db.query(
    `SELECT
       COALESCE(SUM(CASE WHEN t.kind IN ('receipt', 'transfer_in') THEN t.amount ELSE 0 END), 0) AS inflow,
       COALESCE(SUM(CASE WHEN t.kind IN ('payment', 'transfer_out') THEN t.amount ELSE 0 END), 0) AS outflow
     FROM financial_transactions t
     JOIN financial_accounts a ON a.id = t.account_id
     WHERE t.account_id = ?
       AND (t.reversed_by IS NULL OR t.reversed_by = '')
       AND COALESCE(t.currency, a.currency, 'SDG') = COALESCE(a.currency, 'SDG')`,
    [accountId]
  );
  const row = res.values?.[0];
  const inflow = round2(Number(row?.inflow) || 0);
  const outflow = round2(Number(row?.outflow) || 0);
  const balance = round2(account.openingBalance + inflow - outflow);
  return { account, balance, inflow, outflow };
}

/** Account balance report from real ledger movements (§10.1) using SQL aggregation. */
export async function getAccountBalances(): Promise<AccountBalanceReport[]> {
  const db = await getDb();
  const accounts = await getAllAccounts();
  if (accounts.length === 0) return [];

  const aggRes = await db.query(
    `SELECT
       t.account_id,
       COALESCE(SUM(CASE WHEN t.kind IN ('receipt', 'transfer_in') THEN t.amount ELSE 0 END), 0) AS inflow,
       COALESCE(SUM(CASE WHEN t.kind IN ('payment', 'transfer_out') THEN t.amount ELSE 0 END), 0) AS outflow
     FROM financial_transactions t
     JOIN financial_accounts a ON a.id = t.account_id
     WHERE (t.reversed_by IS NULL OR t.reversed_by = '')
       AND COALESCE(t.currency, a.currency, 'SDG') = COALESCE(a.currency, 'SDG')
     GROUP BY t.account_id`
  );

  const aggByAccount = new Map<string, { inflow: number; outflow: number }>();
  for (const row of aggRes.values ?? []) {
    if (row?.account_id) {
      aggByAccount.set(String(row.account_id), {
        inflow: Number(row.inflow) || 0,
        outflow: Number(row.outflow) || 0,
      });
    }
  }

  return accounts.map((account) => {
    const agg = aggByAccount.get(account.id);
    const inflow = round2(agg?.inflow ?? 0);
    const outflow = round2(agg?.outflow ?? 0);
    const balance = round2(account.openingBalance + inflow - outflow);
    return { account, balance, inflow, outflow };
  });
}

/** The account used when the caller does not choose one (optionally filtered by currency). */
export async function getDefaultAccountId(currency: AppCurrency = "SDG"): Promise<string | null> {
  const accounts = await getAllAccounts();
  if (accounts.length === 0) return null;
  const cur = sanitizeCurrency(currency, "SDG");
  if (cur === "SDG") {
    const cashSdg = accounts.find((a) => (a.currency ?? "SDG") === "SDG" && a.kind === "cash");
    if (cashSdg) return cashSdg.id;
  }
  const preferred = getPreferredAccountForCurrency(accounts, cur);
  return (preferred ?? accounts[0]).id;
}
