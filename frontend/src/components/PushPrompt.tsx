"use client";

import { useCallback, useEffect, useState } from "react";
import { pushSupported, subscribeDevice } from "@/lib/push";
import { COOKIE_KEY } from "./CookieNotice";

type Fetcher = (path: string, init?: RequestInit) => Promise<Response>;
const DISMISS_KEY = "push_prompt_dismissed";
const DISMISS_DAYS = 30;

// Уведомления по умолчанию: разрешение уже есть — подписываем тихо, нет — одна плашка с кнопкой.
// Плашки не копим: ждём принятия куки, а на телефоне в браузере сначала предлагается установка приложения.
export default function PushPrompt({ fetcher, active }: { fetcher: Fetcher; active: boolean }) {
  const [ask, setAsk] = useState(false);

  const evaluate = useCallback(() => {
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
    const admin = window.location.pathname.startsWith("/nord");
    if (!admin) {
      try {
        if (!localStorage.getItem(COOKIE_KEY)) return;
      } catch {}
      const standalone =
        window.matchMedia("(display-mode: standalone)").matches ||
        (navigator as unknown as { standalone?: boolean }).standalone === true;
      const mobile = /Android|iPhone|iPad|iPod/.test(navigator.userAgent);
      if (mobile && !standalone) return;
    }
    setAsk(true);
  }, [active, fetcher]);

  useEffect(() => {
    evaluate();
    window.addEventListener("cookie-notice-ok", evaluate);
    return () => window.removeEventListener("cookie-notice-ok", evaluate);
  }, [evaluate]);

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
