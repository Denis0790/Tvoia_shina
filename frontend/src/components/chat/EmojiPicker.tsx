"use client";

import { useEffect, useRef, useState } from "react";
import { EMOJI_CATS, RECENT_ICON } from "@/lib/emojiData";
import Emoji from "./Emoji";

const RECENT_KEY = "chat_recent_emoji";

function loadRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
    return Array.isArray(v) ? v.slice(0, 28) : [];
  } catch {
    return [];
  }
}

function saveRecent(list: string[]) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {}
}

export default function EmojiPicker({ onPick, onClose }: { onPick: (e: string) => void; onClose: () => void }) {
  const [recent, setRecent] = useState<string[]>([]);
  const [cat, setCat] = useState("smile");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const r = loadRecent();
    setRecent(r);
    if (r.length) setCat("recent");
  }, []);

  useEffect(() => {
    const down = (e: MouseEvent | TouchEvent) => {
      const t = e.target as HTMLElement;
      if (ref.current && !ref.current.contains(t) && !t.closest("[data-emoji-toggle]")) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", down);
    document.addEventListener("touchstart", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("touchstart", down);
      document.removeEventListener("keydown", key);
    };
  }, [onClose]);

  const tabs = [
    ...(recent.length ? [{ id: "recent", icon: RECENT_ICON, title: "Недавние", items: recent }] : []),
    ...EMOJI_CATS,
  ];
  const current = tabs.find((t) => t.id === cat) ?? tabs[0];

  function pick(e: string) {
    onPick(e);
    const next = [e, ...recent.filter((x) => x !== e)].slice(0, 28);
    setRecent(next);
    saveRecent(next);
  }

  return (
    <div
      ref={ref}
      className="w-[21rem] max-w-[calc(100vw-1.5rem)] h-[22rem] flex flex-col rounded-3xl bg-white border border-gray-100 shadow-2xl overflow-hidden"
    >
      <div className="flex border-b border-gray-100 px-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setCat(t.id)}
            title={t.title}
            className={`flex-1 h-12 flex items-center justify-center border-b-2 transition ${
              t.id === current.id ? "border-brand-yellow" : "border-transparent opacity-50 hover:opacity-100"
            }`}
          >
            <Emoji char={t.icon} size={24} />
          </button>
        ))}
      </div>
      <div className="px-4 pt-2.5 text-xs font-semibold text-gray-500">{current.title}</div>
      <div className="flex-1 overflow-y-auto grid grid-cols-7 content-start gap-1 p-2.5">
        {current.items.map((e, i) => (
          <button
            key={`${e}-${i}`}
            type="button"
            onClick={() => pick(e)}
            className="h-11 w-11 rounded-xl flex items-center justify-center hover:bg-gray-100 active:scale-90 transition"
          >
            <Emoji char={e} size={32} />
          </button>
        ))}
      </div>
    </div>
  );
}
