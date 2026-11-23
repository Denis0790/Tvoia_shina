import type { Metadata } from "next";
import Link from "next/link";
import PublicLayout from "@/components/PublicLayout";
import { SERVICES } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Услуги автосервиса в Ярославле",
  description:
    "Услуги СТО «Твоя Шина» в Ярославле: замена масла, ремонт подвески и тормозов, ремонт двигателя, замена ГРМ, сход-развал, подбор запчастей. Запись онлайн.",
  alternates: { canonical: "/uslugi" },
};

export default function ServicesIndexPage() {
  return (
    <PublicLayout>
      <nav className="mb-4 text-sm text-gray-500">
        <Link href="/" className="hover:underline">Главная</Link>
        {" / "}
        <span>Услуги</span>
      </nav>

      <h1 className="text-2xl font-bold text-[#02167f] sm:text-3xl">Услуги автосервиса в Ярославле</h1>
      <p className="mt-3 text-base leading-relaxed text-gray-700">
        СТО «Твоя Шина» ремонтирует и обслуживает легковые автомобили любых марок, в приоритете иномарки.
        Выберите услугу, чтобы узнать подробности, или сразу запишитесь онлайн на удобное время.
      </p>

      <ul className="mt-6 grid gap-3 sm:grid-cols-2">
        {SERVICES.map((s) => (
          <li key={s.slug}>
            <Link
              href={`/uslugi/${s.slug}`}
              className="block h-full rounded-xl bg-white p-4 shadow-sm transition hover:shadow-md"
            >
              <h2 className="font-semibold text-[#02167f]">{s.name}</h2>
              <p className="mt-1 text-sm text-gray-600">{s.description}</p>
            </Link>
          </li>
        ))}
      </ul>

      <Link
        href="/booking"
        className="mt-8 inline-block rounded-lg bg-[#02167f] px-6 py-3 font-semibold text-white"
      >
        Записаться онлайн
      </Link>
    </PublicLayout>
  );
}
