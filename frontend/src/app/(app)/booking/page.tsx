"use client";

import { useEffect, useState } from "react";
import {
  getServices,
  getAvailability,
  createBooking,
  getCars,
  type Service,
  type PostAvailability,
  type Car,
} from "@/lib/api";

function formatDuration(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h ? `${h} ч ` : ""}${m ? `${m} мин` : ""}`.trim();
}

function todayPlus(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export default function BookingPage() {
  const [allServices, setAllServices] = useState<Service[]>([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Service[]>([]);
  const [cars, setCars] = useState<Car[]>([]);
  const [carId, setCarId] = useState<string>("");
  const [comment, setComment] = useState("");
  const [dayOffset, setDayOffset] = useState(1);
  const [availability, setAvailability] = useState<PostAvailability[]>([]);
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    getServices().then(setAllServices);
    getCars().then(setCars);
  }, []);

  const targetDate = todayPlus(dayOffset);

  useEffect(() => {
    getAvailability(targetDate).then(setAvailability);
    setSelectedTime(null);
  }, [targetDate]);

  const totalMinutes = selected.reduce((s, x) => s + x.duration_minutes, 0);
  const neededSlots = Math.max(1, Math.ceil((totalMinutes || 30) / 30));

  const suggestions = query
    ? allServices.filter(
        (s) => s.name.toLowerCase().includes(query.toLowerCase()) && !selected.find((x) => x.id === s.id)
      ).slice(0, 5)
    : [];

  // Собираем единый список времён и помечаем "подходит", если хотя бы у одного
  // работающего поста достаточно свободных подряд слотов под нужную длительность.
  const timeSlots = (() => {
    const workingPosts = availability.filter((p) => p.working);
    if (workingPosts.length === 0) return [];
    const times = workingPosts[0].slots.map((s) => s.time);

    return times.map((time) => {
      const fits = workingPosts.some((post) => {
        const idx = post.slots.findIndex((s) => s.time === time);
        if (idx === -1) return false;
        for (let k = 0; k < neededSlots; k++) {
          const slot = post.slots[idx + k];
          if (!slot || !slot.free) return false;
        }
        return true;
      });
      return { time, fits };
    });
  })();

  function addService(s: Service) {
    setSelected([...selected, s]);
    setQuery("");
  }

  function removeService(id: string) {
    setSelected(selected.filter((s) => s.id !== id));
  }

  async function handleSubmit() {
    setStatus(null);
    if (selected.length === 0) {
      setStatus("Сначала выберите услугу");
      return;
    }
    if (!selectedTime) {
      setStatus("Выберите время в календаре");
      return;
    }
    const result = await createBooking({
      car_id: carId || null,
      date: targetDate,
      start_time: selectedTime,
      service_ids: selected.map((s) => s.id),
      comment: comment || null,
    });
    if (!result.ok) {
      setStatus(result.error || "Не удалось создать запись");
      return;
    }
    setStatus("Запись создана. Ожидайте подтверждения менеджера.");
    setSelected([]);
    setSelectedTime(null);
  }

  return (
    <div>
      <h1 className="text-xl font-semibold text-gray-900 mb-6">Запись на СТО</h1>

      <div className="bg-white rounded-2xl p-5 shadow-sm mb-5">
        <p className="text-xs text-gray-500 mb-2">Что нужно сделать с машиной?</p>
        <div className="relative">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Начните вводить услугу"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
          />
          {suggestions.length > 0 && (
            <div className="absolute z-10 left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-md overflow-hidden">
              {suggestions.map((s) => (
                <button
                  key={s.id}
                  onClick={() => addService(s)}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 border-b border-gray-100 last:border-0"
                >
                  {s.name} · {formatDuration(s.duration_minutes)}
                </button>
              ))}
            </div>
          )}
        </div>

        {selected.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-3">
            {selected.map((s) => (
              <span
                key={s.id}
                className="bg-brand-yellow text-brand-blue-dark text-xs rounded-full px-3 py-1 flex items-center gap-2"
              >
                {s.name}
                <button onClick={() => removeService(s.id)} className="font-bold">
                  ×
                </button>
              </span>
            ))}
          </div>
        )}

        {totalMinutes > 0 && (
          <p className="text-sm text-gray-500 mt-3">
            Понадобится примерно: <b className="text-gray-800">{formatDuration(totalMinutes)}</b>
          </p>
        )}

        {cars.length > 0 && (
          <div className="mt-4">
            <p className="text-xs text-gray-500 mb-2">Автомобиль</p>
            <select
              value={carId}
              onChange={(e) => setCarId(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
            >
              <option value="">Не выбрано</option>
              {cars.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.make} {c.model} {c.color ? `· ${c.color}` : ""}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="mt-4">
          <p className="text-xs text-gray-500 mb-2">Комментарий (по желанию)</p>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Например: постукивает спереди на кочках"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none"
            rows={2}
          />
        </div>
      </div>

      <div className="bg-white rounded-2xl p-5 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-medium text-gray-800">{targetDate}</span>
          <div className="flex gap-2">
            <button
              onClick={() => setDayOffset((d) => Math.max(0, d - 1))}
              className="w-7 h-7 rounded-lg bg-gray-100 text-gray-600"
            >
              ‹
            </button>
            <button
              onClick={() => setDayOffset((d) => d + 1)}
              className="w-7 h-7 rounded-lg bg-gray-100 text-gray-600"
            >
              ›
            </button>
          </div>
        </div>

        {timeSlots.length === 0 && (
          <p className="text-sm text-gray-400">На эту дату никто не работает</p>
        )}

        <div className="grid grid-cols-4 gap-2">
          {timeSlots.map(({ time, fits }) => (
            <button
              key={time}
              disabled={!fits}
              onClick={() => setSelectedTime(time)}
              className={`text-sm rounded-lg py-2 border ${
                selectedTime === time
                  ? "border-brand-blue border-2 bg-blue-50 text-brand-blue font-medium"
                  : fits
                  ? "border-gray-200 hover:border-gray-300"
                  : "border-dashed border-gray-100 text-gray-300 cursor-not-allowed"
              }`}
            >
              {time}
            </button>
          ))}
        </div>

        <button
          onClick={handleSubmit}
          className="w-full bg-brand-yellow text-brand-blue-dark font-medium text-sm rounded-lg py-3 mt-5"
        >
          Записаться
        </button>
        {status && <p className="text-xs text-gray-500 text-center mt-3">{status}</p>}
      </div>
    </div>
  );
}
