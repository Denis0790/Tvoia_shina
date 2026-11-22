"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { managerApiFetch, refreshManagerAccessToken } from "@/lib/managerAuth";
import { managerSocket } from "@/lib/chatSocket";
import PushPrompt from "@/components/PushPrompt";
import { useChatCounters } from "@/lib/useChatCounters";

type Me = { id: string; phone: string | null; role: string; full_name: string | null };

const NAV_ITEMS = [
  { href: "/nord", label: "Главная", icon: "/icons/home.svg" },
  { href: "/nord/clients", label: "Клиенты", icon: "/icons/clients.svg" },
  { href: "/nord/calendar", label: "Календарь", icon: "/icons/calendar.svg" },
  { href: "/nord/posts", label: "Посты", icon: "/icons/posts.svg" },
  { href: "/nord/services", label: "Услуги", icon: "/icons/repair.svg" },
  { href: "/nord/chat", label: "Чат", icon: "/icons/chat.svg" },
  { href: "/nord/stats", label: "Статистика", icon: "/icons/stats.svg" },
];

const MOBILE_HREFS = ["/nord", "/nord/calendar", "/nord/clients", "/nord/chat"];
const MOBILE_MAIN = MOBILE_HREFS.map((h) => NAV_ITEMS.find((i) => i.href === h)!);
const MORE_ITEMS = NAV_ITEMS.filter((i) => !MOBILE_HREFS.includes(i.href));

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
  const [moreFor, setMoreFor] = useState<string | null>(null);
  const moreOpen = moreFor === pathname; // закрывается само при смене страницы

  // у менеджера своё приложение на экране: открывается сразу в /nord
  useEffect(() => {
    const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    if (!link) return;
    const prev = link.getAttribute("href") || "/manifest.json";
    link.setAttribute("href", "/manifest-nord.json");
    return () => link.setAttribute("href", prev);
  }, []);

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
    <div className="min-h-screen w-full bg-gradient-to-br from-brand-blue-dark via-brand-blue to-brand-blue flex justify-center overflow-x-clip">
      <PushPrompt fetcher={managerApiFetch} active />
      <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-40 -left-32 w-[560px] h-[560px] rounded-full bg-white/10 blur-3xl" />
        <div className="absolute -bottom-48 -right-32 w-[520px] h-[520px] rounded-full bg-brand-yellow/10 blur-3xl" />
      </div>
      <div className="relative w-full max-w-[1280px] flex md:pt-4 md:pb-4">
        <aside className="hidden md:flex w-56 flex-shrink-0 flex-col p-4 gap-1 md:sticky md:top-4 md:self-start">
          <div className="flex items-center gap-2 px-2 mb-8">
            <img src="/logo.png" alt="" className="w-9 h-9 object-contain" />
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

        <div className="flex-1 min-w-0 flex flex-col pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0">
          <main className="flex-1 min-w-0 bg-[#f6f6f4] md:rounded-[12px]">
            <div className="max-w-900px mx-auto w-full p-6 md:p-10">{children}</div>
          </main>
        </div>

        <nav
          className="md:hidden fixed bottom-0 left-0 right-0 z-30 bg-brand-blue-dark flex items-stretch"
          style={{ height: "calc(4rem + env(safe-area-inset-bottom))", paddingBottom: "env(safe-area-inset-bottom)" }}
        >
          {MOBILE_MAIN.map((item) => {
            const active = item.href === "/nord" ? pathname === item.href : pathname.startsWith(item.href);
            const badge = badges[item.href] || 0;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`relative flex-1 flex flex-col items-center justify-center gap-1 text-[11px] ${
                  active ? "text-brand-yellow" : "text-white/70"
                }`}
              >
                <NavIcon src={item.icon} active={active} />
                {item.label}
                {badge > 0 && (
                  <span className="absolute top-1.5 left-1/2 ml-2 min-w-4 h-4 px-1 rounded-full bg-brand-yellow text-brand-blue-dark text-[10px] font-bold flex items-center justify-center">
                    {badge}
                  </span>
                )}
              </Link>
            );
          })}
          <button
            type="button"
            aria-expanded={moreOpen}
            onClick={() => setMoreFor(moreOpen ? null : pathname)}
            className={`flex-1 flex flex-col items-center justify-center gap-1 text-[11px] cursor-pointer ${
              moreOpen || MORE_ITEMS.some((i) => pathname.startsWith(i.href)) ? "text-brand-yellow" : "text-white/70"
            }`}
          >
            <NavIcon src="/icons/more.svg" active={moreOpen} />
            Ещё
          </button>
        </nav>

        {moreOpen && (
          <>
            <button
              type="button"
              aria-label="Закрыть"
              className="md:hidden fixed inset-0 z-20 bg-black/30"
              onClick={() => setMoreFor(null)}
            />
            <div
              className="md:hidden fixed left-3 right-3 z-30 bg-white rounded-2xl shadow-xl p-2"
              style={{ bottom: "calc(4rem + env(safe-area-inset-bottom) + 0.5rem)" }}
            >
              {MORE_ITEMS.map((item) => {
                const active = pathname.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm ${
                      active ? "bg-brand-blue/10 text-brand-blue-dark font-medium" : "text-gray-800 active:bg-gray-100"
                    }`}
                  >
                    <NavIcon src={item.icon} active={active} />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
