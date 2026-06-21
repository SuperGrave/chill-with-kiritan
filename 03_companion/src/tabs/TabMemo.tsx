import { useEffect, useState } from "react";
import { MemoIcon, PinIcon, PlusIcon, XIcon } from "../icons";
import { api, type Memo } from "../api";

export default function TabMemo() {
  const [memos, setMemos] = useState<Memo[]>([]);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    api.memos().then(setMemos).catch(() => setError("APIに接続できませんでした"));

  useEffect(() => { load(); }, []);

  const add = async () => {
    if (!input.trim()) return;
    const text = input.trim();
    setInput("");
    try { await api.addMemo(text); await load(); }
    catch { setError("追加に失敗しました"); }
  };

  const togglePin = async (m: Memo) => {
    setMemos((prev) => prev.map((x) => (x.id === m.id ? { ...x, pinned: !x.pinned } : x)));
    try { await api.updateMemo(m.id, { pinned: !m.pinned }); } catch { load(); }
  };

  const remove = async (id: string) => {
    setMemos((prev) => prev.filter((m) => m.id !== id));
    try { await api.deleteMemo(id); } catch { load(); }
  };

  const sorted = [...memos].sort((a, b) => Number(b.pinned) - Number(a.pinned));

  return (
    <section className="tab-panel">
      <header className="panel-head">
        <h2>メモ</h2>
        <span className="panel-sub">{memos.length} 件・ピン留めは上に表示</span>
      </header>

      <form className="add-row" onSubmit={(e) => { e.preventDefault(); add(); }}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="メモを追加…"
        />
        <button type="submit" disabled={!input.trim()}>
          <PlusIcon />
          追加
        </button>
      </form>

      {error && <p className="error-banner">⚠ {error}</p>}

      {memos.length === 0 ? (
        <div className="empty-state">
          <MemoIcon />
          <p>メモはありません</p>
        </div>
      ) : (
        <ul className="memo-list">
          {sorted.map((m) => (
            <li key={m.id} className={`memo-item ${m.pinned ? "pinned" : ""}`}>
              <button
                className={`icon-btn pin-btn ${m.pinned ? "pinned" : ""}`}
                onClick={() => togglePin(m)}
                title={m.pinned ? "ピン留めを外す" : "ピン留め"}
              >
                <PinIcon />
              </button>
              <span className="memo-text">{m.text}</span>
              <button
                className="icon-btn danger delete-btn"
                onClick={() => remove(m.id)}
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
