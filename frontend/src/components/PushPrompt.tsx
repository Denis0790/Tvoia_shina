"use client";

import { useEffect, useState } from "react";
import { pushSupported, subscribeDevice } from "@/lib/push";

type Fetcher = (path: string, init?: RequestInit) => Promise<Response>;
const DISMISS_KEY = "push_prompt_dismissed";
const DISMISS_DAYS = 7;

// Уведомления по умолчанию: разрешение уже есть — подписываем тихо, нет — одна плашка с кнопкой.
export default function PushPrompt({ fetcher, active }: { fetcher: Fetcher; active: boolean }) {
  const [ask, setAsk] = useState(false);

  useEffect(() => {
    if (!active || !pushSupported()) return;
    if (Notification.permission === "granted") {
      subscribeDevice(fetcher).catch(() => {});
      return;
    }
    if (Notification.permission !== "default") return;
    try {
      const t = Number(localStorage.getItem(DISMISS_KEY) || 0);
      if (t && Date.now() - t < DISMISS_DAYS * 86400000) return;
    } catch {}
    setAsk(true);
  }, [active, fetcher]);

  if (!ask) return null;

  function later() {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {}
    setAsk(false);
  }

  async function enable() {
    setAsk(false);
    try {
      const perm = await Notification.requestPermission();
      if (perm === "granted") await subscribeDevice(fetcher);
    } catch {}
  }

  return (
    <div className="fixed top-3 inset-x-3 md:left-auto md:right-4 md:max-w-sm z-[70] rounded-2xl bg-white shadow-2xl border border-gray-200 p-4 text-sm text-gray-700">
      <p className="font-semibold text-gray-900 mb-1">Включить уведомления?</p>
      <p>Чтобы не пропустить ответ в чате и напоминание о записи.</p>
      <div className="mt-3 flex gap-2">
        <button onClick={enable} className="flex-1 bg-brand-yellow text-brand-blue-dark font-semibold rounded-xl py-2.5">
          Включить
        </button>
        <button onClick={later} className="flex-1 border border-gray-200 rounded-xl py-2.5 text-gray-600">
          Не сейчас
        </button>
      </div>
    </div>
  );
}
