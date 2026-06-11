import { useEffect, useState } from "react";

type HealthData = { ok: boolean; app: string; version: string } | null;

export default function TabStatus() {
  const [health, setHealth] = useState<HealthData>(null);
  const [error, setError]   = useState<string | null>(null);
  const [ts,    setTs]      = useState("");

  const check = async () => {
    try {
      const res = await fetch("http://127.0.0.1:40313/api/health");
      const data = await res.json();
      setHealth(data);
      setError(null);
    } catch (e: any) {
      setHealth(null);
      setError(String(e));
    }
    setTs(new Date().toLocaleTimeString("ja-JP"));
  };

  useEffect(() => {
    check();
    const id = setInterval(check, 5000);
    return () => clearInterval(id);
  }, []);

  return (
    <section className="tab-panel">
      <h2 className="panel-title">STATUS</h2>

      <table className="status-table">
        <tbody>
          <tr>
            <td>HTTP API</td>
            <td className={health?.ok ? "ok" : "err"}>
              {health?.ok ? "✔ running" : "✘ offline"}
            </td>
          </tr>
          <tr>
            <td>Version</td>
            <td>{health?.version ?? "—"}</td>
          </tr>
          <tr>
            <td>Spotify</td>
            <td className="pending">未接続</td>
          </tr>
          <tr>
            <td>AI Provider</td>
            <td className="pending">none</td>
          </tr>
          <tr>
            <td>Weather Source</td>
            <td className="pending">mock</td>
          </tr>
          <tr>
            <td>WebSocket</td>
            <td className="pending">未実装 (Phase B-6)</td>
          </tr>
        </tbody>
      </table>

      {error && <p className="error-msg">⚠ {error}</p>}

      <div className="status-footer">
        <span className="ts">最終確認: {ts}</span>
        <button onClick={check} className="secondary-btn">再確認</button>
      </div>
    </section>
  );
}
