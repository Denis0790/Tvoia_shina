export type Fetcher = (path: string, init?: RequestInit) => Promise<Response>;
export type Role = "client" | "manager";

export type ChatMessage = {
  id: string;
  conversation_id: string;
  sender_role: "client" | "manager" | "system";
  kind: string;
  text: string | null;
  deleted: boolean;
  reply_to: { id: string; sender_role: string; text: string | null } | null;
  created_at: string;
  edited_at: string | null;
  read: boolean;
  client_msg_id: string | null;
  pending?: boolean;
  failed?: boolean;
};

export type ConversationItem = {
  id: string;
  client: { id: string; name: string; phone: string | null; login: string | null; is_org: boolean };
  last_message: string | null;
  last_message_at: string | null;
  unread: number;
};

export type Counters = { unread_messages: number; unread_dialogs: number; pending_bookings: number };

export const JSON_HEADERS = { "Content-Type": "application/json" };
const TZ = "Europe/Moscow";

export function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
  }
}

export async function getMessages(
  f: Fetcher,
  convId: string,
  beforeId?: string
): Promise<{ messages: ChatMessage[]; has_more: boolean } | null> {
  const qs = new URLSearchParams({ limit: "50" });
  if (beforeId) qs.set("before_id", beforeId);
  const r = await f(`/chat/conversations/${convId}/messages?${qs}`);
  return r.ok ? r.json() : null;
}

export function upsertMessage(list: ChatMessage[], msg: ChatMessage): ChatMessage[] {
  const i = list.findIndex((m) => m.id === msg.id || (!!msg.client_msg_id && m.client_msg_id === msg.client_msg_id));
  if (i === -1) return [...list, msg];
  const next = list.slice();
  next[i] = msg;
  return next;
}

const timeFmt = new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
const keyFmt = new Intl.DateTimeFormat("sv-SE", { timeZone: TZ });
const dayFmt = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", timeZone: TZ });
const dayYearFmt = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: TZ });
const shortFmt = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", timeZone: TZ });

export function formatTime(iso: string): string {
  return timeFmt.format(new Date(iso));
}

export function dayKey(iso: string): string {
  return keyFmt.format(new Date(iso));
}

export function dayLabel(iso: string): string {
  const key = dayKey(iso);
  const today = dayKey(new Date().toISOString());
  const yesterday = dayKey(new Date(Date.now() - 864e5).toISOString());
  if (key === today) return "Сегодня";
  if (key === yesterday) return "Вчера";
  const fmt = key.slice(0, 4) === today.slice(0, 4) ? dayFmt : dayYearFmt;
  return fmt.format(new Date(iso));
}

export function listTime(iso: string | null): string {
  if (!iso) return "";
  if (dayKey(iso) === dayKey(new Date().toISOString())) return formatTime(iso);
  return shortFmt.format(new Date(iso));
}
