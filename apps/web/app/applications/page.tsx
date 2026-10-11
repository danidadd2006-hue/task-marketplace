"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../lib/auth";

type Application = {
  id: string;
  proposedPrice: string;
  estimatedCompletionAt: string | null;
  message: string | null;
  qualifications: string | null;
  questions: string | null;
  status: string;
  createdAt: string;
  task: { id: string; title: string; status: string; currency: string; createdAt: string };
  attachments: { id: string; fileName: string | null; fileType: string | null; fileSize: number | null; createdAt: string }[];
};
type ApplicationPage = { items: Application[]; page: number; pageSize: number; hasMore: boolean };

export default function Page() {
  const { user, api, loading: authLoading } = useAuth();
  const canApply = user?.roles.includes("WORKER") ?? false;
  const [items, setItems] = useState<Application[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadApplications = useCallback(async (requestedPage: number, append: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const result = await api<ApplicationPage>(`/api/v1/applications/me?page=${requestedPage}&pageSize=20`);
      setItems(current => append ? [...current, ...result.items] : result.items);
      setPage(result.page);
      setHasMore(result.hasMore);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load your applications.");
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    if (!authLoading && canApply) void loadApplications(1, false);
  }, [authLoading, canApply, loadApplications]);

  return <main className="main">
    <header className="header"><Link className="brand" href="/home">Task Marketplace</Link><nav className="nav"><Link href="/tasks">Task Feed</Link><Link href="/post-task">Post Task</Link><Link href="/applications">Applications</Link></nav></header>
    <section className="card" style={{ marginTop: 32 }}>
      <h1>Applications</h1>
      {authLoading ? <p className="muted">Loading your account…</p> : !canApply ? <p className="muted">A WORKER role is required to view and submit applications. Accounts with both CLIENT and WORKER roles can use both workflows.</p> : <>
        <p className="muted">Your submitted proposals and their current statuses.</p>
        {error ? <div role="alert"><p className="muted">{error}</p><button type="button" onClick={() => void loadApplications(1, false)} disabled={loading}>{loading ? "Retrying…" : "Retry"}</button></div> : null}
        {loading && items.length === 0 ? <p className="muted">Loading applications…</p> : null}
        {!loading && !error && items.length === 0 ? <><p className="muted">You have not submitted any applications yet.</p><p><Link href="/tasks">Browse tasks</Link></p></> : null}
        <div style={{ display: "grid", gap: 16, marginTop: 16 }}>
          {items.map(application => <article className="card" key={application.id}>
            <h2 style={{ fontSize: 18, marginBottom: 8 }}><Link href={`/tasks/${encodeURIComponent(application.task.id)}`}>{application.task.title}</Link></h2>
            <p className="muted">Status: {application.status.replaceAll("_", " ")} · Task: {application.task.status.replaceAll("_", " ")}</p>
            <p>Proposed price: {application.proposedPrice} {application.task.currency}</p>
            <p className="muted">Submitted {new Date(application.createdAt).toLocaleString()}</p>
            {application.estimatedCompletionAt ? <p>Estimated completion: {new Date(application.estimatedCompletionAt).toLocaleDateString()}</p> : null}
            {application.message ? <p>{application.message}</p> : null}
            {application.qualifications ? <p className="muted">Qualifications: {application.qualifications}</p> : null}
            {application.questions ? <p className="muted">Questions: {application.questions}</p> : null}
            {application.attachments.length ? <p className="muted">Attachments: {application.attachments.map(file => file.fileName ?? file.fileType ?? "Attachment").join(", ")}</p> : null}
          </article>)}
        </div>
        {hasMore ? <button type="button" disabled={loading} onClick={() => void loadApplications(page + 1, true)}>{loading ? "Loading…" : "Load more applications"}</button> : null}
      </>}
    </section>
  </main>;
}
