"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  getServices,
  getAvailability,
  createBooking,
  getCars,
  type Service,
  type PostAvailability,
  type Car,
} from "@/lib/api";

const DAYS_AHEAD = 21;
const MAX_MINUTES = 480; // лимит одной клиентской записи — 8 часов
const COLLAPSED_COUNT = 6;

function formatDuration(min: number) {
  if (min % 30 === 0) return `${String(min / 60).replace(".", ",")} ч`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h ? `${h} ч` : ""}${h && m ? " " : ""}${m ? `${m} мин` : ""}` || "0 мин";
}

// даты считаем по Москве: сервер работает по московскому времени
function mskToday(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Moscow" });
}
function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function dayParts(iso: string) {
  const d = new Date(`${iso}T12:00:00Z`);
  return {
    wd: d.toLocaleDateString("ru-RU", { weekday: "short", timeZone: "UTC" }),
    num: d.getUTCDate(),
    mon: d.toLocaleDateString("ru-RU", { month: "short", timeZone: "UTC" }).replace(".", ""),
  };
}
function longDay(iso: string) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    weekday: "long",
    timeZone: "UTC",
  });
}

function fitsInfo(post: PostAvailability, time: string, need: number): { spill: boolean } | null {
  const idx = post.slots.findIndex((s) => s.time === time);
  if (idx === -1) return null;
  for (let k = 0; k < need; k++) {
    const slot = post.slots[idx + k];
    if (!slot) return { spill: true }; // работы не помещаются до конца дня — продолжатся на следующий
    if (!slot.free) return null;
  }
  return { spill: false };
}

function Card({ step, title, hint, children }: { step?: number; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
      <div className="flex items-start gap-3 mb-4">
        {step && (
          <span className="mt-0.5 w-6 h-6 rounded-full bg-brand-blue text-white text-xs font-semibold flex items-center justify-center flex-shrink-0">
            {step}
          </span>
        )}
        <div>
          <h2 className="text-base font-semibold text-gray-900 leading-6">{title}</h2>
          {hint && <p className="text-xs text-gray-500 mt-0.5">{hint}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

const yellowBtn =
  "inline-flex items-center justify-center gap-2 bg-brand-yellow text-brand-blue-dark font-medium text-sm rounded-xl px-5 py-3 hover:brightness-95 transition";
const chipBase = "text-xs rounded-full px-3.5 py-1.5 border transition";
const chipOn = "border-brand-blue bg-brand-blue text-white";
const chipOff = "border-gray-200 text-gray-600 hover:border-gray-300 bg-white";

export default function BookingPage() {
  const [allServices, setAllServices] = useState<Service[]>([]);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("");
  const [expanded, setExpanded] = useState(false);
  const [selected, setSelected] = useState<Service[]>([]);

  const [cars, setCars] = useState<Car[]>([]);
  const [carId, setCarId] = useState("");

  const [avail, setAvail] = useState<Record<string, PostAvailability[]>>({});
  const [availLoaded, setAvailLoaded] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [postId, setPostId] = useState("");

  const [comment, setComment] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const dates = useMemo(() => {
    const t = mskToday();
    return Array.from({ length: DAYS_AHEAD }, (_, i) => addDays(t, i));
  }, []);

  function loadAvailability() {
    return Promise.all(dates.map((d) => getAvailability(d).catch(() => [] as PostAvailability[]))).then((res) => {
      const map: Record<string, PostAvailability[]> = {};
      dates.forEach((d, i) => (map[d] = res[i]));
      setAvail(map);
      setAvailLoaded(true);
    });
  }

  useEffect(() => {
    getServices().then(setAllServices).catch(() => setAllServices([]));
    getCars()
      .then((c) => {
        setCars(c);
        if (c.length === 1) setCarId(c[0].id);
      })
      .catch(() => setCars([]));
    loadAvailability();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totalMinutes = selected.reduce((s, x) => s + x.duration_minutes, 0);
  const tooLong = totalMinutes > MAX_MINUTES;
  const need = Math.max(1, Math.ceil((totalMinutes || 30) / 30));
  const hasServices = selected.length > 0;

  // ---------- услуги ----------
  const categories = useMemo(() => {
    const set: string[] = [];
    for (const s of allServices) {
      const c = s.category ?? "Прочее";
      if (!set.includes(c)) set.push(c);
    }
    return set;
  }, [allServices]);

  const q = query.trim().toLowerCase();
  const filtered = allServices.filter(
    (s) => (!category || (s.category ?? "Прочее") === category) && (!q || s.name.toLowerCase().includes(q))
  );
  const limited = q || category || expanded ? filtered : filtered.slice(0, COLLAPSED_COUNT);

  function toggleService(s: Service) {
    setStatus(null);
    setSelected((cur) => (cur.find((x) => x.id === s.id) ? cur.filter((x) => x.id !== s.id) : [...cur, s]));
  }

  // ---------- календарь ----------
  const workingPostsAll = useMemo(() => {
    const map = new Map<string, string>();
    for (const day of Object.values(avail)) for (const p of day) if (p.working) map.set(p.post_id, p.name);
    return Array.from(map, ([id, name]) => ({ id, name }));
  }, [avail]);

  function slotInfo(date: string, time: string) {
    const posts = (avail[date] ?? []).filter((p) => p.working && (!postId || p.post_id === postId));
    for (const p of posts) {
      const info = fitsInfo(p, time, need);
      if (info) return info;
    }
    return null;
  }

  function timesFor(date: string): string[] {
    const posts = (avail[date] ?? []).filter((p) => p.working && (!postId || p.post_id === postId));
    const times = Array.from(new Set(posts.flatMap((p) => p.slots.map((s) => s.time)))).sort();
    return times.filter((t) => slotInfo(date, t));
  }

  const dayOk = useMemo(() => {
    const m: Record<string, boolean> = {};
    for (const d of dates) m[d] = timesFor(d).length > 0;
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dates, avail, need, postId]);

  // выбранный день должен оставаться доступным; иначе берём ближайший свободный
  useEffect(() => {
    if (!hasServices || !availLoaded) return;
    if (selectedDate && dayOk[selectedDate]) return;
    setSelectedDate(dates.find((d) => dayOk[d]) ?? null);
    setSelectedTime(null);
  }, [hasServices, availLoaded, dayOk, dates, selectedDate]);

  useEffect(() => {
    if (selectedDate && selectedTime && !slotInfo(selectedDate, selectedTime)) setSelectedTime(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [need, postId, avail]);

  const times = selectedDate ? timesFor(selectedDate) : [];
  const spill = selectedDate && selectedTime ? slotInfo(selectedDate, selectedTime)?.spill : false;

  const car = cars.find((c) => c.id === carId) ?? null;
  const carLabel = (c: Car) => `${c.make} ${c.model}${c.color ? ` · ${c.color}` : ""}`;
  const plateOf = (c: Car) => (c as { plate?: string | null }).plate ?? null;

  async function handleSubmit() {
    setStatus(null);
    if (!hasServices) return setStatus("Сначала выберите работы");
    if (tooLong) return setStatus("Слишком много работ для одной записи — разбейте на две");
    if (cars.length > 1 && !carId) return setStatus("Выберите автомобиль");
    if (!selectedDate || !selectedTime) return setStatus("Выберите дату и время");
    setBusy(true);
    const result = await createBooking({
      car_id: carId || null,
      post_id: postId || null,
      date: selectedDate,
      start_time: selectedTime,
      service_ids: selected.map((s) => s.id),
      comment: comment.trim() || null,
    });
    setBusy(false);
    if (!result.ok) {
      setStatus(result.error || "Не удалось создать запись");
      loadAvailability();
      return;
    }
    setDone(true);
    setSelected([]);
    setSelectedTime(null);
    setComment("");
    loadAvailability();
  }

  function startOver() {
    setDone(false);
    setStatus(null);
    setSelectedDate(null);
    setQuery("");
    setCategory("");
  }

  return (
    <div className="-m-6 md:-m-10 p-6 md:p-10 md:rounded-[12px] bg-[#e8eaf0] min-h-[calc(100dvh-4rem)] md:min-h-[calc(100dvh-2rem)] space-y-4">
      <div>
        <h1 className="text-lg font-bold text-gray-900">Запись на сервис</h1>
        <p className="text-xs text-gray-500 mt-0.5">Выберите работы, затем удобное время — свободные окна подберём сами.</p>
      </div>

      {done ? (
        <Card title="Заявка отправлена">
          <p className="text-sm text-gray-600">Менеджер подтвердит запись, статус появится на главной странице.</p>
          <div className="flex flex-wrap gap-2 mt-4">
            <Link href="/" className={yellowBtn}>
              На главную
            </Link>
            <button
              onClick={startOver}
              className="inline-flex items-center justify-center bg-white border border-gray-200 text-gray-700 font-medium text-sm rounded-xl px-5 py-3 hover:bg-gray-50 transition"
            >
              Записаться ещё
            </button>
          </div>
        </Card>
      ) : (
        <>
          {/* 1. Работы */}
          <Card step={1} title="Что нужно сделать с машиной?" hint="Можно выбрать несколько работ.">
            {hasServices && (
              <div data-testid="selected-chips" className="flex flex-wrap gap-2 mb-4">
                {selected.map((s) => (
                  <span
                    key={s.id}
                    className="bg-brand-yellow text-brand-blue-dark text-xs font-medium rounded-full pl-3 pr-2 py-1.5 flex items-center gap-1.5"
                  >
                    {s.name}
                    <button
                      onClick={() => toggleService(s)}
                      aria-label={`Убрать: ${s.name}`}
                      className="w-4 h-4 rounded-full bg-brand-blue-dark/10 hover:bg-brand-blue-dark/20 flex items-center justify-center text-[11px] leading-none"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}

            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Поиск по работам"
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/15 transition"
            />

            {categories.length > 1 && (
              <div className="flex flex-wrap gap-2 mt-3">
                <button onClick={() => setCategory("")} className={`${chipBase} ${category === "" ? chipOn : chipOff}`}>
                  Все
                </button>
                {categories.map((c) => (
                  <button key={c} onClick={() => setCategory(category === c ? "" : c)} className={`${chipBase} ${category === c ? chipOn : chipOff}`}>
                    {c}
                  </button>
                ))}
              </div>
            )}

            <ul className="mt-3">
              {limited.map((s) => {
                const on = !!selected.find((x) => x.id === s.id);
                return (
                  <li key={s.id}>
                    <button
                      onClick={() => toggleService(s)}
                      className={`w-full flex items-center gap-3 text-left px-3 py-2.5 rounded-xl text-sm transition ${on ? "bg-brand-blue/5" : "hover:bg-gray-50"}`}
                    >
                      <span
                        className={`w-5 h-5 rounded-full border flex items-center justify-center flex-shrink-0 text-[11px] ${
                          on ? "bg-brand-blue border-brand-blue text-white" : "border-gray-300 text-transparent"
                        }`}
                      >
                        ✓
                      </span>
                      <span className="flex-1 text-gray-900">{s.name}</span>
                      <span className="text-xs text-gray-400 whitespace-nowrap">≈ {formatDuration(s.duration_minutes)}</span>
                    </button>
                  </li>
                );
              })}
              {limited.length === 0 && <li className="text-sm text-gray-400 px-3 py-2">Ничего не найдено</li>}
            </ul>

            {!q && !category && filtered.length > COLLAPSED_COUNT && (
              <button onClick={() => setExpanded((v) => !v)} className="text-sm text-brand-blue font-medium mt-2 px-3">
                {expanded ? "Свернуть" : `Показать все (${filtered.length})`}
              </button>
            )}

            {hasServices && (
              <div className="mt-4 pt-4 border-t border-gray-100 flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="text-gray-500">
                  Выбрано: <b className="text-gray-800">{selected.length}</b>
                </span>
                <span className="text-gray-500">
                  Понадобится примерно: <b className="text-gray-800">{formatDuration(totalMinutes)}</b>
                </span>
              </div>
            )}
            {tooLong && (
              <p className="mt-3 text-xs text-red-500">Максимум {MAX_MINUTES / 60} часов за одну запись. Уберите часть работ и запишитесь на них отдельно.</p>
            )}
          </Card>

          {hasServices && !tooLong && (
            <>
              {/* 2. Автомобиль */}
              {cars.length > 0 && (
                <Card step={2} title="Автомобиль">
                  {cars.length === 1 ? (
                    <p className="text-sm text-gray-900">
                      {carLabel(cars[0])}
                      {plateOf(cars[0]) && <span className="ml-2 text-gray-400">{plateOf(cars[0])}</span>}
                    </p>
                  ) : (
                    <div className="grid sm:grid-cols-2 gap-2">
                      {cars.map((c) => (
                        <button
                          key={c.id}
                          onClick={() => setCarId(c.id)}
                          className={`text-left rounded-xl border px-4 py-3 text-sm transition ${
                            carId === c.id ? "border-brand-blue bg-brand-blue/5" : "border-gray-200 hover:border-gray-300"
                          }`}
                        >
                          <span className="block text-gray-900">{c.make} {c.model}</span>
                          <span className="block text-xs text-gray-400 mt-0.5">
                            {[c.color, plateOf(c)].filter(Boolean).join(" · ") || "—"}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </Card>
              )}

              {/* 3. Дата и время */}
              <Card step={cars.length > 0 ? 3 : 2} title="Дата и время">
                {!availLoaded ? (
                  <p className="text-sm text-gray-400">Загрузка свободных окон…</p>
                ) : (
                  <>
                    <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1 snap-x">
                      {dates.map((d, i) => {
                        const p = dayParts(d);
                        const ok = dayOk[d];
                        const active = selectedDate === d;
                        return (
                          <button
                            key={d}
                            disabled={!ok}
                            onClick={() => {
                              setSelectedDate(d);
                              setSelectedTime(null);
                            }}
                            className={`snap-start flex-shrink-0 w-[58px] rounded-xl border py-2 flex flex-col items-center transition ${
                              active
                                ? "bg-brand-blue border-brand-blue text-white"
                                : ok
                                ? "border-gray-200 text-gray-800 hover:border-brand-blue/50 bg-white"
                                : "border-transparent bg-gray-50 text-gray-300 cursor-not-allowed"
                            }`}
                          >
                            <span className="text-[10px] uppercase tracking-wide opacity-70">{i === 0 ? "сегодня" : p.wd}</span>
                            <span className="text-lg font-semibold leading-6">{p.num}</span>
                            <span className="text-[10px] opacity-70">{p.mon}</span>
                          </button>
                        );
                      })}
                    </div>

                    {workingPostsAll.length > 1 && (
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <span className="text-xs text-gray-500">Мастер:</span>
                        <button onClick={() => setPostId("")} className={`${chipBase} ${postId === "" ? chipOn : chipOff}`}>
                          Любой свободный
                        </button>
                        {workingPostsAll.map((p) => (
                          <button key={p.id} onClick={() => setPostId(p.id)} className={`${chipBase} ${postId === p.id ? chipOn : chipOff}`}>
                            {p.name}
                          </button>
                        ))}
                      </div>
                    )}

                    {!selectedDate ? (
                      <p className="text-sm text-gray-400 mt-4">В ближайшие {DAYS_AHEAD} дней нет свободных окон под ваши работы. Попробуйте уменьшить список или позвоните нам.</p>
                    ) : (
                      <div className="mt-4 space-y-4">
                        <p className="text-sm font-medium text-gray-800 capitalize">{longDay(selectedDate)}</p>
                        <div data-testid="time-grid" className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2">
                          {times.map((t) => (
                            <button
                              key={t}
                              onClick={() => setSelectedTime(t)}
                              className={`text-sm rounded-xl py-2 border transition ${
                                selectedTime === t
                                  ? "border-brand-yellow bg-brand-yellow text-brand-blue-dark font-semibold"
                                  : "border-gray-200 text-gray-800 hover:border-brand-blue/50 bg-white"
                              }`}
                            >
                              {t}
                            </button>
                          ))}
                        </div>
                        {spill && (
                          <div className="flex items-start gap-3 rounded-xl border border-brand-yellow bg-brand-yellow/20 px-4 py-3">
                            <span className="mt-0.5 w-5 h-5 rounded-full bg-brand-yellow text-brand-blue-dark text-xs font-bold flex items-center justify-center flex-shrink-0">
                              !
                            </span>
                            <div className="text-sm">
                              <p className="font-semibold text-gray-900">Работы продолжатся на следующий рабочий день</p>
                              <p className="text-xs text-gray-600 mt-0.5">
                                До конца этого дня всего не успеть: остальное доделаем утром следующего рабочего дня. Автомобиль придётся оставить у нас.
                              </p>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </Card>

              {/* 4. Комментарий и отправка */}
              <Card step={cars.length > 0 ? 4 : 3} title="Комментарий">
                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Например, прошу заранее оценить стоимость работ и заказать запасные части"
                  rows={3}
                  className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm resize-none focus:outline-none focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/15 transition"
                />

                {selectedDate && selectedTime && (
                  <dl className="mt-5 pt-4 border-t border-gray-100 grid gap-2 text-sm">
                    <div className="flex justify-between gap-4">
                      <dt className="text-gray-400">Когда</dt>
                      <dd className="text-gray-900 text-right capitalize">{longDay(selectedDate)}, {selectedTime}</dd>
                    </div>
                    <div className="flex justify-between gap-4">
                      <dt className="text-gray-400">Работы</dt>
                      <dd className="text-gray-900 text-right">{selected.map((s) => s.name).join(", ")}</dd>
                    </div>
                    {car && (
                      <div className="flex justify-between gap-4">
                        <dt className="text-gray-400">Автомобиль</dt>
                        <dd className="text-gray-900 text-right">{carLabel(car)}</dd>
                      </div>
                    )}
                    <div className="flex justify-between gap-4">
                      <dt className="text-gray-400">Время работ</dt>
                      <dd className="text-gray-900">≈ {formatDuration(totalMinutes)}</dd>
                    </div>
                  </dl>
                )}

                <button onClick={handleSubmit} disabled={busy} className={`${yellowBtn} w-full mt-5 disabled:opacity-60`}>
                  Записаться
                </button>
                {status && <p className="text-xs text-red-500 text-center mt-3">{status}</p>}
              </Card>
            </>
          )}
        </>
      )}
    </div>
  );
}
