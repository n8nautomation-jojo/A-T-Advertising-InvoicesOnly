/**
 * ═══════════════════════════════════════════════════════════════
 * Financial accounts (PRD §10)
 * ═══════════════════════════════════════════════════════════════
 * Balances are always DERIVED from ledger movements; nothing is cached here
 * (§10.2). Opening balance is the only stored figure, and it is explicit.
 */

import { getDb } from "@/lib/database";
import { notifyDataChanged } from "@/lib/backup/notify";
import { appendAuditEntry } from "@/lib/repositories/AuditLogRepository";
import { sanitizeCurrency, type AppCurrency } from "@/lib/currency/types";
import type { AccountBalanceReport, AccountKind, FinancialAccount } from "@/lib/domain/finance";

function round2(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function rowToAccount(row: any): FinancialAccount {
  return {
    id: String(row.id),
    name: String(row.name ?? ""),
    kind: (row.kind as AccountKind) ?? "cash",
    currency: sanitizeCurrency(row.currency, "SDG"),
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
  openingBalance?: number;
  notes?: string;
  nowIso?: string;
}): Promise<FinancialAccount> {
  const db = await getDb();
  const nowIso = input.nowIso ?? new Date().toISOString();
  const id = `acc-${nowIso.replace(/[^0-9]/g, "").slice(0, 14)}-${Math.random().toString(36).slice(2, 6)}`;
  const trimmedName = input.name.trim();
  const rawOpening = Number(input.openingBalance ?? 0);
  if (!Number.isFinite(rawOpening)) {
    throw new Error("الرصيد الافتتاحي غير صالح");
  }
  const openingBalance = round2(rawOpening);
  const currency = sanitizeCurrency(input.currency, "SDG");
  await db.run(
    "INSERT INTO financial_accounts(id, name, kind, currency, opening_balance, is_active, notes, created_at) VALUES(?,?,?,?,?,?,?,?)",
    [id, trimmedName, input.kind, currency, openingBalance, 1, input.notes ?? null, nowIso]
  );
  await appendAuditEntry({
    entityType: "financial_account",
    entityId: id,
    action: "create",
    details: { name: trimmedName, kind: input.kind, currency, openingBalance },
    nowIso,
  });
  notifyDataChanged();
  return {
    id,
    name: trimmedName,
    kind: input.kind,
    currency,
    openingBalance,
    isActive: true,
    notes: input.notes,
    createdAt: nowIso,
  };
}

export async function updateAccount(
  id: string,
  changes: { name?: string; kind?: AccountKind; notes?: string; isActive?: boolean }
): Promise<void> {
  const db = await getDb();
  const current = await getAccountById(id);
  if (!current) throw new Error("الحساب المالي غير موجود");
  const nextName = changes.name?.trim() || current.name;
  const nextKind = changes.kind ?? current.kind;
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
    "UPDATE financial_accounts SET name = ?, kind = ?, notes = ?, is_active = ? WHERE id = ?",
    [nextName, nextKind, nextNotes, nextActive ? 1 : 0, id]
  );
  await appendAuditEntry({
    entityType: "financial_account",
    entityId: id,
    action: "update",
    details: {
      before: { name: current.name, kind: current.kind, isActive: current.isActive },
      after: { name: nextName, kind: nextKind, isActive: nextActive },
    },
  });
  notifyDataChanged();
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

/** The account used when the caller does not choose one. */
export async function getDefaultAccountId(): Promise<string | null> {
  const accounts = await getAllAccounts();
  if (accounts.length === 0) return null;
  const cash = accounts.find((account) => account.kind === "cash");
  return (cash ?? accounts[0]).id;
}
