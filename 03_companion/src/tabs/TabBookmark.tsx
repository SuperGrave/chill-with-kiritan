import { useState } from "react";
import { open } from "@tauri-apps/plugin-opener";

type Bookmark = { id: number; title: string; url: string; category?: string };

const DEFAULTS: Bookmark[] = [
  { id: 1, title: "ChatGPT",        url: "https://chat.openai.com",       category: "AI" },
  { id: 2, title: "Gemini",         url: "https://gemini.google.com",     category: "AI" },
  { id: 3, title: "GitHub",         url: "https://github.com",            category: "Dev" },
  { id: 4, title: "Spotify Web",    url: "https://open.spotify.com",      category: "Music" },
  { id: 5, title: "Google Calendar",url: "https://calendar.google.com",   category: "Util" },
];

export default function TabBookmark() {
  const [bookmarks, setBookmarks] = useState<Bookmark[]>(DEFAULTS);
  const [title, setTitle] = useState("");
  const [url, setUrl]     = useState("");

  const add = () => {
    if (!title.trim() || !url.trim()) return;
    setBookmarks((prev) => [
      ...prev,
      { id: Date.now(), title: title.trim(), url: url.trim() },
    ]);
    setTitle(""); setUrl("");
  };

  const remove = (id: number) =>
    setBookmarks((prev) => prev.filter((b) => b.id !== id));

  const openUrl = async (url: string) => {
    try {
      await open(url);
    } catch (e) {
      console.error("open failed:", e);
    }
  };

  return (
    <section className="tab-panel">
      <h2 className="panel-title">BOOKMARK</h2>
      <form
        className="add-row bookmark-form"
        onSubmit={(e) => { e.preventDefault(); add(); }}
      >
        <input
          className="add-input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="タイトル"
        />
        <input
          className="add-input"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://..."
        />
        <button type="submit">追加</button>
      </form>
      <ul className="bookmark-list">
        {bookmarks.map((b) => (
          <li key={b.id} className="bookmark-item">
            <button
              className="bookmark-open-btn"
              onClick={() => openUrl(b.url)}
              title={b.url}
            >
              <span className="bookmark-title">{b.title}</span>
              {b.category && <span className="bookmark-cat">{b.category}</span>}
            </button>
            <button className="icon-btn" onClick={() => remove(b.id)}>✕</button>
          </li>
        ))}
      </ul>
    </section>
  );
}
