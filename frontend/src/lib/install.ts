// Общее для окна установки и кнопки в профиле: Chrome присылает событие «можно установить» один раз,
// поэтому держим его в window, чтобы любой компонент мог им воспользоваться.
export type InstallEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

type W = Window & { __deferredInstall?: InstallEvent };

export function setDeferredInstall(e: InstallEvent | null) {
  (window as W).__deferredInstall = e ?? undefined;
  window.dispatchEvent(new Event("install-available"));
}

export function getDeferredInstall(): InstallEvent | null {
  return (window as W).__deferredInstall ?? null;
}

export function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

export function isIosDevice() {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}
