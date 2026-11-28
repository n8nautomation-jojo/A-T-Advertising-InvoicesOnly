import { Capacitor, registerPlugin } from "@capacitor/core";
import type { AppNotificationItem } from "@/components/layout/NotificationPanel";

export interface TaNotificationsPlugin {
  checkPermission(): Promise<{ granted: boolean; state: string }>;
  requestPermission(): Promise<{ granted: boolean; state: string }>;
  sendNotification(options: {
    id: string;
    title: string;
    body: string;
    route?: string;
    urgent?: boolean;
  }): Promise<{ ok: boolean; id?: number; permissionRequired?: boolean }>;
  sendDigestNotification(options: {
    title: string;
    body: string;
    summary?: string;
    lines: string[];
    route?: string;
    urgent?: boolean;
  }): Promise<{ ok: boolean; id?: number; permissionRequired?: boolean }>;
  clearAll(): Promise<{ ok: boolean }>;
}

const TaNotifications = registerPlugin<TaNotificationsPlugin>("TaNotifications");

const READ_STORAGE_KEY = "ta_notifications_read_v1";
const SENT_STORAGE_KEY = "ta_notifications_sent_v1";
const PERM_ASKED_KEY = "ta_notifications_perm_asked_v1";

let inflightDispatch = false;

export function getAlertFingerprint(alert: AppNotificationItem): string {
  return `${alert.id}|${alert.severity}|${alert.title}|${alert.subtitle}`;
}

function readMapFromStorage(key: string): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const clean: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "string") clean[k] = v;
    }
    return clean;
  } catch {
    return {};
  }
}

function writeMapToStorage(key: string, map: Record<string, string>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(map));
  } catch {
    // ignore quota errors
  }
}

export function getReadAlertsMap(): Record<string, string> {
  return readMapFromStorage(READ_STORAGE_KEY);
}

export function isAlertRead(
  alert: AppNotificationItem,
  readMap: Record<string, string> = getReadAlertsMap()
): boolean {
  return readMap[alert.id] === getAlertFingerprint(alert);
}

export function getUnreadAlerts(
  alerts: AppNotificationItem[],
  readMap: Record<string, string> = getReadAlertsMap()
): AppNotificationItem[] {
  return alerts.filter((alert) => !isAlertRead(alert, readMap));
}

function buildAlertRoute(alert: AppNotificationItem): string {
  if (alert.to === "/customers" && alert.search?.id) {
    return `/customers?id=${encodeURIComponent(alert.search.id)}`;
  }
  return alert.to;
}

/**
 * Marks all provided alerts as read persistently so the bell badge clears
 * immediately and stays quiet across reloads until new or updated alerts arrive.
 * Also dismisses any active native Android alert notifications from the phone shade.
 */
export function markAlertsAsRead(alerts: AppNotificationItem[]): Record<string, string> {
  const prev = getReadAlertsMap();
  const next: Record<string, string> = {};
  const activeIds = new Set(alerts.map((a) => a.id));

  // Keep read state only for currently active alerts to prevent unbounded growth
  for (const [id, fp] of Object.entries(prev)) {
    if (activeIds.has(id)) next[id] = fp;
  }
  for (const alert of alerts) {
    next[alert.id] = getAlertFingerprint(alert);
  }

  writeMapToStorage(READ_STORAGE_KEY, next);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("ta-notifications-read-changed"));
  }
  void clearNativeAlertNotifications();
  return next;
}

export async function clearNativeAlertNotifications(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await TaNotifications.clearAll();
  } catch {
    // non-fatal if plugin unavailable
  }
}

export async function ensureNativeNotificationPermission(forcePrompt = false): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  try {
    const status = await TaNotifications.checkPermission();
    if (status?.granted) return true;

    const alreadyAsked =
      typeof window !== "undefined" &&
      window.localStorage.getItem(PERM_ASKED_KEY) === "1";

    if (!forcePrompt && alreadyAsked) {
      return false;
    }

    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(PERM_ASKED_KEY, "1");
      } catch {
        // ignore storage errors
      }
    }

    const req = await TaNotifications.requestPermission();
    return Boolean(req?.granted);
  } catch {
    return false;
  }
}

/**
 * Dispatches real native Android status-bar notifications for newly arrived unread alerts.
 * Deduplicates by alert fingerprint in localStorage so the same alert never spams the user.
 */
export async function dispatchNativeNotificationsForUnread(
  unreadAlerts: AppNotificationItem[]
): Promise<{ sent: number }> {
  if (!Capacitor.isNativePlatform() || unreadAlerts.length === 0 || inflightDispatch) {
    return { sent: 0 };
  }

  const sentMap = readMapFromStorage(SENT_STORAGE_KEY);
  const unsent = unreadAlerts.filter((a) => sentMap[a.id] !== getAlertFingerprint(a));
  if (unsent.length === 0) {
    return { sent: 0 };
  }

  inflightDispatch = true;
  try {
    const granted = await ensureNativeNotificationPermission(false);
    if (!granted) {
      return { sent: 0 };
    }

    let ok = false;
    if (unsent.length === 1) {
      const first = unsent[0];
      const res = await TaNotifications.sendNotification({
        id: first.id,
        title: first.title,
        body: first.subtitle,
        route: buildAlertRoute(first),
        urgent: first.severity === "urgent",
      });
      ok = Boolean(res?.ok);
    } else {
      const urgentCount = unsent.filter((a) => a.severity === "urgent").length;
      const title =
        urgentCount > 0
          ? `تنبيه عاجل: ${urgentCount} فاتورة متأخرة (${unsent.length} تنبيه)`
          : `لديك ${unsent.length} تنبيهات جديدة للمتابعة`;
      const primary = unsent[0];
      const lines = unsent.slice(0, 6).map((item) => `${item.title} — ${item.subtitle}`);
      const res = await TaNotifications.sendDigestNotification({
        title,
        body: `${primary.title} · ${primary.subtitle}`,
        summary: "T.A Advertising Solution",
        lines,
        route: buildAlertRoute(primary),
        urgent: urgentCount > 0,
      });
      ok = Boolean(res?.ok);
    }

    if (ok) {
      const nextSent: Record<string, string> = {};
      const activeIds = new Set(unreadAlerts.map((a) => a.id));
      for (const [id, fp] of Object.entries(sentMap)) {
        if (activeIds.has(id)) nextSent[id] = fp;
      }
      for (const item of unsent) {
        nextSent[item.id] = getAlertFingerprint(item);
      }
      writeMapToStorage(SENT_STORAGE_KEY, nextSent);
      return { sent: unsent.length };
    }

    return { sent: 0 };
  } catch {
    return { sent: 0 };
  } finally {
    inflightDispatch = false;
  }
}

export function resetNotificationStateForTests(): void {
  inflightDispatch = false;
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(READ_STORAGE_KEY);
    window.localStorage.removeItem(SENT_STORAGE_KEY);
    window.localStorage.removeItem(PERM_ASKED_KEY);
  } catch {
    // ignore
  }
}
