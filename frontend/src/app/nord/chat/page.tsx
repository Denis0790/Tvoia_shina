"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { managerApiFetch } from "@/lib/managerAuth";
import { managerSocket } from "@/lib/chatSocket";
import { ConversationItem, JSON_HEADERS, listTime } from "@/lib/chat";
import ChatThread from "@/components/chat/ChatThread";
import Ico from "@/components/chat/Ico";

const menuCls = "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-left";

function MenuItem({
  icon,
  label,
  onClick,
  href,
  danger,
}: {
  icon: string;
  label: string;
  onClick?: () => void;
  href?: string;
  danger?: boolean;
}) {
  const cls = `${menuCls} ${danger ? "text-red-600 hover:bg-red-50" : "text-gray-800 hover:bg-gray-50"}`;
  const inner = (
    <>
      <Ico name={icon} className={`w-5 h-5 ${danger ? "" : "text-brand-blue"}`} />
      {label}
    </>
  );
  if (href?.startsWith("tel:")) {
    return (
      <a href={href} onClick={onClick} className={cls}>
        {inner}
      </a>
    );
  }
  if (href) {
    return (
      <Link href={href} onClick={onClick} className={cls}>
        {inner}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} className={cls}>
      {inner}
    </button>
  );
}

function ChatInner() {
  const params = useSearchParams();
  const clientParam = params.get("client") ?? params.get("user");
  const [items, setItems] = useState<ConversationItem[]>([]);
  const [q, setQ] = useState("");
  const [active, setActive] = useState<ConversationItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [openError, setOpenError] = useState<string | null>(null);
  const qRef = useRef("");
  qRef.current = q;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; item: ConversationItem } | null>(null);
  const menuAt = useRef(0);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressed = useRef(false);

  const loadList = useCallback(async () => {
    try {
      const r = await managerApiFetch(`/chat/conversations?limit=100&q=${encodeURIComponent(qRef.current)}`);
      if (r.ok) {
        const list = (await r.json()) as ConversationItem[];
        setItems(list);
        setActive((a) => (a ? list.find((i) => i.id === a.id) ?? a : a));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  function openMenu(x: number, y: number, item: ConversationItem) {
    menuAt.current = Date.now();
    setMenu({ x, y, item });
  }

  async function runAction(path: string, method: string, body: unknown) {
    setMenu(null);
    await managerApiFetch(path, { method, headers: JSON_HEADERS, body: JSON.stringify(body) }).catch(() => {});
    loadList();
  }

  function toggleUnread(c: ConversationItem) {
    const unread = !(c.unread > 0);
    if (unread && active?.id === c.id) setActive(null); // открытый диалог сразу «прочитывается» — закрываем, чтобы пометка осталась
    runAction(`/chat/conversations/${c.id}/mark`, "POST", { unread });
  }

  function toggleBlock(c: ConversationItem) {
    if (!c.blocked && !window.confirm("Заблокировать клиента? Он не сможет писать в чат и записываться онлайн.")) {
      setMenu(null);
      return;
    }
    runAction(`/chat/conversations/${c.id}/block`, "PUT", { blocked: !c.blocked });
  }

  // открыли диалог с пометкой «непрочитано» — сбрасываем пометку
  useEffect(() => {
    if (!active || active.unread <= 0) return;
    managerApiFetch(`/chat/conversations/${active.id}/read`, { method: "POST" })
      .then(() => loadList())
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id]);

  useEffect(() => {
    if (!menu) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && setMenu(null);
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [menu]);

  useEffect(() => {
    const t = setTimeout(loadList, 250);
    return () => clearTimeout(t);
  }, [q, loadList]);

  useEffect(() => {
    return managerSocket.subscribe((e) => {
      if (e.type === "message" || e.type === "read" || e.type === "conversation" || e.type === "_open") {
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(loadList, 300);
      }
    });
  }, [loadList]);

  useEffect(() => {
    if (!clientParam) return;
    setOpenError(null);
    managerApiFetch(`/chat/conversations/with/${clientParam}`, { method: "POST" })
      .then(async (r) => {
        if (!r.ok) {
          setOpenError(`Не удалось открыть диалог (код ${r.status}, клиент ${clientParam})`);
          return;
        }
        setActive((await r.json()) as ConversationItem);
      })
      .catch(() => setOpenError("Не удалось открыть диалог: нет связи с сервером"));
  }, [clientParam]);

  return (
    <div className="-m-6 md:-m-10 p-0 md:p-10 md:rounded-[12px] bg-[#e8eaf0] h-[calc(100dvh_-_4rem_-_env(safe-area-inset-bottom))] md:h-[calc(100dvh-2rem)] flex flex-col md:gap-4">
      <div className="hidden md:block">
        <h1 className="text-lg font-bold text-gray-900">Чат</h1>
        <p className="text-xs text-gray-500 mt-0.5">Переписка с клиентами</p>
      </div>
      <div className="flex-1 min-h-0 grid grid-cols-[minmax(0,1fr)] md:grid-cols-[320px_minmax(0,1fr)] md:gap-4">
        <div className={`${active ? "hidden md:flex" : "flex"} flex-col min-h-0 bg-white md:rounded-2xl md:border md:border-gray-100 md:shadow-sm overflow-hidden`}>
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
                  onClick={() => {
                    if (longPressed.current) {
                      longPressed.current = false;
                      return;
                    }
                    setActive(c);
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    openMenu(e.clientX, e.clientY, c);
                  }}
                  onTouchStart={(e) => {
                    const t = e.touches[0];
                    pressTimer.current = setTimeout(() => {
                      longPressed.current = true;
                      openMenu(t.clientX, t.clientY, c);
                    }, 500);
                  }}
                  onTouchEnd={() => pressTimer.current && clearTimeout(pressTimer.current)}
                  onTouchMove={() => pressTimer.current && clearTimeout(pressTimer.current)}
                  className={`w-full select-none [-webkit-touch-callout:none] flex items-center gap-3 px-3 py-3 text-left border-b border-gray-50 transition ${
                    active?.id === c.id ? "bg-brand-blue/10" : "hover:bg-gray-50"
                  }`}
                >
                  <div className="w-11 h-11 rounded-full bg-brand-blue text-white flex items-center justify-center font-semibold flex-shrink-0">
                    {(c.client.name.trim()[0] || "?").toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className={`truncate text-sm ${unread ? "font-bold text-gray-900" : "font-medium text-gray-900"}`}>{c.client.name}</span>
                      <span className="flex items-center gap-1 flex-shrink-0 text-gray-400">
                        {c.blocked && <Ico name="ban" className="w-3.5 h-3.5 text-red-400" />}
                        {c.muted && <Ico name="bell-off" className="w-3.5 h-3.5" />}
                        {c.pinned && <Ico name="pin" className="w-3.5 h-3.5" />}
                        <span className="text-[11px]">{listTime(c.last_message_at)}</span>
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2 mt-0.5">
                      <span className={`truncate text-xs ${unread ? "text-gray-700" : "text-gray-500"}`}>{c.last_message ?? "Нет сообщений"}</span>
                      {unread > 0 && (
                        <span className={`min-w-5 h-5 px-1.5 rounded-full text-[11px] font-bold flex items-center justify-center flex-shrink-0 ${c.muted ? "bg-gray-300 text-gray-700" : "bg-brand-yellow text-brand-blue-dark"}`}>
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

        <div className={`${active ? "flex" : "hidden md:flex"} min-h-0 min-w-0`}>
          {active ? (
            <ChatThread
              key={active.id}
              convId={active.id}
              me="manager"
              fetcher={managerApiFetch}
              socket={managerSocket}
              title={active.client.name}
              subtitle={(active.client.phone || active.client.login || (active.client.is_org ? "Организация" : "")) + (active.blocked ? " · заблокирован" : "")}
              onBack={() => setActive(null)}
              titleHref={`/nord/clients?expand=${active.client.id}`}
              emptyText="Напишите клиенту первым"
              action={
                <div className="flex items-center gap-2">
                  {active.client.phone && (
                    <a
                      href={`tel:${active.client.phone.replace(/[^\d+]/g, "")}`}
                      aria-label="Позвонить"
                      title="Позвонить"
                      className="w-10 h-10 rounded-full border border-brand-blue/30 text-brand-blue hover:bg-brand-blue/5 flex items-center justify-center"
                    >
                      <Ico name="phone" className="w-5 h-5" />
                    </a>
                  )}
                  <Link
                    href={`/nord/calendar?client=${active.client.id}`}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-brand-yellow text-brand-blue-dark text-xs font-semibold px-3 py-2 hover:brightness-95 whitespace-nowrap"
                  >
                    <Ico name="calendar-plus" className="w-4 h-4" />
                    <span className="hidden sm:inline">Записать</span>
                  </Link>
                </div>
              }
            />
          ) : (
            <div className="flex-1 flex items-center justify-center bg-white rounded-2xl border border-gray-100 shadow-sm text-sm text-gray-400">
              {openError ?? "Выберите диалог слева"}
            </div>
          )}
        </div>
      </div>
      {menu && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => Date.now() - menuAt.current > 450 && setMenu(null)}
          onContextMenu={(e) => {
            e.preventDefault();
            setMenu(null);
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="absolute w-60 rounded-2xl bg-white border border-gray-100 shadow-xl p-1.5"
            style={{
              left: Math.max(8, Math.min(menu.x, window.innerWidth - 248)),
              top: Math.max(8, Math.min(menu.y, window.innerHeight - 350)),
            }}
          >
            <MenuItem
              icon={menu.item.unread > 0 ? "mail-open" : "mail"}
              label={menu.item.unread > 0 ? "Пометить прочитанным" : "Пометить непрочитанным"}
              onClick={() => toggleUnread(menu.item)}
            />
            <MenuItem
              icon="pin"
              label={menu.item.pinned ? "Открепить" : "Закрепить вверху"}
              onClick={() => runAction(`/chat/conversations/${menu.item.id}/settings`, "PATCH", { pinned: !menu.item.pinned })}
            />
            <MenuItem
              icon={menu.item.muted ? "bell" : "bell-off"}
              label={menu.item.muted ? "Включить уведомления" : "Без звука"}
              onClick={() => runAction(`/chat/conversations/${menu.item.id}/settings`, "PATCH", { muted: !menu.item.muted })}
            />
            <div className="my-1 h-px bg-gray-100" />
            <MenuItem icon="user" label="Карточка клиента" href={`/nord/clients?expand=${menu.item.client.id}`} onClick={() => setMenu(null)} />
            {menu.item.client.phone && (
              <MenuItem
                icon="phone"
                label="Позвонить"
                href={`tel:${menu.item.client.phone.replace(/[^\d+]/g, "")}`}
                onClick={() => setMenu(null)}
              />
            )}
            <MenuItem icon="calendar-plus" label="Записать" href={`/nord/calendar?client=${menu.item.client.id}`} onClick={() => setMenu(null)} />
            <div className="my-1 h-px bg-gray-100" />
            <MenuItem
              icon={menu.item.blocked ? "check" : "ban"}
              label={menu.item.blocked ? "Разблокировать" : "Заблокировать"}
              danger={!menu.item.blocked}
              onClick={() => toggleBlock(menu.item)}
            />
          </div>
        </div>
      )}
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
