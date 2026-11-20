/**
 * ═══════════════════════════════════════════════════════════════
 * Suppliers & purchase obligations (PRD §7.1–§7.3)
 * ═══════════════════════════════════════════════════════════════
 * A supplier's balance is derived: purchase invoices (obligations) minus the
 * payments actually recorded against them. Never stored, never guessed.
 */

import { getDb } from "@/lib/database";
import { notifyDataChanged } from "@/lib/backup/notify";
import { appendAuditEntry } from "@/lib/repositories/AuditLogRepository";
import { buildSettlement, type SettlementSummary } from "@/lib/domain/finance";
import { sanitizeCurrency, type AppCurrency } from "@/lib/currency/types";

export interface Supplier {
  id: string;
  name: string;
  phone?: string | undefined;
  email?: string | undefined;
  address?: string | undefined;
  notes?: string | undefined;
  createdAt: string;
  cancelledAt?: string | undefined;
}

function rowToSupplier(row: any): Supplier {
  return {
    id: String(row.id),
    name: String(row.name ?? ""),
    phone: row.phone ?? undefined,
    email: row.email ?? undefined,
    address: row.address ?? undefined,
    notes: row.notes ?? undefined,
    createdAt: String(row.created_at),
    cancelledAt: row.cancelled_at ?? undefined,
  };
}

export async function getAllSuppliers(): Promise<Supplier[]> {
  const db = await getDb();
  const res = await db.query("SELECT * FROM suppliers WHERE cancelled_at IS NULL ORDER BY name ASC");
  return (res.values ?? []).map(rowToSupplier);
}

export async function getSupplierById(id: string): Promise<Supplier | undefined> {
  const db = await getDb();
  const res = await db.query("SELECT * FROM suppliers WHERE id = ? LIMIT 1", [id]);
  const row = res.values?.[0];
  return row ? rowToSupplier(row) : undefined;
}

export async function createSupplier(input: {
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  notes?: string;
  nowIso?: string;
}): Promise<Supplier> {
  const db = await getDb();
  const nowIso = input.nowIso ?? new Date().toISOString();
  const id = `sup-${nowIso.replace(/[^0-9]/g, "").slice(0, 14)}-${Math.random().toString(36).slice(2, 6)}`;
  await db.run(
    "INSERT INTO suppliers(id, name, phone, email, address, notes, created_at) VALUES(?,?,?,?,?,?,?)",
    [id, input.name.trim(), input.phone ?? null, input.email ?? null, input.address ?? null, input.notes ?? null, nowIso]
  );
  await appendAuditEntry({ entityType: "supplier", entityId: id, action: "create", details: { name: input.name }, nowIso });
  notifyDataChanged();
  return {
    id,
    name: input.name.trim(),
    phone: input.phone,
    email: input.email,
    address: input.address,
    notes: input.notes,
    createdAt: nowIso,
  };
}

export async function updateSupplier(
  id: string,
  changes: Partial<Omit<Supplier, "id" | "createdAt">>,
  nowIso = new Date().toISOString()
): Promise<void> {
  const db = await getDb();
  const current = await getSupplierById(id);
  if (!current) throw new Error("المورد غير موجود");
  await db.run("UPDATE suppliers SET name = ?, phone = ?, email = ?, address = ?, notes = ? WHERE id = ?", [
    changes.name?.trim() || current.name,
    changes.phone ?? current.phone ?? null,
    changes.email ?? current.email ?? null,
    changes.address ?? current.address ?? null,
    changes.notes ?? current.notes ?? null,
    id,
  ]);
  await appendAuditEntry({ entityType: "supplier", entityId: id, action: "update", nowIso });
  notifyDataChanged();
}

export async function cancelSupplier(id: string, reason: string | null, nowIso = new Date().toISOString()): Promise<void> {
  const account = await getSupplierAccount(id);
  if (account.outstanding > 0.009) {
    throw new Error(
      `لا يمكن إلغاء المورد «${account.supplier.name}» لوجود التزامات غير مسدّدة بقيمة (${account.outstanding}).`
    );
  }
  const db = await getDb();
  await db.run("UPDATE suppliers SET cancelled_at = ? WHERE id = ? AND cancelled_at IS NULL", [nowIso, id]);
  await appendAuditEntry({ entityType: "supplier", entityId: id, action: "cancel", reason, nowIso });
  notifyDataChanged();
}

export interface SupplierObligationRow {
  invoiceId: string;
  reference: string;
  supplierInvoiceNumber?: string | undefined;
  date: string;
  currency?: string | undefined;
  settlement: SettlementSummary;
}

export interface SupplierAccount {
  supplier: Supplier;
  totalObligations: number;
  totalPaid: number;
  outstanding: number;
  invoices: SupplierObligationRow[];
}

/** Purchase invoices of one supplier with payments applied (single grouped query, includes unallocated advances). */
export async function getSupplierAccount(
  supplierId: string,
  currency?: AppCurrency
): Promise<SupplierAccount> {
  const db = await getDb();
  const cur = currency ? sanitizeCurrency(currency) : undefined;
  const [supplier, invoicesRes, totalPaymentsRes] = await Promise.all([
    getSupplierById(supplierId),
    db.query(
      `SELECT i.id, i.reference, i.supplier_invoice_number, i.date, i.total_amount,
              COALESCE(i.currency, 'SDG') AS currency,
              COALESCE(a.paid, 0) AS allocated_paid
         FROM custom_invoices i
         LEFT JOIN (
           SELECT al.invoice_id, SUM(al.amount) AS paid
             FROM supplier_payment_allocations al
             JOIN supplier_payments p ON p.id = al.payment_id
            WHERE p.cancelled_at IS NULL ${cur ? "AND COALESCE(p.currency, 'SDG') = ?" : ""}
            GROUP BY al.invoice_id
         ) a ON a.invoice_id = i.id
        WHERE i.supplier_id = ? AND i.type = 'purchase' AND i.cancelled_at IS NULL
          ${cur ? "AND COALESCE(i.currency, 'SDG') = ?" : ""}
        ORDER BY i.date DESC, i.created_at DESC`,
      cur ? [cur, supplierId, cur] : [supplierId]
    ),
    db.query(
      `SELECT COALESCE(SUM(amount), 0) AS paid
         FROM supplier_payments
        WHERE supplier_id = ? AND cancelled_at IS NULL ${cur ? "AND COALESCE(currency, 'SDG') = ?" : ""}`,
      cur ? [supplierId, cur] : [supplierId]
    ),
  ]);

  const invoices: SupplierObligationRow[] = [];
  let totalObligations = 0;
  let allocatedTotal = 0;

  for (const row of invoicesRes.values ?? []) {
    const paid = Number(row.allocated_paid) || 0;
    const settlement = buildSettlement(Number(row.total_amount) || 0, paid);
    totalObligations += settlement.total;
    allocatedTotal += settlement.paid;
    invoices.push({
      invoiceId: String(row.id),
      reference: String(row.reference ?? ""),
      supplierInvoiceNumber: row.supplier_invoice_number ?? undefined,
      date: String(row.date ?? ""),
      currency: String(row.currency ?? "SDG"),
      settlement,
    });
  }

  const totalPayments = Number(totalPaymentsRes.values?.[0]?.paid) || 0;
  const totalPaid = Math.max(allocatedTotal, totalPayments);

  return {
    supplier: supplier ?? {
      id: supplierId,
      name: "مورد غير معروف",
      createdAt: new Date().toISOString(),
    },
    totalObligations: Math.round(totalObligations * 100) / 100,
    totalPaid: Math.round(totalPaid * 100) / 100,
    outstanding: Math.round(Math.max(0, totalObligations - totalPaid) * 100) / 100,
    invoices,
  };
}

/** Single grouped SQL query replacing the previous N+1 loop across suppliers. */
export async function getSupplierOutstandingMap(currency?: AppCurrency): Promise<Record<string, number>> {
  const db = await getDb();
  const cur = currency ? sanitizeCurrency(currency) : undefined;
  const [supRes, invRes, payRes] = await Promise.all([
    db.query("SELECT id FROM suppliers WHERE cancelled_at IS NULL"),
    db.query(
      `SELECT supplier_id, COALESCE(SUM(total_amount), 0) AS total
         FROM custom_invoices
        WHERE type = 'purchase' AND cancelled_at IS NULL AND supplier_id IS NOT NULL
          ${cur ? "AND COALESCE(currency, 'SDG') = ?" : ""}
        GROUP BY supplier_id`,
      cur ? [cur] : []
    ),
    db.query(
      `SELECT supplier_id, COALESCE(SUM(amount), 0) AS paid
         FROM supplier_payments
        WHERE cancelled_at IS NULL
          ${cur ? "AND COALESCE(currency, 'SDG') = ?" : ""}
        GROUP BY supplier_id`,
      cur ? [cur] : []
    ),
  ]);

  const invMap = new Map<string, number>();
  for (const r of invRes.values ?? []) invMap.set(String(r.supplier_id), Number(r.total) || 0);
  const payMap = new Map<string, number>();
  for (const r of payRes.values ?? []) payMap.set(String(r.supplier_id), Number(r.paid) || 0);

  const result: Record<string, number> = {};
  for (const s of supRes.values ?? []) {
    const sid = String(s.id);
    const total = invMap.get(sid) ?? 0;
    const paid = payMap.get(sid) ?? 0;
    result[sid] = Math.round(Math.max(0, total - paid) * 100) / 100;
  }
  return result;
}
