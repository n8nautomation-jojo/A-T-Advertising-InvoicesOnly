package com.futureprint.calculator;

import android.content.ClipData;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.print.PrintDocumentInfo;
import android.os.CancellationSignal;
import android.os.Handler;
import android.os.Looper;
import android.os.ParcelFileDescriptor;
import android.print.PageRange;
import android.provider.MediaStore;
import android.util.Base64;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;
import androidx.core.content.FileProvider;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.futureprint.calculator.backup.BackupPlugin;
import com.futureprint.calculator.backup.BridgeAccess;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import org.json.JSONObject;

public class MainActivity extends BridgeActivity {
    private static final String TAG = "MainActivity";
    private static final Set<String> ALLOWED_EXTENSIONS = Collections.unmodifiableSet(
        new HashSet<>(Arrays.asList(".pdf", ".json", ".tabk"))
    );
    private WebView printWebView;

    private static String jsQuote(String value) {
        String quoted = JSONObject.quote(value == null ? "" : value);
        return quoted.replace("\u2028", "\\u2028").replace("\u2029", "\\u2029");
    }

    private static String sanitizeFileName(String rawName, String defaultName, String forcedExt) {
        String candidate = (rawName == null || rawName.trim().isEmpty()) ? defaultName : rawName.trim();
        if (candidate.contains("..") || candidate.contains("/") || candidate.contains("\\")) {
            throw new SecurityException("Unsafe path characters in filename");
        }
        for (int i = 0; i < candidate.length(); i++) {
            if (Character.isISOControl(candidate.charAt(i))) {
                throw new SecurityException("Control characters not allowed in filename");
            }
        }
        // Defense-in-depth: strip any path components and enforce safe character allowlist.
        candidate = new File(candidate).getName();
        candidate = candidate.replaceAll("[^\\p{L}\\p{N}._\\- ]", "_").trim();
        while (candidate.startsWith(".")) {
            candidate = candidate.substring(1);
        }
        while (candidate.contains("..")) {
            candidate = candidate.replace("..", ".");
        }
        if (candidate.isEmpty()) {
            candidate = defaultName;
        }
        if (forcedExt != null) {
            String lower = candidate.toLowerCase(Locale.ROOT);
            if (!lower.endsWith(forcedExt.toLowerCase(Locale.ROOT))) {
                candidate = candidate + forcedExt;
            }
        }
        if (candidate.length() > 120) {
            int dotIdx = candidate.lastIndexOf('.');
            String ext = dotIdx > 0 ? candidate.substring(dotIdx) : "";
            String base = dotIdx > 0 ? candidate.substring(0, dotIdx) : candidate;
            int maxBase = Math.max(1, 120 - ext.length());
            candidate = base.substring(0, Math.min(base.length(), maxBase)) + ext;
        }
        int dot = candidate.lastIndexOf('.');
        String ext = dot > 0 ? candidate.substring(dot).toLowerCase(Locale.ROOT) : "";
        if (!ALLOWED_EXTENSIONS.contains(ext) || dot <= 0) {
            throw new SecurityException("Disallowed file extension");
        }
        return candidate;
    }

    private static File resolveSafeTargetFile(File targetDir, String safeName) throws IOException {
        if (!targetDir.exists() && !targetDir.mkdirs()) {
            throw new IOException("Failed to create target directory");
        }
        File canonicalDir = targetDir.getCanonicalFile();
        File targetFile = new File(canonicalDir, safeName).getCanonicalFile();
        String dirPrefix = canonicalDir.getPath() + File.separator;
        if (!targetFile.getPath().startsWith(dirPrefix)) {
            throw new SecurityException("Target file escapes destination directory");
        }
        return targetFile;
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Enable full offscreen WebView drawing for exact native vector PDF export.
        WebView.enableSlowWholeDocumentDraw();
        // Native backup engine and native notifications must be registered before the bridge is created.
        registerPlugin(BackupPlugin.class);
        registerPlugin(NativeNotificationsPlugin.class);
        super.onCreate(savedInstanceState);

        Bridge bridge = getBridge();
        if (bridge != null) {
            BridgeAccess.set(bridge);
        }

        WebView webView = bridge != null ? bridge.getWebView() : null;
        if (webView != null) {
            WebSettings settings = webView.getSettings();
            settings.setDomStorageEnabled(true);
            settings.setDatabaseEnabled(true);
            settings.setJavaScriptCanOpenWindowsAutomatically(true);

            // واجهة الطباعة والحفظ في ملفات الأندرويد الأصلية
            webView.addJavascriptInterface(new Object() {
                @JavascriptInterface
                public void print(String documentName) {
                    runOnUiThread(() -> {
                        try {
                            String jobName = (documentName != null && !documentName.trim().isEmpty())
                                ? documentName
                                : "فاتورة-فيوتشر";
                            PrintManager printManager = (PrintManager) getSystemService(Context.PRINT_SERVICE);
                            if (printManager != null) {
                                PrintDocumentAdapter printAdapter = webView.createPrintDocumentAdapter(jobName);
                                printManager.print(jobName, printAdapter, new PrintAttributes.Builder().build());
                            }
                        } catch (Exception e) {
                            e.printStackTrace();
                        }
                    });
                }

                @JavascriptInterface
                public void printHtml(String htmlContent, String documentName) {
                    printHtml(htmlContent, documentName, "A4");
                }

                @JavascriptInterface
                public void printHtml(String htmlContent, String documentName, String pageSize) {
                    runOnUiThread(() -> {
                        try {
                            String jobName = (documentName != null && !documentName.trim().isEmpty())
                                ? documentName
                                : "فاتورة-TA";

                            if (printWebView != null) {
                                try {
                                    android.view.ViewGroup parent = (android.view.ViewGroup) printWebView.getParent();
                                    if (parent != null) {
                                        parent.removeView(printWebView);
                                    }
                                    printWebView.destroy();
                                } catch (Exception ignored) {}
                                printWebView = null;
                            }

                            printWebView = new WebView(MainActivity.this);
                            printWebView.setVisibility(android.view.View.INVISIBLE);

                            // إلحاق الـ WebView بشجرة العرض لتمكين محرك أندرويد من التخطيط والطباعة الحقيقية
                            android.view.ViewGroup decor = (android.view.ViewGroup) getWindow().getDecorView();
                            decor.addView(printWebView, new android.view.ViewGroup.LayoutParams(1080, 1920));

                            WebSettings pSettings = printWebView.getSettings();
                            pSettings.setJavaScriptEnabled(false);
                            pSettings.setDomStorageEnabled(false);
                            pSettings.setAllowFileAccess(false);
                            pSettings.setAllowContentAccess(false);
                            pSettings.setDefaultTextEncodingName("utf-8");
                            pSettings.setLoadsImagesAutomatically(true);
                            pSettings.setTextZoom(100);
                            pSettings.setUseWideViewPort(true);
                            pSettings.setLoadWithOverviewMode(true);
                            pSettings.setSupportZoom(false);

                            final boolean isA5Landscape = "A5".equalsIgnoreCase(pageSize) ||
                                (jobName != null && (jobName.contains("A5") || jobName.contains("a5")));

                            final boolean[] hasPrinted = {false};
                            Runnable triggerPrint = () -> {
                                if (hasPrinted[0]) return;
                                hasPrinted[0] = true;
                                try {
                                    PrintManager printManager = (PrintManager) getSystemService(Context.PRINT_SERVICE);
                                    if (printManager != null && printWebView != null) {
                                        PrintDocumentAdapter printAdapter = printWebView.createPrintDocumentAdapter(jobName);
                                        PrintAttributes.Builder builder = new PrintAttributes.Builder();
                                        builder.setColorMode(PrintAttributes.COLOR_MODE_COLOR);
                                        builder.setMinMargins(PrintAttributes.Margins.NO_MARGINS);

                                        if (isA5Landscape) {
                                            builder.setMediaSize(PrintAttributes.MediaSize.ISO_A5.asLandscape());
                                        } else {
                                            builder.setMediaSize(PrintAttributes.MediaSize.ISO_A4);
                                        }

                                        printManager.print(jobName, printAdapter, builder.build());
                                    }
                                } catch (Exception ex) {
                                    Log.e(TAG, "print trigger failed", ex);
                                    Toast.makeText(MainActivity.this, "تعذر تشغيل الطابعة", Toast.LENGTH_SHORT).show();
                                }
                            };

                            printWebView.setWebViewClient(new WebViewClient() {
                                @Override
                                public android.webkit.WebResourceResponse shouldInterceptRequest(WebView view, android.webkit.WebResourceRequest request) {
                                    android.webkit.WebResourceResponse fontResp = NativePdfExporter.interceptLocalFontAsset(MainActivity.this, request);
                                    if (fontResp != null) return fontResp;
                                    return super.shouldInterceptRequest(view, request);
                                }

                                @Override
                                public void onPageFinished(WebView view, String url) {
                                    view.postDelayed(triggerPrint, 250);
                                }
                            });

                            // صمام أمان زمني لضمان استدعاء الطابعة حتى في حال تأخر أحداث الصفحة
                            printWebView.postDelayed(triggerPrint, 1000);

                            // JS, DOM storage, and file/content access are strictly disabled above;
                            // base URL allows local bundled fonts to render during printing.
                            printWebView.loadDataWithBaseURL("https://localhost", htmlContent, "text/html", "UTF-8", null);
                        } catch (Exception e) {
                            Log.e(TAG, "printHtml failed", e);
                            Toast.makeText(MainActivity.this, "تعذر تشغيل أمر الطباعة", Toast.LENGTH_SHORT).show();
                        }
                    });
                }

                @JavascriptInterface
                public void savePdf(String base64Data, String filename) {
                    try {
                        String safeName = sanitizeFileName(filename, "فاتورة-TA.pdf", ".pdf");
                        saveFileInternal(base64Data, safeName, "application/pdf", true);
                    } catch (SecurityException se) {
                        Log.w(TAG, "Rejected unsafe PDF filename", se);
                        runOnUiThread(() -> Toast.makeText(MainActivity.this, "اسم الملف غير صالح", Toast.LENGTH_SHORT).show());
                    }
                }

                @JavascriptInterface
                public void saveFile(String base64Data, String filename, String mimeType) {
                    try {
                        String resolvedMime = (mimeType != null && !mimeType.trim().isEmpty())
                            ? mimeType
                            : "application/octet-stream";
                        String safeName = sanitizeFileName(filename, "backup.json", null);
                        boolean openViewer = "application/pdf".equalsIgnoreCase(resolvedMime);
                        saveFileInternal(base64Data, safeName, resolvedMime, openViewer);
                    } catch (SecurityException se) {
                        Log.w(TAG, "Rejected unsafe filename in saveFile", se);
                        runOnUiThread(() -> Toast.makeText(MainActivity.this, "اسم أو امتداد الملف غير مسموح", Toast.LENGTH_SHORT).show());
                    }
                }

                private void saveFileInternal(String base64Data, String safeName, String mimeType, boolean openViewer) {
                    runOnUiThread(() -> {
                        try {
                            byte[] fileBytes = Base64.decode(base64Data, Base64.DEFAULT);
                            String successMsg = openViewer
                                ? "تم حفظ الفاتورة بنجاح"
                                : "تم حفظ النسخة الاحتياطية بنجاح";

                            // 1. كتابة الملف في مجلد cache الداخلي لضمان الفتح المؤكد بنسبة 100% عبر FileProvider دون حظر /Android/data/
                            File targetDir = new File(getCacheDir(), "saved_invoices");
                            File targetFile = resolveSafeTargetFile(targetDir, safeName);
                            try (FileOutputStream fos = new FileOutputStream(targetFile)) {
                                fos.write(fileBytes);
                                fos.flush();
                            }

                            // 2. حفظ نسخة في مجلد Downloads/A-T-Advertising ليجدها المستخدم في مدير الملفات
                            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                                try {
                                    ContentValues values = new ContentValues();
                                    values.put(MediaStore.MediaColumns.DISPLAY_NAME, safeName);
                                    values.put(MediaStore.MediaColumns.MIME_TYPE, mimeType);
                                    values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/A-T-Advertising");
                                    values.put(MediaStore.MediaColumns.IS_PENDING, 1);

                                    Uri mediaUri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                                    if (mediaUri != null) {
                                        try (OutputStream os = getContentResolver().openOutputStream(mediaUri)) {
                                            if (os != null) {
                                                os.write(fileBytes);
                                                os.flush();
                                            }
                                        }
                                        values.clear();
                                        values.put(MediaStore.MediaColumns.IS_PENDING, 0);
                                        getContentResolver().update(mediaUri, values, null, null);
                                    }
                                } catch (Exception exMedia) {
                                    Log.w(TAG, "MediaStore download copy failed", exMedia);
                                }
                            }

                            Toast.makeText(MainActivity.this, successMsg, Toast.LENGTH_LONG).show();

                            // 3. فتح المستند في قارئ PDF عبر FileProvider باستخدام FLAG_GRANT_READ_URI_PERMISSION + ClipData فقط
                            if (openViewer && targetFile.exists() && targetFile.length() > 0) {
                                try {
                                    Uri viewUri = FileProvider.getUriForFile(
                                        MainActivity.this,
                                        getPackageName() + ".fileprovider",
                                        targetFile
                                    );

                                    Intent intent = new Intent(Intent.ACTION_VIEW);
                                    intent.setDataAndType(viewUri, mimeType);
                                    intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                                    intent.setClipData(ClipData.newRawUri("PDF", viewUri));

                                    Intent chooser = Intent.createChooser(intent, "عرض الفاتورة");
                                    chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                                    chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                                    chooser.setClipData(ClipData.newRawUri("PDF", viewUri));

                                    startActivity(chooser);
                                } catch (Exception exView) {
                                    Log.w(TAG, "PDF viewer launch failed", exView);
                                }
                            }
                        } catch (Exception e) {
                            Log.e(TAG, "saveFileInternal failed", e);
                            Toast.makeText(MainActivity.this, "تعذر حفظ الملف", Toast.LENGTH_SHORT).show();
                        }
                    });
                }

                @JavascriptInterface
                public void printHtmlThenShare(String htmlContent, String documentName, String pageSize, String messageText) {
                    runOnUiThread(() -> {
                        printHtml(htmlContent, documentName, pageSize);
                    });
                }

                private void sharePdfFileDirectly(File targetFile, String messageText, boolean targetWhatsApp) {
                    try {
                        Uri fileUri = FileProvider.getUriForFile(
                            MainActivity.this,
                            getPackageName() + ".fileprovider",
                            targetFile
                        );

                        Intent sendIntent = new Intent(Intent.ACTION_SEND);
                        sendIntent.setType("application/pdf");
                        sendIntent.putExtra(Intent.EXTRA_STREAM, fileUri);
                        if (messageText != null && !messageText.trim().isEmpty()) {
                            sendIntent.putExtra(Intent.EXTRA_TEXT, messageText);
                        }
                        sendIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                        sendIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        sendIntent.setClipData(ClipData.newRawUri("PDF", fileUri));

                        if (targetWhatsApp) {
                            sendIntent.setPackage("com.whatsapp");
                            try {
                                startActivity(sendIntent);
                                return;
                            } catch (Exception exWa) {
                                try {
                                    Intent waBusiness = new Intent(sendIntent);
                                    waBusiness.setPackage("com.whatsapp.w4b");
                                    startActivity(waBusiness);
                                    return;
                                } catch (Exception exWab) {
                                    sendIntent.setPackage(null);
                                }
                            }
                        }

                        Intent chooser = Intent.createChooser(sendIntent, "مشاركة الفاتورة");
                        chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                        chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        chooser.setClipData(ClipData.newRawUri("PDF", fileUri));
                        startActivity(chooser);
                    } catch (Exception e) {
                        Log.e(TAG, "sharePdfFileDirectly failed", e);
                        Toast.makeText(MainActivity.this, "تعذر مشاركة الفاتورة", Toast.LENGTH_SHORT).show();
                    }
                }

                @JavascriptInterface
                public void printPdfThenShare(String base64Data, String filename, String messageText, String requestId, String pageSize) {
                    // للتوافق العكسي مع أي استدعاء قديم
                    shareToWhatsApp(base64Data, filename, messageText);
                }

                private void notifyPrintShareResult(String requestId, boolean success, String message) {
                    try {
                        String safeId = requestId == null ? "" : requestId.replaceAll("[^a-zA-Z0-9_-]", "");
                        WebView bridgeWebView = getBridge() != null ? getBridge().getWebView() : null;
                        if (bridgeWebView != null) {
                            bridgeWebView.evaluateJavascript(
                                "window.__invoicePrintShareResult && window.__invoicePrintShareResult(" + jsQuote(safeId) + "," + success + "," + jsQuote(message) + ")",
                                null
                            );
                        }
                    } catch (Exception ignored) {}
                }

                @JavascriptInterface
                public void shareHtmlToWhatsApp(String htmlContent, String filename, String pageSize, String messageText) {
                    try {
                        String safeName = sanitizeFileName(filename, "مستند-TA.pdf", ".pdf");
                        File shareDir = new File(getCacheDir(), "shared_invoices");
                        File targetFile = resolveSafeTargetFile(shareDir, safeName);
                        NativePdfExporter.renderHtmlToPdfFile(
                            MainActivity.this,
                            htmlContent,
                            pageSize,
                            targetFile,
                            new NativePdfExporter.ExportCallback() {
                                @Override
                                public void onSuccess(File pdfFile) {
                                    sharePdfFileDirectly(pdfFile, messageText, true);
                                    notifyShareStatus(true, "تم تجهيز الملف الأصلي وفتح واتساب بنجاح");
                                }

                                @Override
                                public void onError(String message) {
                                    notifyShareStatus(false, message);
                                    Toast.makeText(MainActivity.this, message, Toast.LENGTH_SHORT).show();
                                }
                            }
                        );
                    } catch (SecurityException se) {
                        Log.w(TAG, "Rejected unsafe HTML share filename", se);
                        notifyShareStatus(false, "اسم الملف غير صالح");
                    } catch (Exception e) {
                        Log.e(TAG, "shareHtmlToWhatsApp failed", e);
                        notifyShareStatus(false, "تعذر تجهيز المستند للمشاركة");
                    }
                }

                @JavascriptInterface
                public void saveHtmlAsPdf(String htmlContent, String filename, String pageSize) {
                    try {
                        String safeName = sanitizeFileName(filename, "مستند-TA.pdf", ".pdf");
                        File targetDir = new File(getCacheDir(), "saved_invoices");
                        File targetFile = resolveSafeTargetFile(targetDir, safeName);
                        NativePdfExporter.renderHtmlToPdfFile(
                            MainActivity.this,
                            htmlContent,
                            pageSize,
                            targetFile,
                            new NativePdfExporter.ExportCallback() {
                                @Override
                                public void onSuccess(File pdfFile) {
                                    try {
                                        byte[] fileBytes = java.nio.file.Files.readAllBytes(pdfFile.toPath());
                                        String b64 = Base64.encodeToString(fileBytes, Base64.NO_WRAP);
                                        saveFileInternal(b64, safeName, "application/pdf", true);
                                    } catch (Exception ex) {
                                        Log.e(TAG, "saveHtmlAsPdf finalize failed", ex);
                                        Toast.makeText(MainActivity.this, "تعذر حفظ ملف PDF", Toast.LENGTH_SHORT).show();
                                    }
                                }

                                @Override
                                public void onError(String message) {
                                    Toast.makeText(MainActivity.this, message, Toast.LENGTH_SHORT).show();
                                }
                            }
                        );
                    } catch (Exception e) {
                        Log.e(TAG, "saveHtmlAsPdf failed", e);
                        runOnUiThread(() -> Toast.makeText(MainActivity.this, "تعذر حفظ ملف PDF", Toast.LENGTH_SHORT).show());
                    }
                }

                @JavascriptInterface
                public void shareToWhatsApp(String base64Data, String filename, String messageText) {
                    sharePdfInternal(base64Data, filename, messageText, true);
                }

                @JavascriptInterface
                public void sharePdf(String base64Data, String filename, String messageText) {
                    sharePdfInternal(base64Data, filename, messageText, false);
                }

                private void sharePdfInternal(String base64Data, String filename, String messageText, boolean targetWhatsApp) {
                    runOnUiThread(() -> {
                        try {
                            if (base64Data == null || base64Data.trim().isEmpty()) {
                                Toast.makeText(MainActivity.this, "ملف الفاتورة غير صالح للمشاركة", Toast.LENGTH_SHORT).show();
                                return;
                            }

                            byte[] fileBytes = Base64.decode(base64Data, Base64.DEFAULT);
                            String safeName = sanitizeFileName(filename, "فاتورة-TA.pdf", ".pdf");

                            File shareDir = new File(getCacheDir(), "shared_invoices");
                            File targetFile = resolveSafeTargetFile(shareDir, safeName);
                            try (FileOutputStream fos = new FileOutputStream(targetFile)) {
                                fos.write(fileBytes);
                                fos.flush();
                            }

                            Uri fileUri = FileProvider.getUriForFile(
                                MainActivity.this,
                                getPackageName() + ".fileprovider",
                                targetFile
                            );

                            Intent sendIntent = new Intent(Intent.ACTION_SEND);
                            sendIntent.setType("application/pdf");
                            sendIntent.putExtra(Intent.EXTRA_STREAM, fileUri);
                            if (messageText != null && !messageText.trim().isEmpty()) {
                                sendIntent.putExtra(Intent.EXTRA_TEXT, messageText);
                            }
                            sendIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                            sendIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                            sendIntent.setClipData(ClipData.newRawUri("PDF", fileUri));

                            if (targetWhatsApp) {
                                // محاولة الإرسال لتطبيق واتساب الرسمي أولاً
                                sendIntent.setPackage("com.whatsapp");
                                try {
                                    startActivity(sendIntent);
                                    notifyShareStatus(true, "تم فتح تطبيق واتساب بنجاح");
                                    return;
                                } catch (Exception exWa) {
                                    // محاولة واتساب للأعمال (WhatsApp Business)
                                    try {
                                        Intent waBusiness = new Intent(sendIntent);
                                        waBusiness.setPackage("com.whatsapp.w4b");
                                        startActivity(waBusiness);
                                        notifyShareStatus(true, "تم فتح تطبيق واتساب للأعمال بنجاح");
                                        return;
                                    } catch (Exception exWab) {
                                        sendIntent.setPackage(null);
                                    }
                                }
                            }

                            Intent chooser = Intent.createChooser(sendIntent, "مشاركة الفاتورة");
                            chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                            chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                            chooser.setClipData(ClipData.newRawUri("PDF", fileUri));
                            startActivity(chooser);
                            notifyShareStatus(true, "تم فتح قائمة المشاركة");
                        } catch (SecurityException se) {
                            Log.w(TAG, "Rejected unsafe share filename", se);
                            notifyShareStatus(false, "اسم الملف غير صالح");
                            Toast.makeText(MainActivity.this, "اسم الملف غير صالح", Toast.LENGTH_SHORT).show();
                        } catch (Exception e) {
                            Log.e(TAG, "sharePdfInternal failed", e);
                            notifyShareStatus(false, "تعذر مشاركة الفاتورة");
                            Toast.makeText(MainActivity.this, "تعذر مشاركة الفاتورة", Toast.LENGTH_SHORT).show();
                        }
                    });
                }

                private void notifyShareStatus(boolean success, String message) {
                    try {
                        WebView bridgeWebView = getBridge() != null ? getBridge().getWebView() : null;
                        if (bridgeWebView != null) {
                            bridgeWebView.evaluateJavascript(
                                "window.__onInvoiceShared && window.__onInvoiceShared(" + success + "," + jsQuote(message) + ")",
                                null
                            );
                        }
                    } catch (Exception ignored) {}
                }
            }, "AndroidPrint");
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        if (intent == null) return;
        String route = intent.getStringExtra(NativeNotificationsPlugin.EXTRA_NOTIFICATION_ROUTE);
        if (route != null && !route.trim().isEmpty()) {
            final String safeRoute = route.startsWith("/") ? route : ("/" + route);
            runOnUiThread(() -> {
                try {
                    WebView bridgeWebView = getBridge() != null ? getBridge().getWebView() : null;
                    if (bridgeWebView != null) {
                        bridgeWebView.evaluateJavascript(
                            "window.location.hash = " + jsQuote("#" + safeRoute) + "; window.dispatchEvent(new Event('ta-native-notification-opened'));",
                            null
                        );
                    }
                } catch (Exception ignored) {}
            });
        }
    }

    @Override
    public void onDestroy() {
        if (printWebView != null) {
            try {
                android.view.ViewGroup parent = (android.view.ViewGroup) printWebView.getParent();
                if (parent != null) {
                    parent.removeView(printWebView);
                }
                printWebView.stopLoading();
                printWebView.destroy();
            } catch (Exception ignored) {}
            printWebView = null;
        }
        BridgeAccess.clear();
        super.onDestroy();
    }
}

