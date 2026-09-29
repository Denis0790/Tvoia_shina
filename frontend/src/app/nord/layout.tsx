"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { managerApiFetch, refreshManagerAccessToken, setManagerAccessToken } from "@/lib/managerAuth";
import { managerLogin } from "@/lib/api";

type Me = { id: string; phone: string | null; role: string; full_name: string | null };

const NAV_ITEMS = [
  { href: "/nord", label: "Очередь", icon: "/icons/queue.svg" },
  { href: "/nord/clients", label: "Клиенты", icon: "/icons/clients.svg" },
  { href: "/nord/calendar", label: "Календарь", icon: "/icons/calendar.svg" },
  { href: "/nord/posts", label: "Посты", icon: "/icons/posts.svg" },
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

  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");

  useEffect(() => {
    refreshManagerAccessToken()
      .then(() => managerApiFetch("/users/me"))
      .then((res) => (res.ok ? res.json() : null))
      .then((data: Me | null) => {
        if (data && data.role === "manager") setMe(data);
      })
      .finally(() => setLoading(false));
  }, []);

  async function handleLogin() {
    setLoginError("");
    try {
      const data = await managerLogin(login, password);
      setManagerAccessToken(data.access_token);
      setMe(data);
    } catch {
      setLoginError("Неверный логин или пароль");
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen w-full bg-brand-blue flex items-center justify-center">
        <p className="text-white text-sm">Загрузка…</p>
      </main>
    );
  }

  if (!me) {
    return (
      <main className="min-h-screen w-full bg-brand-blue flex items-center justify-center p-6">
        <div className="w-full max-w-sm bg-white rounded-2xl p-6 shadow-lg">
          <input
            placeholder="Логин"
            value={login}
            onChange={(e) => setLogin(e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mb-3"
          />
          <input
            placeholder="Пароль"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mb-3"
          />
          <button
            onClick={handleLogin}
            className="w-full bg-brand-yellow text-brand-blue-dark font-medium text-sm rounded-lg py-2.5"
          >
            Войти
          </button>
          {loginError && <p className="text-xs text-red-500 mt-3 text-center">{loginError}</p>}
        </div>
      </main>
    );
  }

  return (
    <div className="min-h-screen w-full bg-brand-blue flex justify-center">
      <div className="w-full max-w-[1280px] flex md:pt-4 md:pb-4">
        <aside className="hidden md:flex w-56 flex-shrink-0 flex-col p-4 gap-1">
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

        <div className="flex-1 min-w-0 flex flex-col">
          <main className="flex-1 min-w-0 bg-[#f6f6f4] md:rounded-[12px]">
            <div className="max-w-[900px] mx-auto w-full p-6 md:p-10">{children}</div>
          </main>
        </div>
      </div>
    </div>
  );
}
