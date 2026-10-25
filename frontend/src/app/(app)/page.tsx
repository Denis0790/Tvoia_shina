"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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

const slideAspect = "aspect-[16/10] sm:aspect-[21/9]";

function Carousel({
  photos,
  fallbackLetter,
  onOpen,
}: {
  photos: { id: string; url: string }[];
  fallbackLetter: string;
  onOpen: (url: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const count = photos.length;

  const goTo = useCallback(
    (i: number) => {
      const el = ref.current;
      if (!el || count === 0) return;
      const next = (i + count) % count;
      el.scrollTo({ left: next * el.clientWidth, behavior: "smooth" });
    },
    [count]
  );

  // автолистание: каждые 5 секунд, пока на карусель не навели курсор или палец
  useEffect(() => {
    if (count < 2 || paused) return;
    const t = setInterval(() => goTo(index + 1), 5000);
    return () => clearInterval(t);
  }, [count, paused, index, goTo]);

  if (count === 0) {
    return (
      <div className={`${slideAspect} bg-gradient-to-br from-brand-blue to-brand-blue-dark flex items-center justify-center`}>
        <span className="text-6xl font-bold text-white/30">{fallbackLetter}</span>
      </div>
    );
  }

  return (
    <div
      className="relative group"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onTouchStart={() => setPaused(true)}
      onTouchEnd={() => setTimeout(() => setPaused(false), 4000)}
    >
      <div
        ref={ref}
        onScroll={(e) => {
          const el = e.currentTarget;
          setIndex(Math.round(el.scrollLeft / el.clientWidth));
        }}
        className="flex overflow-x-auto snap-x snap-mandatory [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {photos.map((ph) => (
          <button
            key={ph.id}
            type="button"
            onClick={() => onOpen(imageUrl(ph.url) ?? "")}
            className={`${slideAspect} w-full flex-shrink-0 snap-center cursor-zoom-in bg-gray-100`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imageUrl(ph.url) ?? ""} alt="" className="w-full h-full object-cover" draggable={false} />
          </button>
        ))}
      </div>

      {count > 1 && (
        <>
          <button
            type="button"
            aria-label="Предыдущее фото"
            onClick={() => goTo(index - 1)}
            className="hidden sm:flex absolute left-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-white/85 text-gray-800 text-xl leading-none items-center justify-center shadow opacity-0 group-hover:opacity-100 transition-opacity"
          >
            ‹
          </button>
          <button
            type="button"
            aria-label="Следующее фото"
            onClick={() => goTo(index + 1)}
            className="hidden sm:flex absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-white/85 text-gray-800 text-xl leading-none items-center justify-center shadow opacity-0 group-hover:opacity-100 transition-opacity"
          >
            ›
          </button>
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1.5 rounded-full bg-black/35 px-2.5 py-1.5">
            {photos.map((ph, i) => (
              <button
                key={ph.id}
                type="button"
                aria-label={`Фото ${i + 1}`}
                onClick={() => goTo(i)}
                className={`h-1.5 rounded-full transition-all ${i === index ? "w-5 bg-white" : "w-1.5 bg-white/55"}`}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default function Home() {
  const [data, setData] = useState<ProfileData | null>(null);
  const [failed, setFailed] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  const [bookings, setBookings] = useState<MyBookingItem[]>([]);
  const [meLoaded, setMeLoaded] = useState(false);
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [openNewsId, setOpenNewsId] = useState<string | null>(null);

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

  useEffect(() => {
    if (!openNewsId) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpenNewsId(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openNewsId]);

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
  const openNews = news.find((n) => n.id === openNewsId) ?? null;
  const bookHref = me ? "/booking" : "/login";
  const phoneHref = profile.phone ? `tel:${profile.phone.replace(/[^\d+]/g, "")}` : null;
  const hasContacts = !!(profile.address || profile.work_hours || profile.phone);
  const hasMap = profile.lat != null && profile.lng != null;

  return (
    <div className="-m-6 md:-m-10 p-6 md:p-10 md:rounded-[12px] bg-[#e8eaf0] min-h-[calc(100dvh-4rem)] md:min-h-[calc(100dvh-2rem)] space-y-4">
      <h1 className="text-lg font-bold text-gray-900">Главная</h1>

      {/* Карусель и визитка сервиса */}
      <section className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <Carousel photos={photos} fallbackLetter={profile.name.slice(0, 1)} onOpen={setLightbox} />
        <div className="p-5">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-full bg-brand-yellow overflow-hidden flex items-center justify-center text-brand-blue-dark font-bold text-xl flex-shrink-0 border border-gray-100">
              {profile.logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={imageUrl(profile.logo_url) ?? ""} alt="" className="w-full h-full object-cover" />
              ) : (
                profile.name.slice(0, 1)
              )}
            </div>
            <div className="min-w-0">
              <h2 className="text-xl font-semibold text-gray-900 leading-tight">{profile.name}</h2>
              {profile.tagline && <p className="text-sm text-gray-500 mt-0.5">{profile.tagline}</p>}
            </div>
          </div>
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
                          <button
                            onClick={() => handleCancel(b.id)}
                            className="text-xs font-medium text-red-600 bg-white border border-red-200 rounded-lg px-3 py-1.5 hover:bg-red-50"
                          >
                            Да, отменить
                          </button>
                          <button onClick={() => setCancelId(null)} className="text-xs text-gray-500 px-2 py-1.5">
                            Нет
                          </button>
                        </>
                      ) : (
                        <>
                          <Link
                            href={`/booking/reschedule?id=${b.id}`}
                            className="text-xs font-medium text-brand-blue bg-white border border-gray-200 rounded-lg px-3 py-1.5 hover:bg-gray-50"
                          >
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

      {/* Новости и акции — сразу под записями, лентой карточек */}
      {news.length > 0 && (
        <section>
          <h2 className="text-base font-semibold text-gray-900 mb-2 px-1">Новости и акции</h2>
          <div className="flex gap-3 overflow-x-auto snap-x snap-mandatory pb-2 -mx-1 px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {news.map((n) => {
              return (
                <article
                  key={n.id}
                  onClick={() => setOpenNewsId(n.id)}
                  className="snap-start flex-shrink-0 self-start w-[270px] sm:w-[320px] bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden cursor-pointer"
                >
                  {n.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={imageUrl(n.image_url) ?? ""} alt="" className="w-full h-36 object-cover" />
                  ) : (
                    <div className="h-1.5 bg-brand-yellow" />
                  )}
                  <div className="p-4">
                    <p className="text-[11px] text-gray-400">{formatNewsDate(n.created_at)}</p>
                    <h3 className="text-sm font-semibold text-gray-900 mt-0.5">{n.title}</h3>
                    {n.body && (
                      <p
                        className="text-sm text-gray-600 mt-1 whitespace-pre-line"
                        style={{ display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}
                      >
                        {n.body}
                      </p>
                    )}
                    <span className="text-xs font-medium text-brand-blue mt-2 inline-block">Подробнее</span>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
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

      {openNews && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center sm:p-4" onClick={() => setOpenNewsId(null)}>
          <div
            className="relative w-full sm:max-w-lg max-h-[90vh] overflow-y-auto bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              aria-label="Закрыть"
              onClick={() => setOpenNewsId(null)}
              className="absolute right-3 top-3 z-10 w-9 h-9 rounded-full bg-white/90 shadow flex items-center justify-center text-gray-700 text-xl leading-none"
            >
              ×
            </button>
            {openNews.image_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={imageUrl(openNews.image_url) ?? ""} alt="" className="w-full max-h-72 object-cover" />
            )}
            <div className="p-5 sm:p-6">
              <p className="text-xs text-gray-400">{formatNewsDate(openNews.created_at)}</p>
              <h3 className="text-lg font-bold text-gray-900 mt-1">{openNews.title}</h3>
              {openNews.body && <p className="text-sm text-gray-700 mt-3 whitespace-pre-line leading-relaxed">{openNews.body}</p>}
            </div>
          </div>
        </div>
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
