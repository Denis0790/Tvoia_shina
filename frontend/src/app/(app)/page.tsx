"use client";

import { useEffect, useState } from "react";
import { apiFetch, setAccessToken } from "@/lib/auth";
import { logout } from "@/lib/api";

type Me = { id: string; phone: string | null; full_name: string | null };

export default function Home() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch("/users/me")
      .then((res) => (res.ok ? res.json() : null))
      .then(setMe)
      .finally(() => setLoading(false));
  }, []);

  async function handleLogout() {
    await logout();
    setAccessToken(null);
    setMe(null);
  }

  if (loading) {
    return <p className="text-sm text-gray-400">Загрузка…</p>;
  }

  if (!me) {
    return (
      <div>
        <h1 className="text-xl font-semibold text-gray-900 mb-2">Твоя Шина</h1>
        <p className="text-sm text-gray-500">
          Вы не авторизованы.{" "}
          <a href="/login" className="text-brand-blue font-medium underline">
            Войти
          </a>
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-7">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Добрый день{me.full_name ? `, ${me.full_name}` : ""}</h1>
          <p className="text-sm text-gray-500 mt-1">Вы вошли как {me.phone}</p>
        </div>
        <button
          onClick={handleLogout}
          className="text-sm bg-white border border-gray-200 rounded-lg px-4 py-2 text-gray-600 hover:bg-gray-50"
        >
          Выйти
        </button>
      </div>

      <div className="bg-white rounded-2xl p-5 shadow-sm">
        <p className="text-sm text-gray-500">Ближайшая запись</p>
        <p className="text-sm text-gray-400 mt-2">Пока нет активных записей</p>
      </div>
    </div>
  );
}
