"use client";

import { useEffect } from "react";

// Регистрирует service worker только в боевой сборке (в разработке он мешает обновлению страниц).
export default function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);
  return null;
}
