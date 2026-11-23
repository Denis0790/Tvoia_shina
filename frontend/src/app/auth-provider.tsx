"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { refreshAccessToken } from "@/lib/auth";

// Публичные страницы отдаём сразу (их читают поисковики), остальные ждём проверки входа.
const PUBLIC_PREFIXES = ["/uslugi", "/privacy", "/consent"];

export default function AuthProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const pathname = usePathname();
  const isPublic = PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  useEffect(() => {
    refreshAccessToken().finally(() => setReady(true));
  }, []);

  if (!ready && !isPublic) return null;
  return <>{children}</>;
}
