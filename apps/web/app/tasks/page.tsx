"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../lib/auth";

type Task = { id: string; title: string; description: string; currency: string; budgetMin: string | null; budgetMax: string | null; status: string };
type Feed = { items: Task[]; page: number; pageSize: number; hasMore: boolean };
const nav = [["/home","Home"],["/tasks","Task Feed"],["/post-task","Post Task"],["/applications","Applications"]];

export default function Page() {
  const { api } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const load = useCallback(async (nextPage: number) => {
    setLoading(true); setError(null);
    try {
      const result = await api<Feed>("/api/v1/tasks/feed?page=" + nextPage + "&pageSize=20");
      setTasks(result.items ?? []); setPage(result.page ?? nextPage); setHasMore(Boolean(result.hasMore));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load tasks.");
    } finally { setLoading(false); }
  }, [api]);
  useEffect(() => { void load(1); }, [load]);
  return <main className="main">
    <header className="header"><Link className="brand" href="/home">Task Marketplace</Link><nav className="nav">{nav.map(([href,label]) => <Link key={href} href={href}>{label}</Link>)}</nav></header>
    <section className="card" style={{ marginTop: 32 }}>
      <h1>Task Feed</h1>
      {loading ? <p className="muted">Loading tasks…</p> : error ? <p role="alert">{error} <button onClick={() => void load(page)}>Retry</button></p> : tasks.length === 0 ? <p className="muted">No public tasks are available on this page.</p> : <div>{tasks.map((task) => <article key={task.id} className="card" style={{ marginTop: 16 }}><h2>{task.title}</h2><p className="muted">{task.description}</p><p>{task.budgetMin ?? "—"} – {task.budgetMax ?? "—"} {task.currency}</p><p className="muted">{task.status}</p><Link href={"/tasks/" + task.id}>View task</Link></article>)}</div>}
      {!loading && !error && (page > 1 || hasMore) && <div style={{ display: "flex", gap: 12, marginTop: 20 }}>{page > 1 && <button onClick={() => void load(page - 1)}>Previous</button>}{hasMore && <button onClick={() => void load(page + 1)}>Next</button>}</div>}
    </section>
  </main>;
}
