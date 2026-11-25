/**
 * ═══════════════════════════════════════════════════════════════
 * Audit log repository (PRD §12.7, Blueprint §10.4)
 * ═══════════════════════════════════════════════════════════════
 * Financial records are never destroyed silently: cancellations, reversals and
 * significant edits append an entry here, and the original record is kept.
 *
 * Writing an audit entry must never break the business operation that produced
 * it, so failures are logged and swallowed by design.
 */

import { getDb } from "@/lib/database";

export type AuditAction =
  | "create"
  | "update"
  | "cancel"
  | "reverse"
  | "restore"
  | "migrate"
  | "reference_backfill"
  | "archive"
  | "unarchive"
  | "delete"
  | "reactivate"
  | "opening_balance"
  | "bank_reconciliation"
  | "external_deposit"
  | "external_withdrawal";

export interface AuditEntry {
  id: string;
  entityType: string;
  entityId: string;
  action: AuditAction;
  reason: string | null;
  details: string | null;
  createdAt: string;
}

function newId(nowIso: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `audit-${nowIso.replace(/[^0-9]/g, "").slice(0, 14)}-${rand}`;
}

export async function appendAuditEntry(input: {
  entityType: string;
  entityId: string;
  action: AuditAction;
  reason?: string | null;
  details?: unknown;
  nowIso?: string;
}): Promise<void> {
  const nowIso = input.nowIso ?? new Date().toISOString();
  try {
    const db = await getDb();
    await db.run(
      "INSERT INTO audit_log(id, entity_type, entity_id, action, reason, details, created_at) VALUES(?,?,?,?,?,?,?)",
      [
        newId(nowIso),
        input.entityType,
        input.entityId,
        input.action,
        input.reason ?? null,
        input.details === undefined ? null : JSON.stringify(input.details),
        nowIso,
      ]
    );
  } catch (err) {
    console.warn("[AuditLog] could not append entry:", err);
  }
}

export async function listAuditEntries(entityType: string, entityId: string, limit = 50): Promise<AuditEntry[]> {
  try {
    const db = await getDb();
    const res = await db.query(
      "SELECT id, entity_type, entity_id, action, reason, details, created_at FROM audit_log WHERE entity_type = ? AND entity_id = ? ORDER BY created_at DESC LIMIT ?",
      [entityType, entityId, limit]
    );
    return (res.values ?? []).map((row: any) => ({
      id: String(row.id),
      entityType: String(row.entity_type),
      entityId: String(row.entity_id),
      action: row.action as AuditAction,
      reason: row.reason ?? null,
      details: row.details ?? null,
      createdAt: String(row.created_at),
    }));
  } catch (err) {
    console.warn("[AuditLog] could not read entries:", err);
    return [];
  }
}
