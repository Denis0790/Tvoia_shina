"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getAvailabilityExcluding, getMyBookings, rescheduleMyBooking, type MyBookingItem, type PostAvailability } from "@/lib/api";
import { DAYS_AHEAD, addDays, dayParts, fitsInfo, formatDuration, longDay, mskToday } from "@/lib/bookingUtils";

const yellowBtn =
  "inline-flex items-center justify-center gap-2 bg-brand-yellow text-brand-blue-dark font-medium text-sm rounded-xl px-5 py-3 hover:brightness-95 transition";

function Card({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
      <h2 className="text-base font-semibold text-gray-900">{title}</h2>
      {hint && <p className="text-xs text-gray-500 mt-0.5">{hint}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export default function ReschedulePage() {
  const [state, setState] = useState<"loading" | "missing" | "ok">("loading");
  const [item, setItem] = useState<MyBookingItem | null>(null);
  const [avail, setAvail] = useState<Record<string, PostAvailability[]>>({});
  const [availLoaded, setAvailLoaded] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const dates = useMemo(() => {
    const t = mskToday();
    return Array.from({ length: DAYS_AHEAD }, (_, i) => addDays(t, i));
  }, []);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("id");
    getMyBookings().then((list) => {
      const found = list.find((b) => b.id === id) ?? null;
      setItem(found);
      setState(found ? "ok" : "missing");
    });
    Promise.all(dates.map((d) => getAvailabilityExcluding(d, id).catch(() => [] as PostAvailability[]))).then((res) => {
      const map: Record<string, PostAvailability[]> = {};
      dates.forEach((d, i) => (map[d] = res[i]));
      setAvail(map);
      setAvailLoaded(true);
    });
  }, [dates]);

  const need = Math.max(1, Math.ceil((item?.total_minutes ?? 30) / 30));

  function timesFor(date: string): string[] {
    const posts = (avail[date] ?? []).filter((p) => p.working);
    const all = Array.from(new Set(posts.flatMap((p) => p.slots.map((s) => s.time)))).sort();
    return all.filter((t) => posts.some((p) => fitsInfo(p, t, need)));
  }

  function spillAt(date: string, time: string) {
    const posts = (avail[date] ?? []).filter((p) => p.working);
    for (const p of posts) {
      const info = fitsInfo(p, time, need);
      if (info) return info.spill;
    }
    return false;
  }

  const dayOk = useMemo(() => {
    const m: Record<string, boolean> = {};
    for (const d of dates) m[d] = timesFor(d).length > 0;
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dates, avail, need]);

  useEffect(() => {
    if (!availLoaded || selectedDate) return;
    setSelectedDate(dates.find((d) => dayOk[d]) ?? null);
  }, [availLoaded, dayOk, dates, selectedDate]);

  const times = selectedDate ? timesFor(selectedDate) : [];
  const spill = selectedDate && selectedTime ? spillAt(selectedDate, selectedTime) : false;

  async function handleSubmit() {
    if (!item || !selectedDate || !selectedTime) return setError("Выберите дату и время");
    setError(null);
    setBusy(true);
    const r = await rescheduleMyBooking(item.id, selectedDate, selectedTime);
    setBusy(false);
    if (!r.ok) return setError(r.error || "Не удалось перенести запись");
    setDone(true);
  }

  return (
    <div className="-m-6 md:-m-10 p-6 md:p-10 md:rounded-[12px] bg-[#e8eaf0] min-h-[calc(100dvh-4rem)] md:min-h-[calc(100dvh-2rem)] space-y-4">
      <div>
        <h1 className="text-lg font-bold text-gray-900">Перенос записи</h1>
        <p className="text-xs text-gray-500 mt-0.5">Выберите новое время, работы и машина остаются прежними.</p>
      </div>

      {state === "loading" && <p className="text-sm text-gray-400">Загрузка…</p>}

      {state === "missing" && (
        <Card title="Запись не найдена">
          <p className="text-sm text-gray-600">Возможно, она уже выполнена или отменена.</p>
          <Link href="/" className={`${yellowBtn} mt-4`}>
            На главную
          </Link>
        </Card>
      )}

      {state === "ok" && item && done && (
        <Card title="Запись перенесена">
          <p className="text-sm text-gray-600">
            Новое время: <b className="text-gray-900 capitalize">{longDay(selectedDate ?? "")}, {selectedTime}</b>. Менеджер подтвердит его, статус появится на главной.
          </p>
          <Link href="/" className={`${yellowBtn} mt-4`}>
            На главную
          </Link>
        </Card>
      )}

      {state === "ok" && item && !done && (
        <>
          <Card title="Что переносим">
            <p className="text-sm font-medium text-gray-900 capitalize">
              {longDay(item.date)}, {item.start_time}
            </p>
            {item.services.length > 0 && <p className="text-sm text-gray-800 mt-1">{item.services.join(", ")}</p>}
            {item.car && <p className="text-xs text-gray-400 mt-0.5">{item.car}</p>}
            <p className="text-xs text-gray-500 mt-2">Время работ: ≈ {formatDuration(item.total_minutes)}</p>
            {item.status === "confirmed" && (
              <p className="text-xs text-gray-500 mt-2">После переноса запись снова будет ждать подтверждения менеджера.</p>
            )}
          </Card>

          <Card title="Новая дата и время">
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

                {!selectedDate ? (
                  <p className="text-sm text-gray-400 mt-4">В ближайшие {DAYS_AHEAD} дней нет свободных окон. Позвоните нам.</p>
                ) : (
                  <div className="mt-4 space-y-4">
                    <p className="text-sm font-medium text-gray-800 capitalize">{longDay(selectedDate)}</p>
                    <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2">
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

            <div className="flex flex-wrap gap-2 mt-5">
              <button onClick={handleSubmit} disabled={busy || !selectedTime} className={`${yellowBtn} disabled:opacity-50`}>
                Перенести
              </button>
              <Link
                href="/"
                className="inline-flex items-center justify-center bg-white border border-gray-200 text-gray-700 font-medium text-sm rounded-xl px-5 py-3 hover:bg-gray-50 transition"
              >
                Назад
              </Link>
            </div>
            {error && <p className="text-xs text-red-500 mt-3">{error}</p>}
          </Card>
        </>
      )}
    </div>
  );
}
