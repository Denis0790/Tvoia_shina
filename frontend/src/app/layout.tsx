import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import AuthProvider from "./auth-provider";
import PwaRegister from "./pwa-register";
import CookieNotice from "@/components/CookieNotice";
import InstallPrompt from "@/components/InstallPrompt";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const SITE_URL = "https://sto-tyre4u.ru";
const DESCRIPTION =
  "Автосервис «Твоя Шина» в Ярославле (ул. Промышленная, 2к): замена масла, ремонт двигателя и подвески, техническое обслуживание, заказ и подбор запчастей. Онлайн-запись на сайте.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "СТО «Твоя Шина» в Ярославле — автосервис, ремонт и обслуживание авто",
    template: "%s — СТО «Твоя Шина», Ярославль",
  },
  description: DESCRIPTION,
  applicationName: "СТО Твоя Шина",
  keywords: [
    "СТО Ярославль",
    "автосервис Ярославль",
    "Твоя Шина",
    "СТО Твоя Шина",
    "замена масла Ярославль",
    "ремонт двигателя",
    "ремонт подвески",
    "обслуживание автомобилей",
    "техническое обслуживание",
    "запчасти для авто",
    "запись на СТО онлайн",
  ],
  openGraph: {
    type: "website",
    locale: "ru_RU",
    url: "/",
    siteName: "СТО «Твоя Шина»",
    title: "СТО «Твоя Шина» в Ярославле",
    description: DESCRIPTION,
    images: [{ url: "/icon-512.png", width: 512, height: 512, alt: "СТО Твоя Шина" }],
  },
  verification: { yandex: "48e08926b7ceb8ba", google: "Ze_XqhOYWuVCpm9DOVHjUzD1IHwC9iuPzm8M2YZZY7M" },
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
  appleWebApp: { capable: true, title: "Твоя Шина", statusBarStyle: "default" },
};

export const viewport = {
  themeColor: "#02167f",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="ru"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <AuthProvider>{children}
        <CookieNotice />
        <InstallPrompt /></AuthProvider>
        <PwaRegister />
      </body>
    </html>
  );
}
