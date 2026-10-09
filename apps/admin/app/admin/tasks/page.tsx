"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAdminAuth } from "../../lib/auth";

type Task={id:string;title:string;description:string;currency:string;budgetMin:string|null;budgetMax:string|null;status:string};

export default function Page(){
  const {api,authorized}=useAdminAuth();
  const [tasks,setTasks]=useState<Task[]>([]);
  const [error,setError]=useState<string|null>(null);
  useEffect(()=>{if(!authorized)return; void api<{items:Task[]}>("/api/v1/tasks/feed").then(r=>setTasks(r.items??[])).catch(e=>setError(e instanceof Error?e.message:"Unable to load tasks."));},[api,authorized]);
  return <main className="main"><header className="header"><Link className="brand" href="/admin">Admin</Link><nav className="nav"><Link href="/admin">Dashboard</Link><Link href="/admin/tasks">Tasks</Link><Link href="/admin/users">Users</Link><Link href="/admin/moderation">Moderation</Link><Link href="/admin/reports">Reports</Link><Link href="/admin/disputes">Disputes</Link><Link href="/admin/verification">Verification</Link><Link href="/admin/payments">Payments</Link><Link href="/admin/tokens">Tokens</Link><Link href="/admin/analytics">Analytics</Link></nav></header><section className="card" style={{marginTop:32}}><h1>Public Tasks</h1><p className="muted">Read-only view of the same public task contract exposed to marketplace clients.</p>{error?<p className="muted">{error}</p>:tasks.length===0?<p className="muted">No public tasks are available.</p>:tasks.map(t=><article key={t.id} className="card" style={{marginTop:16}}><h2>{t.title}</h2><p className="muted">{t.description}</p><p>{t.budgetMin??"—"} – {t.budgetMax??"—"} {t.currency} · {t.status}</p><Link href={"/admin/tasks/"+t.id}>View details</Link></article>)}</section></main>;
}
