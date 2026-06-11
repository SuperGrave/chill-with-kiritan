import { useState } from "react";

export default function TabSettings() {
  const [openaiKey,   setOpenaiKey]   = useState("");
  const [googleKey,   setGoogleKey]   = useState("");
  const [spotifyId,   setSpotifyId]   = useState("");
  const [port,        setPort]        = useState("40313");
  const [jmaOffice,   setJmaOffice]   = useState("016000");
  const [saved,       setSaved]       = useState(false);

  const save = () => {
    // TODO: Phase B-4 — store via Tauri plugin-store / OS keyring
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <section className="tab-panel">
      <h2 className="panel-title">SETTINGS</h2>

      <fieldset className="settings-group">
        <legend>AI</legend>
        <label>OpenAI API Key
          <input
            type="password"
            value={openaiKey}
            onChange={(e) => setOpenaiKey(e.target.value)}
            placeholder="sk-..."
          />
        </label>
        <label>Google API Key
          <input
            type="password"
            value={googleKey}
            onChange={(e) => setGoogleKey(e.target.value)}
            placeholder="AIza..."
          />
        </label>
      </fieldset>

      <fieldset className="settings-group">
        <legend>Spotify</legend>
        <label>Client ID
          <input
            type="text"
            value={spotifyId}
            onChange={(e) => setSpotifyId(e.target.value)}
            placeholder="Spotify Client ID"
          />
        </label>
        <button className="secondary-btn">Spotify 接続 (Phase B-5)</button>
      </fieldset>

      <fieldset className="settings-group">
        <legend>Weather / 地域</legend>
        <label>JMA Office Code
          <input
            type="text"
            value={jmaOffice}
            onChange={(e) => setJmaOffice(e.target.value)}
          />
        </label>
        <p className="hint">初期値: 016000 (札幌)</p>
      </fieldset>

      <fieldset className="settings-group">
        <legend>Server</legend>
        <label>API Port
          <input
            type="number"
            value={port}
            onChange={(e) => setPort(e.target.value)}
          />
        </label>
      </fieldset>

      <div className="settings-actions">
        <button onClick={save} className="primary-btn">
          {saved ? "✔ 保存しました" : "設定を保存"}
        </button>
      </div>
      <p className="note">※ APIキー保存は Phase B-4 で実装 (OS keyring)</p>
    </section>
  );
}
