import RequireAuth from "@/components/RequireAuth";

export default function BookingLayout({ children }: { children: React.ReactNode }) {
  return <RequireAuth title="Запись на сервис">{children}</RequireAuth>;
}
