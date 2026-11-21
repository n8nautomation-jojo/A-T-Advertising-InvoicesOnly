/**
 * ═══════════════════════════════════════════════════════════════
 * SQLite Storage Engine — T.A Advertising Invoice System
 * ═══════════════════════════════════════════════════════════════
 *
 * Drop-in async replacement for the previous 3-layer nativeStorage.
 * On Android: persists to SQLite (WAL mode, crash-safe).
 * On Web/Dev: falls back to localStorage gracefully.
 *
 * Architecture:
 *   Stores → sqliteStorage (this file) → Repositories → SQLite DB
 *
 * This module is intentionally thin — it bridges the
 * synchronous React external store pattern to the async
 * SQLite persistence layer, using an in-memory cache for
 * synchronous reads (required by useSyncExternalStore).
 */

import { Capacitor } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";
import * as dbModule from "./database";
import { notifyDataChanged } from "./backup/notify";

const PROFILE_FAILSAFE_KEYS = new Set(["future_print_user_name", "future_print_onboarded"]);
const RESTORE_CLEAR_LOCALSTORAGE_KEYS = [
  "future_print_user_name",
  "future_print_onboarded",
  "future_calc_app_password_hash",
  "company_email",
  "company_phone",
  "company_address_ar",
  "company_address_en",
  "ta_official_letters_v1",
];

function runWithWriteLock<T>(fn: () => Promise<T>): Promise<T> {
  if (typeof dbModule.withDbWriteLock === "function") {
    return dbModule.withDbWriteLock(fn);
  }
  return fn();
}

// In-memory cache for synchronous reads (useSyncExternalStore requirement)
const memoryCache = new Map<string, string>();
// Structured object cache to eliminate redundant JSON.stringify / JSON.parse cycles
const parsedCache = new Map<string, any>();
let _ready = false;
let _sqliteReady = false;
let _sqliteInitError = false;
const _readyListeners: (() => void)[] = [];

export function isStorageReady(): boolean {
  return _ready;
}

export function isSQLiteReady(): boolean {
  return _sqliteReady;
}

export function hasSQLiteInitError(): boolean {
  return _sqliteInitError;
}

/** Clear all cached rows in memory so restored/reloaded snapshots start cleanly. */
export function clearSQLiteMemoryCache(): void {
  memoryCache.clear();
  parsedCache.clear();
  _ready = false;
  _sqliteReady = false;
  _sqliteInitError = false;
}

/** Remove device profile failsafes and stale localStorage entries before a full-replace restore so old values never shadow the restored snapshot. */
export async function clearProfileFailsafePreferences(): Promise<void> {
  for (const key of PROFILE_FAILSAFE_KEYS) {
    memoryCache.delete(key);
    parsedCache.delete(key);
    if (Capacitor.isNativePlatform()) {
      await Preferences.remove({ key }).catch(() => {});
    }
  }

  for (const key of RESTORE_CLEAR_LOCALSTORAGE_KEYS) {
    memoryCache.delete(key);
    parsedCache.delete(key);
  }

  if (typeof window !== "undefined") {
    try {
      for (const key of RESTORE_CLEAR_LOCALSTORAGE_KEYS) {
        localStorage.removeItem(key);
      }
      // Also clear any company_* keys that may have been written previously
      const companyKeys: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith("company_")) {
          companyKeys.push(k);
        }
      }
      for (const k of companyKeys) {
        localStorage.removeItem(k);
        memoryCache.delete(k);
        parsedCache.delete(k);
      }
    } catch {}
  }
}

/** Update in-memory cache immediately with raw string (and localStorage on web) */
export function setMemoryCacheString(key: string, value: string): void {
  memoryCache.set(key, value);
  parsedCache.delete(key);
  if (!Capacitor.isNativePlatform() && typeof window !== "undefined") {
    try {
      localStorage.setItem(key, value);
    } catch {}
  }
}

/** Update in-memory cache immediately (and localStorage on web) without touching SQLite settings table */
export function setMemoryCacheJson<T>(key: string, data: T): void {
  parsedCache.set(key, data);
  if (!Capacitor.isNativePlatform() && typeof window !== "undefined") {
    try {
      localStorage.setItem(key, JSON.stringify(data));
    } catch {}
  }
}

/** Called by initSQLiteStorage() when DB is open and data is loaded */
function markReady() {
  _ready = true;
  _readyListeners.forEach((fn) => fn());
  _readyListeners.length = 0;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("native-storage-ready"));
  }
}

/**
 * Synchronous read from memory cache (required by useSyncExternalStore).
 * Returns fallback if key not yet loaded.
 * On native Android, never falls back to WebView localStorage so deleted or
 * restored SQLite state cannot be shadowed by stale localStorage entries.
 */
export function getStoredSync(key: string, defaultValue: string = ""): string {
  if (memoryCache.has(key)) return memoryCache.get(key)!;
  // Browser-only localStorage fallback (never shadow SQLite on native Android)
  if (!Capacitor.isNativePlatform() && typeof window !== "undefined") {
    try {
      const val = localStorage.getItem(key);
      if (val !== null) {
        memoryCache.set(key, val);
        return val;
      }
    } catch {}
  }
  return defaultValue;
}

/** Safe JSON parse wrapper with structured cache lookup for synchronous reads */
export function getStoredJsonSync<T>(key: string, fallback: T): T {
  if (parsedCache.has(key)) {
    return parsedCache.get(key) as T;
  }
  const raw = getStoredSync(key, "");
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    if (parsed !== null && parsed !== undefined) {
      parsedCache.set(key, parsed);
      return parsed as T;
    }
    return fallback;
  } catch {
    return fallback;
  }
}

/**
 * Persist a string value to SQLite (async) + update memory cache.
 *
 * Non-entity data (password hash, license, profile, sequences, …) is stored in
 * the `settings` table. The two serial-counter keys are routed to `sequences`
 * because that is the table the app reads them from on startup — writing them
 * to `settings` was silently losing the invoice/proforma counters.
 */
export async function setStoredItem(key: string, value: string): Promise<void> {
  const previousValue = memoryCache.get(key);
  memoryCache.set(key, value);
  parsedCache.delete(key);

  if (!Capacitor.isNativePlatform()) {
    // Browser fallback
    try {
      localStorage.setItem(key, value);
    } catch (err) {
      if (previousValue !== undefined) memoryCache.set(key, previousValue);
      else memoryCache.delete(key);
      console.error(`[SQLiteStorage] Failed to write localStorage for key ${key}:`, err);
      throw err;
    }
    return;
  }

  if (PROFILE_FAILSAFE_KEYS.has(key)) {
    Preferences.set({ key, value }).catch(() => {});
  }

  try {
    await runWithWriteLock(async () => {
      const db = await dbModule.getDb();
      if (isSequenceKey(key)) {
        await db.run("INSERT OR REPLACE INTO sequences(key, value) VALUES(?,?)", [key, value]);
      }
      await db.run("INSERT OR REPLACE INTO settings(key, value) VALUES(?,?)", [key, value]);
    });
    notifyDataChanged();
  } catch (err) {
    // Roll back in-memory cache to maintain durability & consistency
    if (previousValue !== undefined) {
      memoryCache.set(key, previousValue);
    } else {
      memoryCache.delete(key);
    }
    console.error(`[SQLiteStorage] CRITICAL: setStoredItem failed for key ${key} — memory rolled back:`, err);
    throw err;
  }
}

/** Keys mirrored into the `sequences` table. */
export function isSequenceKey(key: string): boolean {
  return (
    key === "future_invoice_seq" ||
    key === "future_proforma_seq" ||
    key.startsWith("future_invoice_seq_") ||
    key.startsWith("future_proforma_seq_")
  );
}

/** JSON serialize and persist */
export async function setStoredJson<T>(key: string, data: T): Promise<void> {
  await setStoredItem(key, JSON.stringify(data));
}

/** Remove a key from cache, localStorage, Preferences, and DB */
export async function removeStoredItem(key: string): Promise<void> {
  memoryCache.delete(key);
  parsedCache.delete(key);

  if (typeof window !== "undefined") {
    try {
      localStorage.removeItem(key);
    } catch {}
  }

  if (!Capacitor.isNativePlatform()) {
    return;
  }

  await Preferences.remove({ key }).catch(() => {});

  try {
    await runWithWriteLock(async () => {
      const db = await dbModule.getDb();
      await db.run("DELETE FROM settings WHERE key = ?", [key]);
      if (isSequenceKey(key)) {
        await db.run("DELETE FROM sequences WHERE key = ?", [key]);
      }
    });
    notifyDataChanged();
  } catch (err) {
    console.warn(`[SQLiteStorage] removeStoredItem failed for key ${key}:`, err);
  }
}

export function isSqliteCorruptionError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err ?? "")).toLowerCase();
  return (
    msg.includes("malformed") ||
    msg.includes("code 11") ||
    msg.includes("sqlite_corrupt") ||
    msg.includes("not a database") ||
    msg.includes("disk image")
  );
}

/**
 * Pre-load all entity data into memory cache on startup.
 * This is what enables synchronous reads in useSyncExternalStore.
 */
async function preloadEntityCaches(): Promise<void> {
  if (!Capacitor.isNativePlatform()) {
    // Browser: load from localStorage (dev mode)
    const keys = [
      "future_custom_invoices_v2",
      "future_proforma_invoices_v2",
      "future_print_invoices_v2",
      "future_print_customers_v2",
      "future_print_orders_v2",
      "future_invoice_seq",
      "future_proforma_seq",
      "future_calc_app_password_hash",
      "future_print_sound_enabled",
      "future_print_user_name",
      "future_print_onboarded",
      "future_calculator_order_session",
      "future_print_license_v1",
      "future_print_install_id",
      "future_print_time_hwm",
      "future_print_license_pending",
      "future_print_renewal_pending",
    ];
    if (typeof window !== "undefined") {
      for (const key of keys) {
        try {
          const val = localStorage.getItem(key);
          if (val !== null) memoryCache.set(key, val);
        } catch {}
      }
    }
    return;
  }

  // On Android: load from repositories into cache-compatible JSON format
  try {
    const [
      { getAllCustomInvoices },
      { getAllCustomers },
      { getAllOrders },
      { getAllPrintInvoices },
      { getAllProformaInvoices },
      { getAllOfficialLetters },
    ] = await Promise.all([
      import("./repositories/CustomInvoiceRepository"),
      import("./repositories/CustomerRepository"),
      import("./repositories/OrderRepository"),
      import("./repositories/PrintInvoiceRepository"),
      import("./repositories/ProformaRepository"),
      import("./repositories/OfficialLetterRepository"),
    ]);

    let fatalCorruption: unknown = null;
    const guardPreload = <T>(p: Promise<T[]>): Promise<T[]> =>
      p.catch((err) => {
        if (isSqliteCorruptionError(err)) {
          if (!fatalCorruption) fatalCorruption = err;
          return [];
        }
        return [];
      });

    const [customInvoices, customers, orders, printInvoices, proformaInvoices, officialLetters] =
      await Promise.all([
        guardPreload(getAllCustomInvoices()),
        guardPreload(getAllCustomers({ includeArchived: true })),
        guardPreload(getAllOrders()),
        guardPreload(getAllPrintInvoices()),
        guardPreload(getAllProformaInvoices()),
        guardPreload(getAllOfficialLetters()),
      ]);

    if (fatalCorruption) {
      throw fatalCorruption;
    }

    parsedCache.set("future_custom_invoices_v2", customInvoices);
    parsedCache.set("future_print_customers_v2", customers);
    parsedCache.set("future_print_orders_v2", orders);
    parsedCache.set("future_print_invoices_v2", printInvoices);
    parsedCache.set("future_proforma_invoices_v2", proformaInvoices);
    parsedCache.set("ta_official_letters_v1", officialLetters);

    const db = await dbModule.getDb();

    // Load ALL settings rows into memoryCache first (password hash, profile, license, sound, session, company_*, etc.)
    const settingsRes = await db.query("SELECT key, value FROM settings");
    for (const row of settingsRes.values || []) {
      if (row?.key && row?.value !== undefined && row?.value !== null) {
        memoryCache.set(String(row.key), String(row.value));
      }
    }

    // Preload ALL rows from sequences (including year-suffixed keys!) into memoryCache
    const seqRes = await db.query("SELECT key, value FROM sequences");
    const seqKeysInTable = new Set<string>();
    for (const row of seqRes.values || []) {
      if (row?.key && row?.value !== undefined && row?.value !== null) {
        const key = String(row.key);
        const val = String(row.value);
        seqKeysInTable.add(key);
        memoryCache.set(key, val);
      }
    }

    // Repair the sequences table for installs affected by the old settings-only writer.
    for (const legacySeqKey of ["future_invoice_seq", "future_proforma_seq"] as const) {
      if (!seqKeysInTable.has(legacySeqKey)) {
        const fromSettings = memoryCache.get(legacySeqKey);
        if (fromSettings) {
          await db
            .run("INSERT OR REPLACE INTO sequences(key, value) VALUES(?,?)", [legacySeqKey, fromSettings])
            .catch(() => undefined);
        }
      }
    }

    // Keep onboarding/profile Preferences aligned with SQLite settings, and only
    // backfill from Preferences if SQLite has no value yet.
    for (const key of PROFILE_FAILSAFE_KEYS) {
      const fromDb = memoryCache.get(key);
      if (fromDb) {
        Preferences.set({ key, value: fromDb }).catch(() => {});
      } else {
        try {
          const pref = await Preferences.get({ key });
          if (pref.value) {
            memoryCache.set(key, pref.value);
            await db.run("INSERT OR REPLACE INTO settings(key, value) VALUES(?,?)", [key, pref.value]).catch(() => {});
          }
        } catch {}
      }
    }
  } catch (err) {
    console.error("[SQLiteStorage] Preload error:", err);
    // Keep onboarding state alive even if SQLite failed to preload
    for (const key of PROFILE_FAILSAFE_KEYS) {
      try {
        const pref = await Preferences.get({ key });
        if (pref.value) memoryCache.set(key, pref.value);
      } catch {}
    }
    throw err;
  }
}

async function _openAndPreloadNativeOrWeb(): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    // 1. Initialize DB connection + schema
    await dbModule.getDb();

    // 2. Run one-time migration from localStorage → SQLite
    const { runMigration, isMigrationDone } = await import("./database/migration");
    const migrationAlreadyDone = await isMigrationDone();
    if (!migrationAlreadyDone) {
      const report = await runMigration();
      console.info("[Storage] Migration result:", report.migrated, "errors:", report.errors.length);
    }
  }

  // 3. Pre-load all entity data into memory cache
  await preloadEntityCaches();
}

/**
 * Initialize SQLite storage engine.
 * Call once at app startup BEFORE mounting React.
 * Replaces the old initNativeStorage() call in main.tsx.
 */
export async function initSQLiteStorage(): Promise<void> {
  _sqliteInitError = false;
  try {
    await _openAndPreloadNativeOrWeb();

    if (Capacitor.isNativePlatform()) {
      _sqliteReady = true;
    }

    // 4. Signal readiness
    markReady();
  } catch (err) {
    if (Capacitor.isNativePlatform() && isSqliteCorruptionError(err)) {
      console.warn("[Storage] Corruption detected during init, attempting native self-repair & retry:", err);
      try {
        await dbModule.closeDb();
        const { ensureNativeDatabaseHealthy } = await import("./backup/restoreService");
        await ensureNativeDatabaseHealthy(true, 15_000);
        memoryCache.clear();
        parsedCache.clear();
        await _openAndPreloadNativeOrWeb();
        _sqliteReady = true;
        markReady();
        return;
      } catch (retryErr) {
        console.error("[Storage] Init error after self-repair retry:", retryErr);
      }
    } else {
      console.error("[Storage] Init error:", err);
    }
    _sqliteReady = false;
    _sqliteInitError = true;
    // Still signal storage ready so UI can detect hasSQLiteInitError() and handle fail-closed
    markReady();
  }
}

/** Invalidate a specific cache key and refresh from DB */
export async function refreshCache(cacheKey: string, fetchFn: () => Promise<any[]>): Promise<void> {
  try {
    const data = await fetchFn();
    parsedCache.set(cacheKey, data);
    memoryCache.delete(cacheKey);
  } catch (err) {
    console.warn(`[SQLiteStorage] refreshCache failed for ${cacheKey}:`, err);
  }
}

