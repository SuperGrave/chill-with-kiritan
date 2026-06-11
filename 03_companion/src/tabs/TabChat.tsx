import { useState } from "react";

type Message = { role: "user" | "assistant"; text: string };

export default function TabChat() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [status, setStatus] = useState<"idle" | "thinking">("idle");

  const send = async () => {
    if (!input.trim()) return;
    const userMsg = input.trim();
    setInput("");
    setMessages((prev) => [...prev, { role: "user", text: userMsg }]);
    setStatus("thinking");

    try {
      const res = await fetch("http://127.0.0.1:40313/api/chat/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: userMsg }),
      });
      const data = await res.json();
      const reply = data.message?.text ?? "(未実装 / Phase B-4)";
      setMessages((prev) => [...prev, { role: "assistant", text: reply }]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: "⚠ API エラー" },
      ]);
    } finally {
      setStatus("idle");
    }
  };

  return (
    <section className="tab-panel">
      <h2 className="panel-title">CHAT</h2>
      <div className="chat-log">
        {messages.length === 0 && (
          <p className="empty-hint">何か入力してください…</p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`chat-msg ${m.role}`}>
            <span className="chat-role">{m.role === "user" ? "You" : "AI"}</span>
            <p>{m.text}</p>
          </div>
        ))}
        {status === "thinking" && (
          <div className="chat-msg assistant">
            <span className="chat-role">AI</span>
            <p className="thinking">考え中…</p>
          </div>
        )}
      </div>
      <form
        className="chat-input-row"
        onSubmit={(e) => { e.preventDefault(); send(); }}
      >
        <input
          className="chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="メッセージを入力…"
          disabled={status === "thinking"}
        />
        <button type="submit" disabled={status === "thinking" || !input.trim()}>
          送信
        </button>
      </form>
      <p className="note">※ AI接続は Phase B-4 で実装します</p>
    </section>
  );
}
