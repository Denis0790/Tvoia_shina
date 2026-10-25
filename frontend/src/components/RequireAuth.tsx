"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/auth";

// Страница только для вошедших: гостю вместо содержимого показываем приглашение войти.
export default function RequireAuth({ title, children }: { title: string; children: React.ReactNode }) {
  const [state, setState] = useState<"loading" | "guest" | "ok">("loading");

  useEffect(() => {
    apiFetch("/users/me")
      .then((res) => setState(res.ok ? "ok" : "guest"))
      .catch(() => setState("guest"));
  }, []);

  if (state === "loading") return <p className="text-sm text-gray-400">Загрузка…</p>;
  if (state === "ok") return <>{children}</>;

  return (
    <div className="-m-6 md:-m-10 p-6 md:p-10 md:rounded-[12px] bg-[#e8eaf0] min-h-[calc(100dvh-4rem)] md:min-h-[calc(100dvh-2rem)] space-y-4">
      <h1 className="text-lg font-bold text-gray-900">{title}</h1>
      <section className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 text-center">
        <div className="mx-auto w-12 h-12 rounded-full bg-brand-yellow text-brand-blue-dark font-bold text-xl flex items-center justify-center">
          !
        </div>
        <h2 className="text-base font-semibold text-gray-900 mt-4">Доступно только зарегистрированным</h2>
        <p className="text-sm text-gray-500 mt-1.5 max-w-sm mx-auto">
          Войдите или зарегистрируйтесь по номеру телефона, это займёт минуту.
        </p>
        <Link
          href="/login"
          className="inline-flex items-center justify-center bg-brand-yellow text-brand-blue-dark font-medium text-sm rounded-xl px-6 py-2.5 mt-5 hover:brightness-95 transition"
        >
          Войти
        </Link>
      </section>
    </div>
  );
}
