/**
 * ═══════════════════════════════════════════════════════════════
 * Retention planner — pure, testable deletion policy
 * ═══════════════════════════════════════════════════════════════
 * Invariants enforced here (and re-enforced natively before any delete):
 *  1. Only backups of kind daily/weekly/monthly are ever candidates for pruning.
 *     Manual, transaction, pre-update and pre-restore copies are never pruned
 *     automatically — they are the user's explicit safety net.
 *  2. The newest file is never pruned.
 *  3. `keepMinimum` most recent files are never pruned.
 *  4. A file is grouped into a bucket using its LOCAL calendar date in the
 *     device timezone, matching how the user thinks about "days".
 *  5. An unreadable or failed-verification file is never deleted here — the
 *     caller passes only verified manifests, because deleting a file we could
 *     not read would remove the very copy that might still be recoverable by
 *     another version of the app.
 */

import type { BackupFileInfo, BackupKind, RetentionPolicy } from "./types";

export interface RetentionDecision {
  keep: string[];
  prune: string[];
  buckets: BucketSummary;
}

export interface BucketSummary {
  daily: Record<string, string[]>;
  weekly: Record<string, string[]>;
  monthly: Record<string, string[]>;
}

export type ClockTime = { year: number; month: number; day: number };

/** Splits an ISO timestamp into local calendar parts (month is 1-based). */
export function localCalendar(iso: string, timeZoneOffsetMinutes: number): ClockTime {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return { year: 1970, month: 1, day: 1 };
  // Shift by the device offset, then read the UTC parts of the shifted instant.
  const shifted = new Date(ms - timeZoneOffsetMinutes * 60_000);
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}

function pad2(n: number): string {
  return n < 10 ? "0" + n : String(n);
}

export function dailyKey(t: ClockTime): string {
  return `${t.year}-${pad2(t.month)}-${pad2(t.day)}`;
}

export function monthlyKey(t: ClockTime): string {
  return `${t.year}-${pad2(t.month)}`;
}

/** ISO week key (Monday-based) — "2026-W46". */
export function weeklyKey(t: ClockTime): string {
  const date = new Date(Date.UTC(t.year, t.month - 1, t.day));
  const dayNum = date.getUTCDay() || 7; // Sunday(0) -> 7
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const isoYear = date.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${isoYear}-W${pad2(week)}`;
}

interface Candidate {
  fileName: string;
  createdAtMs: number;
  createdAt: string;
  kind: BackupKind;
}

function toCandidates(backups: BackupFileInfo[]): Candidate[] {
  const list: Candidate[] = [];
  for (const b of backups) {
    const m = b.manifest;
    if (!m) continue; // unreadable files are never pruned automatically
    if (b.status !== "verified") continue;
    const ms = Date.parse(m.createdAt);
    if (!Number.isFinite(ms)) continue;
    list.push({ fileName: b.fileName, createdAtMs: ms, createdAt: m.createdAt, kind: m.kind });
  }
  list.sort((a, b) => b.createdAtMs - a.createdAtMs); // newest first
  return list;
}

function groupBy(list: Candidate[], keyOf: (c: Candidate) => string): Map<string, Candidate[]> {
  const map = new Map<string, Candidate[]>();
  for (const c of list) {
    const key = keyOf(c);
    const arr = map.get(key);
    if (arr) arr.push(c);
    else map.set(key, [c]);
  }
  return map;
}

export const MAX_TRANSACTION_BACKUPS = 10;
export const MAX_SAFETY_BACKUPS = 5;

/**
 * Computes which files survive.
 *
 * Each lane is scored independently so a protected file in one lane can
 * never "use up" a slot in another:
 *   - manual lane      : kept forever (user's explicit snapshots)
 *   - transaction lane : keep newest MAX_TRANSACTION_BACKUPS (10)
 *   - pre-restore lane : keep newest MAX_SAFETY_BACKUPS (5)
 *   - pre-update lane  : keep newest MAX_SAFETY_BACKUPS (5)
 *   - daily lane       : daily files   → keep newest policy.daily DAYS
 *   - weekly lane      : weekly files  → keep newest policy.weekly ISO WEEKS
 *   - monthly lane     : monthly files → keep newest policy.monthly MONTHS
 * Within a kept day/week/month only the newest file survives; older files of
 * the same period are duplicates of the same data and are pruned.
 */
export function planRetention(
  backups: BackupFileInfo[],
  policy: RetentionPolicy,
  timeZoneOffsetMinutes: number,
  nowMs: number = Date.now()
): RetentionDecision {
  const candidates = toCandidates(backups);
  const calendarOf = (c: Candidate) => localCalendar(c.createdAt, timeZoneOffsetMinutes);

  const daily = groupBy(
    candidates.filter((c) => c.kind === "daily"),
    (c) => dailyKey(calendarOf(c))
  );
  const weekly = groupBy(candidates.filter((c) => c.kind === "weekly"), (c) => weeklyKey(calendarOf(c)));
  const monthly = groupBy(candidates.filter((c) => c.kind === "monthly"), (c) => monthlyKey(calendarOf(c)));

  const transactions = candidates.filter((c) => c.kind === "transaction");
  const preRestore = candidates.filter((c) => c.kind === "pre-restore");
  const preUpdate = candidates.filter((c) => c.kind === "pre-update");

  const prune = new Set<string>();

  /** Keeps the newest `limit` period buckets; every other file is prunable. */
  const applyLane = (buckets: Map<string, Candidate[]>, limit: number) => {
    const effectiveLimit = Math.max(0, limit);
    const keys = Array.from(buckets.keys()).sort().reverse(); // newest period first
    keys.forEach((key, index) => {
      const members = buckets.get(key) || [];
      // candidates are newest-first, so members[0] is the period representative.
      members.forEach((member, position) => {
        if (ALWAYS_KEEP_KINDS.has(member.kind)) return;
        // Older duplicates inside the same period are redundant, and the
        // representative of an expired period is outside the retention window.
        if (position > 0 || index >= effectiveLimit) prune.add(member.fileName);
      });
    });
  };

  applyLane(daily, policy.daily);
  applyLane(weekly, policy.weekly);
  applyLane(monthly, policy.monthly);

  const hasRollingWindow = typeof policy.maxAgeDays === "number" && policy.maxAgeDays > 0;
  if (hasRollingWindow) {
    // Smart compaction for transaction backups older than 24h: keep only the newest 1 per past local calendar day.
    const recentTxCutoffMs = nowMs - 86_400_000;
    const olderTxByDay = groupBy(
      transactions.filter((c) => c.createdAtMs < recentTxCutoffMs),
      (c) => dailyKey(calendarOf(c))
    );
    for (const members of olderTxByDay.values()) {
      for (let i = 1; i < members.length; i++) {
        prune.add(members[i].fileName);
      }
    }
  }

  // Bounded caps for transaction and safety backups (newest-first, prune oldest excess).
  const survivingTransactions = hasRollingWindow
    ? transactions.filter((c) => !prune.has(c.fileName))
    : transactions;
  for (let i = MAX_TRANSACTION_BACKUPS; i < survivingTransactions.length; i++) {
    prune.add(survivingTransactions[i].fileName);
  }
  for (let i = MAX_SAFETY_BACKUPS; i < preRestore.length; i++) {
    prune.add(preRestore[i].fileName);
  }
  for (let i = MAX_SAFETY_BACKUPS; i < preUpdate.length; i++) {
    prune.add(preUpdate[i].fileName);
  }

  if (hasRollingWindow) {
    const cutoffMs = nowMs - policy.maxAgeDays! * 86_400_000;
    for (const c of candidates) {
      if (!ALWAYS_KEEP_KINDS.has(c.kind) && c.createdAtMs < cutoffMs) {
        prune.add(c.fileName);
      }
    }
  }

  // Invariant: the newest keepMinimum files of ANY kind are never pruned.
  const newestProtected = candidates.slice(0, Math.max(0, policy.keepMinimum));
  for (const c of newestProtected) prune.delete(c.fileName);

  const keep = candidates
    .filter((c) => ALWAYS_KEEP_KINDS.has(c.kind) || !prune.has(c.fileName))
    .map((c) => c.fileName);

  const pruneList = Array.from(prune)
    .map((f) => candidates.find((c) => c.fileName === f)!)
    .sort((a, b) => a.createdAtMs - b.createdAtMs) // delete oldest first
    .map((c) => c.fileName);

  return {
    keep,
    prune: pruneList,
    buckets: {
      daily: mapToRecord(daily),
      weekly: mapToRecord(weekly),
      monthly: mapToRecord(monthly),
    },
  };
}

/** Kinds that are never deleted automatically (user's explicit manual snapshots). */
const ALWAYS_KEEP_KINDS = new Set<BackupKind>(["manual"]);

function mapToRecord(map: Map<string, Candidate[]>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [key, members] of map) out[key] = members.map((m) => m.fileName);
  return out;
}

/**
 * Decides whether a new scheduled backup of `kind` is needed now.
 * Prevents duplicate daily/weekly/monthly files when the worker runs late or
 * when two triggers fire close together.
 */
export function shouldCreateScheduledBackup(
  kind: "daily" | "weekly" | "monthly",
  nowMs: number,
  backups: BackupFileInfo[],
  timeZoneOffsetMinutes: number
): boolean {
  const nowCal = localCalendar(new Date(nowMs).toISOString(), timeZoneOffsetMinutes);
  const keyOf = kind === "daily" ? dailyKey : kind === "weekly" ? weeklyKey : monthlyKey;
  for (const b of backups) {
    if (!b.manifest || b.status !== "verified") continue;
    if (b.manifest.kind !== kind) continue;
    const cal = localCalendar(b.manifest.createdAt, timeZoneOffsetMinutes);
    if (keyOf(cal) === keyOf(nowCal)) return false;
  }
  return true;
}
