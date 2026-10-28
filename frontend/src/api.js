import { supabase } from "./supabase";
const BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";

export async function api(path, method = "GET", body) {
  const { data: { session } } = await supabase.auth.getSession();
  const r = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) {
    let msg = await r.text();
    try { const j = JSON.parse(msg); msg = typeof j.detail === "string" ? j.detail : msg; } catch {}
    throw new Error(msg);
  }
  return r.json();
}
