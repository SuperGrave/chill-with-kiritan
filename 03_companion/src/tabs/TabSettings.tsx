import { useEffect, useState } from "react";
import { CheckIcon, CloudIcon, MusicIcon, ServerIcon, SparkIcon } from "../icons";
import { api, type AppSettings, type SecretsStatus } from "../api";
import TabDisplay from "./TabDisplay";

export default function TabSettings() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [secStatus, setSecStatus] = useState<SecretsStatus | null>(null);

  // Secret inputs are write-only: blank means "leave unchanged".
  const [openaiKey, setOpenaiKey] = useState("");
  const [googleKey, setGoogleKey] = useState("");
  const [spotifySecret, setSpotifySecret] = useState("");
  const [spotifyRefresh, setSpotifyRefresh] = useState("");

  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [spotifyCheck, setSpotifyCheck] = useState<string>("");

  useEffect(() => {
    api.getSettings().then(setSettings).catch(() => setError("APIに接続できませんでした"));
    api.secretsStatus().then(setSecStatus).catch(() => {});
  }, []);

  const upd = (path: string, value: any) => {
    setSettings((prev) => {
      if (!prev) return prev;
      const next: any = structuredClone(prev);
      const keys = path.split(".");
      let o = next;
      for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]];
      o[keys[keys.length - 1]] = value;
      return next;
    });
  };

  const save = async () => {
    if (!settings) return;
    setError(null);
    try {
      await api.putSettings(settings);
      const secrets: Record<string, string> = {};
      if (openaiKey) secrets.openaiKey = openaiKey;
      if (googleKey) secrets.googleKey = googleKey;
      if (spotifySecret) secrets.spotifyClientSecret = spotifySecret;
      if (spotifyRefresh) secrets.spotifyRefreshToken = spotifyRefresh;
      if (Object.keys(secrets).length) await api.putSecrets(secrets);
      setOpenaiKey(""); setGoogleKey(""); setSpotifySecret(""); setSpotifyRefresh("");
      setSecStatus(await api.secretsStatus());
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      setError("保存に失敗しました");
    }
  };

  const checkSpotify = async () => {
    setSpotifyCheck("確認中…");
    try {
      const res: any = await api.spotifyRefresh();
      if (res?.ok) {
        const track = res.spotify?.track;
        setSpotifyCheck(track ? `接続OK: ${track.title} / ${track.artist}` : `接続OK: ${res.spotify?.status ?? "idle"}`);
      } else {
        setSpotifyCheck(`未接続: ${res?.error ?? res?.status ?? "設定を確認してください"}`);
      }
    } catch {
      setSpotifyCheck("確認に失敗しました（Companion APIを確認）");
    }
  };

  const connectSpotify = async () => {
    setSpotifyCheck("認証URLを作成中…");
    try {
      const res: any = await api.spotifyAuthUrl();
      if (res.ok && res.authUrl) {
        window.open(res.authUrl, "_blank", "noopener,noreferrer");
        setSpotifyCheck(`ブラウザでSpotify認証を開きました。Redirect URI: ${res.redirectUri}`);
      } else {
        setSpotifyCheck(`認証URLを作れません: ${res.error ?? "Client IDを確認してください"}`);
      }
    } catch {
      setSpotifyCheck("認証URLの作成に失敗しました（Companion APIを確認）");
    }
  };

  if (!settings) {
    return (
      <section className="tab-panel">
        <header className="panel-head"><h2>設定</h2></header>
        {error ? <p className="error-banner">⚠ {error}</p> : <p className="note">読み込み中…</p>}
        <div className="settings-divider" />
        <TabDisplay embedded />
      </section>
    );
  }

  const dot = (on?: boolean) => (
    <span className={`pill ${on ? "ok" : "warn"}`}>{on ? "設定済み" : "未設定"}</span>
  );

  return (
    <section className="tab-panel">
      <header className="panel-head"><h2>設定</h2></header>

      <div className="settings-group">
        <div className="group-head">
          <span className="group-icon"><SparkIcon /></span>
          <h3>AI</h3>
        </div>
        <label className="field">
          <span>プロバイダー</span>
          <select value={settings.ai.provider} onChange={(e) => upd("ai.provider", e.target.value)}>
            <option value="none">使わない</option>
            <option value="openai">OpenAI</option>
            <option value="google">Google Gemini</option>
          </select>
        </label>
        <label className="field">
          <span>モデル</span>
          <input className="mono" value={settings.ai.model}
            onChange={(e) => upd("ai.model", e.target.value)}
            placeholder="gpt-4o-mini / gemini-1.5-flash" />
        </label>
        <label className="field">
          <span>システムプロンプト</span>
          <input value={settings.ai.systemPrompt}
            onChange={(e) => upd("ai.systemPrompt", e.target.value)} />
        </label>
        <label className="field">
          <span>OpenAI API Key {dot(secStatus?.openai)}</span>
          <input type="password" className="mono" value={openaiKey}
            onChange={(e) => setOpenaiKey(e.target.value)} placeholder="sk-... (変更時のみ入力)" />
        </label>
        <label className="field">
          <span>Google API Key {dot(secStatus?.google)}</span>
          <input type="password" className="mono" value={googleKey}
            onChange={(e) => setGoogleKey(e.target.value)} placeholder="AIza... (変更時のみ入力)" />
        </label>
      </div>

      <div className="settings-group">
        <div className="group-head">
          <span className="group-icon"><MusicIcon /></span>
          <h3>Spotify</h3>
        </div>
        <label className="field">
          <span>Client ID</span>
          <input className="mono" value={settings.spotify.clientId}
            onChange={(e) => upd("spotify.clientId", e.target.value)} placeholder="Spotify Client ID" />
        </label>
        <label className="field">
          <span>Client Secret {dot(secStatus?.spotifyClientSecret)}</span>
          <input type="password" className="mono" value={spotifySecret}
            onChange={(e) => setSpotifySecret(e.target.value)} placeholder="(変更時のみ入力)" />
        </label>
        <label className="field">
          <span>Refresh Token {dot(secStatus?.spotifyRefreshToken)}</span>
          <input type="password" className="mono" value={spotifyRefresh}
            onChange={(e) => setSpotifyRefresh(e.target.value)} placeholder="(変更時のみ入力)" />
        </label>
        <p className="hint">user-read-currently-playing スコープの refresh_token を取得して貼り付け</p>
        <button type="button" className="secondary-btn" onClick={connectSpotify}>Spotify認証を開く</button>
        <button type="button" className="secondary-btn" onClick={checkSpotify}>Spotify接続確認</button>
        {spotifyCheck && <p className="hint">{spotifyCheck}</p>}
        <p className="hint">Spotify Dashboard の Redirect URI には http://127.0.0.1:40313/spotify/callback を登録してください。</p>
      </div>

      <div className="settings-group">
        <div className="group-head">
          <span className="group-icon"><CloudIcon /></span>
          <h3>天気・地域</h3>
        </div>
        <label className="field">
          <span>表示名</span>
          <input value={settings.weather.locationLabel}
            onChange={(e) => upd("weather.locationLabel", e.target.value)} />
        </label>
        <label className="field">
          <span>緯度</span>
          <input type="number" className="mono" value={settings.weather.latitude}
            onChange={(e) => upd("weather.latitude", Number(e.target.value))} />
        </label>
        <label className="field">
          <span>経度</span>
          <input type="number" className="mono" value={settings.weather.longitude}
            onChange={(e) => upd("weather.longitude", Number(e.target.value))} />
        </label>
        <label className="field">
          <span>JMA Office</span>
          <input className="mono" value={settings.weather.jmaOffice}
            onChange={(e) => upd("weather.jmaOffice", e.target.value)} />
        </label>
      </div>

      <div className="settings-group">
        <div className="group-head">
          <span className="group-icon"><ServerIcon /></span>
          <h3>ニュース (RSS)</h3>
        </div>
        <label className="field">
          <span>フィードURL (改行区切り)</span>
          <textarea className="mono" rows={3} value={settings.news.feeds.join("\n")}
            onChange={(e) => upd("news.feeds", e.target.value.split("\n").map((s) => s.trim()).filter(Boolean))} />
        </label>
        <label className="field">
          <span>最大件数</span>
          <input type="number" className="mono" value={settings.news.maxItems}
            onChange={(e) => upd("news.maxItems", Number(e.target.value))} />
        </label>
      </div>

      {error && <p className="error-banner">⚠ {error}</p>}

      <div className="settings-actions">
        <button onClick={save} className={`primary-btn save-btn ${saved ? "saved" : ""}`}>
          {saved && <CheckIcon />}
          {saved ? "保存しました" : "設定を保存"}
        </button>
      </div>
      <p className="note">※ APIキーは Companion 内のローカルファイルにのみ保存され、壁紙側へは送信されません</p>

      <div className="settings-divider" />
      <TabDisplay embedded />
    </section>
  );
}
