"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "../../lib/auth";

type Category = { id: string; name: string };
const nav = [["/home","Home"],["/tasks","Task Feed"],["/post-task","Post Task"],["/applications","Applications"]];

export default function Page() {
  const { user, api } = useAuth();
  const [categories, setCategories] = useState<Category[]>([]);
  const [loadingCategories, setLoadingCategories] = useState(true);
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdTaskId, setCreatedTaskId] = useState<string | null>(null);
  const [taskStatus, setTaskStatus] = useState<"DRAFT" | "PUBLISHED" | "RECEIVING_APPLICATIONS">("DRAFT");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [type, setType] = useState<"PHYSICAL" | "VIRTUAL">("PHYSICAL");
  const [duration, setDuration] = useState<"SHORT_TERM" | "LONG_TERM">("SHORT_TERM");
  const [budgetMin, setBudgetMin] = useState("");
  const [budgetMax, setBudgetMax] = useState("");
  const [locationDescription, setLocationDescription] = useState("");
  const [requirements, setRequirements] = useState("");

  useEffect(() => {
    let active = true;
    api<Category[]>("/api/v1/categories")
      .then((items) => { if (active) { setCategories(items); setCategoryId(items[0]?.id ?? ""); } })
      .catch((cause) => { if (active) setCategoryError(cause instanceof Error ? cause.message : "Unable to load categories."); })
      .finally(() => { if (active) setLoadingCategories(false); });
    return () => { active = false; };
  }, [api]);

  async function createTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError(null);
    try {
      const task = await api<{ id: string }>("/api/v1/tasks", {
        method: "POST",
        body: JSON.stringify({
          categoryId, title: title.trim(), description: description.trim(), type, duration,
          ...(budgetMin !== "" ? { budgetMin: Number(budgetMin) } : {}),
          ...(budgetMax !== "" ? { budgetMax: Number(budgetMax) } : {}),
          ...(type === "PHYSICAL" ? { locationDescription: locationDescription.trim() } : {}),
          ...(requirements.trim() ? { requirements: requirements.trim() } : {}),
        }),
      });
      setCreatedTaskId(task.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to create task.");
    } finally { setBusy(false); }
  }

  async function publishTask() {
    if (!createdTaskId) return;
    setBusy(true); setError(null);
    try {
      let currentStatus = taskStatus;
      if (currentStatus === "DRAFT") {
        await api("/api/v1/tasks/" + createdTaskId + "/publish", { method: "POST" });
        currentStatus = "PUBLISHED";
        setTaskStatus(currentStatus);
      }
      if (currentStatus === "PUBLISHED") {
        await api("/api/v1/tasks/" + createdTaskId + "/open-applications", { method: "POST" });
        currentStatus = "RECEIVING_APPLICATIONS";
        setTaskStatus(currentStatus);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Task was created, but publishing did not finish. Retry or check the task status.");
    } finally { setBusy(false); }
  }

  if (!user?.roles.includes("CLIENT")) return <main className="main"><section className="card"><h1>Post a task</h1><p className="muted">A CLIENT role is required to create tasks.</p><Link href="/tasks">Browse tasks</Link></section></main>;

  return <main className="main">
    <header className="header"><Link className="brand" href="/home">Task Marketplace</Link><nav className="nav">{nav.map(([href,label]) => <Link key={href} href={href}>{label}</Link>)}</nav></header>
    <section className="card" style={{ marginTop: 32 }}>
      <h1>Post a task</h1>
      <p className="muted">New tasks are saved as drafts. Publishing and opening applications are explicit server-side transitions.</p>
      {createdTaskId ? <div>
        <p>Draft created successfully.</p>
        <p className="muted">Task reference: {createdTaskId}</p>
        {taskStatus === "RECEIVING_APPLICATIONS" ? <p role="status">Task published and open for applications.</p> : <button disabled={busy} onClick={() => void publishTask()}>{busy ? "Publishing…" : taskStatus === "PUBLISHED" ? "Open applications" : "Publish and receive applications"}</button>}
        {taskStatus !== "DRAFT" && <p><Link href={"/tasks/" + createdTaskId}>View task details</Link></p>}
      </div> : <form onSubmit={(event) => void createTask(event)} style={{ display: "grid", gap: 14, maxWidth: 720 }}>
        {loadingCategories ? <p className="muted">Loading active categories…</p> : categoryError ? <p role="alert">{categoryError} <button type="button" onClick={() => { setLoadingCategories(true); setCategoryError(null); void api<Category[]>("/api/v1/categories").then((items) => { setCategories(items); setCategoryId(items[0]?.id ?? ""); }).catch((cause) => setCategoryError(cause instanceof Error ? cause.message : "Unable to load categories.")).finally(() => setLoadingCategories(false)); }}>Retry</button></p> : categories.length === 0 ? <p className="muted">No active categories are available. Task creation is unavailable until a category is configured.</p> : <>
          <label>Title<input required minLength={3} maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} /></label>
          <label>Description<textarea required maxLength={10000} rows={5} value={description} onChange={(e) => setDescription(e.target.value)} /></label>
          <label>Category<select required value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
          <label>Task type<select value={type} onChange={(e) => setType(e.target.value as "PHYSICAL" | "VIRTUAL")}><option value="PHYSICAL">Physical</option><option value="VIRTUAL">Virtual</option></select></label>
          <label>Duration<select value={duration} onChange={(e) => setDuration(e.target.value as "SHORT_TERM" | "LONG_TERM")}><option value="SHORT_TERM">Short term</option><option value="LONG_TERM">Long term</option></select></label>
          <label>Minimum budget<input type="number" min="0" step="0.01" value={budgetMin} onChange={(e) => setBudgetMin(e.target.value)} /></label>
          <label>Maximum budget<input type="number" min="0" step="0.01" value={budgetMax} onChange={(e) => setBudgetMax(e.target.value)} /></label>
          {type === "PHYSICAL" && <label>General location<input required maxLength={1000} value={locationDescription} onChange={(e) => setLocationDescription(e.target.value)} placeholder="Town or general area (avoid exact private addresses)" /></label>}
          <label>Requirements (optional)<textarea maxLength={10000} rows={3} value={requirements} onChange={(e) => setRequirements(e.target.value)} /></label>
          {error && <p role="alert">{error}</p>}
          <button type="submit" disabled={busy || loadingCategories || !categoryId}>{busy ? "Creating…" : "Create draft"}</button>
        </>}
      </form>}
      {error && createdTaskId && <p role="alert">{error}</p>}
    </section>
  </main>;
}
