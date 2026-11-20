/**
 * قائمة الجداول التي تُفحص سلامتها وإحصاءاتها.
 * مشتركة بين فحص السلامة ولوحة المتابعة حتى لا تنحرف قائمة عن أخرى.
 */
export const BACKUP_INTEGRITY_TABLES = [
  "custom_invoices",
  "custom_invoice_items",
  "proforma_invoices",
  "proforma_lines",
  "print_invoices",
  "print_invoice_lines",
  "customers",
  "orders",
  "order_items",
  "projects",
  "suppliers",
  "financial_accounts",
  "customer_payments",
  "customer_payment_allocations",
  "supplier_payments",
  "supplier_payment_allocations",
  "expenses",
  "expense_payments",
  "financial_transactions",
  "document_sequences",
  "audit_log",
  "official_letters",
  "sequences",
  "settings",
  "db_meta",
] as const;

export { DB_VERSION } from "@/lib/database/schema";
