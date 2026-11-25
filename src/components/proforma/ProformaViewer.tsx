import { useEffect, useRef, useState } from "react";
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";
import { InvoiceZoomControls } from "@/components/invoice/InvoiceZoomControls";
import { ProformaDocument } from "./ProformaDocument";
import type { ProformaInvoice } from "@/lib/proforma/types";

export const PROFORMA_WIDTH = 794; // 210mm in pixels at 96 DPI
export const PROFORMA_HEIGHT = 1123; // 297mm in pixels at 96 DPI

interface Props {
  invoice: ProformaInvoice;
  isVisible?: boolean;
}

export function ProformaViewer({ invoice, isVisible = true }: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<number | null>(null);
  const [currentScale, setCurrentScale] = useState<number>(1);

  useEffect(() => {
    if (!isVisible) return;
    const el = boxRef.current;
    if (!el) return;

    const measure = () => {
      const isMobile = window.innerWidth < 768;
      const paddingX = isMobile ? 16 : 32;
      const paddingY = isMobile ? 64 : 80;
      const clientW = el.clientWidth || window.innerWidth;
      const clientH = el.clientHeight || window.innerHeight;

      const w = Math.max(150, clientW - paddingX);
      const h = Math.max(150, clientH - paddingY);
      const scaleW = w / PROFORMA_WIDTH;
      const scaleH = h / PROFORMA_HEIGHT;

      // Fit full A4 sheet cleanly without clipping signature/QR or overlapping controls
      const optimal = isMobile
        ? Math.max(0.28, Math.min(1.0, Math.min(scaleW, scaleH)))
        : Math.max(0.25, Math.min(1.15, Math.min(scaleW, scaleH)));

      const rounded = Number(optimal.toFixed(3));
      setFit(rounded);
      setCurrentScale(rounded);
    };

    const ro = new ResizeObserver(measure);
    measure();
    ro.observe(el);

    const t1 = setTimeout(measure, 60);
    const t2 = setTimeout(measure, 200);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      ro.disconnect();
    };
  }, [invoice.lines.length, isVisible]);

  return (
    <div
      ref={boxRef}
      dir="ltr"
      className="relative h-full w-full overflow-hidden rounded-2xl bg-slate-950 flex flex-col items-center justify-start select-none"
    >
      {fit !== null && (
        <TransformWrapper
          initialScale={fit}
          minScale={fit * 0.4}
          maxScale={fit * 4.0}
          centerOnInit={true}
          limitToBounds={false}
          doubleClick={{ mode: "reset" }}
          onTransform={(ref) => {
            setCurrentScale(Number(ref.state.scale.toFixed(2)));
          }}
        >
          {({ zoomIn, zoomOut, resetTransform }) => (
            <div className="flex flex-col w-full h-full min-h-0">
              <div className="flex-1 min-h-0 w-full overflow-hidden">
                <TransformComponent
                  wrapperStyle={{ width: "100%", height: "100%", overflow: "hidden", touchAction: "none" }}
                  contentStyle={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "8px",
                  }}
                >
                  <div className="rounded-md shadow-2xl ring-1 ring-black/30 overflow-hidden bg-white">
                    <ProformaDocument invoice={invoice} />
                  </div>
                </TransformComponent>
              </div>

              <div className="shrink-0 w-full py-2 flex items-center justify-center bg-slate-950/90 border-t border-white/10">
                <InvoiceZoomControls
                  inline
                  zoomOut={() => zoomOut(0.15)}
                  reset={() => resetTransform()}
                  zoomIn={() => zoomIn(0.15)}
                  scalePercent={Math.round((currentScale / fit) * 100)}
                />
              </div>
            </div>
          )}
        </TransformWrapper>
      )}
    </div>
  );
}
