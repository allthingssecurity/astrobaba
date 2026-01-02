import http from './simpleHttp';

type KundliResponse = any;
type DivisionalResponse = any;

const PROKERALA_AUTH_BASE = 'https://api.prokerala.com';
const PROKERALA_API_BASE = (import.meta as any).env?.VITE_PROKERALA_BASE || 'https://api.prokerala.com/v2';

let cachedToken: { access_token: string; exp: number } | null = null;

async function getToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && now < cachedToken.exp - 30) return cachedToken.access_token;
  const clientId = (import.meta as any).env?.VITE_PROKERALA_CLIENT_ID;
  const clientSecret = (import.meta as any).env?.VITE_PROKERALA_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('Missing Prokerala credentials');
  const params = new URLSearchParams();
  params.set('grant_type', 'client_credentials');
  params.set('client_id', clientId);
  params.set('client_secret', clientSecret);
  const res = await fetch(`${PROKERALA_AUTH_BASE}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  if (!res.ok) throw new Error('Token fetch failed');
  const data = await res.json();
  cachedToken = { access_token: data.access_token, exp: now + (data.expires_in || 3600) };
  return cachedToken.access_token;
}

export async function kundli(coordinates: string, dt_iso: string, ayanamsa = 1, la = 'en'): Promise<KundliResponse> {
  const token = await getToken();
  const url = new URL(`${PROKERALA_API_BASE}/astrology/kundli/advanced`);
  url.searchParams.set('coordinates', coordinates);
  url.searchParams.set('datetime', dt_iso);
  url.searchParams.set('ayanamsa', String(ayanamsa));
  url.searchParams.set('la', la);
  let r = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
  if (r.status === 403) {
    const u2 = new URL(`${PROKERALA_API_BASE}/astrology/kundli`);
    u2.searchParams.set('coordinates', coordinates);
    u2.searchParams.set('datetime', dt_iso);
    u2.searchParams.set('ayanamsa', String(ayanamsa));
    u2.searchParams.set('la', la);
    r = await fetch(u2.toString(), { headers: { Authorization: `Bearer ${token}` } });
  }
  if (!r.ok) throw new Error('Kundli failed');
  return r.json();
}

export async function divisional(coordinates: string, dt_iso: string, chart_type: string, ayanamsa = 1, la = 'en'): Promise<DivisionalResponse> {
  const token = await getToken();
  const url = new URL(`${PROKERALA_API_BASE}/astrology/divisional-planet-position`);
  url.searchParams.set('coordinates', coordinates);
  url.searchParams.set('datetime', dt_iso);
  url.searchParams.set('chart_type', chart_type);
  url.searchParams.set('ayanamsa', String(ayanamsa));
  url.searchParams.set('la', la);
  const r = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error('Divisional failed');
  return r.json();
}

export async function shadbalaPdf(params: Record<string, string>): Promise<Blob> {
  const token = await getToken();
  const url = new URL(`${PROKERALA_API_BASE}/report/personal-reading/instant`);
  for (const [k,v] of Object.entries(params)) url.searchParams.set(k, v);
  const r = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}`, Accept: 'application/pdf' } });
  if (!r.ok) throw new Error('Shadbala PDF failed');
  return r.blob();
}

