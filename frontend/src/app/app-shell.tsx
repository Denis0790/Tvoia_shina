"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { apiFetch } from "@/lib/auth";
import { getMe } from "@/lib/api";
import { clientSocket } from "@/lib/chatSocket";
import { useChatCounters } from "@/lib/useChatCounters";

const NAV_ITEMS = [
  { href: "/", label: "Главная", icon: "/icons/home.svg" },
  { href: "/messages", label: "Сообщения", icon: "/icons/message.svg" },
  { href: "/booking", label: "Запись на СТО", icon: "/icons/calendar-plus.svg" },
  { href: "/profile", label: "Профиль", icon: "/icons/user.svg" },
];

function NavIcon({ src }: { src: string }) {
  return (
    <span
      className="w-5 h-5 flex-shrink-0 inline-block bg-current"
      style={{
        WebkitMaskImage: `url(${src})`,
        maskImage: `url(${src})`,
        WebkitMaskRepeat: "no-repeat",
        maskRepeat: "no-repeat",
        WebkitMaskPosition: "center",
        maskPosition: "center",
        WebkitMaskSize: "contain",
        maskSize: "contain",
      }}
    />
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    if (authed) return;
    let cancelled = false;
    const check = () =>
      getMe()
        .then((m) => {
          if (!cancelled && m && m.role !== "manager") setAuthed(true);
        })
        .catch(() => {});
    check();
    const t = setTimeout(check, 3000); // повтор: при загрузке токен могут обновлять сразу несколько запросов
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [authed, pathname]);

  const { unread_messages, refresh } = useChatCounters(apiFetch, clientSocket, authed);
  useEffect(() => {
    if (authed) refresh();
  }, [pathname, authed, refresh]);
  const badges: Record<string, number> = { "/messages": unread_messages };

  return (
    <div className="min-h-screen w-full bg-gradient-to-br from-brand-blue-dark via-brand-blue to-brand-blue flex justify-center">
      <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-40 -left-32 w-[560px] h-[560px] rounded-full bg-white/10 blur-3xl" />
        <div className="absolute -bottom-48 -right-32 w-[520px] h-[520px] rounded-full bg-brand-yellow/10 blur-3xl" />
      </div>
      <div className="relative w-full max-w-[1280px] flex md:pt-4 md:pb-4">
        <aside className="hidden md:flex w-56 flex-shrink-0 flex-col p-4 gap-1 md:sticky md:top-4 md:self-start">
          <div className="flex items-center gap-2 px-2 mb-8">
            <div className="w-8 h-8 rounded-lg bg-brand-yellow flex items-center justify-center text-brand-blue-dark font-bold">
              Т
            </div>
            <span className="font-semibold text-lg text-white">Твоя Шина</span>
          </div>
          {NAV_ITEMS.map((item) => {
            const active = pathname === item.href;
            const badge = badges[item.href] || 0;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm ${
                  active
                    ? "bg-brand-yellow text-brand-blue-dark font-medium"
                    : "text-white/85 hover:bg-white/10"
                }`}
              >
                <NavIcon src={item.icon} />
                {item.label}
                {badge > 0 && (
                  <span
                    className={`ml-auto min-w-5 h-5 px-1.5 rounded-full text-[11px] font-bold flex items-center justify-center ${
                      active ? "bg-brand-blue-dark text-white" : "bg-brand-yellow text-brand-blue-dark"
                    }`}
                  >
                    {badge}
                  </span>
                )}
              </Link>
            );
          })}
        </aside>

        <div className="flex-1 min-w-0 flex flex-col pb-16 md:pb-0">
          <main className="flex-1 min-w-0 bg-[#f6f6f4] md:rounded-[12px]">
            <div className="mx-auto w-full p-6 md:p-10">{children}</div>
          </main>
        </div>

        <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-brand-blue-dark flex justify-around py-2 z-10">
          {NAV_ITEMS.map((item) => {
            const active = pathname === item.href;
            const badge = badges[item.href] || 0;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`relative flex flex-col items-center gap-1 text-xs px-3 py-1 rounded-lg ${
                  active ? "text-brand-yellow" : "text-white/70"
                }`}
              >
                <NavIcon src={item.icon} />
                {item.label}
                {badge > 0 && (
                  <span className="absolute top-0 right-1 min-w-4 h-4 px-1 rounded-full bg-brand-yellow text-brand-blue-dark text-[10px] font-bold flex items-center justify-center">
                    {badge}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
