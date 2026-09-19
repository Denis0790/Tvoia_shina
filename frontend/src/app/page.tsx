async function getHealth() {
  try {
    const res = await fetch(`${process.env.INTERNAL_API_URL}/health`, { cache: "no-store" });
    if (!res.ok) throw new Error("bad status");
    return await res.json();
  } catch {
    return null;
  }
}

export default async function Home() {
  const health = await getHealth();
  return (
    <main style={{ padding: 40, fontFamily: "sans-serif" }}>
      <h1>Твоя Шина</h1>
      <p>
        Статус backend:{" "}
        {health ? (
          <b style={{ color: "green" }}>{health.status}</b>
        ) : (
          <b style={{ color: "red" }}>недоступен</b>
        )}
      </p>
    </main>
  );
}
