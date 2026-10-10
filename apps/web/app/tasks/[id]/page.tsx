"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "../../../lib/auth";

type PublicTaskDetails = {
  id: string; title: string; description: string;
  type: "PHYSICAL" | "VIRTUAL"; duration: "SHORT_TERM" | "LONG_TERM";
  status: "PUBLISHED" | "RECEIVING_APPLICATIONS";
  currency: string; budgetMin: string | null; budgetMax: string | null;
  expectedCompletionAt: string | null; requirements: string | null;
  location: { country: { id: string; name: string; code: string }; region: { id: string; name: string } | null; city: { id: string; name: string } | null; area: string | null } | null;
  category: { id: string; name: string };
  requirementsList: Array<{ id: string; name: string; value: string | null }>;
  attachments: Array<{ id: string; fileName: string | null; fileType: string | null; fileSize: number | null }>;
};

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { user, api } = useAuth();
  const [task, setTask] = useState<PublicTaskDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [price, setPrice] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [applicationSubmitted, setApplicationSubmitted] = useState(false);

  useEffect(() => {
    let active = true;
    void params.then(({ id }) => {
      if (active) setTaskId(id);
      return api<PublicTaskDetails>("/api/v1/tasks/" + encodeURIComponent(id));
    }).then((data) => { if (active) setTask(data); })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "Unable to load task."); });
    return () => { active = false; };
  }, [api, params]);

  async function submitApplication(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!taskId) return;
    setBusy(true); setError(null);
    try {
      await api("/api/v1/tasks/" + encodeURIComponent(taskId) + "/applications", {
        method: "POST",
        body: JSON.stringify({ proposedPrice: Number(price), ...(message.trim() ? { message: message.trim() } : {}) }),
      });
      setApplicationSubmitted(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to submit application.");
    } finally { setBusy(false); }
  }

  return <main className="main">
    <header className="header"><Link className="brand" href="/home">Task Marketplace</Link><nav className="nav"><Link href="/tasks">Task Feed</Link><Link href="/applications">Applications</Link><Link href="/post-task">Post Task</Link></nav></header>
    <section className="card" style={{ marginTop: 32 }}>
      {error && !task ? <p role="alert">{error} <Link href="/tasks">Return to task feed</Link></p> : !task ? <p className="muted">Loading task…</p> : <>
        <p className="muted">{task.category.name} · {task.status}</p>
        <h1>{task.title}</h1><p>{task.description}</p>
        <p><strong>Budget:</strong> {task.budgetMin ?? "—"} – {task.budgetMax ?? "—"} {task.currency}</p>
        <p><strong>Type:</strong> {task.type} · <strong>Duration:</strong> {task.duration}</p>
        {task.location && <p><strong>Location:</strong> {[task.location.area, task.location.city?.name, task.location.region?.name, task.location.country.name].filter(Boolean).join(", ")}</p>}
        {task.expectedCompletionAt && <p><strong>Expected completion:</strong> {new Date(task.expectedCompletionAt).toLocaleString()}</p>}
        {task.requirements && <><h2>Requirements</h2><p>{task.requirements}</p></>}
        {task.requirementsList.length > 0 && <><h2>Task requirements</h2><ul>{task.requirementsList.map((item) => <li key={item.id}>{item.name}{item.value ? ": " + item.value : ""}</li>)}</ul></>}
        {task.attachments.length > 0 && <><h2>Attachments</h2><ul>{task.attachments.map((item) => <li key={item.id}>{item.fileName ?? "Attachment"}{item.fileType ? " · " + item.fileType : ""}</li>)}</ul></>}
        {user?.roles.includes("WORKER") && (task.status === "PUBLISHED" || task.status === "RECEIVING_APPLICATIONS") && <section style={{ marginTop: 28, borderTop: "1px solid #e5e7eb", paddingTop: 20 }}>
          <h2>Apply for this task</h2>
          {applicationSubmitted ? <p role="status">Application submitted. Your authenticated account was used as the applicant.</p> : <form onSubmit={(event) => void submitApplication(event)} style={{ display: "grid", gap: 12, maxWidth: 560 }}>
            <label>Proposed price ({task.currency})<input required type="number" min="0" step="0.01" value={price} onChange={(event) => setPrice(event.target.value)} /></label>
            <label>Message (optional)<textarea maxLength={10000} rows={3} value={message} onChange={(event) => setMessage(event.target.value)} /></label>
            <p className="muted">The server checks task eligibility, duplicate applications, account role, and any required token cost.</p>
            {error && <p role="alert">{error}</p>}
            <button type="submit" disabled={busy || price.trim() === ""}>{busy ? "Submitting…" : "Submit application"}</button>
          </form>}
        </section>}
        {!user?.roles.includes("WORKER") && <p className="muted">A WORKER role is required to apply. Accounts may hold both CLIENT and WORKER roles.</p>}
      </>}
      {error && task && <p role="alert">{error}</p>}
    </section>
  </main>;
}
