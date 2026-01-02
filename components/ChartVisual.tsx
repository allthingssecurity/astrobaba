import React from 'react';
import { ChartData, PlanetName } from '../types';

interface ChartVisualProps {
  data?: ChartData;
  title: string;
}

const SouthIndianChart: React.FC<ChartVisualProps> = ({ data, title }) => {
  // Mapping of signs to grid positions in South Indian Chart
  // 0: Pisces, 1: Aries, 2: Taurus, 3: Gemini
  // 11: Aquarius,                  4: Cancer
  // 10: Capricorn,                 5: Leo
  // 9: Sagittarius, 8: Scorpio, 7: Libra, 6: Virgo
  
  // Grid layout (4x4)
  // [0,0] Pisces  [0,1] Aries   [0,2] Taurus  [0,3] Gemini
  // [1,0] Aquarius                            [1,3] Cancer
  // [2,0] Capricorn                           [2,3] Leo
  // [3,0] Sagit   [3,1] Scorpio [3,2] Libra   [3,3] Virgo

  const getPlanetsInSign = (signName: string) => {
    const positions = Array.isArray((data as any)?.positions) ? (data as any).positions : [];
    return positions.filter(p => p.sign === signName).map(p => {
        let symbol = p.planet.substring(0, 2);
        if (p.planet === PlanetName.Ascendant) symbol = "Asc";
        if (p.planet === PlanetName.Jupiter) symbol = "Ju";
        if (p.planet === PlanetName.Mars) symbol = "Ma";
        if (p.planet === PlanetName.Mercury) symbol = "Me";
        if (p.planet === PlanetName.Moon) symbol = "Mo";
        if (p.planet === PlanetName.Saturn) symbol = "Sa";
        if (p.planet === PlanetName.Sun) symbol = "Su";
        if (p.planet === PlanetName.Venus) symbol = "Ve";
        if (p.planet === PlanetName.Rahu) symbol = "Ra";
        if (p.planet === PlanetName.Ketu) symbol = "Ke";
        
        return (
            <span key={`${p.planet}-${p.degree}-${p.house}`} className={`text-xs font-bold ${p.planet === PlanetName.Ascendant ? 'text-red-400' : 'text-amber-200'}`}>
                {symbol}{p.isRetrograde ? '®' : ''}
            </span>
        );
    });
  };

  const Cell = ({ sign }: { sign: string }) => (
    <div className="border border-slate-600 h-24 w-full p-1 relative flex flex-wrap content-start gap-1 bg-slate-800/50 hover:bg-slate-700 transition-colors">
      <span className="absolute bottom-0 right-1 text-[10px] text-slate-500 uppercase tracking-widest">{sign}</span>
      {getPlanetsInSign(sign)}
    </div>
  );

  const Center = () => (
    <div className="col-span-2 row-span-2 flex items-center justify-center bg-slate-900 border border-slate-600">
      <h3 className="text-xl font-serif text-amber-500 font-bold tracking-wider">{title}</h3>
    </div>
  );

  return (
    <div className="w-full max-w-sm mx-auto shadow-2xl shadow-purple-900/20">
      <div className="grid grid-cols-4 w-full aspect-square border-2 border-amber-600/30">
        <Cell sign="Pisces" />
        <Cell sign="Aries" />
        <Cell sign="Taurus" />
        <Cell sign="Gemini" />
        
        <Cell sign="Aquarius" />
        <Center />
        <Cell sign="Cancer" />
        
        <Cell sign="Capricorn" />
        {/* Center occupies this space */}
        <Cell sign="Leo" />
        
        <Cell sign="Sagittarius" />
        <Cell sign="Scorpio" />
        <Cell sign="Libra" />
        <Cell sign="Virgo" />
      </div>
    </div>
  );
};

export default SouthIndianChart;
