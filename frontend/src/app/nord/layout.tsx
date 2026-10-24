"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { managerApiFetch, refreshManagerAccessToken } from "@/lib/managerAuth";
import { managerSocket } from "@/lib/chatSocket";
import { useChatCounters } from "@/lib/useChatCounters";

type Me = { id: string; phone: string | null; role: string; full_name: string | null };

const NAV_ITEMS = [
  { href: "/nord", label: "Главная", icon: "/icons/home.svg" },
  { href: "/nord/clients", label: "Клиенты", icon: "/icons/clients.svg" },
  { href: "/nord/calendar", label: "Календарь", icon: "/icons/calendar.svg" },
  { href: "/nord/posts", label: "Посты", icon: "/icons/posts.svg" },
  { href: "/nord/services", label: "Услуги", icon: "/icons/repair.svg" },
  { href: "/nord/chat", label: "Чат", icon: "/icons/chat.svg" },
];

function NavIcon({ src, active }: { src: string; active: boolean }) {
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

export default function NordLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    refreshManagerAccessToken()
      .then(() => managerApiFetch("/users/me"))
      .then((res) => (res.ok ? res.json() : null))
      .then((data: Me | null) => {
        if (data && data.role === "manager") setMe(data);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!loading && !me) window.location.replace("/login");
  }, [loading, me]);

  const { unread_messages, pending_bookings, refresh } = useChatCounters(managerApiFetch, managerSocket, !!me);
  useEffect(() => {
    if (me) refresh();
  }, [pathname, me, refresh]);
  const badges: Record<string, number> = { "/nord/chat": unread_messages, "/nord/calendar": pending_bookings };

  if (loading || !me) {
    return (
      <main className="min-h-screen w-full bg-brand-blue flex items-center justify-center">
        <p className="text-white text-sm">Загрузка…</p>
      </main>
    );
  }

  return (
    <div className="min-h-screen w-full bg-gradient-to-br from-brand-blue-dark via-brand-blue to-brand-blue flex justify-center">
      <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-40 -left-32 w-[560px] h-[560px] rounded-full bg-white/10 blur-3xl" />
        <div className="absolute -bottom-48 -right-32 w-[520px] h-[520px] rounded-full bg-brand-yellow/10 blur-3xl" />
      </div>
      <div className="relative w-full max-w-[1280px] flex md:pt-4 md:pb-4">
        <aside className="hidden md:flex w-56 flex-shrink-0 flex-col p-4 gap-1">
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
                <NavIcon src={item.icon} active={active} />
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

        <div className="flex-1 min-w-0 flex flex-col">
          <main className="flex-1 min-w-0 bg-[#f6f6f4] md:rounded-[12px]">
            <div className="max-w-900px mx-auto w-full p-6 md:p-10">{children}</div>
          </main>
        </div>
      </div>
    </div>
  );
}
