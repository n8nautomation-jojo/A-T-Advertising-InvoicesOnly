import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { Link, useLocation } from "@tanstack/react-router";
import { Capacitor } from "@capacitor/core";
import { Moon, Sun, Bell, Lock, Calendar, BookOpen } from "lucide-react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useTheme } from "@/hooks/useTheme";
import { useCustomInvoices } from "@/lib/billing/store";
import { settlementFor, useSettlementVersion } from "@/lib/financeStore";
import { getExpensesWithSettlement, type ExpenseWithSettlement } from "@/lib/repositories/ExpenseRepository";
import { getLocalIsoDate } from "@/lib/dateUtils";
import { formatNumber } from "@/lib/printCalculator";
import { sanitizeCurrency } from "@/lib/currency/types";
import { getCurrencyShortLabel } from "@/lib/currency/currencyFormat";
import { triggerOpenTour } from "@/lib/appTourStore";
import {
  dispatchNativeNotificationsForUnread,
  ensureNativeNotificationPermission,
  getReadAlertsMap,
  getUnreadAlerts,
  markAlertsAsRead,
} from "@/lib/notifications/nativeNotifications";
import { getTourSectionFromPath } from "./navConfig";
import { NotificationPanel, type AppNotificationItem } from "./NotificationPanel";

const dateFmt = new Intl.DateTimeFormat("ar", {
  weekday: "short",
  day: "numeric",
  month: "short",
});

export function AppHeader() {
  const { theme, toggle } = useTheme();
  const location = useLocation();
  const pathname = location.pathname;

  const currentSectionInfo = useMemo(() => getTourSectionFromPath(pathname), [pathname]);
  const invoices = useCustomInvoices();
  const settlementVersion = useSettlementVersion();
  const [unpaidExpenses, setUnpaidExpenses] = useState<ExpenseWithSettlement[]>([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const [readMap, setReadMap] = useState<Record<string, string>>(() => getReadAlertsMap());
  const [today, setToday] = useState("");
  const bellTriggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    try {
      setToday(dateFmt.format(new Date()));
    } catch {
      // keep empty
    }
  }, []);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let cancelled = false;
    const loadExpenses = () => {
      void getExpensesWithSettlement()
        .then((rows) => {
          if (!cancelled) {
            setUnpaidExpenses(rows.filter((r) => r.settlement.outstanding > 0.01));
          }
        })
        .catch(() => {
          // ignore if DB not initialized yet
        });
    };
    loadExpenses();
    window.addEventListener("finance-changed", loadExpenses);
    window.addEventListener("native-storage-ready", loadExpenses);
    return () => {
      cancelled = true;
      window.removeEventListener("finance-changed", loadExpenses);
      window.removeEventListener("native-storage-ready", loadExpenses);
    };
  }, []);

  const handleCloseNotifications = useCallback(() => {
    setShowNotifications(false);
  }, []);

  const alerts = useMemo<AppNotificationItem[]>(() => {
    // Depend on settlementVersion so badge stays live after receipts/cancellations.
    void settlementVersion;
    const todayIso = getLocalIsoDate();
    const list: AppNotificationItem[] = [];

    for (const inv of invoices) {
      if (inv.cancelledAt || inv.meta.type !== "sales") continue;
      const st = settlementFor(inv.id, Number(inv.totalAmount) || 0);
      if (st.outstanding <= 0.01) continue;

      const cur = sanitizeCurrency(inv.currency || inv.meta.currency, "SDG");
      const curLabel = getCurrencyShortLabel(cur);
      const isOverdue = Boolean(inv.meta.dueDate && inv.meta.dueDate < todayIso);
      list.push({
        id: `inv-${inv.id}`,
        severity: isOverdue ? "urgent" : "warn",
        kind: isOverdue ? "overdue_invoice" : "open_invoice",
        title: `${isOverdue ? "فاتورة متأخرة" : "فاتورة غير محصّلة"} ${inv.reference || `#${inv.meta.serial}`}`,
        subtitle: `${inv.meta.partyName || "عميل غير محدد"} · متبقي ${formatNumber(st.outstanding)} ${curLabel}`,
        to: inv.customerId ? "/customers" : "/finance",
        search: inv.customerId ? { id: inv.customerId } : undefined,
      });
    }

    for (const exp of unpaidExpenses.slice(0, 8)) {
      const curLabel = getCurrencyShortLabel(sanitizeCurrency(exp.currency, "SDG"));
      list.push({
        id: `exp-${exp.id}`,
        severity: "warn",
        kind: "unpaid_expense",
        title: `مصروف غير مسدَّد: ${exp.beneficiary || exp.category || "مصروف"}`,
        subtitle: `متبقي ${formatNumber(exp.settlement.outstanding)} ${curLabel} · ${exp.expenseDate}`,
        to: "/expenses",
      });
    }

    list.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "urgent" ? -1 : 1));
    return list.slice(0, 20);
  }, [invoices, unpaidExpenses, settlementVersion]);

  const unreadAlerts = useMemo(() => getUnreadAlerts(alerts, readMap), [alerts, readMap]);

  // Keep read state synced across components and when user taps a native Android notification
  useEffect(() => {
    const syncRead = () => setReadMap(getReadAlertsMap());
    const handleNativeOpened = () => {
      setReadMap(markAlertsAsRead(alerts));
    };
    window.addEventListener("ta-notifications-read-changed", syncRead);
    window.addEventListener("ta-native-notification-opened", handleNativeOpened);
    return () => {
      window.removeEventListener("ta-notifications-read-changed", syncRead);
      window.removeEventListener("ta-native-notification-opened", handleNativeOpened);
    };
  }, [alerts]);

  // Push real native Android system notifications for any newly arrived unread alerts
  useEffect(() => {
    if (!Capacitor.isNativePlatform() || unreadAlerts.length === 0) return;
    void dispatchNativeNotificationsForUnread(unreadAlerts);
  }, [unreadAlerts]);

  const handleToggleNotifications = useCallback(() => {
    setShowNotifications((prev) => {
      const next = !prev;
      if (next) {
        if (alerts.length > 0) {
          setReadMap(markAlertsAsRead(alerts));
        }
        if (Capacitor.isNativePlatform()) {
          void ensureNativeNotificationPermission(true);
        }
      }
      return next;
    });
  }, [alerts]);

  const isDark = theme === "dark";
  const unreadUrgentCount = unreadAlerts.filter((a) => a.severity === "urgent").length;
  const badgeCount = unreadAlerts.length;
  const hasUnread = badgeCount > 0;

  return (
    <header
      className={[
        "shrink-0 z-20 select-none",
        "border-b border-border/60",
        "bg-nav-bar/95 backdrop-blur-xl",
        "shadow-[0_1px_0_hsl(var(--border)/0.4),0_4px_16px_-4px_hsl(0_0%_0%/0.06)]",
        "pt-[max(0.25rem,env(safe-area-inset-top,0px))]",
        "pl-[max(0.75rem,env(safe-area-inset-left,0px))]",
        "pr-[max(0.75rem,env(safe-area-inset-right,0px))]",
      ].join(" ")}
      dir="rtl"
    >
      <div className="flex h-[58px] sm:h-[66px] md:h-[72px] items-center justify-between px-3 sm:px-5 md:px-7 gap-2">
        <div className="flex items-center gap-2 sm:gap-2.5 shrink-0">
          <SidebarTrigger
            aria-label="القائمة الرئيسية"
            className={[
              "h-9 w-9 sm:h-10 sm:w-10 rounded-xl sm:rounded-2xl border border-border/60 btn-tactile interactive",
              "bg-secondary/50 text-foreground",
              "hover:bg-card hover:border-primary/40 hover:text-primary",
              "flex items-center justify-center shadow-2xs",
            ].join(" ")}
          />

          <Link
            to="/"
            className="flex items-center group btn-tactile interactive py-0.5 active:scale-[0.96] transition-transform duration-100"
            aria-label="الرئيسية — T.A Advertising Solution"
          >
            <img
              key={isDark ? "dark-logo" : "light-logo"}
              src={isDark ? "/ta-logo-white.png" : "/ta-logo.png"}
              alt="T.A Advertising Solution"
              className={[
                "h-[34px] xs:h-[38px] sm:h-[44px] md:h-[48px] w-auto max-w-[130px] sm:max-w-[170px] object-contain",
                "transition-all duration-300",
                "drop-shadow-xs group-hover:scale-[1.03]",
                "group-active:scale-[0.97]",
              ].join(" ")}
              loading="eager"
              onError={(e) => {
                const img = e.currentTarget as HTMLImageElement;
                if (img.src.includes("white")) img.src = "/ta-logo.png";
              }}
            />
          </Link>

          {today && (
            <div className="hidden xl:flex items-center gap-1.5 rounded-full border border-border/50 bg-secondary/40 px-3 py-1.5 text-xs font-bold text-muted-foreground mr-1">
              <Calendar className="h-3.5 w-3.5 text-primary" />
              <span>{today}</span>
            </div>
          )}
        </div>

        <div className="flex-1" />

        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 pl-1 sm:pl-2">
          <button
            type="button"
            onClick={() => triggerOpenTour({ sectionId: currentSectionInfo.id, mode: "context" })}
            aria-label={`المساعد الذكي: ${currentSectionInfo.label}`}
            title={`المساعد الذكي: ${currentSectionInfo.label}`}
            className={[
              "grid h-9 w-9 sm:h-10 sm:w-10 place-items-center rounded-xl sm:rounded-2xl border border-border/60",
              "bg-secondary/50 text-foreground active:scale-[0.94] transition-transform duration-100",
              "hover:bg-card hover:text-primary hover:border-primary/40",
              "btn-tactile interactive shadow-2xs cursor-pointer touch-manipulation",
            ].join(" ")}
          >
            <BookOpen className="h-4 w-4 sm:h-[18px] sm:w-[18px] text-primary" />
          </button>

          <button
            type="button"
            onClick={toggle}
            aria-label={isDark ? "الوضع الفاتح" : "الوضع الليلي"}
            title={isDark ? "الوضع الفاتح" : "الوضع الليلي"}
            className={[
              "grid h-9 w-9 sm:h-10 sm:w-10 place-items-center rounded-xl sm:rounded-2xl border border-border/60",
              "bg-secondary/50 text-foreground active:scale-[0.94] transition-transform duration-100",
              "hover:bg-card hover:border-primary/30",
              "btn-tactile interactive shadow-2xs",
            ].join(" ")}
          >
            {isDark ? (
              <Sun className="h-4 w-4 sm:h-[18px] sm:w-[18px] text-amber-400" />
            ) : (
              <Moon className="h-4 w-4 sm:h-[18px] sm:w-[18px] text-primary" />
            )}
          </button>

          <button
            type="button"
            onClick={() => window.dispatchEvent(new Event("app-lock"))}
            aria-label="قفل التطبيق"
            title="قفل التطبيق"
            className={[
              "grid h-9 w-9 sm:h-10 sm:w-10 place-items-center rounded-xl sm:rounded-2xl border border-border/60",
              "bg-secondary/50 text-foreground active:scale-[0.94] transition-transform duration-100",
              "hover:bg-card hover:text-primary hover:border-primary/30",
              "btn-tactile interactive shadow-2xs",
            ].join(" ")}
          >
            <Lock className="h-4 w-4 sm:h-[18px] sm:w-[18px]" />
          </button>

          <div className="relative">
            <button
              ref={bellTriggerRef}
              type="button"
              data-testid="header-notifications-btn"
              onClick={handleToggleNotifications}
              aria-label={`التنبيهات${hasUnread ? ` — ${badgeCount} تنبيه غير مقروء` : ""}`}
              aria-expanded={showNotifications}
              title="التنبيهات"
              className={[
                "relative grid h-9 w-9 sm:h-10 sm:w-10 place-items-center rounded-xl sm:rounded-2xl border btn-tactile interactive shadow-2xs active:scale-[0.94] transition-transform duration-100",
                unreadUrgentCount > 0
                  ? "border-destructive/30 bg-destructive/8 text-destructive"
                  : hasUnread
                  ? "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400"
                  : "border-border/60 bg-secondary/50 text-foreground hover:bg-card hover:border-primary/30",
              ].join(" ")}
            >
              <Bell className="h-4 w-4 sm:h-[18px] sm:w-[18px]" />
              {hasUnread && (
                <span
                  data-testid="header-notifications-badge"
                  aria-hidden="true"
                  className={[
                    "absolute -top-1 -right-1 flex h-4 min-w-4 px-0.5 items-center justify-center rounded-full text-[8px] font-black text-white ring-2 ring-background",
                    unreadUrgentCount > 0 ? "bg-destructive" : "bg-amber-500",
                  ].join(" ")}
                >
                  {badgeCount}
                </span>
              )}
            </button>

            {showNotifications && (
              <NotificationPanel
                alerts={alerts}
                unreadCount={badgeCount}
                onClose={handleCloseNotifications}
                triggerRef={bellTriggerRef}
              />
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
