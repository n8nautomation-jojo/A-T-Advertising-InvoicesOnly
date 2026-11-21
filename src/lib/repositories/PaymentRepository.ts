/**
 * ═══════════════════════════════════════════════════════════════
 * Payments — customer receipts, supplier payments, internal transfers
 * ═══════════════════════════════════════════════════════════════
 */

import { getDb } from "@/lib/database";
import { withDbWriteLock } from "@/lib/database/writeLock";
import { notifyDataChanged } from "@/lib/backup/notify";
import { appendAuditEntry } from "@/lib/repositories/AuditLogRepository";
import { allocateMoneyReference } from "@/lib/repositories/DocumentSequenceRepository";
import { sanitizeCurrency, type AppCurrency } from "@/lib/currency/types";
import {
  looksLikeDuplicatePayment,
  sanitizeMoney,
  validateAllocations,
  type AllocationInvoice,
  type AllocationIntent,
  type ExistingPaymentFingerprint,
  type PaymentMethod,
} from "@/lib/domain/finance";

export interface CustomerReceipt {
  id: string;
  reference: string;
  customerId: string;
  amount: number;
  currency: AppCurrency;
  paidAt: string;
  method: PaymentMethod;
  accountId: string;
  transactionRef?: string | undefined;
  notes?: string | undefined;
  allocations: AllocationIntent[];
  createdAt: string;
}

export interface SupplierPayment {
  id: string;
  reference: string;
  supplierId: string;
  amount: number;
  currency: AppCurrency;
  paidAt: string;
  method: PaymentMethod;
  accountId: string;
  transactionRef?: string | undefined;
  notes?: string | undefined;
  allocations: AllocationIntent[];
  createdAt: string;
}

function newId(prefix: string, nowIso: string): string {
  return `${prefix}-${nowIso.replace(/[^0-9]/g, "").slice(0, 14)}-${Math.random().toString(36).slice(2, 6)}`;
}

async function loadInvoiceAllocationState(
  invoiceIds: string[],
  expectedCustomerId?: string
): Promise<{ invoices: AllocationInvoice[]; currency: AppCurrency | null }> {
  if (invoiceIds.length === 0) return { invoices: [], currency: null };
  const db = await getDb();
  const uniqueIds = Array.from(new Set(invoiceIds));
  const result: AllocationInvoice[] = [];
  let detectedCurrency: AppCurrency | null = null;

  for (const id of uniqueIds) {
    const invoiceRes = await db.query(
      `SELECT id, reference, total_amount, customer_id, party_name, COALESCE(currency, 'SDG') AS currency
         FROM custom_invoices
        WHERE id = ? AND cancelled_at IS NULL LIMIT 1`,
      [id]
    );
    const row = invoiceRes.values?.[0];
    if (!row) {
      throw new Error(`الفاتورة المحددة (${id}) غير موجودة أو تم إلغاؤها.`);
    }

    const invCurrency = sanitizeCurrency(row.currency, "SDG");
    if (detectedCurrency && detectedCurrency !== invCurrency) {
      throw new Error(
        `انتهاك محاسبي: لا يمكن توزيع سند قبض واحد على فواتير بعملات مختلفة (${detectedCurrency} و ${invCurrency}).`
      );
    }
    detectedCurrency = invCurrency;

    if (expectedCustomerId) {
      const invoiceCustId = row.customer_id ? String(row.customer_id).trim() : "";
      const invoicePartyName = row.party_name ? String(row.party_name).trim().toLowerCase() : "";

      if (invoiceCustId && invoiceCustId !== expectedCustomerId) {
        const invRef = row.reference ? `«${row.reference}»` : id;
        const ownerName = row.party_name ? `«${row.party_name}»` : "عميل آخر";
        throw new Error(
          `انتهاك محاسبي: لا يمكن سداد الفاتورة ${invRef} لأنها تخص ${ownerName}، بينما السند صادر للعميل الحالي. الفواتير المسموح بربطها يجب أن تخص العميل المحدد فقط.`
        );
      }

      if (!invoiceCustId && invoicePartyName) {
        const otherCustRes = await db.query(
          "SELECT id, name FROM customers WHERE LOWER(TRIM(name)) = ? AND id != ? LIMIT 1",
          [invoicePartyName, expectedCustomerId]
        );
        if (otherCustRes.values?.length) {
          const invRef = row.reference ? `«${row.reference}»` : id;
          throw new Error(
            `انتهاك محاسبي: لا يمكن سداد الفاتورة ${invRef} لأنها تخص العميل «${row.party_name}»، بينما السند صادر للعميل الحالي. الفواتير المسموح بربطها يجب أن تخص العميل المحدد فقط.`
          );
        }
      }
    }

    const paidRes = await db.query(
      `SELECT COALESCE(SUM(a.amount), 0) AS paid
         FROM customer_payment_allocations a
         JOIN customer_payments p ON p.id = a.payment_id
        WHERE a.invoice_id = ? AND p.cancelled_at IS NULL`,
      [id]
    );
    result.push({
      id: String(row.id),
      total: Number(row.total_amount) || 0,
      alreadyAllocated: Number(paidRes.values?.[0]?.paid) || 0,
    });
  }
  return { invoices: result, currency: detectedCurrency };
}

async function loadSupplierInvoiceAllocationState(
  invoiceIds: string[],
  expectedSupplierId?: string
): Promise<{ invoices: AllocationInvoice[]; currency: AppCurrency | null }> {
  if (invoiceIds.length === 0) return { invoices: [], currency: null };
  const db = await getDb();
  const uniqueIds = Array.from(new Set(invoiceIds));
  const result: AllocationInvoice[] = [];
  let detectedCurrency: AppCurrency | null = null;

  for (const id of uniqueIds) {
    const invoiceRes = await db.query(
      `SELECT id, reference, total_amount, supplier_id, party_name, COALESCE(currency, 'SDG') AS currency
         FROM custom_invoices
        WHERE id = ? AND cancelled_at IS NULL LIMIT 1`,
      [id]
    );
    const row = invoiceRes.values?.[0];
    if (!row) {
      throw new Error(`فاتورة المشتريات المحددة (${id}) غير موجودة أو تم إلغاؤها.`);
    }

    const invCurrency = sanitizeCurrency(row.currency, "SDG");
    if (detectedCurrency && detectedCurrency !== invCurrency) {
      throw new Error(
        `انتهاك محاسبي: لا يمكن توزيع سند صرف واحد على فواتير مشتريات بعملات مختلفة (${detectedCurrency} و ${invCurrency}).`
      );
    }
    detectedCurrency = invCurrency;

    if (expectedSupplierId) {
      const invoiceSuppId = row.supplier_id ? String(row.supplier_id).trim() : "";
      const invoicePartyName = row.party_name ? String(row.party_name).trim().toLowerCase() : "";

      if (invoiceSuppId && invoiceSuppId !== expectedSupplierId) {
        const invRef = row.reference ? `«${row.reference}»` : id;
        const ownerName = row.party_name ? `«${row.party_name}»` : "مورد آخر";
        throw new Error(
          `انتهاك محاسبي: لا يمكن سداد الفاتورة ${invRef} لأنها تخص ${ownerName}، بينما السند صادر للمورد الحالي.`
        );
      }

      if (!invoiceSuppId && invoicePartyName) {
        const otherSuppRes = await db.query(
          "SELECT id, name FROM suppliers WHERE LOWER(TRIM(name)) = ? AND id != ? LIMIT 1",
          [invoicePartyName, expectedSupplierId]
        );
        if (otherSuppRes.values?.length) {
          const invRef = row.reference ? `«${row.reference}»` : id;
          throw new Error(
            `انتهاك محاسبي: لا يمكن سداد الفاتورة ${invRef} لأنها تخص المورد «${row.party_name}»، بينما السند صادر للمورد الحالي.`
          );
        }
      }
    }

    const paidRes = await db.query(
      `SELECT COALESCE(SUM(a.amount), 0) AS paid
         FROM supplier_payment_allocations a
         JOIN supplier_payments p ON p.id = a.payment_id
        WHERE a.invoice_id = ? AND p.cancelled_at IS NULL`,
      [id]
    );
    result.push({
      id: String(row.id),
      total: Number(row.total_amount) || 0,
      alreadyAllocated: Number(paidRes.values?.[0]?.paid) || 0,
    });
  }
  return { invoices: result, currency: detectedCurrency };
}

async function existingReceiptFingerprints(customerId: string): Promise<(ExistingPaymentFingerprint & { id: string })[]> {
  const db = await getDb();
  const [payRes, allocRes] = await Promise.all([
    db.query(
      "SELECT id, amount, paid_at, method FROM customer_payments WHERE customer_id = ? AND cancelled_at IS NULL",
      [customerId]
    ),
    db.query(
      `SELECT a.payment_id, a.invoice_id
         FROM customer_payment_allocations a
         JOIN customer_payments p ON p.id = a.payment_id
        WHERE p.customer_id = ? AND p.cancelled_at IS NULL`,
      [customerId]
    ),
  ]);
  const allocsByPayment = new Map<string, string[]>();
  for (const a of allocRes.values ?? []) {
    const pid = String(a.payment_id);
    const list = allocsByPayment.get(pid) ?? [];
    list.push(String(a.invoice_id));
    allocsByPayment.set(pid, list);
  }
  return (payRes.values ?? []).map((row: any) => ({
    id: String(row.id),
    amount: Number(row.amount) || 0,
    paidAt: String(row.paid_at),
    method: String(row.method ?? "cash"),
    invoiceIds: allocsByPayment.get(String(row.id)) ?? [],
  }));
}

async function existingSupplierFingerprints(supplierId: string): Promise<(ExistingPaymentFingerprint & { id: string })[]> {
  const db = await getDb();
  const [payRes, allocRes] = await Promise.all([
    db.query(
      "SELECT id, amount, paid_at, method FROM supplier_payments WHERE supplier_id = ? AND cancelled_at IS NULL",
      [supplierId]
    ),
    db.query(
      `SELECT a.payment_id, a.invoice_id
         FROM supplier_payment_allocations a
         JOIN supplier_payments p ON p.id = a.payment_id
        WHERE p.supplier_id = ? AND p.cancelled_at IS NULL`,
      [supplierId]
    ),
  ]);
  const allocsByPayment = new Map<string, string[]>();
  for (const a of allocRes.values ?? []) {
    const pid = String(a.payment_id);
    const list = allocsByPayment.get(pid) ?? [];
    list.push(String(a.invoice_id));
    allocsByPayment.set(pid, list);
  }
  return (payRes.values ?? []).map((row: any) => ({
    id: String(row.id),
    amount: Number(row.amount) || 0,
    paidAt: String(row.paid_at),
    method: String(row.method ?? "cash"),
    invoiceIds: allocsByPayment.get(String(row.id)) ?? [],
  }));
}

export interface RecordPaymentInput {
  customerId: string;
  amount: number;
  currency?: AppCurrency;
  paidAt: string;
  method?: PaymentMethod;
  accountId: string;
  transactionRef?: string;
  notes?: string;
  allocations?: AllocationIntent[];
  confirmDuplicate?: boolean;
}

export async function recordCustomerReceipt(
  input: RecordPaymentInput,
  nowIso = new Date().toISOString()
): Promise<{ payment: CustomerReceipt; warning?: string }> {
  const rawAmount = Number(input.amount);
  if (!Number.isFinite(rawAmount) || rawAmount <= 0) {
    throw new Error("مبلغ الدفعة يجب أن يكون رقماً صحيحاً أكبر من صفر");
  }
  const amount = sanitizeMoney(rawAmount);
  if (!input.customerId) throw new Error("يجب تحديد العميل");
  if (!input.accountId) throw new Error("يجب تحديد الحساب المالي المستلم");
  if (!input.paidAt) throw new Error("تاريخ الدفعة مطلوب");

  return withDbWriteLock(async () => {
    const db = await getDb();
    const allocations = input.allocations ?? [];
    const { invoices, currency: allocatedCurrency } = await loadInvoiceAllocationState(
      allocations.map((a) => a.invoiceId),
      input.customerId
    );
    if (allocatedCurrency && input.currency && sanitizeCurrency(input.currency) !== allocatedCurrency) {
      throw new Error(
        `انتهاك محاسبي: عملة السند (${input.currency}) لا تطابق عملة الفاتورة المحددة (${allocatedCurrency}).`
      );
    }
    const currency: AppCurrency = allocatedCurrency ?? sanitizeCurrency(input.currency, "SDG");

    const accountRes = await db.query(
      "SELECT id, COALESCE(currency, 'SDG') AS currency FROM financial_accounts WHERE id = ? LIMIT 1",
      [input.accountId]
    );
    const accountRow = accountRes.values?.[0];
    if (!accountRow) {
      throw new Error("الحساب المالي المحدد غير موجود.");
    }
    const accountCurrency = sanitizeCurrency(accountRow.currency, "SDG");
    if (accountCurrency !== currency) {
      throw new Error(
        `عملة الحساب المالي (${accountCurrency}) لا تطابق عملة السند (${currency}). يرجى اختيار حساب بنفس العملة.`
      );
    }

    const validation = validateAllocations(amount, allocations, invoices);
    if (!validation.ok) throw new Error(validation.errors.join("، "));

    let warning: string | undefined;
    if (!input.confirmDuplicate) {
      const existing = await existingReceiptFingerprints(input.customerId);
      const duplicate = looksLikeDuplicatePayment(
        {
          amount,
          paidAt: input.paidAt,
          method: input.method ?? "cash",
          invoiceIds: validation.normalised.map((a) => a.invoiceId),
        },
        existing
      );
      if (duplicate) {
        warning = "توجد دفعة مطابقة تماماً (نفس الفاتورة والمبلغ والتاريخ والطريقة). أكّد التسجيل إن كنت متعمداً.";
        const error = new Error(warning);
        (error as Error & { code?: string }).code = "DUPLICATE_PAYMENT";
        throw error;
      }
    }

    const allocated = await allocateMoneyReference("receipt", input.paidAt, nowIso);
    const id = newId("rcv", nowIso);

    await db.beginTransaction();
    try {
      await db.run(
        `INSERT INTO customer_payments
           (id, reference, customer_id, amount, currency, paid_at, method, account_id, transaction_ref, notes, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [
          id,
          allocated.reference,
          input.customerId,
          amount,
          currency,
          input.paidAt,
          input.method ?? "cash",
          input.accountId,
          input.transactionRef ?? null,
          input.notes ?? null,
          nowIso,
        ],
        false
      );

      for (const allocation of validation.normalised) {
        await db.run(
          `INSERT INTO customer_payment_allocations(id, payment_id, invoice_id, amount, created_at)
           VALUES (?,?,?,?,?)`,
          [newId("alloc", `${nowIso}-${allocation.invoiceId}-${allocation.amount}`), id, allocation.invoiceId, allocation.amount, nowIso],
          false
        );
      }

      await db.run(
        `INSERT INTO financial_transactions
           (id, kind, amount, currency, occurred_at, account_id, source_type, source_id, reference_note, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [
          `tx-${id}`,
          "receipt",
          amount,
          currency,
          input.paidAt,
          input.accountId,
          "customer_payment",
          id,
          allocated.reference,
          nowIso,
        ],
        false
      );

      await db.commitTransaction();
    } catch (err) {
      try {
        await db.rollbackTransaction();
      } catch {
        // already resolved
      }
      throw err;
    }

    await appendAuditEntry({
      entityType: "customer_payment",
      entityId: id,
      action: "create",
      details: { reference: allocated.reference, amount, currency, allocations: validation.normalised },
      nowIso,
    });
    notifyDataChanged();

    return {
      payment: {
        id,
        reference: allocated.reference,
        customerId: input.customerId,
        amount,
        currency,
        paidAt: input.paidAt,
        method: (input.method ?? "cash") as PaymentMethod,
        accountId: input.accountId,
        transactionRef: input.transactionRef,
        notes: input.notes,
        allocations: validation.normalised,
        createdAt: nowIso,
      },
      warning,
    };
  });
}

export async function recordSupplierPayment(
  input: {
    supplierId: string;
    amount: number;
    currency?: AppCurrency;
    paidAt: string;
    method?: PaymentMethod;
    accountId: string;
    transactionRef?: string;
    notes?: string;
    allocations?: AllocationIntent[];
    confirmDuplicate?: boolean;
  },
  nowIso = new Date().toISOString()
): Promise<{ payment: SupplierPayment; warning?: string }> {
  const rawAmount = Number(input.amount);
  if (!Number.isFinite(rawAmount) || rawAmount <= 0) {
    throw new Error("مبلغ الدفعة يجب أن يكون رقماً صحيحاً أكبر من صفر");
  }
  const amount = sanitizeMoney(rawAmount);
  if (!input.supplierId) throw new Error("يجب تحديد المورد");
  if (!input.accountId) throw new Error("يجب تحديد الحساب المالي الذي خرج منه المبلغ");
  if (!input.paidAt) throw new Error("تاريخ الدفعة مطلوب");

  return withDbWriteLock(async () => {
    const db = await getDb();
    const allocations = input.allocations ?? [];
    const { invoices, currency: allocatedCurrency } = await loadSupplierInvoiceAllocationState(
      allocations.map((a) => a.invoiceId),
      input.supplierId
    );
    if (allocatedCurrency && input.currency && sanitizeCurrency(input.currency) !== allocatedCurrency) {
      throw new Error(
        `انتهاك محاسبي: عملة السند (${input.currency}) لا تطابق عملة فاتورة المشتريات (${allocatedCurrency}).`
      );
    }
    const currency: AppCurrency = allocatedCurrency ?? sanitizeCurrency(input.currency, "SDG");

    const accountRes = await db.query(
      "SELECT id, COALESCE(currency, 'SDG') AS currency FROM financial_accounts WHERE id = ? LIMIT 1",
      [input.accountId]
    );
    const accountRow = accountRes.values?.[0];
    if (!accountRow) {
      throw new Error("الحساب المالي المحدد غير موجود.");
    }
    const accountCurrency = sanitizeCurrency(accountRow.currency, "SDG");
    if (accountCurrency !== currency) {
      throw new Error(
        `عملة الحساب المالي (${accountCurrency}) لا تطابق عملة السند (${currency}). يرجى اختيار حساب بنفس العملة.`
      );
    }

    const validation = validateAllocations(amount, allocations, invoices);
    if (!validation.ok) throw new Error(validation.errors.join("، "));

    let warning: string | undefined;
    if (!input.confirmDuplicate) {
      const existing = await existingSupplierFingerprints(input.supplierId);
      const duplicate = looksLikeDuplicatePayment(
        {
          amount,
          paidAt: input.paidAt,
          method: input.method ?? "cash",
          invoiceIds: validation.normalised.map((a) => a.invoiceId),
        },
        existing
      );
      if (duplicate) {
        warning = "توجد دفعة مطابقة تماماً لنفس المورد. أكّد التسجيل إن كنت متعمداً.";
        const error = new Error(warning);
        (error as Error & { code?: string }).code = "DUPLICATE_PAYMENT";
        throw error;
      }
    }

    const allocated = await allocateMoneyReference("supplier_payment", input.paidAt, nowIso);
    const id = newId("spay", nowIso);

    await db.beginTransaction();
    try {
      await db.run(
        `INSERT INTO supplier_payments
           (id, reference, supplier_id, amount, currency, paid_at, method, account_id, transaction_ref, notes, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [
          id,
          allocated.reference,
          input.supplierId,
          amount,
          currency,
          input.paidAt,
          input.method ?? "cash",
          input.accountId,
          input.transactionRef ?? null,
          input.notes ?? null,
          nowIso,
        ],
        false
      );

      for (const allocation of validation.normalised) {
        await db.run(
          `INSERT INTO supplier_payment_allocations(id, payment_id, invoice_id, amount, created_at)
           VALUES (?,?,?,?,?)`,
          [newId("salloc", `${nowIso}-${allocation.invoiceId}-${allocation.amount}`), id, allocation.invoiceId, allocation.amount, nowIso],
          false
        );
      }

      await db.run(
        `INSERT INTO financial_transactions
           (id, kind, amount, currency, occurred_at, account_id, source_type, source_id, reference_note, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [
          `tx-${id}`,
          "payment",
          amount,
          currency,
          input.paidAt,
          input.accountId,
          "supplier_payment",
          id,
          allocated.reference,
          nowIso,
        ],
        false
      );

      await db.commitTransaction();
    } catch (err) {
      try {
        await db.rollbackTransaction();
      } catch {
        // already resolved
      }
      throw err;
    }

    await appendAuditEntry({
      entityType: "supplier_payment",
      entityId: id,
      action: "create",
      details: { reference: allocated.reference, amount, currency, allocations: validation.normalised },
      nowIso,
    });
    notifyDataChanged();

    return {
      payment: {
        id,
        reference: allocated.reference,
        supplierId: input.supplierId,
        amount,
        currency,
        paidAt: input.paidAt,
        method: (input.method ?? "cash") as PaymentMethod,
        accountId: input.accountId,
        transactionRef: input.transactionRef,
        notes: input.notes,
        allocations: validation.normalised,
        createdAt: nowIso,
      },
      warning,
    };
  });
}

export async function recordTransfer(
  input: {
    fromAccountId: string;
    toAccountId: string;
    amount: number;
    currency?: AppCurrency;
    occurredAt: string;
    notes?: string;
  },
  nowIso = new Date().toISOString()
): Promise<{ ok: true }> {
  const rawAmount = Number(input.amount);
  if (!Number.isFinite(rawAmount) || rawAmount <= 0) {
    throw new Error("قيمة التحويل يجب أن تكون أكبر من صفر");
  }
  const amount = sanitizeMoney(rawAmount);
  if (!input.fromAccountId || !input.toAccountId) throw new Error("يجب تحديد الحسابين");
  if (input.fromAccountId === input.toAccountId) throw new Error("لا يمكن التحويل إلى الحساب نفسه");

  return withDbWriteLock(async () => {
    const db = await getDb();
    const [fromRes, toRes] = await Promise.all([
      db.query("SELECT id, COALESCE(currency, 'SDG') AS currency FROM financial_accounts WHERE id = ? LIMIT 1", [
        input.fromAccountId,
      ]),
      db.query("SELECT id, COALESCE(currency, 'SDG') AS currency FROM financial_accounts WHERE id = ? LIMIT 1", [
        input.toAccountId,
      ]),
    ]);
    const fromAccount = fromRes.values?.[0];
    const toAccount = toRes.values?.[0];
    if (!fromAccount || !toAccount) {
      throw new Error("أحد الحسابين الماليين المحددين غير موجود.");
    }
    const fromCurrency = sanitizeCurrency(fromAccount.currency, "SDG");
    const toCurrency = sanitizeCurrency(toAccount.currency, "SDG");
    if (fromCurrency !== toCurrency) {
      throw new Error("لا يمكن التحويل المباشر بين حسابين بعملتين مختلفتين.");
    }
    const currency: AppCurrency = fromCurrency;

    const transferId = newId("trf", nowIso);
    await db.beginTransaction();
    try {
      await db.run(
        `INSERT INTO financial_transactions
           (id, kind, amount, currency, occurred_at, account_id, counter_account_id, source_type, source_id, reference_note, notes, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          `tx-${transferId}-out`,
          "transfer_out",
          amount,
          currency,
          input.occurredAt,
          input.fromAccountId,
          input.toAccountId,
          "transfer",
          transferId,
          transferId,
          input.notes ?? null,
          nowIso,
        ],
        false
      );
      await db.run(
        `INSERT INTO financial_transactions
           (id, kind, amount, currency, occurred_at, account_id, counter_account_id, source_type, source_id, reference_note, notes, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          `tx-${transferId}-in`,
          "transfer_in",
          amount,
          currency,
          input.occurredAt,
          input.toAccountId,
          input.fromAccountId,
          "transfer",
          transferId,
          transferId,
          input.notes ?? null,
          nowIso,
        ],
        false
      );
      await db.commitTransaction();
    } catch (err) {
      try {
        await db.rollbackTransaction();
      } catch {
        // already resolved
      }
      throw err;
    }

    await appendAuditEntry({
      entityType: "financial_transfer",
      entityId: transferId,
      action: "create",
      details: { from: input.fromAccountId, to: input.toAccountId, amount, currency },
      nowIso,
    });
    notifyDataChanged();
    return { ok: true };
  });
}

export async function cancelPayment(
  kind: "receipt" | "supplier_payment" | "expense_payment",
  paymentId: string,
  reason: string | null,
  nowIso = new Date().toISOString()
): Promise<void> {
  const table =
    kind === "receipt" ? "customer_payments" : kind === "supplier_payment" ? "supplier_payments" : "expense_payments";
  const sourceType =
    kind === "receipt" ? "customer_payment" : kind === "supplier_payment" ? "supplier_payment" : "expense_payment";

  await withDbWriteLock(async () => {
    const db = await getDb();
    await db.beginTransaction();
    try {
      await db.run(
        `UPDATE ${table} SET cancelled_at = ?, cancellation_reason = ? WHERE id = ? AND cancelled_at IS NULL`,
        [nowIso, reason, paymentId],
        false
      );
      await db.run(
        "UPDATE financial_transactions SET reversed_by = ? WHERE source_type = ? AND source_id = ?",
        [paymentId, sourceType, paymentId],
        false
      );
      await db.commitTransaction();
    } catch (err) {
      try {
        await db.rollbackTransaction();
      } catch {
        // already resolved
      }
      throw err;
    }

    await appendAuditEntry({
      entityType: sourceType,
      entityId: paymentId,
      action: "cancel",
      reason,
      nowIso,
    });
    notifyDataChanged();
  });
}
