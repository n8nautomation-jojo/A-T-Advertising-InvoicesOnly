import { useSyncExternalStore } from "react";
import type { MaterialKey } from "./printCalculator";
import { materialLabel } from "./printCalculator";
import { sanitizeCurrency, type AppCurrency } from "./currency/types";

export type OrderStatus =
  | "new"
  | "design"
  | "ready_to_print"
  | "printing"
  | "finishing"
  | "delivered"
  | "cancelled";

export type OrderPriority = "normal" | "urgent";

export interface OrderItemRecord {
  id: string;
  description: string;
  material: MaterialKey;
  width: number;
  height: number;
  qty: number;
  rollUsed: string;
  area: number;
  unitPrice: number;
  total: number;
}

export interface PrintOrder {
  id: string;
  orderNumber: string;
  customerName: string;
  customerPhone: string;
  clientType: "A" | "B" | "takeaway" | "inhouse";
  status: OrderStatus;
  priority: OrderPriority;
  createdAt: string;
  deliveryDate?: string;
  items: OrderItemRecord[];
  totalArea: number;
  totalCost: number;
  paidAmount: number;
  currency?: AppCurrency;
  branch: string;
  notes?: string;
  invoiceSerial?: string;
}

import { Capacitor } from "@capacitor/core";
import { getStoredJsonSync, setMemoryCacheJson } from "./sqliteStorage";
import {
  upsertOrder as repoUpsertOrder,
  deleteOrder as repoDeleteOrder,
  updateOrderStatus as repoUpdateOrderStatus,
} from "./repositories/OrderRepository";
import { toast } from "sonner";

const STORAGE_KEY = "future_print_orders_v2";

const INITIAL_DEMO_ORDERS: PrintOrder[] = [];

function sanitizeOrder(raw: any): PrintOrder {
  return {
    id: String(raw.id || `ord-${Date.now()}`),
    orderNumber: String(raw.orderNumber || "001"),
    customerName: String(raw.customerName || "عميل نقدي"),
    customerPhone: String(raw.customerPhone || ""),
    clientType: raw.clientType || "takeaway",
    status: raw.status || "ready_to_print",
    priority: raw.priority || "normal",
    createdAt: raw.createdAt || new Date().toISOString(),
    deliveryDate: raw.deliveryDate || "",
    items: Array.isArray(raw.items)
      ? raw.items.map((it: any) => ({
          id: String(it.id || `it-${Math.random()}`),
          description: String(it.description || "بند طباعة"),
          material: it.material || "flex",
          width: Number(it.width) || 0,
          height: Number(it.height) || 0,
          qty: Number(it.qty) || 1,
          rollUsed: String(it.rollUsed || ""),
          area: Number(it.area) || 0,
          unitPrice: Number(it.unitPrice) || 0,
          total: Number(it.total) || 0,
        }))
      : [],
    totalArea: Number(raw.totalArea) || 0,
    totalCost: Number(raw.totalCost) || 0,
    paidAmount: Number(raw.paidAmount) || 0,
    currency: sanitizeCurrency(raw.currency, "SDG"),
    branch: String(raw.branch || "امدرمان"),
    notes: String(raw.notes || ""),
    invoiceSerial: raw.invoiceSerial ? String(raw.invoiceSerial) : undefined,
  };
}

function loadOrdersFromStorage(): PrintOrder[] {
  const list = getStoredJsonSync<any[]>(STORAGE_KEY, INITIAL_DEMO_ORDERS);
  return Array.isArray(list) ? list.map(sanitizeOrder) : INITIAL_DEMO_ORDERS;
}

let ordersSnapshot: PrintOrder[] = loadOrdersFromStorage();
const subscribers = new Set<() => void>();

if (typeof window !== "undefined") {
  window.addEventListener("native-storage-ready", () => {
    ordersSnapshot = loadOrdersFromStorage();
    subscribers.forEach((fn) => fn());
  });
}

function notify() {
  setMemoryCacheJson(STORAGE_KEY, ordersSnapshot);
  subscribers.forEach((fn) => fn());
}

export function getOrdersSnapshot(): PrintOrder[] {
  return ordersSnapshot;
}

export function subscribeOrders(fn: () => void) {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}

export function useOrders() {
  return useSyncExternalStore(subscribeOrders, getOrdersSnapshot, () => INITIAL_DEMO_ORDERS);
}

export function addOrder(newOrder: Omit<PrintOrder, "id" | "createdAt">): PrintOrder {
  const order: PrintOrder = {
    ...newOrder,
    currency: sanitizeCurrency(newOrder.currency, "SDG"),
    id: `ord-${Date.now()}`,
    createdAt: new Date().toISOString(),
  };
  ordersSnapshot = [order, ...ordersSnapshot];
  notify();
  if (Capacitor.isNativePlatform()) {
    repoUpsertOrder(order).catch((err) => {
      console.warn("[OrdersStore] SQLite add failed:", err);
      // Roll back ONLY this added order without overwriting concurrent mutations
      if (ordersSnapshot.some((o) => o === order)) {
        ordersSnapshot = ordersSnapshot.filter((o) => o.id !== order.id);
        notify();
      }
      toast.error("تعذّر حفظ الطلب في قاعدة البيانات");
    });
  }
  return order;
}

export function updateOrderStatus(orderId: string, status: OrderStatus) {
  const existing = ordersSnapshot.find((o) => o.id === orderId);
  const previousStatus = existing?.status;
  const updatedOrder = existing ? { ...existing, status } : undefined;
  if (updatedOrder) {
    ordersSnapshot = ordersSnapshot.map((o) => (o.id === orderId ? updatedOrder : o));
  }
  notify();
  if (Capacitor.isNativePlatform()) {
    repoUpdateOrderStatus(orderId, status).catch((err) => {
      console.warn("[OrdersStore] SQLite status update failed:", err);
      // Roll back ONLY this order's status if no newer write superseded it
      if (previousStatus !== undefined && updatedOrder) {
        const current = ordersSnapshot.find((o) => o.id === orderId);
        if (current === updatedOrder) {
          ordersSnapshot = ordersSnapshot.map((o) =>
            o.id === orderId ? { ...o, status: previousStatus } : o
          );
          notify();
        }
      }
      toast.error("تعذّر تحديث حالة الطلب في قاعدة البيانات");
    });
  }
}

export function deleteOrder(orderId: string) {
  const deletedIndex = ordersSnapshot.findIndex((o) => o.id === orderId);
  const deletedOrder = deletedIndex >= 0 ? ordersSnapshot[deletedIndex] : undefined;
  ordersSnapshot = ordersSnapshot.filter((o) => o.id !== orderId);
  notify();
  if (Capacitor.isNativePlatform()) {
    repoDeleteOrder(orderId).catch((err) => {
      console.warn("[OrdersStore] SQLite delete failed:", err);
      // Re-insert ONLY this order without overwriting concurrent mutations
      if (deletedOrder && !ordersSnapshot.some((o) => o.id === orderId)) {
        const next = [...ordersSnapshot];
        next.splice(Math.min(deletedIndex, next.length), 0, deletedOrder);
        ordersSnapshot = next;
        notify();
      }
      toast.error("تعذّر حذف الطلب من قاعدة البيانات");
    });
  }
}

export const STATUS_CONFIG: Record<
  OrderStatus,
  { label: string; color: string; bg: string; border: string }
> = {
  new: {
    label: "طلب جديد",
    color: "text-blue-600 dark:text-blue-400",
    bg: "bg-blue-500/10",
    border: "border-blue-500/30",
  },
  design: {
    label: "تحت التصميم",
    color: "text-purple-600 dark:text-purple-400",
    bg: "bg-purple-500/10",
    border: "border-purple-500/30",
  },
  ready_to_print: {
    label: "جاهز للطباعة",
    color: "text-amber-600 dark:text-amber-400",
    bg: "bg-amber-500/10",
    border: "border-amber-500/30",
  },
  printing: {
    label: "قيد الطباعة",
    color: "text-primary dark:text-primary-glow font-bold",
    bg: "bg-primary/10",
    border: "border-primary/40",
  },
  finishing: {
    label: "تشطيب وقص",
    color: "text-indigo-600 dark:text-indigo-400",
    bg: "bg-indigo-500/10",
    border: "border-indigo-500/30",
  },
  delivered: {
    label: "تم التسليم",
    color: "text-emerald-600 dark:text-emerald-400",
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/30",
  },
  cancelled: {
    label: "ملغي",
    color: "text-rose-600 dark:text-rose-400",
    bg: "bg-rose-500/10",
    border: "border-rose-500/30",
  },
};
