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

const EMPTY = { make: "", model: "", color: "", plate: "", vin: "" };

function formatHistoryDay(iso: string) {
  return new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
}

function Card({
  title,
  hint,
  action,
  children,
}: {
  title: string;
  hint?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-gray-900 leading-9">{title}</h2>
          {hint && <p className="text-xs text-gray-500 -mt-1">{hint}</p>}
        </div>
        {action}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export default function ProfilePage() {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [nameSaved, setNameSaved] = useState(true);
  const [nameLoading, setNameLoading] = useState(true);
  const [nameSaving, setNameSaving] = useState(false);

  const [cars, setCars] = useState<Car[]>([]);
  const [carsLoading, setCarsLoading] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [history, setHistory] = useState<Record<string, HistoryItem[]>>({});

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [formError, setFormError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const active = cars.find((c) => c.id === activeId) ?? cars[0] ?? null;

  function loadCars(selectId?: string) {
    getCars().then((data) => {
      setCars(data);
      if (selectId) setActiveId(selectId);
      setCarsLoading(false);
    });
  }

  useEffect(() => loadCars(), []);

  useEffect(() => {
    getMe().then((me) => {
      setName(me?.full_name || "");
      setPhone((me as { phone?: string | null } | null)?.phone ?? null);
      setEmail(me?.email ?? null);
      setNameLoading(false);
    });
  }, []);

  // история активной машины загружается сразу при переключении
  useEffect(() => {
    if (!active || history[active.id] !== undefined) return;
    const id = active.id;
    getCarHistory(id).then((list) => setHistory((h) => ({ ...h, [id]: list })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id]);

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
    loadCars(car.id);
  }

  async function handleDelete(id: string) {
    if (await deleteCar(id)) {
      setActiveId(null);
      loadCars();
    }
    setConfirmDelete(false);
  }

  async function handleLogout() {
    await logout();
    setAccessToken(null);
    window.location.href = "/";
  }

  const items = active ? history[active.id] : undefined;

  return (
    <div className="-m-6 md:-m-10 p-6 md:p-10 md:rounded-[12px] bg-[#e8eaf0] min-h-[calc(100dvh-4rem)] md:min-h-[calc(100dvh-2rem)] space-y-4">
      <div>
        <h1 className="text-lg font-bold text-gray-900">Профиль</h1>
        <p className="text-xs text-gray-500 mt-0.5">Ваши данные и автомобили. Они подставляются в запись автоматически.</p>
      </div>

      <Card title="О вас" hint="Имя необязательно, но помогает нам быстрее вас узнавать.">
        {nameLoading ? (
          <p className="text-sm text-gray-400">Загрузка…</p>
        ) : (
          <>
            {email && (
              <p className="text-sm text-gray-500 mb-1">
                Почта: <span className="text-gray-900 break-all">{email}</span>
              </p>
            )}
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

      <Card
        title="История обслуживания"
        action={
          <button onClick={openAdd} className={`${yellowBtn} !py-2 whitespace-nowrap`}>
            Добавить авто
          </button>
        }
      >
        {formOpen && (
          <div className="mb-5 pb-5 border-b border-gray-100">
            <p className="text-sm font-medium text-gray-900 mb-3">{editingId ? "Изменить автомобиль" : "Новый автомобиль"}</p>
            <div className="grid sm:grid-cols-2 gap-2">
              <input placeholder="Марка (Kia)" value={form.make} onChange={(e) => setForm({ ...form, make: e.target.value })} className={inputCls} />
              <input placeholder="Модель (Rio)" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} className={inputCls} />
              <input placeholder="Цвет" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} className={inputCls} />
              <input placeholder="Госномер" value={form.plate} onChange={(e) => setForm({ ...form, plate: e.target.value })} className={`${inputCls} uppercase`} />
              <input placeholder="VIN" value={form.vin} onChange={(e) => setForm({ ...form, vin: e.target.value })} className={`${inputCls} uppercase sm:col-span-2`} />
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
        )}

        {carsLoading && <p className="text-sm text-gray-400">Загрузка…</p>}
        {!carsLoading && cars.length === 0 && !formOpen && (
          <p className="text-sm text-gray-400">Добавьте автомобиль, и здесь появится история его обслуживания.</p>
        )}

        {cars.length > 1 && (
          <div className="flex gap-2 overflow-x-auto pb-3 -mx-1 px-1">
            {cars.map((c) => {
              const on = c.id === active?.id;
              return (
                <button
                  key={c.id}
                  onClick={() => {
                    setActiveId(c.id);
                    setConfirmDelete(false);
                  }}
                  className={`flex-shrink-0 text-sm rounded-full px-4 py-1.5 border transition ${
                    on
                      ? "bg-brand-yellow border-brand-yellow text-brand-blue-dark font-semibold"
                      : "bg-white border-gray-200 text-gray-600 hover:border-gray-300"
                  }`}
                >
                  {c.make} {c.model}
                </button>
              );
            })}
          </div>
        )}

        {active && (
          <div className="rounded-xl bg-brand-blue/5 px-4 py-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-base font-semibold text-gray-900">
                  {active.make} {active.model}
                  {active.plate && <span className="ml-2 font-medium text-gray-500">{active.plate}</span>}
                </p>
                {(active.color || active.vin) && (
                  <p className="text-xs text-gray-500 mt-0.5 break-all">
                    {[active.color, active.vin ? `VIN ${active.vin}` : null].filter(Boolean).join(" · ")}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0 text-xs">
                {confirmDelete ? (
                  <>
                    <button onClick={() => handleDelete(active.id)} className="font-medium text-red-600 px-2 py-1">
                      Удалить
                    </button>
                    <button onClick={() => setConfirmDelete(false)} className="text-gray-500 px-2 py-1">
                      Нет
                    </button>
                  </>
                ) : (
                  <>
                    <button onClick={() => openEdit(active)} className="text-brand-blue font-medium px-2 py-1">
                      Изменить
                    </button>
                    <button onClick={() => setConfirmDelete(true)} className="text-gray-400 hover:text-red-600 px-2 py-1">
                      Удалить
                    </button>
                  </>
                )}
              </div>
            </div>

            <div className="mt-4 pt-4 border-t border-brand-blue/10">
              {items === undefined ? (
                <p className="text-xs text-gray-400">Загрузка…</p>
              ) : items.length === 0 ? (
                <p className="text-sm text-gray-400">Обслуживаний пока не было</p>
              ) : (
                <ul className="space-y-3">
                  {items.map((h) => (
                    <li key={h.id}>
                      <p className="text-sm font-medium text-gray-900">{formatHistoryDay(h.date)}</p>
                      {h.services.length > 0 && <p className="text-sm text-gray-600 mt-0.5">{h.services.join(", ")}</p>}
                      {h.comment && <p className="text-xs text-gray-400 mt-0.5">{h.comment}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
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
