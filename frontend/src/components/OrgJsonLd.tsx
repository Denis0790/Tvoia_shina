import { COMPANY } from "@/lib/company";
import { SERVICES } from "@/lib/seo";

const SITE = "https://sto-tyre4u.ru";

// Разметка организации для поисковиков (schema.org). Отдаётся сразу, без ожидания входа.
export default function OrgJsonLd() {
  const data = {
    "@context": "https://schema.org",
    "@type": "AutoRepair",
    name: "СТО «Твоя Шина»",
    legalName: COMPANY.name,
    url: SITE,
    telephone: "+74852664467",
    email: COMPANY.email,
    address: {
      "@type": "PostalAddress",
      streetAddress: "ул. Промышленная, 2к",
      addressLocality: "Ярославль",
      addressCountry: "RU",
    },
    areaServed: { "@type": "City", name: "Ярославль" },
    openingHoursSpecification: {
      "@type": "OpeningHoursSpecification",
      dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
      opens: "08:30",
      closes: "17:30",
    },
    makesOffer: SERVICES.map((s) => ({
      "@type": "Offer",
      itemOffered: { "@type": "Service", name: s.name, url: `${SITE}/uslugi/${s.slug}` },
    })),
  };
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }} />;
}
