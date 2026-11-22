import type { MetadataRoute } from "next";

const SITE = "https://sto-tyre4u.ru";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    { url: `${SITE}/`, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE}/privacy`, lastModified: now, changeFrequency: "yearly", priority: 0.2 },
  ];
}
