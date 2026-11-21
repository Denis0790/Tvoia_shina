"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/auth";
import { clientSocket } from "@/lib/chatSocket";
import { getPublicProfile } from "@/lib/api";
import ChatThread from "@/components/chat/ChatThread";

export default function MessagesPage() {
  const [convId, setConvId] = useState<string | null>(null);
  const [phone, setPhone] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    apiFetch("/chat/conversations/mine")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        setConvId(d.id);
        setBlocked(!!d.blocked);
      })
      .catch(() => setFailed(true));
    getPublicProfile()
      .then((d) => setPhone(d.profile.phone))
      .catch(() => setPhone(null));
  }, []);

  // менеджер заблокировал / разблокировал — плашка меняется сразу
  useEffect(() => {
    if (!convId) return;
    return clientSocket.subscribe((e) => {
      if (e.type === "conversation" && e.conversation_id === convId && "blocked" in e) setBlocked(!!e.blocked);
    });
  }, [convId]);

  return (
    <div className="-m-6 md:-m-10 p-0 md:p-10 md:rounded-[12px] bg-[#e8eaf0] h-[calc(100dvh-4rem)] md:h-[calc(100dvh-2rem)] flex flex-col md:gap-4">
      <div className="hidden md:block">
        <h1 className="text-lg font-bold text-gray-900">Сообщения</h1>
        <p className="text-xs text-gray-500 mt-0.5">Напишите нам — ответим в рабочее время</p>
      </div>
      <div className="flex-1 min-h-0">
        {failed && <p className="text-sm text-gray-500">Не удалось открыть чат. Обновите страницу.</p>}
        {convId && (
          <ChatThread
            convId={convId}
            me="client"
            fetcher={apiFetch}
            socket={clientSocket}
            title="Твоя Шина"
            subtitle="Автосервис"
            emptyText="Напишите нам — расскажем про работы, цены и свободное время"
            blockedText={blocked ? "Отправка сообщений недоступна. Пожалуйста, позвоните нам." : null}
            action={
              phone ? (
                <a
                  href={`tel:${phone.replace(/[^\d+]/g, "")}`}
                  className="text-xs font-medium text-brand-blue border border-brand-blue/30 rounded-xl px-3 py-2 hover:bg-brand-blue/5 whitespace-nowrap"
                >
                  Позвонить
                </a>
              ) : null
            }
          />
        )}
      </div>
    </div>
  );
}
