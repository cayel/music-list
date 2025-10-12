// Centralisation des appels API
// Base déterminée par variable d'environnement VITE_API_BASE sinon même origine

// Déclaration minimale pour TS (si pas déjà définie ailleurs)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
interface ImportMetaEnv { VITE_API_BASE?: string }
// eslint-disable-next-line @typescript-eslint/no-unused-vars
interface ImportMeta { env: ImportMetaEnv }

// Typage souple pour éviter conflits : Vite fournit import.meta.env à l'exécution
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// Lecture runtime optionnelle (injection future via window.__APP_CONFIG__)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const runtimeBase = (typeof window !== 'undefined' && (window as any).__APP_CONFIG__?.API_BASE) ? (window as any).__APP_CONFIG__.API_BASE as string : undefined;
const baseEnv = (import.meta as any)?.env?.VITE_API_BASE as string | undefined;
const base = (runtimeBase || baseEnv || '').replace(/\/$/,'');

if (typeof window !== 'undefined') {
  if (!base) {
    // eslint-disable-next-line no-console
    console.warn('[api] Aucune base API définie: appels envoyés en same-origin. Définissez VITE_API_BASE ou ?api=');
  } else {
    // eslint-disable-next-line no-console
    console.debug('[api] Base API utilisée =', base, '(runtime=', runtimeBase || 'none', 'env=', baseEnv || 'none', ')');
  }
}

export function apiUrl(path: string){
  if (path.startsWith('http')) return path;
  if (base) return base + path;
  return path; // supposer même origine
}

function withAdmin(init?: RequestInit): RequestInit {
  const token = (typeof localStorage !== 'undefined') ? localStorage.getItem('ml-admin-token') : null;
  if (!token) return init || {};
  return { ...(init||{}), headers: { 'x-admin-token': token, ...(init?.headers||{}) } };
}

export async function apiFetch<T=any>(path: string, init?: RequestInit): Promise<T> {
  const finalInit = withAdmin(init);
  const res = await fetch(apiUrl(path), finalInit);
  let data: any = null;
  try { data = await res.json(); } catch { /* ignore non-json */ }
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data as T;
}

export async function getAlbums(){ return apiFetch('/api/albums'); }

export function postJson<T=any>(path:string, body:unknown, extra?:RequestInit){
  return apiFetch<T>(path, { method:'POST', headers:{ 'Content-Type':'application/json', ...(extra?.headers||{})}, body: JSON.stringify(body), ...extra });
}
export function putJson<T=any>(path:string, body:unknown, extra?:RequestInit){
  return apiFetch<T>(path, { method:'PUT', headers:{ 'Content-Type':'application/json', ...(extra?.headers||{})}, body: JSON.stringify(body), ...extra });
}
export function patchJson<T=any>(path:string, body?:unknown, extra?:RequestInit){
  return apiFetch<T>(path, { method:'PATCH', headers:{ 'Content-Type':'application/json', ...(extra?.headers||{})}, body: body!==undefined? JSON.stringify(body): undefined, ...extra });
}
export function deleteReq<T=any>(path:string, extra?:RequestInit){
  return apiFetch<T>(path, { method:'DELETE', ...(extra||{}) });
}
