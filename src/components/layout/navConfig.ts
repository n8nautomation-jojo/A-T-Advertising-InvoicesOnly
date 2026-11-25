import type React from "react";
import {
  Home,
  ClipboardList,
  Receipt,
  Settings as SettingsIcon,
  BarChart3,
  Users,
  Truck,
  Wallet,
} from "lucide-react";

export interface NavItemConfig {
  to: string;
  label: string;
  subtitle: string;
  icon: React.ElementType;
  gradient: string;
  showInvoiceBadge?: boolean;
}

export const SIDEBAR_NAV_ITEMS: NavItemConfig[] = [
  {
    to: "/",
    label: "الصفحة الرئيسية",
    subtitle: "الرئيسية وأقسام الوكالة الإعلانية",
    icon: Home,
    gradient: "from-[#0D4A39] to-[#168063] shadow-[#168063]/30",
  },
  {
    to: "/billing",
    label: "مركز إصدار الفواتير",
    subtitle: "إصدار فواتير المبيعات، المشتريات، وعروض الأسعار A4",
    icon: Receipt,
    gradient: "from-[#168063] to-[#22A07E] shadow-[#168063]/30",
  },
  {
    to: "/customers",
    label: "العملاء",
    subtitle: "سجل العملاء وكشوف حساباتهم",
    icon: Users,
    gradient: "from-[#0E7490] to-[#0891B2] shadow-cyan-500/20",
  },
  {
    to: "/suppliers",
    label: "الموردون",
    subtitle: "الموردون ومقدّمو الخدمات الإعلانية وأرصدتهم",
    icon: Truck,
    gradient: "from-[#B45309] to-[#D97706] shadow-amber-500/20",
  },
  {
    to: "/finance",
    label: "المالية",
    subtitle: "التحصيلات والمدفوعات والحسابات والذمم",
    icon: Wallet,
    gradient: "from-[#047857] to-[#10B981] shadow-emerald-500/20",
  },
  {
    to: "/expenses",
    label: "المصروفات",
    subtitle: "تكاليف تنفيذ مباشرة ومصروفات تشغيلية",
    icon: Receipt,
    gradient: "from-[#BE123C] to-[#E11D48] shadow-rose-500/20",
  },
  {
    to: "/orders",
    label: "سجل وأرشيف الفواتير",
    subtitle: "متابعة الفواتير المحفوظة والطباعة وإعادة التصدير",
    icon: ClipboardList,
    gradient: "from-[#0C251E] to-[#1B4D40] shadow-black/20",
    showInvoiceBadge: true,
  },
  {
    to: "/reports",
    label: "التقارير ومؤشرات أداء الفواتير",
    subtitle: "مراقبة الإيرادات، التحصيلات، وسرعة إنجاز الفواتير",
    icon: BarChart3,
    gradient: "from-[#0F766E] to-[#0D9488] shadow-teal-500/20",
  },
  {
    to: "/settings",
    label: "الإعدادات وقفل الأمان",
    subtitle: "أمان النظام، البصمة، وتخصيص المظهر",
    icon: SettingsIcon,
    gradient: "from-[#071914] to-[#0D4A39] shadow-black/30",
  },
];

export function getTourSectionFromPath(pathname: string): { id: string; label: string } {
  if (pathname.startsWith("/bank-accounts")) return { id: "finance", label: "الحسابات البنكية وكشف الحساب" };
  if (pathname.startsWith("/billing")) return { id: "billing", label: "الفواتير والمطالبات A4" };
  if (pathname.startsWith("/orders")) return { id: "orders", label: "أرشيف الفواتير والسجل" };
  if (pathname.startsWith("/reports")) return { id: "reports", label: "التقارير والمؤشرات المالية" };
  if (pathname.startsWith("/finance")) return { id: "finance", label: "الخزينة والحسابات والتحصيلات" };
  if (pathname.startsWith("/customers")) return { id: "customers", label: "دليل العملاء والحسابات" };
  if (pathname.startsWith("/suppliers")) return { id: "suppliers", label: "دليل الموردين والالتزامات" };
  if (pathname.startsWith("/expenses")) return { id: "expenses", label: "المصروفات التشغيلية والمباشرة" };
  if (pathname.startsWith("/settings")) return { id: "settings", label: "الأمان والنسخ الاحتياطي" };
  return { id: "home", label: "الصفحة الرئيسية" };
}
