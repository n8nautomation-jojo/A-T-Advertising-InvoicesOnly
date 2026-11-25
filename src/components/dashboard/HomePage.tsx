import React, { Suspense, lazy, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  Building2,
  Calendar,
  FileSignature,
  Plus,
} from "lucide-react";
import { PageShell } from "@/components/layout/PageShell";
import { ModuleGrid } from "@/components/dashboard/ModuleGrid";
import { useUserProfile } from "@/lib/userProfileStore";
import { UserProfileDialog } from "@/components/common/UserProfileDialog";
import { AppTourLauncherBanner } from "@/components/common/AppTourAssistant";
import { BankBalanceGreetingWidget } from "@/components/finance/BankBalanceGreetingWidget";

const LetterIssuerDialog = lazy(() => import("@/components/letters/LetterIssuerDialog"));

function getGreeting(name?: string) {
  const h = new Date().getHours();
  const trimmed = (name || "").trim();
  const namePart = trimmed ? ` يا ${trimmed}` : "";
  if (h >= 5 && h < 12) return { text: `صباح الخير${namePart}`, emoji: "☀️" };
  if (h >= 12 && h < 17) return { text: `نهارك سعيد${namePart}`, emoji: "🌤️" };
  if (h >= 17 && h < 21) return { text: `مساء الخير${namePart}`, emoji: "🌇" };
  return { text: `مرحباً بك${namePart}`, emoji: "🌙" };
}

/**
 * الصفحة الرئيسية للنظام — واجهة سريعة وخفيفة لوكالة T.A Advertising Solution
 * تعرض بطاقة الترحيب ومستطيل الرصيد البنكي الحي (4 عملات) وقسم الأيقونات الشبكي.
 */
export function HomePage() {
  const { userName } = useUserProfile();
  const [showProfileEdit, setShowProfileEdit] = useState(false);
  const [letterDialogOpen, setLetterDialogOpen] = useState(false);

  const greeting = useMemo(() => getGreeting(userName), [userName]);

  const todayDateStr = useMemo(() => {
    try {
      return new Intl.DateTimeFormat("ar", {
        weekday: "long",
        day: "numeric",
        month: "long",
      }).format(new Date());
    } catch {
      return "";
    }
  }, []);

  return (
    <PageShell>
      <main
        className="w-full flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-y-contain px-3 py-3 md:px-6 md:py-5 min-w-0 pb-36 md:pb-16"
        dir="rtl"
      >
        <div className="mx-auto max-w-7xl space-y-4 w-full max-w-full">
          {/* 1. بطاقة الترحيب ومستطيل الحساب البنكي التفاعلي والهوية المؤسسية للوكالة */}
          <section className="relative overflow-hidden rounded-2xl border border-border/80 dark:border-primary/20 bg-gradient-to-br from-card via-card to-primary/[0.06] p-4 sm:p-5 shadow-2xs">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3.5">
              <div className="flex flex-col sm:flex-row sm:items-center gap-3.5 min-w-0 flex-1">
                <div className="space-y-1.5 min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 border border-primary/20 px-2.5 py-0.5 text-[10.5px] font-black text-primary">
                      <Building2 className="h-3 w-3" />
                      <span>وكالة دعاية وإعلان</span>
                    </span>
                    {todayDateStr && (
                      <span className="inline-flex items-center gap-1 text-[11px] font-bold text-muted-foreground">
                        <Calendar className="h-3.5 w-3.5 text-primary/75" />
                        <span>{todayDateStr}</span>
                      </span>
                    )}
                  </div>

                  <div className="flex items-baseline gap-2 pt-0.5 flex-wrap">
                    <span className="text-lg sm:text-xl select-none">{greeting.emoji}</span>
                    <h1 className="text-base sm:text-xl font-black text-foreground tracking-tight">
                      {greeting.text}
                    </h1>
                    <button
                      type="button"
                      onClick={() => setShowProfileEdit(true)}
                      className="text-[11px] font-bold text-muted-foreground hover:text-primary transition-colors cursor-pointer"
                    >
                      (تعديل الاسم)
                    </button>
                  </div>

                  <p className="text-[11.5px] sm:text-xs text-muted-foreground font-medium leading-relaxed max-w-2xl">
                    نظام إدارة وتوثيق الفواتير والعمليات المالية لوكالة T.A Advertising Solution
                  </p>
                </div>

                {/* مستطيل الرصيد البنكي التفاعلي بجوار رسالة الترحيب */}
                <div className="shrink-0">
                  <BankBalanceGreetingWidget />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <Link
                  to="/billing"
                  className="inline-flex h-9.5 items-center gap-1.5 rounded-xl bg-primary px-4 text-xs font-black text-white shadow-xs shadow-primary/25 hover:bg-primary/90 active:scale-[0.98] transition-all cursor-pointer"
                >
                  <Plus className="h-4 w-4" />
                  <span>إصدار فاتورة</span>
                </Link>
                <button
                  type="button"
                  onClick={() => setLetterDialogOpen(true)}
                  className="inline-flex h-9.5 items-center gap-1.5 rounded-xl border border-[#C5A059]/60 bg-card px-3.5 text-xs font-black text-primary hover:bg-primary/5 hover:border-primary/50 active:scale-[0.98] transition-all cursor-pointer shadow-2xs"
                >
                  <FileSignature className="h-4 w-4 text-[#C5A059]" />
                  <span>إصدار خطاب</span>
                </button>
              </div>
            </div>
          </section>

          {/* شريط المساعد التعليمي والجولة السريعة — خفيف وغير مزعج ويمكن إخفاؤه */}
          <AppTourLauncherBanner />

          {/* 2. وحدات وأقسام الوكالة الإعلانية */}
          <section className="space-y-2.5 pt-1">
            <div className="flex items-center justify-between px-0.5">
              <h2 className="text-xs sm:text-sm font-black text-foreground/90">أقسام إدارة الوكالة</h2>
              <span className="text-[10.5px] font-bold text-muted-foreground bg-muted/40 px-2 py-0.5 rounded-full border border-border/50">
                8 أقسام معتمدة
              </span>
            </div>
            <ModuleGrid />
          </section>
        </div>
      </main>

      <UserProfileDialog
        isOpen={showProfileEdit}
        onClose={() => setShowProfileEdit(false)}
      />

      {letterDialogOpen && (
        <Suspense fallback={null}>
          <LetterIssuerDialog
            open={letterDialogOpen}
            onOpenChange={setLetterDialogOpen}
          />
        </Suspense>
      )}
    </PageShell>
  );
}

export default HomePage;
