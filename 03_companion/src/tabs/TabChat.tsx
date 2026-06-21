import { useEffect, useRef, useState } from "react";
import { ChatIcon, SendIcon } from "../icons";
import { api, type ChatMessage } from "../api";

export default function TabChat() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<"idle" | "thinking">("idle");
  const [error, setError] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  // Load persisted history once (survives app restarts via the backend store).
  useEffect(() => {
    api.chatHistory().then(setMessages).catch(() => {});
  }, []);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, status]);

  const send = async () => {
    if (!input.trim()) return;
    const userMsg = input.trim();
    setInput("");
    setError(null);
    // optimistic user bubble
    setMessages((prev) => [
      ...prev,
      { id: `tmp-${Date.now()}`, role: "user", text: userMsg, createdAt: new Date().toISOString() },
    ]);
    setStatus("thinking");

    try {
      const data = await api.chatSend(userMsg);
      // backend stored both messages; reload canonical history
      const hist = await api.chatHistory();
      setMessages(hist);
      if (!data.ok && data.error) setError(data.error);
    } catch {
      setError("APIに接続できませんでした（Companion が起動しているか確認）");
    } finally {
      setStatus("idle");
    }
  };

  const clear = async () => {
    try { await api.chatClear(); } catch {}
    setMessages([]);
    setError(null);
  };

  return (
    <section className="tab-panel chat-panel">
      <header className="panel-head">
        <h2>チャット</h2>
        <span className="panel-sub">キリタンとおしゃべり</span>
        {messages.length > 0 && (
          <button className="secondary-btn" onClick={clear} style={{ marginLeft: "auto" }}>
            履歴消去
          </button>
        )}
      </header>

      <div className="chat-log" ref={logRef}>
        {messages.length === 0 && status === "idle" && (
          <div className="empty-state">
            <ChatIcon />
            <p>メッセージを送ってみてください</p>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`chat-msg ${m.role}`}>
            {m.role === "assistant" && <span className="chat-role">キリタン</span>}
            <div className="chat-bubble">{m.text}</div>
          </div>
        ))}
        {status === "thinking" && (
          <div className="chat-msg assistant">
            <span className="chat-role">キリタン</span>
            <div className="chat-bubble typing"><i /><i /><i /></div>
          </div>
        )}
      </div>

      {error && <p className="error-banner">⚠ {error}</p>}

      <form
        className="chat-input-row"
        onSubmit={(e) => { e.preventDefault(); send(); }}
      >
        <input
          className="chat-input"
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="メッセージを入力…"
          disabled={status === "thinking"}
        />
        <button
          type="submit"
          className="primary-btn send-btn"
          disabled={status === "thinking" || !input.trim()}
          aria-label="送信"
        >
          <SendIcon />
        </button>
      </form>
      <p className="note">※ 設定タブで AI プロバイダーとAPIキーを設定すると返答します</p>
    </section>
  );
}
