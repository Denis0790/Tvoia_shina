"use client";

import { useEffect, useState } from "react";
import { getCars, createCar, updateCar, deleteCar, getMe, updateMyName, logout, getCarHistory, type Car, type HistoryItem } from "@/lib/api";
import { setAccessToken } from "@/lib/auth";

const inputCls =
  "w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm bg-white focus:outline-none focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/15 transition";
const yellowBtn =
  "inline-flex items-center justify-center bg-brand-yellow text-brand-blue-dark font-medium text-sm rounded-xl px-5 py-2.5 hover:brightness-95 transition disabled:opacity-40";
const outlineBtn =
  "inline-flex items-center justify-center bg-white border border-gray-200 text-gray-700 font-medium text-sm rounded-xl px-5 py-2.5 hover:bg-gray-50 transition";

function formatHistoryDay(iso: string) {
  return new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
}

const EMPTY = { make: "", model: "", color: "", plate: "", vin: "" };

function Card({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
      <h2 className="text-base font-semibold text-gray-900">{title}</h2>
      {hint && <p className="text-xs text-gray-500 mt-0.5">{hint}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export default function ProfilePage() {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState<string | null>(null);
  const [nameSaved, setNameSaved] = useState(true);
  const [nameLoading, setNameLoading] = useState(true);
  const [nameSaving, setNameSaving] = useState(false);

  const [cars, setCars] = useState<Car[]>([]);
  const [carsLoading, setCarsLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [formError, setFormError] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [openCarId, setOpenCarId] = useState<string | null>(null);
  const [history, setHistory] = useState<Record<string, HistoryItem[]>>({});

  function loadCars() {
    getCars().then((data) => {
      setCars(data);
      setCarsLoading(false);
    });
  }

  useEffect(loadCars, []);

  useEffect(() => {
    getMe().then((me) => {
      setName(me?.full_name || "");
      setPhone((me as { phone?: string | null } | null)?.phone ?? null);
      setNameLoading(false);
    });
  }, []);

  async function handleSaveName() {
    setNameSaving(true);
    const ok = await updateMyName(name);
    setNameSaving(false);
    setNameSaved(ok);
  }

  function openAdd() {
    setEditingId(null);
    setForm(EMPTY);
    setFormError("");
    setFormOpen(true);
  }

  function openEdit(c: Car) {
    setEditingId(c.id);
    setForm({ make: c.make, model: c.model, color: c.color ?? "", plate: c.plate ?? "", vin: c.vin ?? "" });
    setFormError("");
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setEditingId(null);
    setFormError("");
  }

  async function handleSaveCar() {
    if (!form.make.trim() || !form.model.trim()) {
      setFormError("Укажите марку и модель");
      return;
    }
    const payload = {
      make: form.make.trim(),
      model: form.model.trim(),
      color: form.color.trim() || null,
      plate: form.plate.trim().toUpperCase() || null,
      vin: form.vin.trim().toUpperCase() || null,
    };
    const car = editingId ? await updateCar(editingId, payload) : await createCar(payload);
    if (!car) {
      setFormError("Не удалось сохранить автомобиль");
      return;
    }
    closeForm();
    loadCars();
  }

  function toggleCar(id: string) {
    if (openCarId === id) {
      setOpenCarId(null);
      return;
    }
    setOpenCarId(id);
    if (history[id] === undefined) getCarHistory(id).then((list) => setHistory((h) => ({ ...h, [id]: list })));
  }

  async function handleDelete(id: string) {
    if (await deleteCar(id)) loadCars();
    setDeleteId(null);
  }

  async function handleLogout() {
    await logout();
    setAccessToken(null);
    window.location.href = "/";
  }

  return (
    <div className="rounded-3xl bg-gradient-to-b from-brand-blue/10 via-brand-blue/5 to-white p-4 sm:p-6 space-y-4">
      <div>
        <h1 className="text-lg font-bold text-gray-900">Профиль</h1>
        <p className="text-xs text-gray-500 mt-0.5">Ваши данные и автомобили. Они подставляются в запись автоматически.</p>
      </div>

      <Card title="О вас" hint="Имя необязательно, но помогает нам быстрее вас узнавать.">
        {nameLoading ? (
          <p className="text-sm text-gray-400">Загрузка…</p>
        ) : (
          <>
            {phone && (
              <p className="text-sm text-gray-500 mb-3">
                Телефон: <span className="text-gray-900">{phone}</span>
              </p>
            )}
            <div className="flex gap-2">
              <input
                placeholder="Как к вам обращаться"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setNameSaved(false);
                }}
                className={inputCls}
              />
              <button onClick={handleSaveName} disabled={nameSaving || nameSaved} className={`${yellowBtn} whitespace-nowrap`}>
                {nameSaved ? "Сохранено" : "Сохранить"}
              </button>
            </div>
          </>
        )}
      </Card>

      <Card title="Мои автомобили" hint="Нажмите на автомобиль, чтобы посмотреть историю обслуживания.">
        {carsLoading && <p className="text-sm text-gray-400">Загрузка…</p>}
        {!carsLoading && cars.length === 0 && !formOpen && (
          <p className="text-sm text-gray-400">Пока нет добавленных машин</p>
        )}

        <ul className="space-y-2">
          {cars.map((c) => (
            <li key={c.id} onClick={() => toggleCar(c.id)} className="rounded-xl bg-brand-blue/5 px-4 py-3 cursor-pointer">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900">
                    {c.make} {c.model}
                    {c.color ? <span className="text-gray-400 font-normal"> · {c.color}</span> : null}
                  </p>
                  {(c.plate || c.vin) && (
                    <p className="text-xs text-gray-500 mt-0.5 break-all">
                      {[c.plate, c.vin ? `VIN ${c.vin}` : null].filter(Boolean).join(" · ")}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0 text-xs" onClick={(e) => e.stopPropagation()}>
                  {deleteId === c.id ? (
                    <>
                      <button onClick={() => handleDelete(c.id)} className="font-medium text-red-600 px-2 py-1">
                        Удалить
                      </button>
                      <button onClick={() => setDeleteId(null)} className="text-gray-500 px-2 py-1">
                        Нет
                      </button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => openEdit(c)} className="text-brand-blue font-medium px-2 py-1">
                        Изменить
                      </button>
                      <button onClick={() => setDeleteId(c.id)} className="text-gray-400 hover:text-red-600 px-2 py-1">
                        Удалить
                      </button>
                    </>
                  )}
                </div>
              </div>
              {openCarId === c.id && (
                <div className="mt-3 pt-3 border-t border-brand-blue/10 cursor-default" onClick={(e) => e.stopPropagation()}>
                  <p className="text-xs font-semibold text-gray-500 mb-2">История обслуживания</p>
                  {history[c.id] === undefined ? (
                    <p className="text-xs text-gray-400">Загрузка…</p>
                  ) : history[c.id].length === 0 ? (
                    <p className="text-xs text-gray-400">Обслуживаний пока не было</p>
                  ) : (
                    <ul className="space-y-2.5">
                      {history[c.id].map((h) => (
                        <li key={h.id} className="text-sm">
                          <p className="text-gray-900">{formatHistoryDay(h.date)}</p>
                          {h.services.length > 0 && <p className="text-gray-600">{h.services.join(", ")}</p>}
                          {h.comment && <p className="text-xs text-gray-400">{h.comment}</p>}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>

        {formOpen ? (
          <div className="mt-4 pt-4 border-t border-gray-100">
            <p className="text-sm font-medium text-gray-900 mb-3">{editingId ? "Изменить автомобиль" : "Новый автомобиль"}</p>
            <div className="grid sm:grid-cols-2 gap-2">
              <input placeholder="Марка (Kia)" value={form.make} onChange={(e) => setForm({ ...form, make: e.target.value })} className={inputCls} />
              <input placeholder="Модель (Rio)" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} className={inputCls} />
              <input placeholder="Цвет" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} className={inputCls} />
              <input placeholder="Госномер" value={form.plate} onChange={(e) => setForm({ ...form, plate: e.target.value })} className={`${inputCls} uppercase`} />
              <input placeholder="VIN (по желанию)" value={form.vin} onChange={(e) => setForm({ ...form, vin: e.target.value })} className={`${inputCls} uppercase sm:col-span-2`} />
            </div>
            {formError && <p className="text-xs text-red-500 mt-2">{formError}</p>}
            <div className="flex gap-2 mt-3">
              <button onClick={handleSaveCar} className={yellowBtn}>
                {editingId ? "Сохранить" : "Добавить"}
              </button>
              <button onClick={closeForm} className={outlineBtn}>
                Отмена
              </button>
            </div>
          </div>
        ) : (
          <button onClick={openAdd} className={`${outlineBtn} mt-4`}>
            Добавить автомобиль
          </button>
        )}
      </Card>

      <div className="pt-1">
        <button onClick={handleLogout} className="text-sm text-gray-500 hover:text-red-600 transition px-1">
          Выйти из аккаунта
        </button>
      </div>
    </div>
  );
}
