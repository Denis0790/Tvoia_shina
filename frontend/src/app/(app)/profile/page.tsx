"use client";

import { useEffect, useState } from "react";
import { getCars, createCar, deleteCar, type Car } from "@/lib/api";

export default function ProfilePage() {
  const [cars, setCars] = useState<Car[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ make: "", model: "", color: "" });

  function loadCars() {
    getCars().then((data) => {
      setCars(data);
      setLoading(false);
    });
  }

  useEffect(loadCars, []);

  async function handleAdd() {
    if (!form.make || !form.model) return;
    const car = await createCar({
      make: form.make,
      model: form.model,
      color: form.color || null,
      vin: null,
      plate: null,
    });
    if (car) {
      setForm({ make: "", model: "", color: "" });
      loadCars();
    }
  }

  async function handleDelete(id: string) {
    if (await deleteCar(id)) loadCars();
  }

  return (
    <div>
      <h1 className="text-xl font-semibold text-gray-900 mb-6">Профиль</h1>

      <div className="bg-white rounded-2xl p-5 shadow-sm mb-5">
        <p className="text-xs text-gray-500 mb-3">Мои автомобили</p>
        {loading && <p className="text-sm text-gray-400">Загрузка…</p>}
        {!loading && cars.length === 0 && (
          <p className="text-sm text-gray-400">Пока нет добавленных машин</p>
        )}
        <div className="flex flex-col gap-2">
          {cars.map((c) => (
            <div
              key={c.id}
              className="flex items-center justify-between border border-gray-100 rounded-lg px-3 py-2"
            >
              <span className="text-sm text-gray-800">
                {c.make} {c.model} {c.color ? `· ${c.color}` : ""}
              </span>
              <button
                onClick={() => handleDelete(c.id)}
                className="text-xs text-red-500 hover:underline"
              >
                Удалить
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-2xl p-5 shadow-sm">
        <p className="text-xs text-gray-500 mb-3">Добавить автомобиль</p>
        <div className="flex flex-col gap-2">
          <input
            placeholder="Марка (Kia)"
            value={form.make}
            onChange={(e) => setForm({ ...form, make: e.target.value })}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
          />
          <input
            placeholder="Модель (Rio 3)"
            value={form.model}
            onChange={(e) => setForm({ ...form, model: e.target.value })}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
          />
          <input
            placeholder="Цвет (необязательно)"
            value={form.color}
            onChange={(e) => setForm({ ...form, color: e.target.value })}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
          />
          <button
            onClick={handleAdd}
            className="bg-brand-yellow text-brand-blue-dark font-medium text-sm rounded-lg px-3 py-2 mt-1"
          >
            Добавить
          </button>
        </div>
      </div>
    </div>
  );
}
