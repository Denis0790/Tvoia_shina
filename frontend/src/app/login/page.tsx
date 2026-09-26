"use client";

import { useState } from "react";
import { requestCode, verifyCode, managerLogin } from "@/lib/api";
import { setAccessToken } from "@/lib/auth";
import PhoneInput from "@/components/PhoneInput";

export default function LoginPage() {
  const [mode, setMode] = useState<"client" | "manager">("client");

  const [step, setStep] = useState<"phone" | "code">("phone");
  const [phoneDigits, setPhoneDigits] = useState("");
  const [code, setCode] = useState("");
  const [debugCode, setDebugCode] = useState("");

  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");

  const [error, setError] = useState("");

  const fullPhone = `+7${phoneDigits}`;

  async function handleRequestCode() {
    setError("");
    try {
      const data = await requestCode(fullPhone);
      setDebugCode(data.debug_code);
      setStep("code");
    } catch {
      setError("Не удалось отправить код, проверьте номер");
    }
  }

  async function handleVerifyCode() {
    setError("");
    try {
      const data = await verifyCode(fullPhone, code);
      setAccessToken(data.access_token);
      window.location.href = "/";
    } catch {
      setError("Неверный код");
    }
  }

  async function handleManagerLogin() {
    setError("");
    try {
      const data = await managerLogin(login, password);
      setAccessToken(data.access_token);
      window.location.href = "/nord";
    } catch {
      setError("Неверный логин или пароль");
    }
  }

  return (
    <main className="min-h-screen w-full bg-brand-blue flex items-center justify-center p-6">
      <div className="w-full max-w-sm bg-white rounded-2xl p-6 shadow-lg">
        <h1 className="text-lg font-semibold text-gray-900 mb-1">Твоя Шина</h1>
        <p className="text-sm text-gray-500 mb-5">Вход в аккаунт</p>

        <div className="flex gap-1 bg-gray-100 rounded-lg p-1 mb-5">
          <button
            onClick={() => setMode("client")}
            className={`flex-1 text-sm py-1.5 rounded-md ${
              mode === "client" ? "bg-white shadow-sm font-medium text-gray-900" : "text-gray-500"
            }`}
          >
            Клиент
          </button>
          <button
            onClick={() => setMode("manager")}
            className={`flex-1 text-sm py-1.5 rounded-md ${
              mode === "manager" ? "bg-white shadow-sm font-medium text-gray-900" : "text-gray-500"
            }`}
          >
            Сотрудник
          </button>
        </div>

        {mode === "client" && step === "phone" && (
          <>
            <PhoneInput
              value={phoneDigits}
              onChange={setPhoneDigits}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mb-3 tracking-wide"
            />
            <button
              onClick={handleRequestCode}
              className="w-full bg-brand-yellow text-brand-blue-dark font-medium text-sm rounded-lg py-2.5"
            >
              Получить код
            </button>
          </>
        )}

        {mode === "client" && step === "code" && (
          <>
            <p className="text-xs text-gray-400 mb-2">Тестовый режим: код — {debugCode}</p>
            <input
              placeholder="Код из SMS"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mb-3"
            />
            <button
              onClick={handleVerifyCode}
              className="w-full bg-brand-yellow text-brand-blue-dark font-medium text-sm rounded-lg py-2.5"
            >
              Войти
            </button>
          </>
        )}

        {mode === "manager" && (
          <>
            <input
              placeholder="Логин"
              value={login}
              onChange={(e) => setLogin(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mb-3"
            />
            <input
              placeholder="Пароль"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mb-3"
            />
            <button
              onClick={handleManagerLogin}
              className="w-full bg-brand-yellow text-brand-blue-dark font-medium text-sm rounded-lg py-2.5"
            >
              Войти
            </button>
          </>
        )}

        {error && <p className="text-xs text-red-500 mt-3 text-center">{error}</p>}
      </div>
    </main>
  );
}
