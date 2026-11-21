/**
 * ═══════════════════════════════════════════════════════════════
 * Orders Repository — SQLite CRUD
 * ═══════════════════════════════════════════════════════════════
 */

import type { capSQLiteSet } from "@capacitor-community/sqlite";
import { getDb } from "@/lib/database";
import { notifyDataChanged } from "@/lib/backup/notify";
import type { PrintOrder, OrderStatus, OrderPriority, OrderItemRecord } from "@/lib/ordersStore";
import { sanitizeCurrency } from "@/lib/currency/types";

function rowToOrder(row: any, items: any[]): PrintOrder {
  return {
    id: row.id,
    orderNumber: row.order_number,
    customerName: row.customer_name,
    customerPhone: row.customer_phone || "",
    clientType: row.client_type || "takeaway",
    status: (row.status as OrderStatus) || "new",
    priority: (row.priority as OrderPriority) || "normal",
    createdAt: row.created_at,
    deliveryDate: row.delivery_date || undefined,
    items: items.map(rowToOrderItem),
    totalArea: row.total_area || 0,
    totalCost: row.total_cost || 0,
    paidAmount: row.paid_amount || 0,
    currency: sanitizeCurrency(row.currency, "SDG"),
    branch: row.branch || "",
    notes: row.notes || undefined,
    invoiceSerial: row.invoice_serial || undefined,
  };
}

function rowToOrderItem(row: any): OrderItemRecord {
  return {
    id: row.id,
    description: row.description,
    material: row.material || "flex",
    width: row.width || 0,
    height: row.height || 0,
    qty: row.qty || 1,
    rollUsed: row.roll_used || "",
    area: row.area || 0,
    unitPrice: row.unit_price || 0,
    total: row.total || 0,
  };
}

export async function getAllOrders(): Promise<PrintOrder[]> {
  const db = await getDb();
  const res = await db.query("SELECT * FROM orders ORDER BY created_at DESC");
  const rows = res.values || [];
  if (rows.length === 0) return [];

  // Batch-fetch all items in a single query instead of N+1 round trips
  const itemsRes = await db.query(
    `SELECT i.* FROM order_items i
       JOIN orders o ON o.id = i.order_id
      ORDER BY i.order_id, i.sort_order ASC`
  );

  const itemsByOrder = new Map<string, any[]>();
  for (const item of itemsRes.values || []) {
    const oId = String(item.order_id);
    let list = itemsByOrder.get(oId);
    if (!list) {
      list = [];
      itemsByOrder.set(oId, list);
    }
    list.push(item);
  }

  return rows.map((row) => rowToOrder(row, itemsByOrder.get(String(row.id)) || []));
}

export async function upsertOrder(order: PrintOrder): Promise<void> {
  const db = await getDb();
  const statements: capSQLiteSet[] = [
    {
      statement: `INSERT INTO orders
        (id, order_number, customer_name, customer_phone, client_type,
         status, priority, created_at, delivery_date,
         total_area, total_cost, paid_amount, currency, branch, notes, invoice_serial)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
         order_number   = excluded.order_number,
         customer_name  = excluded.customer_name,
         customer_phone = excluded.customer_phone,
         client_type    = excluded.client_type,
         status         = excluded.status,
         priority       = excluded.priority,
         delivery_date  = excluded.delivery_date,
         total_area     = excluded.total_area,
         total_cost     = excluded.total_cost,
         paid_amount    = excluded.paid_amount,
         currency       = excluded.currency,
         branch         = excluded.branch,
         notes          = excluded.notes,
         invoice_serial = excluded.invoice_serial`,
      values: [
        order.id,
        order.orderNumber,
        order.customerName,
        order.customerPhone || null,
        order.clientType,
        order.status,
        order.priority,
        order.createdAt,
        order.deliveryDate || null,
        order.totalArea,
        order.totalCost,
        order.paidAmount,
        sanitizeCurrency(order.currency, "SDG"),
        order.branch || null,
        order.notes || null,
        order.invoiceSerial || null,
      ],
    },
    {
      statement: "DELETE FROM order_items WHERE order_id = ?",
      values: [order.id],
    },
    ...order.items.map((item, i) => ({
      statement: `INSERT INTO order_items
        (id, order_id, description, material, width, height,
         qty, roll_used, area, unit_price, total, sort_order)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      values: [
        item.id,
        order.id,
        item.description,
        item.material || null,
        item.width,
        item.height,
        item.qty,
        item.rollUsed || null,
        item.area,
        item.unitPrice,
        item.total,
        i,
      ],
    })),
  ];

  await db.executeSet(statements, true);
  notifyDataChanged();
}

export async function deleteOrder(id: string): Promise<void> {
  const db = await getDb();
  await db.run("DELETE FROM orders WHERE id = ?", [id]);
  notifyDataChanged();
}

export async function updateOrderStatus(id: string, status: OrderStatus): Promise<void> {
  const db = await getDb();
  await db.run("UPDATE orders SET status = ? WHERE id = ?", [status, id]);
  notifyDataChanged();
}

