"use client";

import { useEffect, useState } from "react";
import { getPendingBookings, getPosts, confirmBooking, declineBooking, type PendingBooking, type PostInfo } from "@/lib/api";

function formatDuration(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h ? `${h} ч ` : ""}${m ? `${m} мин` : ""}`.trim();
}

export default function NordQueuePage() {
  const [bookings, setBookings] = useState<PendingBooking[]>([]);
  const [posts, setPosts] = useState<PostInfo[]>([]);
  const [selectedPost, setSelectedPost] = useState<Record<string, string>>({});

  async function loadData() {
    const [b, p] = await Promise.all([getPendingBookings(), getPosts()]);
    setBookings(b);
    setPosts(p);
  }

  useEffect(() => {
    loadData();
  }, []);

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

  return (
    <div>
      <h1 className="text-xl font-semibold text-gray-900 mb-6">Очередь подтверждений</h1>

      {bookings.length === 0 && <p className="text-sm text-gray-400">Очередь пуста</p>}

      <div className="flex flex-col gap-4">
        {bookings.map((b) => (
          <div key={b.id} className="bg-white rounded-2xl p-5 shadow-sm">
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
              <button onClick={() => handleDecline(b.id)} className="text-red-500 text-sm px-4">
                Отклонить
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
