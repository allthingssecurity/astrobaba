export interface BirthDetails {
  name: string;
  dob: string;
  time: string;
  location: string; // display-only place name
  timezone?: string; // e.g. +05:30
  latitude?: number;
  longitude?: number;
}

export enum PlanetName {
  Sun = 'Sun',
  Moon = 'Moon',
  Mars = 'Mars',
  Mercury = 'Mercury',
  Jupiter = 'Jupiter',
  Venus = 'Venus',
  Saturn = 'Saturn',
  Rahu = 'Rahu',
  Ketu = 'Ketu',
  Ascendant = 'Ascendant'
}

export interface PlanetaryPosition {
  planet: PlanetName;
  sign: string; // Aries, Taurus, etc.
  degree: number;
  house: number; // 1-12
  nakshatra: string;
  isRetrograde: boolean;
}

export interface ChartData {
  chartName: string; // D1, D9, etc.
  positions: PlanetaryPosition[];
}

export interface ShadbalaData {
  planet: PlanetName;
  score: number; // Rupas
  strength: 'Strong' | 'Average' | 'Weak';
}

export interface DashaPeriod {
  lord: PlanetName;
  startDate: string; // ISO Date string
  endDate: string; // ISO Date string
  durationYears: number;
}

export interface CurrentDasha {
  mahadasha: DashaPeriod;
  antardasha: DashaPeriod;
  pratyantardasha: string; // Simplified for display
  balanceAtBirth: string;
}

export interface FullHoroscope {
  d1: ChartData;
  d9: ChartData;
  d10: ChartData; // Career
  d7: ChartData;  // Progeny
  d4: ChartData;  // Assets
  shadbala: ShadbalaData[]; // May be empty if not available
  currentDasha: CurrentDasha;
  nakshatra: string;
}

export interface ComputeBundle {
  ui: FullHoroscope;
  compute: any; // Raw backend compute response for AI analysis/chat
}

export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
  usedCharts?: string[];
}
