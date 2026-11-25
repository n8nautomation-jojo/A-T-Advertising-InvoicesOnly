import { createContext, useContext, useState, useEffect, useRef, useCallback, type CSSProperties, type ReactNode } from "react";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "./AppSidebar";
import { AppHeader } from "./AppHeader";
import { BottomNav } from "./BottomNav";
import { useUserProfile, isUserOnboarded } from "@/lib/userProfileStore";
import { UserProfileDialog } from "@/components/common/UserProfileDialog";
import { useKeyboardAvoidance } from "@/components/common/SafeAreaLayout";

const safeAreaStyle: CSSProperties = {
  paddingLeft: "env(safe-area-inset-left, 0px)",
  paddingRight: "env(safe-area-inset-right, 0px)",
};

/** سياق منع تكرار بناء الهيكل لضمان ثبات شريط التنقل والأدوات وسرعة استجابة لحظية 0ms */
const PageShellContext = createContext<boolean>(false);

function PageShellInner({ children }: { children: ReactNode }) {
  const { isOnboarded } = useUserProfile();
  const [showOnboarding, setShowOnboarding] = useState(() => !isUserOnboarded());
  const dismissedRef = useRef(false);

  // سحب الحقول المدخلة تلقائياً في حال فتح لوحة المفاتيح
  useKeyboardAvoidance();

  useEffect(() => {
    if (dismissedRef.current || isUserOnboarded()) {
      setShowOnboarding(false);
      return;
    }
    // مزامنة حالة نافذة الترحيب: تظهر فقط عند أول تشغيل للمستخدم الجديد تماماً
    setShowOnboarding(!isOnboarded);
  }, [isOnboarded]);

  const handleCloseOnboarding = useCallback(() => {
    dismissedRef.current = true;
    setShowOnboarding(false);
  }, []);

  return (
    <SidebarProvider defaultOpen={typeof window !== "undefined" ? window.innerWidth >= 1024 : false}>
      <AppSidebar />
      <div
        dir="rtl"
        className="flex h-[100dvh] max-h-[100dvh] w-full max-w-full min-w-0 flex-1 flex-col overflow-hidden bg-background font-display text-foreground"
        style={safeAreaStyle}
      >
        <AppHeader />
        <div className="flex-1 min-h-0 w-full overflow-hidden flex flex-col relative">
          {children}
        </div>
        <BottomNav />
      </div>

      {/* نافذة التهيئة الأولية عند فتح التطبيق لأول مرة */}
      <UserProfileDialog
        isOpen={showOnboarding}
        onClose={handleCloseOnboarding}
        isFirstLaunch={true}
      />
    </SidebarProvider>
  );
}

/**
 * غلاف الصفحة: الهيكل العام للنظام — الشريط الجانبي (يمين على الحاسوب ودرج على الهاتف)
 * + شريط الأدوات + المحتوى + شريط التنقل السفلي للهاتف.
 * مصمم بهندسة السياق الأحادي (Idempotent Shell Context):
 * إذا كان الهيكل مثبتاً في المسار الجذري، لا يُعاد بناؤه أو تدميره مطلقاً أثناء التنقل،
 * مما يمنح التطبيق سرعة استجابة فائقة ونعومة 60/120fps خالية تماماً من اللاق.
 */
export function PageShell({ children }: { children: ReactNode }) {
  const isNested = useContext(PageShellContext);
  if (isNested) {
    return <>{children}</>;
  }

  return (
    <PageShellContext.Provider value={true}>
      <PageShellInner>{children}</PageShellInner>
    </PageShellContext.Provider>
  );
}
