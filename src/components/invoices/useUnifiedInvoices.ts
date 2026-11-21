import { useMemo } from "react";
import { useInvoices } from "@/lib/invoicesStore";
import { useCustomInvoices } from "@/lib/billing/store";
import { useProformaInvoices } from "@/lib/proforma/store";
import { INVOICE_TYPE_LABELS } from "@/lib/billing/types";
import { type AppCurrency, sanitizeCurrency } from "@/lib/currency/types";
import { UnifiedInvoiceRecord, InvoicesStats } from "./types";

/**
 * خطاف مخصص لتوحيد بيانات الفواتير من كافة أقسام النظام:
 * 1. فواتير وإيصالات الحاسبة القياسية (Calculator Invoices)
 * 2. الفواتير المخصصة للمبيعات والمشتريات (Billing Invoices)
 * 3. الفواتير المبدئية الرسمية المعتمدة (Proforma Invoices A4)
 * يتولى الدمج، الترتيب الزمني، البحث، وحساب المؤشرات المالية
 */
export function useUnifiedInvoices(searchQuery: string = "", activeFilter: string = "all") {
  const calcInvoices = useInvoices();
  const customInvoices = useCustomInvoices();
  const proformaInvoices = useProformaInvoices();

  // 1. دمج وترتيب كافة الفواتير من المصادر الثلاثة
  const allRecords = useMemo<UnifiedInvoiceRecord[]>(() => {
    const list: UnifiedInvoiceRecord[] = [];

    // بناء فهرس سريع لأرقام العروض المبدئية O(1) لتجنب الفحص الخطي O(N*M)
    const proformaSerials = new Set(
      (proformaInvoices || []).map((p) => p.meta?.serial).filter(Boolean)
    );

    // أ. الفواتير المبدئية الرسمية المعتمدة (Proforma Invoices)
    (proformaInvoices || []).forEach((inv) => {
      list.push({
        kind: "proforma",
        id: inv.id,
        serial: inv.meta?.serial || "001",
        date: inv.meta?.date || inv.createdAt?.slice(0, 10) || "",
        customerName: inv.meta?.customerName || inv.meta?.customerEnName || "عميل بدون اسم",
        total: Number(inv.totalAmount) || 0,
        currency: sanitizeCurrency(inv.currency || inv.meta?.currency, "SDG"),
        type: "proforma",
        typeLabel: "فاتورة مبدئية Proforma",
        badgeColor: "border-[#C5A059]/40 text-[#C5A059] bg-[#C5A059]/10",
        itemsCount: (inv.lines || []).length,
        raw: inv,
      });
    });

    // ب. فواتير قسم الفواتير والمطالبات (Custom Invoices)
    (customInvoices || []).forEach((inv) => {
      const type = inv.meta?.type || "sales";
      // منع تكرار الفواتير المبدئية بفحص فوري O(1)
      if (type === "proforma" && inv.meta?.serial && proformaSerials.has(inv.meta.serial)) {
        return;
      }

      const badgeColor =
        type === "sales"
          ? "border-emerald-500/30 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10"
          : type === "purchase"
          ? "border-purple-500/30 text-purple-600 dark:text-purple-400 bg-purple-500/10"
          : "border-amber-500/30 text-amber-600 dark:text-amber-400 bg-amber-500/10";

      list.push({
        kind: "custom",
        id: inv.id,
        // المرجع الرسمي أولاً (PRD §5.3.6) مع الرقم التسلسلي القديم كاحتياط
        serial: inv.reference || inv.meta?.serial || "001",
        date: inv.meta?.date || inv.createdAt?.slice(0, 10) || "",
        customerName: inv.meta?.partyName || inv.meta?.partyEnName || "عميل غير محدد",
        total: Number(inv.totalAmount) || 0,
        currency: sanitizeCurrency(inv.currency || inv.meta?.currency, "SDG"),
        type,
        typeLabel: INVOICE_TYPE_LABELS[type] || "فاتورة",
        badgeColor,
        itemsCount: (inv.items || []).length,
        raw: inv,
      });
    });

    // ج. إيصالات وفواتير قسم الحاسبة (Calculator Invoices)
    (calcInvoices || []).forEach((inv) => {
      list.push({
        kind: "calculator",
        id: inv.id,
        serial: inv.serial || "001",
        date: inv.date || inv.createdAt?.slice(0, 10) || "",
        customerName: inv.customerName || "عميل حاسبة",
        total: Number(inv.total) || 0,
        currency: sanitizeCurrency(inv.currency, "SDG"),
        type: "calculator",
        typeLabel: "إيصال حاسبة A5",
        badgeColor: "border-primary/30 text-primary bg-primary/10",
        itemsCount: (inv.lines || []).length,
        raw: inv,
      });
    });

    // د. إزالة أي تكرار ناتج عن حفظ متكرر (بالاعتماد على id وليس serial لأن المرجع قد لا يكون مسنداً للأنواع الفرعية)
    const seenKeys = new Set<string>();
    const uniqueList: UnifiedInvoiceRecord[] = [];

    for (const rec of list) {
      const uniqueKey = `${rec.kind}-${rec.id}`;
      if (!seenKeys.has(uniqueKey)) {
        seenKeys.add(uniqueKey);
        uniqueList.push(rec);
      }
    }

    // الترتيب من الأحدث للأقدم عددياً وتاريخياً
    return uniqueList.sort((a, b) => {
      const dateCompare = (b.date || "").localeCompare(a.date || "");
      if (dateCompare !== 0) return dateCompare;
      return b.serial.localeCompare(a.serial, undefined, { numeric: true });
    });
  }, [calcInvoices, customInvoices, proformaInvoices]);

  // 2. تصفية السجلات بناءً على نص البحث وتبويب الفرز
  const filteredRecords = useMemo(() => {
    const q = (searchQuery || "").trim().toLowerCase();
    const filter = activeFilter || "all";
    return allRecords.filter((rec) => {
      const matchSearch =
        !q ||
        (rec.serial || "").toLowerCase().includes(q) ||
        (rec.customerName || "").toLowerCase().includes(q) ||
        (rec.typeLabel || "").toLowerCase().includes(q);

      const matchType = filter === "all" || rec.type === filter;

      return matchSearch && matchType;
    });
  }, [allRecords, searchQuery, activeFilter]);

  // 3. المؤشرات والإحصائيات السريعة المحدثة
  const stats = useMemo<InvoicesStats>(() => {
    const totalCount = allRecords.length;
    const totalsByCurrency: Partial<Record<AppCurrency, number>> = {};
    for (const r of allRecords) {
      const cur = sanitizeCurrency(r.currency, "SDG");
      totalsByCurrency[cur] =
        Math.round(((totalsByCurrency[cur] || 0) + (Number(r.total) || 0)) * 100) / 100;
    }
    const totalAmount = totalsByCurrency.SDG ?? 0;
    const customCount = (customInvoices || []).length;
    const calcCount = (calcInvoices || []).length;
    const proformaCount = (proformaInvoices || []).length;

    return { totalCount, totalAmount, totalsByCurrency, customCount, calcCount, proformaCount };
  }, [allRecords, customInvoices, calcInvoices, proformaInvoices]);

  return {
    allRecords,
    filteredRecords,
    stats,
  };
}
