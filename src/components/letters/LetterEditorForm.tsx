import React, { useState } from "react";
import {
  Calendar,
  Check,
  FileText,
  Globe,
  PenTool,
  QrCode,
  Stamp,
  User,
  Users,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { CustomerPickerModal } from "@/components/customers/CustomerPickerModal";
import {
  DEFAULT_BODY_AR,
  DEFAULT_BODY_EN,
  DEFAULT_CLOSING_AR,
  DEFAULT_CLOSING_EN,
  DEFAULT_SALUTATION_AR,
  DEFAULT_SALUTATION_EN,
  DEFAULT_SIGNATORY_NAME_AR,
  DEFAULT_SIGNATORY_NAME_EN,
  DEFAULT_SIGNATORY_TITLE_AR,
  DEFAULT_SIGNATORY_TITLE_EN,
  DEFAULT_SUBJECT_AR,
  DEFAULT_SUBJECT_EN,
  RECIPIENT_HONORIFIC_OPTIONS_AR,
  RECIPIENT_HONORIFIC_OPTIONS_EN,
} from "@/lib/letters/templates";
import type { LetterLanguage, OfficialLetter } from "@/lib/letters/types";
import { getLocalIsoDate } from "@/lib/dateUtils";
import { playTapSound } from "@/lib/soundEffects";

interface Props {
  letter: OfficialLetter;
  onChange: (patch: Partial<OfficialLetter>) => void;
}

export function LetterEditorForm({ letter, onChange }: Props) {
  const [customerPickerOpen, setCustomerPickerOpen] = useState(false);
  const isEn = letter.language === "en";
  const honorificOptions = isEn ? RECIPIENT_HONORIFIC_OPTIONS_EN : RECIPIENT_HONORIFIC_OPTIONS_AR;

  const handleSwitchLanguage = (targetLang: LetterLanguage) => {
    playTapSound();
    if (targetLang === letter.language) return;

    if (targetLang === "en") {
      onChange({
        language: "en",
        recipientHonorific:
          letter.recipientHonorific === "إلى من يهمه الأمر" ? "To Whom It May Concern" : "Messrs.",
        salutation:
          letter.salutation === DEFAULT_SALUTATION_AR ? DEFAULT_SALUTATION_EN : letter.salutation,
        closingPhrase:
          letter.closingPhrase === DEFAULT_CLOSING_AR ? DEFAULT_CLOSING_EN : letter.closingPhrase,
        signatoryName:
          letter.signatoryName === DEFAULT_SIGNATORY_NAME_AR
            ? DEFAULT_SIGNATORY_NAME_EN
            : letter.signatoryName,
        signatoryTitle:
          letter.signatoryTitle === DEFAULT_SIGNATORY_TITLE_AR
            ? DEFAULT_SIGNATORY_TITLE_EN
            : letter.signatoryTitle,
        subject: letter.subject === DEFAULT_SUBJECT_AR ? DEFAULT_SUBJECT_EN : letter.subject,
        body: letter.body === DEFAULT_BODY_AR ? DEFAULT_BODY_EN : letter.body,
      });
      return;
    }

    onChange({
      language: "ar",
      recipientHonorific:
        letter.recipientHonorific === "To Whom It May Concern" ? "إلى من يهمه الأمر" : "السادة /",
      salutation:
        letter.salutation === DEFAULT_SALUTATION_EN ? DEFAULT_SALUTATION_AR : letter.salutation,
      closingPhrase:
        letter.closingPhrase === DEFAULT_CLOSING_EN ? DEFAULT_CLOSING_AR : letter.closingPhrase,
      signatoryName:
        letter.signatoryName === DEFAULT_SIGNATORY_NAME_EN
          ? DEFAULT_SIGNATORY_NAME_AR
          : letter.signatoryName,
      signatoryTitle:
        letter.signatoryTitle === DEFAULT_SIGNATORY_TITLE_EN
          ? DEFAULT_SIGNATORY_TITLE_AR
          : letter.signatoryTitle,
      subject: letter.subject === DEFAULT_SUBJECT_EN ? DEFAULT_SUBJECT_AR : letter.subject,
      body: letter.body === DEFAULT_BODY_EN ? DEFAULT_BODY_AR : letter.body,
    });
  };

  return (
    <div className="space-y-3.5" dir="rtl">
      {/* 1. محدد لغة واتجاه الورقة (يدوي حسب مدخلات المستخدم) */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-border/80 bg-card p-3 shadow-2xs">
        <div className="flex items-center gap-2">
          <Globe className="h-4 w-4 text-primary shrink-0" />
          <span className="text-xs font-black text-foreground">لغة الخطاب واتجاه الورقة:</span>
        </div>

        <div className="inline-flex rounded-xl border border-border/80 bg-secondary/60 p-0.5">
          {(
            [
              { id: "ar" as const, label: "العربية (RTL)" },
              { id: "en" as const, label: "English (LTR)" },
            ] as const
          ).map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => handleSwitchLanguage(opt.id)}
              className={`px-3 py-1 rounded-lg text-[11px] font-black transition cursor-pointer ${
                letter.language === opt.id
                  ? "bg-primary text-white shadow-2xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* 2. بيانات الجهة أو الشخص الموجَّه إليه الخطاب */}
      <div className="rounded-2xl border border-border/80 bg-card p-3 sm:p-4 space-y-3 shadow-2xs">
        <div className="flex items-center justify-between gap-2 border-b border-border/50 pb-2">
          <div className="flex items-center gap-1.5">
            <span className="grid h-5 w-5 place-items-center rounded-md bg-primary/10 text-primary text-[11px] font-black">
              1
            </span>
            <span className="text-xs sm:text-sm font-black text-foreground">
              الجهة أو الشخص الموجَّه إليه الخطاب
            </span>
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              playTapSound();
              setCustomerPickerOpen(true);
            }}
            className="h-8 px-2.5 rounded-lg border-primary/40 bg-primary/10 hover:bg-primary hover:text-white text-primary text-[11px] font-black gap-1.5 cursor-pointer"
          >
            <Users className="h-3.5 w-3.5" />
            <span>اختيار من العملاء</span>
          </Button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          <div className="space-y-1">
            <Label className="text-[11px] font-black text-foreground">صيغة المخاطبة</Label>
            <select
              aria-label="صيغة المخاطبة"
              value={letter.recipientHonorific}
              onChange={(e) => onChange({ recipientHonorific: e.target.value })}
              className="h-10 w-full rounded-xl border border-border/80 bg-background px-3 text-xs font-bold text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            >
              {honorificOptions.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>

          <div className="sm:col-span-2 space-y-1">
            <Label className="text-[11px] font-black text-foreground flex items-center gap-1">
              <User className="h-3 w-3 text-primary" />
              <span>اسم الجهة / الشركة أو الشخص</span>
            </Label>
            <Input
              dir={isEn ? "ltr" : "rtl"}
              value={letter.recipientName}
              onChange={(e) => onChange({ recipientName: e.target.value })}
              placeholder={isEn ? "e.g., Zadna Food Industries Co." : "مثال: شركة زادنا للمواد الغذائية"}
              className={`h-10 text-xs sm:text-sm rounded-xl font-bold bg-background ${
                isEn ? "text-left" : "text-right"
              }`}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <div className="space-y-1">
            <Label className="text-[11px] font-black text-foreground">
              عناية / الصفة الوظيفية (اختياري)
            </Label>
            <Input
              dir={isEn ? "ltr" : "rtl"}
              value={letter.recipientTitle || ""}
              onChange={(e) => onChange({ recipientTitle: e.target.value })}
              placeholder={isEn ? "Attn.: Procurement Manager" : "مثال: عناية السيد / مدير المشتريات والعقود"}
              className={`h-9.5 text-xs rounded-xl font-bold bg-background ${
                isEn ? "text-left" : "text-right"
              }`}
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Label className="text-[11px] font-black text-foreground flex items-center gap-1">
                  <Calendar className="h-3 w-3 text-primary" />
                  <span>التاريخ</span>
                </Label>
                <button
                  type="button"
                  onClick={() => onChange({ date: getLocalIsoDate() })}
                  className="text-[10px] font-bold text-primary hover:underline cursor-pointer"
                >
                  اليوم
                </button>
              </div>
              <Input
                type="date"
                value={letter.date}
                onChange={(e) => onChange({ date: e.target.value })}
                className="h-9.5 text-xs rounded-xl font-mono font-bold bg-background"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-[11px] font-black text-foreground">الرقم الإشاري</Label>
              <Input
                dir="ltr"
                value={letter.reference}
                onChange={(e) => onChange({ reference: e.target.value })}
                className="h-9.5 text-xs rounded-xl font-mono font-black bg-background text-center text-primary"
              />
            </div>
          </div>
        </div>
      </div>

      {/* 3. العنوان الاختياري ومربع الموضوع والمتن */}
      <div className="rounded-2xl border border-border/80 bg-card p-3 sm:p-4 space-y-3 shadow-2xs">
        <div className="flex items-center justify-between gap-2 border-b border-border/50 pb-2">
          <div className="flex items-center gap-1.5">
            <span className="grid h-5 w-5 place-items-center rounded-md bg-primary/10 text-primary text-[11px] font-black">
              2
            </span>
            <FileText className="h-3.5 w-3.5 text-primary" />
            <span className="text-xs sm:text-sm font-black text-foreground">
              عنوان الخطاب، الموضوع، ونص الرسالة
            </span>
          </div>
        </div>

        {/* مفتاح إظهار أو إخفاء عنوان الترويسة */}
        <div className="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-secondary/30 px-3 py-2">
          <div className="min-w-0">
            <div className="text-[11px] font-black text-foreground">
              إظهار عنوان للخطاب أعلى الترويسة
            </div>
            <p className="text-[10px] text-muted-foreground">
              {letter.showLetterTitle
                ? "يظهر العنوان بالمنتصف والشعار في الطرف"
                : "مُخفى — يتوسّط شعار T.A Advertising Solution منتصف الترويسة تلقائياً"}
            </p>
          </div>
          <Switch
            dir="ltr"
            checked={letter.showLetterTitle}
            onCheckedChange={(checked) => {
              playTapSound();
              onChange({
                showLetterTitle: checked,
                letterTitle:
                  checked && !letter.letterTitle.trim()
                    ? isEn
                      ? "Official Letter"
                      : "خطاب مطالبة مالية"
                    : letter.letterTitle,
              });
            }}
            aria-label="إظهار عنوان للخطاب أعلى الترويسة"
          />
        </div>

        {letter.showLetterTitle && (
          <div className="space-y-1">
            <Label className="text-[11px] font-black text-foreground">عنوان الخطاب (في الترويسة)</Label>
            <Input
              dir={isEn ? "ltr" : "rtl"}
              value={letter.letterTitle}
              onChange={(e) => onChange({ letterTitle: e.target.value })}
              placeholder={isEn ? "e.g., Official Financial Claim" : "مثال: خطاب مطالبة مالية"}
              className={`h-10 text-xs sm:text-sm rounded-xl font-bold bg-background ${
                isEn ? "text-left" : "text-right"
              }`}
            />
          </div>
        )}

        <div className="space-y-1">
          <Label className="text-[11px] font-black text-foreground">
            موضوع الخطاب (داخل المربع الأوسط) <span className="text-rose-500">*</span>
          </Label>
          <Input
            dir={isEn ? "ltr" : "rtl"}
            value={letter.subject}
            onChange={(e) => onChange({ subject: e.target.value })}
            placeholder={isEn ? "Enter concise letter subject..." : "اكتب موضوع الخطاب باختصار ووضوح..."}
            className={`h-10 text-xs sm:text-sm rounded-xl font-bold bg-background ${
              isEn ? "text-left" : "text-right"
            }`}
          />
        </div>

        <div className="space-y-1">
          <Label className="text-[11px] font-black text-foreground">
            متن الخطاب الرسمي <span className="text-rose-500">*</span>
          </Label>
          <textarea
            dir={isEn ? "ltr" : "rtl"}
            rows={7}
            value={letter.body}
            onChange={(e) => onChange({ body: e.target.value })}
            placeholder={isEn ? "Write the official letter paragraphs..." : "اكتب فقرات الخطاب الرسمي..."}
            className={`w-full rounded-xl border border-border/80 bg-background p-3 text-xs sm:text-[13px] font-medium leading-relaxed text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary resize-y ${
              isEn ? "text-left" : "text-right"
            }`}
          />
        </div>

        <div className="space-y-1">
          <Label className="text-[11px] font-black text-foreground">عبارة الختام الرسمية</Label>
          <Input
            dir={isEn ? "ltr" : "rtl"}
            value={letter.closingPhrase}
            onChange={(e) => onChange({ closingPhrase: e.target.value })}
            className={`h-9.5 text-xs rounded-xl font-bold bg-background ${
              isEn ? "text-left" : "text-right"
            }`}
          />
        </div>
      </div>

      {/* 4. بيانات الموقّع والختم الرسمي والباركود */}
      <div className="rounded-2xl border border-border/80 bg-card p-3 sm:p-4 space-y-3 shadow-2xs">
        <div className="flex items-center gap-1.5 border-b border-border/50 pb-2">
          <span className="grid h-5 w-5 place-items-center rounded-md bg-primary/10 text-primary text-[11px] font-black">
            3
          </span>
          <span className="text-xs sm:text-sm font-black text-foreground">
            التوقيع، الختم الرسمي، ورمز QR
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <div className="space-y-1">
            <Label className="text-[11px] font-black text-foreground">اسم الموقّع</Label>
            <Input
              dir={isEn ? "ltr" : "rtl"}
              value={letter.signatoryName}
              onChange={(e) => onChange({ signatoryName: e.target.value })}
              className={`h-9.5 text-xs rounded-xl font-bold bg-background ${
                isEn ? "text-left" : "text-right"
              }`}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] font-black text-foreground">الصفة / المنصب</Label>
            <Input
              dir={isEn ? "ltr" : "rtl"}
              value={letter.signatoryTitle}
              onChange={(e) => onChange({ signatoryTitle: e.target.value })}
              className={`h-9.5 text-xs rounded-xl font-bold bg-background ${
                isEn ? "text-left" : "text-right"
              }`}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          {[
            { key: "includeSignature" as const, label: "التوقيع المعتمد", icon: PenTool, active: letter.includeSignature },
            { key: "includeStamp" as const, label: "الختم الرسمي", icon: Stamp, active: letter.includeStamp },
            { key: "includeQr" as const, label: "رمز التوثيق QR", icon: QrCode, active: letter.includeQr },
          ].map((opt) => {
            const Icon = opt.icon;
            return (
              <button
                key={opt.key}
                type="button"
                onClick={() => {
                  playTapSound();
                  onChange({ [opt.key]: !opt.active });
                }}
                className={`inline-flex items-center gap-1.5 h-8.5 px-3 rounded-xl border text-[11px] font-black transition cursor-pointer ${
                  opt.active
                    ? "border-primary/50 bg-primary/10 text-primary"
                    : "border-border/70 bg-secondary/40 text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{opt.label}</span>
                {opt.active && <Check className="h-3 w-3" />}
              </button>
            );
          })}
        </div>
      </div>

      <CustomerPickerModal
        open={customerPickerOpen}
        onOpenChange={setCustomerPickerOpen}
        initialQuery={letter.recipientName}
        onSelect={(customer) => {
          onChange({
            recipientName: customer.name,
            recipientHonorific: isEn
              ? "Messrs."
              : customer.type === "company" || customer.type === "institution"
              ? "السادة /"
              : "السيد /",
          });
        }}
      />
    </div>
  );
}
