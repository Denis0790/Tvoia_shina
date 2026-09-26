"use client";

import { useState } from "react";
import { login, requestCode, verifyCode, setPassword } from "@/lib/api";
import { setAccessToken } from "@/lib/auth";
import PhoneInput from "@/components/PhoneInput";

type Screen = "login" | "code" | "newPassword";

export default function LoginPage() {
  const [screen, setScreen] = useState<Screen>("login");
  const [phoneDigits, setPhoneDigits] = useState("");
  const [password, setPassword_] = useState("");

  const [code, setCode] = useState("");
  const [debugCode, setDebugCode] = useState("");
  const [ticket, setTicket] = useState("");

  const [newPassword, setNewPassword] = useState("");
  const [newPassword2, setNewPassword2] = useState("");

  const [error, setError] = useState("");
  const [notFound, setNotFound] = useState(false);

  const fullPhone = `+7${phoneDigits}`;

  async function handleLogin() {
    setError("");
    setNotFound(false);
    try {
      const data = await login(fullPhone, password);
      setAccessToken(data.access_token);
      window.location.href = "/";
    } catch (e: unknown) {
      const err = e as { status?: number; detail?: string };
      if (err.status === 404) {
        setNotFound(true);
        setError("Аккаунт с таким номером не найден");
      } else {
        setError(err.detail || "Неверный пароль");
      }
    }
  }

  async function handleSendCode() {
    setError("");
    try {
      const data = await requestCode(fullPhone);
      setDebugCode(data.debug_code);
      setScreen("code");
    } catch (e: unknown) {
      const err = e as Error;
      setError(err.message || "Не удалось отправить код, проверьте номер");
    }
  }

  async function handleVerifyCode() {
    setError("");
    try {
      const data = await verifyCode(fullPhone, code);
      setTicket(data.ticket);
      setScreen("newPassword");
    } catch {
      setError("Неверный код");
    }
  }

  async function handleSetPassword() {
    setError("");
    if (newPassword.length < 4) {
      setError("Пароль должен быть не короче 4 символов");
      return;
    }
    if (newPassword !== newPassword2) {
      setError("Пароли не совпадают");
      return;
    }
    try {
      const data = await setPassword(ticket, newPassword);
      setAccessToken(data.access_token);
      window.location.href = "/";
    } catch (e: unknown) {
      const err = e as Error;
      setError(err.message || "Не удалось сохранить пароль");
    }
  }

  return (
    <main className="min-h-screen w-full bg-brand-blue flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-white rounded-3xl p-8 md:p-10 shadow-xl">
        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-xl bg-brand-yellow flex items-center justify-center text-brand-blue-dark font-bold text-lg">
            Т
          </div>
          <span className="text-lg font-semibold text-gray-900">Твоя Шина</span>
        </div>

        {screen === "login" && (
          <>
            <h1 className="text-xl font-semibold text-gray-900 mb-1">Вход</h1>
            <p className="text-sm text-gray-500 mb-6">Введите номер телефона и пароль</p>

            <p className="text-xs text-gray-500 mb-1.5">Телефон</p>
            <PhoneInput
              value={phoneDigits}
              onChange={setPhoneDigits}
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm mb-4 tracking-wide"
            />

            <p className="text-xs text-gray-500 mb-1.5">Пароль</p>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword_(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm mb-5"
            />

            <button
              onClick={handleLogin}
              className="w-full bg-brand-yellow text-brand-blue-dark font-semibold text-sm rounded-xl py-3.5"
            >
              Войти
            </button>

            {error && <p className="text-xs text-red-500 mt-3 text-center">{error}</p>}

            <div className="flex items-center justify-between mt-5 text-xs">
              {notFound ? (
                <button onClick={handleSendCode} className="text-brand-blue font-medium mx-auto">
                  Зарегистрироваться
                </button>
              ) : (
                <button onClick={handleSendCode} className="text-gray-400 hover:text-gray-600 mx-auto">
                  Забыли пароль?
                </button>
              )}
            </div>
          </>
        )}

        {screen === "code" && (
          <>
            <h1 className="text-xl font-semibold text-gray-900 mb-1">Подтверждение</h1>
            <p className="text-sm text-gray-500 mb-1">Мы отправили код на {fullPhone}</p>
            <p className="text-xs text-gray-400 mb-6">Тестовый режим: код — {debugCode}</p>

            <input
              placeholder="Код из SMS"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm mb-5 text-center tracking-widest text-lg"
            />

            <button
              onClick={handleVerifyCode}
              className="w-full bg-brand-yellow text-brand-blue-dark font-semibold text-sm rounded-xl py-3.5"
            >
              Подтвердить
            </button>

            {error && <p className="text-xs text-red-500 mt-3 text-center">{error}</p>}

            <button
              onClick={() => setScreen("login")}
              className="text-xs text-gray-400 hover:text-gray-600 mt-5 block mx-auto"
            >
              Назад
            </button>
          </>
        )}

        {screen === "newPassword" && (
          <>
            <h1 className="text-xl font-semibold text-gray-900 mb-1">Придумайте пароль</h1>
            <p className="text-sm text-gray-500 mb-6">Номер подтверждён, осталось задать пароль</p>

            <p className="text-xs text-gray-500 mb-1.5">Новый пароль</p>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm mb-4"
            />

            <p className="text-xs text-gray-500 mb-1.5">Повторите пароль</p>
            <input
              type="password"
              value={newPassword2}
              onChange={(e) => setNewPassword2(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm mb-5"
            />

            <button
              onClick={handleSetPassword}
              className="w-full bg-brand-yellow text-brand-blue-dark font-semibold text-sm rounded-xl py-3.5"
            >
              Готово
            </button>

            {error && <p className="text-xs text-red-500 mt-3 text-center">{error}</p>}
          </>
        )}
      </div>
    </main>
  );
}
