import { useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { CheckIcon, CloudIcon, MusicIcon, RefreshIcon, ServerIcon } from "../icons";
import { api, type AppSettings, type SecretsStatus, type StartupStatus } from "../api";
import TabDisplay from "./TabDisplay";

type WeatherPreset = {
  id: string;
  label: string;
  locationLabel: string;
  latitude: number;
  longitude: number;
};

const WEATHER_PRESETS: WeatherPreset[] = [
  { id: "hokkaido", label: "北海道（札幌）", locationLabel: "SAPPORO", latitude: 43.0642, longitude: 141.3469 },
  { id: "aomori", label: "青森県（青森）", locationLabel: "AOMORI", latitude: 40.8244, longitude: 140.74 },
  { id: "iwate", label: "岩手県（盛岡）", locationLabel: "MORIOKA", latitude: 39.7036, longitude: 141.1527 },
  { id: "miyagi", label: "宮城県（仙台）", locationLabel: "SENDAI", latitude: 38.2682, longitude: 140.8694 },
  { id: "akita", label: "秋田県（秋田）", locationLabel: "AKITA", latitude: 39.7186, longitude: 140.1024 },
  { id: "yamagata", label: "山形県（山形）", locationLabel: "YAMAGATA", latitude: 38.2404, longitude: 140.3633 },
  { id: "fukushima", label: "福島県（福島）", locationLabel: "FUKUSHIMA", latitude: 37.7503, longitude: 140.4675 },
  { id: "ibaraki", label: "茨城県（水戸）", locationLabel: "MITO", latitude: 36.3418, longitude: 140.4468 },
  { id: "tochigi", label: "栃木県（宇都宮）", locationLabel: "UTSUNOMIYA", latitude: 36.5658, longitude: 139.8836 },
  { id: "gunma", label: "群馬県（前橋）", locationLabel: "MAEBASHI", latitude: 36.3912, longitude: 139.0609 },
  { id: "saitama", label: "埼玉県（さいたま）", locationLabel: "SAITAMA", latitude: 35.8569, longitude: 139.6489 },
  { id: "chiba", label: "千葉県（千葉）", locationLabel: "CHIBA", latitude: 35.6074, longitude: 140.1065 },
  { id: "tokyo", label: "東京都（東京）", locationLabel: "TOKYO", latitude: 35.6895, longitude: 139.6917 },
  { id: "kanagawa", label: "神奈川県（横浜）", locationLabel: "YOKOHAMA", latitude: 35.4437, longitude: 139.638 },
  { id: "niigata", label: "新潟県（新潟）", locationLabel: "NIIGATA", latitude: 37.9026, longitude: 139.0232 },
  { id: "toyama", label: "富山県（富山）", locationLabel: "TOYAMA", latitude: 36.6953, longitude: 137.2113 },
  { id: "ishikawa", label: "石川県（金沢）", locationLabel: "KANAZAWA", latitude: 36.5947, longitude: 136.6256 },
  { id: "fukui", label: "福井県（福井）", locationLabel: "FUKUI", latitude: 36.0652, longitude: 136.2216 },
  { id: "yamanashi", label: "山梨県（甲府）", locationLabel: "KOFU", latitude: 35.6642, longitude: 138.5684 },
  { id: "nagano", label: "長野県（長野）", locationLabel: "NAGANO", latitude: 36.6513, longitude: 138.181 },
  { id: "gifu", label: "岐阜県（岐阜）", locationLabel: "GIFU", latitude: 35.3912, longitude: 136.7223 },
  { id: "shizuoka", label: "静岡県（静岡）", locationLabel: "SHIZUOKA", latitude: 34.9756, longitude: 138.3828 },
  { id: "aichi", label: "愛知県（名古屋）", locationLabel: "NAGOYA", latitude: 35.1815, longitude: 136.9066 },
  { id: "mie", label: "三重県（津）", locationLabel: "TSU", latitude: 34.7303, longitude: 136.5086 },
  { id: "shiga", label: "滋賀県（大津）", locationLabel: "OTSU", latitude: 35.0045, longitude: 135.8686 },
  { id: "kyoto", label: "京都府（京都）", locationLabel: "KYOTO", latitude: 35.0116, longitude: 135.7681 },
  { id: "osaka", label: "大阪府（大阪）", locationLabel: "OSAKA", latitude: 34.6937, longitude: 135.5023 },
  { id: "hyogo", label: "兵庫県（神戸）", locationLabel: "KOBE", latitude: 34.6901, longitude: 135.1955 },
  { id: "nara", label: "奈良県（奈良）", locationLabel: "NARA", latitude: 34.6851, longitude: 135.8048 },
  { id: "wakayama", label: "和歌山県（和歌山）", locationLabel: "WAKAYAMA", latitude: 34.226, longitude: 135.1675 },
  { id: "tottori", label: "鳥取県（鳥取）", locationLabel: "TOTTORI", latitude: 35.5011, longitude: 134.2351 },
  { id: "shimane", label: "島根県（松江）", locationLabel: "MATSUE", latitude: 35.4723, longitude: 133.0505 },
  { id: "okayama", label: "岡山県（岡山）", locationLabel: "OKAYAMA", latitude: 34.6551, longitude: 133.9195 },
  { id: "hiroshima", label: "広島県（広島）", locationLabel: "HIROSHIMA", latitude: 34.3853, longitude: 132.4553 },
  { id: "yamaguchi", label: "山口県（山口）", locationLabel: "YAMAGUCHI", latitude: 34.1861, longitude: 131.4705 },
  { id: "tokushima", label: "徳島県（徳島）", locationLabel: "TOKUSHIMA", latitude: 34.0658, longitude: 134.5593 },
  { id: "kagawa", label: "香川県（高松）", locationLabel: "TAKAMATSU", latitude: 34.3401, longitude: 134.0434 },
  { id: "ehime", label: "愛媛県（松山）", locationLabel: "MATSUYAMA", latitude: 33.8416, longitude: 132.7657 },
  { id: "kochi", label: "高知県（高知）", locationLabel: "KOCHI", latitude: 33.5597, longitude: 133.5311 },
  { id: "fukuoka", label: "福岡県（福岡）", locationLabel: "FUKUOKA", latitude: 33.5902, longitude: 130.4017 },
  { id: "saga", label: "佐賀県（佐賀）", locationLabel: "SAGA", latitude: 33.2494, longitude: 130.2988 },
  { id: "nagasaki", label: "長崎県（長崎）", locationLabel: "NAGASAKI", latitude: 32.7503, longitude: 129.8777 },
  { id: "kumamoto", label: "熊本県（熊本）", locationLabel: "KUMAMOTO", latitude: 32.8031, longitude: 130.7079 },
  { id: "oita", label: "大分県（大分）", locationLabel: "OITA", latitude: 33.2382, longitude: 131.6126 },
  { id: "miyazaki", label: "宮崎県（宮崎）", locationLabel: "MIYAZAKI", latitude: 31.9111, longitude: 131.4239 },
  { id: "kagoshima", label: "鹿児島県（鹿児島）", locationLabel: "KAGOSHIMA", latitude: 31.5602, longitude: 130.5581 },
  { id: "okinawa", label: "沖縄県（那覇）", locationLabel: "NAHA", latitude: 26.2124, longitude: 127.6809 },
];

const JMA_OFFICE_BY_PRESET: Record<string, string> = {
  hokkaido: "016000",
  aomori: "020000",
  iwate: "030000",
  miyagi: "040000",
  akita: "050000",
  yamagata: "060000",
  fukushima: "070000",
  ibaraki: "080000",
  tochigi: "090000",
  gunma: "100000",
  saitama: "110000",
  chiba: "120000",
  tokyo: "130000",
  kanagawa: "140000",
  niigata: "150000",
  toyama: "160000",
  ishikawa: "170000",
  fukui: "180000",
  yamanashi: "190000",
  nagano: "200000",
  gifu: "210000",
  shizuoka: "220000",
  aichi: "230000",
  mie: "240000",
  shiga: "250000",
  kyoto: "260000",
  osaka: "270000",
  hyogo: "280000",
  nara: "290000",
  wakayama: "300000",
  tottori: "310000",
  shimane: "320000",
  okayama: "330000",
  hiroshima: "340000",
  yamaguchi: "350000",
  tokushima: "360000",
  kagawa: "370000",
  ehime: "380000",
  kochi: "390000",
  fukuoka: "400000",
  saga: "410000",
  nagasaki: "420000",
  kumamoto: "430000",
  oita: "440000",
  miyazaki: "450000",
  kagoshima: "460100",
  okinawa: "471000",
};

const findWeatherPresetId = (weather: AppSettings["weather"]) =>
  WEATHER_PRESETS.find((p) =>
    Math.abs(p.latitude - weather.latitude) < 0.001
    && Math.abs(p.longitude - weather.longitude) < 0.001
  )?.id ?? "";

const withPresetJmaOffice = (settings: AppSettings): AppSettings => {
  const presetId = findWeatherPresetId(settings.weather);
  const jmaOffice = JMA_OFFICE_BY_PRESET[presetId];
  if (!jmaOffice || settings.weather.jmaOffice === jmaOffice) return settings;
  return {
    ...settings,
    weather: {
      ...settings.weather,
      jmaOffice,
    },
  };
};

export default function TabSettings() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [secStatus, setSecStatus] = useState<SecretsStatus | null>(null);
  const [startupStatus, setStartupStatus] = useState<StartupStatus | null>(null);

  // Secret inputs are write-only: blank means "leave unchanged".
  const [spotifySecret, setSpotifySecret] = useState("");
  const [spotifyRefresh, setSpotifyRefresh] = useState("");

  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [spotifyCheck, setSpotifyCheck] = useState<string>("");
  const [refreshStatus, setRefreshStatus] = useState<string>("");

  useEffect(() => {
    api.getSettings().then(setSettings).catch(() => setError("APIに接続できませんでした"));
    api.secretsStatus().then(setSecStatus).catch(() => {});
    api.startupStatus().then((res) => setStartupStatus(res.status)).catch(() => {});
  }, []);

  const upd = (path: string, value: any) => {
    setSettings((prev) => {
      if (!prev) return prev;
      const next: any = structuredClone(prev);
      const keys = path.split(".");
      let o = next;
      for (let i = 0; i < keys.length - 1; i++) {
        if (!o[keys[i]] || typeof o[keys[i]] !== "object") o[keys[i]] = {};
        o = o[keys[i]];
      }
      o[keys[keys.length - 1]] = value;
      return next;
    });
  };

  const save = async (): Promise<boolean> => {
    if (!settings) return false;
    setError(null);
    const settingsToSave = withPresetJmaOffice(settings);
    if (settingsToSave !== settings) setSettings(settingsToSave);
    try {
      await api.putSettings(settingsToSave);
      const startup = await api.startupRepair();
      setStartupStatus(startup.status);
      if (!startup.ok) {
        setError(`自動起動登録に失敗しました: ${startup.error ?? "Task Schedulerを確認してください"}`);
        return false;
      }
      const secrets: Record<string, string> = {};
      if (spotifySecret) secrets.spotifyClientSecret = spotifySecret;
      if (spotifyRefresh) secrets.spotifyRefreshToken = spotifyRefresh;
      if (Object.keys(secrets).length) await api.putSecrets(secrets);
      setSpotifySecret(""); setSpotifyRefresh("");
      setSecStatus(await api.secretsStatus());
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      return true;
    } catch {
      setError("保存に失敗しました");
      return false;
    }
  };

  const refreshStartupStatus = async () => {
    try {
      const res = await api.startupStatus();
      setStartupStatus(res.status);
      setRefreshStatus("自動起動の登録状態を確認しました");
    } catch {
      setRefreshStatus("自動起動の登録状態を確認できませんでした");
    }
  };

  const repairStartupElevated = async () => {
    setRefreshStatus("自動起動設定を保存中…");
    if (!(await save())) {
      setRefreshStatus("管理者権限登録前の設定保存に失敗しました");
      return;
    }
    setRefreshStatus("Windowsの管理者権限を要求しています…");
    try {
      const res = await api.startupRepairElevated();
      setStartupStatus(res.status);
      if (!res.ok) {
        setRefreshStatus(`管理者権限登録を開始できませんでした: ${res.error ?? "UACを確認してください"}`);
        return;
      }
      setRefreshStatus("UACを承認した場合は登録中です…");
      window.setTimeout(async () => {
        try {
          const status = await api.startupStatus();
          setStartupStatus(status.status);
          setRefreshStatus(status.status.taskRegistered
            ? "Task Schedulerへの登録を確認しました"
            : "登録確認待ちです。UACをキャンセルした場合は未登録のままです");
        } catch {
          setRefreshStatus("登録後の状態確認に失敗しました");
        }
      }, 3500);
    } catch {
      setRefreshStatus("管理者権限登録の要求に失敗しました");
    }
  };

  const checkSpotify = async () => {
    setSpotifyCheck("設定を保存中…");
    if (!(await save())) {
      setSpotifyCheck("接続確認前の設定保存に失敗しました");
      return;
    }
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
    setSpotifyCheck("設定を保存中…");
    if (!(await save())) {
      setSpotifyCheck("認証前の設定保存に失敗しました");
      return;
    }
    setSpotifyCheck("認証URLを作成中…");
    try {
      const res: any = await api.spotifyAuthUrl();
      if (res.ok && res.authUrl) {
        await openUrl(res.authUrl);
        setSpotifyCheck(`ブラウザでSpotify認証を開きました。Redirect URI: ${res.redirectUri}`);
      } else {
        setSpotifyCheck(`認証URLを作れません: ${res.error ?? "Client IDを確認してください"}`);
      }
    } catch {
      setSpotifyCheck("認証URLの作成に失敗しました（Companion APIを確認）");
    }
  };

  const applyWeatherPreset = (id: string) => {
    const preset = WEATHER_PRESETS.find((p) => p.id === id);
    if (!preset) return;
    upd("weather.locationLabel", preset.locationLabel);
    upd("weather.latitude", preset.latitude);
    upd("weather.longitude", preset.longitude);
    upd("weather.jmaOffice", JMA_OFFICE_BY_PRESET[id] ?? "016000");
  };

  const refreshWeatherNow = async () => {
    setRefreshStatus("天気設定を保存中…");
    if (!(await save())) {
      setRefreshStatus("天気更新前の設定保存に失敗しました");
      return;
    }
    setRefreshStatus("天気を再取得中…");
    try {
      const res: any = await api.weatherRefresh();
      setRefreshStatus(res?.ok ? "天気を更新しました" : `天気更新に失敗: ${res?.error ?? "設定を確認してください"}`);
    } catch {
      setRefreshStatus("天気更新に失敗しました（Companion APIを確認）");
    }
  };

  const refreshNewsNow = async () => {
    setRefreshStatus("ニュース設定を保存中…");
    if (!(await save())) {
      setRefreshStatus("ニュース更新前の設定保存に失敗しました");
      return;
    }
    setRefreshStatus("ニュースを再取得中…");
    try {
      const res: any = await api.newsRefresh();
      setRefreshStatus(res?.ok ? `ニュースを更新しました（${res.count ?? 0}件）` : `ニュース更新に失敗: ${res?.error ?? "フィードを確認してください"}`);
    } catch {
      setRefreshStatus("ニュース更新に失敗しました（Companion APIを確認）");
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

  const selectedWeatherPresetId =
    findWeatherPresetId(settings.weather);
  const startupRegistered = startupStatus?.taskRegistered || startupStatus?.runKeyRegistered;
  const startupMethodLabel =
    startupStatus?.method === "taskScheduler" ? "Task Scheduler" :
    startupStatus?.method === "runKey" ? "Run key" :
    startupStatus?.method === "taskScheduler+runKey" ? "Task Scheduler + Run key" :
    "未登録";

  return (
    <section className="tab-panel">
      <header className="panel-head"><h2>設定</h2></header>

      <div className="settings-group">
        <div className="group-head">
          <span className="group-icon"><ServerIcon /></span>
          <h3>起動</h3>
        </div>
        <label className="display-check">
          <span>Windowsを起動したときにCompanionも起動する</span>
          <input
            type="checkbox"
            checked={settings.startup?.launchAtLogin === true}
            onChange={(e) => upd("startup.launchAtLogin", e.target.checked)}
          />
        </label>
        <label className="display-check">
          <span>Task Schedulerで優先起動する（最高権限）</span>
          <input
            type="checkbox"
            disabled={settings.startup?.launchAtLogin !== true}
            checked={settings.startup?.launchWithHighestPrivileges === true}
            onChange={(e) => upd("startup.launchWithHighestPrivileges", e.target.checked)}
          />
        </label>
        <p className="hint">
          登録状態: {settings.startup?.launchAtLogin ? (startupRegistered ? startupMethodLabel : "未登録") : "OFF"}
          {startupStatus?.exePath ? ` / ${startupStatus.exePath}` : ""}
        </p>
        <button type="button" className="secondary-btn" onClick={refreshStartupStatus}>
          <RefreshIcon />
          登録状態を確認
        </button>
        <button
          type="button"
          className="secondary-btn"
          disabled={settings.startup?.launchAtLogin !== true}
          onClick={() => { void repairStartupElevated(); }}
        >
          <ServerIcon />
          管理者権限で登録
        </button>
        <p className="hint">Wallpaper Engineを自動起動にしている場合でも、Companion側の情報取得APIを先に立ち上げます。通常保存で最高権限タスクを作れない場合はRun keyへフォールバックします。最高権限タスクにしたい時だけ「管理者権限で登録」を使います。</p>
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
          <span>都道府県プリセット</span>
          <select value={selectedWeatherPresetId} onChange={(e) => applyWeatherPreset(e.target.value)}>
            <option value="">手入力 / カスタム</option>
            {WEATHER_PRESETS.map((preset) => (
              <option key={preset.id} value={preset.id}>{preset.label}</option>
            ))}
          </select>
        </label>
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
        <button type="button" className="secondary-btn" onClick={refreshWeatherNow}>
          <RefreshIcon />
          保存して天気更新
        </button>
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
        <button type="button" className="secondary-btn" onClick={refreshNewsNow}>
          <RefreshIcon />
          保存してニュース更新
        </button>
      </div>

      {error && <p className="error-banner">⚠ {error}</p>}
      {refreshStatus && <p className="hint">{refreshStatus}</p>}

      <div className="settings-actions">
        <button onClick={() => { void save(); }} className={`primary-btn save-btn ${saved ? "saved" : ""}`}>
          {saved && <CheckIcon />}
          {saved ? "保存しました" : "設定を保存"}
        </button>
      </div>
      <p className="note">※ 認証情報は Companion 内のローカルファイルにのみ保存され、壁紙側へは送信されません</p>

      <div className="settings-divider" />
      <TabDisplay embedded />
    </section>
  );
}
