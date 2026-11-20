import { useEffect, useRef, type RefObject } from "react";
import { X, AlertCircle, Clock, Receipt, ChevronLeft } from "lucide-react";
import { Link } from "@tanstack/react-router";

export interface AppNotificationItem {
  id: string;
  severity: "urgent" | "warn";
  kind: "overdue_invoice" | "open_invoice" | "unpaid_expense";
  title: string;
  subtitle: string;
  to: "/finance" | "/expenses" | "/customers";
  search?: { id?: string };
}

interface NotificationPanelProps {
  alerts: AppNotificationItem[];
  onClose: () => void;
  triggerRef?: RefObject<HTMLButtonElement | null>;
}

export function NotificationPanel({ alerts, onClose, triggerRef }: NotificationPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (triggerRef?.current?.contains(target)) return;
      onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose, triggerRef]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const urgentCount = alerts.filter((a) => a.severity === "urgent").length;

  return (
    <div
      ref={panelRef}
      dir="rtl"
      role="dialog"
      aria-label="لوحة التنبيهات"
      className={[
        "absolute left-0 top-full mt-2 w-[min(21rem,calc(100vw-2.5rem))] z-50",
        "rounded-2xl border border-border/80 bg-card",
        "shadow-float animate-slide-up",
        "overflow-hidden backdrop-blur-md",
      ].join(" ")}
    >
      <div className="flex items-center justify-between border-b border-border/60 bg-secondary/30 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-black text-foreground">
            تنبيهات الفواتير والأعمال
          </span>
          <span
            className={[
              "rounded-full px-2 py-0.5 text-[10px] font-black",
              urgentCount > 0
                ? "bg-destructive/10 text-destructive"
                : alerts.length > 0
                ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
            ].join(" ")}
          >
            {urgentCount > 0
              ? `${urgentCount} متأخر`
              : alerts.length > 0
              ? `${alerts.length} للمتابعة`
              : "كل شيء بخير ✓"}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="إغلاق التنبيهات"
          className="grid h-7 w-7 place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors interactive"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="max-h-72 overflow-y-auto overscroll-contain">
        {alerts.length > 0 ? (
          <div className="divide-y divide-border/40">
            {alerts.map((item) => (
              <Link
                key={item.id}
                to={item.to}
                search={item.search}
                onClick={onClose}
                className="flex items-start gap-3 px-4 py-3 hover:bg-secondary/40 transition-colors"
              >
                <span
                  className={[
                    "mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-xl",
                    item.severity === "urgent"
                      ? "bg-destructive/10 text-destructive"
                      : "bg-amber-500/10 text-amber-600 dark:text-amber-400",
                  ].join(" ")}
                >
                  {item.kind === "overdue_invoice" ? (
                    <AlertCircle className="h-3.5 w-3.5" />
                  ) : item.kind === "open_invoice" ? (
                    <Clock className="h-3.5 w-3.5" />
                  ) : (
                    <Receipt className="h-3.5 w-3.5" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-black text-foreground truncate">{item.title}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                    {item.subtitle}
                  </p>
                </div>
                <ChevronLeft className="h-3.5 w-3.5 shrink-0 text-muted-foreground mt-1.5" />
              </Link>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 py-8 px-4 text-center">
            <span className="text-2xl">👍</span>
            <p className="text-xs font-bold text-muted-foreground">
              كل الأعمال والفواتير تسير بنظام ✓
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
