import { ChartData, PlanetaryPosition, PlanetName, ShadbalaData, FullHoroscope, ComputeBundle } from '../types';

export const API_BASE = (import.meta as any).env?.VITE_API_BASE || '/api';

export const RASI_TO_EN: Record<string, string> = {
  Mesha: 'Aries',
  Vrishabha: 'Taurus',
  Vrishabh: 'Taurus',
  Vrish: 'Taurus',
  Mithuna: 'Gemini',
  Karka: 'Cancer',
  Karkaṭa: 'Cancer',
  Simha: 'Leo',
  Kanya: 'Virgo',
  Tula: 'Libra',
  Vrischika: 'Scorpio',
  Vrichika: 'Scorpio',
  Dhanu: 'Sagittarius',
  Makara: 'Capricorn',
  Kumbha: 'Aquarius',
  Meena: 'Pisces',
};

export const mapDivisionalToChart = (chartName: string, data: any): ChartData => {
  const positions: PlanetaryPosition[] = [];
  const items = data?.data?.divisional_positions || [];
  for (const house of items) {
    for (const p of (house.planet_positions || [])) {
      const name = p.planet?.name as string;
      const planet = (name === 'Ascendant' ? PlanetName.Ascendant : (PlanetName as any)[name]) || name;
      const rasiName = house?.rasi?.name || '';
      const signEn = RASI_TO_EN[rasiName] || rasiName || 'Aries';
      positions.push({
        planet,
        sign: signEn,
        degree: Math.round((p.sign_degree || 0) * 100) / 100,
        house: house?.house?.number || 0,
        nakshatra: p?.nakshatra?.name || '',
        isRetrograde: !!p?.is_retrograde
      });
    }
  }
  return { chartName, positions };
};

const extractCurrentDasha = (kundli: any) => {
  const data = kundli?.data || {};
  // In kundli advanced, dasha fields are commonly at data level
  const dasha = data?.vimshottari_dasha || data;
  const nowDate = new Date();
  let maha: any = undefined;
  if (Array.isArray(dasha?.dasha_periods)) {
    maha = dasha.dasha_periods.find((p: any) => {
      const s = new Date(p.start);
      const e = new Date(p.end);
      return nowDate >= s && nowDate <= e;
    }) || dasha.dasha_periods[0];
  }
  let antar: any = undefined;
  if (maha && Array.isArray(maha.antardasha)) {
    antar = maha.antardasha.find((p: any) => {
      const s = new Date(p.start);
      const e = new Date(p.end);
      return nowDate >= s && nowDate <= e;
    }) || maha.antardasha[0];
  }
  return {
    mahadasha: {
      lord: (maha?.name || 'Unknown') as any,
      startDate: maha?.start?.slice(0, 10) || '-',
      endDate: maha?.end?.slice(0, 10) || '-',
      durationYears: 0
    },
    antardasha: {
      lord: (antar?.name || 'Unknown') as any,
      startDate: antar?.start?.slice(0, 10) || '-',
      endDate: antar?.end?.slice(0, 10) || '-',
      durationYears: 0
    },
    pratyantardasha: '-',
    balanceAtBirth: (dasha?.dasha_balance?.description || '-') as string
  };
};

export const calculateCharts = async (
  name: string,
  dob: string,
  time: string,
  location: string,
  timezone?: string,
  latitude?: number,
  longitude?: number
): Promise<ComputeBundle> => {
  const birth: any = {
    date: dob,
    time: time.length === 5 ? `${time}:00` : time,
    location,
    ayanamsa: 1,
    la: 'en'
  };
  if (timezone) birth.timezone = timezone;
  if (latitude != null) birth.latitude = latitude;
  if (longitude != null) birth.longitude = longitude;

  const resp = await fetch(`${API_BASE}/compute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ birth, include_divisional: ['lagna','navamsa'], include_transits: true })
  });
  if (!resp.ok) throw new Error('Compute failed');
  const compute = await resp.json();

  const kundli = compute.kundli;
  const d1 = compute.divisional?.lagna;
  const d9 = compute.divisional?.navamsa;
  const d10 = compute.divisional?.dasamsa;
  const d7 = compute.divisional?.saptamsa;
  const d4 = compute.divisional?.chaturthamsa;

  const ui: FullHoroscope = {
    d1: mapDivisionalToChart('D1 Rasi (Main)', d1),
    d9: mapDivisionalToChart('D9 Navamsa', d9),
    d10: mapDivisionalToChart('D10 Dasamsa', d10),
    d7: mapDivisionalToChart('D7 Saptamsa', d7),
    d4: mapDivisionalToChart('D4 Chaturthamsha', d4),
    shadbala: [], // not available via JSON; can be fetched via PDF later
    currentDasha: extractCurrentDasha(kundli),
    nakshatra: kundli?.data?.nakshatra_details?.nakshatra?.name || ''
  };

  return { ui, compute };
};

export const analyzeWithBackend = async (compute: any, question?: string): Promise<string> => {
  const resp = await fetch(`${API_BASE}/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ compute, question })
  });
  if (!resp.ok) throw new Error('Analyze failed');
  const data = await resp.json();
  return data.analysis as string;
};

export const chatWithBackend = async (sessionId: string, message: string, context?: any): Promise<string> => {
  const resp = await fetch(`${API_BASE}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId, message, context })
  });
  if (!resp.ok) throw new Error('Chat failed');
  const data = await resp.json();
  return data.reply as string;
};

// --- Shadbala helpers ---
const SHADBALA_THRESHOLDS: Record<string, number> = {
  Sun: 6.5,
  Moon: 6.0,
  Mars: 5.0,
  Mercury: 7.0,
  Jupiter: 6.5,
  Venus: 5.5,
  Saturn: 5.0,
};

const classifyStrength = (planet: string, score: number): 'Strong' | 'Average' | 'Weak' => {
  const th = SHADBALA_THRESHOLDS[planet] ?? 6.0;
  if (score >= th) return 'Strong';
  if (score >= Math.max(0, th - 1.0)) return 'Average';
  return 'Weak';
};

export const fetchShadbala = async (
  name: string,
  birth: { date: string; time: string; timezone: string; latitude: number; longitude: number; location?: string; la?: string },
  gender: 'male' | 'female' = 'male'
): Promise<ShadbalaData[]> => {
  const payload = {
    name,
    gender,
    date: birth.date,
    time: birth.time.length === 8 ? birth.time : `${birth.time}:00`,
    timezone: birth.timezone,
    latitude: birth.latitude,
    longitude: birth.longitude,
    location: birth.location || '',
    la: birth.la || 'en',
  };
  const resp = await fetch(`${API_BASE}/shadbala/json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) throw new Error('Shadbala fetch failed');
  const data = await resp.json();
  const arr = (data?.shadbala || []) as Array<{ planet: string; score: number }>;
  return arr.map((x) => ({
    planet: (PlanetName as any)[x.planet] ?? x.planet,
    score: x.score,
    strength: classifyStrength(x.planet, x.score),
  }));
};

export const downloadShadbalaPdf = async (
  name: string,
  birth: { date: string; time: string; timezone: string; latitude: number; longitude: number; location?: string; la?: string },
  gender: 'male' | 'female' = 'male'
): Promise<Blob> => {
  const payload = {
    name,
    gender,
    date: birth.date,
    time: birth.time.length === 8 ? birth.time : `${birth.time}:00`,
    timezone: birth.timezone,
    latitude: birth.latitude,
    longitude: birth.longitude,
    location: birth.location || '',
    la: birth.la || 'en',
  };
  const resp = await fetch(`${API_BASE}/shadbala/pdf`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) throw new Error('Shadbala PDF failed');
  return await resp.blob();
};
