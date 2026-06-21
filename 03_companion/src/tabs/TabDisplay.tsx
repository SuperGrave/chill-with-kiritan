import { useEffect, useState } from "react";
import { CheckIcon, PlusIcon, XIcon } from "../icons";
import { api, type UiPreset, type UiState } from "../api";

// Display-settings + preset manager. The overlay (02) pushes its current
// layout/settings to /api/ui; here the user snapshots them as named presets and
// applies them back. "Apply" sets the live ui, which the overlay then renders.
export default function TabDisplay() {
  const [ui, setUi] = useState<UiState | null>(null);
  const [presets, setPresets] = useState<UiPreset[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameText, setRenameText] = useState("");

  const load = async () => {
    try {
      const u = await api.getUi();
      setUi(u);
      setPresets(u.presets);
      setError(null);
    } catch {
      setError("APIに接続できませんでした（Companion が起動しているか確認）");
    }
  };

  useEffect(() => {
    load();
    const id = setInterval(load, 4000);
    return () => clearInterval(id);
  }, []);

  const hasLiveUi = ui && ui.settings && Object.keys(ui.settings).length > 0;

  const saveCurrent = async () => {
    const nm = name.trim() || `プリセット ${presets.length + 1}`;
    setName("");
    try { await api.createPreset(nm); await load(); }
    catch { setError("保存に失敗しました"); }
  };

  const apply = async (id: string) => {
    try { await api.applyPreset(id); await load(); }
    catch { setError("適用に失敗しました"); }
  };

  const overwrite = async (id: string) => {
    if (!ui) return;
    try { await api.overwritePreset(id, ui.layout, ui.settings); await load(); }
    catch { setError("更新に失敗しました"); }
  };

  const remove = async (id: string) => {
    setPresets((prev) => prev.filter((p) => p.id !== id));
    try { await api.deletePreset(id); await load(); }
    catch { load(); }
  };

  const commitRename = async (id: string) => {
    const nm = renameText.trim();
    setRenaming(null);
    if (!nm) return;
    try { await api.renamePreset(id, nm); await load(); }
    catch { setError("名前変更に失敗しました"); }
  };

  return (
    <section className="tab-panel">
      <header className="panel-head">
        <h2>表示設定</h2>
        <span className="panel-sub">壁紙オーバーレイのレイアウトをプリセット管理</span>
      </header>

      {!hasLiveUi && (
        <p className="note">
          オーバーレイ(02)がまだ設定を送信していません。壁紙UIを一度起動すると現在の設定がここに同期されます。
        </p>
      )}

      <form className="add-row" onSubmit={(e) => { e.preventDefault(); saveCurrent(); }}>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="プリセット名（現在の表示を保存）"
        />
        <button type="submit">
          <PlusIcon />
          現在を保存
        </button>
      </form>

      {error && <p className="error-banner">⚠ {error}</p>}

      {presets.length === 0 ? (
        <div className="empty-state">
          <p>プリセットはまだありません</p>
        </div>
      ) : (
        <ul className="preset-list">
          {presets.map((p) => {
            const active = ui?.activePresetId === p.id;
            return (
              <li key={p.id} className={`preset-item ${active ? "active" : ""}`}>
                {renaming === p.id ? (
                  <input
                    autoFocus
                    className="preset-rename"
                    value={renameText}
                    onChange={(e) => setRenameText(e.target.value)}
                    onBlur={() => commitRename(p.id)}
                    onKeyDown={(e) => { if (e.key === "Enter") commitRename(p.id); }}
                  />
                ) : (
                  <span
                    className="preset-name"
                    onDoubleClick={() => { setRenaming(p.id); setRenameText(p.name); }}
                    title="ダブルクリックで名前変更"
                  >
                    {active && <CheckIcon />} {p.name}
                  </span>
                )}
                <div className="preset-actions">
                  <button className="secondary-btn" onClick={() => apply(p.id)}>適用</button>
                  <button className="secondary-btn" onClick={() => overwrite(p.id)} title="現在の表示で上書き">上書</button>
                  <button className="secondary-btn" onClick={() => { setRenaming(p.id); setRenameText(p.name); }}>名前</button>
                  <button className="icon-btn danger" onClick={() => remove(p.id)} aria-label="削除"><XIcon /></button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <p className="note">
        ※ 細かなスライダー調整は壁紙オーバーレイ側の設定パネルで行い、その結果が Companion に保存されます。
        ここでは名前付きプリセットの保存・適用・削除・名前変更ができます。
      </p>
    </section>
  );
}
