import type { Metadata } from "next";
import Link from "next/link";
import HomeClient from "./HomeClient";
import { SERVICES } from "@/lib/seo";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

export default function HomePage() {
  return (
    <>
      <HomeClient />
      <section className="mx-auto mt-10 max-w-3xl border-t border-gray-200 px-4 pb-6 pt-6 text-sm text-gray-600">
        <h1 className="text-lg font-bold text-gray-900">СТО «Твоя Шина» в Ярославле: ремонт и обслуживание автомобилей</h1>
        <p className="mt-2 leading-relaxed">
          Автосервис на ул. Промышленной, 2к. Ремонтируем и обслуживаем легковые автомобили любых марок, в приоритете
          иномарки. Запись онлайн: выберите услугу, дату и время без звонков.
        </p>
        <h2 className="mt-4 font-semibold text-gray-900">Наши услуги</h2>
        <ul className="mt-2 grid gap-1 sm:grid-cols-2">
          {SERVICES.map((s) => (
            <li key={s.slug}>
              <Link href={`/uslugi/${s.slug}`} className="text-[#02167f] hover:underline">
                {s.name}
              </Link>
            </li>
          ))}
        </ul>
        <p className="mt-4">
          Телефон: <a href="tel:+74852664467" className="font-semibold text-[#02167f]">+7 (4852) 66-44-67</a>
        </p>
      </section>
    </>
  );
}
