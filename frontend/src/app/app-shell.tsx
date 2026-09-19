"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/", label: "Главная", icon: "/icons/home.svg" },
  { href: "/messages", label: "Сообщения", icon: "/icons/message.svg" },
  { href: "/booking", label: "Запись на СТО", icon: "/icons/calendar-plus.svg" },
  { href: "/profile", label: "Профиль", icon: "/icons/user.svg" },
];

function NavIcon({ src, active }: { src: string; active: boolean }) {
  return (
    <span className="relative w-5 h-5 flex-shrink-0 inline-block">
      <Image
        src={src}
        alt=""
        fill
        className={active ? "opacity-100" : "opacity-70"}
        onError={(e) => {
          (e.target as HTMLImageElement).style.visibility = "hidden";
        }}
      />
    </span>
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen w-full bg-brand-blue flex justify-center">
      <div className="w-full max-w-[1280px] flex md:pt-4 md:pb-4">
        <aside className="hidden md:flex w-60 flex-shrink-0 flex-col p-4 gap-1">
          <div className="flex items-center gap-2 px-2 mb-8">
            <div className="w-8 h-8 rounded-lg bg-brand-yellow flex items-center justify-center text-brand-blue-dark font-bold">
              Т
            </div>
            <span className="font-semibold text-lg text-white">Твоя Шина</span>
          </div>
          {NAV_ITEMS.map((item) => {
            const active = pathname === item.href;
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
              </Link>
            );
          })}
        </aside>

        <div className="flex-1 min-w-0 flex flex-col pb-16 md:pb-0">
          <main className="flex-1 min-w-0 bg-[#f6f6f4] md:rounded-[12px]">
            <div className="max-w-[820px] mx-auto w-full p-6 md:p-10">{children}</div>
          </main>
        </div>

        <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-brand-blue-dark flex justify-around py-2 z-10">
          {NAV_ITEMS.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex flex-col items-center gap-1 text-xs px-3 py-1 rounded-lg ${
                  active ? "text-brand-yellow" : "text-white/70"
                }`}
              >
                <NavIcon src={item.icon} active={active} />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
