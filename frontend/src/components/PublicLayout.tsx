import Link from "next/link";
import LegalFooter from "@/components/LegalFooter";

// Обёртка публичных (серверных) страниц: видна без входа, индексируется поисковиками.
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <header className="bg-[#02167f] text-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <Link href="/" className="text-lg font-bold">
            СТО «Твоя Шина»
          </Link>
          <Link
            href="/booking"
            className="rounded-lg bg-[#FEC600] px-4 py-2 text-sm font-semibold text-[#02167f]"
          >
            Записаться
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-8">{children}</main>
      <div className="mx-auto max-w-3xl px-4 pb-8">
        <LegalFooter />
      </div>
    </div>
  );
}
