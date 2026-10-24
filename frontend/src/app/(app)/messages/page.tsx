"use client";

import { useEffect, useState } from "react";
import { getPublicProfile } from "@/lib/api";

export default function MessagesPage() {
  const [phone, setPhone] = useState<string | null>(null);

  useEffect(() => {
    getPublicProfile().then((d) => setPhone(d.profile.phone)).catch(() => setPhone(null));
  }, []);

  return (
    <div className="rounded-3xl bg-gradient-to-b from-brand-blue/10 via-brand-blue/5 to-white p-4 sm:p-6 space-y-4">
      <h1 className="text-lg font-bold text-gray-900">Сообщения</h1>
      <section className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
        <h2 className="text-base font-semibold text-gray-900">Чат с сервисом скоро появится</h2>
        <p className="text-sm text-gray-500 mt-1.5">
          Пока вопросы можно задать в комментарии к записи или по телефону.
        </p>
        {phone && (
          <a
            href={`tel:${phone.replace(/[^\d+]/g, "")}`}
            className="inline-flex items-center justify-center bg-brand-yellow text-brand-blue-dark font-medium text-sm rounded-xl px-5 py-2.5 mt-4 hover:brightness-95 transition"
          >
            Позвонить {phone}
          </a>
        )}
      </section>
    </div>
  );
}
