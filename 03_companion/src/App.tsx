import { useState, type ReactNode } from "react";
import "./App.css";
import TabHome from "./tabs/TabHome";
import TabMemo from "./tabs/TabMemo";
import TabBookmark from "./tabs/TabBookmark";
import TabPersonalNews from "./tabs/TabPersonalNews";
import TabSettings from "./tabs/TabSettings";
import TabStatus from "./tabs/TabStatus";
import {
  HomeIcon,
  MemoIcon,
  BookmarkIcon,
  SettingsIcon,
  StatusIcon,
} from "./icons";

type Tab = "home" | "memo" | "bookmark" | "personalNews" | "settings" | "status";

const TABS: { id: Tab; label: string; icon: ReactNode }[] = [
  { id: "home",     label: "ホーム",   icon: <HomeIcon /> },
  { id: "memo",     label: "メモ",     icon: <MemoIcon /> },
  { id: "bookmark", label: "リンク",   icon: <BookmarkIcon /> },
  { id: "personalNews", label: "ニュース", icon: <BookmarkIcon /> },
  { id: "settings", label: "設定",     icon: <SettingsIcon /> },
  { id: "status",   label: "状態",     icon: <StatusIcon /> },
];

// 各タブは hidden で出し分け（アンマウントしない）。
const PAGES: { id: Tab; fill?: boolean; node: ReactNode }[] = [
  { id: "home",     node: <TabHome /> },
  { id: "memo",     node: <TabMemo /> },
  { id: "bookmark", node: <TabBookmark /> },
  { id: "personalNews", node: <TabPersonalNews /> },
  { id: "settings", node: <TabSettings /> },
  { id: "status",   node: <TabStatus /> },
];

function App() {
  const [active, setActive] = useState<Tab>("home");

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
