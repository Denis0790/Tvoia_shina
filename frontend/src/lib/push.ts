// Подписка устройства на push-уведомления (разрешение браузера уже должно быть выдано).
type Fetcher = (path: string, init?: RequestInit) => Promise<Response>;

export function pushSupported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

// Подписывает устройство и привязывает его к текущему аккаунту (повторный вызов безопасен).
export async function subscribeDevice(fetcher: Fetcher): Promise<boolean> {
  const keyRes = await fetcher("/push/public-key");
  if (!keyRes.ok) return false;
  const { key } = await keyRes.json();
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key) as BufferSource,
    });
  }
  const res = await fetcher("/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(sub.toJSON()),
  });
  return res.ok;
}
