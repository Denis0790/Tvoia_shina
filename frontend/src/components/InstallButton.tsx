"use client";

import { useEffect, useState } from "react";
import { getDeferredInstall, isIosDevice, isStandalone, setDeferredInstall } from "@/lib/install";

type RelatedNav = { getInstalledRelatedApps?: () => Promise<unknown[]> };

// Кнопка «Установить приложение» для профиля клиента. Показывается только на телефонах.
export default function InstallButton() {
  const [ready, setReady] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [running, setRunning] = useState(false); // открыто из установленного приложения
  const [already, setAlready] = useState(false); // приложение есть на телефоне, но открыли в браузере
  const [canInstall, setCanInstall] = useState(false);
  const [help, setHelp] = useState(false);
  const ios = ready && isIosDevice();

  useEffect(() => {
    const sync = () => {
      setRunning(isStandalone());
      const ev = !!getDeferredInstall();
      setCanInstall(ev);
      if (ev) setAlready(false); // Chrome присылает событие только когда приложения нет
    };
    sync();
    setMobile(/Android|iPhone|iPad|iPod/.test(navigator.userAgent) || isIosDevice());
    setReady(true);
    (navigator as unknown as RelatedNav)
      .getInstalledRelatedApps?.()
      .then((apps) => {
        if (apps && apps.length > 0 && !getDeferredInstall()) setAlready(true);
      })
      .catch(() => {});
    window.addEventListener("install-available", sync);
    window.addEventListener("appinstalled", sync);
    return () => {
      window.removeEventListener("install-available", sync);
      window.removeEventListener("appinstalled", sync);
    };
  }, []);

  if (!ready || !mobile) return null;

  if (running) return <p className="text-sm text-gray-500">Приложение установлено ✓</p>;

  if (already && !canInstall) {
    return (
      <p className="text-sm text-gray-500">
        Приложение уже установлено на этом телефоне. Откройте его с главного экрана.
      </p>
    );
  }

  async function install() {
    const ev = getDeferredInstall();
    if (!ev) {
      setHelp((v) => !v);
      return;
    }
    await ev.prompt();
    const { outcome } = await ev.userChoice;
    if (outcome === "accepted") setDeferredInstall(null);
  }

  return (
    <div>
      <p className="text-sm text-gray-600">Запись и чат будут под рукой, как обычное приложение.</p>
      <button
        onClick={install}
        className="mt-3 bg-brand-yellow text-brand-blue-dark font-semibold rounded-xl px-5 py-2.5 text-sm"
      >
        Установить приложение
      </button>
      {help && !canInstall && (
        <p className="mt-3 text-sm text-gray-600">
          {ios
            ? "Нажмите «Поделиться» (квадрат со стрелкой) в браузере и выберите «На экран Домой»."
            : "Откройте меню браузера (три точки вверху) и выберите «Установить приложение» или «Добавить на главный экран»."}
        </p>
      )}
    </div>
  );
}
