import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  isNativeMock,
  mockDb,
  getDbMock,
  closeDbMock,
  getAllCustomInvoicesMock,
  getAllCustomersMock,
  getAllOrdersMock,
  getAllPrintInvoicesMock,
  getAllProformaInvoicesMock,
  getAllOfficialLettersMock,
  ensureHealthNativeMock,
} = vi.hoisted(() => ({
  isNativeMock: vi.fn(() => true),
  mockDb: {
    query: vi.fn(async () => ({ values: [] })),
    run: vi.fn(async () => ({ changes: { changes: 0 } })),
  },
  getDbMock: vi.fn(),
  closeDbMock: vi.fn(async () => {}),
  getAllCustomInvoicesMock: vi.fn(async () => []),
  getAllCustomersMock: vi.fn(async () => []),
  getAllOrdersMock: vi.fn(async () => []),
  getAllPrintInvoicesMock: vi.fn(async () => []),
  getAllProformaInvoicesMock: vi.fn(async () => []),
  getAllOfficialLettersMock: vi.fn(async () => []),
  ensureHealthNativeMock: vi.fn(async () => ({
    ok: true,
    status: "repaired" as const,
    salvagedRecords: 5,
    salvagedInvoices: 3,
    salvagedCustomers: 2,
    message: "تم إصلاح قاعدة البيانات",
  })),
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => isNativeMock(),
  },
  registerPlugin: () => ({
    ensureDatabaseHealthy: ensureHealthNativeMock,
  }),
}));

vi.mock("@capacitor/preferences", () => ({
  Preferences: {
    get: vi.fn(async () => ({ value: null })),
    set: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
  },
}));

vi.mock("@/lib/database", () => ({
  getDb: () => getDbMock(),
  closeDb: () => closeDbMock(),
  withDbWriteLock: <T>(fn: () => Promise<T>) => fn(),
}));

vi.mock("@/lib/database/migration", () => ({
  isMigrationDone: vi.fn(async () => true),
  runMigration: vi.fn(async () => ({ migrated: 0, errors: [] })),
}));

vi.mock("@/lib/repositories/CustomInvoiceRepository", () => ({
  getAllCustomInvoices: () => getAllCustomInvoicesMock(),
}));

vi.mock("@/lib/repositories/CustomerRepository", () => ({
  getAllCustomers: () => getAllCustomersMock(),
}));

vi.mock("@/lib/repositories/OrderRepository", () => ({
  getAllOrders: () => getAllOrdersMock(),
}));

vi.mock("@/lib/repositories/PrintInvoiceRepository", () => ({
  getAllPrintInvoices: () => getAllPrintInvoicesMock(),
}));

vi.mock("@/lib/repositories/ProformaRepository", () => ({
  getAllProformaInvoices: () => getAllProformaInvoicesMock(),
}));

vi.mock("@/lib/repositories/OfficialLetterRepository", () => ({
  getAllOfficialLetters: () => getAllOfficialLettersMock(),
}));

vi.mock("./bridge", () => ({
  isBackupEngineAvailable: () => true,
  backupBridge: {
    ensureDatabaseHealthy: ensureHealthNativeMock,
  },
}));

import {
  clearSQLiteMemoryCache,
  getStoredJsonSync,
  hasSQLiteInitError,
  initSQLiteStorage,
  isSQLiteReady,
  isSqliteCorruptionError,
} from "../sqliteStorage";
import { consumeLastDatabaseHealthReport, ensureNativeDatabaseHealthy } from "./restoreService";

describe("SQLite code 11 corruption detection & self-repair", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearSQLiteMemoryCache();
    isNativeMock.mockReturnValue(true);
    getDbMock.mockResolvedValue(mockDb);
  });

  it("recognizes Android SQLite/SQLCipher malformed (code 11) errors accurately", () => {
    expect(isSqliteCorruptionError(new Error("Run: Failed in beginTransactiondatabase disk image is malformed (code 11)"))).toBe(true);
    expect(isSqliteCorruptionError("SQLITE_CORRUPT: file is not a database")).toBe(true);
    expect(isSqliteCorruptionError(new Error("UNIQUE constraint failed"))).toBe(false);
  });

  it("does not silently display 0 customers on code 11 corruption; closes DB, runs native repair, and retries preload", async () => {
    const recoveredCustomer = { id: "cust-1", name: "عميل مسترد", phone: "0912345678", createdAt: "2026-01-01" };

    // First attempt hits code 11 during customer repository preload; second attempt returns salvaged data.
    getAllCustomersMock
      .mockRejectedValueOnce(new Error("Failed in beginTransactiondatabase disk image is malformed (code 11)"))
      .mockResolvedValueOnce([recoveredCustomer] as any);

    await initSQLiteStorage();

    expect(closeDbMock).toHaveBeenCalledTimes(1);
    expect(ensureHealthNativeMock).toHaveBeenCalledWith({ forceRepair: true });
    expect(getDbMock).toHaveBeenCalledTimes(3);
    expect(isSQLiteReady()).toBe(true);
    expect(hasSQLiteInitError()).toBe(false);
    expect(getStoredJsonSync("future_print_customers_v2", [])).toEqual([recoveredCustomer]);
  });

  it("marks SQLite init error cleanly instead of silent empty cache if repair still fails", async () => {
    getAllCustomersMock.mockRejectedValue(new Error("database disk image is malformed (code 11)"));
    ensureHealthNativeMock.mockRejectedValueOnce(new Error("Disk I/O failure"));

    await initSQLiteStorage();

    expect(isSQLiteReady()).toBe(false);
    expect(hasSQLiteInitError()).toBe(true);
  });

  it("records repaired/quarantined native health reports for startup UI toast notification", async () => {
    ensureHealthNativeMock.mockResolvedValueOnce({
      ok: true,
      status: "repaired",
      salvagedRecords: 14,
      salvagedInvoices: 8,
      salvagedCustomers: 6,
      message: "تم إصلاح قاعدة البيانات واستعادة 14 سجل",
    });

    const res = await ensureNativeDatabaseHealthy(false, 5000);
    expect(res?.status).toBe("repaired");
    const notice = consumeLastDatabaseHealthReport();
    expect(notice?.salvagedRecords).toBe(14);
    expect(consumeLastDatabaseHealthReport()).toBeNull();
  });
});
