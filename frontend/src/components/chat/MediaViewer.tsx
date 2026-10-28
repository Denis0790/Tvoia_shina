"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Ico from "./Ico";

export type ViewerItem = { kind: "image" | "video"; url: string; poster?: string };

type P = { x: number; y: number };
const ZERO: P = { x: 0, y: 0 };

export default function MediaViewer({ items, start, onClose }: { items: ViewerItem[]; start: number; onClose: () => void }) {
  const [i, setI] = useState(start);
  const [scale, setScale] = useState(1);
  const [pos, setPos] = useState<P>(ZERO);
  const [drag, setDrag] = useState<P>(ZERO);
  const [dragging, setDragging] = useState(false);

  const pts = useRef(new Map<number, P>());
  const g = useRef({ start: ZERO, base: ZERO, dist: 0, scale: 1, moved: false, lastTap: 0, onBg: false });

  const go = useCallback(
    (d: number) => {
      setI((v) => {
        const n = v + d;
        return n < 0 || n >= items.length ? v : n;
      });
      setScale(1);
      setPos(ZERO);
      setDrag(ZERO);
    },
    [items.length]
  );

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") go(-1);
      else if (e.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", k);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", k);
      document.body.style.overflow = prev;
    };
  }, [go, onClose]);

  useEffect(() => {
    if (scale === 1) setPos(ZERO);
  }, [scale]);

  const dist = () => {
    const [a, b] = Array.from(pts.current.values());
    return Math.hypot(a.x - b.x, a.y - b.y);
  };

  function down(e: React.PointerEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement).closest("button")) return; // нажатия на стрелки — не жест
    g.current.onBg = e.target === e.currentTarget;
    e.currentTarget.setPointerCapture(e.pointerId);
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.current.size === 2) {
      g.current.dist = dist();
      g.current.scale = scale;
    } else {
      g.current.start = { x: e.clientX, y: e.clientY };
      g.current.base = pos;
      g.current.moved = false;
      setDragging(true);
    }
  }

  function move(e: React.PointerEvent<HTMLDivElement>) {
    if (!pts.current.has(e.pointerId)) return;
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.current.size === 2) {
      g.current.moved = true;
      setScale(Math.min(5, Math.max(1, (g.current.scale * dist()) / (g.current.dist || 1))));
      return;
    }
    const dx = e.clientX - g.current.start.x;
    const dy = e.clientY - g.current.start.y;
    if (Math.abs(dx) + Math.abs(dy) > 8) g.current.moved = true;
    if (scale > 1) setPos({ x: g.current.base.x + dx, y: g.current.base.y + dy });
    else setDrag({ x: dx, y: dy });
  }

  function up(e: React.PointerEvent<HTMLDivElement>) {
    if (!pts.current.has(e.pointerId)) return;
    const was = pts.current.size;
    pts.current.delete(e.pointerId);
    if (was === 2) {
      if (scale < 1.05) {
        setScale(1);
        setPos(ZERO);
      }
      const rest = Array.from(pts.current.values())[0];
      if (rest) {
        g.current.start = rest;
        g.current.base = pos;
      }
      return;
    }
    setDragging(false);
    if (scale <= 1.05) {
      const { x: dx, y: dy } = drag;
      if (Math.abs(dy) > 110 && Math.abs(dy) > Math.abs(dx)) {
        onClose();
        return;
      }
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) go(dx < 0 ? 1 : -1);
      setDrag(ZERO);
    }
    if (!g.current.moved) {
      if (g.current.onBg) {
        onClose();
        return;
      }
      const now = Date.now();
      if (now - g.current.lastTap < 300) {
        g.current.lastTap = 0;
        if (scale > 1) {
          setScale(1);
          setPos(ZERO);
        } else setScale(2.5);
      } else g.current.lastTap = now;
    }
  }

  function wheel(e: React.WheelEvent<HTMLDivElement>) {
    setScale((s) => Math.min(5, Math.max(1, s - e.deltaY * 0.002)));
  }

  const it = items[i];
  const bg = Math.max(0.35, 0.95 - Math.abs(drag.y) / 500);
  const gestures =
    it.kind === "image"
      ? { onPointerDown: down, onPointerMove: move, onPointerUp: up, onPointerCancel: up, onWheel: wheel }
      : {};
  const arrow = "absolute top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 text-white items-center justify-center";

  return (
    <div className="fixed inset-0 z-[100] flex flex-col select-none" style={{ background: `rgba(0,0,0,${bg})` }}>
      <div className="relative z-10 flex items-center justify-between px-3 py-2 text-white">
        <span className="pl-1 text-sm">
          {i + 1} / {items.length}
        </span>
        <div className="flex items-center gap-1">
          <a href={it.url} target="_blank" rel="noreferrer" download aria-label="Скачать" className="w-10 h-10 rounded-full hover:bg-white/10 flex items-center justify-center">
            <Ico name="download" className="w-6 h-6" />
          </a>
          <button type="button" onClick={onClose} aria-label="Закрыть" className="w-10 h-10 rounded-full hover:bg-white/10 flex items-center justify-center">
            <Ico name="close" className="w-6 h-6" />
          </button>
        </div>
      </div>
      <div className="relative flex-1 min-h-0 flex items-center justify-center overflow-hidden touch-none" {...gestures}>
        {it.kind === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={it.url}
            alt=""
            draggable={false}
            className="max-w-full max-h-full object-contain"
            style={{
              transform: `translate(${pos.x + drag.x}px, ${pos.y + drag.y}px) scale(${scale})`,
              transition: dragging ? "none" : "transform .2s",
              cursor: scale > 1 ? "grab" : "zoom-in",
            }}
          />
        ) : (
          <video key={it.url} src={it.url} poster={it.poster} controls autoPlay playsInline className="max-w-full max-h-full" />
        )}
        {i > 0 && (
          <button type="button" onClick={() => go(-1)} aria-label="Назад" className={`${arrow} left-3 flex`}>
            <Ico name="chevron-left" className="w-6 h-6" />
          </button>
        )}
        {i < items.length - 1 && (
          <button type="button" onClick={() => go(1)} aria-label="Вперёд" className={`${arrow} right-3 flex`}>
            <Ico name="chevron-left" className="w-6 h-6 rotate-180" />
          </button>
        )}
      </div>
    </div>
  );
}
