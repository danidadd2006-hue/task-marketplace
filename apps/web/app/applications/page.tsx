"use client";

import Link from "next/link";
import { useAuth } from "../../lib/auth";

export default function Page() {
  const { user } = useAuth();
  const canApply = user?.roles.includes("WORKER") ?? false;
  return <main className="main">
    <header className="header"><Link className="brand" href="/home">Task Marketplace</Link><nav className="nav"><Link href="/tasks">Task Feed</Link><Link href="/post-task">Post Task</Link><Link href="/applications">Applications</Link></nav></header>
    <section className="card" style={{ marginTop: 32 }}>
      <h1>Applications</h1>
      {canApply ? <>
        <p className="muted">Find a public task and submit your proposal from its details page. The API verifies eligibility and uses your authenticated account as the applicant.</p>
        <p><Link href="/tasks">Browse tasks</Link></p>
      </> : <p className="muted">A WORKER role is required to submit applications. If your account has both CLIENT and WORKER roles, you can switch between posting and applying.</p>}
      <p className="muted">Application history is not exposed by the current API contract, so this page does not display a fabricated list.</p>
    </section>
  </main>;
}
