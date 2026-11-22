import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/nord", "/login", "/profile", "/messages", "/booking", "/consent"],
      },
    ],
    sitemap: "https://sto-tyre4u.ru/sitemap.xml",
    host: "https://sto-tyre4u.ru",
  };
}
