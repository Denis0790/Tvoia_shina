import LegalFooter from "./LegalFooter";
import { COMPANY } from "@/lib/company";

export default function LegalLayout({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-[#f6f6f4] px-5 py-8 md:py-12">
      <div className="mx-auto w-full max-w-2xl bg-white rounded-2xl shadow-sm p-6 md:p-10">
        <a href="/" className="text-xs text-gray-400 hover:text-gray-600">← На главную</a>
        <h1 className="text-xl font-semibold text-gray-900 mt-3">{title}</h1>
        <p className="text-xs text-gray-400 mt-1">Редакция от {COMPANY.updated}</p>
        <div className="mt-6 space-y-3 text-sm leading-relaxed text-gray-700 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-gray-900 [&_h2]:mt-6 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1">
          {children}
        </div>
      </div>
      <div className="mx-auto max-w-2xl">
        <LegalFooter />
      </div>
    </main>
  );
}
