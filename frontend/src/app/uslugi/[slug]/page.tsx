import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import PublicLayout from "@/components/PublicLayout";
import { SERVICES } from "@/lib/seo";

type Props = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return SERVICES.map((s) => ({ slug: s.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const s = SERVICES.find((x) => x.slug === slug);
  if (!s) return {};
  return {
    title: s.title,
    description: s.description,
    alternates: { canonical: `/uslugi/${s.slug}` },
    openGraph: { title: s.title, description: s.description, url: `/uslugi/${s.slug}` },
  };
}

export default async function ServicePageView({ params }: Props) {
  const { slug } = await params;
  const s = SERVICES.find((x) => x.slug === slug);
  if (!s) notFound();

  const faqLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: s.faq.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };

  const others = SERVICES.filter((x) => x.slug !== s.slug);

  return (
    <PublicLayout>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqLd) }} />

      <nav className="mb-4 text-sm text-gray-500">
        <Link href="/" className="hover:underline">Главная</Link>
        {" / "}
        <Link href="/uslugi" className="hover:underline">Услуги</Link>
      </nav>

      <h1 className="text-2xl font-bold text-[#02167f] sm:text-3xl">{s.h1}</h1>
      <p className="mt-3 text-base leading-relaxed text-gray-700">{s.lead}</p>

      <Link
        href="/booking"
        className="mt-5 inline-block rounded-lg bg-[#02167f] px-6 py-3 font-semibold text-white"
      >
        Записаться онлайн
      </Link>

      <h2 className="mt-10 text-xl font-bold">Что входит</h2>
      <ul className="mt-3 list-disc space-y-1.5 pl-5 text-gray-700">
        {s.includes.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>

      <h2 className="mt-8 text-xl font-bold">Когда пора обращаться</h2>
      <ul className="mt-3 list-disc space-y-1.5 pl-5 text-gray-700">
        {s.signs.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>

      <h2 className="mt-8 text-xl font-bold">Частые вопросы</h2>
      <div className="mt-3 space-y-4">
        {s.faq.map((f) => (
          <div key={f.q}>
            <h3 className="font-semibold">{f.q}</h3>
            <p className="mt-1 text-gray-700">{f.a}</p>
          </div>
        ))}
      </div>

      <div className="mt-10 rounded-xl bg-white p-5 shadow-sm">
        <h2 className="text-lg font-bold">Как нас найти</h2>
        <p className="mt-2 text-gray-700">
          СТО «Твоя Шина», Ярославль, ул. Промышленная, 2к. Телефон:{" "}
          <a href="tel:+74852664467" className="font-semibold text-[#02167f]">+7 (4852) 66-44-67</a>.
        </p>
      </div>

      <h2 className="mt-10 text-xl font-bold">Другие услуги</h2>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        {others.map((x) => (
          <li key={x.slug}>
            <Link href={`/uslugi/${x.slug}`} className="text-[#02167f] hover:underline">
              {x.name}
            </Link>
          </li>
        ))}
      </ul>
    </PublicLayout>
  );
}
