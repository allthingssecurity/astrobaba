/*
 Cloudflare Worker proxy for Parasara Hora AI
 - Keeps API secrets server-side
 - Exposes /api endpoints compatible with the frontend
 - Free tier friendly
*/

export interface BirthInput {
  date: string;
  time: string; // HH:MM or HH:MM:SS
  timezone?: string; // +HH:MM
  latitude?: number;
  longitude?: number;
  location?: string;
  ayanamsa?: number; // default 1 (Lahiri)
  la?: string; // language
}

export interface ComputeRequest {
  birth: BirthInput;
  include_divisional?: string[];
  include_transits?: boolean;
  transit_datetime?: string | null;
}

type Env = {
  PROKERALA_CLIENT_ID: string;
  PROKERALA_CLIENT_SECRET: string;
  PROKERALA_BASE_URL?: string;
  LOCATIONIQ_KEY?: string;
  OPENAI_API_KEY?: string;
};

const PROKERALA_AUTH_BASE = 'https://api.prokerala.com';

const RASI_EN: Record<string, string> = {
  Mesha: 'Aries', Vrishabha: 'Taurus', Vrishabh: 'Taurus', Mithuna: 'Gemini',
  Karka: 'Cancer', 'Karkaṭa': 'Cancer', Simha: 'Leo', Kanya: 'Virgo', Tula: 'Libra',
  Vrischika: 'Scorpio', Vrichika: 'Scorpio', Dhanu: 'Sagittarius', Makara: 'Capricorn',
  Kumbha: 'Aquarius', Meena: 'Pisces'
};

function json(data: any, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*', ...headers },
  });
}

function err(detail: string, status = 400): Response {
  return json({ detail }, status);
}

function formatOffset(seconds: number): string {
  const sign = seconds >= 0 ? '+' : '-';
  const sec = Math.abs(seconds);
  const hh = Math.floor(sec / 3600);
  const mm = Math.floor((sec % 3600) / 60);
  return `${sign}${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

async function geocodeLocation(q: string, env: Env): Promise<{ latitude: number; longitude: number; display_name?: string; timezone?: string } | null> {
  if (env.LOCATIONIQ_KEY) {
    try {
      const u = new URL('https://us1.locationiq.com/v1/search');
      u.searchParams.set('key', env.LOCATIONIQ_KEY);
      u.searchParams.set('q', q);
      u.searchParams.set('format', 'json');
      u.searchParams.set('limit', '1');
      const r = await fetch(u);
      if (r.ok) {
        const arr = await r.json() as any[];
        if (arr && arr[0]) {
          const it = arr[0];
          return { latitude: parseFloat(it.lat), longitude: parseFloat(it.lon), display_name: it.display_name };
        }
      }
    } catch {}
  }
  // Nominatim
  try {
    const u = new URL('https://nominatim.openstreetmap.org/search');
    u.searchParams.set('q', q);
    u.searchParams.set('format', 'json');
    u.searchParams.set('limit', '1');
    const r = await fetch(u, { headers: { 'User-Agent': 'parasara-hora-ai/1.0' } });
    if (r.ok) {
      const arr = await r.json() as any[];
      if (arr && arr[0]) {
        const it = arr[0];
        return { latitude: parseFloat(it.lat), longitude: parseFloat(it.lon), display_name: it.display_name };
      }
    }
  } catch {}
  // Open-Meteo Geocoding
  try {
    const u = new URL('https://geocoding-api.open-meteo.com/v1/search');
    u.searchParams.set('name', q);
    u.searchParams.set('count', '1');
    const r = await fetch(u);
    if (r.ok) {
      const data = await r.json() as any;
      if (data?.results?.[0]) {
        const it = data.results[0];
        return { latitude: it.latitude, longitude: it.longitude, display_name: it.name, timezone: it.timezone };
      }
    }
  } catch {}
  return null;
}

async function timezoneForCoords(lat: number, lon: number, env: Env): Promise<{ timeZone: string; offset: string } | null> {
  if (env.LOCATIONIQ_KEY) {
    try {
      const u = new URL('https://us1.locationiq.com/v1/timezone.php');
      u.searchParams.set('key', env.LOCATIONIQ_KEY);
      u.searchParams.set('lat', String(lat));
      u.searchParams.set('lon', String(lon));
      u.searchParams.set('format', 'json');
      const r = await fetch(u);
      if (r.ok) {
        const d = await r.json() as any;
        let tz = d?.timezone?.name || d?.timezone || d?.zone_name || d?.timeZone;
        let off = d?.utc_offset || d?.offset;
        if (!off && (typeof d?.gmt_offset === 'number')) off = formatOffset(d.gmt_offset);
        if (tz && off) return { timeZone: tz, offset: off };
      }
    } catch {}
  }
  // timeapi.io
  try {
    const u = new URL('https://timeapi.io/api/TimeZone/coordinate');
    u.searchParams.set('latitude', String(lat));
    u.searchParams.set('longitude', String(lon));
    const r = await fetch(u);
    if (r.ok) {
      const d = await r.json() as any;
      const tz = d.timeZone;
      const sec = d?.currentUtcOffset?.seconds ?? d?.standardUtcOffset?.seconds;
      if (tz && typeof sec === 'number') return { timeZone: tz, offset: formatOffset(sec) };
    }
  } catch {}
  // Open-Meteo timezone
  try {
    const u = new URL('https://api.open-meteo.com/v1/timezone');
    u.searchParams.set('latitude', String(lat));
    u.searchParams.set('longitude', String(lon));
    const r = await fetch(u);
    if (r.ok) {
      const d = await r.json() as any;
      const tz = d.timezone;
      const sec = d.utc_offset_seconds;
      if (tz && typeof sec === 'number') return { timeZone: tz, offset: formatOffset(sec) };
    }
  } catch {}
  // India hardening
  try {
    if (lat >= 6 && lat <= 37.5 && lon >= 68 && lon <= 98) return { timeZone: 'Asia/Kolkata', offset: '+05:30' };
  } catch {}
  return null;
}

async function getToken(env: Env): Promise<string> {
  const params = new URLSearchParams();
  params.set('grant_type', 'client_credentials');
  params.set('client_id', env.PROKERALA_CLIENT_ID);
  params.set('client_secret', env.PROKERALA_CLIENT_SECRET);
  const r = await fetch(`${PROKERALA_AUTH_BASE}/token`, { method: 'POST', body: params });
  if (!r.ok) throw new Error('prokerala_token_failed');
  const data = await r.json() as any;
  return data.access_token;
}

async function prokeralaGet(env: Env, path: string, params: Record<string, string>, token?: string, accept?: string): Promise<Response> {
  const base = (env.PROKERALA_BASE_URL || 'https://api.prokerala.com/v2').replace(/\/$/, '');
  const u = new URL(base + path);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
  if (accept) (headers as any)['Accept'] = accept;
  return fetch(u.toString(), { headers });
}

function isoDatetime(b: BirthInput): string {
  const t = b.time.includes(':') && b.time.split(':').length === 3 ? b.time : `${b.time}:00`;
  if (!b.timezone) throw new Error('timezone missing');
  return `${b.date}T${t}${b.timezone}`;
}

async function handleCompute(req: Request, env: Env): Promise<Response> {
  const body: ComputeRequest = await req.json();
  const b = body.birth || ({} as BirthInput);
  b.ayanamsa = b.ayanamsa ?? 1; b.la = b.la ?? 'en';
  try {
    if ((!b.latitude || !b.longitude) && b.location) {
      const geo = await geocodeLocation(b.location, env);
      if (!geo) return err('Could not geocode location', 400);
      b.latitude = geo.latitude; b.longitude = geo.longitude;
      if (!b.timezone && geo.timezone) {
        const tz = await timezoneForCoords(geo.latitude, geo.longitude, env);
        if (tz) b.timezone = tz.offset;
      }
    }
    if (!b.timezone && b.latitude != null && b.longitude != null) {
      const tz = await timezoneForCoords(b.latitude, b.longitude, env);
      if (tz) b.timezone = tz.offset;
    }
    if (!b.timezone) return err('timezone_unresolved: Unable to determine timezone offset. Please confirm location explicitly.', 400);
  } catch (e: any) {
    return err(`Location resolution failed: ${e?.message || e}`, 400);
  }
  const coords = `${b.latitude},${b.longitude}`;
  const dtiso = isoDatetime(b);
  const token = await getToken(env);
  // Kundli (advanced, fallback to basic)
  let kundliResp = await prokeralaGet(env, '/astrology/kundli/advanced', { coordinates: coords, datetime: dtiso, ayanamsa: String(b.ayanamsa), la: b.la! }, token);
  let advanced = true;
  if (kundliResp.status === 403) {
    advanced = false;
    kundliResp = await prokeralaGet(env, '/astrology/kundli', { coordinates: coords, datetime: dtiso, ayanamsa: String(b.ayanamsa), la: b.la! }, token);
  }
  if (!kundliResp.ok) return err('kundli_failed', 502);
  const kundli = await kundliResp.json();
  // Divisional
  const divisional: Record<string, any> = {};
  const include = body.include_divisional || ['lagna','navamsa'];
  for (const chartType of include) {
    try {
      const r = await prokeralaGet(env, '/astrology/divisional-planet-position', { coordinates: coords, datetime: dtiso, chart_type: chartType, ayanamsa: String(b.ayanamsa), la: b.la! }, token);
      if (!r.ok) throw new Error(`divisional_${chartType}_failed`);
      divisional[chartType] = await r.json();
    } catch (e: any) {
      divisional[chartType] = { error: String(e?.message || e) };
    }
  }
  // Transits (optional)
  let transits: any = null;
  if (body.include_transits) {
    try {
      const r = await prokeralaGet(env, '/astrology/transit-planet-position', { current_coordinates: coords, transit_datetime: body.transit_datetime || new Date().toISOString(), ayanamsa: String(b.ayanamsa) }, token);
      transits = await r.json();
    } catch (e: any) {
      transits = { error: String(e?.message || e) };
    }
  }
  return json({
    kundli,
    divisional,
    transits,
    meta: {
      provider: 'prokerala',
      advanced,
      ayanamsa: b.ayanamsa,
      language: b.la,
      birth: {
        date: b.date,
        time: b.time.includes(':') && b.time.split(':').length === 3 ? b.time : `${b.time}:00`,
        timezone: b.timezone,
        latitude: b.latitude,
        longitude: b.longitude,
        location: b.location || null,
      },
      effective_datetime: dtiso,
    }
  });
}

function currentPeriod(periods: any[], birthIso?: string): any | null {
  try {
    const now = new Date();
    const birth = birthIso ? new Date(birthIso) : null;
    const filtered = (periods || []).map((p: any) => ({
      s: new Date(p.start),
      e: new Date(p.end),
      p,
    })).filter((x: any) => (birth ? x.e >= birth : true));
    for (const x of filtered) if (x.s <= now && now <= x.e) return x.p;
    filtered.sort((a: any, b: any) => a.s.getTime() - b.s.getTime());
    return filtered[0]?.p || null;
  } catch { return null; }
}

async function handleAnalyze(req: Request): Promise<Response> {
  const { compute } = await req.json() as any;
  const kundli = compute?.kundli?.data || {};
  const d1 = compute?.divisional?.lagna?.data || {};
  const birth = compute?.meta?.birth || {};
  const birthIso = (birth?.date && birth?.time && birth?.timezone) ? `${birth.date}T${birth.time}${birth.timezone}` : undefined;

  // Ascendant
  let ascSign: string | undefined; let ascDeg: number | undefined;
  for (const hb of (d1.divisional_positions || [])) {
    for (const p of (hb.planet_positions || [])) {
      if (p?.planet?.name === 'Ascendant') { ascSign = hb?.rasi?.name; ascDeg = p?.sign_degree; break; }
    }
    if (ascSign) break;
  }
  const dasha = kundli?.vimshottari_dasha || kundli;
  const maha = currentPeriod(dasha?.dasha_periods || [], birthIso);
  const antar = maha ? currentPeriod(maha?.antardasha || [], birthIso) : null;

  const lines: string[] = [];
  lines.push('## BPHS‑Grounded Natal Summary');
  const whenWhere: string[] = [];
  if (birth?.date && birth?.time && birth?.timezone) whenWhere.push(`When: ${birth.date} ${birth.time} ${birth.timezone}`);
  if (birth?.location) whenWhere.push(`Where: ${birth.location}`);
  if (whenWhere.length) lines.push(`- ${whenWhere.join(' | ')}`);
  lines.push('\n### Core');
  if (ascSign) lines.push(`- Lagna: ${ascSign}${(typeof ascDeg === 'number') ? ` (${ascDeg.toFixed(2)}°)` : ''}`);
  lines.push(`- Moon: ${kundli?.nakshatra_details?.chandra_rasi?.name || '?'}; Nakshatra: ${kundli?.nakshatra_details?.nakshatra?.name || '?'}`);
  if (maha) {
    lines.push('\n### Vimshottari');
    lines.push(`- Mahadasha: ${maha.name}${maha.end ? ` → until ${maha.end.split('T')[0]}` : ''}`);
    if (antar) lines.push(`- Antardasha: ${antar.name}${antar.end ? ` → until ${antar.end.split('T')[0]}` : ''}`);
  }
  // Simple House highlights
  const houses: Record<number, { sign: string; lord?: string }> = {};
  const lord: Record<string,string> = { Mesha:'Mars', Vrishabha:'Venus', Vrishabh:'Venus', Mithuna:'Mercury', Karka:'Moon', 'Karkaṭa':'Moon', Simha:'Sun', Kanya:'Mercury', Tula:'Venus', Vrischika:'Mars', Vrichika:'Mars', Dhanu:'Jupiter', Makara:'Saturn', Kumbha:'Saturn', Meena:'Jupiter' };
  const byHouse: Record<number, { planet:string; sign:string }[]> = {};
  for (const hb of (d1.divisional_positions || [])) {
    const hnum = hb?.house?.number; const sign = hb?.rasi?.name;
    if (hnum && sign) houses[hnum] = { sign, lord: lord[sign] };
    for (const p of (hb?.planet_positions || [])) {
      const name = p?.planet?.name; if (name && name !== 'Ascendant') {
        byHouse[hnum] = byHouse[hnum] || []; byHouse[hnum].push({ planet: name, sign });
      }
    }
  }
  lines.push('\n### House Highlights (D1)');
  const names: Record<number,string> = {1:'Tanu (Self)',2:'Dhana (Wealth)',3:'Sahaja (Siblings)',4:'Sukha (Home)',5:'Putra (Creativity)',6:'Ripu (Health)',7:'Yuvati (Partnership)',8:'Randhra (Transformation)',9:'Dharma (Fortune)',10:'Karma (Career)',11:'Labha (Gains)',12:'Vyaya (Loss/Spiritual)'};
  for (let h=1; h<=12; h++) {
    const info = houses[h];
    const occ = byHouse[h] || [];
    const occTxt = occ.length ? occ.map(x=>`${x.planet} in ${x.sign}`).join(', ') : '—';
    if (info) lines.push(`- ${names[h]}: Sign ${info.sign} (${RASI_EN[info.sign] || info.sign}), Lord ${info.lord}; Occupants: ${occTxt}`);
  }
  // Short narrative
  const narrative: string[] = [];
  narrative.push('\n## Your Story (Plain Language)');
  if (ascSign) narrative.push(`You come across with rising sign ${ascSign}. This is a practical reading based on your actual placements.`);
  if (byHouse[8]?.find(x=>x.planet==='Mars')) narrative.push('- You handle intensity well. Mars in the 8th points to resilience; channel it into deep work.');
  if (byHouse[2]?.find(x=>x.planet==='Saturn')) narrative.push('- Finances and speech benefit from patience. Keep words precise in important matters.');
  if (maha) narrative.push(`\n### Timing Now\n- Current period: ${maha.name}${antar?` / ${antar.name}`:''}. Aim for moves that suit this combo.`);
  return json({ analysis: [...lines, '', ...narrative].join('\n') });
}

async function handleChat(req: Request, env: Env): Promise<Response> {
  const body = await req.json() as any;
  const message = body?.message || '';
  const ctx = body?.context || null;
  if (!message) return err('message required', 400);

  // Build minimal chart context
  let contextText = '';
  let mdName: string | undefined; let mdEnd: string | undefined;
  let adName: string | undefined; let adEnd: string | undefined;
  try {
    const kundli = ctx?.kundli?.data || {};
    const d1 = ctx?.divisional?.lagna?.data || {};
    const birth = ctx?.meta?.birth || {};
    const moonSign = kundli?.nakshatra_details?.chandra_rasi?.name;
    const nak = kundli?.nakshatra_details?.nakshatra?.name;
    const birthIso = (birth?.date && birth?.time && birth?.timezone) ? `${birth.date}T${birth.time}${birth.timezone}` : undefined;
    let ascSign: string | undefined;
    for (const hb of (d1.divisional_positions || [])) {
      for (const p of (hb.planet_positions || [])) if (p?.planet?.name === 'Ascendant') { ascSign = hb?.rasi?.name; break; }
      if (ascSign) break;
    }
    const parts: string[] = [];
    if (birth?.date && birth?.time && birth?.timezone) parts.push(`Birth: ${birth.date} ${birth.time} ${birth.timezone}${birth?.location?` | ${birth.location}`:''}`);
    if (ascSign) parts.push(`Ascendant: ${ascSign}`);
    if (moonSign || nak) parts.push(`Moon: ${moonSign || '?'}; Nakshatra: ${nak || '?'}`);
    const picks: string[] = [];
    for (const hb of (d1.divisional_positions || [])) {
      const h = hb?.house?.number; const sign = hb?.rasi?.name;
      for (const p of (hb?.planet_positions || [])) {
        const nm = p?.planet?.name; if (nm && nm !== 'Ascendant') picks.push(`${nm} in ${sign} (H${h})`);
      }
    }
    if (picks.length) parts.push('D1 placements: ' + picks.join(', '));
    // Dasha grounding
    const dasha = kundli?.vimshottari_dasha || kundli;
    if (Array.isArray(dasha?.dasha_periods)) {
      const md = currentPeriod(dasha.dasha_periods, birthIso);
      if (md) {
        mdName = md.name; mdEnd = (md.end || '').split('T')[0];
        if (Array.isArray(md.antardasha)) {
          const ad = currentPeriod(md.antardasha, birthIso);
          if (ad) { adName = ad.name; adEnd = (ad.end || '').split('T')[0]; }
        }
      }
    }
    if (mdName) {
      parts.push(`Current Vimshottari: Mahadasha=${mdName}${mdEnd?` (ends ${mdEnd})`:''}${adName?`; Antardasha=${adName}${adEnd?` (ends ${adEnd})`:''}`:''}`);
    }
    contextText = parts.join('\n');
  } catch {}

  const sys = 'You are a precise Vedic astrologer following BPHS. Use only provided placements and timing FROM THE CONTEXT. Never contradict the given Vimshottari Mahadasha/Antardasha names or dates. If MD/AD are not provided, say you cannot confirm them. Be concise, clear, and kind. No fabricated yogas; no changing lagna, timezone, ayanamsa, or dasha start.';
  const constraints = mdName ? `Lock these timings: Mahadasha=${mdName}${mdEnd?` (ends ${mdEnd})`:''}${adName?`; Antardasha=${adName}${adEnd?` (ends ${adEnd})`:''}`:''}` : '';
  const userPrompt = `${contextText ? contextText + '\n\n' : ''}${constraints ? constraints + '\n' : ''}Question: ${message}`;

  if (!env.OPENAI_API_KEY) {
    return json({ reply: `I will keep it practical and chart-grounded. ${message}` });
  }
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0.2,
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: userPrompt }
      ]
    })
  });
  if (!r.ok) return err('openai_failed', 502);
  const data = await r.json() as any;
  const text = data?.choices?.[0]?.message?.content || 'No answer';
  return json({ reply: text });
}

async function handleGeoResolve(url: URL, env: Env): Promise<Response> {
  const q = url.searchParams.get('q');
  if (!q) return err('q required', 400);
  const g = await geocodeLocation(q, env);
  if (!g) return err('no_match', 404);
  const tz = await timezoneForCoords(g.latitude, g.longitude, env);
  if (!tz) return err('timezone_unresolved', 400);
  return json({ display_name: g.display_name || q, latitude: g.latitude, longitude: g.longitude, offset: tz.offset, timeZone: tz.timeZone });
}

async function handleShadbalaPdf(req: Request, env: Env): Promise<Response> {
  const b = await req.json() as any;
  const birth = b as any;
  if ((!birth.location && (birth.latitude == null || birth.longitude == null))) return err('location or coordinates required', 400);
  const token = await getToken(env);
  const dt_iso = `${birth.date}T${birth.time.length===8?birth.time:`${birth.time}:00`}${birth.timezone}`;
  const coords = `${birth.latitude},${birth.longitude}`;
  const params: Record<string,string> = {
    'input[first_name]': birth.name || 'Client',
    'input[gender]': birth.gender || 'male',
    'input[datetime]': dt_iso,
    'input[coordinates]': coords,
    'input[place]': birth.location || birth.place || '',
    'options[modules][0][name]': 'shadbala-table',
    'options[modules][0][options]': '{}',
    'options[template][style]': 'basic',
    'options[template][footer]': 'Generated by Parasara Hora AI',
    'options[report][name]': 'Shadbala Table',
    'options[report][caption]': 'Planetary Strengths',
    'options[report][brand_name]': 'Parasara Hora AI',
    'options[report][la]': birth.la || 'en',
  };
  const r = await prokeralaGet(env, '/report/personal-reading/instant', params, token, 'application/pdf');
  if (!r.ok) return err('shadbala_pdf_failed', 502);
  const headers = new Headers(r.headers);
  headers.set('access-control-allow-origin', '*');
  return new Response(r.body, { status: 200, headers });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET,POST,OPTIONS',
        'access-control-allow-headers': 'Content-Type,Authorization',
      }});
    }
    try {
      if (url.pathname === '/api/health' && request.method === 'GET') {
        // Simple diagnostics to verify bindings and routing from the browser
        return json({
          ok: true,
          has_openai: !!env.OPENAI_API_KEY,
          account_bound: !!env.PROKERALA_CLIENT_ID && !!env.PROKERALA_CLIENT_SECRET,
          has_locationiq: !!env.LOCATIONIQ_KEY,
        });
      }
      if (url.pathname === '/api/geo/resolve' && request.method === 'GET') return handleGeoResolve(url, env);
      if (url.pathname === '/api/compute' && request.method === 'POST') return handleCompute(request, env);
      if (url.pathname === '/api/analyze' && request.method === 'POST') return handleAnalyze(request);
      if (url.pathname === '/api/chat' && request.method === 'POST') return handleChat(request, env);
      if (url.pathname === '/api/shadbala/pdf' && request.method === 'POST') return handleShadbalaPdf(request, env);
      if (url.pathname === '/api/shadbala/json') return err('Not implemented on Worker; use PDF', 501);
      return new Response('Not Found', { status: 404 });
    } catch (e: any) {
      return err(e?.message || 'internal_error', 500);
    }
  },
};
