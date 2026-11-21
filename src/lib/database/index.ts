/**
 * ═══════════════════════════════════════════════════════════════
 * SQLite Database Connection — T.A Advertising Invoice System
 * ═══════════════════════════════════════════════════════════════
 * Singleton connection manager using @capacitor-community/sqlite v7
 * Enables WAL mode for crash safety + foreign key enforcement
 */

import { CapacitorSQLite, SQLiteConnection, SQLiteDBConnection } from "@capacitor-community/sqlite";
import { Capacitor } from "@capacitor/core";
import { DB_NAME, DB_VERSION, CREATE_SCHEMA_V1 } from "./schema";
import { withDbWriteLock } from "./writeLock";

export { withDbWriteLock };

const sqlite = new SQLiteConnection(CapacitorSQLite);
let _db: SQLiteDBConnection | null = null;
let _initPromise: Promise<SQLiteDBConnection> | null = null;
let _closingPromise: Promise<void> | null = null;
let _connEpoch = 0;

/**
 * Acquires the FIFO write lock, starts an explicit SQLite transaction,
 * executes `fn(db)`, and commits on success or rolls back on error.
 * Statements executed inside `fn` MUST pass `transaction = false` to `db.run(...)`.
 */
export function withDbTransaction<T>(
  fn: (db: SQLiteDBConnection) => Promise<T>
): Promise<T> {
  return withDbWriteLock(async () => {
    const db = await getDb();
    await db.beginTransaction();
    try {
      const result = await fn(db);
      await db.commitTransaction();
      return result;
    } catch (err) {
      const msg = (err instanceof Error ? err.message : String(err ?? "")).toLowerCase();
      if (msg.includes("malformed") || msg.includes("code 11") || msg.includes("sqlite_corrupt")) {
        console.error("[DB] Transaction hit SQLite corruption:", err);
      }
      try {
        await db.rollbackTransaction();
      } catch (rollbackErr) {
        console.warn("[DB] Transaction rollback warning:", rollbackErr);
      }
      throw err;
    }
  });
}

/**
 * Returns the singleton DB connection, initializing it on first call.
 * All callers await this — it is safe to call concurrently.
 */
export async function getDb(): Promise<SQLiteDBConnection> {
  while (_closingPromise) {
    await _closingPromise;
  }
  if (_db) return _db;
  if (_initPromise) return _initPromise;

  const epoch = ++_connEpoch;
  const promise = _initialize(epoch);
  _initPromise = promise;
  try {
    const db = await promise;
    // If closeDb() ran while _initialize() was in flight, _connEpoch advanced;
    // never assign a closed/stale connection back to _db.
    if (_connEpoch !== epoch) {
      throw new Error("Database connection was closed during initialization.");
    }
    _db = db;
    return db;
  } catch (err) {
    if (_initPromise === promise) {
      _initPromise = null;
    }
    throw err;
  }
}

async function _initialize(epoch: number): Promise<SQLiteDBConnection> {
  // Web / browser fallback: use in-memory mock (dev only)
  if (!Capacitor.isNativePlatform()) {
    console.warn("[DB] Running in browser — SQLite not available; using no-op mode.");
    throw new Error("SQLite only available on native Android platform.");
  }

  try {
    // Check if connection already exists
    const isConn = (await sqlite.isConnection(DB_NAME, false)).result;

    let db: SQLiteDBConnection;
    if (isConn) {
      db = await sqlite.retrieveConnection(DB_NAME, false);
    } else {
      db = await sqlite.createConnection(DB_NAME, false, "no-encryption", DB_VERSION, false);
    }

    await db.open();

    // PRAGMAs that return result rows (notably journal_mode=WAL and busy_timeout)
    // MUST run via db.query() on Android SQLCipher; db.execute() maps to execSQL(),
    // which throws "Queries can be performed using SQLiteDatabase.query or rawQuery methods only".
    for (const pragma of [
      "PRAGMA journal_mode=WAL;",
      "PRAGMA foreign_keys=ON;",
      "PRAGMA synchronous=NORMAL;",
      "PRAGMA busy_timeout=5000;",
    ]) {
      try {
        await db.query(pragma);
      } catch (pragmaErr) {
        console.warn(`[DB] ${pragma} warning:`, pragmaErr);
      }
    }

    // Create schema if not exists (idempotent)
    await _ensureSchema(db);

    // Apply versioned migrations (v2 business model + document references).
    // Runs before any UI or store reads data, and never throws for a recoverable
    // problem: a failed step keeps the recorded version so the next launch retries.
    try {
      const { runPendingMigrations } = await import("./migrations");
      const outcome = await runPendingMigrations(db);
      if (outcome.applied.length > 0) {
        console.info("[DB] Migrations applied:", outcome.applied.join(" | "));
      }
      if (outcome.warnings.length > 0) {
        console.warn("[DB] Migration warnings:", outcome.warnings);
      }
    } catch (err) {
      console.error("[DB] Migration runner failed:", err);
    }

    console.info("[DB] SQLite database initialized:", DB_NAME, "v" + DB_VERSION);
    return db;
  } catch (err) {
    if (_connEpoch === epoch) {
      _initPromise = null;
      _db = null;
    }
    throw err;
  }
}

async function _ensureSchema(db: SQLiteDBConnection): Promise<void> {
  // Execute all CREATE TABLE / INDEX statements atomically in a single batch
  const batch = CREATE_SCHEMA_V1.join(";\n") + ";";
  try {
    await db.execute(batch, true);
  } catch {
    // Fallback: execute individually if any single statement warns
    for (const stmt of CREATE_SCHEMA_V1) {
      try {
        await db.execute(stmt + ";", false);
      } catch (err) {
        console.warn("[DB] Schema statement warning:", err, "\nStatement:", stmt.slice(0, 80));
      }
    }
  }
}

/**
 * Close the connection (call on app termination if needed).
 */
export async function closeDb(): Promise<void> {
  // Advance epoch immediately so any in-flight getDb() sees it was superseded.
  _connEpoch++;
  const pendingInit = _initPromise;
  _db = null;
  _initPromise = null;

  const doClose = async () => {
    if (pendingInit) {
      try {
        await pendingInit;
      } catch {}
    }
    if (!Capacitor.isNativePlatform()) return;
    try {
      const isConn = (await sqlite.isConnection(DB_NAME, false)).result;
      if (isConn) {
        await sqlite.closeConnection(DB_NAME, false);
      }
    } catch {}
  };

  const prevClose = _closingPromise;
  const currentClose = (prevClose ? prevClose.then(doClose, doClose) : doClose()).finally(() => {
    if (_closingPromise === currentClose) {
      _closingPromise = null;
    }
  });
  _closingPromise = currentClose;
  return currentClose;
}

