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

async function handleChart(req: Request, env: Env): Promise<Response> {
  const body = await req.json() as any;
  const compute = body?.compute || null;
  const chartType = body?.chart_type || 'lagna';
  const chartStyle = body?.chart_style || 'south-indian';
  const birth = compute?.meta?.birth || body?.birth;
  const ayan = compute?.meta?.ayanamsa ?? body?.ayanamsa ?? 1;
  const la = compute?.meta?.language ?? body?.la ?? 'en';
  if (!birth?.latitude || !birth?.longitude || !birth?.timezone || !birth?.date || !birth?.time) {
    return err('birth_meta_missing', 400);
  }
  const coords = `${birth.latitude},${birth.longitude}`;
  const dtiso = `${birth.date}T${birth.time}${birth.timezone}`;
  const token = await getToken(env);
  const r = await prokeralaGet(env, '/astrology/chart', {
    coordinates: coords,
    datetime: dtiso,
    ayanamsa: String(ayan),
    chart_type: chartType,
    chart_style: chartStyle,
    format: 'svg',
    la,
  }, token, 'image/svg+xml');
  if (!r.ok) return err('chart_failed', 502);
  const svg = await r.text();
  return new Response(svg, {
    status: 200,
    headers: { 'content-type': 'image/svg+xml', 'access-control-allow-origin': '*' },
  });
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

function houseName(n: number): string {
  const names: Record<number, string> = {
    1: 'Tanu (Self)', 2: 'Dhana (Wealth)', 3: 'Sahaja (Siblings)', 4: 'Sukha (Home)',
    5: 'Putra (Creativity)', 6: 'Ripu (Health)', 7: 'Yuvati (Partnership)', 8: 'Randhra (Transformation)',
    9: 'Dharma (Fortune)', 10: 'Karma (Career)', 11: 'Labha (Gains)', 12: 'Vyaya (Loss/Spiritual)'
  };
  return names[n] || `House ${n}`;
}

function buildFacts(compute: any) {
  const kundli = compute?.kundli?.data || {};
  const birth = compute?.meta?.birth || {};
  const d1 = compute?.divisional?.lagna?.data || {};
  const d9 = compute?.divisional?.navamsa?.data || {};
  const d10 = compute?.divisional?.dasamsa?.data || {};
  const d4 = compute?.divisional?.chaturthamsa?.data || {};
  const d7 = compute?.divisional?.saptamsa?.data || {};
  // Ascendant
  let ascSign: string | undefined; let ascDeg: number | undefined;
  for (const hb of (d1.divisional_positions || [])) {
    for (const p of (hb.planet_positions || [])) if (p?.planet?.name === 'Ascendant') { ascSign = hb?.rasi?.name; ascDeg = p?.sign_degree; break; }
    if (ascSign) break;
  }
  const facts: any = {
    birth,
    ascendant: ascSign,
    asc_degree: ascDeg,
    moon_sign: kundli?.nakshatra_details?.chandra_rasi?.name,
    nakshatra: kundli?.nakshatra_details?.nakshatra?.name,
    houses: {} as Record<number, { sign: string; lord?: string; occupants: { planet: string; sign: string }[] }>,
    vargas: {} as Record<string, any>,
    dasha: {} as any,
  };
  const lord: Record<string, string> = { Mesha:'Mars', Vrishabha:'Venus', Vrishabh:'Venus', Mithuna:'Mercury', Karka:'Moon', 'Karkaṭa':'Moon', Simha:'Sun', Kanya:'Mercury', Tula:'Venus', Vrischika:'Mars', Vrichika:'Mars', Dhanu:'Jupiter', Makara:'Saturn', Kumbha:'Saturn', Meena:'Jupiter' };
  const byHouse: Record<number, { planet:string; sign:string }[]> = {};
  for (const hb of (d1.divisional_positions || [])) {
    const h = hb?.house?.number; const sign = hb?.rasi?.name;
    if (!h || !sign) continue;
    for (const p of (hb?.planet_positions || [])) {
      const nm = p?.planet?.name; if (nm && nm !== 'Ascendant') {
        byHouse[h] = byHouse[h] || []; byHouse[h].push({ planet: nm, sign });
      }
    }
  }
  for (let h=1; h<=12; h++) {
    const d = (d1.divisional_positions || []).find((x:any)=>x?.house?.number===h);
    const sign = d?.rasi?.name;
    facts.houses[h] = { sign, lord: lord[sign || ''] , occupants: byHouse[h] || [] };
  }
  function packVarga(name: string, data: any) {
    if (!data || !data.divisional_positions) return null;
    const list: any[] = [];
    for (const hb of data.divisional_positions) {
      const h = hb?.house?.number; const sign = hb?.rasi?.name;
      const occ = [] as any[];
      for (const p of (hb?.planet_positions || [])) {
        const nm = p?.planet?.name; if (nm) occ.push({ planet: nm, degree: p?.sign_degree, sign });
      }
      list.push({ house: h, sign, occupants: occ });
    }
    return { chart: name, positions: list };
  }
  facts.vargas.d1 = packVarga('D1 Rasi', d1);
  facts.vargas.d9 = packVarga('D9 Navamsa', d9);
  facts.vargas.d10 = packVarga('D10 Dasamsa', d10);
  facts.vargas.d4 = packVarga('D4 Chaturthamsa', d4);
  facts.vargas.d7 = packVarga('D7 Saptamsa', d7);
  // Dasha now
  const birthIso = (birth?.date && birth?.time && birth?.timezone) ? `${birth.date}T${birth.time}${birth.timezone}` : undefined;
  const dasha = kundli?.vimshottari_dasha || kundli;
  if (Array.isArray(dasha?.dasha_periods)) {
    const md = currentPeriod(dasha.dasha_periods, birthIso);
    const obj: any = {};
    if (md) {
      obj.mahadasha = { name: md.name, end: md.end };
      if (Array.isArray(md.antardasha)) {
        const ad = currentPeriod(md.antardasha, birthIso);
        if (ad) obj.antardasha = { name: ad.name, end: ad.end };
      }
    }
    facts.dasha = obj;
  }
  return facts;
}

async function handleAnalyzeLLM(req: Request, env: Env): Promise<Response> {
  let { compute } = await req.json() as any;
  // Ensure key vargas are present; enrich if missing
  try {
    const birth = compute?.meta?.birth;
    const ayan = compute?.meta?.ayanamsa ?? 1;
    const la = compute?.meta?.language ?? 'en';
    if (birth?.latitude != null && birth?.longitude != null && birth?.timezone) {
      const coords = `${birth.latitude},${birth.longitude}`;
      const dtiso = `${birth.date}T${birth.time}${birth.timezone}`;
      const token = await getToken(env);
      const need: string[] = [];
      const have = compute?.divisional || {};
      for (const ct of ['lagna','navamsa','dasamsa','chaturthamsa','saptamsa']) {
        const ok = have?.[ct]?.data?.divisional_positions?.length;
        if (!ok) need.push(ct);
      }
      for (const ct of need) {
        try {
          const r = await prokeralaGet(env, '/astrology/divisional-planet-position', {
            coordinates: coords, datetime: dtiso, chart_type: ct, ayanamsa: String(ayan), la
          }, token);
          if (r.ok) {
            const js = await r.json();
            compute.divisional = compute.divisional || {};
            compute.divisional[ct] = js;
          }
        } catch {}
      }
    }
  } catch {}
  const facts = buildFacts(compute);
  const md = facts?.dasha?.mahadasha?.name; const mdEnd = facts?.dasha?.mahadasha?.end;
  const ad = facts?.dasha?.antardasha?.name; const adEnd = facts?.dasha?.antardasha?.end;
  // Load reference book excerpt (pre-extracted text hosted with the site)
  const trace: string[] = [];
  let refExcerpt = '';
  let paraExcerpt = '';
  try {
    const bookUrl = 'https://allthingssecurity.github.io/astrobaba/astro_book.txt';
    const r = await fetch(bookUrl);
    if (r.ok) {
      const t = await r.text();
      // Limit to avoid token overflow (tight, focused excerpt)
      refExcerpt = t.slice(0, 12000);
      trace.push('Loaded BV Raman excerpt');
    }
  } catch {}
  try {
    const bookUrl2 = 'https://allthingssecurity.github.io/astrobaba/parasara_book.txt';
    const r2 = await fetch(bookUrl2);
    if (r2.ok) {
      const t2 = await r2.text();
      paraExcerpt = t2.slice(0, 12000);
      trace.push('Loaded Parasara excerpt');
    }
  } catch {}
  const sys = `You are a precise Vedic astrologer (BPHS) writing a professional, client‑ready report.
Rules:
- Use ONLY the provided JSON facts; never invent planets, signs, houses, aspects, yogas, degrees, or timelines. If a detail is missing, write "not in data".
- Never change lagna, timezone, ayanamsa, or Vimshottari periods.
- Do not assert yogas or aspects unless explicitly present (none provided).
Tone & Format:
- Executive and clear, minimal jargon, layperson‑friendly.
- Use crisp sections with headings and short bullets.
- Each house: 3 bullets → Key signal (from sign/occupants), Practical meaning, One action.
- Start with a brief Actionable Summary (3–5 bullets) tied to MD/AD.
Life‑stage grounding:
- Use the birth date to infer present age. If a topic (e.g., marriage, children, career) is typically already realized for the age, phrase it in past/present tense (e.g., "likely already married" / "marriage likely occurred in...") rather than future‑prospect language.
- If age suggests early life, keep future‑oriented phrasing. Avoid generic "prospects" language when it contradicts the age.
Citation sources (BV Raman + Parasara):
- Extract 5–8 "Best Practices" from the BV Raman excerpt as a numbered list BV1..BVn.
  • Each BV item: one short quote (5–12 words) in quotes + a concise paraphrase.
- Extract 4–6 "Core Principles" from the Parasara excerpt as a numbered list P1..Pn.
  • Each P item: one short quote (5–12 words) in quotes + a concise paraphrase.
- When applying guidance later, add inline markers like [BV3] or [P2] where relevant.
- Close with a References section: list BV1..BVn with quotes and: B. V. Raman, "How to Judge a Horoscope" (reference excerpt); and P1..Pn with quotes and: Maharshi Parashara, "Brihat Parasara Hora Sastra" (reference excerpt). Do NOT invent page numbers.
- Never cite if an item was not actually used.`;
  const constraints = `Lock these timings if present: Mahadasha=${md || 'n/a'}${mdEnd?` (ends ${mdEnd.split('T')[0]})`:''}${ad?`; Antardasha=${ad}${adEnd?` (ends ${adEnd.split('T')[0]})`:''}`:''}`;
  const user = `Facts JSON:\n\n${JSON.stringify(facts)}\n\n${constraints}\n\nBV Raman excerpt (extract 5–8 best practices with quoted phrases, number them BV1..BVn, then apply them with [BVx] markers):\n\n${refExcerpt}\n\nParasara excerpt (extract 4–6 core principles with quoted phrases, number them P1..Pn, then apply them with [Px] markers):\n\n${paraExcerpt}\n\nTask: Produce a professional client report with these sections, EXACTLY in this order and with headings spelled exactly as below:\n\n### Actionable Summary\n- 3–5 bullets tied to current MD/AD; include one immediate step per bullet.\n\n### Best Practices (BV1..BVn)\n- 5–8 numbered items with short quotes + paraphrase.\n\n### Core Principles (P1..Pn)\n- 4–6 numbered items with short quotes + paraphrase.\n\n### House‑by‑House\n- For houses 1..12: 3 bullets each → Key signal, Practical meaning, One action. Each bullet MUST include an "Evidence:" clause citing the exact placement(s) used (e.g., D1: Mars in Vrischika H8) and at least one [BVx] marker when a best practice is applied.\n\n### Career (D10)\n- Use D10 facts only. Add [BVx]. Include "Evidence:" in each bullet.\n\n### Relationships (D9)\n- Use D9 facts only. Add [BVx]. Include "Evidence:" in each bullet.\n\n### Assets (D4)\n- Use D4 facts only. Add [BVx]. Include "Evidence:" in each bullet.\n\n### Children (D7)\n- Use D7 facts only. Add [BVx]. Include "Evidence:" in each bullet.\n\n### Timing Now (MD/AD locked)\n- 2–4 bullets with clear, dated guidance (MD/AD). Include "Evidence:".\n\n### References\n- BV list with quotes + attribution line.\n- Parasara list with quotes + attribution line.\n\nAfter the report, output a fenced JSON code block containing a machine‑readable rationale with this shape:

${"```json"}
{ "rationale": [ { "section": "House 8"|"Career"|..., "house": 8|null, "bullet": "text of bullet", "chart_evidence": ["D1: Mars in Vrischika H8", ...], "bv_ids": ["BV3", "BV5"], "reasoning": "why BV applies to this evidence" } ] }
${"```"}

Do not include any extra prose after the JSON block. Keep bullets short; do not overreach beyond Facts JSON.`;

  const stream = !!body?.stream;
  if (!env.OPENAI_API_KEY) {
    return json({ analysis: `LLM not available. Here are facts:\n\n${JSON.stringify(facts, null, 2)}` });
  }
  if (!stream) {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.15,
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: user }
        ]
      })
    });
    if (!r.ok) return err('openai_failed', 502);
    const data = await r.json() as any;
    let text = data?.choices?.[0]?.message?.content || '';
    let rationale: any[] = [];
    trace.push('Generated report with BV/P citations');
    try {
      const start = text.indexOf('```json');
      if (start >= 0) {
        const end = text.indexOf('```', start + 7);
        const jsonBlock = text.substring(start + 7, end).trim();
        const parsed = JSON.parse(jsonBlock);
        if (parsed && Array.isArray(parsed.rationale)) rationale = parsed.rationale;
        text = (text.substring(0, start) + text.substring(end + 3)).trim();
      }
    } catch {}
    if (!text) text = 'No answer';
    return json({ analysis: text, rationale, trace });
  }

  // Streaming analysis (SSE)
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const sr = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0.15,
      stream: true,
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: user }
      ]
    })
  });
  if (!sr.ok || !sr.body) return err('openai_failed', 502);

  const streamBody = new ReadableStream({
    async start(controller) {
      const send = (event: string, payload: any) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`));
      };
      const sendTrace = (msg: string) => {
        trace.push(msg);
        send('trace', { text: msg });
      };
      sendTrace('Starting detailed analysis');
      if (refExcerpt) sendTrace('BV Raman excerpt loaded');
      if (paraExcerpt) sendTrace('Parasara excerpt loaded');
      sendTrace('Generating report');

      const reader = sr.body!.getReader();
      let buffer = '';
      let fullText = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\n/);
        buffer = lines.pop() || '';
        for (const lineRaw of lines) {
          const line = lineRaw.trim();
          if (!line.startsWith('data:')) continue;
          const data = line.replace(/^data:\s*/, '');
          if (data === '[DONE]') {
            let rationale: any[] = [];
            let cleaned = fullText;
            try {
              const start = fullText.indexOf('```json');
              if (start >= 0) {
                const end = fullText.indexOf('```', start + 7);
                const jsonBlock = fullText.substring(start + 7, end).trim();
                const parsed = JSON.parse(jsonBlock);
                if (parsed && Array.isArray(parsed.rationale)) rationale = parsed.rationale;
                cleaned = (fullText.substring(0, start) + fullText.substring(end + 3)).trim();
              }
            } catch {}
            send('done', { text: cleaned || 'No answer', rationale, trace });
            controller.close();
            return;
          }
          try {
            const parsed = JSON.parse(data);
            const delta = parsed?.choices?.[0]?.delta?.content;
            if (delta) {
              fullText += delta;
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'delta', text: delta })}\n\n`));
            }
          } catch {}
        }
      }
      send('done', { text: fullText || 'No answer', rationale: [], trace });
      controller.close();
    }
  });

  return new Response(streamBody, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      'access-control-allow-origin': '*'
    }
  });
}

// Intent detection for on-demand varga enrichment in chat
function detectIntentCharts(message: string): string[] {
  const m = message.toLowerCase();
  const need: Set<string> = new Set();
  if (/career|job|promotion|work|boss|role|profession/.test(m)) need.add('dasamsa'); // D10
  if (/marriage|married|spouse|partner|relationship|wife|husband/.test(m)) need.add('navamsa'); // D9
  if (/property|house|real\s?estate|asset|land|home|vehicle/.test(m)) need.add('chaturthamsa'); // D4
  if (/child|children|progeny|son|daughter|fertility/.test(m)) need.add('saptamsa'); // D7
  // Always ensure D1
  need.add('lagna');
  return Array.from(need);
}

function parseNextCharts(text: string): string[] {
  const match = text.match(/^\s*NEXT_CHARTS:\s*(.+)\s*$/im);
  if (!match) return [];
  const raw = match[1].trim();
  if (!raw || raw.toLowerCase() === 'none') return [];
  return raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean).map((s) => {
    if (s === 'd1' || s === 'lagna') return 'lagna';
    if (s === 'd9' || s === 'navamsa') return 'navamsa';
    if (s === 'd10' || s === 'dasamsa') return 'dasamsa';
    if (s === 'd4' || s === 'chaturthamsa') return 'chaturthamsa';
    if (s === 'd7' || s === 'saptamsa') return 'saptamsa';
    return s;
  });
}

function availableCharts(ctx: any): string[] {
  const div = ctx?.divisional || {};
  const out: string[] = [];
  for (const key of ['lagna','navamsa','dasamsa','chaturthamsa','saptamsa']) {
    const ok = div?.[key]?.data?.divisional_positions?.length;
    if (ok) out.push(key);
  }
  return out;
}

function buildContext(ctx: any): { text: string; mdName?: string; mdEnd?: string; adName?: string; adEnd?: string } {
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
    if (birth?.date && birth?.time && birth?.timezone) {
      parts.push(`Birth: ${birth.date} ${birth.time} ${birth.timezone}${birth?.location?` | ${birth.location}`:''}`);
      try {
        const now = new Date();
        const dob = new Date(`${birth.date}T00:00:00${birth.timezone}`);
        const age = Math.max(0, Math.floor((now.getTime() - dob.getTime()) / (365.25 * 24 * 3600 * 1000)));
        parts.push(`Age: ${age}`);
      } catch {}
    }
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
    const charts = availableCharts(ctx);
    if (charts.length) parts.push(`Charts available: ${charts.map(c => c.toUpperCase()).join(', ')}`);
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
  return { text: contextText, mdName, mdEnd, adName, adEnd };
}

async function ensureDivisionalCharts(env: Env, compute: any, types: string[]): Promise<any> {
  try {
    const birth = compute?.meta?.birth;
    const ayan = compute?.meta?.ayanamsa ?? 1;
    const la = compute?.meta?.language ?? 'en';
    if (!(birth?.latitude != null && birth?.longitude != null && birth?.timezone)) return compute;
    const coords = `${birth.latitude},${birth.longitude}`;
    const dtiso = `${birth.date}T${birth.time}${birth.timezone}`;
    const token = await getToken(env);
    compute.divisional = compute.divisional || {};
    for (const ct of types) {
      const ok = compute?.divisional?.[ct]?.data?.divisional_positions?.length;
      if (ok) continue;
      try {
        const r = await prokeralaGet(env, '/astrology/divisional-planet-position', {
          coordinates: coords, datetime: dtiso, chart_type: ct, ayanamsa: String(ayan), la
        }, token);
        if (r.ok) compute.divisional[ct] = await r.json();
      } catch {}
    }
  } catch {}
  return compute;
}
async function handleChat(req: Request, env: Env): Promise<Response> {
  const body = await req.json() as any;
  const message = body?.message || '';
  let ctx = body?.context || null;
  if (!message) return err('message required', 400);

  const sys = 'You are a precise Vedic astrologer following BPHS. Use only provided placements and timing FROM THE CONTEXT. Never contradict the given Vimshottari Mahadasha/Antardasha names or dates. If MD/AD are not provided, say you cannot confirm them. Be concise, clear, and kind. No fabricated yogas; no changing lagna, timezone, ayanamsa, or dasha start. Life-stage grounding: infer present age from birth date. For lifecycle topics (marriage/children/career), first assess D1 + relevant varga signals (D9/D7/D10) and only then mention MD/AD timing as a secondary lens. Do not lead with dasha. Combine age + chart signals + MD/AD to state whether the event likely already occurred or is still upcoming. Use cautious phrasing ("likely", "often", "could have") and avoid future-only "prospects" language if age indicates it likely already happened.';

  const maxIterations = Math.min(Math.max(1, body?.max_iterations || 2), 5);
  const stream = !!body?.stream;
  let usedCharts: string[] = detectIntentCharts(message);
  let requestedCharts: string[] = [];
  const trace: string[] = [];
  const addedCharts: Set<string> = new Set();
  let finalText = '';
  let lastResponse = '';

  if (!env.OPENAI_API_KEY) {
    return json({ reply: `I will keep it practical and chart-grounded. ${message}`, used_charts: usedCharts, trace });
  }

  const callOpenAI = async (userPrompt: string, streamMode: boolean) => {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.2,
        stream: streamMode,
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: userPrompt }
        ]
      })
    });
    return r;
  };

  for (let i = 0; i < maxIterations; i++) {
    const need = Array.from(new Set([...usedCharts, ...requestedCharts]));
    const before = availableCharts(ctx);
    if (ctx) {
      try { ctx = await ensureDivisionalCharts(env, ctx.compute || ctx, need); } catch {}
    }
    const after = availableCharts(ctx);
    const newly = after.filter(c => !before.includes(c));
    for (const c of newly) addedCharts.add(c);
    trace.push(`Iteration ${i + 1}: intent charts ${need.map(c => c.toUpperCase()).join(', ') || 'none'}`);
    if (newly.length) trace.push(`Fetched charts: ${newly.map(c => c.toUpperCase()).join(', ')}`);

    const built = buildContext(ctx || {});
    const constraints = built.mdName ? `Lock these timings: Mahadasha=${built.mdName}${built.mdEnd?` (ends ${built.mdEnd})`:''}${built.adName?`; Antardasha=${built.adName}${built.adEnd?` (ends ${built.adEnd})`:''}`:''}` : '';
    const userPrompt = `${built.text ? built.text + '\n\n' : ''}${constraints ? constraints + '\n' : ''}Question: ${message}\nIf more charts are needed, append a single line: NEXT_CHARTS: D7,D9. Otherwise append: NEXT_CHARTS: none.`;

    const r = await callOpenAI(userPrompt, false);
    if (!r.ok) return err('openai_failed', 502);
    const data = await r.json() as any;
    lastResponse = data?.choices?.[0]?.message?.content || 'No answer';
    const next = parseNextCharts(lastResponse);
    finalText = lastResponse.replace(/^\s*NEXT_CHARTS:.*$/im, '').trim();
    if (next.length === 0) {
      trace.push('Final answer generated.');
      break;
    }
    const newNeeded = next.filter(c => !need.includes(c));
    if (newNeeded.length === 0) {
      trace.push('LLM requested charts already present; finalizing.');
      break;
    }
    requestedCharts = newNeeded;
    trace.push(`LLM requested charts: ${newNeeded.map(c => c.toUpperCase()).join(', ')}`);
    if (i === maxIterations - 1) {
      trace.push('Max iterations reached; finalizing.');
    }
  }

  const refinement = addedCharts.size ? `Refined with additional charts: ${Array.from(addedCharts).map(c => c.toUpperCase()).join(', ')}.` : '';
  const finalUsed = Array.from(new Set([...usedCharts, ...requestedCharts, ...Array.from(addedCharts)]));
  if (!stream) {
    return json({ reply: finalText || lastResponse, used_charts: finalUsed, trace, refinement });
  }

  // Stream trace events + final answer using OpenAI streaming API
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const streamBody = new ReadableStream({
    async start(controller) {
      const send = (event: string, payload: any) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`));
      };
      const sendTrace = (msg: string) => {
        trace.push(msg);
        send('trace', { text: msg });
      };
      try {
        sendTrace('Agent started');
        // Re-run the loop to emit live trace
        let localCtx = ctx;
        let localUsed = usedCharts.slice();
        let localRequested: string[] = [];
        let localAdded: Set<string> = new Set();
        for (let i = 0; i < maxIterations; i++) {
          const need = Array.from(new Set([...localUsed, ...localRequested]));
          sendTrace(`Iteration ${i + 1}: intent charts ${need.map(c => c.toUpperCase()).join(', ') || 'none'}`);
          const before = availableCharts(localCtx);
          if (localCtx) {
            try { localCtx = await ensureDivisionalCharts(env, (localCtx as any).compute || localCtx, need); } catch {}
          }
          const after = availableCharts(localCtx);
          const newly = after.filter(c => !before.includes(c));
          for (const c of newly) localAdded.add(c);
          if (newly.length) sendTrace(`Fetched charts: ${newly.map(c => c.toUpperCase()).join(', ')}`);
          const built = buildContext(localCtx || {});
          const constraints = built.mdName ? `Lock these timings: Mahadasha=${built.mdName}${built.mdEnd?` (ends ${built.mdEnd})`:''}${built.adName?`; Antardasha=${built.adName}${built.adEnd?` (ends ${built.adEnd})`:''}`:''}` : '';
          const userPrompt = `${built.text ? built.text + '\n\n' : ''}${constraints ? constraints + '\n' : ''}Question: ${message}\nIf more charts are needed, append a single line: NEXT_CHARTS: D7,D9. Otherwise append: NEXT_CHARTS: none.`;
          const r = await callOpenAI(userPrompt, false);
          if (!r.ok) throw new Error('openai_failed');
          const data = await r.json() as any;
          lastResponse = data?.choices?.[0]?.message?.content || 'No answer';
          const next = parseNextCharts(lastResponse);
          finalText = lastResponse.replace(/^\s*NEXT_CHARTS:.*$/im, '').trim();
          if (next.length === 0) {
            sendTrace('Final answer ready; streaming tokens');
            ctx = localCtx;
            usedCharts = localUsed;
            requestedCharts = localRequested;
            addedCharts.clear();
            for (const c of localAdded) addedCharts.add(c);
            break;
          }
          const newNeeded = next.filter(c => !need.includes(c));
          if (newNeeded.length === 0) {
            sendTrace('Requested charts already present; finalizing');
            ctx = localCtx;
            break;
          }
          localRequested = newNeeded;
          sendTrace(`LLM requested charts: ${newNeeded.map(c => c.toUpperCase()).join(', ')}`);
          if (i === maxIterations - 1) sendTrace('Max iterations reached; finalizing');
        }

        const refinement = addedCharts.size ? `Refined with additional charts: ${Array.from(addedCharts).map(c => c.toUpperCase()).join(', ')}.` : '';
        const finalUsed = Array.from(new Set([...usedCharts, ...requestedCharts, ...Array.from(addedCharts)]));
        const builtFinal = buildContext(ctx || {});
        const constraintsFinal = builtFinal.mdName ? `Lock these timings: Mahadasha=${builtFinal.mdName}${builtFinal.mdEnd?` (ends ${builtFinal.mdEnd})`:''}${builtFinal.adName?`; Antardasha=${builtFinal.adName}${builtFinal.adEnd?` (ends ${builtFinal.adEnd})`:''}`:''}` : '';
        const streamPrompt = `${builtFinal.text ? builtFinal.text + '\n\n' : ''}${constraintsFinal ? constraintsFinal + '\n' : ''}Question: ${message}\nAnswer directly. Do NOT include NEXT_CHARTS.`;
        const sr = await callOpenAI(streamPrompt, true);
        if (!sr.ok || !sr.body) throw new Error('openai_failed');
        const reader = sr.body.getReader();
        let buffer = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split(/\n/);
          buffer = lines.pop() || '';
          for (const lineRaw of lines) {
            const line = lineRaw.trim();
            if (!line.startsWith('data:')) continue;
            const data = line.replace(/^data:\s*/, '');
            if (data === '[DONE]') {
              send('done', { used_charts: finalUsed, trace, refinement });
              controller.close();
              return;
            }
            try {
              const parsed = JSON.parse(data);
              const delta = parsed?.choices?.[0]?.delta?.content;
              if (delta) {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'delta', text: delta })}\n\n`));
              }
            } catch {}
          }
        }
        send('done', { used_charts: finalUsed, trace, refinement });
        controller.close();
      } catch {
        send('trace', { text: 'Streaming failed; returning fallback response.' });
        send('done', { used_charts: usedCharts, trace, refinement: '' });
        controller.close();
      }
    }
  });
  return new Response(streamBody, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      'access-control-allow-origin': '*'
    }
  });
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
      if (url.pathname === '/api/analyze-llm' && request.method === 'POST') return handleAnalyzeLLM(request, env);
      if (url.pathname === '/api/chart' && request.method === 'POST') return handleChart(request, env);
      if (url.pathname === '/api/chat' && request.method === 'POST') return handleChat(request, env);
      if (url.pathname === '/api/shadbala/pdf' && request.method === 'POST') return handleShadbalaPdf(request, env);
      if (url.pathname === '/api/shadbala/json') return err('Not implemented on Worker; use PDF', 501);
      return new Response('Not Found', { status: 404 });
    } catch (e: any) {
      return err(e?.message || 'internal_error', 500);
    }
  },
};
