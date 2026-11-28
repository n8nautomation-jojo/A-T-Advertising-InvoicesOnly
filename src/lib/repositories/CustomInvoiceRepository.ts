/**
 * ═══════════════════════════════════════════════════════════════
 * Custom Invoice Repository — SQLite CRUD
 * ═══════════════════════════════════════════════════════════════
 * Handles all persistence for sales / purchase / billing invoices.
 * Uses parameterized queries for SQL injection safety.
 *
 * Reference handling (PRD §5.3):
 *  - the official reference is allocated on the FIRST successful save only;
 *  - later saves never touch `reference` (immutability, §5.3.3);
 *  - reads exclude softly cancelled rows, but the rows and their references
 *    stay in the database and in backups (§12.7, §12.13).
 */

import type { capSQLiteSet } from "@capacitor-community/sqlite";
import { getDb } from "@/lib/database";
import { withDbWriteLock } from "@/lib/database/writeLock";
import { notifyDataChanged } from "@/lib/backup/notify";
import { appendAuditEntry } from "@/lib/repositories/AuditLogRepository";
import { allocateInvoiceReference } from "@/lib/repositories/DocumentSequenceRepository";
import { scopeForInvoiceType } from "@/lib/domain/references";
import { getLocalIsoDate } from "@/lib/dateUtils";
import { sanitizeCurrency } from "@/lib/currency/types";
import type { CustomInvoice, CustomInvoiceItem, CustomInvoiceType } from "@/lib/billing/types";

// ── Helpers ────────────────────────────────────────────────────────────────

function rowToInvoice(row: any, items: any[]): CustomInvoice {
  return {
    id: row.id,
    meta: {
      serial: row.serial,
      type: row.type as CustomInvoiceType,
      date: row.date,
      partyName: row.party_name,
      partyEnName: row.party_en_name || undefined,
      attn: row.attn || undefined,
      phone: row.phone || undefined,
      salutation: row.salutation || undefined,
      closingNote: row.closing_note || undefined,
      accountNumber: row.account_number || undefined,
      accountName: row.account_name || undefined,
      signatoryTitle: row.signatory_title || undefined,
      notes: row.notes || undefined,
      language: (row.language as "ar" | "en" | "auto") || "ar",
      currency: (row.currency as any) || "SDG",
      dueDate: row.due_date || undefined,
      discount: row.discount ?? undefined,
    },
    items: items.map(rowToItem),
    totalAmount: row.total_amount,
    subtotal: row.subtotal ?? undefined,
    totalInWords: row.total_in_words || undefined,
    currency: (row.currency as any) || "SDG",
    reference: row.reference || undefined,
    referenceAssignedAt: row.reference_assigned_at || undefined,
    customerId: row.customer_id || undefined,
    supplierId: row.supplier_id || undefined,
    supplierInvoiceNumber: row.supplier_invoice_number || undefined,
    cancelledAt: row.cancelled_at || undefined,
    cancellationReason: row.cancellation_reason || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToItem(row: any): CustomInvoiceItem {
  return {
    id: row.id,
    description: row.description,
    material: row.material ?? undefined,
    dimensions: row.dimensions ?? undefined,
    qty: row.qty,
    unitPrice: row.unit_price ?? undefined,
    total: row.total,
  };
}

// ── Read ───────────────────────────────────────────────────────────────────

/** Active (non-cancelled) invoices, newest first. */
export async function getAllCustomInvoices(): Promise<CustomInvoice[]> {
  const db = await getDb();
  const res = await db.query(
    "SELECT * FROM custom_invoices WHERE cancelled_at IS NULL ORDER BY date DESC, created_at DESC"
  );
  const rows = res.values || [];
  if (rows.length === 0) return [];

  // Batch-fetch all items for active invoices in a single query instead of N+1 round trips
  const itemsRes = await db.query(
    `SELECT i.* FROM custom_invoice_items i
       JOIN custom_invoices c ON c.id = i.invoice_id
      WHERE c.cancelled_at IS NULL
      ORDER BY i.invoice_id, i.sort_order ASC`
  );

  const itemsByInvoice = new Map<string, any[]>();
  for (const item of itemsRes.values || []) {
    const invId = String(item.invoice_id);
    let list = itemsByInvoice.get(invId);
    if (!list) {
      list = [];
      itemsByInvoice.set(invId, list);
    }
    list.push(item);
  }

  return rows.map((row) => rowToInvoice(row, itemsByInvoice.get(String(row.id)) || []));
}

export type CustomInvoiceSortMode = "date-desc" | "date-asc" | "amount-desc" | "amount-asc";

export interface CustomInvoicePageQuery {
  page?: number;
  pageSize?: number;
  type?: CustomInvoiceType | "all";
  currency?: string;
  customerId?: string;
  search?: string;
  sort?: CustomInvoiceSortMode;
}

export interface CustomInvoiceSummaryRow {
  id: string;
  serial: string;
  reference?: string | undefined;
  type: CustomInvoiceType;
  date: string;
  dueDate?: string | undefined;
  partyName: string;
  partyEnName?: string | undefined;
  customerId?: string | undefined;
  supplierId?: string | undefined;
  currency: string;
  totalAmount: number;
  itemsCount: number;
  createdAt: string;
}

export interface CustomInvoicePageResult {
  items: CustomInvoiceSummaryRow[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/**
 * High-scale indexed SQLite pagination query built for 100,000+ invoices.
 * Fetches only the requested page slice without loading all line items into memory.
 */
export async function queryCustomInvoicesPage(
  query: CustomInvoicePageQuery = {}
): Promise<CustomInvoicePageResult> {
  const db = await getDb();
  const pageSize = Math.min(200, Math.max(1, Math.floor(Number(query.pageSize) || 25)));
  const requestedPage = Math.max(1, Math.floor(Number(query.page) || 1));

  const conditions: string[] = ["c.cancelled_at IS NULL"];
  const params: any[] = [];

  if (query.type && query.type !== "all") {
    conditions.push("c.type = ?");
    params.push(query.type);
  }
  if (query.currency && query.currency !== "ALL") {
    conditions.push("COALESCE(c.currency, 'SDG') = ?");
    params.push(sanitizeCurrency(query.currency, "SDG"));
  }
  if (query.customerId) {
    conditions.push("c.customer_id = ?");
    params.push(query.customerId);
  }
  const q = (query.search || "").trim();
  if (q.length > 0) {
    const like = `%${q}%`;
    conditions.push(
      "(c.reference LIKE ? OR c.serial LIKE ? OR c.party_name LIKE ? OR COALESCE(c.party_en_name, '') LIKE ? OR c.date LIKE ?)"
    );
    params.push(like, like, like, like, like);
  }

  const whereSql = conditions.join(" AND ");
  const countRes = await db.query(
    `SELECT COUNT(*) AS cnt FROM custom_invoices c WHERE ${whereSql}`,
    params
  );
  const totalCount = Number(countRes.values?.[0]?.cnt) || 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const offset = (page - 1) * pageSize;

  let orderSql = "c.date DESC, c.created_at DESC, c.id DESC";
  switch (query.sort) {
    case "date-asc":
      orderSql = "c.date ASC, c.created_at ASC, c.id ASC";
      break;
    case "amount-desc":
      orderSql = "c.total_amount DESC, c.date DESC, c.id DESC";
      break;
    case "amount-asc":
      orderSql = "c.total_amount ASC, c.date DESC, c.id DESC";
      break;
    default:
      break;
  }

  const pageRes = await db.query(
    `SELECT c.id, c.serial, c.reference, c.type, c.date, c.due_date,
            c.party_name, c.party_en_name, c.customer_id, c.supplier_id,
            COALESCE(c.currency, 'SDG') AS resolved_currency,
            c.total_amount, c.created_at,
            (SELECT COUNT(*) FROM custom_invoice_items i WHERE i.invoice_id = c.id) AS items_count
       FROM custom_invoices c
      WHERE ${whereSql}
      ORDER BY ${orderSql}
      LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  );

  const items: CustomInvoiceSummaryRow[] = (pageRes.values || []).map((row: any) => ({
    id: String(row.id),
    serial: String(row.serial ?? ""),
    reference: row.reference ? String(row.reference) : undefined,
    type: (row.type as CustomInvoiceType) || "sales",
    date: String(row.date ?? ""),
    dueDate: row.due_date ? String(row.due_date) : undefined,
    partyName: String(row.party_name ?? ""),
    partyEnName: row.party_en_name ? String(row.party_en_name) : undefined,
    customerId: row.customer_id ? String(row.customer_id) : undefined,
    supplierId: row.supplier_id ? String(row.supplier_id) : undefined,
    currency: sanitizeCurrency(row.resolved_currency, "SDG"),
    totalAmount: Number(row.total_amount) || 0,
    itemsCount: Number(row.items_count) || 0,
    createdAt: String(row.created_at ?? ""),
  }));

  return {
    items,
    totalCount,
    page,
    pageSize,
    totalPages,
  };
}

export async function getCustomInvoiceById(id: string): Promise<CustomInvoice | undefined> {
  const db = await getDb();
  const res = await db.query("SELECT * FROM custom_invoices WHERE id = ?", [id]);
  if (!res.values || res.values.length === 0) return undefined;
  const row = res.values[0];
  const itemsRes = await db.query(
    "SELECT * FROM custom_invoice_items WHERE invoice_id = ? ORDER BY sort_order ASC",
    [id]
  );
  return rowToInvoice(row, itemsRes.values || []);
}

/** Exact reference lookup used by search (PRD §5.3.6). */
export async function findCustomInvoiceByReference(reference: string): Promise<CustomInvoice | undefined> {
  const db = await getDb();
  const res = await db.query(
    "SELECT * FROM custom_invoices WHERE reference = ? AND cancelled_at IS NULL LIMIT 1",
    [reference.trim()]
  );
  const row = res.values?.[0];
  if (!row) return undefined;
  const itemsRes = await db.query(
    "SELECT * FROM custom_invoice_items WHERE invoice_id = ? ORDER BY sort_order ASC",
    [row.id]
  );
  return rowToInvoice(row, itemsRes.values || []);
}

/** True when the reference already exists (any state, including cancelled). */
export async function referenceExists(reference: string): Promise<boolean> {
  const db = await getDb();
  const res = await db.query("SELECT id FROM custom_invoices WHERE reference = ? LIMIT 1", [reference.trim()]);
  return Boolean(res.values?.length);
}

// ── Write ──────────────────────────────────────────────────────────────────

export interface UpsertResult {
  reference: string | null;
  referenceAssigned: boolean;
}

/**
 * Inserts or updates an invoice.
 *
 * The reference is allocated here — never in the UI — so it is produced by the
 * atomic allocator and persisted with the record (§5.3.1). An existing reference
 * is preserved verbatim on update (§5.3.3, §12.14).
 */
async function getActiveInvoiceAllocatedSum(
  db: Awaited<ReturnType<typeof getDb>>,
  invoiceId: string,
  invoiceType: string
): Promise<number> {
  if (invoiceType === "purchase") {
    const res = await db.query(
      `SELECT COALESCE(SUM(a.amount), 0) AS paid
         FROM supplier_payment_allocations a
         JOIN supplier_payments p ON p.id = a.payment_id
        WHERE a.invoice_id = ? AND p.cancelled_at IS NULL`,
      [invoiceId]
    );
    return Number(res.values?.[0]?.paid) || 0;
  }
  const res = await db.query(
    `SELECT COALESCE(SUM(a.amount), 0) AS paid
       FROM customer_payment_allocations a
       JOIN customer_payments p ON p.id = a.payment_id
      WHERE a.invoice_id = ? AND p.cancelled_at IS NULL`,
    [invoiceId]
  );
  return Number(res.values?.[0]?.paid) || 0;
}

export async function upsertCustomInvoice(invoice: CustomInvoice): Promise<UpsertResult> {
  return withDbWriteLock(async () => {
    const db = await getDb();
    const now = new Date().toISOString();
    const incomingCurrency = sanitizeCurrency(invoice.currency || invoice.meta.currency, "SDG");

    const existingRes = await db.query(
      "SELECT id, type, currency, total_amount, customer_id, supplier_id, reference, reference_assigned_at FROM custom_invoices WHERE id = ? LIMIT 1",
      [invoice.id]
    );
    const existing = existingRes.values?.[0];
    const isNewRow = !existing;

    if (existing) {
      const existingType = String(existing.type ?? "sales");
      const allocated = await getActiveInvoiceAllocatedSum(db, invoice.id, existingType);
      if (allocated > 0.001) {
        if (invoice.meta.type !== existingType) {
          throw new Error("لا يمكن تغيير نوع فاتورة مرتبطة بمدفوعات أو تحصيلات نشطة. ألغِ المدفوعات المرتبطة أولاً.");
        }
        const existingCurrency = sanitizeCurrency(existing.currency, "SDG");
        if (incomingCurrency !== existingCurrency) {
          throw new Error("لا يمكن تغيير عملة فاتورة مرتبطة بمدفوعات أو تحصيلات نشطة.");
        }
        if (existingType === "sales" && existing.customer_id && invoice.customerId !== existing.customer_id) {
          throw new Error("لا يمكن تغيير العميل في فاتورة مبيعات مسدّدة جزئياً أو كلياً.");
        }
        if (existingType === "purchase" && existing.supplier_id && invoice.supplierId !== existing.supplier_id) {
          throw new Error("لا يمكن تغيير المورد في فاتورة مشتريات مسدّدة جزئياً أو كلياً.");
        }
        if ((Number(invoice.totalAmount) || 0) < allocated - 0.001) {
          throw new Error(
            `لا يمكن تخفيض إجمالي الفاتورة (${invoice.totalAmount}) لأقل من المبلغ المسدّد فعلياً (${allocated}).`
          );
        }
      }
    }

    let reference: string | null = existing?.reference ?? invoice.reference ?? null;
    let referenceAssigned = false;
    let referenceAssignedAt: string | null = null;

    if (!reference) {
      const scope = scopeForInvoiceType(invoice.meta.type);
      if (scope) {
        const allocated = await allocateInvoiceReference(
          scope === "purchase" ? "purchase" : "sales",
          invoice.meta.date || getLocalIsoDate(),
          now
        );
        reference = allocated.reference;
        referenceAssigned = true;
        referenceAssignedAt = now;
      }
    }

    const incomingItemIds = invoice.items.map((item) => String(item.id || "")).filter(Boolean);
    const conflictingItemIds = new Set<string>();
    if (incomingItemIds.length > 0) {
      try {
        const CHUNK_SIZE = 500;
        for (let offset = 0; offset < incomingItemIds.length; offset += CHUNK_SIZE) {
          const chunk = incomingItemIds.slice(offset, offset + CHUNK_SIZE);
          const placeholders = chunk.map(() => "?").join(",");
          const clash = await db.query(
            `SELECT id FROM custom_invoice_items WHERE id IN (${placeholders}) AND invoice_id <> ?`,
            [...chunk, invoice.id]
          );
          for (const row of clash.values ?? []) {
            conflictingItemIds.add(String(row.id));
          }
        }
      } catch (err) {
        console.warn("[CustomInvoiceRepository] item id check failed:", err);
      }
    }
    const items = invoice.items.map((item, index) => {
      if (!conflictingItemIds.has(String(item.id))) return item;
      const unique = `${invoice.id}-item-${index}-${Math.random().toString(36).slice(2, 7)}`;
      return { ...item, id: unique };
    });

    const statements: capSQLiteSet[] = [
      {
        statement: `INSERT INTO custom_invoices
          (id, serial, type, date, party_name, party_en_name, attn, phone,
           salutation, closing_note, account_number, account_name,
           signatory_title, notes, language, currency, total_amount, total_in_words,
           created_at, updated_at,
           reference, reference_assigned_at, customer_id,
           due_date, discount, subtotal, supplier_id, supplier_invoice_number)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET
           serial          = excluded.serial,
           type            = excluded.type,
           date            = excluded.date,
           party_name      = excluded.party_name,
           party_en_name   = excluded.party_en_name,
           attn            = excluded.attn,
           phone           = excluded.phone,
           salutation      = excluded.salutation,
           closing_note    = excluded.closing_note,
           account_number  = excluded.account_number,
           account_name    = excluded.account_name,
           signatory_title = excluded.signatory_title,
           notes           = excluded.notes,
           language        = excluded.language,
           currency        = excluded.currency,
           total_amount    = excluded.total_amount,
           total_in_words  = excluded.total_in_words,
           reference       = COALESCE(custom_invoices.reference, excluded.reference),
           reference_assigned_at = COALESCE(custom_invoices.reference_assigned_at, excluded.reference_assigned_at),
           customer_id     = excluded.customer_id,
           due_date        = excluded.due_date,
           discount        = excluded.discount,
           subtotal        = excluded.subtotal,
           supplier_id     = excluded.supplier_id,
           supplier_invoice_number = excluded.supplier_invoice_number,
           updated_at      = excluded.updated_at`,
        values: [
          invoice.id,
          invoice.meta.serial,
          invoice.meta.type,
          invoice.meta.date,
          invoice.meta.partyName,
          invoice.meta.partyEnName ?? null,
          invoice.meta.attn ?? null,
          invoice.meta.phone ?? null,
          invoice.meta.salutation ?? null,
          invoice.meta.closingNote ?? null,
          invoice.meta.accountNumber ?? null,
          invoice.meta.accountName ?? null,
          invoice.meta.signatoryTitle ?? null,
          invoice.meta.notes ?? null,
          invoice.meta.language ?? "ar",
          incomingCurrency,
          invoice.totalAmount,
          invoice.totalInWords ?? null,
          invoice.createdAt || now,
          now,
          reference,
          referenceAssignedAt ?? existing?.reference_assigned_at ?? (reference ? now : null),
          invoice.customerId ?? null,
          invoice.meta.dueDate ?? null,
          invoice.meta.discount ?? 0,
          invoice.subtotal ?? invoice.totalAmount ?? 0,
          invoice.supplierId ?? null,
          invoice.supplierInvoiceNumber ?? null,
        ],
      },
      {
        statement: "DELETE FROM custom_invoice_items WHERE invoice_id = ?",
        values: [invoice.id],
      },
      ...items.map((item, i) => ({
        statement: `INSERT INTO custom_invoice_items
          (id, invoice_id, description, material, dimensions, qty, unit_price, total, sort_order)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        values: [
          item.id,
          invoice.id,
          item.description,
          item.material ?? null,
          item.dimensions ?? null,
          item.qty,
          item.unitPrice ?? null,
          item.total,
          i,
        ],
      })),
    ];

    await db.executeSet(statements, true);

    await appendAuditEntry({
      entityType: "custom_invoice",
      entityId: invoice.id,
      action: isNewRow ? "create" : "update",
      details: {
        reference,
        type: invoice.meta.type,
        currency: incomingCurrency,
        total: invoice.totalAmount,
        ...(existing ? { previousTotal: Number(existing.total_amount) || 0 } : {}),
      },
      nowIso: now,
    });

    notifyDataChanged();
    return { reference, referenceAssigned };
  });
}

/** Items actually stored for an invoice (ids may have been re-namespaced). */
export async function getCustomInvoiceItemIds(invoiceId: string): Promise<string[]> {
  const db = await getDb();
  const res = await db.query("SELECT id FROM custom_invoice_items WHERE invoice_id = ? ORDER BY sort_order ASC", [invoiceId]);
  return (res.values ?? []).map((row: any) => String(row.id));
}

/**
 * Soft cancellation: the record and its reference are preserved forever
 * (PRD §5.3.3, §5.3.7, §12.7, §12.13). The row disappears from lists because
 * reads filter on cancelled_at, but nothing is destroyed.
 */
export async function cancelCustomInvoice(id: string, reason: string | null): Promise<void> {
  await withDbWriteLock(async () => {
    const db = await getDb();
    const rowRes = await db.query("SELECT type FROM custom_invoices WHERE id = ? AND cancelled_at IS NULL LIMIT 1", [id]);
    const row = rowRes.values?.[0];
    if (row) {
      const allocated = await getActiveInvoiceAllocatedSum(db, id, String(row.type ?? "sales"));
      if (allocated > 0.001) {
        throw new Error(
          `لا يمكن إلغاء هذه الفاتورة لأنها مرتبطة بسدادات نشطة بقيمة (${allocated}). يرجى إلغاء السندات المرتبطة بها أولاً.`
        );
      }
    }

    const now = new Date().toISOString();
    await db.run(
      "UPDATE custom_invoices SET cancelled_at = ?, cancellation_reason = ?, updated_at = ? WHERE id = ? AND cancelled_at IS NULL",
      [now, reason, now, id]
    );
    await appendAuditEntry({
      entityType: "custom_invoice",
      entityId: id,
      action: "cancel",
      reason,
      nowIso: now,
    });
    notifyDataChanged();
  });
}

/** Restores a cancelled invoice (audit action: restore). */
export async function restoreCancelledCustomInvoice(id: string, reason: string | null): Promise<void> {
  const db = await getDb();
  const now = new Date().toISOString();
  await db.run(
    "UPDATE custom_invoices SET cancelled_at = NULL, cancellation_reason = NULL, updated_at = ? WHERE id = ?",
    [now, id]
  );
  await appendAuditEntry({
    entityType: "custom_invoice",
    entityId: id,
    action: "restore",
    reason,
    nowIso: now,
  });
  notifyDataChanged();
}

/**
 * Cancellation replaces deletion in the UI.
 * Kept under the old name so existing callers keep working, but it no longer
 * destroys financial history.
 */
export async function deleteCustomInvoice(id: string): Promise<void> {
  await cancelCustomInvoice(id, "حذف من الواجهة — السجل محفوظ");
}
