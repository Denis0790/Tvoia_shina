"use client";

import { useRef } from "react";

// Горизонтальная лента: пальцем листается сама, мышью — перетаскиванием (без полосы прокрутки).
export default function DragScroll({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef({ down: false, x: 0, left: 0, moved: false });

  return (
    <div
      ref={ref}
      className={`flex gap-2 overflow-x-auto cursor-grab active:cursor-grabbing select-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [&>*]:shrink-0 [&>*]:whitespace-nowrap ${className}`}
      onMouseDown={(e) => {
        drag.current = { down: true, x: e.pageX, left: ref.current?.scrollLeft ?? 0, moved: false };
      }}
      onMouseMove={(e) => {
        const d = drag.current;
        if (!d.down || !ref.current) return;
        const dx = e.pageX - d.x;
        if (Math.abs(dx) > 4) d.moved = true;
        ref.current.scrollLeft = d.left - dx;
      }}
      onMouseUp={() => (drag.current.down = false)}
      onMouseLeave={() => (drag.current.down = false)}
      onClickCapture={(e) => {
        // после перетаскивания клик по кнопке не засчитываем
        if (drag.current.moved) {
          e.preventDefault();
          e.stopPropagation();
          drag.current.moved = false;
        }
      }}
    >
      {children}
    </div>
  );
}
