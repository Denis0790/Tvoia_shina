"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { COOKIE_KEY } from "./CookieNotice";

const DISMISS_KEY = "install_prompt_dismissed";
const DISMISS_DAYS = 14;

type InstallEvent = Event & { prompt: () => Promise<void> };

function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

export default function InstallPrompt() {
  const pathname = usePathname();
  const [mode, setMode] = useState<"android" | "ios" | "manual" | null>(null);
  const [cookieOk, setCookieOk] = useState(false);
  const [deferred, setDeferred] = useState<InstallEvent | null>(null);

  useEffect(() => {
    try {
      setCookieOk(!!localStorage.getItem(COOKIE_KEY));
      const t = Number(localStorage.getItem(DISMISS_KEY) || 0);
      if (t && Date.now() - t < DISMISS_DAYS * 86400000) return;
    } catch {}
    if (isStandalone()) return;

    const ua = navigator.userAgent;
    const isIos =
      /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    const isAndroid = /Android/.test(ua);
    if (isIos) setMode("ios");

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as InstallEvent);
      if (isAndroid) setMode("android");
    };
    // Chrome иногда не присылает событие установки: тогда показываем инструкцию вручную
    const timer = isAndroid ? setTimeout(() => setMode((m) => m ?? "manual"), 4000) : null;
    const onCookie = () => setCookieOk(true);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("cookie-notice-ok", onCookie);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("cookie-notice-ok", onCookie);
    };
  }, []);

  if (!mode || !cookieOk || pathname.startsWith("/nord") || pathname === "/login") return null;

  function dismiss() {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {}
    setMode(null);
  }

  async function install() {
    if (!deferred) return;
    await deferred.prompt();
    dismiss();
  }

  return (
    <div className="fixed inset-x-3 bottom-20 md:hidden z-[60] rounded-2xl bg-white shadow-2xl border border-gray-200 p-4 text-sm text-gray-700">
      <p className="font-semibold text-gray-900 mb-1">Установите приложение «СТО Твоя Шина»</p>
      {mode === "ios" ? (
        <p>
          Нажмите «Поделиться» (квадрат со стрелкой) в браузере и выберите «На экран Домой».
        </p>
      ) : mode === "manual" ? (
        <p>Откройте меню браузера (три точки вверху) и выберите «Установить приложение» или «Добавить на главный экран».</p>
      ) : (
        <p>Запись и чат будут под рукой, как обычное приложение.</p>
      )}
      <div className="mt-3 flex gap-2">
        {mode === "android" && (
          <button
            onClick={install}
            className="flex-1 bg-brand-yellow text-brand-blue-dark font-semibold rounded-xl py-2.5"
          >
            Установить
          </button>
        )}
        <button onClick={dismiss} className="flex-1 border border-gray-200 rounded-xl py-2.5 text-gray-600">
          {mode === "ios" ? "Понятно" : "Не сейчас"}
        </button>
      </div>
    </div>
  );
}
