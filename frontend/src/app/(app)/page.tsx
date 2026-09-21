"use client";

import { useEffect, useState } from "react";
import { apiFetch, setAccessToken } from "@/lib/auth";
import { logout, getMyBooking, type MyBooking } from "@/lib/api";

type Me = { id: string; phone: string | null; full_name: string | null };

const STATUS_LABELS: Record<string, string> = {
  pending: "Ждёт подтверждения менеджера",
  confirmed: "Подтверждена",
};

export default function Home() {
  const [me, setMe] = useState<Me | null>(null);
  const [booking, setBooking] = useState<MyBooking>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch("/users/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        setMe(data);
        if (data) return getMyBooking().then(setBooking);
      })
      .finally(() => setLoading(false));
  }, []);

  async function handleLogout() {
    await logout();
    setAccessToken(null);
    setMe(null);
    setBooking(null);
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
          <h1 className="text-xl font-semibold text-gray-900">
            Добрый день{me.full_name ? `, ${me.full_name}` : ""}
          </h1>
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
        <p className="text-sm text-gray-500 mb-2">Ближайшая запись</p>
        {!booking && (
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-400">Пока нет активных записей</p>
            
            <a
              href="/booking"
              className="text-sm bg-brand-yellow text-brand-blue-dark font-medium rounded-lg px-4 py-2"
            >
              Записаться
            </a>
          </div>
        )}
        {booking && (
          <div>
            <p className="text-sm text-gray-800 font-medium">
              {booking.date} · {booking.start_time}
            </p>
            <p
              className={`text-xs mt-1 ${
                booking.status === "confirmed" ? "text-green-600" : "text-amber-600"
              }`}
            >
              {STATUS_LABELS[booking.status] || booking.status}
            </p>
            {booking.comment && (
              <p className="text-xs text-gray-400 mt-2">Комментарий: {booking.comment}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
