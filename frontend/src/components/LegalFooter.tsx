import { COMPANY } from "@/lib/company";

export default function LegalFooter({ dark = false }: { dark?: boolean }) {
  const tone = dark ? "text-white/60" : "text-gray-400";
  const hover = dark ? "hover:text-white" : "hover:text-gray-600";
  return (
    <footer className={`mt-6 text-center text-[11px] leading-relaxed ${tone}`}>
      <p>
        <a href="/privacy" className={`underline ${hover}`}>Политика обработки данных</a>
        {" · "}
        <a href="/consent" className={`underline ${hover}`}>Согласие на обработку данных</a>
      </p>
      <p className="mt-1">
        {COMPANY.name} · ИНН {COMPANY.inn} · ОГРН {COMPANY.ogrn}
      </p>
      <p>{COMPANY.address}</p>
      <p className="mt-1">Эмодзи: Google Noto Emoji, лицензия CC BY 4.0</p>
    </footer>
  );
}
