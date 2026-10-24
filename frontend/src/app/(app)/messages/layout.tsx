import RequireAuth from "@/components/RequireAuth";

export default function MessagesLayout({ children }: { children: React.ReactNode }) {
  return <RequireAuth title="Сообщения">{children}</RequireAuth>;
}
