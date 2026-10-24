"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ChatMessage,
  Fetcher,
  JSON_HEADERS,
  Role,
  dayKey,
  dayLabel,
  formatTime,
  getMessages,
  newId,
  upsertMessage,
} from "@/lib/chat";
import type { ChatEvent, ChatSocket } from "@/lib/chatSocket";
import EmojiPicker from "./EmojiPicker";
import Ico from "./Ico";
import Emoji from "./Emoji";
import { isEmojiOnly, splitEmoji } from "@/lib/emojiData";

const EDIT_MS = 24 * 60 * 60 * 1000;

function MessageText({ text }: { text: string }) {
  return (
    <span className="whitespace-pre-wrap break-words">
      {splitEmoji(text).map((p, i) =>
        p.emoji ? <Emoji key={i} char={p.v} size={24} className="align-[-0.4em] mx-px" /> : <span key={i}>{p.v}</span>
      )}
    </span>
  );
}

type Scroll = "bottom" | "smooth" | "unread" | { prevHeight: number; prevTop: number } | null;

type Props = {
  convId: string;
  me: Role;
  fetcher: Fetcher;
  socket: ChatSocket;
  title: string;
  subtitle?: string;
  onBack?: () => void;
  action?: React.ReactNode;
  emptyText?: string;
};

export default function ChatThread({ convId, me, fetcher, socket, title, subtitle, onBack, action, emptyText }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [firstUnreadId, setFirstUnreadId] = useState<string | null>(null);
  const [typing, setTyping] = useState(false);
  const [text, setText] = useState("");
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [editing, setEditing] = useState<ChatMessage | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [newBelow, setNewBelow] = useState(0);
  const [showDown, setShowDown] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const atBottomRef = useRef(true);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTypingSent = useRef(0);
  const pendingScroll = useRef<Scroll>(null);
  const loadedRef = useRef(false);
  const hasMoreRef = useRef(false);
  const loadingMoreRef = useRef(false);
  const unreadPending = useRef(false);
  const messagesRef = useRef<ChatMessage[]>([]);
  messagesRef.current = messages;

  const markRead = useCallback(() => {
    if (document.visibilityState !== "visible") return;
    fetcher(`/chat/conversations/${convId}/read`, { method: "POST" }).catch(() => {});
  }, [convId, fetcher]);

  // первая загрузка диалога
  useEffect(() => {
    let cancelled = false;
    loadedRef.current = false;
    hasMoreRef.current = false;
    unreadPending.current = false;
    atBottomRef.current = true;
    setLoaded(false);
    setMessages([]);
    setReplyTo(null);
    setEditing(null);
    setText("");
    setNewBelow(0);
    setFirstUnreadId(null);
    setTyping(false);
    setError(null);
    getMessages(fetcher, convId)
      .then((res) => {
        if (cancelled) return;
        if (!res) {
          setLoaded(true);
          return;
        }
        const firstUnread = res.messages.find((m) => m.sender_role !== me && !m.read);
        setFirstUnreadId(firstUnread?.id ?? null);
        pendingScroll.current = firstUnread ? "unread" : "bottom";
        hasMoreRef.current = res.has_more;
        loadedRef.current = true;
        setMessages(res.messages);
        setLoaded(true);
        if (firstUnread) markRead();
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [convId, fetcher, me, markRead]);

  const resync = useCallback(async () => {
    const res = await getMessages(fetcher, convId);
    if (!res) return;
    setMessages((prev) => res.messages.reduce((acc, m) => upsertMessage(acc, m), prev));
    if (atBottomRef.current) markRead();
  }, [convId, fetcher, markRead]);

  // события в реальном времени
  useEffect(() => {
    return socket.subscribe((e: ChatEvent) => {
      if (e.type === "_open") {
        if (loadedRef.current) resync();
        return;
      }
      if (e.conversation_id !== convId) return;
      if (e.type === "message") {
        const m = e.message as ChatMessage;
        setMessages((p) => upsertMessage(p, m));
        if (m.sender_role !== me) {
          setTyping(false);
          if (atBottomRef.current && document.visibilityState === "visible") {
            pendingScroll.current = "smooth";
            markRead();
          } else {
            unreadPending.current = true;
            setNewBelow((n) => n + 1);
          }
        } else if (atBottomRef.current) {
          pendingScroll.current = "smooth";
        }
      } else if (e.type === "message_updated" || e.type === "message_deleted") {
        const m = e.message as ChatMessage;
        setMessages((p) => p.map((x) => (x.id === m.id ? { ...x, ...m } : x)));
      } else if (e.type === "read") {
        if (e.by !== me) setMessages((p) => p.map((x) => (x.sender_role === me && !x.read && !x.pending ? { ...x, read: true } : x)));
      } else if (e.type === "typing") {
        if (e.by !== me) {
          setTyping(true);
          if (typingTimer.current) clearTimeout(typingTimer.current);
          typingTimer.current = setTimeout(() => setTyping(false), 3500);
        }
      }
    });
  }, [socket, convId, me, resync, markRead]);

  // возвращение на вкладку
  useEffect(() => {
    const f = () => {
      if (document.visibilityState === "visible" && unreadPending.current && atBottomRef.current) {
        unreadPending.current = false;
        setNewBelow(0);
        markRead();
      }
    };
    document.addEventListener("visibilitychange", f);
    return () => document.removeEventListener("visibilitychange", f);
  }, [markRead]);

  // прокрутка после обновления списка
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const p = pendingScroll.current;
    if (!el || !p) return;
    pendingScroll.current = null;
    if (p === "bottom") el.scrollTop = el.scrollHeight;
    else if (p === "smooth") el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    else if (p === "unread") {
      const node = el.querySelector<HTMLElement>('[data-line="new"]');
      el.scrollTop = node ? Math.max(0, node.offsetTop - 12) : el.scrollHeight;
    } else {
      el.scrollTop = p.prevTop + (el.scrollHeight - p.prevHeight);
    }
  }, [messages]);

  // высота поля ввода
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 132) + "px";
  }, [text]);

  const loadOlder = useCallback(async () => {
    const el = scrollRef.current;
    const first = messagesRef.current.find((m) => !m.id.startsWith("tmp-"));
    if (!el || !first || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    const prevHeight = el.scrollHeight;
    const prevTop = el.scrollTop;
    try {
      const res = await getMessages(fetcher, convId, first.id);
      if (res) {
        hasMoreRef.current = res.has_more;
        pendingScroll.current = { prevHeight, prevTop };
        setMessages((p) => {
          const ids = new Set(p.map((m) => m.id));
          return [...res.messages.filter((m) => !ids.has(m.id)), ...p];
        });
      }
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [convId, fetcher]);

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    atBottomRef.current = dist < 80;
    setShowDown(dist > 240);
    if (atBottomRef.current) {
      setNewBelow(0);
      if (unreadPending.current) {
        unreadPending.current = false;
        markRead();
      }
    }
    if (el.scrollTop < 100 && hasMoreRef.current && !loadingMoreRef.current) loadOlder();
  }

  function scrollDown() {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }

  function jumpTo(id: string) {
    const n = document.getElementById(`msg-${id}`);
    if (!n) return;
    n.scrollIntoView({ block: "center", behavior: "smooth" });
    setFlashId(id);
    setTimeout(() => setFlashId(null), 1200);
  }

  async function deliver(tmp: ChatMessage) {
    try {
      const res = await fetcher(`/chat/conversations/${convId}/messages`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ text: tmp.text, reply_to_id: tmp.reply_to?.id ?? null, client_msg_id: tmp.client_msg_id }),
      });
      if (!res.ok) throw new Error();
      const m = (await res.json()) as ChatMessage;
      setMessages((p) => upsertMessage(p, m));
    } catch {
      setMessages((p) => p.map((x) => (x.id === tmp.id ? { ...x, pending: false, failed: true } : x)));
    }
  }

  async function submit() {
    const body = text.trim();
    if (!body) return;
    setError(null);
    setEmojiOpen(false);
    if (editing) {
      const ed = editing;
      setEditing(null);
      setText("");
      const r = await fetcher(`/chat/messages/${ed.id}`, { method: "PATCH", headers: JSON_HEADERS, body: JSON.stringify({ text: body }) });
      if (r.ok) {
        const m = (await r.json()) as ChatMessage;
        setMessages((p) => p.map((x) => (x.id === m.id ? { ...x, ...m } : x)));
      } else {
        const d = await r.json().catch(() => null);
        setError(d?.detail || "Не удалось изменить сообщение");
      }
      return;
    }
    const cid = newId();
    const tmp: ChatMessage = {
      id: `tmp-${cid}`,
      conversation_id: convId,
      sender_role: me,
      kind: "text",
      text: body,
      deleted: false,
      reply_to: replyTo ? { id: replyTo.id, sender_role: replyTo.sender_role, text: (replyTo.text || "").slice(0, 120) } : null,
      created_at: new Date().toISOString(),
      edited_at: null,
      read: false,
      client_msg_id: cid,
      pending: true,
    };
    pendingScroll.current = "smooth";
    setMessages((p) => [...p, tmp]);
    setText("");
    setReplyTo(null);
    deliver(tmp);
  }

  function retry(m: ChatMessage) {
    setMessages((p) => p.map((x) => (x.id === m.id ? { ...x, pending: true, failed: false } : x)));
    deliver({ ...m, pending: true, failed: false });
  }

  async function remove(m: ChatMessage) {
    setActiveId(null);
    if (!window.confirm("Удалить сообщение?")) return;
    const r = await fetcher(`/chat/messages/${m.id}`, { method: "DELETE" });
    if (r.ok) {
      const d = (await r.json()) as ChatMessage;
      setMessages((p) => p.map((x) => (x.id === m.id ? { ...x, ...d } : x)));
    } else {
      setError("Не удалось удалить сообщение");
    }
  }

  function startEdit(m: ChatMessage) {
    setActiveId(null);
    setReplyTo(null);
    setEditing(m);
    setText(m.text || "");
    taRef.current?.focus();
  }

  function startReply(m: ChatMessage) {
    setActiveId(null);
    setEditing(null);
    setReplyTo(m);
    taRef.current?.focus();
  }

  function cancelEdit() {
    setEditing(null);
    setText("");
  }

  function onChange(v: string) {
    setText(v);
    const now = Date.now();
    if (v && now - lastTypingSent.current > 2500) {
      lastTypingSent.current = now;
      socket.send({ type: "typing", conversation_id: convId });
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Escape") {
      setReplyTo(null);
      if (editing) cancelEdit();
      return;
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      const coarse = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
      if (!coarse) {
        e.preventDefault();
        submit();
      }
    }
  }

  function insertEmoji(emoji: string) {
    const ta = taRef.current;
    if (!ta) {
      setText((t) => t + emoji);
      return;
    }
    const s = ta.selectionStart ?? text.length;
    const en = ta.selectionEnd ?? s;
    setText(text.slice(0, s) + emoji + text.slice(en));
    requestAnimationFrame(() => {
      ta.focus();
      const pos = s + emoji.length;
      ta.setSelectionRange(pos, pos);
    });
  }

  const who = (role: string) => (role === me ? "Вы" : me === "client" ? "Сервис" : "Клиент");

  function renderBubble(m: ChatMessage) {
    if (m.sender_role === "system") {
      return (
        <div key={m.id} id={`msg-${m.id}`} className="flex justify-center my-1">
          <span className="text-xs text-gray-500 bg-white/80 border border-gray-100 rounded-full px-3 py-1">{m.text}</span>
        </div>
      );
    }
    const mine = m.sender_role === me;
    const canEdit = mine && !m.deleted && Date.now() - new Date(m.created_at).getTime() < EDIT_MS;
    const big = !m.deleted && !m.reply_to && !!m.text && isEmojiOnly(m.text);
    return (
      <div key={m.id} id={`msg-${m.id}`} className={`flex ${mine ? "justify-end" : "justify-start"} rounded-2xl transition ${flashId === m.id ? "ring-2 ring-brand-yellow" : ""}`}>
        <div className="max-w-[82%] sm:max-w-[70%]">
          <div
            onClick={() => !m.pending && setActiveId(activeId === m.id ? null : m.id)}
            className={`flow-root cursor-pointer ${
              big
                ? "px-1 py-0.5"
                : `rounded-2xl px-3.5 py-2 text-sm shadow-sm ${
                    mine ? "bg-brand-blue text-white rounded-br-md" : "bg-white text-gray-900 border border-gray-100 rounded-bl-md"
                  }`
            }`}
          >
            {m.reply_to && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  jumpTo(m.reply_to!.id);
                }}
                className={`block w-full text-left mb-1.5 pl-2 border-l-2 text-xs ${
                  mine ? "border-brand-yellow text-white/80" : "border-brand-blue text-gray-500"
                }`}
              >
                <div className="font-medium">{who(m.reply_to.sender_role)}</div>
                <div className="truncate">{m.reply_to.text ?? "Сообщение удалено"}</div>
              </button>
            )}
            {m.deleted ? (
              <span className="italic opacity-70">Сообщение удалено</span>
            ) : (
              big ? (
                <span className="flex flex-wrap gap-1.5">
                  {splitEmoji(m.text!)
                    .filter((p) => p.emoji)
                    .map((p, i) => (
                      <Emoji key={i} char={p.v} size={72} animated />
                    ))}
                </span>
              ) : (
                <MessageText text={m.text ?? ""} />
              )
            )}
            <span className={`${big ? "flex justify-end mt-0.5" : "float-right ml-3 mt-1.5 inline-flex"} items-center gap-1 text-[11px] leading-none ${mine && !big ? "text-white/70" : "text-gray-400"}`}>
              {m.edited_at && !m.deleted && <span>изменено</span>}
              <span>{formatTime(m.created_at)}</span>
              {mine &&
                !m.deleted &&
                (m.pending ? (
                  <span>…</span>
                ) : m.failed ? (
                  <span className="text-red-300 font-bold">!</span>
                ) : (
                  <Ico name={m.read ? "check-double" : "check"} className={`w-3.5 h-3.5 ${m.read ? (big ? "text-brand-blue" : "text-brand-yellow") : ""}`} />
                ))}
            </span>
          </div>
          {m.failed && (
            <div className="mt-1 flex justify-end gap-3 text-xs">
              <span className="text-red-500">Не отправлено</span>
              <button type="button" onClick={() => retry(m)} className="font-medium text-brand-blue">
                Повторить
              </button>
              <button type="button" onClick={() => setMessages((p) => p.filter((x) => x.id !== m.id))} className="text-gray-400">
                Убрать
              </button>
            </div>
          )}
          {activeId === m.id && !m.deleted && !m.pending && !m.failed && (
            <div className={`mt-1 flex gap-1 ${mine ? "justify-end" : ""}`}>
              <button type="button" onClick={() => startReply(m)} className="inline-flex items-center gap-1.5 rounded-lg bg-white border border-gray-100 shadow-sm px-2.5 py-1.5 text-xs text-gray-700 hover:bg-gray-50">
                <Ico name="reply" className="w-3.5 h-3.5" /> Ответить
              </button>
              {canEdit && (
                <button type="button" onClick={() => startEdit(m)} className="inline-flex items-center gap-1.5 rounded-lg bg-white border border-gray-100 shadow-sm px-2.5 py-1.5 text-xs text-gray-700 hover:bg-gray-50">
                  <Ico name="edit" className="w-3.5 h-3.5" /> Изменить
                </button>
              )}
              {mine && (
                <button type="button" onClick={() => remove(m)} className="inline-flex items-center gap-1.5 rounded-lg bg-white border border-gray-100 shadow-sm px-2.5 py-1.5 text-xs text-red-600 hover:bg-red-50">
                  <Ico name="trash" className="w-3.5 h-3.5" /> Удалить
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  // список пересчитывается только при изменении сообщений, а не на каждую набранную букву
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const nodes = useMemo(() => {
  const out: React.ReactNode[] = [];
  let prevDay = "";
  for (const m of messages) {
    const dk = dayKey(m.created_at);
    if (dk !== prevDay) {
      prevDay = dk;
      out.push(
        <div key={`d-${dk}`} className="flex justify-center my-3">
          <span className="text-xs font-medium text-gray-500 bg-white/90 border border-gray-100 rounded-full px-3 py-1 shadow-sm">{dayLabel(m.created_at)}</span>
        </div>
      );
    }
    if (m.id === firstUnreadId) {
      out.push(
        <div key="new-line" data-line="new" className="flex items-center gap-3 my-2 text-xs font-medium text-brand-blue">
          <span className="flex-1 h-px bg-brand-blue/25" />
          Новые сообщения
          <span className="flex-1 h-px bg-brand-blue/25" />
        </div>
      );
    }
    out.push(renderBubble(m));
  }
  return out;
  }, [messages, firstUnreadId, activeId, flashId, me, convId, fetcher]);

  return (
    <div className="flex flex-col h-full min-h-0 w-full bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="flex items-center gap-3 px-3 sm:px-4 py-3 border-b border-gray-100 bg-white">
        {onBack && (
          <button type="button" onClick={onBack} aria-label="Назад" className="md:hidden -ml-1 p-1.5 rounded-lg text-gray-600 hover:bg-gray-100">
            <Ico name="chevron-left" className="w-5 h-5" />
          </button>
        )}
        <div className="w-10 h-10 rounded-full bg-brand-blue text-white flex items-center justify-center font-semibold flex-shrink-0">
          {(title.trim()[0] || "?").toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-gray-900 truncate">{title}</div>
          <div className="text-xs truncate h-4">
            {typing ? (
              <span className="text-brand-blue font-medium animate-pulse">печатает…</span>
            ) : (
              <span className="text-gray-500">{subtitle}</span>
            )}
          </div>
        </div>
        {action}
      </div>

      <div className="relative flex-1 min-h-0">
        <div ref={scrollRef} onScroll={onScroll} className="relative h-full overflow-y-auto px-3 sm:px-4 py-3 space-y-1.5 bg-brand-blue/5 [overflow-anchor:none]">
          {loadingMore && <div className="text-center text-xs text-gray-400 py-1">Загрузка…</div>}
          {!loaded && <div className="text-center text-sm text-gray-400 py-10">Загрузка…</div>}
          {loaded && messages.length === 0 && (
            <div className="text-center text-sm text-gray-500 py-10">{emptyText ?? "Сообщений пока нет"}</div>
          )}
          {nodes}
        </div>
        {showDown && (
          <button
            type="button"
            onClick={scrollDown}
            aria-label="Вниз"
            className="absolute bottom-3 right-4 w-10 h-10 rounded-full bg-white shadow-lg border border-gray-100 flex items-center justify-center text-brand-blue-dark"
          >
            <Ico name="arrow-down" className="w-5 h-5" />
            {newBelow > 0 && (
              <span className="absolute -top-2 -right-1 min-w-5 h-5 px-1 rounded-full bg-brand-yellow text-brand-blue-dark text-[11px] font-bold flex items-center justify-center">
                {newBelow}
              </span>
            )}
          </button>
        )}
      </div>

      {(replyTo || editing) && (
        <div className="flex items-center gap-3 px-4 py-2 border-t border-gray-100 bg-gray-50">
          <Ico name={editing ? "edit" : "reply"} className="w-4 h-4 text-brand-blue" />
          <div className="min-w-0 flex-1 text-xs">
            <div className="font-medium text-brand-blue">{editing ? "Редактирование" : `Ответ: ${who(replyTo!.sender_role)}`}</div>
            <div className="truncate text-gray-500">{(editing ?? replyTo)!.text}</div>
          </div>
          <button type="button" onClick={() => (editing ? cancelEdit() : setReplyTo(null))} aria-label="Отмена" className="p-1 text-gray-400 hover:text-gray-700">
            <Ico name="close" className="w-4 h-4" />
          </button>
        </div>
      )}
      {error && <div className="px-4 py-1.5 text-xs text-red-600 bg-red-50 border-t border-red-100">{error}</div>}

      <div className="relative flex items-end gap-2 p-3 border-t border-gray-100 bg-white">
        {emojiOpen && (
          <div className="absolute bottom-full left-3 mb-2 z-20">
            <EmojiPicker onPick={insertEmoji} onClose={() => setEmojiOpen(false)} />
          </div>
        )}
        <button
          type="button"
          data-emoji-toggle
          onClick={() => setEmojiOpen((v) => !v)}
          aria-label="Эмодзи"
          className={`w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0 transition ${
            emojiOpen ? "bg-brand-blue/10 text-brand-blue" : "text-gray-500 hover:bg-gray-100"
          }`}
        >
          <Ico name="smile" className="w-6 h-6" />
        </button>
        <textarea
          ref={taRef}
          rows={1}
          value={text}
          maxLength={4000}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Сообщение"
          className="flex-1 resize-none rounded-2xl bg-gray-100 px-4 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 outline-none focus:ring-2 focus:ring-brand-blue/30"
        />
        <button
          type="button"
          onClick={submit}
          disabled={!text.trim()}
          aria-label="Отправить"
          className="w-11 h-11 rounded-full bg-brand-yellow text-brand-blue-dark flex items-center justify-center flex-shrink-0 transition hover:brightness-95 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Ico name="send" className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}
