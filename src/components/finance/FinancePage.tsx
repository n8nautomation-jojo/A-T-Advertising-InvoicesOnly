import React, { useCallback, useEffect, useState } from "react";
import {
  ArrowLeftRight,
  ArrowRight,
  Loader2,
  Plus,
  Receipt,
  RefreshCw,
  Wallet,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { PageShell } from "@/components/layout/PageShell";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { createAccount, getAccountBalances, getDefaultAccountId } from "@/lib/repositories/FinancialAccountRepository";
import {
  getCashSummary,
  getCompanyProfitability,
  getCustomerReceipts,
  getMoneyMovements,
  getOpenSalesInvoices,
  getPayablesSummary,
  getReceivablesSummary,
  getSupplierPayments,
  type CashSummary,
  type CustomerReceiptRow,
  type MoneyMovement,
  type OpenSalesInvoiceRow,
  type PayablesSummary,
  type ReceivablesSummary,
  type SupplierPaymentRow,
} from "@/lib/repositories/LedgerRepository";
import { cancelPayment } from "@/lib/repositories/PaymentRepository";
import {
  LEDGER_KIND_LABELS,
  PAYMENT_METHOD_LABELS,
  type AccountBalanceReport,
  type AccountKind,
  type CompanyProfitability,
  type PaymentMethod,
} from "@/lib/domain/finance";
import { notifyFinanceUpdated, refreshSettlements } from "@/lib/financeStore";
import { formatNumber } from "@/lib/printCalculator";
import { CurrencySelector } from "@/components/currency/CurrencySelector";
import { DEFAULT_CURRENCY, SUPPORTED_CURRENCIES, type AppCurrency } from "@/lib/currency/types";
import { ReceiptDialog } from "./ReceiptDialog";
import { SupplierPaymentDialog } from "./SupplierPaymentDialog";
import { TransferDialog } from "./TransferDialog";
import { ExpenseDialog } from "./ExpenseDialog";
import {
  CancelPaymentAlertDialog,
  List,
  Metric,
  type CancelTarget,
} from "./FinancePrimitives";
import { FinanceOverviewTab } from "./FinanceOverviewTab";
import { FinanceAccountsTab } from "./FinanceAccountsTab";

type FinanceTab = "overview" | "accounts" | "receipts" | "payments" | "ledger";

/**
 * صفحة المالية (PRD §8، §10، §11): النقد الفعلي، الذمم، الربحية، والحركات.
 * الأرقام الثلاثة (الربحية/التحصيل/السيولة) معروضة منفصلة دائماً ولا تُدمج.
 */
export function FinancePage() {
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<FinanceTab>("overview");
  const [currency, setCurrency] = useState<AppCurrency>(DEFAULT_CURRENCY);
  const [accounts, setAccounts] = useState<AccountBalanceReport[]>([]);
  const [cash, setCash] = useState<CashSummary | null>(null);
  const [receivables, setReceivables] = useState<ReceivablesSummary | null>(null);
  const [payables, setPayables] = useState<PayablesSummary | null>(null);
  const [profitability, setProfitability] = useState<CompanyProfitability | null>(null);
  const [movements, setMovements] = useState<MoneyMovement[]>([]);
  const [receipts, setReceipts] = useState<CustomerReceiptRow[]>([]);
  const [supplierPayments, setSupplierPayments] = useState<SupplierPaymentRow[]>([]);
  const [openInvoices, setOpenInvoices] = useState<OpenSalesInvoiceRow[]>([]);

  const [receiptOpen, setReceiptOpen] = useState(false);
  const [receiptInvoiceId, setReceiptInvoiceId] = useState<string | null>(null);
  const [supplierOpen, setSupplierOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [expenseOpen, setExpenseOpen] = useState(false);

  const [newAccountName, setNewAccountName] = useState("");
  const [newAccountKind, setNewAccountKind] = useState<AccountKind>("bank");
  const [newAccountCurrency, setNewAccountCurrency] = useState<AppCurrency>(DEFAULT_CURRENCY);
  const [creatingAccount, setCreatingAccount] = useState(false);

  const [cancelTarget, setCancelTarget] = useState<CancelTarget | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelling, setCancelling] = useState(false);

  const currencyLabel =
    currency === "SDG" ? "ج.س" : SUPPORTED_CURRENCIES[currency]?.symbol ?? currency;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      let [
        accountReports,
        cashSummary,
        recv,
        pay,
        profit,
        moves,
        receiptRows,
        supplierRows,
        openSales,
      ] = await Promise.all([
        getAccountBalances(),
        getCashSummary(currency),
        getReceivablesSummary(undefined, currency),
        getPayablesSummary(currency),
        getCompanyProfitability(currency),
        getMoneyMovements(60, currency),
        getCustomerReceipts(60, currency),
        getSupplierPayments(60, currency),
        getOpenSalesInvoices(100, currency),
      ]);
      if (accountReports.length === 0) {
        await getDefaultAccountId();
        accountReports = await getAccountBalances();
      }
      setAccounts(accountReports);
      setCash(cashSummary);
      setReceivables(recv);
      setPayables(pay);
      setProfitability(profit);
      setMovements(moves);
      setReceipts(receiptRows);
      setSupplierPayments(supplierRows);
      setOpenInvoices(openSales);
    } catch (err) {
      console.error("[FinancePage] load failed:", err);
      toast.error("تعذّر تحميل البيانات المالية");
    } finally {
      setLoading(false);
    }
  }, [currency]);

  useEffect(() => {
    void load();
    void refreshSettlements();
    const onRefresh = () => {
      void load();
    };
    window.addEventListener("native-storage-ready", onRefresh);
    window.addEventListener("finance-changed", onRefresh);
    return () => {
      window.removeEventListener("native-storage-ready", onRefresh);
      window.removeEventListener("finance-changed", onRefresh);
    };
  }, [load]);

  const openReceiptDialog = (invoiceId: string | null = null) => {
    setReceiptInvoiceId(invoiceId);
    setReceiptOpen(true);
  };

  const handleCreateAccount = async () => {
    if (!newAccountName.trim()) {
      toast.error("اسم الحساب مطلوب");
      return;
    }
    setCreatingAccount(true);
    try {
      await createAccount({
        name: newAccountName,
        kind: newAccountKind,
        currency: newAccountCurrency,
      });
      setNewAccountName("");
      toast.success("تم إنشاء الحساب المالي");
      await notifyFinanceUpdated();
    } catch (err) {
      toast.error("تعذّر إنشاء الحساب", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setCreatingAccount(false);
    }
  };

  const handleConfirmCancel = async () => {
    if (!cancelTarget) return;
    setCancelling(true);
    try {
      await cancelPayment(cancelTarget.kind, cancelTarget.id, cancelReason.trim() || null);
      toast.success(`تم إلغاء ${cancelTarget.reference || "السند"} وعكس أثره المالي`);
      setCancelTarget(null);
      setCancelReason("");
      await notifyFinanceUpdated();
    } catch (err) {
      toast.error("تعذّر إلغاء السند", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setCancelling(false);
    }
  };

  return (
    <PageShell>
      <main
        className="w-full flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-3 py-3 md:px-6 md:py-5 min-w-0 scroll-smooth touch-pan-y pb-36 md:pb-16"
        dir="rtl"
      >
        <div className="mx-auto max-w-7xl space-y-3.5 w-full">
          {/* 1. ترويسة الصفحة التنفيذية */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-card/90 backdrop-blur-md p-3.5 sm:p-4 rounded-2xl border border-border/70 shadow-2xs border-r-4 border-r-primary">
            <div className="flex items-start gap-2.5">
              <Link
                to="/"
                aria-label="رجوع"
                className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-border bg-secondary text-foreground transition-all hover:border-primary/40 hover:text-primary active:scale-95 touch-manipulation"
              >
                <ArrowRight className="h-4 w-4" />
              </Link>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary/10 text-primary border border-primary/20 shrink-0">
                    <Wallet className="h-4 w-4" />
                  </span>
                  <h1 className="text-base sm:text-lg font-black text-foreground tracking-tight">
                    الإدارة المالية والخزينة
                  </h1>
                  <span className="text-[11px] font-mono font-black text-primary px-2.5 py-0.5 rounded-full bg-primary/10 border border-primary/20 tabular-nums shrink-0">
                    {accounts.length} حساب
                  </span>
                </div>
                <p className="text-[11px] sm:text-xs text-muted-foreground font-medium mt-1">
                  النقد الفعلي المتاح، ذمم العملاء والموردين، الربحية التشغيلية وسجل الحركات المالية
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap self-end sm:self-center">
              <CurrencySelector
                label="العملة:"
                dropdownTitle="اختر عملة العرض"
                value={currency}
                onChange={(c) => {
                  setCurrency(c);
                  setNewAccountCurrency(c);
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void load()}
                disabled={loading}
                aria-label="تحديث"
                className="h-8 px-3 rounded-xl gap-1.5 text-xs font-bold text-muted-foreground"
              >
                <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
                <span>تحديث</span>
              </Button>
            </div>
          </div>

          {/* 2. ثلاث مقاييس منفصلة كما تفرضه المواصفات — لا دمج */}
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            <Metric
              label="النقد الفعلي المتاح"
              value={formatNumber(cash?.liquidity ?? 0)}
              currencyLabel={currencyLabel}
              tone="primary"
              icon={<Wallet className="h-3.5 w-3.5" />}
              className="col-span-2 sm:col-span-1"
              onClick={() => setActiveTab("accounts")}
            />
            <Metric
              label="ذمم العملاء (لك)"
              value={formatNumber(receivables?.outstanding ?? 0)}
              currencyLabel={currencyLabel}
              tone="warn"
              onClick={() => setActiveTab("receipts")}
            />
            <Metric
              label="مستحق للموردين (عليك)"
              value={formatNumber(payables?.outstanding ?? 0)}
              currencyLabel={currencyLabel}
              tone="danger"
              onClick={() => setActiveTab("payments")}
            />
          </div>

          {/* 3. أزرار العمليات السريعة */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Button
              type="button"
              onClick={() => openReceiptDialog(null)}
              className="h-10 rounded-xl gap-1.5 text-xs font-black bg-primary hover:bg-primary/90 text-white shadow-xs shadow-primary/20"
            >
              <Receipt className="h-4 w-4" />
              <span>تحصيل دفعة من عميل</span>
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setSupplierOpen(true)}
              className="h-10 rounded-xl gap-1.5 text-xs font-black border-border/70 bg-card hover:border-primary/40"
            >
              <Plus className="h-4 w-4" />
              <span>سداد دفعة لمورد</span>
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setTransferOpen(true)}
              className="h-10 rounded-xl gap-1.5 text-xs font-black border-border/70 bg-card hover:border-primary/40"
            >
              <ArrowLeftRight className="h-4 w-4" />
              <span>تحويل بين الحسابات</span>
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setExpenseOpen(true)}
              className="h-10 rounded-xl gap-1.5 text-xs font-black border-border/70 bg-card hover:border-primary/40"
            >
              <Plus className="h-4 w-4" />
              <span>تسجيل مصروف</span>
            </Button>
          </div>

          {/* 4. التبويبات */}
          <div className="rounded-2xl border border-border/70 bg-card/90 backdrop-blur-md p-3 sm:p-4 shadow-2xs">
            {loading && accounts.length === 0 ? (
              <div className="flex justify-center py-10">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : (
              <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as FinanceTab)} dir="rtl" className="space-y-3">
                <TabsList className="w-full justify-start gap-1 overflow-x-auto no-scrollbar rounded-xl bg-muted/60 p-1 h-auto">
                  {[
                    { value: "overview", label: "نظرة عامة" },
                    { value: "accounts", label: `الحسابات (${accounts.length})` },
                    { value: "receipts", label: `التحصيلات (${receipts.length})` },
                    { value: "payments", label: `المدفوعات (${supplierPayments.length})` },
                    { value: "ledger", label: "سجل الحركات" },
                  ].map((tab) => (
                    <TabsTrigger
                      key={tab.value}
                      value={tab.value}
                      className="rounded-lg px-3 py-2 text-[11px] sm:text-xs font-black data-[state=active]:bg-card data-[state=active]:text-primary data-[state=active]:shadow-xs whitespace-nowrap"
                    >
                      {tab.label}
                    </TabsTrigger>
                  ))}
                </TabsList>

                <TabsContent value="overview" className="m-0">
                  <FinanceOverviewTab
                    profitability={profitability}
                    receivables={receivables}
                    payables={payables}
                    openInvoices={openInvoices}
                    currencyLabel={currencyLabel}
                    onOpenReceiptDialog={openReceiptDialog}
                    onOpenSupplierDialog={() => setSupplierOpen(true)}
                  />
                </TabsContent>

                <TabsContent value="accounts" className="m-0">
                  <FinanceAccountsTab
                    accounts={accounts}
                    newAccountName={newAccountName}
                    setNewAccountName={setNewAccountName}
                    newAccountKind={newAccountKind}
                    setNewAccountKind={setNewAccountKind}
                    newAccountCurrency={newAccountCurrency}
                    setNewAccountCurrency={setNewAccountCurrency}
                    creatingAccount={creatingAccount}
                    onCreateAccount={() => void handleCreateAccount()}
                  />
                </TabsContent>

                <TabsContent value="receipts" className="m-0 space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-black text-foreground">سجل تحصيلات العملاء ({receipts.length})</p>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => openReceiptDialog(null)}
                      className="h-8 rounded-xl gap-1 text-[11px] font-black"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      تحصيل جديد
                    </Button>
                  </div>
                  <List
                    items={receipts}
                    emptyLabel="لا توجد تحصيلات مسجّلة بعد."
                    render={(row) => ({
                      key: row.id,
                      title: row.reference ?? "—",
                      titleIsCode: true,
                      subtitle: `${row.customerName} · ${row.paidAt} · ${
                        PAYMENT_METHOD_LABELS[row.method as PaymentMethod] ?? row.method
                      }${row.notes ? ` · ${row.notes}` : ""}`,
                      amount: row.amount,
                      currency: row.currency,
                      actionLabel: "إلغاء",
                      onAction: () => {
                        setCancelReason("");
                        setCancelTarget({
                          kind: "receipt",
                          id: row.id,
                          reference: row.reference ?? row.id,
                          partyName: row.customerName,
                          amount: row.amount,
                          currency: row.currency,
                        });
                      },
                    })}
                  />
                </TabsContent>

                <TabsContent value="payments" className="m-0 space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-black text-foreground">سجل مدفوعات الموردين ({supplierPayments.length})</p>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setSupplierOpen(true)}
                      className="h-8 rounded-xl gap-1 text-[11px] font-black"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      دفعة لمورد
                    </Button>
                  </div>
                  <List
                    items={supplierPayments}
                    emptyLabel="لا توجد مدفوعات للموردين بعد."
                    render={(row) => ({
                      key: row.id,
                      title: row.reference ?? "—",
                      titleIsCode: true,
                      subtitle: `${row.supplierName} · ${row.paidAt} · ${
                        PAYMENT_METHOD_LABELS[row.method as PaymentMethod] ?? row.method
                      }${row.notes ? ` · ${row.notes}` : ""}`,
                      amount: -row.amount,
                      currency: row.currency,
                      actionLabel: "إلغاء",
                      onAction: () => {
                        setCancelReason("");
                        setCancelTarget({
                          kind: "supplier_payment",
                          id: row.id,
                          reference: row.reference ?? row.id,
                          partyName: row.supplierName,
                          amount: row.amount,
                          currency: row.currency,
                        });
                      },
                    })}
                  />
                </TabsContent>

                <TabsContent value="ledger" className="m-0">
                  <List
                    items={movements}
                    emptyLabel="لا توجد حركات مالية بعد."
                    render={(row) => ({
                      key: row.id,
                      title: `${LEDGER_KIND_LABELS[row.kind]} · ${row.accountName}`,
                      subtitle: `${row.occurredAt}${row.reference ? ` · ${row.reference}` : ""}${
                        row.reversed ? " · ملغاة" : ""
                      }`,
                      amount: row.kind === "receipt" || row.kind === "transfer_in" ? row.amount : -row.amount,
                      currency: row.currency,
                      muted: row.reversed,
                    })}
                  />
                </TabsContent>
              </Tabs>
            )}
          </div>
        </div>
      </main>

      <ReceiptDialog
        open={receiptOpen}
        onOpenChange={(v) => {
          setReceiptOpen(v);
          if (!v) setReceiptInvoiceId(null);
        }}
        initialInvoiceId={receiptInvoiceId}
      />
      <SupplierPaymentDialog open={supplierOpen} onOpenChange={setSupplierOpen} />
      <TransferDialog open={transferOpen} onOpenChange={setTransferOpen} />
      <ExpenseDialog open={expenseOpen} onOpenChange={setExpenseOpen} />

      <CancelPaymentAlertDialog
        cancelTarget={cancelTarget}
        cancelReason={cancelReason}
        setCancelReason={setCancelReason}
        cancelling={cancelling}
        onClose={() => setCancelTarget(null)}
        onConfirm={() => void handleConfirmCancel()}
      />
    </PageShell>
  );
}

export default FinancePage;
