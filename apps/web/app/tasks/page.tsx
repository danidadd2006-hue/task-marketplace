"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Task = { id: string; title: string; description: string; currency: string; budgetMin: string | null; budgetMax: string | null; status: string };

const nav = [["/home","Home"],["/tasks","Task Feed"],["/post-task","Post Task"],["/applications","Applications"],["/messages","Messages"],["/notifications","Notifications"],["/profile","Profile"],["/settings","Settings"]];

export default function Page() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    void fetch((process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3000") + "/api/v1/tasks/feed")
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("Unable to load tasks")))
      .then((value) => setTasks(Array.isArray(value) ? value : value.tasks ?? []))
      .catch(() => setTasks([]))
      .finally(() => setLoading(false));
  }, []);
  return (
    <main className="main">
      <header className="header"><Link className="brand" href="/home">Task Marketplace</Link><nav className="nav">{nav.map(([href,label]) => <Link key={href} href={href}>{label}</Link>)}</nav></header>
      <section className="card" style={{ marginTop: 32 }}>
        <h1>Task Feed</h1>
        {loading ? <p className="muted">Loading tasks…</p> : tasks.length === 0 ? <p className="muted">No public tasks are available.</p> : <div>{tasks.map((task) => <article key={task.id} className="card" style={{ marginTop: 16 }}><h2>{task.title}</h2><p className="muted">{task.description}</p><p>{task.budgetMin ?? "—"} – {task.budgetMax ?? "—"} {task.currency}</p><Link href={"/tasks/" + task.id}>View task</Link></article>)}</div>}
      </section>
    </main>
  );
}
