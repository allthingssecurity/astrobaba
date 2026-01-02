import React, { useEffect, useState } from 'react';
import { BirthDetails, FullHoroscope, ChatMessage, ChartData, ComputeBundle } from './types';
import { API_BASE, calculateCharts, fetchShadbala, downloadShadbalaPdf } from './services/astrologyService';
import { analyzeHoroscope, chatWithAstrologer } from './services/geminiService';
import SouthIndianChart from './components/ChartVisual';
import ReactMarkdown from 'react-markdown';

const App: React.FC = () => {
  const [step, setStep] = useState<'input' | 'dashboard'>('input');
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [activeTab, setActiveTab] = useState<'d1' | 'd9' | 'd10' | 'd4' | 'd7'>('d1');
  
  const [birthDetails, setBirthDetails] = useState<BirthDetails>({
    name: '',
    dob: '',
    time: '',
    location: ''
  });

  const [horoscope, setHoroscope] = useState<FullHoroscope | null>(null);
  const [computeBundle, setComputeBundle] = useState<ComputeBundle | null>(null);
  const [question, setQuestion] = useState("");
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [resolving, setResolving] = useState(false);
  const [resolved, setResolved] = useState<{display?: string; lat?: number; lon?: number; offset?: string}>({});
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [manualMode, setManualMode] = useState(false);
  const [manual, setManual] = useState<{offset?: string; lat?: string; lon?: string}>({});

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setBirthDetails({ ...birthDetails, [e.target.name]: e.target.value });
  };

  const resolveLocation = async (): Promise<{display: string; lat: number; lon: number; offset: string} | null> => {
    setResolveError(null);
    if (!birthDetails.location.trim()) {
      setResolveError('Enter a location');
      return null;
    }
    setResolving(true);
    try {
      const r = await fetch(`${API_BASE}/api/geo/resolve?q=${encodeURIComponent(birthDetails.location)}`);
      if (!r.ok) throw new Error(`Resolve failed (${r.status})`);
      const g = await r.json();
      const obj = { display: g.display_name as string, lat: g.latitude as number, lon: g.longitude as number, offset: g.offset as string };
      setResolved(obj);
      setManualMode(false);
      return obj;
    } catch (err:any) {
      setResolveError(err?.message || 'Failed to resolve location');
      setResolved({});
      return null;
    } finally {
      setResolving(false);
    }
  };

  // No auto-resolve; resolve happens on submit, else fall back to manual inputs

  const handleGenerateCharts = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      // Ensure location is resolved first
      let useOffset: string | undefined = resolved.offset;
      let useLat: number | undefined = resolved.lat;
      let useLon: number | undefined = resolved.lon;
      if (manualMode) {
        if (!manual.offset || !manual.lat || !manual.lon) {
          throw new Error('Please enter timezone (+HH:MM), latitude, and longitude');
        }
        useOffset = manual.offset as string;
        useLat = parseFloat(manual.lat as string);
        useLon = parseFloat(manual.lon as string);
      } else {
        const res = await resolveLocation();
        if (!res) {
          // Ask user to enter manually
          setManualMode(true);
          setLoading(false);
          setResolveError('Unable to resolve location. Enter timezone (+HH:MM), latitude and longitude, or try a more specific place.');
          return;
        }
        useOffset = res.offset;
        useLat = res.lat;
        useLon = res.lon;
      }
      const bundle = await calculateCharts(
        birthDetails.name,
        birthDetails.dob,
        birthDetails.time,
        birthDetails.location,
        useOffset as string,
        useLat as number,
        useLon as number
      );
      setComputeBundle(bundle);
      // Fetch Shadbala now that we have accurate TZ/coords
      try {
        const bmeta = bundle.compute?.meta?.birth || {};
        const shadbala = await fetchShadbala(birthDetails.name, {
          date: bmeta.date,
          time: bmeta.time,
          timezone: bmeta.timezone,
          latitude: bmeta.latitude,
          longitude: bmeta.longitude,
          location: bmeta.location,
          la: bundle.compute?.meta?.language || 'en',
        });
        setHoroscope({ ...bundle.ui, shadbala });
      } catch (e) {
        // Keep UI but leave Shadbala empty if it fails
        setHoroscope(bundle.ui);
      }
      setStep('dashboard');
      
      // Auto-generate initial analysis
      setAnalyzing(true);
      const initialAnalysis = await analyzeHoroscope(birthDetails, bundle);
      setChatHistory([{ role: 'model', text: initialAnalysis }]);
    } catch (error) {
      console.error(error);
      alert("Failed to generate charts.");
    } finally {
      setLoading(false);
      setAnalyzing(false);
    }
  };

  const handleAskQuestion = async () => {
    if (!question.trim() || !horoscope) return;
    
    const newHistory: ChatMessage[] = [...chatHistory, { role: 'user', text: question }];
    setChatHistory(newHistory);
    setQuestion("");
    setAnalyzing(true);

    const response = await chatWithAstrologer('default-session', question, computeBundle || undefined);
    
    setChatHistory([...newHistory, { role: 'model', text: response }]);
    setAnalyzing(false);
  };

  const renderActiveChart = () => {
    if (!horoscope) return null;
    switch (activeTab) {
      case 'd1': return <SouthIndianChart data={horoscope.d1} title="Rasi (Body/Destiny)" />;
      case 'd9': return <SouthIndianChart data={horoscope.d9} title="Navamsa (Marriage)" />;
      case 'd10': return <SouthIndianChart data={horoscope.d10} title="Dasamsa (Career)" />;
      case 'd4': return <SouthIndianChart data={horoscope.d4} title="Chaturthamsa (Assets)" />;
      case 'd7': return <SouthIndianChart data={horoscope.d7} title="Saptamsa (Progeny)" />;
      default: return null;
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 pb-20 font-sans">
      {/* Header */}
      <header className="bg-slate-950 border-b border-amber-900/30 sticky top-0 z-50 shadow-xl">
        <div className="max-w-7xl mx-auto px-4 py-4 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-amber-500 to-purple-800 flex items-center justify-center border border-amber-500/30">
              <span className="text-xl">🕉️</span>
            </div>
            <div>
              <h1 className="text-2xl font-serif font-bold text-transparent bg-clip-text bg-gradient-to-r from-amber-200 to-amber-500">
                Parasara Hora AI
              </h1>
              <p className="text-[10px] text-slate-500 uppercase tracking-widest">Advanced Vedic Analytics</p>
            </div>
          </div>
          {step === 'dashboard' && (
            <button 
              onClick={() => { setStep('input'); setChatHistory([]); setHoroscope(null); }}
              className="text-xs font-bold uppercase tracking-wider text-slate-400 hover:text-amber-400 transition-colors border border-slate-700 px-3 py-1 rounded hover:border-amber-500/50"
            >
              New Horoscope
            </button>
          )}
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        {step === 'input' ? (
          <div className="max-w-xl mx-auto mt-12 relative">
             <div className="absolute inset-0 bg-gradient-to-r from-purple-500/10 to-amber-500/10 blur-3xl rounded-full"></div>
            <div className="bg-slate-800/80 backdrop-blur-sm p-8 rounded-2xl shadow-2xl border border-slate-700 relative z-10">
              <div className="text-center mb-8">
                <h2 className="text-3xl font-serif text-amber-100 mb-2">Generate Birth Chart</h2>
                <p className="text-slate-400 text-sm">Enter precise details for D1-D9-D10 analysis and Dasha calculation.</p>
              </div>
              
              <form onSubmit={handleGenerateCharts} className="space-y-5">
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Full Name</label>
                  <input
                    required
                    name="name"
                    type="text"
                    value={birthDetails.name}
                    onChange={handleInputChange}
                    className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 focus:ring-2 focus:ring-amber-500 outline-none transition-all text-amber-100 placeholder-slate-600"
                    placeholder="e.g. Arjuna"
                  />
                </div>
                <div className="grid grid-cols-2 gap-5">
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Date of Birth</label>
                    <input
                      required
                      name="dob"
                      type="date"
                      value={birthDetails.dob}
                      onChange={handleInputChange}
                      className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 focus:ring-2 focus:ring-amber-500 outline-none transition-all text-amber-100"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Time of Birth</label>
                    <input
                      required
                      name="time"
                      type="time"
                      value={birthDetails.time}
                      onChange={handleInputChange}
                      className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 focus:ring-2 focus:ring-amber-500 outline-none transition-all text-amber-100"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Location</label>
                  <input
                    required
                    name="location"
                    type="text"
                    value={birthDetails.location}
                    onChange={handleInputChange}
                    className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 focus:ring-2 focus:ring-amber-500 outline-none transition-all text-amber-100 placeholder-slate-600"
                    placeholder="City, Country"
                  />
                  <div className="mt-2 flex items-center gap-3">
                    {resolved.display && !manualMode && (
                      <span className="text-xs text-slate-400">Resolved: {resolved.display} • {resolved.offset} • {resolved.lat?.toFixed(4)}, {resolved.lon?.toFixed(4)}</span>
                    )}
                    {resolveError && (
                      <span className="text-xs text-red-400">{resolveError}</span>
                    )}
                    {!manualMode && (
                      <button type="button" onClick={() => setManualMode(true)} className="text-xs px-3 py-1 rounded border border-slate-600 hover:border-amber-500">Enter manually</button>
                    )}
                    {manualMode && (
                      <button type="button" onClick={() => { setManualMode(false); setResolveError(null); }} className="text-xs px-3 py-1 rounded border border-slate-600 hover:border-amber-500">Use automatic</button>
                    )}
                  </div>
                  {manualMode && (
                    <div className="grid grid-cols-3 gap-3 mt-2">
                      <input
                        placeholder="+05:30"
                        className="bg-slate-900 border border-slate-600 rounded px-2 py-2 text-sm"
                        value={manual.offset || ''}
                        onChange={(e)=>setManual({...manual, offset: e.target.value})}
                      />
                      <input
                        placeholder="28.6139"
                        className="bg-slate-900 border border-slate-600 rounded px-2 py-2 text-sm"
                        value={manual.lat || ''}
                        onChange={(e)=>setManual({...manual, lat: e.target.value})}
                      />
                      <input
                        placeholder="77.2090"
                        className="bg-slate-900 border border-slate-600 rounded px-2 py-2 text-sm"
                        value={manual.lon || ''}
                        onChange={(e)=>setManual({...manual, lon: e.target.value})}
                      />
                    </div>
                  )}
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-gradient-to-r from-amber-600 to-purple-700 hover:from-amber-500 hover:to-purple-600 text-white font-bold py-4 rounded-lg mt-6 shadow-xl shadow-purple-900/20 transform transition-all hover:scale-[1.01] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {loading ? (
                    <>
                      <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      Computing Planetary Longitudes...
                    </>
                  ) : (
                    'Generate Full Horoscope Analysis'
                  )}
                </button>
              </form>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            
            {/* Left Column: Charts & Data */}
            <div className="lg:col-span-5 space-y-6">
              {horoscope && (
                <>
                  {/* Current Dasha Card */}
                  <div className="bg-gradient-to-br from-slate-800 to-slate-900 p-5 rounded-xl border border-amber-500/20 shadow-lg">
                    <h3 className="text-xs font-bold text-amber-500 uppercase tracking-widest mb-4 flex items-center gap-2">
                       <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
                       Current Vimshottari Period
                    </h3>
                    <div className="flex items-center justify-between mb-4">
                        <div className="text-center">
                            <p className="text-xs text-slate-400">Mahadasha</p>
                            <p className="text-2xl font-serif font-bold text-white">{horoscope.currentDasha.mahadasha.lord}</p>
                            <p className="text-[10px] text-slate-500">Until {horoscope.currentDasha.mahadasha.endDate}</p>
                        </div>
                        <div className="text-slate-600 text-2xl">➔</div>
                        <div className="text-center">
                            <p className="text-xs text-slate-400">Antardasha</p>
                            <p className="text-2xl font-serif font-bold text-amber-200">{horoscope.currentDasha.antardasha.lord}</p>
                            <p className="text-[10px] text-slate-500">Until {horoscope.currentDasha.antardasha.endDate}</p>
                        </div>
                    </div>
                    <div className="bg-slate-950/50 rounded p-2 text-center text-xs text-slate-400 border border-slate-700">
                        Birth Nakshatra: <span className="text-amber-100 font-bold">{horoscope.nakshatra}</span>
                    </div>
                  </div>

                  {/* Tabs */}
                  <div className="flex bg-slate-800 rounded-lg p-1 border border-slate-700 overflow-x-auto">
                  {(['d1', 'd9', 'd10', 'd4', 'd7'] as const).map((tab) => (
                        <button
                            key={tab}
                            onClick={() => setActiveTab(tab)}
                            className={`flex-1 py-2 px-3 text-xs font-bold uppercase tracking-wider rounded transition-all ${
                                activeTab === tab 
                                ? 'bg-amber-600 text-white shadow' 
                                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700'
                            }`}
                        >
                            {tab.toUpperCase()}
                        </button>
                    ))}
                  </div>

                  {/* Chart Visual */}
                  <div className="bg-slate-800 p-4 rounded-xl border border-slate-700 shadow-xl">
                    {renderActiveChart()}
                    {(['d10','d4','d7'] as const).includes(activeTab) && (
                      <div className="mt-3 text-center">
                        <button
                          className="text-xs px-3 py-2 rounded border border-slate-600 hover:border-amber-500 hover:text-amber-300"
                          onClick={async () => {
                            if (!computeBundle) return;
                            // Re-run compute requesting this varga only
                            const birthMeta = computeBundle?.compute?.meta?.birth || null;
                            if (!birthMeta) { alert('Missing birth meta to reload chart'); return; }
                            const chartType = activeTab === 'd10' ? 'dasamsa' : activeTab === 'd4' ? 'chaturthamsa' : 'saptamsa';
                            try {
                              const resp = await fetch(`${API_BASE}/api/compute`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ birth: birthMeta, include_divisional: [chartType], include_transits: false })
                              });
                              if (!resp.ok) throw new Error('Failed');
                              const data = await resp.json();
                              const { mapDivisionalToChart } = await import('./services/astrologyService');
                              const chartName = activeTab === 'd10' ? 'D10 Dasamsa (Career)' : activeTab === 'd4' ? 'D4 Chaturthamsa (Assets)' : 'D7 Saptamsa (Progeny)';
                              const chart = mapDivisionalToChart(chartName, data.divisional[chartType]);
                              setHoroscope({
                                ...horoscope!,
                                [activeTab]: chart,
                              });
                            } catch (e) {
                              alert('Rate limited or failed to load this varga. Please retry.');
                            }
                          }}
                        >
                          Load this chart
                        </button>
                      </div>
                    )}
                  </div>
                  
                  {/* Shadbala Table */}
                  <div className="bg-slate-800 p-5 rounded-xl border border-slate-700">
                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">Planetary Strength (Shadbala)</h3>
                    <div className="space-y-3">
                      {horoscope.shadbala.map((s) => (
                        <div key={s.planet} className="flex items-center justify-between group">
                          <span className="text-slate-300 w-24 text-sm">{s.planet}</span>
                          <div className="flex-1 mx-3 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                            <div 
                              className={`h-full transition-all duration-1000 ${
                                s.strength === 'Strong' ? 'bg-green-400 shadow-[0_0_10px_rgba(74,222,128,0.5)]' : 
                                s.strength === 'Average' ? 'bg-amber-400' : 'bg-red-400'
                              }`} 
                              style={{ width: `${Math.min((s.score / 8) * 100, 100)}%` }}
                            ></div>
                          </div>
                          <span className={`text-xs font-mono w-16 text-right ${
                             s.strength === 'Strong' ? 'text-green-400 font-bold' : 'text-slate-500'
                          }`}>{s.score.toFixed(2)}</span>
                        </div>
                      ))}
                      {horoscope.shadbala.length === 0 && (
                        <div className="text-xs text-slate-500">
                          Shadbala table not available yet for your plan. You can still download the official PDF.
                        </div>
                      )}
                      <div className="pt-3 text-center">
                        <button
                          onClick={async ()=>{
                            if (!computeBundle) return;
                            try {
                              const b = computeBundle.compute?.meta?.birth || {};
                              const blob = await downloadShadbalaPdf(birthDetails.name, {
                                date: b.date, time: b.time, timezone: b.timezone,
                                latitude: b.latitude, longitude: b.longitude, location: b.location,
                                la: computeBundle.compute?.meta?.language || 'en'
                              });
                              const url = URL.createObjectURL(blob);
                              const a = document.createElement('a');
                              a.href = url; a.download = 'shadbala.pdf'; a.click();
                              URL.revokeObjectURL(url);
                            } catch (e) {
                              alert('Could not download Shadbala PDF');
                            }
                          }}
                          className="text-xs px-3 py-2 rounded border border-slate-600 hover:border-amber-500 hover:text-amber-300"
                        >
                          Download Official Shadbala PDF
                        </button>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Right Column: AI Analysis */}
            <div className="lg:col-span-7 flex flex-col h-[calc(100vh-120px)] sticky top-24">
              <div className="flex-1 bg-slate-800/90 backdrop-blur rounded-2xl border border-slate-700 flex flex-col overflow-hidden shadow-2xl relative">
                {/* Chat Header */}
                <div className="p-4 bg-slate-900 border-b border-slate-700 flex items-center justify-between shrink-0">
                   <h3 className="text-amber-100 font-serif font-bold flex items-center gap-2">
                     <span className="text-xl">📜</span>
                     Vedic Report & Analysis
                   </h3>
                   <div className="flex gap-2">
                     <span className="text-[10px] bg-purple-900/40 text-purple-200 border border-purple-500/30 px-2 py-1 rounded uppercase tracking-wider">Parasara Hora Sastra</span>
                   </div>
                </div>
                
                {/* Chat Area */}
                <div className="flex-1 overflow-y-auto p-6 space-y-6 scroll-smooth">
                  {chatHistory.length === 0 && analyzing && (
                    <div className="flex flex-col items-center justify-center h-full text-slate-500 gap-4">
                      <div className="w-12 h-12 border-4 border-slate-600 border-t-amber-500 rounded-full animate-spin"></div>
                      <p className="text-sm tracking-wider animate-pulse">Consulting the Stars...</p>
                    </div>
                  )}
                  
                  {chatHistory.map((msg, idx) => (
                    <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[95%] rounded-2xl p-6 shadow-lg ${
                        msg.role === 'user' 
                          ? 'bg-gradient-to-br from-purple-600 to-purple-800 text-white rounded-tr-none' 
                          : 'bg-slate-700/50 text-slate-200 rounded-tl-none border border-slate-600/50'
                      }`}>
                        {msg.role === 'model' ? (
                          <div className="prose prose-invert prose-sm max-w-none prose-headings:text-amber-200 prose-headings:font-serif prose-strong:text-amber-100 prose-a:text-purple-300">
                            <ReactMarkdown>{msg.text}</ReactMarkdown>
                          </div>
                        ) : (
                          <p className="text-sm font-medium">{msg.text}</p>
                        )}
                      </div>
                    </div>
                  ))}
                  
                  {analyzing && chatHistory.length > 0 && (
                     <div className="flex justify-start">
                        <div className="bg-slate-700/30 p-4 rounded-2xl rounded-tl-none border border-slate-600/50 flex gap-1 items-center">
                          <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce"></span>
                          <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce delay-75"></span>
                          <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce delay-150"></span>
                        </div>
                     </div>
                  )}
                </div>

                {/* Input Area */}
                <div className="p-4 bg-slate-900 border-t border-slate-700 shrink-0">
                  <div className="relative group">
                    <input
                      type="text"
                      value={question}
                      onChange={(e) => setQuestion(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleAskQuestion()}
                      placeholder="Ask specific questions (e.g. 'When will I get promoted?', 'Is my health okay?')"
                      disabled={analyzing}
                      className="w-full bg-slate-800 border border-slate-600 text-slate-100 rounded-xl pl-4 pr-14 py-4 focus:ring-2 focus:ring-amber-500 focus:border-transparent outline-none disabled:opacity-50 transition-all shadow-inner"
                    />
                    <button 
                      onClick={handleAskQuestion}
                      disabled={analyzing || !question.trim()}
                      className="absolute right-2 top-2 bottom-2 aspect-square bg-amber-600 text-white rounded-lg hover:bg-amber-500 disabled:opacity-50 transition-all flex items-center justify-center shadow-lg hover:shadow-amber-500/20"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 transform -rotate-45" viewBox="0 0 20 20" fill="currentColor">
                        <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default App;
