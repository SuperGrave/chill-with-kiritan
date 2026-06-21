import { useState, type ReactNode } from "react";
import "./App.css";
import TabChat from "./tabs/TabChat";
import TabTodo from "./tabs/TabTodo";
import TabMemo from "./tabs/TabMemo";
import TabBookmark from "./tabs/TabBookmark";
import TabSettings from "./tabs/TabSettings";
import TabStatus from "./tabs/TabStatus";
import TabDisplay from "./tabs/TabDisplay";
import {
  ChatIcon,
  TodoIcon,
  MemoIcon,
  BookmarkIcon,
  SettingsIcon,
  StatusIcon,
  DisplayIcon,
} from "./icons";

type Tab = "chat" | "todo" | "memo" | "bookmark" | "display" | "settings" | "status";

const TABS: { id: Tab; label: string; icon: ReactNode }[] = [
  { id: "chat",     label: "チャット", icon: <ChatIcon /> },
  { id: "todo",     label: "TODO",     icon: <TodoIcon /> },
  { id: "memo",     label: "メモ",     icon: <MemoIcon /> },
  { id: "bookmark", label: "リンク",   icon: <BookmarkIcon /> },
  { id: "display",  label: "表示",     icon: <DisplayIcon /> },
  { id: "settings", label: "設定",     icon: <SettingsIcon /> },
  { id: "status",   label: "状態",     icon: <StatusIcon /> },
];

// 各タブは hidden で出し分け（アンマウントしない）。
// タブを切り替えてもチャット履歴や入力途中の内容が保持される。
const PAGES: { id: Tab; fill?: boolean; node: ReactNode }[] = [
  { id: "chat",     fill: true, node: <TabChat /> },
  { id: "todo",     node: <TabTodo /> },
  { id: "memo",     node: <TabMemo /> },
  { id: "bookmark", node: <TabBookmark /> },
  { id: "display",  node: <TabDisplay /> },
  { id: "settings", node: <TabSettings /> },
  { id: "status",   node: <TabStatus /> },
];

function App() {
  const [active, setActive] = useState<Tab>("chat");

  return (
    <div className="app">
      <main className="tab-content">
        {PAGES.map((p) => (
          <div
            key={p.id}
            className={`tab-page ${p.fill ? "fill" : ""}`}
            hidden={active !== p.id}
          >
            {p.node}
          </div>
        ))}
      </main>

      <nav className="nav-bar">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`nav-btn ${active === t.id ? "active" : ""}`}
            onClick={() => setActive(t.id)}
          >
            {t.icon}
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

export default App;
