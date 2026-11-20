import { useCallback, useState, type RefObject } from "react";
import { toast } from "sonner";
import { backupBridge } from "@/lib/backup/bridge";
import { createManualBackup } from "@/lib/backup/autoBackup";
import { importLegacyJson, restoreBackup } from "@/lib/backup/restoreService";
import { saveBackupSettings } from "@/lib/backup/settingsStore";
import { bytesToBase64 } from "@/lib/backup/crypto";
import { countBusinessRecords, countInvoices } from "@/lib/backup/validation";
import { playSuccessSound, playTapSound } from "@/lib/soundEffects";
import {
  type BackupSettings,
  type RestoreMode,
  type RestoreResult,
  formatBytes,
} from "./types";

interface UseBackupManagerActionsParams {
  folderUri?: string;
  refresh: () => Promise<void>;
  fileInputRef: RefObject<HTMLInputElement | null>;
  setIsRestoreHubOpen: (open: boolean) => void;
  setRestoreSuccessResult: (res: RestoreResult | null) => void;
}

export interface RecoveryKeyExportResponse {
  ok: boolean;
  recoveryKey?: string;
  keyId?: string;
  message?: string;
}

export interface RecoveryKeyImportResponse {
  ok: boolean;
  keyId?: string;
  message?: string;
}

export function useBackupManagerActions({
  folderUri,
  refresh,
  fileInputRef,
  setIsRestoreHubOpen,
  setRestoreSuccessResult,
}: UseBackupManagerActionsParams) {
  const [busy, setBusy] = useState<string | null>(null);

  const handleChooseFolder = useCallback(async () => {
    playTapSound();
    setBusy("folder");
    try {
      const result = await backupBridge.chooseFolder();
      if (!result.ok) {
        if (result.errorCode !== "CANCELLED") {
          toast.error(result.message || "تعذّر اختيار المجلد.");
        }
        return;
      }
      await saveBackupSettings({
        folderUri: result.folderUri ?? "",
        folderLabel: result.folderLabel ?? "",
      });
      playSuccessSound();
      toast.success("تم ربط مجلد النسخ الاحتياطي: " + (result.folderLabel || ""));
      await refresh();
    } catch (err: any) {
      toast.error(
        err?.message === "NATIVE_UNAVAILABLE"
          ? "وحدة النسخ الاحتياطي غير مثبّتة في هذا البناء."
          : "تعذّر فتح مدير الملفات."
      );
    } finally {
      setBusy(null);
    }
  }, [refresh]);

  const handleBackupNow = useCallback(async () => {
    playTapSound();
    if (!folderUri) {
      toast.error("اختر مجلد النسخ الاحتياطي أولاً.");
      return;
    }
    setBusy("backup");
    try {
      const result = await createManualBackup();
      if (result.ok) {
        playSuccessSound();
        const counts = result.manifest?.counts;
        const invoices = result.manifest?.invoiceCount ?? countInvoices(counts);
        const customers = counts?.customers ?? 0;
        const letters = counts?.official_letters ?? 0;
        const totalRecords =
          result.manifest?.totalBusinessRecords ?? countBusinessRecords(counts);
        const detailParts: string[] = [`${invoices} فاتورة`];
        if (customers > 0) detailParts.push(`${customers} عميل`);
        if (letters > 0) detailParts.push(`${letters} خطاب`);
        toast.success(
          `تم إنشاء النسخة بنجاح (${totalRecords} سجل: ${detailParts.join("، ")} — ${formatBytes(result.sizeBytes)})`
        );
      } else {
        toast.error(result.message || "تعذّر إنشاء النسخة الاحتياطية.");
      }
      await refresh();
    } catch (err: any) {
      toast.error("حدث خطأ أثناء إنشاء النسخة الاحتياطية: " + (err?.message ?? err));
    } finally {
      setBusy(null);
    }
  }, [refresh, folderUri]);

  const handleVerify = useCallback(
    async (fileName: string) => {
      playTapSound();
      setBusy("verify:" + fileName);
      try {
        const result = await backupBridge.verifyBackup(fileName);
        if (result.ok) {
          playSuccessSound();
          toast.success("النسخة سليمة 100%: البصمة الرقمية وفحص الجداول متطابقان.");
        } else {
          toast.error(result.message || "فشل التحقق من سلامة النسخة.");
        }
        await refresh();
      } catch (err: any) {
        toast.error("تعذّر التحقق من سلامة النسخة: " + (err?.message ?? err));
      } finally {
        setBusy(null);
      }
    },
    [refresh]
  );

  const handleExport = useCallback(async (fileName: string) => {
    playTapSound();
    setBusy("export:" + fileName);
    try {
      const exported = await backupBridge.exportArchive(fileName);
      if (!exported.ok || !exported.base64) {
        toast.error(exported.message || "تعذّر تصدير النسخة.");
        return;
      }
      const androidPrint = (window as any).AndroidPrint;
      if (androidPrint && typeof androidPrint.saveFile === "function") {
        androidPrint.saveFile(exported.base64, fileName, "application/octet-stream");
        playSuccessSound();
        toast.success("تم حفظ النسخة في التنزيلات لمشاركتها أو نقلها لجهاز آخر.");
      } else {
        toast.error("التصدير متاح داخل تطبيق أندرويد.");
      }
    } catch (err: any) {
      toast.error("حدث خطأ أثناء تصدير النسخة: " + (err?.message ?? err));
    } finally {
      setBusy(null);
    }
  }, []);

  const handleImportFile = useCallback(
    async (file: File) => {
      setBusy("import");
      try {
        if (file.name.toLowerCase().endsWith(".json")) {
          const text = await file.text();
          const result = await importLegacyJson(text);
          if (result.ok) {
            playSuccessSound();
            toast.success(result.message);
            setRestoreSuccessResult({
              ok: true,
              mode: "merge",
              counts: result.counts || { custom_invoices: result.added },
            });
            setIsRestoreHubOpen(true);
          } else {
            toast.error(result.message);
          }
        } else {
          const bytes = new Uint8Array(await file.arrayBuffer());
          const base64 = bytesToBase64(bytes);
          const result = await backupBridge.importArchive(base64, file.name);
          if (result.ok) {
            await refresh();
            setIsRestoreHubOpen(true);
            if (result.needsRecoveryKey) {
              toast.warning(
                "تم استيراد نسخة مشفّرة — أدخل رمز الاسترداد (Recovery Key) لفك تشفيرها ثم أكمل الاستعادة."
              );
            } else {
              playSuccessSound();
              toast.success("تم استيراد النسخة بنجاح — اضغط تأكيد الاستعادة.");
            }
            return;
          } else {
            toast.error(
              result.errorCode === "NO_FOLDER"
                ? "اختر مجلد النسخ الاحتياطي أولاً ثم أعد استيراد الملف."
                : result.message || "الملف غير صالح أو غير متوافق."
            );
          }
        }
        await refresh();
      } catch (err: any) {
        toast.error("تعذّر استيراد الملف: " + (err?.message ?? err));
      } finally {
        setBusy(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    },
    [refresh, fileInputRef, setIsRestoreHubOpen, setRestoreSuccessResult]
  );

  const handleRestore = useCallback(
    async (fileName: string, mode: RestoreMode) => {
      if (!fileName) {
        toast.error("يرجى اختيار ملف النسخة الاحتياطية أولاً.");
        return;
      }
      setBusy("restore");
      try {
        const result = await restoreBackup(fileName, mode);
        if (result.ok) {
          playSuccessSound();
          const c = result.counts;
          const extraParts: string[] = [];
          if ((c.customers ?? 0) > 0) extraParts.push(`${c.customers} عميل`);
          if ((c.official_letters ?? 0) > 0) extraParts.push(`${c.official_letters} خطاب رسمي`);
          if ((c.customer_payments ?? 0) > 0) extraParts.push(`${c.customer_payments} سند قبض`);
          if ((c.suppliers ?? 0) > 0) extraParts.push(`${c.suppliers} مورد`);
          if ((c.expenses ?? 0) > 0) extraParts.push(`${c.expenses} مصروف`);
          const extraSummary = extraParts.length ? `، ${extraParts.join("، ")}` : "";

          toast.success(
            `تمت الاستعادة بنجاح (${c.custom_invoices ?? 0} فواتير، ${c.proforma_invoices ?? 0} عروض${extraSummary})`
          );
          setRestoreSuccessResult(result);
          await refresh();
        } else {
          toast.error(result.message || "فشلت الاستعادة، ولم يتم المساس ببياناتك الحالية.");
        }
      } catch (err: any) {
        toast.error("حدث خطأ أثناء الاستعادة: " + (err?.message ?? err));
      } finally {
        setBusy(null);
      }
    },
    [refresh, setRestoreSuccessResult]
  );

  const handleSaveSettings = useCallback(
    async (updated: Partial<BackupSettings>) => {
      try {
        await saveBackupSettings(updated);
        await refresh();
        toast.success("تم حفظ إعدادات النسخ الاحتياطي.");
      } catch (err: any) {
        toast.error("تعذّر حفظ الإعدادات: " + (err?.message ?? err));
      }
    },
    [refresh]
  );

  const handleExportRecoveryKey = useCallback(async (): Promise<RecoveryKeyExportResponse> => {
    playTapSound();
    setBusy("export-key");
    try {
      const result = await backupBridge.exportRecoveryKey();
      if (!result.ok || !result.recoveryKey) {
        const message = result.message || "تعذّر تصدير رمز الاسترداد.";
        toast.error(message);
        return { ok: false, message };
      }
      await saveBackupSettings({ recoveryKeyExportedAt: new Date().toISOString() });
      playSuccessSound();
      await refresh();
      return { ok: true, recoveryKey: result.recoveryKey, keyId: result.keyId };
    } catch (err: any) {
      const message =
        err?.message === "NATIVE_UNAVAILABLE"
          ? "تصدير رمز الاسترداد متاح داخل تطبيق أندرويد فقط."
          : "حدث خطأ أثناء تصدير رمز الاسترداد: " + (err?.message ?? err);
      toast.error(message);
      return { ok: false, message };
    } finally {
      setBusy(null);
    }
  }, [refresh]);

  const handleImportRecoveryKey = useCallback(
    async (recoveryKey: string): Promise<RecoveryKeyImportResponse> => {
      const clean = recoveryKey.trim();
      if (!clean) {
        const message = "أدخل رمز الاسترداد أولاً.";
        toast.error(message);
        return { ok: false, message };
      }
      playTapSound();
      setBusy("import-key");
      try {
        const result = await backupBridge.importRecoveryKey(clean);
        if (!result.ok) {
          const message = result.message || "رمز الاسترداد غير صحيح أو غير مكتمل.";
          toast.error(message);
          return { ok: false, message };
        }
        playSuccessSound();
        await refresh();
        toast.success(
          result.keyId
            ? `تم استيراد رمز الاسترداد بنجاح (المعرّف: ${result.keyId}) — أصبحت النسخ المشفّرة متاحة الآن.`
            : "تم استيراد رمز الاسترداد بنجاح — أصبحت النسخ المشفّرة متاحة الآن."
        );
        return { ok: true, keyId: result.keyId };
      } catch (err: any) {
        const message =
          err?.message === "NATIVE_UNAVAILABLE"
            ? "استيراد رمز الاسترداد متاح داخل تطبيق أندرويد فقط."
            : "تعذّر استيراد رمز الاسترداد: " + (err?.message ?? err);
        toast.error(message);
        return { ok: false, message };
      } finally {
        setBusy(null);
      }
    },
    [refresh]
  );

  return {
    busy,
    handleChooseFolder,
    handleBackupNow,
    handleVerify,
    handleExport,
    handleImportFile,
    handleRestore,
    handleSaveSettings,
    handleExportRecoveryKey,
    handleImportRecoveryKey,
  };
}

