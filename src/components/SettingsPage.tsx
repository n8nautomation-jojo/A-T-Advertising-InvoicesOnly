import React, { useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  Moon,
  Sun,
  Volume2,
  VolumeX,
  HardDriveDownload,
  Building2,
  Lock,
  Sliders,
} from "lucide-react";
import { useTheme } from "@/hooks/useTheme";
import { PageShell } from "@/components/layout/PageShell";
import { Switch } from "@/components/ui/switch";
import {
  isSoundEnabled,
  setSoundEnabled,
  playSuccessSound,
  playTapSound,
} from "@/lib/soundEffects";
import { toast } from "sonner";
import { APP_VERSION } from "@/lib/appVersion";
import { useCompanyProfile } from "@/lib/settings/companyProfileStore";
import { BiometricDiagnosticsDialog } from "@/components/settings/BiometricDiagnosticsDialog";
import { BiometricSettingsCard } from "@/components/settings/BiometricSettingsCard";
import { PasswordChangeCard } from "@/components/settings/PasswordChangeCard";
import { BackupManagerCard } from "@/components/settings/BackupManagerCard";
import { StorageIntegrityCard } from "@/components/settings/StorageIntegrityCard";
import { CompanyProfileCard } from "@/components/settings/CompanyProfileCard";
import { useBiometricSettings } from "@/components/settings/useBiometricSettings";
import { cn } from "@/lib/utils";

type SettingsTab = "backup" | "profile" | "security" | "system";

const Settings: React.FC = () => {
  const { theme, toggle } = useTheme();
  const [activeTab, setActiveTab] = useState<SettingsTab>("backup");
  const { addressAr } = useCompanyProfile();

  const {
    bioAvailable,
    bioEnabled,
    bioBusy,
    handleToggleBiometric,
    diagOpen,
    setDiagOpen,
    diag,
    diagLoading,
    openDiagnostics,
    copyDiagLabel,
  } = useBiometricSettings();

  const [soundEnabled, setSoundState] = useState(() => isSoundEnabled());

  const handleToggleSound = (checked: boolean) => {
    setSoundState(checked);
    setSoundEnabled(checked);
    if (checked) {
      playSuccessSound();
      toast.success("تم تشغيل المؤثرات الصوتية", {
        description: "ستسمع نقرات تفاعلية خفيفة وأصوات تأكيد مريحة.",
      });
    } else {
      toast("تم كتم المؤثرات الصوتية", {
        description: "التطبيق يعمل الآن في الوضع الصامت تماماً.",
      });
    }
  };

  const tabs = [
    {
      id: "backup" as const,
      label: "النسخ والبيانات",
      icon: HardDriveDownload,
    },
    {
      id: "profile" as const,
      label: "بيانات الفاتورة",
      icon: Building2,
    },
    {
      id: "security" as const,
      label: "الأمان والقفل",
      icon: Lock,
    },
    {
      id: "system" as const,
      label: "المظهر والنظام",
      icon: Sliders,
    },
  ];

  return (
    <PageShell>
      <main className="mx-auto flex w-full max-w-md flex-1 min-h-0 flex-col gap-3.5 overflow-y-auto overflow-x-hidden px-4 py-4 pb-36 md:max-w-3xl md:pb-16 overscroll-y-contain">
        {/* Header */}
        <div className="flex items-center justify-between gap-2 border-b border-border/50 pb-3">
          <div className="flex items-center gap-2.5">
            <Link
              to="/"
              aria-label="رجوع"
              className="grid h-10 w-10 place-items-center rounded-2xl border border-border/80 bg-secondary text-foreground transition-all hover:border-primary/40 hover:text-primary hover:shadow-sm active:scale-95 touch-manipulation"
            >
              <ArrowRight className="h-5 w-5" />
            </Link>
            <div>
              <h1 className="text-base font-black tracking-tight text-foreground">
                إعدادات النظام
              </h1>
              <p className="text-[11px] text-muted-foreground">
                T.A Advertising Solution
              </p>
            </div>
          </div>
          <span className="rounded-full bg-primary/10 text-primary border border-primary/20 px-2.5 py-0.5 text-[10px] font-mono font-bold">
            v{APP_VERSION}
          </span>
        </div>

        {/* بطاقة تعريف المنشأة والمسؤول وأرقام التواصل الرسمية بتنسيق LTR سليم */}
        <section className="rounded-2xl border border-primary/20 bg-gradient-to-br from-card via-card to-primary/5 p-4 shadow-2xs select-none">
          <div className="flex items-center gap-3">
            <div className="grid h-12 w-12 place-items-center rounded-2xl bg-primary/10 text-primary border border-primary/20 font-black text-sm shrink-0">
              T.A
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-black text-foreground">T.A Advertising Solution</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                المسؤول: طارق عثمان علي • {addressAr || "الخرطوم - بورتسودان"}
              </p>
              <div
                className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground font-mono"
                dir="ltr"
                style={{ direction: "ltr", unicodeBidi: "isolate" }}
              >
                <bdi dir="ltr" className="font-bold text-foreground/85 tracking-tight">
                  +249 12371 1444
                </bdi>
                <span className="text-muted-foreground/50 mx-0.5">•</span>
                <bdi dir="ltr" className="font-bold text-foreground/85 tracking-tight">
                  +249 91296 8886
                </bdi>
              </div>
            </div>
          </div>
        </section>

        {/* Executive Segmented Navigation Tabs */}
        <div className="grid grid-cols-4 gap-1.5 p-1 rounded-2xl bg-muted/40 border border-border/60">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  playTapSound();
                  setActiveTab(tab.id);
                }}
                className={cn(
                  "flex flex-col items-center justify-center gap-1 py-2 px-1 rounded-xl text-center transition-all touch-manipulation",
                  isActive
                    ? "bg-primary text-primary-foreground font-black shadow-sm"
                    : "text-muted-foreground hover:text-foreground font-bold hover:bg-muted/50"
                )}
              >
                <Icon className="h-4 w-4" />
                <span className="text-[10.5px] leading-tight truncate w-full">
                  {tab.label}
                </span>
              </button>
            );
          })}
        </div>

        {/* Tab 1: Backup & Safety */}
        {activeTab === "backup" && (
          <div className="space-y-4 animate-in fade-in-50 duration-200">
            <BackupManagerCard />
          </div>
        )}

        {/* Tab 2: Company Profile in Invoices */}
        {activeTab === "profile" && (
          <div className="space-y-4 animate-in fade-in-50 duration-200">
            <CompanyProfileCard />
          </div>
        )}

        {/* Tab 3: Security & Lock */}
        {activeTab === "security" && (
          <div className="space-y-4 animate-in fade-in-50 duration-200">
            <BiometricSettingsCard
              bioAvailable={bioAvailable}
              bioEnabled={bioEnabled}
              bioBusy={bioBusy}
              onToggleBiometric={handleToggleBiometric}
              onOpenDiagnostics={openDiagnostics}
            />
            <PasswordChangeCard />
          </div>
        )}

        {/* Tab 4: System & Appearance */}
        {activeTab === "system" && (
          <div className="space-y-4 animate-in fade-in-50 duration-200">
            <section className="rounded-2xl sm:rounded-3xl border border-primary/20 bg-card p-4 sm:p-5 shadow-sm space-y-4">
              <h2 className="text-xs font-black text-foreground border-b border-border/60 pb-2">
                المظهر والمؤثرات
              </h2>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10">
                    {theme === "dark" ? (
                      <Moon className="h-5 w-5 text-primary" />
                    ) : (
                      <Sun className="h-5 w-5 text-primary" />
                    )}
                  </div>
                  <div>
                    <p className="text-sm font-bold text-foreground">
                      الوضع الليلي (Obsidian)
                    </p>
                    <p className="text-xs text-muted-foreground">
                      التبديل بين النمط الزمردي النهاري والليلي الفاخر
                    </p>
                  </div>
                </div>
                <Switch
                  checked={theme === "dark"}
                  onCheckedChange={toggle}
                  aria-label="تبديل الوضع الليلي"
                />
              </div>

              <div className="h-px bg-border/40" />

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div
                    className={`grid h-10 w-10 place-items-center rounded-xl transition-colors ${
                      soundEnabled
                        ? "bg-primary/10 text-primary"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {soundEnabled ? (
                      <Volume2 className="h-5 w-5" />
                    ) : (
                      <VolumeX className="h-5 w-5" />
                    )}
                  </div>
                  <div>
                    <p className="text-sm font-bold text-foreground">
                      المؤثرات الصوتية التفاعلية
                    </p>
                    <p className="text-xs text-muted-foreground">
                      أصوات ذكية خفيفة عند الحساب، الإضافة، وحفظ الفواتير
                    </p>
                  </div>
                </div>
                <Switch
                  checked={soundEnabled}
                  onCheckedChange={handleToggleSound}
                  aria-label="تبديل المؤثرات الصوتية"
                />
              </div>
            </section>

            <StorageIntegrityCard />
          </div>
        )}

        <p className="text-center text-[11px] text-muted-foreground pt-2">
          © T.A Advertising Solution — {addressAr || "الخرطوم - بورتسودان"}
        </p>
      </main>

      <BiometricDiagnosticsDialog
        open={diagOpen}
        onOpenChange={setDiagOpen}
        diag={diag}
        loading={diagLoading}
        onRefresh={openDiagnostics}
        onCopyLabel={copyDiagLabel}
      />
    </PageShell>
  );
};

export default Settings;
