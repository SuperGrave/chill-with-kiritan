import { useState } from "react";

type Memo = { id: number; text: string; pinned: boolean };

export default function TabMemo() {
  const [memos, setMemos] = useState<Memo[]>([
    { id: 1, text: "次にやる：Weather panel の表示整理", pinned: true },
  ]);
  const [input, setInput] = useState("");

  const add = () => {
    if (!input.trim()) return;
    setMemos((prev) => [
      ...prev,
      { id: Date.now(), text: input.trim(), pinned: false },
    ]);
    setInput("");
  };

  const togglePin = (id: number) =>
    setMemos((prev) =>
      prev.map((m) => (m.id === id ? { ...m, pinned: !m.pinned } : m))
    );

  const remove = (id: number) =>
    setMemos((prev) => prev.filter((m) => m.id !== id));

  const sorted = [...memos].sort((a, b) => Number(b.pinned) - Number(a.pinned));

  return (
    <section className="tab-panel">
      <h2 className="panel-title">MEMO</h2>
      <form
        className="add-row"
        onSubmit={(e) => { e.preventDefault(); add(); }}
      >
        <input
          className="add-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="メモを追加…"
        />
        <button type="submit">追加</button>
      </form>
      <ul className="memo-list">
        {sorted.map((m) => (
          <li key={m.id} className={`memo-item ${m.pinned ? "pinned" : ""}`}>
            <button
              className={`icon-btn pin-btn ${m.pinned ? "pinned" : ""}`}
              onClick={() => togglePin(m.id)}
              title="ピン留め"
            >
              📌
            </button>
            <span className="memo-text">{m.text}</span>
            <button className="icon-btn" onClick={() => remove(m.id)}>✕</button>
          </li>
        ))}
      </ul>
      <p className="note">※ API連携は Phase B-3 で実装します</p>
    </section>
  );
}
