"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { refreshManagerAccessToken } from "@/lib/managerAuth";

// Менеджер на этом устройстве открывает главную — сразу ведём в админку.
export default function ManagerRedirect() {
  const pathname = usePathname();
  useEffect(() => {
    if (pathname !== "/") return;
    try {
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
