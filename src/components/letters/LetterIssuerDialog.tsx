import React, { useEffect, useState } from "react";
import {
  Archive,
  Edit3,
  Eye,
  FileSignature,
  Plus,
  Printer,
  Save,
  Share2,
} from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { registerBackHandler } from "@/lib/backButtonHandler";
import { createOfficialLetter } from "@/lib/letters/templates";
import {
  deleteOfficialLetter,
  getNextLetterReference,
  saveOfficialLetter,
  useOfficialLetters,
} from "@/lib/letters/store";
import {
  printOfficialLetter,
  shareOfficialLetterViaWhatsApp,
} from "@/lib/letters/letterExport";
import type { OfficialLetter } from "@/lib/letters/types";
import { LetterEditorForm } from "./LetterEditorForm";
import { OfficialLetterViewer } from "./OfficialLetterViewer";
import { LetterArchiveList } from "./LetterArchiveList";
import { playErrorSound, playSuccessSound, playTapSound } from "@/lib/soundEffects";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialRecipientName?: string;
}

type ActiveTab = "edit" | "preview" | "archive";

export function LetterIssuerDialog({ open, onOpenChange, initialRecipientName }: Props) {
  const savedLetters = useOfficialLetters();
  const [activeTab, setActiveTab] = useState<ActiveTab>("edit");
  const [isProcessing, setIsProcessing] = useState(false);
  const [letter, setLetter] = useState<OfficialLetter>(() =>
    createOfficialLetter(getNextLetterReference(), "ar", {
      recipientName: initialRecipientName || "",
    })
  );

  useEffect(() => {
    if (!open) return;
    setActiveTab("edit");
    setLetter(
      createOfficialLetter(getNextLetterReference(), "ar", {
        recipientName: initialRecipientName || "",
      })
    );
  }, [open, initialRecipientName]);

  useEffect(() => {
    if (!open) return;
    return registerBackHandler(() => {
      onOpenChange(false);
      return true;
    });
  }, [open, onOpenChange]);

  const handlePatch = (patch: Partial<OfficialLetter>) => {
    setLetter((prev) => ({ ...prev, ...patch }));
  };

  const handleNewDraft = () => {
    playTapSound();
    setLetter(createOfficialLetter(getNextLetterReference(), letter.language));
    setActiveTab("edit");
  };

  const validateLetter = (): boolean => {
    const honorific = letter.recipientHonorific.trim();
    const isToWhom =
      honorific === "إلى من يهمه الأمر" ||
      honorific.toLowerCase() === "to whom it may concern";
    if (!isToWhom && !letter.recipientName.trim()) {
      playErrorSound();
      toast.error("حقل مطلوب", { description: "يرجى كتابة اسم الجهة أو الشخص الموجَّه إليه الخطاب" });
      return false;
    }
    if (!letter.subject.trim()) {
      playErrorSound();
      toast.error("حقل مطلوب", { description: "يرجى كتابة موضوع الخطاب" });
      return false;
    }
    if (!letter.body.trim()) {
      playErrorSound();
      toast.error("حقل مطلوب", { description: "يرجى كتابة نص الخطاب الرسمي" });
      return false;
    }
    return true;
  };

  const persistCurrent = async (): Promise<OfficialLetter | null> => {
    if (!validateLetter()) return null;
    const saved = await saveOfficialLetter(letter);
    setLetter(saved);
    return saved;
  };

  const handleSave = async () => {
    if (isProcessing) return;
    setIsProcessing(true);
    try {
      const saved = await persistCurrent();
      if (saved) {
        playSuccessSound();
        toast.success("تم حفظ الخطاب في الأرشيف", {
          description: `المرجع الرسمي: ${saved.reference}`,
        });
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSaveAndPrint = async () => {
    if (isProcessing) return;
    setIsProcessing(true);
    try {
      const saved = await persistCurrent();
      if (saved) {
        playSuccessSound();
        await printOfficialLetter(saved);
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSaveAndShare = async () => {
    if (isProcessing) return;
    setIsProcessing(true);
    try {
      const saved = await persistCurrent();
      if (saved) {
        playSuccessSound();
        await shareOfficialLetterViaWhatsApp(saved);
      }
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="w-full sm:max-w-4xl h-[100dvh] sm:h-[90vh] max-h-[100dvh] sm:max-h-[90vh] flex flex-col p-0 pt-[env(safe-area-inset-top,0px)] overflow-hidden bg-card border-border/80 rounded-none sm:rounded-3xl shadow-2xl"
        dir="rtl"
      >
        {/* 1. الترويسة مع شريط التبويبات المرن */}
        <div className="px-3.5 sm:px-5 pt-3 pb-2.5 border-b border-border/60 bg-card shrink-0 space-y-2.5">
          <div className="flex items-center justify-between gap-2 pl-10">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary/10 text-primary border border-primary/20 shrink-0">
                <FileSignature className="h-4.5 w-4.5" />
              </span>
              <div className="min-w-0">
                <DialogTitle className="text-sm sm:text-base font-black text-foreground truncate">
                  إصدار خطاب رسمي (ورقة مروّسة A4)
                </DialogTitle>
                <p className="hidden sm:block text-[11px] font-medium text-muted-foreground">
                  مراسلات T.A Advertising Solution الرسمية بالختم والتوقيع المعتمد
                </p>
              </div>
            </div>

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleNewDraft}
              className="h-8 px-2.5 rounded-xl text-[11px] font-black gap-1 shrink-0 cursor-pointer"
              title="بدء خطاب جديد"
            >
              <Plus className="h-3.5 w-3.5 text-primary" />
              <span>جديد</span>
            </Button>
          </div>

          <div className="grid grid-cols-3 gap-1 rounded-xl border border-border/70 bg-secondary/50 p-1">
            {[
              { id: "edit" as const, label: "1. التحرير", icon: Edit3 },
              { id: "preview" as const, label: "2. معاينة A4", icon: Eye },
              { id: "archive" as const, label: `الأرشيف (${savedLetters.length})`, icon: Archive },
            ].map((tab) => {
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
                  className={`flex items-center justify-center gap-1.5 h-8.5 rounded-lg text-[11px] sm:text-xs font-black whitespace-nowrap transition-all cursor-pointer ${
                    isActive
                      ? "bg-primary text-white shadow-2xs"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* 2. المحتوى النشط */}
        {activeTab === "edit" && (
          <div className="flex-1 overflow-y-auto overscroll-y-contain p-3 sm:p-4 min-h-0">
            <LetterEditorForm
              letter={letter}
              onChange={handlePatch}
            />
          </div>
        )}

        {activeTab === "preview" && (
          <div className="flex-1 overflow-hidden p-2 sm:p-4 bg-muted/30 min-h-0 flex flex-col space-y-2">
            <div className="flex items-center justify-between gap-2 bg-card px-3 py-1.5 rounded-xl border border-border/80 shrink-0">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  playTapSound();
                  setActiveTab("edit");
                }}
                className="h-8 px-3 rounded-lg text-xs font-black gap-1.5 cursor-pointer"
              >
                <Edit3 className="h-3.5 w-3.5 text-primary" />
                <span>العودة للتعديل</span>
              </Button>
              <span className="text-[11px] font-bold text-muted-foreground truncate">
                معاينة الورقة المروّسة A4 بهوامش أمان
              </span>
            </div>

            <div className="w-full max-w-3xl mx-auto flex-1 min-h-0 shadow-lg rounded-2xl overflow-hidden border border-border/70 bg-white dark:bg-card">
              <OfficialLetterViewer letter={letter} />
            </div>
          </div>
        )}

        {activeTab === "archive" && (
          <div className="flex-1 overflow-y-auto overscroll-y-contain p-3 sm:p-4 min-h-0">
            <LetterArchiveList
              letters={savedLetters}
              onOpenEdit={(item) => {
                setLetter(item);
                setActiveTab("edit");
              }}
              onPrint={(item) => void printOfficialLetter(item)}
              onDelete={(id) => {
                void deleteOfficialLetter(id);
                toast.success("تم حذف الخطاب من الأرشيف");
              }}
            />
          </div>
        )}

        {/* 3. شريط الإجراءات السفلي داخل Safe Area المحمية بالكامل فوق شريط تنقل أندرويد */}
        <DialogFooter className="px-3 pt-2.5 pb-[max(1.25rem,calc(env(safe-area-inset-bottom,0px)+0.85rem))] sm:px-5 sm:py-3 border-t border-border/60 bg-card shrink-0 flex flex-row items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
            <Button
              type="button"
              disabled={isProcessing}
              onClick={() => void handleSaveAndShare()}
              className="h-9 px-3 sm:px-3.5 rounded-xl bg-[#25D366] hover:bg-[#1ebe5d] text-white text-xs font-black gap-1.5 cursor-pointer"
            >
              <Share2 className="h-3.5 w-3.5" />
              <span>واتساب</span>
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={isProcessing}
              onClick={() => void handleSaveAndPrint()}
              className="h-9 px-3 sm:px-3.5 rounded-xl text-xs font-black gap-1.5 cursor-pointer"
            >
              <Printer className="h-3.5 w-3.5 text-primary" />
              <span>طباعة</span>
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={isProcessing}
              onClick={() => void handleSave()}
              aria-label="حفظ الخطاب"
              title="حفظ في الأرشيف"
              className="h-9 px-2.5 sm:px-3 rounded-xl text-xs font-black gap-1 cursor-pointer"
            >
              <Save className="h-3.5 w-3.5 text-primary" />
              <span className="hidden sm:inline">حفظ</span>
            </Button>
          </div>

          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="h-9 px-3 sm:px-4 rounded-xl text-xs font-bold cursor-pointer shrink-0"
          >
            إغلاق
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default LetterIssuerDialog;
