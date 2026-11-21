"use client";

import { useCallback, useEffect, useState } from "react";

type Fetcher = (path: string, init?: RequestInit) => Promise<Response>;
type State = "loading" | "unsupported" | "needs-install" | "denied" | "off" | "on" | "busy";

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

const HINTS: Record<State, string> = {
  loading: "",
  busy: "…",
  unsupported: "Этот браузер не поддерживает уведомления",
  "needs-install": "На iPhone сначала добавьте приложение на экран «Домой» и откройте его оттуда",
  denied: "Уведомления запрещены в настройках браузера или телефона",
  off: "Сообщения и напоминания о записи",
  on: "Включены на этом устройстве",
};

export default function PushToggle({ fetcher, className = "" }: { fetcher: Fetcher; className?: string }) {
  const [state, setState] = useState<State>("loading");

  const refresh = useCallback(async () => {
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as unknown as { standalone?: boolean }).standalone === true;
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      setState(ios && !standalone ? "needs-install" : "unsupported");
      return;
    }
    if (Notification.permission === "denied") {
      setState("denied");
      return;
    }
    try {
      const reg = await navigator.serviceWorker.ready;
      setState((await reg.pushManager.getSubscription()) ? "on" : "off");
    } catch {
      setState("unsupported");
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function enable() {
    setState("busy");
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setState(perm === "denied" ? "denied" : "off");
        return;
      }
      const keyRes = await fetcher("/push/public-key");
      if (!keyRes.ok) {
        setState("unsupported");
        return;
      }
      const { key } = await keyRes.json();
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key) as BufferSource,
      });
      const res = await fetcher("/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub.toJSON()),
      });
      if (!res.ok) {
        await sub.unsubscribe();
        setState("off");
        return;
      }
      setState("on");
    } catch {
      setState("off");
    }
  }

  async function disable() {
    setState("busy");
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetcher("/push/unsubscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setState("off");
    } catch {
      setState("on");
    }
  }

  const canToggle = state === "on" || state === "off" || state === "busy";
  return (
    <div className={`flex items-center justify-between gap-3 ${className}`}>
      <div className="min-w-0">
        <p className="text-sm font-medium text-gray-900">Уведомления</p>
        <p className="text-xs text-gray-500 mt-0.5">{HINTS[state]}</p>
      </div>
      {canToggle && (
        <button
          type="button"
          role="switch"
          aria-checked={state === "on"}
          aria-label="Уведомления"
          disabled={state === "busy"}
          onClick={state === "on" ? disable : enable}
          className={`relative w-11 h-6 rounded-full shrink-0 transition-colors cursor-pointer disabled:opacity-60 ${
            state === "on" ? "bg-brand-blue" : "bg-gray-300"
          }`}
        >
          <span
            className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
              state === "on" ? "translate-x-5" : ""
            }`}
          />
        </button>
      )}
    </div>
  );
}
