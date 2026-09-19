"use client";

import { useEffect, useState } from "react";
import { apiFetch, setAccessToken } from "@/lib/auth";

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

  function handleLogout() {
    setAccessToken(null);
    setMe(null);
  }

  return (
    <main style={{ padding: 40, fontFamily: "sans-serif" }}>
      <h1>Твоя Шина</h1>
      {loading && <p>Загрузка…</p>}
      {!loading && me && (
        <>
          <p>
            Вы вошли как <b>{me.phone}</b>
          </p>
          <button onClick={handleLogout}>Выйти</button>
        </>
      )}
      {!loading && !me && (
        <p>
          Вы не авторизованы. <a href="/login">Войти</a>
        </p>
      )}
    </main>
  );
}
