import { useState } from "react";

type Todo = { id: number; title: string; done: boolean };

export default function TabTodo() {
  const [todos, setTodos] = useState<Todo[]>([
    { id: 1, title: "レポート提出", done: false },
    { id: 2, title: "買い物", done: true },
  ]);
  const [input, setInput] = useState("");

  const add = () => {
    if (!input.trim()) return;
    setTodos((prev) => [
      ...prev,
      { id: Date.now(), title: input.trim(), done: false },
    ]);
    setInput("");
  };

  const toggle = (id: number) =>
    setTodos((prev) =>
      prev.map((t) => (t.id === id ? { ...t, done: !t.done } : t))
    );

  const remove = (id: number) =>
    setTodos((prev) => prev.filter((t) => t.id !== id));

  return (
    <section className="tab-panel">
      <h2 className="panel-title">TODO</h2>
      <form
        className="add-row"
        onSubmit={(e) => { e.preventDefault(); add(); }}
      >
        <input
          className="add-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="新しいタスクを追加…"
        />
        <button type="submit">追加</button>
      </form>
      <ul className="todo-list">
        {todos.map((t) => (
          <li key={t.id} className={`todo-item ${t.done ? "done" : ""}`}>
            <input
              type="checkbox"
              checked={t.done}
              onChange={() => toggle(t.id)}
            />
            <span className="todo-title">{t.title}</span>
            <button className="icon-btn" onClick={() => remove(t.id)}>✕</button>
          </li>
        ))}
      </ul>
      <p className="note">※ API連携は Phase B-3 で実装します</p>
    </section>
  );
}
