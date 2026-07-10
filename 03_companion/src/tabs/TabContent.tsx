import { useState } from "react";
import TabMemo from "./TabMemo";
import TabBookmark from "./TabBookmark";
import TabNews from "./TabNews";
import TabPersonalNews from "./TabPersonalNews";
import { Segment } from "../controls";
import { BroadcastIcon, ExternalIcon, MemoIcon, RssIcon } from "../icons";

// 日常の「中身」をひとつのセクションに束ねる。個別画面の作り込みはフェーズ3で行う。
const SUBS = [
  { value: "memo", label: "メモ", icon: <MemoIcon /> },
  { value: "link", label: "リンク", icon: <ExternalIcon /> },
  { value: "rss", label: "RSS", icon: <RssIcon /> },
  { value: "pn", label: "個人ニュース", icon: <BroadcastIcon /> },
];

export default function TabContent() {
  const [sub, setSub] = useState("memo");
  return (
    <div>
      <div className="content-seg">
        <Segment options={SUBS} value={sub} onChange={setSub} />
      </div>
      <div className="content-sub">
        {sub === "memo" && <TabMemo />}
        {sub === "link" && <TabBookmark />}
        {sub === "rss" && <TabNews />}
        {sub === "pn" && <TabPersonalNews />}
      </div>
    </div>
  );
}
