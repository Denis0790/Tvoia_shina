"use client";

import { useEffect, useState } from "react";
import { apiFetch, refreshAccessToken, setAccessToken } from "@/lib/auth";
import { managerLogin, getPendingBookings, getPosts, confirmBooking, declineBooking, type PendingBooking, type PostInfo } from "@/lib/api";

type Me = { id: string; phone: string | null; role: string };

function formatDuration(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h ? `${h} ч ` : ""}${m ? `${m} мин` : ""}`.trim();
}

export default function NordPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");

  const [bookings, setBookings] = useState<PendingBooking[]>([]);
  const [posts, setPosts] = useState<PostInfo[]>([]);
  const [selectedPost, setSelectedPost] = useState<Record<string, string>>({});

  async function loadData() {
    const [b, p] = await Promise.all([getPendingBookings(), getPosts()]);
    setBookings(b);
    setPosts(p);
  }

  useEffect(() => {
    refreshAccessToken()
      .then(() => apiFetch("/users/me"))
      .then((res) => (res.ok ? res.json() : null))
      .then((data: Me | null) => {
        if (data && data.role === "manager") {
          setMe(data);
          loadData();
        }
      })
      .finally(() => setLoading(false));
  }, []);

  async function handleLogin() {
    setLoginError("");
    try {
      const data = await managerLogin(login, password);
      setAccessToken(data.access_token);
      setMe(data);
      loadData();
    } catch {
      setLoginError("Неверный логин или пароль");
    }
  }

  async function handleConfirm(bookingId: string) {
    const postId = selectedPost[bookingId];
    if (!postId) return;
    const ok = await confirmBooking(bookingId, postId);
    if (ok) loadData();
  }

  async function handleDecline(bookingId: string) {
    const ok = await declineBooking(bookingId);
    if (ok) loadData();
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
    <main className="min-h-screen w-full bg-brand-blue p-6 md:p-10">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-white text-lg font-semibold mb-6">Подтверждение записей</h1>

        {bookings.length === 0 && (
          <p className="text-white/60 text-sm">Очередь пуста</p>
        )}

        <div className="flex flex-col gap-4">
          {bookings.map((b) => (
            <div key={b.id} className="bg-white rounded-2xl p-5">
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-medium text-gray-800">
                  {b.date} · {b.start_time} · {formatDuration(b.duration_minutes)}
                </p>
              </div>
              {b.comment && <p className="text-xs text-gray-500 mb-3">«{b.comment}»</p>}

              <div className="flex items-center gap-2 mb-4">
                <span className="text-xs text-gray-500">Пост:</span>
                <select
                  value={selectedPost[b.id] || ""}
                  onChange={(e) => setSelectedPost({ ...selectedPost, [b.id]: e.target.value })}
                  className="border border-gray-200 rounded-lg px-2 py-1 text-xs"
                >
                  <option value="">Выбрать</option>
                  {posts.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => handleConfirm(b.id)}
                  disabled={!selectedPost[b.id]}
                  className="flex-1 bg-green-600 disabled:opacity-40 text-white text-sm font-medium rounded-lg py-2"
                >
                  Подтвердить
                </button>
                <button
                  onClick={() => handleDecline(b.id)}
                  className="text-red-500 text-sm px-4"
                >
                  Отклонить
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
