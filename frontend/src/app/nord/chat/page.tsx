"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { managerApiFetch } from "@/lib/managerAuth";
import { managerSocket } from "@/lib/chatSocket";
import { ConversationItem, listTime } from "@/lib/chat";
import ChatThread from "@/components/chat/ChatThread";
import Ico from "@/components/chat/Ico";

function ChatInner() {
  const params = useSearchParams();
  const clientParam = params.get("client");
  const [items, setItems] = useState<ConversationItem[]>([]);
  const [q, setQ] = useState("");
  const [active, setActive] = useState<ConversationItem | null>(null);
  const [loading, setLoading] = useState(true);
  const qRef = useRef("");
  qRef.current = q;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadList = useCallback(async () => {
    try {
      const r = await managerApiFetch(`/chat/conversations?limit=100&q=${encodeURIComponent(qRef.current)}`);
      if (r.ok) setItems(await r.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(loadList, 250);
    return () => clearTimeout(t);
  }, [q, loadList]);

  useEffect(() => {
    return managerSocket.subscribe((e) => {
      if (e.type === "message" || e.type === "read" || e.type === "_open") {
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(loadList, 300);
      }
    });
  }, [loadList]);

  useEffect(() => {
    if (!clientParam) return;
    managerApiFetch(`/chat/conversations/with/${clientParam}`, { method: "POST" })
      .then((r) => (r.ok ? r.json() : null))
      .then((c: ConversationItem | null) => {
        if (c) setActive(c);
      });
  }, [clientParam]);

  return (
    <div className="rounded-3xl bg-gradient-to-b from-brand-blue/10 via-brand-blue/5 to-white p-4 sm:p-6 flex flex-col gap-4 h-[calc(100dvh-3rem)] md:h-[calc(100dvh-7rem)]">
      <div>
        <h1 className="text-lg font-bold text-gray-900">Чат</h1>
        <p className="text-xs text-gray-500 mt-0.5">Переписка с клиентами</p>
      </div>
      <div className="flex-1 min-h-0 grid md:grid-cols-[320px_1fr] gap-4">
        <div className={`${active ? "hidden md:flex" : "flex"} flex-col min-h-0 bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden`}>
          <div className="p-3 border-b border-gray-100">
            <div className="flex items-center gap-2 rounded-xl bg-gray-100 px-3">
              <Ico name="search" className="w-4 h-4 text-gray-400" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Имя, телефон или логин"
                className="flex-1 bg-transparent py-2.5 text-sm outline-none placeholder:text-gray-400"
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {loading && <p className="text-sm text-gray-400 text-center py-8">Загрузка…</p>}
            {!loading && items.length === 0 && (
              <p className="text-sm text-gray-500 text-center px-4 py-8">{q ? "Ничего не найдено" : "Пока нет переписок"}</p>
            )}
            {items.map((c) => {
              const unread = active?.id === c.id ? 0 : c.unread;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setActive(c)}
                  className={`w-full flex items-center gap-3 px-3 py-3 text-left border-b border-gray-50 transition ${
                    active?.id === c.id ? "bg-brand-blue/10" : "hover:bg-gray-50"
                  }`}
                >
                  <div className="w-11 h-11 rounded-full bg-brand-blue text-white flex items-center justify-center font-semibold flex-shrink-0">
                    {(c.client.name.trim()[0] || "?").toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className={`truncate text-sm ${unread ? "font-bold text-gray-900" : "font-medium text-gray-900"}`}>{c.client.name}</span>
                      <span className="text-[11px] text-gray-400 flex-shrink-0">{listTime(c.last_message_at)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2 mt-0.5">
                      <span className={`truncate text-xs ${unread ? "text-gray-700" : "text-gray-500"}`}>{c.last_message ?? "Нет сообщений"}</span>
                      {unread > 0 && (
                        <span className="min-w-5 h-5 px-1.5 rounded-full bg-brand-yellow text-brand-blue-dark text-[11px] font-bold flex items-center justify-center flex-shrink-0">
                          {unread}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className={`${active ? "flex" : "hidden md:flex"} min-h-0`}>
          {active ? (
            <ChatThread
              key={active.id}
              convId={active.id}
              me="manager"
              fetcher={managerApiFetch}
              socket={managerSocket}
              title={active.client.name}
              subtitle={active.client.phone || active.client.login || (active.client.is_org ? "Организация" : "")}
              onBack={() => setActive(null)}
              emptyText="Напишите клиенту первым"
              action={
                active.client.phone ? (
                  <a
                    href={`tel:${active.client.phone.replace(/[^\d+]/g, "")}`}
                    className="text-xs font-medium text-brand-blue border border-brand-blue/30 rounded-xl px-3 py-2 hover:bg-brand-blue/5 whitespace-nowrap"
                  >
                    Позвонить
                  </a>
                ) : null
              }
            />
          ) : (
            <div className="flex-1 flex items-center justify-center bg-white rounded-2xl border border-gray-100 shadow-sm text-sm text-gray-400">
              Выберите диалог слева
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function NordChatPage() {
  return (
    <Suspense fallback={null}>
      <ChatInner />
    </Suspense>
  );
}
