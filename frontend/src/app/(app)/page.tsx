"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/auth";
import { cancelMyBooking, getMyBookings, getPublicProfile, imageUrl, type MyBookingItem, type ProfileData } from "@/lib/api";

type Me = { id: string; phone: string | null; full_name: string | null };

const STATUS_LABELS: Record<string, string> = {
  pending: "Ждёт подтверждения",
  confirmed: "Подтверждена",
};

function timeText(min: number) {
  return `${String(Math.floor(min / 60) % 24).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

function formatDay(iso: string) {
  return new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString("ru-RU", { day: "numeric", month: "long", weekday: "long" });
}

function formatNewsDate(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
}

function Icon({ name, className = "w-4 h-4" }: { name: string; className?: string }) {
  const src = `/icons/${name}.svg`;
  return (
    <span
      aria-hidden
      className={`${className} inline-block bg-current flex-shrink-0`}
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

function Card({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <section className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
      {title && <h2 className="text-base font-semibold text-gray-900 mb-3">{title}</h2>}
      {children}
    </section>
  );
}

const yellowBtn =
  "inline-flex items-center justify-center gap-2 bg-brand-yellow text-brand-blue-dark font-medium text-sm rounded-xl px-5 py-2.5 hover:brightness-95 transition";
const outlineBtn =
  "inline-flex items-center justify-center gap-2 bg-white border border-gray-200 text-gray-700 font-medium text-sm rounded-xl px-5 py-2.5 hover:bg-gray-50 transition";

export default function Home() {
  const [data, setData] = useState<ProfileData | null>(null);
  const [failed, setFailed] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  const [bookings, setBookings] = useState<MyBookingItem[]>([]);
  const [meLoaded, setMeLoaded] = useState(false);
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);

  useEffect(() => {
    getPublicProfile().then(setData).catch(() => setFailed(true));
    apiFetch("/users/me")
      .then((res) => (res.ok ? res.json() : null))
      .then(async (u) => {
        setMe(u);
        if (u) setBookings(await getMyBookings());
      })
      .catch(() => setMe(null))
      .finally(() => setMeLoaded(true));
  }, []);

  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setLightbox(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox]);

  async function handleCancel(id: string) {
    setActionError(null);
    const r = await cancelMyBooking(id);
    setCancelId(null);
    if (!r.ok) {
      setActionError(r.error || "Не удалось отменить запись");
      return;
    }
    setBookings(await getMyBookings());
  }

  if (failed) return <p className="text-sm text-gray-500">Не удалось загрузить страницу. Попробуйте позже.</p>;
  if (!data) return <p className="text-sm text-gray-400">Загрузка…</p>;

  const { profile, photos, news } = data;
  const bookHref = me ? "/booking" : "/login";
  const phoneHref = profile.phone ? `tel:${profile.phone.replace(/[^\d+]/g, "")}` : null;
  const hasContacts = !!(profile.address || profile.work_hours || profile.phone);
  const hasMap = profile.lat != null && profile.lng != null;

  return (
    <div className="rounded-3xl bg-gradient-to-b from-brand-blue/10 via-brand-blue/5 to-white p-4 sm:p-6 space-y-4">
      <h1 className="text-lg font-bold text-gray-900">Главная</h1>

      {/* Шапка сервиса */}
      <section className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="relative h-36 sm:h-52 bg-gradient-to-r from-brand-blue to-brand-blue-dark">
          {profile.cover_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={imageUrl(profile.cover_url) ?? ""} alt="" className="absolute inset-0 w-full h-full object-cover" />
          )}
        </div>
        <div className="px-5 pb-5">
          <div className="relative z-10 -mt-9 w-[72px] h-[72px] rounded-full border-4 border-white bg-brand-yellow overflow-hidden flex items-center justify-center text-brand-blue-dark font-bold text-2xl shadow">
            {profile.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={imageUrl(profile.logo_url) ?? ""} alt="" className="w-full h-full object-cover" />
            ) : (
              profile.name.slice(0, 1)
            )}
          </div>
          <h2 className="text-xl font-semibold text-gray-900 mt-3">{profile.name}</h2>
          {profile.tagline && <p className="text-sm text-gray-500 mt-0.5">{profile.tagline}</p>}
          <div className="flex flex-wrap gap-2 mt-4">
            <Link href={bookHref} className={yellowBtn}>
              <Icon name="calendar-plus" />
              Записаться
            </Link>
            <Link href={me ? "/messages" : "/login"} className={outlineBtn}>
              <Icon name="chat" />
              Написать
            </Link>
          </div>
        </div>
      </section>

      {/* Личный блок: гость или клиент */}
      {meLoaded && !me && (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-gray-600">Войдите, чтобы записаться и видеть свои записи и машины.</p>
            <Link href="/login" className={yellowBtn}>
              Войти
            </Link>
          </div>
        </Card>
      )}
      {meLoaded && me && (
        <Card>
          <div className="mb-3">
            <p className="text-sm font-medium text-gray-900">Здравствуйте{me.full_name ? `, ${me.full_name}` : ""}!</p>
            {me.phone && <p className="text-xs text-gray-400 mt-0.5">{me.phone}</p>}
          </div>
          <p className="text-xs text-gray-500 mb-2">{bookings.length > 1 ? "Ваши записи" : "Ваша запись"}</p>
          {actionError && <p className="text-xs text-red-500 mb-2">{actionError}</p>}
          {bookings.length > 0 ? (
            <div className="space-y-2">
              {bookings.map((b) => {
                const startMin = Number(b.start_time.slice(0, 2)) * 60 + Number(b.start_time.slice(3, 5));
                return (
                  <div key={b.id} className="rounded-xl bg-brand-blue/5 px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm font-medium text-gray-900 capitalize">{formatDay(b.date)}</p>
                      <span
                        className={`text-[11px] rounded-full px-2 py-0.5 whitespace-nowrap ${
                          b.status === "confirmed" ? "bg-green-100 text-green-700" : "bg-brand-yellow/40 text-brand-blue-dark"
                        }`}
                      >
                        {STATUS_LABELS[b.status] ?? b.status}
                      </span>
                    </div>
                    <p className="text-sm text-gray-600 mt-0.5">
                      {b.start_time}–{timeText(startMin + b.duration_minutes)}
                    </p>
                    {b.services.length > 0 && <p className="text-sm text-gray-800 mt-1">{b.services.join(", ")}</p>}
                    {b.car && <p className="text-xs text-gray-400 mt-0.5">{b.car}</p>}
                    {b.carry_over && <p className="text-xs text-amber-700 mt-1">Работы продолжатся на следующий рабочий день</p>}
                    <div className="flex flex-wrap items-center gap-2 mt-3">
                      {cancelId === b.id ? (
                        <>
                          <span className="text-xs text-gray-600">Отменить запись?</span>
                          <button onClick={() => handleCancel(b.id)} className="text-xs font-medium text-red-600 bg-white border border-red-200 rounded-lg px-3 py-1.5 hover:bg-red-50">
                            Да, отменить
                          </button>
                          <button onClick={() => setCancelId(null)} className="text-xs text-gray-500 px-2 py-1.5">
                            Нет
                          </button>
                        </>
                      ) : (
                        <>
                          <Link href={`/booking/reschedule?id=${b.id}`} className="text-xs font-medium text-brand-blue bg-white border border-gray-200 rounded-lg px-3 py-1.5 hover:bg-gray-50">
                            Перенести
                          </Link>
                          <button
                            onClick={() => {
                              setActionError(null);
                              setCancelId(b.id);
                            }}
                            className="text-xs text-gray-500 hover:text-red-600 px-2 py-1.5"
                          >
                            Отменить
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-gray-400">Пока нет активных записей</p>
          )}
        </Card>
      )}

      {/* О сервисе */}
      {(profile.description || hasContacts) && (
        <Card title="О сервисе">
          {profile.description && <p className="text-sm text-gray-700 whitespace-pre-line leading-relaxed">{profile.description}</p>}
          {hasContacts && (
            <dl className={`${profile.description ? "mt-4 pt-4 border-t border-gray-100" : ""} grid gap-3 sm:grid-cols-2 text-sm`}>
              {profile.address && (
                <div>
                  <dt className="text-xs text-gray-400">Адрес</dt>
                  <dd className="text-gray-900">{profile.address}</dd>
                </div>
              )}
              {profile.work_hours && (
                <div>
                  <dt className="text-xs text-gray-400">Часы работы</dt>
                  <dd className="text-gray-900">{profile.work_hours}</dd>
                </div>
              )}
              {profile.phone && (
                <div>
                  <dt className="text-xs text-gray-400">Телефон</dt>
                  <dd>
                    <a href={phoneHref ?? "#"} className="text-brand-blue font-medium">
                      {profile.phone}
                    </a>
                  </dd>
                </div>
              )}
            </dl>
          )}
          {hasMap && (
            <div className="mt-4">
              <iframe
                title="Карта"
                loading="lazy"
                className="w-full h-56 rounded-xl border border-gray-100"
                src={`https://yandex.ru/map-widget/v1/?ll=${profile.lng}%2C${profile.lat}&z=16&pt=${profile.lng},${profile.lat},pm2rdm`}
              />
              <a
                href={`https://yandex.ru/maps/?pt=${profile.lng},${profile.lat}&z=16&l=map`}
                target="_blank"
                rel="noreferrer"
                className="inline-block mt-2 text-xs text-brand-blue"
              >
                Открыть в Яндекс Картах
              </a>
            </div>
          )}
        </Card>
      )}

      {/* Фото */}
      {photos.length > 0 && (
        <Card title="Фото">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
            {photos.map((ph) => (
              <button
                key={ph.id}
                type="button"
                onClick={() => setLightbox(imageUrl(ph.url))}
                className="aspect-[4/3] rounded-xl overflow-hidden bg-gray-100 cursor-zoom-in"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imageUrl(ph.url) ?? ""} alt="" className="w-full h-full object-cover hover:scale-105 transition-transform duration-300" />
              </button>
            ))}
          </div>
        </Card>
      )}

      {/* Новости */}
      {news.length > 0 && (
        <Card title="Новости и акции">
          <div className="space-y-4">
            {news.map((n) => (
              <article key={n.id} className="border-b border-gray-100 last:border-0 pb-4 last:pb-0">
                {n.image_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={imageUrl(n.image_url) ?? ""} alt="" className="w-full max-h-64 object-cover rounded-xl mb-3" />
                )}
                <h3 className="text-sm font-semibold text-gray-900">{n.title}</h3>
                <p className="text-xs text-gray-400 mb-1">{formatNewsDate(n.created_at)}</p>
                {n.body && <p className="text-sm text-gray-700 whitespace-pre-line">{n.body}</p>}
              </article>
            ))}
          </div>
        </Card>
      )}

      {lightbox && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 cursor-zoom-out" onClick={() => setLightbox(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={lightbox} alt="" className="max-w-full max-h-full rounded-xl" />
        </div>
      )}
    </div>
  );
}
