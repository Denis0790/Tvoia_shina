"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Attachment,
  ChatMessage,
  Fetcher,
  JSON_HEADERS,
  Role,
  dayKey,
  dayLabel,
  formatTime,
  fmtDuration,
  formatSize,
  getMessages,
  mediaSrc,
  newId,
  shortDay,
  upsertMessage,
} from "@/lib/chat";
import type { ChatEvent, ChatSocket } from "@/lib/chatSocket";
import EmojiPicker from "./EmojiPicker";
import Link from "next/link";
import Ico from "./Ico";
import Emoji from "./Emoji";
import MediaViewer, { ViewerItem } from "./MediaViewer";
import { isEmojiOnly, splitEmoji } from "@/lib/emojiData";

const EDIT_MS = 24 * 60 * 60 * 1000;
const QUICK_REACTIONS = ["👍", "👎", "❤️", "🔥", "😂", "😮", "😢", "🙏"];

function BookingCard({ text }: { text: string }) {
  const [title, ...rest] = text.split("\n");
  return (
    <div className="min-w-[13rem]">
      <div className="flex items-center gap-2 font-semibold text-gray-900">
        <span className="w-1.5 h-4 rounded-full bg-brand-yellow flex-shrink-0" />
        {title}
      </div>
      <div className="mt-1.5 space-y-0.5 text-[13px] text-gray-900">
        {rest.map((l, i) => {
          const k = l.indexOf(": ");
          return k > 0 ? (
            <div key={i}>
              <span className="text-gray-500">{l.slice(0, k)}: </span>
              <span className="break-words">{l.slice(k + 2)}</span>
            </div>
          ) : (
            <div key={i}>{l}</div>
          );
        })}
      </div>
    </div>
  );
}

const FILE_ACCEPT = ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.ods,.odp,.txt,.csv,.rtf,.zip,.rar,.7z";

type Draft = {
  key: string;
  name: string;
  kind: "image" | "video" | "file";
  preview?: string;
  state: "uploading" | "ready" | "error";
  att?: Attachment;
  error?: string;
};

function Attachments({ items, mine, onOpen, bare }: { items: Attachment[]; mine: boolean; onOpen: (a: Attachment) => void; bare?: boolean }) {
  const visual = items.filter((a) => a.kind !== "file");
  const files = items.filter((a) => a.kind === "file");
  const single = visual.length === 1;
  return (
    <div className={`space-y-1.5 ${bare ? "" : "mb-1.5"}`}>
      {visual.length > 0 && (
        <div className={`grid gap-0.5 rounded-xl overflow-hidden ${single ? "grid-cols-1 w-[min(260px,68vw)]" : "grid-cols-2 w-[min(280px,70vw)]"}`}>
          {visual.map((a, idx) => {
            const wide = !single && visual.length % 2 === 1 && idx === visual.length - 1;
            const ratio = wide ? 2 : single && a.width && a.height ? Math.min(Math.max(a.width / a.height, 0.75), 1.6) : 1;
            const span = wide ? "col-span-2" : "";
            if (a.status === "ready" && a.thumb_url) {
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpen(a);
                  }}
                  className={`relative block bg-gray-200 ${span}`}
                  style={{ aspectRatio: String(ratio) }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={mediaSrc(a.thumb_url)} alt="" loading="lazy" draggable={false} className="absolute inset-0 w-full h-full object-cover" />
                  {a.kind === "video" && (
                    <>
                      <span className="absolute inset-0 flex items-center justify-center">
                        <span className="w-11 h-11 rounded-full bg-black/55 text-white flex items-center justify-center">
                          <Ico name="play" className="w-5 h-5" />
                        </span>
                      </span>
                      <span className="absolute left-1.5 bottom-1.5 rounded bg-black/60 text-white text-[11px] px-1.5 py-0.5">{fmtDuration(a.duration_ms)}</span>
                    </>
                  )}
                </button>
              );
            }
            const failed = a.status === "failed";
            return (
              <div
                key={a.id}
                className={`flex flex-col items-center justify-center gap-1.5 text-center px-2 text-xs ${span} ${failed ? "bg-red-50 text-red-500" : "bg-gray-200 text-gray-500"}`}
                style={{ aspectRatio: String(wide ? 2 : 1) }}
              >
                {!failed && <span className="w-6 h-6 rounded-full border-2 border-gray-300 border-t-brand-blue animate-spin" />}
                {failed ? "Не удалось обработать видео" : "Обработка видео…"}
              </div>
            );
          })}
        </div>
      )}
      {files.map((a) => (
        <a
          key={a.id}
          href={mediaSrc(a.url)}
          target="_blank"
          rel="noreferrer"
          download={a.name ?? true}
          onClick={(e) => e.stopPropagation()}
          className={`flex items-center gap-2.5 rounded-xl px-2.5 py-2 min-w-[12rem] ${mine ? "bg-white/15" : "bg-gray-100"}`}
        >
          <span className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${mine ? "bg-white/20 text-white" : "bg-brand-blue/10 text-brand-blue"}`}>
            <Ico name="file" className="w-5 h-5" />
          </span>
          <span className="min-w-0">
            <span className="block truncate max-w-[14rem] text-[13px] font-medium">{a.name}</span>
            <span className="block text-[11px] opacity-70">{formatSize(a.size)}</span>
          </span>
        </a>
      ))}
    </div>
  );
}

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
  titleHref?: string;
  action?: React.ReactNode;
  emptyText?: string;
  blockedText?: string | null;
};

export default function ChatThread({ convId, me, fetcher, socket, title, subtitle, onBack, titleHref, action, emptyText, blockedText }: Props) {
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
  const [upcoming, setUpcoming] = useState<{ id: string; date: string; start_time: string; status: string }[]>([]);
  const [meId, setMeId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [attachOpen, setAttachOpen] = useState(false);
  const [viewer, setViewer] = useState<{ items: ViewerItem[]; start: number } | null>(null);
  const mediaInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
    setDrafts([]);
    setAttachOpen(false);
    setViewer(null);
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

  // ближайшие записи клиента — напоминание над перепиской
  const loadUpcoming = useCallback(() => {
    fetcher(`/chat/conversations/${convId}/bookings`)
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setUpcoming(d))
      .catch(() => {});
  }, [convId, fetcher]);

  useEffect(() => {
    setUpcoming([]);
    loadUpcoming();
  }, [loadUpcoming]);

  useEffect(() => {
    fetcher("/users/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setMeId(d.id))
      .catch(() => {});
  }, [fetcher]);

  // нажали на сообщение — прокручиваем так, чтобы панель действий была видна
  useEffect(() => {
    if (!activeId) return;
    const t = setTimeout(() => {
      document.getElementById(`msg-${activeId}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }, 50);
    return () => clearTimeout(t);
  }, [activeId]);

  // события в реальном времени
  useEffect(() => {
    return socket.subscribe((e: ChatEvent) => {
      if (e.type === "_open") {
        if (loadedRef.current) {
          resync();
          loadUpcoming();
        }
        return;
      }
      if (e.conversation_id !== convId) return;
      if (e.type === "message") {
        const m = e.message as ChatMessage;
        setMessages((p) => upsertMessage(p, m));
        if (m.kind === "booking") loadUpcoming();
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
      } else if (e.type === "message_updated" || e.type === "message_deleted" || e.type === "reaction") {
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
  }, [socket, convId, me, resync, markRead, loadUpcoming]);

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

  // меню скрепки закрывается по клику снаружи
  useEffect(() => {
    if (!attachOpen) return;
    const f = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest("[data-attach]")) setAttachOpen(false);
    };
    document.addEventListener("mousedown", f);
    return () => document.removeEventListener("mousedown", f);
  }, [attachOpen]);

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
        body: JSON.stringify({
          text: tmp.text,
          reply_to_id: tmp.reply_to?.id ?? null,
          client_msg_id: tmp.client_msg_id,
          attachment_ids: (tmp.attachments ?? []).map((a) => a.id),
        }),
      });
      if (!res.ok) throw new Error();
      const m = (await res.json()) as ChatMessage;
      setMessages((p) => upsertMessage(p, m));
    } catch {
      setMessages((p) => p.map((x) => (x.id === tmp.id ? { ...x, pending: false, failed: true } : x)));
    }
  }

  async function uploadOne(file: File, key: string) {
    try {
      const r = await fetcher(`/chat/conversations/${convId}/attachments?name=${encodeURIComponent(file.name || "file")}`, {
        method: "POST",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) throw new Error(typeof d?.detail === "string" ? d.detail : "Не удалось загрузить файл");
      setDrafts((p) => p.map((x) => (x.key === key ? { ...x, state: "ready", att: d as Attachment } : x)));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Не удалось загрузить файл";
      setError(msg);
      setDrafts((p) => p.map((x) => (x.key === key ? { ...x, state: "error", error: msg } : x)));
    }
  }

  function addFiles(list: FileList | File[]) {
    const all = Array.from(list);
    if (!all.length) return;
    setError(null);
    setAttachOpen(false);
    const take = all.slice(0, Math.max(10 - drafts.length, 0));
    if (all.length > take.length) setError("В одном сообщении не больше 10 файлов");
    for (const f of take) {
      const kind: Draft["kind"] = f.type.startsWith("image/") ? "image" : f.type.startsWith("video/") ? "video" : "file";
      const limit = kind === "video" ? 100 : 25;
      const key = newId();
      if (f.size > limit * 1024 * 1024) {
        setError(`Файл «${f.name}» больше ${limit} МБ`);
        setDrafts((p) => [...p, { key, name: f.name, kind, state: "error", error: "Слишком большой файл" }]);
        continue;
      }
      setDrafts((p) => [
        ...p,
        { key, name: f.name || "файл", kind, preview: kind !== "file" ? URL.createObjectURL(f) : undefined, state: "uploading" },
      ]);
      uploadOne(f, key);
    }
  }

  function removeDraft(key: string) {
    setDrafts((p) => {
      const d = p.find((x) => x.key === key);
      if (d?.preview) URL.revokeObjectURL(d.preview);
      return p.filter((x) => x.key !== key);
    });
  }

  function onPaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const fs = Array.from(e.clipboardData.files);
    if (fs.length && !e.clipboardData.getData("text")) {
      e.preventDefault();
      addFiles(fs);
    }
  }

  function openViewer(_m: ChatMessage, a: Attachment) {
    // галерея всего диалога: листаем фото и видео из всех сообщений
    const vis = messagesRef.current
      .filter((x) => !x.deleted)
      .flatMap((x) => x.attachments ?? [])
      .filter((x) => x.kind !== "file" && x.status === "ready" && x.url);
    const idx = vis.findIndex((x) => x.id === a.id);
    if (idx < 0) return;
    setViewer({
      items: vis.map((x) => ({ kind: x.kind as "image" | "video", url: mediaSrc(x.url), poster: mediaSrc(x.thumb_url) })),
      start: idx,
    });
  }

  async function submit() {
    const body = text.trim();
    if (drafts.some((d) => d.state === "uploading")) return;
    const ready = editing ? [] : drafts.filter((d) => d.state === "ready" && d.att).map((d) => d.att!);
    if (!body && ready.length === 0) return;
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
      attachments: ready,
    };
    pendingScroll.current = "smooth";
    setMessages((p) => [...p, tmp]);
    setText("");
    setReplyTo(null);
    drafts.forEach((d) => d.preview && URL.revokeObjectURL(d.preview));
    setDrafts([]);
    deliver(tmp);
  }

  function retry(m: ChatMessage) {
    setMessages((p) => p.map((x) => (x.id === m.id ? { ...x, pending: true, failed: false } : x)));
    deliver({ ...m, pending: true, failed: false });
  }

  async function react(m: ChatMessage, emoji: string) {
    setActiveId(null);
    const r = await fetcher(`/chat/messages/${m.id}/reaction`, {
      method: "PUT",
      headers: JSON_HEADERS,
      body: JSON.stringify({ emoji }),
    });
    if (r.ok) {
      const d = (await r.json()) as ChatMessage;
      setMessages((p) => p.map((x) => (x.id === d.id ? { ...x, reactions: d.reactions } : x)));
    }
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
    const canEdit = mine && !m.deleted && m.kind === "text" && !m.attachments?.length && Date.now() - new Date(m.created_at).getTime() < EDIT_MS;
    const card = m.kind === "booking" && !m.deleted;
    const big = !m.deleted && !m.reply_to && !!m.text && !m.attachments?.length && isEmojiOnly(m.text);
    const mediaOnly = !m.deleted && !m.text && !m.reply_to && !card && !!m.attachments?.length && m.attachments.every((a) => a.kind !== "file");
    const fileOnly = !m.deleted && !m.text && !m.reply_to && !card && !!m.attachments?.length && m.attachments.every((a) => a.kind === "file");
    const isLast = messages[messages.length - 1]?.id === m.id;
    const showActions = activeId === m.id && !m.deleted && !m.pending && !m.failed;
    const actions = showActions ? (
      <div className={`flex flex-col gap-1 ${isLast ? "mb-1" : "mt-1"} ${mine ? "items-end" : "items-start"}`}>
        <div className="inline-flex gap-0.5 rounded-full bg-white border border-gray-100 shadow-md p-1">
          {QUICK_REACTIONS.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => react(m, e)}
              className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-gray-100 active:scale-90 transition"
            >
              <Emoji char={e} size={24} />
            </button>
          ))}
        </div>
        <div className="flex gap-1">
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
      </div>
    ) : null;

    const grouped = new Map<string, { count: number; mine: boolean }>();
    for (const r of m.reactions ?? []) {
      const g = grouped.get(r.emoji) ?? { count: 0, mine: false };
      g.count += 1;
      if (r.uid === meId) g.mine = true;
      grouped.set(r.emoji, g);
    }
    const reactionChips =
      grouped.size > 0 ? (
        <div className={`mt-1 flex flex-wrap gap-1 ${mine ? "justify-end" : ""}`}>
          {Array.from(grouped.entries()).map(([emoji, g]) => (
            <button
              key={emoji}
              type="button"
              onClick={() => react(m, emoji)}
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition ${
                g.mine ? "border-brand-blue bg-brand-blue/10 text-brand-blue-dark" : "border-gray-200 bg-white text-gray-600"
              }`}
            >
              <Emoji char={emoji} size={16} />
              {g.count > 1 && <span>{g.count}</span>}
            </button>
          ))}
        </div>
      ) : null;
    return (
      <div key={m.id} id={`msg-${m.id}`} className={`flex ${mine ? "justify-end" : "justify-start"} rounded-2xl transition ${flashId === m.id ? "ring-2 ring-brand-yellow" : ""}`}>
        <div className="max-w-[82%] sm:max-w-[70%]">
          {isLast && actions}
          <div
            onClick={() => !m.pending && setActiveId(activeId === m.id ? null : m.id)}
            className={`flow-root cursor-pointer ${
              big
                ? "px-1 py-0.5"
                : mediaOnly
                ? "relative rounded-2xl overflow-hidden shadow-sm"
                : fileOnly
                ? "rounded-2xl px-2 py-2 text-sm shadow-sm bg-white text-gray-900 border border-gray-100"
                : `rounded-2xl px-3.5 py-2 text-sm shadow-sm ${
                    card
                      ? "bg-white text-gray-900 border border-brand-yellow/70"
                      : mine
                      ? "bg-brand-blue text-white rounded-br-md"
                      : "bg-white text-gray-900 border border-gray-100 rounded-bl-md"
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
                <div className="truncate">{m.reply_to.text === null ? "Сообщение удалено" : m.reply_to.text || "📎 Вложение"}</div>
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
                card ? (
                  <BookingCard text={m.text ?? ""} />
                ) : (
                  <>
                    {!!m.attachments?.length && <Attachments items={m.attachments} mine={mine && !fileOnly} bare={mediaOnly} onOpen={(a) => openViewer(m, a)} />}
                    {!!m.text && <MessageText text={m.text} />}
                  </>
                )
              )
            )}
            <span className={`${big ? "flex justify-end mt-0.5" : mediaOnly ? "absolute bottom-1.5 right-1.5 inline-flex rounded-full bg-black/50 px-2 py-1" : "float-right ml-3 mt-1.5 inline-flex"} items-center gap-1 text-[11px] leading-none ${mediaOnly ? "text-white" : mine && !big && !card && !fileOnly ? "text-white/70" : "text-gray-400"}`}>
              {m.edited_at && !m.deleted && <span>изменено</span>}
              <span>{formatTime(m.created_at)}</span>
              {mine &&
                !m.deleted &&
                (m.pending ? (
                  <span>…</span>
                ) : m.failed ? (
                  <span className="text-red-300 font-bold">!</span>
                ) : (
                  <Ico name={m.read ? "check-double" : "check"} className={`w-3.5 h-3.5 ${m.read ? (big || card || fileOnly ? "text-brand-blue" : "text-brand-yellow") : ""}`} />
                ))}
            </span>
          </div>
          {reactionChips}
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
          {!isLast && actions}
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
  }, [messages, firstUnreadId, activeId, flashId, me, convId, fetcher, meId]);

  return (
    <div
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        if (e.dataTransfer.files.length) {
          e.preventDefault();
          addFiles(e.dataTransfer.files);
        }
      }}
      className="flex flex-col h-full min-h-0 w-full bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden"
    >
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
          {titleHref ? (
            <Link href={titleHref} className="block font-semibold text-gray-900 truncate hover:text-brand-blue hover:underline">
              {title}
            </Link>
          ) : (
            <div className="font-semibold text-gray-900 truncate">{title}</div>
          )}
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

      {upcoming.length > 0 && (
        <div className="flex items-center gap-2 px-3 sm:px-4 py-2 border-b border-gray-100 bg-brand-yellow/10 overflow-x-auto">
          <Ico name="calendar" className="w-4 h-4 text-brand-blue flex-shrink-0" />
          {upcoming.slice(0, 3).map((b) => (
            <span
              key={b.id}
              className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-white border border-gray-100 shadow-sm px-2.5 py-1 text-xs text-gray-800"
            >
              <span className={`w-1.5 h-1.5 rounded-full ${b.status === "confirmed" ? "bg-emerald-500" : "bg-amber-400"}`} />
              {shortDay(b.date)}, {b.start_time}
              <span className="text-gray-400">· {b.status === "confirmed" ? "подтверждена" : "ждёт подтверждения"}</span>
            </span>
          ))}
          {upcoming.length > 3 && <span className="text-xs text-gray-500 whitespace-nowrap">и ещё {upcoming.length - 3}</span>}
        </div>
      )}

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
      {drafts.length > 0 && (
        <div className="flex gap-2 px-3 pt-3 border-t border-gray-100 bg-white overflow-x-auto">
          {drafts.map((d) => (
            <div key={d.key} className="relative flex-shrink-0 pt-1.5 pr-1.5">
              <div
                className={`relative w-16 h-16 rounded-xl overflow-hidden border flex items-center justify-center ${
                  d.state === "error" ? "border-red-300 bg-red-50" : "border-gray-200 bg-gray-100"
                }`}
              >
                {d.preview && d.kind === "image" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={d.preview} alt="" className="w-full h-full object-cover" />
                ) : d.preview && d.kind === "video" ? (
                  <video src={d.preview + "#t=0.1"} muted playsInline preload="metadata" className="w-full h-full object-cover" />
                ) : (
                  <div className="px-1 text-center">
                    <Ico name="file" className="w-5 h-5 mx-auto text-gray-500" />
                    <div className="text-[9px] leading-tight text-gray-500 truncate max-w-[56px]">{d.name}</div>
                  </div>
                )}
                {d.state === "uploading" && (
                  <span className="absolute inset-0 bg-white/60 flex items-center justify-center">
                    <span className="w-5 h-5 rounded-full border-2 border-gray-300 border-t-brand-blue animate-spin" />
                  </span>
                )}
                {d.state === "error" && <span className="absolute inset-0 flex items-center justify-center text-red-500 font-bold">!</span>}
              </div>
              <button
                type="button"
                onClick={() => removeDraft(d.key)}
                aria-label="Убрать"
                className="absolute top-0 right-0 w-5 h-5 rounded-full bg-gray-700 text-white flex items-center justify-center"
              >
                <Ico name="close" className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}
      {error && <div className="px-4 py-1.5 text-xs text-red-600 bg-red-50 border-t border-red-100">{error}</div>}

      {blockedText ? (
        <div className="px-4 py-3.5 border-t border-gray-100 bg-gray-50 text-center text-sm text-gray-500">{blockedText}</div>
      ) : (
      <div className="relative flex items-end gap-2 p-3 border-t border-gray-100 bg-white">
        {emojiOpen && (
          <div className="absolute bottom-full left-3 mb-2 z-20">
            <EmojiPicker onPick={insertEmoji} onClose={() => setEmojiOpen(false)} />
          </div>
        )}
        <div data-attach className="relative flex-shrink-0">
          <button
            type="button"
            onClick={() => setAttachOpen((v) => !v)}
            aria-label="Прикрепить"
            className={`w-11 h-11 rounded-full flex items-center justify-center transition ${
              attachOpen ? "bg-brand-blue/10 text-brand-blue" : "text-gray-500 hover:bg-gray-100"
            }`}
          >
            <Ico name="paperclip" className="w-6 h-6" />
          </button>
          {attachOpen && (
            <div className="absolute bottom-full left-0 mb-2 z-20 w-56 rounded-2xl bg-white border border-gray-100 shadow-lg p-1.5">
              <button type="button" onClick={() => mediaInputRef.current?.click()} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-gray-800 hover:bg-gray-50">
                <Ico name="image" className="w-5 h-5 text-brand-blue" /> Фото или видео
              </button>
              <button type="button" onClick={() => fileInputRef.current?.click()} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-gray-800 hover:bg-gray-50">
                <Ico name="file" className="w-5 h-5 text-brand-blue" /> Файл
              </button>
            </div>
          )}
        </div>
        <input
          ref={mediaInputRef}
          type="file"
          accept="image/*,video/*"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <input
          ref={fileInputRef}
          type="file"
          accept={FILE_ACCEPT}
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
            e.target.value = "";
          }}
        />
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
          onPaste={onPaste}
          placeholder="Сообщение"
          className="flex-1 resize-none rounded-2xl bg-gray-100 px-4 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 outline-none focus:ring-2 focus:ring-brand-blue/30"
        />
        <button
          type="button"
          onClick={submit}
          disabled={(!text.trim() && !drafts.some((d) => d.state === "ready")) || drafts.some((d) => d.state === "uploading")}
          aria-label="Отправить"
          className="w-11 h-11 rounded-full bg-brand-yellow text-brand-blue-dark flex items-center justify-center flex-shrink-0 transition hover:brightness-95 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Ico name="send" className="w-5 h-5" />
        </button>
      </div>
      )}
      {viewer && <MediaViewer items={viewer.items} start={viewer.start} onClose={() => setViewer(null)} />}
    </div>
  );
}
