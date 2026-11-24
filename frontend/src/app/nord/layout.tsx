import type { Metadata } from "next";
import NordShell from "./NordShell";

// Свой манифест админки отдаём штатно, в самом HTML (а не подменяем скриптом после загрузки).
export const metadata: Metadata = {
  manifest: "/manifest-nord.json",
  robots: { index: false, follow: false },
};

export default function NordLayout({ children }: { children: React.ReactNode }) {
  return <NordShell>{children}</NordShell>;
}
