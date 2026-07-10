import { useEffect, useMemo, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { BookmarkIcon, ExternalIcon, RefreshIcon } from "../icons";
import { api, type NewsFeedState } from "../api";

const formatUpdatedAt = (value?: string | null) => {
  if (!value) return "未取得";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未取得";
  return date.toLocaleString("ja-JP", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const statusTone = (status: string): "ok" | "warn" | "err" => {
  if (status === "ok") return "ok";
  if (status === "error") return "err";
  return "warn";
};

const statusLabel = (status: string) => {
  if (status === "ok") return "OK";
  if (status === "error") return "ERROR";
  if (status === "empty") return "EMPTY";
  return status.toUpperCase();
};

export default function TabNews() {
  const [feeds, setFeeds] = useState<NewsFeedState[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedFeedUrl, setSelectedFeedUrl] = useState<string>("");

  const load = async () => {
    try {
      const next = await api.newsFeeds();
      setFeeds(next);
      setSelectedFeedUrl((current) => current || next[0]?.feedUrl || "");
      setError(null);
    } catch {
      setError("ニュースAPIに接続できませんでした");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const refresh = async () => {
    setBusy(true);
    try {
      const res = await api.newsRefresh();
      setFeeds(res.newsFeeds ?? []);
      setSelectedFeedUrl((current) => current || res.newsFeeds?.[0]?.feedUrl || "");
      setError(res.ok ? null : res.error ?? "一部のRSS取得に失敗しました");
    } catch {
      setError("ニュース更新に失敗しました");
    } finally {
      setBusy(false);
      setLoading(false);
    }
  };

  const selectedFeed = useMemo(
    () => feeds.find((feed) => feed.feedUrl === selectedFeedUrl) ?? feeds[0] ?? null,
    [feeds, selectedFeedUrl],
  );
  const totalItems = feeds.reduce((sum, feed) => sum + feed.items.length, 0);

  return (
    <section className="tab-panel news-tab">
      <header className="panel-head">
        <h2>RSS</h2>
        <span className="panel-sub">{feeds.length} feeds / {totalItems} items</span>
      </header>

      {error && <p className="error-banner">⚠ {error}</p>}
      {loading && <p className="note">読み込み中…</p>}

      <button type="button" className="secondary-btn" disabled={busy} onClick={() => { void refresh(); }}>
        <RefreshIcon />
        RSSを再取得
      </button>

      <div className="rss-2pane">
      <div className="news-feed-list">
        {feeds.map((feed) => (
          <button
            key={feed.feedUrl}
            type="button"
            className={`news-feed-button ${selectedFeed?.feedUrl === feed.feedUrl ? "active" : ""}`}
            onClick={() => setSelectedFeedUrl(feed.feedUrl)}
          >
            <span className="news-feed-icon"><BookmarkIcon /></span>
            <span className="news-feed-text">
              <strong>{feed.source}</strong>
              <small>{feed.items.length}件 / {formatUpdatedAt(feed.updatedAt)}</small>
            </span>
            <span className={`pill ${statusTone(feed.status)}`}>{statusLabel(feed.status)}</span>
          </button>
        ))}
        {!loading && feeds.length === 0 && <p className="note">RSSがまだ取得されていません</p>}
      </div>

      {selectedFeed && (
        <div className="settings-group news-feed-detail">
          <div className="group-head">
            <span className="group-icon"><BookmarkIcon /></span>
            <h3>{selectedFeed.source}</h3>
          </div>
          <input className="mono" readOnly value={selectedFeed.feedUrl} />
          {selectedFeed.error && <p className="error-banner">⚠ {selectedFeed.error}</p>}
          <div className="news-item-list">
            {selectedFeed.items.map((item, index) => (
              <button
                key={item.id}
                type="button"
                className="news-item-button"
                onClick={() => { if (item.url) void openUrl(item.url); }}
              >
                <span className="news-item-index">{String(index + 1).padStart(2, "0")}</span>
                <span className="news-item-body">
                  <strong>{item.title}</strong>
                  {item.summary && <small>{item.summary}</small>}
                </span>
                <ExternalIcon />
              </button>
            ))}
            {selectedFeed.items.length === 0 && <p className="note">このRSSには表示できる記事がありません</p>}
          </div>
        </div>
      )}
      </div>
    </section>
  );
}
