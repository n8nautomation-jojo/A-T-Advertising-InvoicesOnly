/**
 * ═══════════════════════════════════════════════════════════════
 * SQLite Database Schema — T.A Advertising Invoice Management System
 * ═══════════════════════════════════════════════════════════════
 * Version 1 — Initial schema migration from localStorage/SharedPreferences
 * Uses WAL journal mode for crash safety and atomic transactions.
 */

export const DB_NAME = "ta_invoicing_db";
/**
 * الإصدار المنطقي للمخطط — يطابق آخر ترحيل في `migrations/index.ts`
 * (v8: نموذج الأعمال + الترقيم + التسويات + إدارة العملاء + المحاسبة متعددة العملات + الخطابات الرسمية + الحسابات البنكية الأربعة المعيارية).
 */
export const DB_VERSION = 8;

/**
 * Complete DDL for version 1.
 * All statements executed inside a transaction on first launch.
 */
export const CREATE_SCHEMA_V1: string[] = [
  // ── Custom Invoices (Sales / Purchase / Proforma-Billing) ──────────────
  `CREATE TABLE IF NOT EXISTS custom_invoices (
    id              TEXT PRIMARY KEY NOT NULL,
    serial          TEXT NOT NULL,
    type            TEXT NOT NULL DEFAULT 'sales',
    date            TEXT NOT NULL,
    party_name      TEXT NOT NULL DEFAULT '',
    party_en_name   TEXT,
    attn            TEXT,
    phone           TEXT,
    salutation      TEXT,
    closing_note    TEXT,
    account_number  TEXT,
    account_name    TEXT,
    signatory_title TEXT,
    notes           TEXT,
    language        TEXT DEFAULT 'ar',
    currency        TEXT DEFAULT 'SDG',
    total_amount    REAL NOT NULL DEFAULT 0,
    total_in_words  TEXT,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
  )`,

  `CREATE INDEX IF NOT EXISTS idx_custom_invoices_type_serial
     ON custom_invoices(type, serial)`,

  `CREATE INDEX IF NOT EXISTS idx_custom_invoices_date
     ON custom_invoices(date DESC)`,

  `CREATE INDEX IF NOT EXISTS idx_custom_invoices_currency
     ON custom_invoices(currency)`,

  // ── Custom Invoice Items ───────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS custom_invoice_items (
    id          TEXT PRIMARY KEY NOT NULL,
    invoice_id  TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    material    TEXT,
    dimensions  TEXT,
    qty         REAL NOT NULL DEFAULT 1,
    unit_price  REAL,
    total       REAL NOT NULL DEFAULT 0,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (invoice_id) REFERENCES custom_invoices(id) ON DELETE CASCADE
  )`,

  `CREATE INDEX IF NOT EXISTS idx_custom_invoice_items_invoice
     ON custom_invoice_items(invoice_id)`,

  // ── Proforma Invoices (Legacy proforma with area/dimensions) ──────────
  `CREATE TABLE IF NOT EXISTS proforma_invoices (
    id                 TEXT PRIMARY KEY NOT NULL,
    serial             TEXT NOT NULL UNIQUE,
    date               TEXT NOT NULL,
    customer_name      TEXT NOT NULL DEFAULT '',
    customer_en_name   TEXT,
    attn               TEXT,
    phone              TEXT,
    branch             TEXT,
    notes              TEXT,
    validity_days      INTEGER DEFAULT 7,
    account_name       TEXT,
    language           TEXT DEFAULT 'ar',
    currency           TEXT DEFAULT 'SDG',
    status             TEXT DEFAULT 'draft',
    converted_order_id TEXT,
    total_area         REAL DEFAULT 0,
    total_qty          INTEGER DEFAULT 0,
    total_amount       REAL DEFAULT 0,
    total_in_words     TEXT DEFAULT '',
    created_at         TEXT NOT NULL,
    updated_at         TEXT NOT NULL
  )`,

  `CREATE INDEX IF NOT EXISTS idx_proforma_date
     ON proforma_invoices(date DESC)`,

  // ── Proforma Lines ─────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS proforma_lines (
    id           TEXT PRIMARY KEY NOT NULL,
    proforma_id  TEXT NOT NULL,
    description  TEXT NOT NULL DEFAULT '',
    material     TEXT,
    width        REAL DEFAULT 0,
    height       REAL DEFAULT 0,
    qty          INTEGER DEFAULT 1,
    roll_used    TEXT,
    area         REAL DEFAULT 0,
    unit_price   REAL DEFAULT 0,
    total        REAL DEFAULT 0,
    sort_order   INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (proforma_id) REFERENCES proforma_invoices(id) ON DELETE CASCADE
  )`,

  `CREATE INDEX IF NOT EXISTS idx_proforma_lines_proforma
     ON proforma_lines(proforma_id)`,

  // ── Print Invoices (Legacy calculator-generated invoices) ─────────────
  `CREATE TABLE IF NOT EXISTS print_invoices (
    id             TEXT PRIMARY KEY NOT NULL,
    serial         TEXT NOT NULL UNIQUE,
    date           TEXT NOT NULL,
    customer_name  TEXT NOT NULL DEFAULT '',
    phone          TEXT,
    branch         TEXT,
    ship_to        TEXT,
    client_types   TEXT DEFAULT '[]',
    total          REAL DEFAULT 0,
    paid_amount    REAL DEFAULT 0,
    payment_status TEXT DEFAULT 'paid',
    currency       TEXT DEFAULT 'SDG',
    created_at     TEXT NOT NULL
  )`,

  `CREATE INDEX IF NOT EXISTS idx_print_invoices_date
     ON print_invoices(date DESC)`,

  // ── Print Invoice Lines ────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS print_invoice_lines (
    id          TEXT PRIMARY KEY NOT NULL,
    invoice_id  TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    material    TEXT NOT NULL DEFAULT '',
    width       REAL DEFAULT 0,
    height      REAL DEFAULT 0,
    qty         INTEGER DEFAULT 1,
    unit_price  REAL DEFAULT 0,
    total       REAL DEFAULT 0,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (invoice_id) REFERENCES print_invoices(id) ON DELETE CASCADE
  )`,

  `CREATE INDEX IF NOT EXISTS idx_print_invoice_lines_invoice
     ON print_invoice_lines(invoice_id)`,

  // ── Customers ──────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS customers (
    id           TEXT PRIMARY KEY NOT NULL,
    name         TEXT NOT NULL DEFAULT '',
    phone        TEXT,
    type         TEXT DEFAULT 'individual',
    address      TEXT,
    notes        TEXT,
    total_orders INTEGER DEFAULT 0,
    total_spent  REAL DEFAULT 0,
    balance      REAL DEFAULT 0,
    created_at   TEXT NOT NULL
  )`,

  `CREATE INDEX IF NOT EXISTS idx_customers_name
     ON customers(name)`,

  // ── Orders (Kanban production board) ──────────────────────────────────
  `CREATE TABLE IF NOT EXISTS orders (
    id              TEXT PRIMARY KEY NOT NULL,
    order_number    TEXT NOT NULL,
    customer_name   TEXT NOT NULL DEFAULT '',
    customer_phone  TEXT,
    client_type     TEXT DEFAULT 'takeaway',
    status          TEXT DEFAULT 'new',
    priority        TEXT DEFAULT 'normal',
    created_at      TEXT NOT NULL,
    delivery_date   TEXT,
    total_area      REAL DEFAULT 0,
    total_cost      REAL DEFAULT 0,
    paid_amount     REAL DEFAULT 0,
    branch          TEXT,
    notes           TEXT,
    invoice_serial  TEXT
  )`,

  `CREATE INDEX IF NOT EXISTS idx_orders_status
     ON orders(status)`,

  `CREATE INDEX IF NOT EXISTS idx_orders_date
     ON orders(created_at DESC)`,

  // ── Order Items ────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS order_items (
    id          TEXT PRIMARY KEY NOT NULL,
    order_id    TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    material    TEXT,
    width       REAL DEFAULT 0,
    height      REAL DEFAULT 0,
    qty         INTEGER DEFAULT 1,
    roll_used   TEXT,
    area        REAL DEFAULT 0,
    unit_price  REAL DEFAULT 0,
    total       REAL DEFAULT 0,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
  )`,

  `CREATE INDEX IF NOT EXISTS idx_order_items_order
     ON order_items(order_id)`,

  // ── Sequences / Counters ───────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS sequences (
    key   TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL DEFAULT ''
  )`,

  // ── App Settings ───────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL DEFAULT ''
  )`,

  // ── Schema Version Tracker ─────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS db_meta (
    key   TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL DEFAULT ''
  )`,

  `INSERT OR IGNORE INTO db_meta(key, value) VALUES('schema_version', '1')`,
  `INSERT OR IGNORE INTO db_meta(key, value) VALUES('created_at', datetime('now'))`,
];

/** Keys used in the sequences table */
export const SEQ_KEYS = {
  INVOICE: "future_invoice_seq",
  PROFORMA: "future_proforma_seq",
} as const;

/** Keys used in the settings table */
export const SETTINGS_KEYS = {
  PASSWORD_HASH: "future_calc_app_password_hash",
  SOUND_ENABLED: "future_print_sound_enabled",
  MIGRATION_DONE: "sqlite_migration_done",
  USER_PROFILE: "future_user_profile",
  LICENSE: "future_license_key",
} as const;

/**
 * ═══════════════════════════════════════════════════════════════
 * Schema v2 — business model (PRD §14) + document numbering
 * ═══════════════════════════════════════════════════════════════
 * Purely additive: no v1 table is dropped or rewritten here. Column additions
 * on existing tables live in the versioned migration (SQLite has no
 * "ADD COLUMN IF NOT EXISTS"), together with the reference backfill.
 *
 * Status columns are stored as text codes whose allowed values are defined in
 * the domain layer, so the database never invents its own vocabulary.
 */
export const CREATE_SCHEMA_V2: string[] = [
  // @deprecated: Projects module removed; retained inert for backward-compatible restores
  `CREATE TABLE IF NOT EXISTS projects (
    id                 TEXT PRIMARY KEY NOT NULL,
    reference          TEXT NOT NULL UNIQUE,
    customer_id        TEXT,
    title              TEXT NOT NULL DEFAULT '',
    description        TEXT,
    request_notes      TEXT,
    execution_status   TEXT NOT NULL DEFAULT 'new',
    financial_status   TEXT NOT NULL DEFAULT 'not_invoiced',
    delivery_date      TEXT,
    created_at         TEXT NOT NULL,
    updated_at         TEXT NOT NULL,
    cancelled_at       TEXT,
    cancellation_reason TEXT
  )`,

  `CREATE INDEX IF NOT EXISTS idx_projects_customer ON projects(customer_id)`,
  `CREATE INDEX IF NOT EXISTS idx_projects_execution_status ON projects(execution_status)`,
  `CREATE INDEX IF NOT EXISTS idx_projects_financial_status ON projects(financial_status)`,

  // ── Suppliers (PRD §7.1) ───────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS suppliers (
    id           TEXT PRIMARY KEY NOT NULL,
    name         TEXT NOT NULL DEFAULT '',
    phone        TEXT,
    email        TEXT,
    address      TEXT,
    notes        TEXT,
    created_at   TEXT NOT NULL,
    cancelled_at TEXT
  )`,

  `CREATE INDEX IF NOT EXISTS idx_suppliers_name ON suppliers(name)`,

  // ── Financial accounts (PRD §10) ───────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS financial_accounts (
    id              TEXT PRIMARY KEY NOT NULL,
    name            TEXT NOT NULL DEFAULT '',
    kind            TEXT NOT NULL DEFAULT 'cash',
    opening_balance REAL NOT NULL DEFAULT 0,
    is_active       INTEGER NOT NULL DEFAULT 1,
    notes           TEXT,
    created_at      TEXT NOT NULL
  )`,

  // ── Customer collections (PRD §6) ──────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS customer_payments (
    id                  TEXT PRIMARY KEY NOT NULL,
    reference           TEXT UNIQUE,
    customer_id         TEXT NOT NULL,
    project_id          TEXT,
    amount              REAL NOT NULL DEFAULT 0,
    paid_at             TEXT NOT NULL,
    method              TEXT NOT NULL DEFAULT 'cash',
    account_id          TEXT,
    transaction_ref     TEXT,
    notes               TEXT,
    created_at          TEXT NOT NULL,
    cancelled_at        TEXT,
    cancellation_reason TEXT
  )`,

  `CREATE INDEX IF NOT EXISTS idx_customer_payments_customer ON customer_payments(customer_id)`,
  `CREATE INDEX IF NOT EXISTS idx_customer_payments_project ON customer_payments(project_id)`,
  `CREATE INDEX IF NOT EXISTS idx_customer_payments_date ON customer_payments(paid_at)`,

  // Explicit allocation of one payment across invoices (PRD §4.2)
  `CREATE TABLE IF NOT EXISTS customer_payment_allocations (
    id         TEXT PRIMARY KEY NOT NULL,
    payment_id TEXT NOT NULL,
    invoice_id TEXT NOT NULL,
    amount     REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    FOREIGN KEY (payment_id) REFERENCES customer_payments(id) ON DELETE CASCADE,
    FOREIGN KEY (invoice_id) REFERENCES custom_invoices(id) ON DELETE RESTRICT
  )`,

  `CREATE INDEX IF NOT EXISTS idx_cpa_payment ON customer_payment_allocations(payment_id)`,
  `CREATE INDEX IF NOT EXISTS idx_cpa_invoice ON customer_payment_allocations(invoice_id)`,

  // ── Supplier payments (PRD §7.3) ───────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS supplier_payments (
    id                  TEXT PRIMARY KEY NOT NULL,
    reference           TEXT UNIQUE,
    supplier_id         TEXT NOT NULL,
    project_id          TEXT,
    amount              REAL NOT NULL DEFAULT 0,
    paid_at             TEXT NOT NULL,
    method              TEXT NOT NULL DEFAULT 'cash',
    account_id          TEXT,
    transaction_ref     TEXT,
    notes               TEXT,
    created_at          TEXT NOT NULL,
    cancelled_at        TEXT,
    cancellation_reason TEXT
  )`,

  `CREATE INDEX IF NOT EXISTS idx_supplier_payments_supplier ON supplier_payments(supplier_id)`,
  `CREATE INDEX IF NOT EXISTS idx_supplier_payments_project ON supplier_payments(project_id)`,
  `CREATE INDEX IF NOT EXISTS idx_supplier_payments_date ON supplier_payments(paid_at)`,

  `CREATE TABLE IF NOT EXISTS supplier_payment_allocations (
    id         TEXT PRIMARY KEY NOT NULL,
    payment_id TEXT NOT NULL,
    invoice_id TEXT NOT NULL,
    amount     REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    FOREIGN KEY (payment_id) REFERENCES supplier_payments(id) ON DELETE CASCADE,
    FOREIGN KEY (invoice_id) REFERENCES custom_invoices(id) ON DELETE RESTRICT
  )`,

  `CREATE INDEX IF NOT EXISTS idx_spa_payment ON supplier_payment_allocations(payment_id)`,
  `CREATE INDEX IF NOT EXISTS idx_spa_invoice ON supplier_payment_allocations(invoice_id)`,

  // ── Expenses: direct project costs vs operating (PRD §7.4, §7.5) ───────
  `CREATE TABLE IF NOT EXISTS expenses (
    id                  TEXT PRIMARY KEY NOT NULL,
    kind                TEXT NOT NULL DEFAULT 'direct',
    project_id          TEXT,
    supplier_id         TEXT,
    beneficiary         TEXT,
    category            TEXT,
    amount              REAL NOT NULL DEFAULT 0,
    expense_date        TEXT NOT NULL,
    method              TEXT,
    account_id          TEXT,
    evidence_ref        TEXT,
    notes               TEXT,
    created_at          TEXT NOT NULL,
    cancelled_at        TEXT,
    cancellation_reason TEXT
  )`,

  `CREATE INDEX IF NOT EXISTS idx_expenses_project ON expenses(project_id)`,
  `CREATE INDEX IF NOT EXISTS idx_expenses_kind ON expenses(kind)`,
  `CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(expense_date)`,

  // ── Authoritative money movements (PRD §10) ────────────────────────────
  `CREATE TABLE IF NOT EXISTS financial_transactions (
    id                 TEXT PRIMARY KEY NOT NULL,
    kind               TEXT NOT NULL,
    amount             REAL NOT NULL DEFAULT 0,
    occurred_at        TEXT NOT NULL,
    account_id         TEXT NOT NULL,
    counter_account_id TEXT,
    source_type        TEXT,
    source_id          TEXT,
    project_id         TEXT,
    reference_note     TEXT,
    notes              TEXT,
    created_at         TEXT NOT NULL,
    reversed_by        TEXT,
    FOREIGN KEY (account_id) REFERENCES financial_accounts(id) ON DELETE RESTRICT
  )`,

  `CREATE INDEX IF NOT EXISTS idx_fin_tx_account ON financial_transactions(account_id)`,
  `CREATE INDEX IF NOT EXISTS idx_fin_tx_occurred ON financial_transactions(occurred_at)`,
  `CREATE INDEX IF NOT EXISTS idx_fin_tx_source ON financial_transactions(source_type, source_id)`,
  `CREATE INDEX IF NOT EXISTS idx_fin_tx_project ON financial_transactions(project_id)`,

  // ── Atomic document numbering (PRD §5.3.2) ─────────────────────────────
  `CREATE TABLE IF NOT EXISTS document_sequences (
    scope       TEXT NOT NULL,
    date_key    TEXT NOT NULL,
    last_number INTEGER NOT NULL DEFAULT 0,
    updated_at  TEXT NOT NULL,
    PRIMARY KEY (scope, date_key)
  )`,

  // ── Audit trail — no silent destruction (PRD §12.7) ────────────────────
  `CREATE TABLE IF NOT EXISTS audit_log (
    id          TEXT PRIMARY KEY NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id   TEXT NOT NULL,
    action      TEXT NOT NULL,
    reason      TEXT,
    details     TEXT,
    created_at  TEXT NOT NULL
  )`,

  `CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity_type, entity_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC)`,
];

/**
 * Indexes that depend on columns added by the v2 migration.
 * They MUST run after those columns exist: creating a partial/plain index on a
 * missing column fails, and silently losing `idx_custom_invoices_reference`
 * would remove the database-level guarantee that two invoices never share a
 * reference (PRD §5.3.2).
 */
export const CREATE_SCHEMA_V2_COLUMN_INDEXES: string[] = [
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_custom_invoices_reference
     ON custom_invoices(reference) WHERE reference IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_custom_invoices_project ON custom_invoices(project_id)`,
  `CREATE INDEX IF NOT EXISTS idx_custom_invoices_customer ON custom_invoices(customer_id)`,
  `CREATE INDEX IF NOT EXISTS idx_custom_invoices_supplier ON custom_invoices(supplier_id)`,
  `CREATE INDEX IF NOT EXISTS idx_custom_invoices_type_cancelled ON custom_invoices(type, cancelled_at)`,
  `CREATE INDEX IF NOT EXISTS idx_custom_invoices_type_cancelled_date ON custom_invoices(type, cancelled_at, date DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_cpa_invoice_amount ON customer_payment_allocations(invoice_id, amount)`,
  `CREATE INDEX IF NOT EXISTS idx_spa_invoice_amount ON supplier_payment_allocations(invoice_id, amount)`,
  `CREATE INDEX IF NOT EXISTS idx_customer_payments_active_date ON customer_payments(cancelled_at, paid_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_supplier_payments_active_date ON supplier_payments(cancelled_at, paid_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_expenses_project_kind_cancelled ON expenses(project_id, kind, cancelled_at)`,
];

/** Columns added to existing tables by the v2 migration (idempotent, guarded). */
export const V2_ADDED_COLUMNS: Record<string, { name: string; ddl: string }[]> = {
  custom_invoices: [
    { name: "reference", ddl: "TEXT" },
    { name: "reference_assigned_at", ddl: "TEXT" },
    { name: "project_id", ddl: "TEXT" },
    { name: "customer_id", ddl: "TEXT" },
    { name: "due_date", ddl: "TEXT" },
    { name: "discount", ddl: "REAL NOT NULL DEFAULT 0" },
    { name: "subtotal", ddl: "REAL NOT NULL DEFAULT 0" },
    { name: "supplier_id", ddl: "TEXT" },
    { name: "supplier_invoice_number", ddl: "TEXT" },
    { name: "cancelled_at", ddl: "TEXT" },
    { name: "cancellation_reason", ddl: "TEXT" },
    { name: "currency", ddl: "TEXT DEFAULT 'SDG'" },
  ],
  customers: [],
  orders: [{ name: "project_id", ddl: "TEXT" }],
  proforma_invoices: [
    { name: "project_id", ddl: "TEXT" },
    { name: "currency", ddl: "TEXT DEFAULT 'SDG'" },
  ],
  print_invoices: [
    { name: "currency", ddl: "TEXT DEFAULT 'SDG'" },
  ],
};

/**
 * ═══════════════════════════════════════════════════════════════
 * Schema v3 — settlements for expenses (PRD §7.5)
 * ═══════════════════════════════════════════════════════════════
 * Recording an expense never means it was paid, so the actual disbursement is
 * stored as its own transaction, exactly like customer and supplier payments.
 */
export const CREATE_SCHEMA_V3: string[] = [
  `CREATE TABLE IF NOT EXISTS expense_payments (
    id                  TEXT PRIMARY KEY NOT NULL,
    reference           TEXT UNIQUE,
    expense_id          TEXT NOT NULL,
    amount              REAL NOT NULL DEFAULT 0,
    paid_at             TEXT NOT NULL,
    method              TEXT NOT NULL DEFAULT 'cash',
    account_id          TEXT,
    transaction_ref     TEXT,
    notes               TEXT,
    created_at          TEXT NOT NULL,
    cancelled_at        TEXT,
    cancellation_reason TEXT,
    FOREIGN KEY (expense_id) REFERENCES expenses(id) ON DELETE RESTRICT
  )`,

  `CREATE INDEX IF NOT EXISTS idx_expense_payments_expense ON expense_payments(expense_id)`,
  `CREATE INDEX IF NOT EXISTS idx_expense_payments_date ON expense_payments(paid_at)`,
];

/**
 * ═══════════════════════════════════════════════════════════════
 * Schema v6 — Multi-Currency Accounting & Composite Indexes
 * ═══════════════════════════════════════════════════════════════
 * Purely additive: ensures every financial table carries an explicit ISO
 * currency code (defaulting to `'SDG'`) and adds missing composite indexes.
 */
export const V6_ADDED_COLUMNS: Record<string, { name: string; ddl: string }[]> = {
  financial_accounts: [{ name: "currency", ddl: "TEXT NOT NULL DEFAULT 'SDG'" }],
  financial_transactions: [{ name: "currency", ddl: "TEXT NOT NULL DEFAULT 'SDG'" }],
  supplier_payments: [{ name: "currency", ddl: "TEXT NOT NULL DEFAULT 'SDG'" }],
  expenses: [{ name: "currency", ddl: "TEXT NOT NULL DEFAULT 'SDG'" }],
  expense_payments: [{ name: "currency", ddl: "TEXT NOT NULL DEFAULT 'SDG'" }],
  orders: [{ name: "currency", ddl: "TEXT NOT NULL DEFAULT 'SDG'" }],
};

export const CREATE_SCHEMA_V6_INDEXES: string[] = [
  `CREATE INDEX IF NOT EXISTS idx_fin_tx_account_rev ON financial_transactions(account_id, reversed_by)`,
  `CREATE INDEX IF NOT EXISTS idx_fin_tx_kind_rev ON financial_transactions(kind, reversed_by)`,
  `CREATE INDEX IF NOT EXISTS idx_expense_payments_exp_cancel ON expense_payments(expense_id, cancelled_at)`,
  `CREATE INDEX IF NOT EXISTS idx_customers_archived_name ON customers(is_archived, name)`,
  `CREATE INDEX IF NOT EXISTS idx_fin_tx_currency ON financial_transactions(currency)`,
  `CREATE INDEX IF NOT EXISTS idx_expenses_currency ON expenses(currency)`,
  `CREATE INDEX IF NOT EXISTS idx_supplier_payments_currency ON supplier_payments(currency)`,
];

/**
 * ═══════════════════════════════════════════════════════════════
 * Schema v7 — Official Corporate Letters (`official_letters`)
 * ═══════════════════════════════════════════════════════════════
 * Purely additive: dedicated SQLite table for bilingual official letters,
 * replacing the capped JSON blob previously stored in `settings`.
 */
export const CREATE_SCHEMA_V7: string[] = [
  `CREATE TABLE IF NOT EXISTS official_letters (
    id                  TEXT PRIMARY KEY NOT NULL,
    reference           TEXT NOT NULL,
    language            TEXT NOT NULL DEFAULT 'ar',
    date                TEXT NOT NULL,
    show_letter_title   INTEGER NOT NULL DEFAULT 0,
    letter_title        TEXT NOT NULL DEFAULT '',
    recipient_honorific TEXT NOT NULL DEFAULT '',
    recipient_name      TEXT NOT NULL DEFAULT '',
    recipient_title     TEXT,
    salutation          TEXT NOT NULL DEFAULT '',
    subject             TEXT NOT NULL DEFAULT '',
    body                TEXT NOT NULL DEFAULT '',
    closing_phrase      TEXT NOT NULL DEFAULT '',
    signatory_name      TEXT NOT NULL DEFAULT '',
    signatory_title     TEXT NOT NULL DEFAULT '',
    include_signature   INTEGER NOT NULL DEFAULT 1,
    include_stamp       INTEGER NOT NULL DEFAULT 1,
    include_qr          INTEGER NOT NULL DEFAULT 1,
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL
  )`,

  `CREATE INDEX IF NOT EXISTS idx_official_letters_date ON official_letters(date DESC, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_official_letters_reference ON official_letters(reference)`,
];

/** Default account so recording a payment never blocks on setup (PRD §13.2). */
export const DEFAULT_CASH_ACCOUNT = {
  id: "acc-cash-default",
  name: "الصندوق النقدي",
  kind: "cash",
} as const;

/**
 * ═══════════════════════════════════════════════════════════════
 * Schema v8 — Canonical 4-Currency Bank / Treasury Accounts
 * ═══════════════════════════════════════════════════════════════
 */
export const V8_ADDED_COLUMNS: Record<string, Array<{ name: string; ddl: string }>> = {
  financial_accounts: [
    { name: "currency", ddl: "TEXT NOT NULL DEFAULT 'SDG'" },
    { name: "account_number", ddl: "TEXT" },
  ],
};

export const STANDARD_CURRENCY_ACCOUNTS = [
  {
    id: DEFAULT_CASH_ACCOUNT.id,
    name: DEFAULT_CASH_ACCOUNT.name,
    kind: DEFAULT_CASH_ACCOUNT.kind,
    currency: "SDG",
    defaultAccountNumber: "3283046",
  },
  {
    id: "acc-bank-usd",
    name: "حساب الدولار الأمريكي",
    kind: "bank",
    currency: "USD",
    defaultAccountNumber: "",
  },
  {
    id: "acc-bank-sar",
    name: "حساب الريال السعودي",
    kind: "bank",
    currency: "SAR",
    defaultAccountNumber: "",
  },
  {
    id: "acc-bank-egp",
    name: "حساب الجنيه المصري",
    kind: "bank",
    currency: "EGP",
    defaultAccountNumber: "",
  },
] as const;


