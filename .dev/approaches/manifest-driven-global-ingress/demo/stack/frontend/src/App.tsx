import { useEffect, useMemo, useState } from "react";

type ApiPayload = {
  service: string;
  slug: string;
  utc_time: string;
  db: {
    host: string;
    port: number;
    name: string;
    user: string;
  };
};

export function App() {
  const [data, setData] = useState<ApiPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  const apiUrl = useMemo(() => {
    const base = import.meta.env.VITE_API_BASE_URL as string | undefined;
    return base || "";
  }, []);

  useEffect(() => {
    if (!apiUrl) {
      setError("VITE_API_BASE_URL is not configured");
      return;
    }

    fetch(apiUrl)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as ApiPayload;
      })
      .then((payload) => setData(payload))
      .catch((err) => setError(String(err)));
  }, [apiUrl]);

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", maxWidth: 920, margin: "2rem auto", padding: "0 1rem" }}>
      <h1>Parallel Workspace Demo</h1>
      <p>Frontend host: {window.location.hostname}</p>
      <p>Calling: {apiUrl || "(missing)"}</p>
      <h2>API response</h2>
      <pre style={{ background: "#f1f5f9", padding: "1rem", borderRadius: 8, overflowX: "auto" }}>
        {error ? `API request failed: ${error}` : JSON.stringify(data, null, 2) || "Loading..."}
      </pre>
    </main>
  );
}
