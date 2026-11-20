import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { router } from "./router";
import { Capacitor } from "@capacitor/core";
import { App as CapApp } from "@capacitor/app";
import { StatusBar, Style } from "@capacitor/status-bar";
import { triggerBack } from "./lib/backButtonHandler";
import { initSQLiteStorage } from "./lib/sqliteStorage";
import { ensureScheduledBackups } from "./lib/backup/autoBackup";
import { runPreMigrationNativeBackup, runPreUpdateBackupIfNeeded } from "./lib/backup/restoreService";
import { toast } from "sonner";
import "./styles.css";

// تسجيل الأخطاء العامة غير الملتقطة لتشخيص أي خلل إنتاجي دون ابتلاعها بصمت
if (typeof window !== "undefined") {
  window.__TA_STORAGE_READY__ = false;

  window.addEventListener("unhandledrejection", (event) => {
    console.error("[Global] Unhandled promise rejection:", event.reason);
  });

  window.addEventListener("error", (event) => {
    console.error("[Global] Uncaught runtime error:", event.error ?? event.message);
  });
}

// أخذ نسخة أمان أصلية قبل فتح قاعدة البيانات أو تشغيل أي ترحيل، ثم تهيئة SQLite
const storageInitPromise = (async () => {
  if (Capacitor.isNativePlatform()) {
    await runPreMigrationNativeBackup(4000);
  }
  await initSQLiteStorage();
  if (typeof window !== "undefined") {
    window.__TA_STORAGE_READY__ = true;
  }
})().catch((err) => {
  console.error("SQLite storage init error:", err);
});

/**
 * نسخة احتياطية قبل أي ترقية لقاعدة البيانات + إعادة تثبيت الجدولة اليومية.
 * تعمل بعد نجاح تهيئة قاعدة البيانات وقبل أن يلمس المستخدم أي بيانات.
 */
void storageInitPromise.then(async () => {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await runPreUpdateBackupIfNeeded(true);
    await ensureScheduledBackups();
  } catch (err) {
    console.warn("Backup startup tasks warning:", err);
  }
});

// ربط أمر الطباعة العام بجسر أندرويد الأصلي مع منع ظهور صفحة بيضاء
if (typeof window !== "undefined" && window.AndroidPrint) {
  window.print = function () {
    const targetElement =
      document.querySelector<HTMLElement>(".invoice-print-root") ||
      document.querySelector<HTMLElement>("#custom-invoice-print-portal") ||
      document.querySelector<HTMLElement>(".custom-invoice-print-root") ||
      document.querySelector<HTMLElement>(".proforma-print-root") ||
      document.querySelector<HTMLElement>(".invoice-paper") ||
      document.querySelector<HTMLElement>(".standard-invoice-sheet") ||
      document.querySelector<HTMLElement>(".proforma-sheet");

    const isA5 =
      targetElement?.classList.contains("invoice-paper") ||
      targetElement?.querySelector(".invoice-paper") !== null ||
      (Boolean(document.title) && (document.title.includes("طلب") || document.title.includes("تشغيل")));
    const pageSize: "a4" | "a5" = isA5 ? "a5" : "a4";

    if (targetElement && typeof window.AndroidPrint?.printHtml === "function") {
      void import("./lib/pdfExport")
        .then(({ buildStandaloneInvoiceHtml }) => {
          const html = buildStandaloneInvoiceHtml(targetElement, document.title || "فاتورة-TA", pageSize);
          window.AndroidPrint?.printHtml?.(html, document.title || "فاتورة-TA", pageSize.toUpperCase());
        })
        .catch((err) => {
          console.error("[Print] Failed to prepare standalone invoice HTML:", err);
          toast.error("تعذر تجهيز مستند الطباعة");
        });
      return;
    }

    toast.error("يرجى فتح أو تحديد الفاتورة قبل طلب الطباعة");
  };
}

// Native Android optimizations & hardware back button handling
if (Capacitor.isNativePlatform()) {
  StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
  StatusBar.setBackgroundColor({ color: "#0D4A39" }).catch(() => {});

  let lastBackPressTime = 0;

  void CapApp.addListener("backButton", () => {
    // 1. Check custom registered handlers (modals, dialogs, drawers)
    if (triggerBack()) {
      return;
    }

    // 2. Check DOM for any open dialog or drawer close button
    const closeBtn = document.querySelector(
      '[role="dialog"] button[aria-label="إغلاق"], [role="dialog"] button[aria-label="Close"], [data-state="open"] button[aria-label="Close"], [data-state="open"] button[data-dialog-close]'
    ) as HTMLElement | null;
    if (closeBtn) {
      closeBtn.click();
      return;
    }

    // 3. If currently on a sub-route, return hierarchically to home dashboard (/)
    const hash = window.location.hash;
    if (hash && hash !== "#/" && hash !== "") {
      void router.navigate({ to: "/" });
      return;
    }

    // 4. Double tap back button to exit on home screen
    const now = Date.now();
    if (now - lastBackPressTime < 2000) {
      void CapApp.exitApp();
    } else {
      lastBackPressTime = now;
      toast("اضغط مرة أخرى للخروج من التطبيق", { duration: 1500 });
    }
  });
}

const rootEl = document.getElementById("root");
if (rootEl) {
  let rendered = false;
  const renderApp = () => {
    if (rendered) return;
    rendered = true;
    ReactDOM.createRoot(rootEl).render(
      <React.StrictMode>
        <RouterProvider router={router} />
      </React.StrictMode>
    );
  };

  // انتظار تهيئة SQLite وتحميل الإعدادات قبل عرض الواجهة مع مهلة أمان لمنع التجميد الأبدي
  // (مع بقاء PasswordLock مغلقاً تلقائياً Fail-Closed حتى تكتمل التهيئة)
  const safetyTimer = setTimeout(renderApp, 8000);
  void storageInitPromise.finally(() => {
    clearTimeout(safetyTimer);
    renderApp();
  });
}
