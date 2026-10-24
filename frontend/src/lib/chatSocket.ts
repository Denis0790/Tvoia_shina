import { apiFetch, getAccessToken } from "@/lib/auth";
import { getManagerAccessToken, refreshManagerAccessToken } from "@/lib/managerAuth";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export type ChatEvent = {
  type: string;
  conversation_id?: string;
  by?: string;
  message?: any;
  [k: string]: any;
};
type Listener = (e: ChatEvent) => void;

/** Одно общее соединение на всех подписчиков: открывается при первом, закрывается после последнего.
 *  Служебные события: _open (соединение (пере)установлено) и _close. */
export function createChatSocket(getToken: () => Promise<string | null>) {
  const listeners = new Set<Listener>();
  let ws: WebSocket | null = null;
  let gen = 0;
  let running = false;
  let retry = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let ping: ReturnType<typeof setInterval> | null = null;

  const emit = (e: ChatEvent) => listeners.forEach((l) => l(e));

  function schedule(myGen: number) {
    if (!running || myGen !== gen) return;
    if (timer) clearTimeout(timer);
    const delay = Math.min(15000, 1000 * 2 ** Math.min(retry++, 4));
    timer = setTimeout(() => connect(myGen), delay);
  }

  async function connect(myGen: number) {
    if (!running || myGen !== gen) return;
    let token: string | null = null;
    try {
      token = await getToken();
    } catch {
      token = null;
    }
    if (!running || myGen !== gen) return;
    if (!token) {
      schedule(myGen);
      return;
    }
    const sock = new WebSocket(`${API_URL.replace(/^http/, "ws")}/chat/ws?token=${encodeURIComponent(token)}`);
    ws = sock;
    sock.onopen = () => {
      retry = 0;
      if (ping) clearInterval(ping);
      ping = setInterval(() => {
        if (sock.readyState === 1) sock.send('{"type":"ping"}');
      }, 25000);
      emit({ type: "_open" });
    };
    sock.onmessage = (ev) => {
      try {
        const d = JSON.parse(ev.data);
        if (d.type !== "pong") emit(d);
      } catch {}
    };
    sock.onclose = () => {
      if (ping) clearInterval(ping);
      ping = null;
      if (ws === sock) ws = null;
      if (myGen !== gen) return;
      emit({ type: "_close" });
      schedule(myGen);
    };
    sock.onerror = () => sock.close();
  }

  return {
    subscribe(l: Listener) {
      listeners.add(l);
      if (!running) {
        running = true;
        retry = 0;
        gen += 1;
        connect(gen);
      }
      return () => {
        listeners.delete(l);
        if (listeners.size === 0) {
          running = false;
          gen += 1;
          if (timer) clearTimeout(timer);
          if (ping) clearInterval(ping);
          ping = null;
          ws?.close();
          ws = null;
        }
      };
    },
    send(obj: object) {
      if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
    },
  };
}

export type ChatSocket = ReturnType<typeof createChatSocket>;

export const clientSocket = createChatSocket(async () => {
  let t = getAccessToken();
  if (!t) {
    await apiFetch("/users/me"); // при необходимости обновит токен по куке
    t = getAccessToken();
  }
  return t;
});

export const managerSocket = createChatSocket(async () => getManagerAccessToken() ?? (await refreshManagerAccessToken()));
