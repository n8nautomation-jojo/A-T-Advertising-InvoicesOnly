import React from "react";
import {
  TA_QR_CODE_BASE64,
  TA_SIGNATURE_TARIG_BASE64,
  TA_STAMP_BASE64,
} from "@/assets/invoiceImagesBase64";
import type { OfficialLetter } from "@/lib/letters/types";

interface Props {
  letter: OfficialLetter;
  companyAddress: string;
  email: string;
  phone: string;
  isRtl: boolean;
}

/**
 * تذييل الورقة المروّسة (متماثل هندسياً بنسبة 100%):
 * - اليمين (بداية السطر): باركود QR مكبّر (96×96px) بمحاذاة حافة الأمان اليمنى
 * - المنتصف تماماً (قصاد الإيميل مباشرة): الختم الرسمي المكبّر (185px)
 * - اليسار (نهاية السطر، بنفس مسافة بُعد الباركود عن الحافة اليمنى):
 *   التوقيع في الأعلى مباشرة، وأسفله بقرب متوازن الاسم والمسمى الوظيفي فقط
 * - شريط التواصل السفلي بشبكة متماثلة (1fr auto 1fr) بحيث يقع الإيميل تحت الختم تماماً
 */
export const OfficialLetterFooter: React.FC<Props> = ({
  letter,
  companyAddress,
  email,
  phone,
  isRtl,
}) => {
  const defaultName = isRtl ? "طارق عثمان علي" : "Tarig Osman Ali";
  const defaultTitle = isRtl
    ? "المدير العام — T.A Advertising Solution"
    : "General Manager — T.A Advertising Solution";

  return (
    <div style={{ position: "relative", zIndex: 2, flexShrink: 0 }}>
      {/* منطقة الاعتماد المتماثلة: [QR يمين] — [الختم بالمنتصف قصاد الإيميل] — [التوقيع فوق الاسم والمنصب يسار] */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 220px 1fr",
          alignItems: "center",
          gap: "10px",
          paddingBottom: "14px",
        }}
      >
        {/* 1. رمز التوثيق QR مكبّر بمحاذاة الحافة البادئة (يمين في العربية) */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-start" }}>
          {letter.includeQr && (
            <div
              style={{
                width: "96px",
                height: "96px",
                padding: "4px",
                backgroundColor: "#ffffff",
                border: "1px solid #cbd5e1",
                borderRadius: "8px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                boxSizing: "border-box",
              }}
            >
              <img
                src={TA_QR_CODE_BASE64}
                alt="QR Code"
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "contain",
                  imageRendering: "pixelated",
                }}
              />
            </div>
          )}
        </div>

        {/* 2. الختم الرسمي مسنتر في المنتصف تماماً ومحاذي للبريد الإلكتروني أسفله */}
        <div
          style={{
            minHeight: "136px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {letter.includeStamp && (
            <img
              src={TA_STAMP_BASE64}
              alt="T.A Official Stamp"
              style={{
                width: "215px",
                maxHeight: "160px",
                height: "auto",
                opacity: 0.92,
                objectFit: "contain",
                mixBlendMode: "multiply",
              }}
            />
          )}
        </div>

        {/* 3. التوقيع أعلى الاسم والمسمى الوظيفي بقرب متوازن وبمحاذاة الحافة اليسرى (بنفس هامش اليمين) */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end" }}>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              textAlign: "center",
              gap: "2px",
            }}
          >
            {letter.includeSignature && (
              <div
                style={{
                  height: "52px",
                  display: "flex",
                  alignItems: "flex-end",
                  justifyContent: "center",
                  marginBottom: "-2px",
                }}
              >
                <img
                  src={TA_SIGNATURE_TARIG_BASE64}
                  alt="Signature"
                  style={{
                    maxHeight: "50px",
                    width: "auto",
                    objectFit: "contain",
                    mixBlendMode: "multiply",
                  }}
                />
              </div>
            )}

            <div style={{ fontSize: "14.5px", fontWeight: 900, color: "#0D4A39", lineHeight: 1.25 }}>
              {letter.signatoryName || defaultName}
            </div>
            <div style={{ fontSize: "11.5px", fontWeight: 700, color: "#334155", lineHeight: 1.3 }}>
              {letter.signatoryTitle || defaultTitle}
            </div>
          </div>
        </div>
      </div>

      {/* شريط التواصل الرسمي المتماثل (الموقع يمين — الإيميل بالمنتصف تحت الختم تماماً — الهاتف أقصى اليسار) */}
      <div
        style={{
          borderTop: "2px solid #0D4A39",
          paddingTop: "9px",
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) auto minmax(0, 1fr)",
          alignItems: "center",
          gap: "16px",
          fontSize: "12px",
          fontWeight: 800,
          color: "#0f172a",
          lineHeight: 1.4,
        }}
      >
        <span style={{ fontSize: "12px", fontWeight: 800, textAlign: isRtl ? "right" : "left" }}>
          {companyAddress}
        </span>
        <div style={{ textAlign: "center" }}>
          <bdi dir="ltr" style={{ fontSize: "12px", fontWeight: 800 }}>
            {email}
          </bdi>
        </div>
        <div
          style={{
            textAlign: isRtl ? "left" : "right",
            whiteSpace: "nowrap",
          }}
        >
          <bdi
            dir="ltr"
            style={{
              fontSize: "11.5px",
              fontWeight: 800,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {phone}
          </bdi>
        </div>
      </div>
    </div>
  );
};
