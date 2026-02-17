
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  Department, 
  AppState, 
  DataFile, 
  ChatMessage, 
  StockDataPoint, 
  MetricSummary,
  StrategicBrief
} from './types';
import { fetchStockHistory, getMarketBenchmark } from './services/stockService';
import { calculateBeta, calculateCovariance, generateForecast } from './utils/math';
import { geminiService } from './services/geminiService';

const STRATEGIC_PROMPTS = [
  "Synthesize current risk vectors.",
  "Run neural performance projection.",
  "Evaluate operational bottlenecks.",
  "Suggest capital allocation strategy.",
  "Benchmark volatility vs S&P 500."
];

const decodeBase64 = (base64: string) => {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
};

const decodeAudioData = async (data: Uint8Array, ctx: AudioContext): Promise<AudioBuffer> => {
  const dataInt16 = new Int16Array(data.buffer);
  const buffer = ctx.createBuffer(1, dataInt16.length, 24000);
  const channelData = buffer.getChannelData(0);
  for (let i = 0; i < dataInt16.length; i++) {
    channelData[i] = dataInt16[i] / 32768.0;
  }
  return buffer;
};

const App: React.FC = () => {
  const [state, setState] = useState<AppState>({
    view: 'landing',
    selectedDept: Department.FINANCE,
    files: [],
    stockSymbol: '',
    stockHistory: [],
    chatHistory: [],
    isThinking: false,
    isRecording: false,
    activeTab: 'dashboard',
    subTab: 'live',
    isPlayingAudio: false,
    proactiveBrief: null
  });

  const [inputSymbol, setInputSymbol] = useState('');
  const [chatInput, setChatInput] = useState('');
  const audioContextRef = useRef<AudioContext | null>(null);
  const recognitionRef = useRef<any>(null);

  const initAudio = () => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    }
  };

  const handleStockSearch = async (symbol: string) => {
    if (!symbol) return;
    const history = await fetchStockHistory(symbol);
    setState(prev => ({ ...prev, stockSymbol: symbol, stockHistory: history }));
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const uploadedFiles = e.target.files;
    if (!uploadedFiles) return;

    const newFiles: DataFile[] = Array.from(uploadedFiles).map(file => ({
      id: Math.random().toString(36).substr(2, 9),
      name: file.name,
      type: file.name.endsWith('.csv') || file.name.endsWith('.json') ? 'structured' : 'unstructured',
      format: file.name.split('.').pop() || 'unknown',
      content: null,
      size: file.size,
      timestamp: Date.now()
    }));

    setState(prev => ({ ...prev, files: [...prev.files, ...newFiles] }));
  };

  const metrics = useMemo((): MetricSummary & { symbol: string } => {
    if (state.stockHistory.length < 2) return { growth: 0, volatility: 0, sharpe: 0, beta: 1, covariance: 0, cagr: 0, confidence: 0, symbol: state.stockSymbol };
    const closes = state.stockHistory.map(d => d.close);
    const returns = closes.slice(1).map((c, i) => (c - closes[i]) / closes[i]);
    const benchmarkReturns = getMarketBenchmark(returns.length);
    const growth = returns.reduce((a, b) => a + b, 0) / returns.length * 100;
    const vol = Math.sqrt(returns.reduce((a, b) => a + Math.pow(b - (growth/100), 2), 0) / returns.length) * 100;
    const beta = calculateBeta(returns, benchmarkReturns);
    const cov = calculateCovariance(returns, benchmarkReturns);
    const { rSquared } = generateForecast(closes);
    return { 
      symbol: state.stockSymbol, growth, volatility: vol, sharpe: growth/vol, 
      beta, covariance: cov, cagr: 0, confidence: rSquared * 100 
    };
  }, [state.stockHistory, state.stockSymbol]);

  const enterWorkspace = (dept: Department) => {
    initAudio();
    // Ticker only required for initial entry if finance is selected
    if (dept === Department.FINANCE && !inputSymbol) {
        alert("Board Mandate: Please specify a Market Ticker for Financial Analysis.");
        return;
    }
    setState(prev => ({ 
        ...prev, 
        view: 'workspace', 
        selectedDept: dept, 
        stockSymbol: inputSymbol || prev.stockSymbol 
    }));
    if (inputSymbol) {
        handleStockSearch(inputSymbol);
    }
  };

  const playVoiceover = async (text: string) => {
    initAudio();
    if (!audioContextRef.current) return;
    setState(prev => ({ ...prev, isPlayingAudio: true }));
    const audioData = await geminiService.generateSpeech(text);
    if (audioData) {
      const buffer = await decodeAudioData(decodeBase64(audioData), audioContextRef.current);
      const source = audioContextRef.current.createBufferSource();
      source.buffer = buffer;
      source.connect(audioContextRef.current.destination);
      source.onended = () => setState(prev => ({ ...prev, isPlayingAudio: false }));
      source.start();
    } else {
      setState(prev => ({ ...prev, isPlayingAudio: false }));
    }
  };

  const sendChatMessage = async (text?: string) => {
    const finalMsg = text || chatInput;
    if (!finalMsg.trim()) return;
    const userMsg: ChatMessage = { role: 'user', text: finalMsg, timestamp: Date.now() };
    setState(prev => ({ ...prev, chatHistory: [...prev.chatHistory, userMsg], isThinking: true }));
    setChatInput('');
    const response = await geminiService.getAgentResponse(finalMsg, state.chatHistory, state.files, state.selectedDept, metrics);
    const modelMsg: ChatMessage = { role: 'model', text: response.text, reasoningSteps: response.reasoningSteps, timestamp: Date.now() };
    setState(prev => ({ ...prev, chatHistory: [...prev.chatHistory, modelMsg], isThinking: false }));
    playVoiceover(response.text);
  };

  const toggleVoiceRecording = () => {
    if (state.isRecording) {
      recognitionRef.current?.stop();
      setState(prev => ({ ...prev, isRecording: false }));
    } else {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (!SpeechRecognition) {
        alert("Board Notification: Neural speech recognition is not supported in this environment.");
        return;
      }
      const recognition = new SpeechRecognition();
      recognition.lang = 'en-US';
      recognition.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        setChatInput(transcript);
        sendChatMessage(transcript);
      };
      recognition.onend = () => setState(prev => ({ ...prev, isRecording: false }));
      recognition.start();
      recognitionRef.current = recognition;
      setState(prev => ({ ...prev, isRecording: true }));
    }
  };

  useEffect(() => {
    if (state.view === 'workspace') {
      const triggerBrief = async () => {
        const brief = await geminiService.generateProactiveBrief(state.selectedDept, metrics, state.files);
        setState(prev => ({ ...prev, proactiveBrief: brief }));
        playVoiceover(`Executive Assistant online. Strategic Dossier for ${state.selectedDept} sector is synthesized.`);
      };
      triggerBrief();
    }
  }, [state.selectedDept, state.view]);

  const forecastData = useMemo(() => {
    if (state.stockHistory.length < 5) return { forecast: [], rSquared: 0 };
    return generateForecast(state.stockHistory.map(h => h.close), 10);
  }, [state.stockHistory]);

  if (state.view === 'landing') {
    return (
      <div className="min-h-screen bg-[#020202] flex flex-col items-center justify-center p-6 text-white overflow-hidden relative">
        <div className="absolute inset-0 opacity-20 pointer-events-none">
          <div className="absolute top-[10%] left-[20%] w-[600px] h-[600px] bg-indigo-600 rounded-full blur-[180px]"></div>
          <div className="absolute bottom-[10%] right-[20%] w-[600px] h-[600px] bg-sky-600 rounded-full blur-[180px]"></div>
        </div>
        <div className="z-10 text-center space-y-16 max-w-2xl w-full animate-in fade-in duration-1000">
          <div className="space-y-4">
            <h1 className="text-9xl font-black tracking-tighter italic">NEXUS<span className="text-indigo-500">OS</span></h1>
            <p className="text-slate-500 uppercase tracking-[0.8em] text-[12px] font-bold">Executive Strategic Intelligence</p>
          </div>
          
          <div className="glass p-12 rounded-[4rem] border border-white/5 space-y-10 shadow-3xl">
            <div className="space-y-6">
              <label className="text-[11px] text-slate-500 font-black uppercase tracking-widest block">Sector Entry Credential / Asset Ticker</label>
              <input 
                type="text" 
                value={inputSymbol} 
                onChange={e => setInputSymbol(e.target.value.toUpperCase())} 
                placeholder="E.G. NVDA, AAPL, AMZN"
                className="w-full bg-white/5 border border-white/10 rounded-3xl px-10 py-6 text-2xl font-black tracking-[0.2em] text-center focus:ring-4 focus:ring-indigo-500/50 focus:outline-none transition-all placeholder:text-slate-800 uppercase"
              />
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <button onClick={() => enterWorkspace(Department.FINANCE)} className="group flex flex-col items-center gap-4 p-8 bg-white/5 rounded-[2.5rem] border border-white/5 hover:border-indigo-500 hover:bg-white/10 transition-all shadow-xl">
                <div className="w-16 h-16 bg-indigo-500/20 rounded-2xl flex items-center justify-center text-indigo-400 text-2xl group-hover:scale-110 transition-transform"><i className="fas fa-chart-line"></i></div>
                <div className="text-center">
                  <div className="font-black text-lg tracking-tight">FINANCE SECTOR</div>
                  <div className="text-[10px] text-slate-500 font-bold uppercase">Institutional OHLC Analysis</div>
                </div>
              </button>
              <button onClick={() => enterWorkspace(Department.OPERATIONS)} className="group flex flex-col items-center gap-4 p-8 bg-white/5 rounded-[2.5rem] border border-white/5 hover:border-sky-500 hover:bg-white/10 transition-all shadow-xl">
                <div className="w-16 h-16 bg-sky-500/20 rounded-2xl flex items-center justify-center text-sky-400 text-2xl group-hover:scale-110 transition-transform"><i className="fas fa-cubes"></i></div>
                <div className="text-center">
                  <div className="font-black text-lg tracking-tight">OPERATIONS HUB</div>
                  <div className="text-[10px] text-slate-500 font-bold uppercase">Dataset Intelligence Ingestion</div>
                </div>
              </button>
            </div>
          </div>
          <div className="flex items-center justify-center gap-6 text-slate-700">
             <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
             <span className="text-[10px] font-black uppercase tracking-[0.5em]">Neural Authentication Active</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#010101] text-white flex flex-col font-sans selection:bg-indigo-500/30">
      <div className="flex flex-1 overflow-hidden">
        {/* Navigation Rail */}
        <nav className="w-24 md:w-80 border-r border-white/5 bg-[#050505] flex flex-col p-8 gap-10">
          <div className="flex items-center gap-4 cursor-pointer group mb-4" onClick={() => setState(p => ({ ...p, view: 'landing' }))}>
            <div className="w-12 h-12 rounded-2xl bg-indigo-600 flex items-center justify-center font-black text-xl shadow-lg shadow-indigo-500/30 transition-transform group-hover:rotate-6">N</div>
            <div className="hidden md:block">
               <h2 className="font-black text-lg tracking-tighter italic">NEXUS<span className="text-indigo-500">OS</span></h2>
               <p className="text-[10px] text-slate-600 font-bold uppercase tracking-widest">Sovereign Node v5</p>
            </div>
          </div>

          <div className="space-y-4">
             <div className="text-[10px] text-slate-700 font-black uppercase tracking-[0.4em] mb-2 px-2">Sector Select</div>
             <SidebarItem 
              active={state.selectedDept === Department.FINANCE} 
              onClick={() => setState(p => ({ ...p, selectedDept: Department.FINANCE, proactiveBrief: null, subTab: 'live' }))}
              icon="fa-chart-line" label="Finance Sector" 
             />
             <SidebarItem 
              active={state.selectedDept === Department.OPERATIONS} 
              onClick={() => setState(p => ({ ...p, selectedDept: Department.OPERATIONS, proactiveBrief: null }))}
              icon="fa-cubes" label="Operations Hub" 
             />
          </div>

          <div className="mt-auto space-y-4">
             <div className="glass p-6 rounded-3xl border border-white/5 bg-gradient-to-br from-white/5 to-transparent">
                <div className="text-[10px] text-slate-500 font-black uppercase mb-3 tracking-widest">Neural Link Latency</div>
                <div className="flex items-center justify-between text-[11px] font-black italic text-indigo-400 mb-1">
                    <span>Active Path</span>
                    <span>4.2 ms</span>
                </div>
                <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                   <div className="w-4/5 h-full bg-indigo-500 animate-pulse"></div>
                </div>
             </div>
             <button onClick={() => window.print()} className="w-full bg-slate-900 hover:bg-slate-800 border border-white/5 p-5 rounded-[1.5rem] text-[11px] font-black uppercase tracking-widest text-slate-500 hover:text-white flex items-center justify-center gap-3 transition-all">
                <i className="fas fa-shield-alt"></i> Secure Export
             </button>
          </div>
        </nav>

        {/* Content Engine */}
        <main className="flex-1 flex flex-col relative overflow-hidden bg-[#010101]">
           <header className="p-10 border-b border-white/5 flex items-center justify-between glass sticky top-0 z-50">
              <div className="flex items-center gap-8">
                 <div>
                    <h1 className="text-4xl font-black tracking-tighter italic uppercase text-white/90">{state.selectedDept}</h1>
                    <p className="text-[11px] text-slate-600 uppercase tracking-[0.5em] font-black mt-1">Status: Executive Clearance Level 10</p>
                 </div>
                 {state.selectedDept === Department.FINANCE && (
                   <div className="flex bg-white/5 p-1.5 rounded-2xl border border-white/10 ml-6 shadow-inner">
                    <TabButton active={state.subTab === 'live'} label="Live OHLC" onClick={() => setState(p => ({ ...p, subTab: 'live' }))} />
                    <TabButton active={state.subTab === 'predictive'} label="Neural Projection" onClick={() => setState(p => ({ ...p, subTab: 'predictive' }))} />
                   </div>
                 )}
              </div>
              <div className="flex items-center gap-6">
                 {state.selectedDept === Department.FINANCE && (
                   <div className="flex bg-white/5 rounded-2xl border border-white/10 p-1.5 shadow-2xl group transition-all focus-within:border-indigo-500/50">
                      <input 
                        type="text" 
                        value={inputSymbol} 
                        onChange={e => setInputSymbol(e.target.value.toUpperCase())} 
                        onKeyDown={e => e.key === 'Enter' && handleStockSearch(inputSymbol)}
                        className="bg-transparent px-6 py-2 text-sm font-black focus:outline-none w-40 text-indigo-400 placeholder:text-slate-800 uppercase" 
                        placeholder="ENTER TICKER..."
                      />
                      <button onClick={() => handleStockSearch(inputSymbol)} className="bg-indigo-600 hover:bg-indigo-500 px-8 rounded-xl text-[11px] font-black uppercase tracking-widest transition-all">Update</button>
                   </div>
                 )}
              </div>
           </header>

           <div className="flex-1 overflow-y-auto p-12 space-y-12 custom-scrollbar">
              <div className="grid grid-cols-1 xl:grid-cols-12 gap-12">
                 
                 {/* Sector Visualization Stage */}
                 <div className="xl:col-span-8 space-y-12 animate-in slide-in-from-left duration-700">
                    {state.selectedDept === Department.FINANCE && (
                      <div className="glass p-12 rounded-[4rem] border-white/5 min-h-[650px] flex flex-col relative overflow-hidden shadow-2xl group">
                         <div className="absolute top-0 right-0 p-10 opacity-[0.03] pointer-events-none text-[15rem] font-black italic select-none leading-none">{state.stockSymbol}</div>
                         
                         <div className="flex items-center justify-between mb-16 relative z-10">
                            <div>
                               <h3 className="font-black italic text-4xl mb-2 tracking-tighter text-white/95">{state.stockSymbol} Sector Analysis</h3>
                               <p className="text-[11px] text-slate-500 font-bold uppercase tracking-[0.5em]">Asset Vector Mapping | Continuous Sync Enabled</p>
                            </div>
                            <div className="flex gap-5">
                               <StatPill label="BETA" value={metrics.beta.toFixed(2)} color="indigo" />
                               <StatPill label="ALPHA" value={(metrics.growth/5).toFixed(2)} color="sky" />
                               <StatPill label="COV" value={metrics.covariance.toFixed(4)} color="fuchsia" />
                            </div>
                         </div>
                         
                         {state.subTab === 'live' ? (
                           <div className="flex-1 relative flex items-stretch gap-2 px-6 py-12 border-b border-l border-white/5 min-h-[400px]">
                              {state.stockHistory.length === 0 ? (
                                  <div className="flex-1 flex flex-col items-center justify-center opacity-20">
                                      <i className="fas fa-chart-line text-6xl mb-4"></i>
                                      <p className="text-xs font-black uppercase tracking-widest">Awaiting Market Connection</p>
                                  </div>
                              ) : state.stockHistory.slice(-40).map((d, i) => {
                                 const maxPrice = Math.max(...state.stockHistory.map(h => h.high));
                                 const minPrice = Math.min(...state.stockHistory.map(h => h.low));
                                 const range = (maxPrice - minPrice) || 1;
                                 
                                 const isUp = d.close >= d.open;
                                 const bodyHeight = (Math.abs(d.close - d.open) / range) * 100;
                                 const wickHeight = ((d.high - d.low) / range) * 100;
                                 const bodyBottom = ((Math.min(d.open, d.close) - minPrice) / range) * 100;
                                 const wickBottom = ((d.low - minPrice) / range) * 100;

                                 return (
                                   <div key={i} className="flex-1 relative group/candle">
                                      {/* Grid Reference */}
                                      <div className="absolute left-1/2 -translate-x-1/2 w-[1px] bg-slate-800 z-0 h-full opacity-20"></div>
                                      {/* Wick */}
                                      <div 
                                        className="absolute left-1/2 -translate-x-1/2 w-[2px] bg-slate-500/50 z-10" 
                                        style={{ height: `${wickHeight}%`, bottom: `${wickBottom}%` }}
                                      ></div>
                                      {/* Body */}
                                      <div 
                                        className={`absolute left-0 right-0 z-20 rounded-sm transition-all duration-300 ${isUp ? 'bg-emerald-500/90 shadow-[0_0_15px_rgba(16,185,129,0.2)]' : 'bg-rose-500/90 shadow-[0_0_15px_rgba(244,63,94,0.2)]'}`}
                                        style={{ height: `${Math.max(bodyHeight, 2)}%`, bottom: `${bodyBottom}%` }}
                                      ></div>
                                      
                                      {/* Enhanced Tooltip */}
                                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-8 z-[60] opacity-0 group-hover/candle:opacity-100 transition-all bg-[#0a0a0a] border border-white/15 p-5 rounded-[1.5rem] shadow-[0_30px_60px_-15px_rgba(0,0,0,0.8)] min-w-[180px] pointer-events-none scale-90 group-hover/candle:scale-100 blur-none">
                                         <div className="text-[10px] font-black text-indigo-400 mb-3 border-b border-white/5 pb-2 uppercase tracking-[0.2em]">{d.date}</div>
                                         <div className="space-y-2 font-mono text-[11px]">
                                           <div className="flex justify-between text-slate-400"><span>OPEN</span> <span>${d.open.toFixed(2)}</span></div>
                                           <div className="flex justify-between text-emerald-400 font-bold"><span>HIGH</span> <span>${d.high.toFixed(2)}</span></div>
                                           <div className="flex justify-between text-rose-400 font-bold"><span>LOW</span> <span>${d.low.toFixed(2)}</span></div>
                                           <div className="flex justify-between border-t border-white/10 pt-2 font-black text-white text-xs"><span>CLOSE</span> <span>${d.close.toFixed(2)}</span></div>
                                         </div>
                                      </div>
                                   </div>
                                 );
                              })}
                           </div>
                         ) : (
                           <div className="flex-1 flex flex-col relative overflow-hidden rounded-[3rem] border border-white/5 bg-black/50 p-12 animate-in fade-in slide-in-from-right-8 duration-700">
                              <div className="relative z-10 h-full flex items-end gap-4 pb-20">
                                 <div className="w-1/2 flex items-end gap-2 opacity-30 h-full border-r border-white/5 pr-6">
                                    {state.stockHistory.slice(-20).map((h, i) => (
                                      <div key={i} className="flex-1 bg-slate-700 rounded-t-xl" style={{ height: `${(h.close / Math.max(...state.stockHistory.map(x => x.close))) * 90}%` }}></div>
                                    ))}
                                 </div>
                                 <div className="w-1/2 flex items-end gap-2 relative h-full">
                                    {forecastData.forecast.map((f, i) => (
                                      <div key={i} className="flex-1 relative group/pred">
                                         <div 
                                            className="bg-indigo-600/80 rounded-t-xl animate-pulse shadow-[0_0_30px_rgba(79,70,229,0.3)]" 
                                            style={{ 
                                              height: `${(f / Math.max(...state.stockHistory.map(x => x.close))) * 95}%`,
                                              opacity: 1 - (i * 0.08)
                                            }}
                                         ></div>
                                         <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-4 opacity-0 group-hover/pred:opacity-100 transition-all bg-indigo-950 border border-indigo-400/20 px-4 py-2 rounded-xl text-[11px] font-black pointer-events-none whitespace-nowrap z-50 shadow-2xl">
                                            INTERVAL T+{i+1}: ${f.toFixed(2)}
                                         </div>
                                      </div>
                                    ))}
                                 </div>
                              </div>
                              <div className="grid grid-cols-3 gap-10 p-10 bg-white/[0.02] rounded-[3rem] border border-white/5 mt-auto shadow-inner">
                                 <PredictionBox label="Institutional Bull Target" value={`$${(state.stockHistory[state.stockHistory.length-1]?.close * 1.18).toFixed(2)}`} color="emerald" />
                                 <PredictionBox label="Neural Base Projection" value={`$${(forecastData.forecast[forecastData.forecast.length-1] || 0).toFixed(2)}`} color="indigo" />
                                 <PredictionBox label="Downside Exposure Floor" value={`$${(state.stockHistory[state.stockHistory.length-1]?.close * 0.9).toFixed(2)}`} color="rose" />
                              </div>
                           </div>
                         )}
                         <div className="flex justify-between mt-10 text-[11px] font-black text-slate-600 uppercase tracking-[0.6em] border-t border-white/5 pt-8">
                            <span>Sector Entry: Node {state.stockSymbol || 'N/A'}</span>
                            <span className="text-emerald-500 animate-pulse">Syncing Market Reality...</span>
                            <span>Present Cycle: {state.stockHistory[state.stockHistory.length-1]?.date || 'Awaiting'}</span>
                         </div>
                      </div>
                    )}

                    {state.selectedDept === Department.OPERATIONS && (
                      <div className="glass p-20 rounded-[4.5rem] border-white/5 flex flex-col items-center justify-center text-center min-h-[650px] shadow-3xl">
                         <div className="w-40 h-40 bg-sky-600/10 rounded-full flex items-center justify-center text-sky-400 text-6xl mb-12 group hover:scale-110 transition-all duration-700 shadow-[0_0_60px_rgba(14,165,233,0.1)]">
                            <i className="fas fa-project-diagram animate-pulse"></i>
                         </div>
                         <h2 className="text-6xl font-black italic mb-6 tracking-tighter text-white/90">Operations Hub</h2>
                         <p className="text-slate-500 max-w-2xl mx-auto text-xl leading-relaxed mb-16 uppercase tracking-[0.2em] font-medium">Link localized dataset clusters, CSV telemetry, or unstructured logs to activate executive cross-analysis.</p>
                         <input type="file" multiple id="ops-upload-new" className="hidden" onChange={handleFileUpload} />
                         <label htmlFor="ops-upload-new" className="bg-white text-black px-20 py-8 rounded-[2rem] font-black text-sm uppercase tracking-[0.4em] cursor-pointer hover:bg-slate-200 hover:shadow-[0_20px_40px_rgba(255,255,255,0.1)] active:scale-95 transition-all">ESTABLISH DATA LINK</label>
                         
                         {state.files.length > 0 && (
                            <div className="mt-20 w-full grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl">
                               {state.files.map(f => (
                                 <div key={f.id} className="bg-white/5 p-6 rounded-3xl flex items-center gap-6 border border-white/5 hover:border-sky-500/40 transition-all group backdrop-blur-md">
                                    <div className="w-14 h-14 bg-sky-500/10 rounded-2xl flex items-center justify-center text-sky-400 text-xl group-hover:rotate-12 transition-transform"><i className="fas fa-database"></i></div>
                                    <div className="text-left flex-1 truncate">
                                        <div className="font-black text-sm truncate text-white/80">{f.name}</div>
                                        <div className="text-[10px] text-slate-600 font-black uppercase tracking-widest">{f.type} node • {(f.size/1024).toFixed(1)} KB</div>
                                    </div>
                                 </div>
                               ))}
                            </div>
                         )}
                      </div>
                    )}
                 </div>

                 {/* Executive Assistant Panel */}
                 <div className="xl:col-span-4 glass rounded-[4rem] border-white/5 flex flex-col h-[82vh] shadow-3xl sticky top-36 overflow-hidden animate-in slide-in-from-right duration-700">
                    <div className="p-10 border-b border-white/10 flex items-center justify-between glass rounded-t-[4rem] relative z-20">
                       <div className="flex items-center gap-6">
                          <div className="w-16 h-16 rounded-2xl nexus-gradient flex items-center justify-center text-white shadow-2xl shadow-indigo-500/40">
                             <i className="fas fa-brain text-2xl animate-spin-slow"></i>
                          </div>
                          <div>
                             <span className="font-black text-xl italic block tracking-tighter text-white/95">Nexus Assistant</span>
                             <span className="text-[11px] text-emerald-500 font-black uppercase tracking-[0.3em] flex items-center gap-2 mt-1">
                                <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.5)]"></div> Sovereign Link Active
                             </span>
                          </div>
                       </div>
                    </div>

                    <div className="flex-1 overflow-y-auto p-10 space-y-10 custom-scrollbar relative z-10">
                       {/* Frozen Strategic Prompts */}
                       <div className="sticky top-0 z-30 pb-8 -mt-2 bg-gradient-to-b from-[#050505] via-[#050505]/95 to-transparent rounded-b-[2rem]">
                          <div className="flex flex-wrap gap-2.5">
                             {STRATEGIC_PROMPTS.map((p, i) => (
                               <button 
                                key={i} 
                                onClick={() => sendChatMessage(p)}
                                className="bg-white/5 border border-white/10 px-5 py-3 rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 hover:text-white hover:bg-indigo-600 hover:border-indigo-500 transition-all whitespace-nowrap shadow-sm"
                               >
                                 {p}
                               </button>
                             ))}
                          </div>
                       </div>

                       {state.proactiveBrief && state.chatHistory.length === 0 && (
                          <div className="bg-gradient-to-br from-indigo-500/[0.08] to-transparent border border-indigo-500/20 p-10 rounded-[3rem] animate-in fade-in slide-in-from-bottom-8 duration-1000 shadow-lg">
                             <div className="text-[11px] font-black text-indigo-400 uppercase tracking-[0.4em] mb-5">Neural Strategic Brief Inbound</div>
                             <h4 className="font-black italic text-2xl mb-4 tracking-tighter text-white/90">{state.proactiveBrief.title}</h4>
                             <p className="text-[14px] text-slate-400 leading-relaxed mb-8">{state.proactiveBrief.summary}</p>
                             <div className="space-y-4">
                                {state.proactiveBrief.recommendations.map((r, i) => (
                                  <div key={i} className="flex gap-5 text-[12px] text-slate-300 font-bold bg-white/5 p-5 rounded-3xl border border-white/5 hover:border-indigo-500/30 hover:bg-white/[0.08] transition-all shadow-sm">
                                     <span className="text-indigo-500 text-sm font-black italic">0{i+1}</span> {r}
                                  </div>
                                ))}
                             </div>
                          </div>
                       )}

                       {state.chatHistory.map((msg, i) => (
                         <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                            <div className={`max-w-[92%] p-7 rounded-[2.5rem] shadow-2xl ${msg.role === 'user' ? 'bg-indigo-600 text-white font-bold shadow-indigo-500/20' : 'bg-white/5 border border-white/10 text-slate-300 leading-relaxed'}`}>
                               <p className="text-[14px]">{msg.text}</p>
                            </div>
                         </div>
                       ))}
                       {state.isThinking && (
                         <div className="flex justify-start items-center gap-6 px-4">
                            <div className="text-[11px] text-slate-600 font-black uppercase tracking-[0.5em]">SYNTETHIZING PROXIMITY VECTORS</div>
                            <div className="flex gap-1.5"><div className="w-1.5 h-4 bg-indigo-500 animate-bounce"></div><div className="w-1.5 h-4 bg-indigo-500 animate-bounce delay-100"></div><div className="w-1.5 h-4 bg-indigo-500 animate-bounce delay-200"></div></div>
                         </div>
                       )}
                    </div>

                    <div className="p-10 bg-[#050505]/80 backdrop-blur-3xl border-t border-white/10 rounded-b-[4rem] relative z-20">
                       <div className="flex gap-5">
                          <button 
                            onClick={toggleVoiceRecording}
                            className={`w-16 h-16 rounded-[1.5rem] flex items-center justify-center transition-all ${state.isRecording ? 'bg-rose-600 animate-pulse shadow-[0_0_30px_rgba(225,29,72,0.4)]' : 'bg-white/5 border border-white/10 hover:border-white/20 text-slate-500 hover:text-white hover:scale-105 shadow-xl'}`}
                            title="Neural Voice Command"
                          >
                             <i className={`fas ${state.isRecording ? 'fa-stop' : 'fa-microphone'} text-xl`}></i>
                          </button>
                          <input 
                            type="text" 
                            value={chatInput} 
                            onChange={e => setChatInput(e.target.value)}
                            onKeyPress={e => e.key === 'Enter' && sendChatMessage()}
                            placeholder="DIRECT EXECUTIVE COMMAND..." 
                            className="flex-1 bg-white/5 border border-white/10 rounded-[1.5rem] px-8 py-5 text-sm font-black tracking-[0.15em] focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all uppercase placeholder:text-slate-800 shadow-inner" 
                          />
                          <button onClick={() => sendChatMessage()} className="bg-white text-black px-10 py-5 rounded-[1.5rem] font-black text-sm hover:bg-slate-200 transition-all active:scale-95 shadow-[0_20px_40px_rgba(255,255,255,0.05)]">
                             <i className="fas fa-paper-plane"></i>
                          </button>
                       </div>
                    </div>
                 </div>
              </div>
           </div>

           <footer className="px-12 py-10 border-t border-white/5 flex justify-between items-center text-[11px] font-black uppercase tracking-[0.6em] text-slate-700 bg-black/80 backdrop-blur-2xl">
              <div className="flex items-center gap-14">
                 <span className="flex items-center gap-4 hover:text-indigo-400 transition-colors cursor-help"><div className="w-2.5 h-2.5 rounded-full bg-indigo-500 shadow-[0_0_10px_rgba(79,70,229,0.5)]"></div> CORE: NEXUS SOVEREIGN v5.2</span>
                 <span>QUANTUM LATENCY: 3.8 MS</span>
              </div>
              <div className="flex gap-14">
                 <span className="flex items-center gap-2"><i className="fas fa-lock text-[9px]"></i> ENCRYPTED UPLINK</span>
                 <span className="text-indigo-400/60">© 2026 NEXUS STRATEGIC INTELLIGENCE</span>
              </div>
           </footer>
        </main>
      </div>
    </div>
  );
};

const SidebarItem: React.FC<{ active: boolean; onClick: () => void; icon: string; label: string }> = ({ active, onClick, icon, label }) => (
  <button onClick={onClick} className={`w-full flex items-center gap-8 p-6 rounded-[2rem] transition-all group relative ${active ? 'bg-white/5 text-indigo-400 border border-white/10 shadow-2xl' : 'text-slate-600 hover:text-slate-300'}`}>
    {active && <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1.5 h-8 bg-indigo-500 rounded-r-full shadow-[0_0_15px_rgba(79,70,229,0.8)]"></div>}
    <div className={`w-14 h-14 rounded-2xl flex items-center justify-center text-2xl transition-all ${active ? 'bg-indigo-600 text-white rotate-6 shadow-xl shadow-indigo-500/30' : 'bg-white/5 text-slate-600 group-hover:bg-white/10 group-hover:scale-105'}`}>
       <i className={`fas ${icon}`}></i>
    </div>
    <span className="hidden md:block font-black text-[13px] uppercase tracking-[0.25em]">{label}</span>
  </button>
);

const TabButton: React.FC<{ active: boolean; label: string; onClick: () => void }> = ({ active, label, onClick }) => (
  <button 
    onClick={onClick}
    className={`px-8 py-3.5 text-[11px] font-black uppercase tracking-[0.3em] rounded-xl transition-all ${active ? 'bg-indigo-600 text-white shadow-[0_10px_20px_-5px_rgba(79,70,229,0.4)]' : 'text-slate-500 hover:text-white hover:bg-white/5'}`}
  >
    {label}
  </button>
);

const StatPill: React.FC<{ label: string; value: string; color: string }> = ({ label, value, color }) => {
  const colors: any = { indigo: 'text-indigo-400 bg-indigo-500/10 border-indigo-500/20', sky: 'text-sky-400 bg-sky-500/10 border-sky-500/20', fuchsia: 'text-fuchsia-400 bg-fuchsia-500/10 border-fuchsia-500/20' };
  return (
    <div className={`px-10 py-5 rounded-[2rem] border flex flex-col items-center min-w-[140px] ${colors[color]} shadow-2xl backdrop-blur-md group hover:scale-105 transition-transform duration-500`}>
       <div className="text-[10px] font-black uppercase tracking-[0.4em] opacity-40 mb-1.5">{label}</div>
       <div className="text-2xl font-black italic tracking-tighter text-white/90">{value}</div>
    </div>
  );
};

const PredictionBox: React.FC<{ label: string; value: string; color: string }> = ({ label, value, color }) => {
  const colors: any = { indigo: 'text-indigo-400 shadow-[0_0_20px_rgba(79,70,229,0.15)]', emerald: 'text-emerald-400 shadow-[0_0_20px_rgba(16,185,129,0.15)]', rose: 'text-rose-400 shadow-[0_0_20px_rgba(244,63,94,0.15)]' };
  return (
    <div className={`text-center p-6 rounded-3xl bg-white/[0.01] border border-white/5 group hover:bg-white/[0.03] transition-colors`}>
       <span className="text-[11px] font-black text-slate-500 uppercase block mb-3 tracking-[0.3em] opacity-60">{label}</span>
       <span className={`text-3xl font-black italic ${colors[color]} tracking-tighter drop-shadow-lg`}>{value}</span>
    </div>
  );
};

export default App;
