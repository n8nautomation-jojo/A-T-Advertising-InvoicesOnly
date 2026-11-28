import { describe, it, expect, beforeEach, vi } from "vitest";
import type { AppNotificationItem } from "@/components/layout/NotificationPanel";

const mockPlugin = vi.hoisted(() => ({
  checkPermission: vi.fn(),
  requestPermission: vi.fn(),
  sendNotification: vi.fn(),
  sendDigestNotification: vi.fn(),
  clearAll: vi.fn(),
}));

const mockIsNative = vi.hoisted(() => vi.fn(() => true));

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => mockIsNative(),
  },
  registerPlugin: () => mockPlugin,
}));

import {
  dispatchNativeNotificationsForUnread,
  getReadAlertsMap,
  getUnreadAlerts,
  markAlertsAsRead,
  resetNotificationStateForTests,
} from "./nativeNotifications";

const sampleAlerts: AppNotificationItem[] = [
  {
    id: "inv-1",
    severity: "urgent",
    kind: "overdue_invoice",
    title: "فاتورة متأخرة 26-0001",
    subtitle: "فيوتشر · متبقي 6,270,000 ج.س",
    to: "/customers",
    search: { id: "cust-1" },
  },
  {
    id: "inv-2",
    severity: "warn",
    kind: "open_invoice",
    title: "فاتورة غير محصّلة 26-0002",
    subtitle: "البيان · متبقي 7,500,000 ج.س",
    to: "/finance",
  },
];

describe("Native Android Notifications & Read-State Management", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsNative.mockReturnValue(true);
    mockPlugin.checkPermission.mockResolvedValue({ granted: true, state: "granted" });
    mockPlugin.requestPermission.mockResolvedValue({ granted: true, state: "granted" });
    mockPlugin.sendNotification.mockResolvedValue({ ok: true, id: 8801 });
    mockPlugin.sendDigestNotification.mockResolvedValue({ ok: true, id: 8800 });
    mockPlugin.clearAll.mockResolvedValue({ ok: true });
    resetNotificationStateForTests();
  });

  it("marks all alerts as read persistently on bell click and clears native Android notifications", () => {
    expect(getUnreadAlerts(sampleAlerts)).toHaveLength(2);

    const updated = markAlertsAsRead(sampleAlerts);
    expect(getUnreadAlerts(sampleAlerts, updated)).toHaveLength(0);
    // Persisted in localStorage across reloads
    expect(getUnreadAlerts(sampleAlerts, getReadAlertsMap())).toHaveLength(0);
    expect(mockPlugin.clearAll).toHaveBeenCalledTimes(1);
  });

  it("re-flags an alert as unread only if a new alert arrives or an existing alert escalates", () => {
    markAlertsAsRead(sampleAlerts);
    expect(getUnreadAlerts(sampleAlerts)).toHaveLength(0);

    const escalated: AppNotificationItem[] = [
      sampleAlerts[0],
      { ...sampleAlerts[1], severity: "urgent", kind: "overdue_invoice", title: "فاتورة متأخرة 26-0002" },
    ];
    const unread = getUnreadAlerts(escalated);
    expect(unread).toHaveLength(1);
    expect(unread[0].id).toBe("inv-2");
  });

  it("sends a single native Android notification for 1 unread alert and deduplicates subsequent runs", async () => {
    const firstRun = await dispatchNativeNotificationsForUnread([sampleAlerts[0]]);
    expect(firstRun.sent).toBe(1);
    expect(mockPlugin.sendNotification).toHaveBeenCalledTimes(1);
    expect(mockPlugin.sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "inv-1",
        title: sampleAlerts[0].title,
        body: sampleAlerts[0].subtitle,
        route: "/customers?id=cust-1",
        urgent: true,
      })
    );

    // Second run with the same unread alert must NOT spam the user
    const secondRun = await dispatchNativeNotificationsForUnread([sampleAlerts[0]]);
    expect(secondRun.sent).toBe(0);
    expect(mockPlugin.sendNotification).toHaveBeenCalledTimes(1);
  });

  it("sends an expandable InboxStyle native digest notification for multiple unread alerts", async () => {
    const res = await dispatchNativeNotificationsForUnread(sampleAlerts);
    expect(res.sent).toBe(2);
    expect(mockPlugin.sendDigestNotification).toHaveBeenCalledTimes(1);
    expect(mockPlugin.sendDigestNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        urgent: true,
        lines: expect.arrayContaining([
          expect.stringContaining("فاتورة متأخرة 26-0001"),
          expect.stringContaining("فاتورة غير محصّلة 26-0002"),
        ]),
      })
    );
  });

  it("requests Android 13+ notification permission once when status is prompt and sends once granted", async () => {
    mockPlugin.checkPermission.mockResolvedValueOnce({ granted: false, state: "prompt" });
    mockPlugin.requestPermission.mockResolvedValueOnce({ granted: true, state: "granted" });

    const res = await dispatchNativeNotificationsForUnread([sampleAlerts[0]]);
    expect(mockPlugin.requestPermission).toHaveBeenCalledTimes(1);
    expect(res.sent).toBe(1);
    expect(mockPlugin.sendNotification).toHaveBeenCalledTimes(1);
  });
});
