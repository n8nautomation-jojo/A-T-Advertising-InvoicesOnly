import { useEffect, useRef, useState } from "react";
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";
import { InvoiceZoomControls } from "./InvoiceZoomControls";
import { InvoiceDocument, INVOICE_WIDTH, INVOICE_HEIGHT, ITEMS_PER_PAGE } from "./InvoiceDocument";
import type { Invoice } from "@/lib/invoice/types";

/** عارض الفاتورة A5 العرضية: ملاءمة تلقائية فائقة المرونة للهاتف والكمبيوتر */
export function InvoiceViewer({ invoice, isVisible = true }: { invoice: Invoice; isVisible?: boolean }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<number | null>(null);
  const [currentScale, setCurrentScale] = useState<number>(1);
  const [pageIndex, setPageIndex] = useState(0);

  const lines = invoice.lines || [];
  const totalPages = Math.max(1, Math.ceil(lines.length / ITEMS_PER_PAGE));

  useEffect(() => {
    if (pageIndex >= totalPages) {
      setPageIndex(0);
    }
  }, [totalPages, pageIndex]);

  useEffect(() => {
    if (!isVisible) return;
    const el = boxRef.current;
    if (!el) return;

    const measure = () => {
      const clientW = el.clientWidth || window.innerWidth;
      const clientH = el.clientHeight || window.innerHeight;
      
      const isMobile = window.innerWidth < 768;
      const paddingX = isMobile ? 12 : 28;
      const paddingY = isMobile ? 16 : 40;

      const w = Math.max(120, clientW - paddingX);
      const h = Math.max(120, clientH - paddingY);
      const scaleW = w / INVOICE_WIDTH;
      const scaleH = h / INVOICE_HEIGHT;

      // On mobile screens, fit to width so text is crisp and readable
      let optimal: number;
      if (isMobile) {
        optimal = Math.max(0.38, Math.min(1.0, scaleW));
      } else {
        optimal = Math.max(0.25, Math.min(1.25, Math.min(scaleW, scaleH)));
      }

      const rounded = Number(optimal.toFixed(3));
      setFit(rounded);
      setCurrentScale(rounded);
    };

    const ro = new ResizeObserver(measure);
    measure();
    ro.observe(el);

    // Re-check after layout transitions
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
      {/* في حال وجود أكثر من 9 بنود: أزرار التنقل بين صفحات الفاتورة */}
      {totalPages > 1 && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2 rounded-full border border-white/10 bg-slate-900/95 px-3 py-1 text-white shadow-xl text-xs font-bold">
          <button
            type="button"
            onClick={() => setPageIndex((p) => Math.max(0, p - 1))}
            disabled={pageIndex === 0}
            className="disabled:opacity-30 hover:text-primary transition px-1"
          >
            السابق
          </button>
          <span className="font-mono text-[11px] px-1.5 text-slate-300 bg-white/10 rounded">
            فاتورة {pageIndex + 1} من {totalPages}
          </span>
          <button
            type="button"
            onClick={() => setPageIndex((p) => Math.min(totalPages - 1, p + 1))}
            disabled={pageIndex >= totalPages - 1}
            className="disabled:opacity-30 hover:text-primary transition px-1"
          >
            التالي
          </button>
        </div>
      )}

      {fit !== null && (
        <TransformWrapper
          initialScale={fit}
          minScale={fit * 0.5}
          maxScale={fit * 4.0}
          centerOnInit={false}
          initialPositionX={0}
          initialPositionY={0}
          limitToBounds={false}
          doubleClick={{ mode: "reset" }}
          onTransform={(ref) => {
            setCurrentScale(Number(ref.state.scale.toFixed(2)));
          }}
        >
          {({ zoomIn, zoomOut, resetTransform }) => (
            <>
              <TransformComponent
                wrapperStyle={{ width: "100%", height: "100%", touchAction: "none" }}
                contentStyle={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "flex-start",
                  width: "100%",
                  minWidth: "100%",
                  paddingTop: "10px",
                  paddingBottom: "56px",
                  paddingLeft: "8px",
                  paddingRight: "8px",
                }}
              >
                <div className="rounded-sm shadow-2xl ring-1 ring-black/20 overflow-hidden bg-white origin-top">
                  <InvoiceDocument invoice={invoice} pageIndex={pageIndex} />
                </div>
              </TransformComponent>

              <InvoiceZoomControls
                zoomOut={() => zoomOut(0.2)}
                reset={() => resetTransform()}
                zoomIn={() => zoomIn(0.2)}
                scalePercent={Math.round((currentScale / fit) * 100)}
              />
            </>
          )}
        </TransformWrapper>
      )}
    </div>
  );
}
