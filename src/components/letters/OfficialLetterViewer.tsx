import React, { useEffect, useRef, useState } from "react";
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";
import { InvoiceZoomControls } from "@/components/invoice/InvoiceZoomControls";
import { OfficialLetterDocument } from "./OfficialLetterDocument";
import type { OfficialLetter } from "@/lib/letters/types";

const LETTER_A4_WIDTH = 794;
const LETTER_A4_HEIGHT = 1123;

interface Props {
  letter: OfficialLetter;
}

export function OfficialLetterViewer({ letter }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [fitScale, setFitScale] = useState<number | null>(null);
  const [currentScale, setCurrentScale] = useState<number>(1);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const calculateFit = () => {
      const isMobile = window.innerWidth < 768;
      const paddingX = isMobile ? 16 : 32;
      const paddingY = isMobile ? 64 : 80;

      const availableW = Math.max(120, el.clientWidth - paddingX);
      const availableH = Math.max(120, el.clientHeight - paddingY);

      const scaleW = availableW / LETTER_A4_WIDTH;
      const scaleH = availableH / LETTER_A4_HEIGHT;
      const optimal = isMobile
        ? Math.max(0.28, Math.min(1.0, Math.min(scaleW, scaleH)))
        : Math.max(0.25, Math.min(1.15, Math.min(scaleW, scaleH)));

      const rounded = Number(optimal.toFixed(3));
      setFitScale(rounded);
      setCurrentScale(rounded);
    };

    const ro = new ResizeObserver(calculateFit);
    calculateFit();
    ro.observe(el);

    const t1 = setTimeout(calculateFit, 60);
    const t2 = setTimeout(calculateFit, 200);
    return () => {
      ro.disconnect();
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [letter.id]);

  return (
    <div
      ref={containerRef}
      dir="ltr"
      className="relative h-full w-full min-h-[340px] overflow-hidden rounded-2xl bg-slate-900/95 dark:bg-zinc-950 flex flex-col items-center justify-start select-none"
    >
      {fitScale !== null && (
        <TransformWrapper
          initialScale={fitScale}
          minScale={fitScale * 0.4}
          maxScale={fitScale * 4.0}
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
                  <div className="rounded-md shadow-2xl ring-1 ring-black/40 overflow-hidden bg-white">
                    <OfficialLetterDocument letter={letter} />
                  </div>
                </TransformComponent>
              </div>

              <div className="shrink-0 w-full py-2 flex items-center justify-center bg-slate-950/90 border-t border-white/10">
                <InvoiceZoomControls
                  inline
                  zoomOut={() => zoomOut(0.15)}
                  reset={() => resetTransform()}
                  zoomIn={() => zoomIn(0.15)}
                  scalePercent={Math.round((currentScale / fitScale) * 100)}
                />
              </div>
            </div>
          )}
        </TransformWrapper>
      )}
    </div>
  );
}
