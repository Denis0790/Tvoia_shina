import RequireAuth from "@/components/RequireAuth";

export default function ProfileLayout({ children }: { children: React.ReactNode }) {
  return <RequireAuth title="Профиль">{children}</RequireAuth>;
}
