"use client";

import { useState } from "react";
import { requestCode, verifyCode } from "@/lib/api";

export default function LoginPage() {
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [debugCode, setDebugCode] = useState("");
  const [error, setError] = useState("");

  async function handleRequestCode() {
    setError("");
    try {
      const data = await requestCode(phone);
      setDebugCode(data.debug_code);
      setStep("code");
    } catch {
      setError("Не удалось отправить код, проверьте номер");
    }
  }

  async function handleVerifyCode() {
    setError("");
    try {
      const data = await verifyCode(phone, code);
      localStorage.setItem("access_token", data.access_token);
      window.location.href = "/";
    } catch {
      setError("Неверный код");
    }
  }

  return (
    <main style={{ padding: 40, maxWidth: 320, fontFamily: "sans-serif" }}>
      <h1>Вход</h1>
      {step === "phone" && (
        <>
          <input
            placeholder="+7 999 123-45-67"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            style={{ display: "block", width: "100%", padding: 8, marginBottom: 12 }}
          />
          <button onClick={handleRequestCode}>Получить код</button>
        </>
      )}
      {step === "code" && (
        <>
          <p style={{ fontSize: 12, color: "gray" }}>
            Тестовый режим: код для отладки — {debugCode}
          </p>
          <input
            placeholder="Код из SMS"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            style={{ display: "block", width: "100%", padding: 8, marginBottom: 12 }}
          />
          <button onClick={handleVerifyCode}>Войти</button>
        </>
      )}
      {error && <p style={{ color: "red" }}>{error}</p>}
    </main>
  );
}
