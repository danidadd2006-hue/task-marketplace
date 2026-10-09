"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type PublicTaskDetails = {
  id: string;
  title: string;
  description: string;
  type: "PHYSICAL" | "VIRTUAL";
  duration: "SHORT_TERM" | "LONG_TERM";
  status: "PUBLISHED" | "RECEIVING_APPLICATIONS";
  currency: string;
  budgetMin: string | null;
  budgetMax: string | null;
  expectedCompletionAt: string | null;
  requirements: string | null;
  location: {
    country: { id: string; name: string; code: string };
    region: { id: string; name: string } | null;
    city: { id: string; name: string } | null;
    area: string | null;
  } | null;
  category: { id: string; name: string };
  requirementsList: Array<{ id: string; name: string; value: string | null }>;
  attachments: Array<{ id: string; fileName: string | null; fileType: string | null; fileSize: number | null }>;
};

const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3000";

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const [task, setTask] = useState<PublicTaskDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void params.then(({ id }) => {
      if (active) setTaskId(id);
      return fetch(apiBase + "/api/v1/tasks/" + id);
    })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("Task not found")))
      .then((data: PublicTaskDetails) => { if (active) setTask(data); })
      .catch((reason: Error) => { if (active) setError(reason.message); });
    return () => { active = false; };
  }, [params]);

  return (
    <main className="main">
      <header className="header">
        <Link className="brand" href="/home">Task Marketplace</Link>
        <nav className="nav"><Link href="/tasks">Task Feed</Link><Link href="/home">Home</Link></nav>
      </header>
      <section className="card" style={{ marginTop: 32 }}>
        {error ? <p className="muted">{error}</p> : !task ? <p className="muted">Loading task…</p> : (
          <>
            <p className="muted">{task.category.name} · {task.status}</p>
            <h1>{task.title}</h1>
            <p>{task.description}</p>
            <p><strong>Budget:</strong> {task.budgetMin ?? "—"} – {task.budgetMax ?? "—"} {task.currency}</p>
            <p><strong>Type:</strong> {task.type} · <strong>Duration:</strong> {task.duration}</p>
            {task.location && <p><strong>Location:</strong> {[task.location.area, task.location.city?.name, task.location.region?.name, task.location.country.name].filter(Boolean).join(", ")}</p>}
            {task.expectedCompletionAt && <p><strong>Expected completion:</strong> {new Date(task.expectedCompletionAt).toLocaleString()}</p>}
            {task.requirements && <><h2>Requirements</h2><p>{task.requirements}</p></>}
            {task.requirementsList.length > 0 && <><h2>Task requirements</h2><ul>{task.requirementsList.map((item) => <li key={item.id}>{item.name}{item.value ? ": " + item.value : ""}</li>)}</ul></>}
            {task.attachments.length > 0 && <><h2>Attachments</h2><ul>{task.attachments.map((item) => <li key={item.id}>{item.fileName ?? "Attachment"}{item.fileType ? " · " + item.fileType : ""}</li>)}</ul></>}
          </>
        )}
      </section>
    </main>
  );
}
