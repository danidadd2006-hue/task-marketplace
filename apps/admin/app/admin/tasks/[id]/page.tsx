"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAdminAuth } from "../../../../lib/auth";

type Task={id:string;title:string;description:string;type:string;duration:string;status:string;currency:string;budgetMin:string|null;budgetMax:string|null;expectedCompletionAt:string|null;requirements:string|null;location:{country:{name:string;code:string};region:{name:string}|null;city:{name:string}|null;area:string|null}|null;category:{name:string};requirementsList:Array<{id:string;name:string;value:string|null}>;attachments:Array<{id:string;fileName:string|null;fileType:string|null}>};

export default function Page({params}:{params:Promise<{id:string}>}){
  const {api,authorized}=useAdminAuth();
  const [task,setTask]=useState<Task|null>(null);
  const [error,setError]=useState<string|null>(null);\n  const [taskId,setTaskId]=useState<string|null>(null);
  useEffect(()=>{void params.then(({id})=>setTaskId(id));},[params]);
  useEffect(()=>{if(!authorized||!taskId)return;void api<Task>("/api/v1/tasks/"+taskId).then(setTask).catch(e=>setError(e instanceof Error?e.message:"Task not found."));},[api,authorized,taskId]);
  const location=task?.location?[task.location.area,task.location.city?.name,task.location.region?.name,task.location.country.name].filter(Boolean).join(", "):null;
  return <main className="main"><header className="header"><Link className="brand" href="/admin">Admin</Link><nav className="nav"><Link href="/admin">Dashboard</Link><Link href="/admin/tasks">Tasks</Link><Link href="/admin/users">Users</Link><Link href="/admin/moderation">Moderation</Link><Link href="/admin/reports">Reports</Link><Link href="/admin/disputes">Disputes</Link><Link href="/admin/verification">Verification</Link><Link href="/admin/payments">Payments</Link><Link href="/admin/tokens">Tokens</Link><Link href="/admin/analytics">Analytics</Link></nav></header><section className="card" style={{marginTop:32}}><Link href="/admin/tasks">← Tasks</Link>{error?<p className="muted">{error}</p>:!task?<p className="muted">Loading task…</p>:<><p className="muted">{task.category.name} · {task.status}</p><h1>{task.title}</h1><p>{task.description}</p><p><strong>Budget:</strong> {task.budgetMin??"—"} – {task.budgetMax??"—"} {task.currency}</p><p><strong>Type:</strong> {task.type} · <strong>Duration:</strong> {task.duration}</p>{location&&<p><strong>Public location:</strong> {location}</p>}{task.expectedCompletionAt&&<p><strong>Expected completion:</strong> {new Date(task.expectedCompletionAt).toLocaleString()}</p>}{task.requirements&&<><h2>Requirements</h2><p>{task.requirements}</p></>}{task.requirementsList.length>0&&<><h2>Task requirements</h2><ul>{task.requirementsList.map(i=><li key={i.id}>{i.name}{i.value?": "+i.value:""}</li>)}</ul></>}{task.attachments.length>0&&<><h2>Attachments</h2><ul>{task.attachments.map(i=><li key={i.id}>{i.fileName??"Attachment"}{i.fileType?" · "+i.fileType:""}</li>)}</ul></>}</>}</section></main>;
}
