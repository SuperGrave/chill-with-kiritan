import { useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { BookmarkIcon, ExternalIcon, PlusIcon, XIcon } from "../icons";
import { api, type Bookmark } from "../api";

export default function TabBookmark() {
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    api.bookmarks().then(setBookmarks).catch(() => setError("APIに接続できませんでした"));

  useEffect(() => { load(); }, []);

  const add = async () => {
    if (!title.trim() || !url.trim()) return;
    try { await api.addBookmark(title.trim(), url.trim()); setTitle(""); setUrl(""); await load(); }
    catch { setError("追加に失敗しました"); }
  };

  const remove = async (id: string) => {
    setBookmarks((prev) => prev.filter((b) => b.id !== id));
    try { await api.deleteBookmark(id); } catch { load(); }
  };

  const openLink = async (u: string) => {
    try { await openUrl(u); } catch (e) { console.error("open failed:", e); }
  };

  return (
    <section className="tab-panel">
      <header className="panel-head">
        <h2>ブックマーク</h2>
        <span className="panel-sub">{bookmarks.length} 件</span>
      </header>

      <form className="bookmark-form" onSubmit={(e) => { e.preventDefault(); add(); }}>
        <input
          type="text"
          className="bm-title-input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="タイトル"
        />
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://..."
        />
        <button type="submit" disabled={!title.trim() || !url.trim()}>
          <PlusIcon />
          追加
        </button>
      </form>

      {error && <p className="error-banner">⚠ {error}</p>}

      {bookmarks.length === 0 ? (
        <div className="empty-state">
          <BookmarkIcon />
          <p>ブックマークはありません</p>
        </div>
      ) : (
        <ul className="bookmark-list">
          {bookmarks.map((b) => (
            <li key={b.id} className="bookmark-item">
              <button
                className="bookmark-open-btn"
                onClick={() => openLink(b.url)}
                title={b.url}
              >
                <span className="bm-avatar">{b.title.charAt(0).toUpperCase()}</span>
                <span className="bookmark-title">{b.title}</span>
                {b.category && <span className="bookmark-cat">{b.category}</span>}
                <span className="bm-external"><ExternalIcon /></span>
              </button>
              <button
                className="icon-btn danger delete-btn"
                onClick={() => remove(b.id)}
                aria-label="削除"
              >
                <XIcon />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
