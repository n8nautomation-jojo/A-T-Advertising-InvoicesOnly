import React from "react";
import { TA_WATERMARK_BASE64 } from "@/assets/invoiceImagesBase64";
import { useCompanyProfile } from "@/lib/settings/companyProfileStore";
import type { OfficialLetter } from "@/lib/letters/types";
import { OfficialLetterHeader } from "./OfficialLetterHeader";
import { OfficialLetterFooter } from "./OfficialLetterFooter";

interface Props {
  letter: OfficialLetter;
  id?: string;
  isPrintMode?: boolean;
}

function formatLetterDate(isoDate: string): string {
  const parts = (isoDate || "").split("-");
  if (parts.length === 3) {
    return `${parts[2]} / ${parts[1]} / ${parts[0]}`;
  }
  return isoDate || "";
}

/**
 * ═══════════════════════════════════════════════════════════════
 * الورقة الرسمية المروّسة لإصدار الخطابات — T.A Advertising Solution
 * ═══════════════════════════════════════════════════════════════
 * تدعم اللغتين العربية (RTL) والإنجليزية (LTR) بالكامل بمقاس A4
 * قياسي بهوامش أمان دبلوماسية متوازنة (18mm أعلى، 20mm جانباً، 16mm أسفل).
 */
export const OfficialLetterDocument = React.forwardRef<HTMLDivElement, Props>(
  ({ letter, id = "official-letter-doc" }, ref) => {
    const { email, phone, addressAr, addressEn } = useCompanyProfile();
    const isRtl = letter.language !== "en";

    const formattedDate = formatLetterDate(letter.date);
    const paragraphs = (letter.body || "")
      .split(/\n+/)
      .map((p) => p.trim())
      .filter(Boolean);

    const honorificTrimmed = (letter.recipientHonorific || "").trim();
    const isToWhom =
      honorificTrimmed === "إلى من يهمه الأمر" ||
      honorificTrimmed.toLowerCase() === "to whom it may concern";
    const recipientDisplay = (letter.recipientName || "").trim();

    const honorificSuffixAr =
      honorificTrimmed.includes("السادة") || honorificTrimmed.includes("إدارة")
        ? "المحترمين"
        : honorificTrimmed.includes("السيد")
        ? "المحترم"
        : "";

    const monoStyle: React.CSSProperties = {
      fontFamily: "ui-monospace, 'Cascadia Mono', Consolas, monospace",
      fontVariantNumeric: "tabular-nums",
    };

    return (
      <div
        id={id}
        ref={ref}
        dir={isRtl ? "rtl" : "ltr"}
        className={`official-letter-sheet bg-white text-slate-900 mx-auto select-text relative flex flex-col justify-between ${
          isRtl ? "text-right" : "text-left"
        }`}
        style={{
          width: "210mm",
          minHeight: "297mm",
          height: "297mm",
          maxHeight: "297mm",
          margin: "0 auto",
          padding: "18mm 20mm 16mm 20mm",
          boxSizing: "border-box",
          overflow: "hidden",
          backgroundColor: "#ffffff",
          color: "#0f172a",
          fontFamily: isRtl
            ? "'Tajawal', 'Cairo', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
            : "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
          WebkitPrintColorAdjust: "exact",
          printColorAdjust: "exact",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          position: "relative",
          textAlign: isRtl ? "right" : "left",
        }}
      >
        {/* العلامة المائية الرسمية الخفيفة في قلب الورقة المروّسة */}
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            pointerEvents: "none",
            zIndex: 0,
          }}
        >
          <img
            src={TA_WATERMARK_BASE64}
            alt=""
            style={{
              width: "465px",
              maxWidth: "82%",
              height: "auto",
              opacity: 0.08,
              objectFit: "contain",
              userSelect: "none",
            }}
          />
        </div>

        <OfficialLetterHeader
          showTitle={letter.showLetterTitle}
          letterTitle={letter.letterTitle}
          formattedDate={formattedDate}
          reference={letter.reference}
          isRtl={isRtl}
          monoStyle={monoStyle}
        />

        {/* جسم الخطاب الرسمي: المرسل إليه + مربع الموضوع بالمنتصف + المتن */}
        <div
          style={{
            position: "relative",
            zIndex: 2,
            flex: 1,
            display: "flex",
            flexDirection: "column",
            paddingTop: "18px",
            paddingBottom: "14px",
          }}
        >
          <div style={{ marginBottom: "10px" }}>
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
                gap: "12px",
              }}
            >
              <div style={{ fontSize: "15px", fontWeight: 900, color: "#0f172a", lineHeight: 1.45 }}>
                {isToWhom ? (
                  <span>{honorificTrimmed}</span>
                ) : (
                  <>
                    <span style={{ color: "#0D4A39" }}>{honorificTrimmed} </span>
                    <span>{recipientDisplay || "................................................"}</span>
                  </>
                )}
              </div>
              {isRtl && !isToWhom && honorificSuffixAr && (
                <span style={{ fontSize: "14px", fontWeight: 800, color: "#0D4A39", flexShrink: 0 }}>
                  {honorificSuffixAr}
                </span>
              )}
            </div>

            {letter.recipientTitle?.trim() && (
              <div style={{ fontSize: "12.5px", fontWeight: 700, color: "#334155", marginTop: "3px" }}>
                {letter.recipientTitle.trim()}
              </div>
            )}

            {letter.salutation?.trim() && (
              <div style={{ fontSize: "13px", fontWeight: 800, color: "#1e293b", marginTop: "10px" }}>
                {letter.salutation.trim()}
              </div>
            )}
          </div>

          {/* مربع الموضوع في المنتصف تماماً */}
          <div
            style={{
              margin: "12px auto 18px auto",
              width: "92%",
              backgroundColor: "#f4f7f6",
              border: "1px solid #c5d6d1",
              borderRight: isRtl ? "4px solid #0D4A39" : "4px solid #C5A059",
              borderLeft: isRtl ? "4px solid #C5A059" : "4px solid #0D4A39",
              borderRadius: "6px",
              padding: "11px 18px",
              textAlign: "center",
              boxSizing: "border-box",
            }}
          >
            <div style={{ fontSize: "14px", fontWeight: 900, color: "#0f172a", lineHeight: 1.5 }}>
              <span
                style={{
                  color: "#0D4A39",
                  marginInlineEnd: "6px",
                }}
              >
                {isRtl ? "الموضوع:" : "Subject:"}
              </span>
              <span>{letter.subject || "................................................"}</span>
            </div>
          </div>

          {/* نص ومتن الخطاب */}
          <div style={{ flex: 1 }}>
            {paragraphs.length > 0 ? (
              paragraphs.map((para, idx) => (
                <p
                  key={idx}
                  style={{
                    fontSize: "13.5px",
                    fontWeight: 500,
                    color: "#0f172a",
                    lineHeight: 1.95,
                    textAlign: "justify",
                    margin: "0 0 12px 0",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {para}
                </p>
              ))
            ) : (
              <p style={{ fontSize: "13px", color: "#94a3b8", textAlign: "center", marginTop: "24px" }}>
                {isRtl ? "اكتب نص الخطاب الرسمي هنا..." : "Write the official letter body here..."}
              </p>
            )}

            {letter.closingPhrase?.trim() && (
              <div
                style={{
                  marginTop: "20px",
                  textAlign: "center",
                  fontSize: "13.5px",
                  fontWeight: 800,
                  color: "#0D4A39",
                }}
              >
                {letter.closingPhrase.trim()}
              </div>
            )}
          </div>
        </div>

        <OfficialLetterFooter
          letter={letter}
          companyAddress={isRtl ? addressAr : addressEn}
          email={email}
          phone={phone}
          isRtl={isRtl}
        />
      </div>
    );
  }
);

OfficialLetterDocument.displayName = "OfficialLetterDocument";
