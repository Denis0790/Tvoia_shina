"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { refreshManagerAccessToken } from "@/lib/managerAuth";

// Менеджер на этом устройстве открывает главную — сразу ведём в админку.
// Вкладка «Как у клиента» (?preview) остаётся клиентским видом.
export default function ManagerRedirect() {
  const pathname = usePathname();
  useEffect(() => {
    if (pathname !== "/") return;
    try {
      if (new URLSearchParams(window.location.search).has("preview")) sessionStorage.setItem("mgr_preview", "1");
      if (sessionStorage.getItem("mgr_preview") === "1") return;
      if (localStorage.getItem("mgr_session") !== "1") return;
    } catch {
      return;
    }
    refreshManagerAccessToken().then((t) => {
      if (t) window.location.replace("/nord");
    });
  }, [pathname]);
  return null;
}
