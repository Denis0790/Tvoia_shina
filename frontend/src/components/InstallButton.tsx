"use client";

import { useEffect, useState } from "react";
import { getDeferredInstall, isIosDevice, isStandalone, setDeferredInstall } from "@/lib/install";

// Кнопка «Установить приложение» для профиля клиента.
export default function InstallButton() {
  const [ready, setReady] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [canInstall, setCanInstall] = useState(false);
  const [help, setHelp] = useState(false);
  const ios = ready && isIosDevice();

  useEffect(() => {
    const sync = () => {
      setInstalled(isStandalone());
      setCanInstall(!!getDeferredInstall());
    };
    sync();
    setReady(true);
    window.addEventListener("install-available", sync);
    window.addEventListener("appinstalled", sync);
    return () => {
      window.removeEventListener("install-available", sync);
      window.removeEventListener("appinstalled", sync);
    };
  }, []);

  if (!ready) return null;

  if (installed) {
    return <p className="text-sm text-gray-500">Приложение установлено ✓</p>;
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
