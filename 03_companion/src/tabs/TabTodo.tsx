import { useEffect, useState } from "react";
import { PlusIcon, TodoIcon, XIcon } from "../icons";
import { api, type Todo } from "../api";

export default function TabTodo() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    api.todos().then(setTodos).catch(() => setError("APIに接続できませんでした"));

  useEffect(() => { load(); }, []);

  const add = async () => {
    if (!input.trim()) return;
    const title = input.trim();
    setInput("");
    try { await api.addTodo(title); await load(); }
    catch { setError("追加に失敗しました"); }
  };

  const toggle = async (t: Todo) => {
    setTodos((prev) => prev.map((x) => (x.id === t.id ? { ...x, done: !x.done } : x)));
    try { await api.updateTodo(t.id, { done: !t.done }); } catch { load(); }
  };

  const remove = async (id: string) => {
    setTodos((prev) => prev.filter((t) => t.id !== id));
    try { await api.deleteTodo(id); } catch { load(); }
  };

  const remaining = todos.filter((t) => !t.done).length;

  return (
    <section className="tab-panel">
      <header className="panel-head">
        <h2>TODO</h2>
        <span className="count-badge">残り {remaining}</span>
      </header>

      <form className="add-row" onSubmit={(e) => { e.preventDefault(); add(); }}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="新しいタスクを追加…"
        />
        <button type="submit" disabled={!input.trim()}>
          <PlusIcon />
          追加
        </button>
      </form>

      {error && <p className="error-banner">⚠ {error}</p>}

      {todos.length === 0 ? (
        <div className="empty-state">
          <TodoIcon />
          <p>タスクはありません</p>
        </div>
      ) : (
        <ul className="todo-list">
          {todos.map((t) => (
            <li key={t.id} className={`todo-item ${t.done ? "done" : ""}`}>
              <input
                type="checkbox"
                className="todo-check"
                checked={t.done}
                onChange={() => toggle(t)}
              />
              <span className="todo-title">{t.title}</span>
              <button
                className="icon-btn danger"
                onClick={() => remove(t.id)}
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
