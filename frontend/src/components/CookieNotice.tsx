"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

export const COOKIE_KEY = "cookie_notice_ok";

export default function CookieNotice() {
  const pathname = usePathname();
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      if (!localStorage.getItem(COOKIE_KEY)) setShow(true);
    } catch {
      /* хранилище недоступно: плашку не показываем */
    }
  }, []);

  if (!show || pathname.startsWith("/nord")) return null;

  function accept() {
    try {
      localStorage.setItem(COOKIE_KEY, "1");
    } catch {}
    setShow(false);
    window.dispatchEvent(new Event("cookie-notice-ok"));
  }

  return (
    <div className="fixed inset-x-3 bottom-20 md:bottom-4 md:left-auto md:right-4 md:max-w-sm z-[60] rounded-2xl bg-white shadow-2xl border border-gray-200 p-4 text-sm text-gray-700">
      <p>
        Сайт использует только необходимые cookie: они нужны, чтобы вы оставались в аккаунте.
        Аналитики и рекламы нет.{" "}
        <a href="/privacy" className="text-brand-blue underline">
          Подробнее
        </a>
      </p>
      <button
        onClick={accept}
        className="mt-3 w-full bg-brand-yellow text-brand-blue-dark font-semibold rounded-xl py-2.5 hover:brightness-95 transition"
      >
        Понятно
      </button>
    </div>
  );
}
