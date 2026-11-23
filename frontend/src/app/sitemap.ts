import type { MetadataRoute } from "next";
import { SERVICES } from "@/lib/seo";

const SITE = "https://sto-tyre4u.ru";
// Дату меняем вручную, когда реально меняется содержимое страниц.
const UPDATED = new Date("2026-11-23");

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${SITE}/`, lastModified: UPDATED, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE}/uslugi`, lastModified: UPDATED, changeFrequency: "monthly", priority: 0.9 },
    ...SERVICES.map((s) => ({
      url: `${SITE}/uslugi/${s.slug}`,
      lastModified: UPDATED,
      changeFrequency: "monthly" as const,
      priority: 0.8,
    })),
    { url: `${SITE}/privacy`, lastModified: UPDATED, changeFrequency: "yearly", priority: 0.2 },
  ];
}
