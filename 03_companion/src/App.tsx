import { useState } from "react";
import "./App.css";
import TabChat from "./tabs/TabChat";
import TabTodo from "./tabs/TabTodo";
import TabMemo from "./tabs/TabMemo";
import TabBookmark from "./tabs/TabBookmark";
import TabSettings from "./tabs/TabSettings";
import TabStatus from "./tabs/TabStatus";

type Tab = "chat" | "todo" | "memo" | "bookmark" | "settings" | "status";

const TABS: { id: Tab; label: string }[] = [
  { id: "chat",     label: "CHAT" },
  { id: "todo",     label: "TODO" },
  { id: "memo",     label: "MEMO" },
  { id: "bookmark", label: "BOOKMARK" },
  { id: "settings", label: "SETTINGS" },
  { id: "status",   label: "STATUS" },
];

function App() {
  const [active, setActive] = useState<Tab>("chat");

  return (
    <div className="app">
      {/* Tab bar */}
      <nav className="tab-bar">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`tab-btn ${active === t.id ? "active" : ""}`}
            onClick={() => setActive(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {/* Tab content */}
      <main className="tab-content">
        {active === "chat"     && <TabChat />}
        {active === "todo"     && <TabTodo />}
        {active === "memo"     && <TabMemo />}
        {active === "bookmark" && <TabBookmark />}
        {active === "settings" && <TabSettings />}
        {active === "status"   && <TabStatus />}
      </main>
    </div>
  );
}

export default App;
