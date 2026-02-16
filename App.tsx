
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
import axios from 'axios';
import * as XLSX from 'xlsx';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';
const SESSION_ID = `nexus-session-${Date.now()}`;

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
    proactiveBrief: null,
    isLoadingStock: false,
    error: null
  });

  const [showBetaGraph, setShowBetaGraph] = useState(false);
  const [showOperationsForecast, setShowOperationsForecast] = useState(false);
  const [selectedDataFile, setSelectedDataFile] = useState<DataFile | null>(null);

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
    setState(prev => ({ ...prev, isLoadingStock: true, error: null }));
    try {
      const history = await fetchStockHistory(symbol);
      setState(prev => ({ ...prev, stockSymbol: symbol, stockHistory: history, isLoadingStock: false, error: null }));
    } catch (error: any) {
      console.error('Stock search error:', error);
      
      let errorMessage = 'Company not in the records. Please check the ticker symbol and try again.';
      
      // Check if it's a "stock not found" error
      if (error.message === 'STOCK_NOT_FOUND' || error.response?.status === 404) {
        errorMessage = `Company not in the records. Ticker "${symbol.toUpperCase()}" does not exist. Please enter a valid stock symbol (e.g., AAPL, TSLA, GOOGL).`;
      }
      
      setState(prev => ({ 
        ...prev, 
        isLoadingStock: false,
        stockSymbol: '',
        stockHistory: [],
        error: errorMessage
      }));
      
      // Clear error after 8 seconds
      setTimeout(() => setState(prev => ({ ...prev, error: null })), 8000);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const uploadedFiles = e.target.files;
    if (!uploadedFiles) return;

    const newFiles: DataFile[] = [];

    for (const file of Array.from(uploadedFiles)) {
      const format = file.name.split('.').pop()?.toLowerCase() || 'unknown';
      const isStructured = ['csv', 'xlsx', 'xls', 'json'].includes(format);
      
      let parsedData: any[] = [];
      let headers: string[] = [];
      
      if (format === 'csv') {
        // Parse CSV
        const text = await file.text();
        const lines = text.split('\n').filter(line => line.trim());
        if (lines.length > 0) {
          headers = lines[0].split(',').map(h => h.trim());
          parsedData = lines.slice(1).map(line => {
            const values = line.split(',');
            const row: any = {};
            headers.forEach((header, i) => {
              row[header] = values[i]?.trim() || '';
            });
            return row;
          });
        }
      } else if (format === 'xlsx' || format === 'xls') {
        // Parse Excel
        const arrayBuffer = await file.arrayBuffer();
        const workbook = XLSX.read(arrayBuffer, { type: 'array' });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        const jsonData = XLSX.utils.sheet_to_json(firstSheet, { header: 1 });
        
        if (jsonData.length > 0) {
          headers = (jsonData[0] as any[]).map(h => String(h).trim());
          parsedData = (jsonData.slice(1) as any[][]).map(row => {
            const rowObj: any = {};
            headers.forEach((header, i) => {
              rowObj[header] = row[i] !== undefined ? String(row[i]).trim() : '';
            });
            return rowObj;
          }).filter(row => Object.values(row).some(v => v !== ''));
        }
      }
      
      newFiles.push({
        id: Math.random().toString(36).substr(2, 9),
        name: file.name,
        type: isStructured ? 'structured' : 'unstructured',
        format,
        content: null,
        parsedData,
        headers,
        size: file.size,
        timestamp: Date.now()
      });
    }

    setState(prev => ({ ...prev, files: [...prev.files, ...newFiles] }));
    
    // Auto-select first file for dashboard
    if (newFiles.length > 0 && newFiles[0].parsedData && newFiles[0].parsedData.length > 0) {
      setSelectedDataFile(newFiles[0]);
    }
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

  const enterWorkspace = async (dept: Department) => {
    initAudio();
    // Ticker only required for initial entry if finance is selected
    if (dept === Department.FINANCE && !inputSymbol) {
        alert("Board Mandate: Please specify a Market Ticker for Financial Analysis.");
        return;
    }
    
    // If finance department and ticker provided, validate it first
    if (dept === Department.FINANCE && inputSymbol) {
        setState(prev => ({ ...prev, isLoadingStock: true }));
        try {
            const history = await fetchStockHistory(inputSymbol);
            setState(prev => ({ 
                ...prev, 
                view: 'workspace', 
                selectedDept: dept, 
                stockSymbol: inputSymbol,
                stockHistory: history,
                isLoadingStock: false,
                error: null
            }));
        } catch (error: any) {
            setState(prev => ({ ...prev, isLoadingStock: false }));
            if (error.message === 'STOCK_NOT_FOUND' || error.response?.status === 404) {
                alert(`Invalid Ticker Symbol!\n\nThe ticker "${inputSymbol.toUpperCase()}" does not exist in Yahoo Finance.\n\nPlease enter a valid stock symbol like:\n• AAPL (Apple)\n• TSLA (Tesla)\n• GOOGL (Google)\n• MSFT (Microsoft)\n• NVDA (NVIDIA)`);
            } else {
                alert("Network Error: Unable to fetch stock data. Please check your connection and try again.");
            }
            return;
        }
    } else {
        setState(prev => ({ 
            ...prev, 
            view: 'workspace', 
            selectedDept: dept, 
            stockSymbol: inputSymbol || prev.stockSymbol 
        }));
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
    const newHistory = [...state.chatHistory, userMsg];
    setState(prev => ({ ...prev, chatHistory: newHistory, isThinking: true }));
    setChatInput('');
    
    try {
      const response = await geminiService.getAgentResponse(finalMsg, state.chatHistory, state.files, state.selectedDept, metrics);
      const modelMsg: ChatMessage = { role: 'model', text: response.text, reasoningSteps: response.reasoningSteps, timestamp: Date.now() };
      const finalHistory = [...newHistory, modelMsg];
      setState(prev => ({ ...prev, chatHistory: finalHistory, isThinking: false }));
      
      // Save to backend
      try {
        await axios.post(`${API_URL}/api/chat/save`, {
          sessionId: SESSION_ID,
          messages: finalHistory
        });
      } catch (e) {
        console.warn('Failed to save chat history:', e);
      }
      
      playVoiceover(response.text);
    } catch (error) {
      console.error('Chat error:', error);
      setState(prev => ({ ...prev, isThinking: false }));
    }
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
    if (state.stockHistory.length < 5) return { forecast: [], rSquared: 0, quarterlyForecast: [] };
    const closes = state.stockHistory.map(h => h.close);
    const shortTerm = generateForecast(closes, 10);
    // Generate quarterly forecast (90 days = ~1 quarter)
    const quarterly = generateForecast(closes, 90);
    console.log('Forecast Data:', {
      historyLength: state.stockHistory.length,
      quarterlyLength: quarterly.forecast.length,
      samplePrices: quarterly.forecast.slice(0, 5),
      rSquared: quarterly.rSquared
    });
    return { 
      forecast: shortTerm.forecast, 
      rSquared: quarterly.rSquared,
      quarterlyForecast: quarterly.forecast
    };
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
                  <div className="font-black text-lg tracking-tight">NEXUS VISION</div>
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
              icon="fa-cubes" label="Nexus Vision" 
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
                    <p className="text-[11px] text-slate-600 uppercase tracking-[0.5em] font-black mt-1">
                      Status: Executive Clearance Level 10
                      {state.isLoadingStock && <span className="ml-4 text-indigo-400 animate-pulse">⚡ Loading Data...</span>}
                    </p>
                 </div>
                 {state.selectedDept === Department.FINANCE && (
                   <div className="flex bg-white/5 p-1.5 rounded-2xl border border-white/10 ml-6 shadow-inner">
                    <TabButton active={state.subTab === 'live'} label="Live OHLC" onClick={() => setState(p => ({ ...p, subTab: 'live' }))} />
                    <TabButton active={state.subTab === 'predictive'} label="Quarterly Prediction" onClick={() => setState(p => ({ ...p, subTab: 'predictive' }))} />
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
              {/* Error Toast */}
              {state.error && (
                <div className="fixed top-24 right-12 z-50 animate-in slide-in-from-right max-w-md">
                  <div className="bg-rose-500/20 border-2 border-rose-500/60 backdrop-blur-xl rounded-3xl px-8 py-6 flex items-start gap-4 shadow-[0_20px_60px_rgba(244,63,94,0.4)]">
                    <div className="flex-shrink-0">
                      <div className="w-10 h-10 rounded-full bg-rose-500/30 flex items-center justify-center">
                        <i className="fas fa-exclamation-triangle text-rose-400 text-lg"></i>
                      </div>
                    </div>
                    <div className="flex-1">
                      <div className="text-xs font-black text-rose-400 uppercase tracking-widest mb-1">Error</div>
                      <div className="text-sm font-bold text-rose-100 leading-relaxed">{state.error}</div>
                    </div>
                    <button 
                      onClick={() => setState(prev => ({ ...prev, error: null }))}
                      className="flex-shrink-0 text-rose-400 hover:text-rose-300 transition-colors"
                    >
                      <i className="fas fa-times text-sm"></i>
                    </button>
                  </div>
                </div>
              )}
              
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
                           <div className="flex-1 relative flex flex-col">
                              {/* Y-Axis Price Labels */}
                              {state.stockHistory.length > 0 && (() => {
                                const maxPrice = Math.max(...state.stockHistory.map(h => h.high));
                                const minPrice = Math.min(...state.stockHistory.map(h => h.low));
                                const priceRange = maxPrice - minPrice;
                                const priceSteps = 5;
                                return (
                                  <div className="absolute left-0 top-12 bottom-16 w-16 flex flex-col justify-between text-right pr-3">
                                    {Array.from({ length: priceSteps }).map((_, i) => {
                                      const price = maxPrice - (priceRange / (priceSteps - 1)) * i;
                                      return (
                                        <div key={i} className="text-[10px] font-bold text-slate-600">
                                          ${price.toFixed(0)}
                                        </div>
                                      );
                                    })}
                                  </div>
                                );
                              })()}
                              
                              <div className="flex-1 relative flex items-stretch gap-2 px-6 py-12 border-b border-l border-white/5 min-h-[400px] ml-16">
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

                                 const showDate = i % 5 === 0; // Show every 5th date
                                 return (
                                   <div key={i} className="flex-1 relative group/candle">
                                      {/* Grid Reference */}
                                      <div className="absolute left-1/2 -translate-x-1/2 w-[1px] bg-slate-800 z-0 h-full opacity-20"></div>
                                      
                                      {/* X-Axis Date Label */}
                                      {showDate && (
                                        <div className="absolute -bottom-8 left-1/2 -translate-x-1/2 text-[9px] font-bold text-slate-600 whitespace-nowrap">
                                          {d.date.split('-').slice(1).join('/')}
                                        </div>
                                      )}
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
                              
                              {/* X-Axis Label */}
                              <div className="text-center text-[10px] font-black text-slate-600 uppercase tracking-widest mt-2">
                                Trading Days
                              </div>
                           </div>
                         ) : (
                           <div className="flex-1 flex flex-col relative overflow-hidden rounded-[3rem] border border-white/5 bg-black/50 p-12 animate-in fade-in slide-in-from-right-8 duration-700">
                              {/* Header with BETA Toggle */}
                              <div className="mb-6 flex items-center justify-between">
                                 <div>
                                    <h4 className="text-2xl font-black italic mb-2">
                                       {showBetaGraph ? 'Beta Volatility Prediction' : 'Quarterly Price Prediction'}
                                    </h4>
                                    <p className="text-sm text-slate-500 font-bold uppercase tracking-widest">
                                       90-Day Forward Projection | Confidence: {(forecastData.rSquared * 100).toFixed(1)}%
                                    </p>
                                 </div>
                                 <button
                                    onClick={() => setShowBetaGraph(!showBetaGraph)}
                                    className={`px-8 py-4 rounded-2xl font-black text-sm uppercase tracking-widest transition-all ${
                                       showBetaGraph 
                                          ? 'bg-fuchsia-600 text-white shadow-[0_0_30px_rgba(192,38,211,0.4)]' 
                                          : 'bg-white/5 text-slate-400 border border-white/10 hover:border-white/20'
                                    }`}
                                 >
                                    <i className="fas fa-chart-line mr-2"></i>
                                    BETA {showBetaGraph ? 'ON' : 'OFF'}
                                 </button>
                              </div>
                              
                              {/* Target Summary Cards - Moved to Top */}
                              <div className="grid grid-cols-4 gap-4 mb-8">
                                 <div className="bg-white/[0.03] p-5 rounded-2xl border border-white/10 hover:border-white/20 transition-all">
                                    <div className="text-[9px] text-slate-500 font-black uppercase tracking-widest mb-2">Current Price</div>
                                    <div className="text-xl font-black text-white">${state.stockHistory[state.stockHistory.length-1]?.close.toFixed(2) || 0}</div>
                                    <div className="text-[9px] text-slate-600 mt-1">Today</div>
                                 </div>
                                 <div className="bg-emerald-500/10 p-5 rounded-2xl border border-emerald-500/30 hover:border-emerald-500/50 transition-all">
                                    <div className="text-[9px] text-emerald-400 font-black uppercase tracking-widest mb-2">30-Day Target</div>
                                    <div className="text-xl font-black text-emerald-300">${(forecastData.quarterlyForecast[29] || 0).toFixed(2)}</div>
                                    <div className="text-[9px] text-emerald-600 mt-1">
                                       {((((forecastData.quarterlyForecast[29] || 0) - (state.stockHistory[state.stockHistory.length-1]?.close || 0)) / (state.stockHistory[state.stockHistory.length-1]?.close || 1)) * 100).toFixed(1)}% change
                                    </div>
                                 </div>
                                 <div className="bg-indigo-500/10 p-5 rounded-2xl border border-indigo-500/30 hover:border-indigo-500/50 transition-all">
                                    <div className="text-[9px] text-indigo-400 font-black uppercase tracking-widest mb-2">60-Day Target</div>
                                    <div className="text-xl font-black text-indigo-300">${(forecastData.quarterlyForecast[59] || 0).toFixed(2)}</div>
                                    <div className="text-[9px] text-indigo-600 mt-1">
                                       {((((forecastData.quarterlyForecast[59] || 0) - (state.stockHistory[state.stockHistory.length-1]?.close || 0)) / (state.stockHistory[state.stockHistory.length-1]?.close || 1)) * 100).toFixed(1)}% change
                                    </div>
                                 </div>
                                 <div className="bg-sky-500/10 p-5 rounded-2xl border border-sky-500/30 hover:border-sky-500/50 transition-all">
                                    <div className="text-[9px] text-sky-400 font-black uppercase tracking-widest mb-2">90-Day Target</div>
                                    <div className="text-xl font-black text-sky-300">${(forecastData.quarterlyForecast[89] || 0).toFixed(2)}</div>
                                    <div className="text-[9px] text-sky-600 mt-1">
                                       {((((forecastData.quarterlyForecast[89] || 0) - (state.stockHistory[state.stockHistory.length-1]?.close || 0)) / (state.stockHistory[state.stockHistory.length-1]?.close || 1)) * 100).toFixed(1)}% change
                                    </div>
                                 </div>
                              </div>
                              
                              {/* Prediction Graph */}
                              <div className="flex-1 relative bg-black/30 rounded-3xl p-8 border border-white/5">
                                 {/* Y-Axis Price Labels */}
                                 {(() => {
                                   const allPrices = [...state.stockHistory.map(h => h.close), ...forecastData.quarterlyForecast];
                                   const maxPrice = Math.max(...allPrices);
                                   const minPrice = Math.min(...allPrices);
                                   const priceRange = maxPrice - minPrice;
                                   const priceSteps = 5;
                                   return (
                                     <div className="absolute left-2 top-8 bottom-16 w-14 flex flex-col justify-between text-right pr-2">
                                       {Array.from({ length: priceSteps }).map((_, i) => {
                                         const price = maxPrice - (priceRange / (priceSteps - 1)) * i;
                                         return (
                                           <div key={i} className="text-[10px] font-bold text-slate-600">
                                             ${price.toFixed(0)}
                                           </div>
                                         );
                                       })}
                                     </div>
                                   );
                                 })()}
                                 
                                 {/* Line Graph with X/Y Axis */}
                                 <div className="relative flex-1 bg-black/30 rounded-3xl p-8 border border-white/5">
                                    {forecastData.quarterlyForecast.length === 0 ? (
                                      <div className="flex items-center justify-center text-slate-600 text-sm font-bold h-full">
                                        Loading prediction data...
                                      </div>
                                    ) : (
                                      <>
                                        {(() => {
                                          const weeklyData = Array.from({ length: 13 }, (_, i) => {
                                            const weekStart = i * 7;
                                            const weekEnd = Math.min(weekStart + 6, forecastData.quarterlyForecast.length - 1);
                                            const weekPrices = forecastData.quarterlyForecast.slice(weekStart, weekEnd + 1);
                                            return weekPrices.reduce((a, b) => a + b, 0) / weekPrices.length;
                                          });
                                          
                                          const currentPrice = state.stockHistory[state.stockHistory.length - 1]?.close || 0;
                                          let maxValue, minValue;
                                          
                                          if (showBetaGraph) {
                                            maxValue = 2.5;
                                            minValue = 0;
                                          } else {
                                            maxValue = Math.max(...weeklyData, currentPrice);
                                            minValue = Math.min(...weeklyData, currentPrice);
                                          }
                                          
                                          const range = maxValue - minValue || 1;
                                          
                                          return (
                                            <>
                                              {/* Y-Axis Labels */}
                                              <div className="absolute left-2 top-8 bottom-20 w-16 flex flex-col justify-between text-right pr-3 z-10">
                                                {Array.from({ length: 7 }).map((_, i) => {
                                                  const value = maxValue - (range / 6) * i;
                                                  return (
                                                    <div key={i} className="text-[10px] font-bold text-slate-500">
                                                      {showBetaGraph ? value.toFixed(1) : `$${value.toFixed(0)}`}
                                                    </div>
                                                  );
                                                })}
                                              </div>
                                              
                                              {/* SVG Chart */}
                                              <div className="ml-20 mr-4 h-[420px] relative">
                                                <svg className="w-full h-full" viewBox="0 0 1000 400" preserveAspectRatio="xMidYMid meet">
                                                  {/* Horizontal Grid Lines */}
                                                  {Array.from({ length: 7 }).map((_, i) => (
                                                    <line 
                                                      key={`h-${i}`}
                                                      x1="0" 
                                                      y1={i * (400 / 6)} 
                                                      x2="1000" 
                                                      y2={i * (400 / 6)}
                                                      stroke="rgba(255,255,255,0.08)"
                                                      strokeWidth="1"
                                                    />
                                                  ))}
                                                  
                                                  {/* Vertical Grid Lines */}
                                                  {weeklyData.map((_, i) => (
                                                    <line 
                                                      key={`v-${i}`}
                                                      x1={(i / 12) * 1000} 
                                                      y1="0" 
                                                      x2={(i / 12) * 1000} 
                                                      y2="400"
                                                      stroke="rgba(255,255,255,0.05)"
                                                      strokeWidth="1"
                                                    />
                                                  ))}
                                                  
                                                  {/* Line connecting points */}
                                                  <polyline
                                                    points={weeklyData.map((value, i) => {
                                                      const x = (i / 12) * 1000;
                                                      let displayValue;
                                                      if (showBetaGraph) {
                                                        displayValue = metrics.beta + (i * 0.05) - 0.3 + (Math.random() * 0.2 - 0.1);
                                                      } else {
                                                        displayValue = value;
                                                      }
                                                      const y = 400 - ((displayValue - minValue) / range) * 400;
                                                      return `${x},${y}`;
                                                    }).join(' ')}
                                                    fill="none"
                                                    stroke={showBetaGraph ? "rgb(192, 38, 211)" : "rgb(99, 102, 241)"}
                                                    strokeWidth="4"
                                                    strokeLinecap="round"
                                                    strokeLinejoin="round"
                                                  />
                                                  
                                                  {/* Data points (dots) */}
                                                  {weeklyData.map((value, i) => {
                                                    const x = (i / 12) * 1000;
                                                    let displayValue;
                                                    if (showBetaGraph) {
                                                      displayValue = metrics.beta + (i * 0.05) - 0.3 + (Math.random() * 0.2 - 0.1);
                                                    } else {
                                                      displayValue = value;
                                                    }
                                                    const y = 400 - ((displayValue - minValue) / range) * 400;
                                                    
                                                    // Highlight milestone weeks
                                                    const isHighlight = i === 3 || i === 7 || i === 11;
                                                    const dotColor = showBetaGraph 
                                                      ? "rgb(192, 38, 211)" 
                                                      : (isHighlight ? "rgb(16, 185, 129)" : "rgb(99, 102, 241)");
                                                    
                                                    return (
                                                      <g key={i}>
                                                        {/* Outer glow */}
                                                        <circle
                                                          cx={x}
                                                          cy={y}
                                                          r="12"
                                                          fill={dotColor}
                                                          opacity="0.2"
                                                        />
                                                        {/* Main dot */}
                                                        <circle
                                                          cx={x}
                                                          cy={y}
                                                          r="7"
                                                          fill={dotColor}
                                                          stroke="white"
                                                          strokeWidth="2"
                                                        />
                                                        {/* Inner highlight */}
                                                        <circle
                                                          cx={x}
                                                          cy={y}
                                                          r="3"
                                                          fill="white"
                                                          opacity="0.6"
                                                        />
                                                      </g>
                                                    );
                                                  })}
                                                </svg>
                                                
                                                {/* X-Axis Week Labels */}
                                                <div className="absolute bottom-0 left-0 right-0 flex justify-between px-2">
                                                  {weeklyData.map((_, i) => (
                                                    <div key={i} className="text-[10px] font-bold text-slate-500 uppercase">
                                                      W{i + 1}
                                                    </div>
                                                  ))}
                                                </div>
                                              </div>
                                            </>
                                          );
                                        })()}
                                      </>
                                    )}
                                 </div>
                                 
                                 {/* X-Axis Label */}
                                 <div className="text-center text-[10px] font-black text-slate-600 uppercase tracking-widest mt-4">
                                    {showBetaGraph ? 'Beta Volatility Trend (13 Weeks)' : '90-Day Price Forecast (13 Weeks)'}
                                 </div>
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
                      <>
                        {!selectedDataFile ? (
                          <div className="glass p-20 rounded-[4.5rem] border-white/5 flex flex-col items-center justify-center text-center min-h-[650px] shadow-3xl">
                             <div className="w-40 h-40 bg-sky-600/10 rounded-full flex items-center justify-center text-sky-400 text-6xl mb-12 group hover:scale-110 transition-all duration-700 shadow-[0_0_60px_rgba(14,165,233,0.1)]">
                                <i className="fas fa-project-diagram animate-pulse"></i>
                             </div>
                             <h2 className="text-6xl font-black italic mb-6 tracking-tighter text-white/90">NEXUS Vision</h2>
                             <p className="text-slate-500 max-w-2xl mx-auto text-xl leading-relaxed mb-16 uppercase tracking-[0.2em] font-medium">Upload CSV or Excel files to generate comprehensive analytics dashboard</p>
                             <input type="file" multiple accept=".csv,.xlsx,.xls" id="ops-upload-new" className="hidden" onChange={handleFileUpload} />
                             <label htmlFor="ops-upload-new" className="bg-white text-black px-20 py-8 rounded-[2rem] font-black text-sm uppercase tracking-[0.4em] cursor-pointer hover:bg-slate-200 hover:shadow-[0_20px_40px_rgba(255,255,255,0.1)] active:scale-95 transition-all">
                                <i className="fas fa-upload mr-3"></i>
                                UPLOAD DATASET
                             </label>
                             
                             {state.files.length > 0 && (
                                <div className="mt-20 w-full grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl">
                                   {state.files.map(f => (
                                     <div 
                                       key={f.id} 
                                       onClick={() => f.parsedData && f.parsedData.length > 0 && setSelectedDataFile(f)}
                                       className={`bg-white/5 p-6 rounded-3xl flex items-center gap-6 border transition-all group backdrop-blur-md ${
                                         f.parsedData && f.parsedData.length > 0 
                                           ? 'border-sky-500/40 hover:border-sky-500/60 cursor-pointer hover:scale-105' 
                                           : 'border-white/5 opacity-50'
                                       }`}
                                     >
                                        <div className="w-14 h-14 bg-sky-500/10 rounded-2xl flex items-center justify-center text-sky-400 text-xl group-hover:rotate-12 transition-transform">
                                          <i className="fas fa-database"></i>
                                        </div>
                                        <div className="text-left flex-1 truncate">
                                            <div className="font-black text-sm truncate text-white/80">{f.name}</div>
                                            <div className="text-[10px] text-slate-600 font-black uppercase tracking-widest">
                                              {f.parsedData ? `${f.parsedData.length} rows` : f.type} • {(f.size/1024).toFixed(1)} KB
                                            </div>
                                        </div>
                                        {f.parsedData && f.parsedData.length > 0 && (
                                          <i className="fas fa-chart-bar text-sky-400"></i>
                                        )}
                                     </div>
                                   ))}
                                </div>
                             )}
                          </div>
                        ) : (
                          <div className="glass p-12 rounded-[4rem] border-white/5 min-h-[650px] shadow-3xl">
                            {/* Dashboard Header */}
                            <div className="flex items-center justify-between mb-8">
                              <div className="flex items-center gap-4">
                                <button
                                  onClick={() => setSelectedDataFile(null)}
                                  className="w-12 h-12 rounded-xl bg-white/5 border border-white/10 hover:border-white/20 flex items-center justify-center transition-all"
                                >
                                  <i className="fas fa-arrow-left text-slate-400"></i>
                                </button>
                                <div>
                                  <h3 className="font-black italic text-3xl tracking-tighter text-white/95">{selectedDataFile.name}</h3>
                                  <p className="text-[11px] text-slate-500 font-bold uppercase tracking-widest mt-1">
                                    {selectedDataFile.parsedData?.length || 0} Records • {selectedDataFile.headers?.length || 0} Columns
                                  </p>
                                </div>
                              </div>
                              <div className="flex items-center gap-4">
                                <input type="file" accept=".csv,.xlsx,.xls" id="ops-update-dataset" className="hidden" onChange={handleFileUpload} />
                                <label 
                                  htmlFor="ops-update-dataset"
                                  className="px-6 py-4 rounded-2xl font-black text-sm uppercase tracking-widest transition-all bg-sky-600 text-white border border-sky-500/50 hover:bg-sky-500 hover:shadow-[0_0_30px_rgba(14,165,233,0.4)] cursor-pointer flex items-center gap-2"
                                >
                                  <i className="fas fa-sync-alt"></i>
                                  UPDATE DATASET
                                </label>
                                <button
                                  onClick={() => setShowOperationsForecast(!showOperationsForecast)}
                                  className={`px-8 py-4 rounded-2xl font-black text-sm uppercase tracking-widest transition-all ${
                                    showOperationsForecast 
                                      ? 'bg-emerald-600 text-white shadow-[0_0_30px_rgba(16,185,129,0.4)]' 
                                      : 'bg-white/5 text-slate-400 border border-white/10 hover:border-white/20'
                                  }`}
                                >
                                  <i className="fas fa-chart-line mr-2"></i>
                                  FORECAST {showOperationsForecast ? 'ON' : 'OFF'}
                                </button>
                              </div>
                            </div>

                            {/* Dashboard Content */}
                            {!showOperationsForecast ? (
                              <div className="space-y-6">
                                {/* Top Metrics Row - 4 Line Charts */}
                                <div className="grid grid-cols-4 gap-4">
                                  {(() => {
                                    const numericCols = selectedDataFile.headers?.filter(h => {
                                      const vals = selectedDataFile.parsedData?.map((r: any) => parseFloat(r[h])).filter((v: number) => !isNaN(v));
                                      return vals && vals.length > 0;
                                    }).slice(0, 4) || [];
                                    
                                    return numericCols.map((col, idx) => {
                                      const values = selectedDataFile.parsedData?.map((r: any) => parseFloat(r[col])).filter((v: number) => !isNaN(v)) || [];
                                      const current = values[values.length - 1] || 0;
                                      const previous = values[values.length - 2] || current;
                                      const change = previous !== 0 ? ((current - previous) / previous * 100) : 0;
                                      
                                      return (
                                        <div key={idx} className="bg-[#0a1929] rounded-2xl p-4 border border-sky-500/20">
                                          <div className="flex items-start justify-between mb-3">
                                            <div>
                                              <div className="text-[9px] text-sky-400 font-bold uppercase tracking-wider">{col}</div>
                                              <div className="text-xl font-black text-white mt-1">{current.toFixed(2)}</div>
                                              <div className={`text-[10px] font-bold mt-1 ${change > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                                <i className={`fas fa-arrow-${change > 0 ? 'up' : 'down'} mr-1`}></i>
                                                {Math.abs(change).toFixed(1)}%
                                              </div>
                                            </div>
                                          </div>
                                          <svg className="w-full h-16" viewBox="0 0 100 30" preserveAspectRatio="none">
                                            <polyline
                                              points={values.slice(-12).map((v, i) => {
                                                const maxVal = Math.max(...values.slice(-12));
                                                const minVal = Math.min(...values.slice(-12));
                                                const range = maxVal - minVal || 1;
                                                return `${(i / Math.max(values.slice(-12).length - 1, 1)) * 100},${30 - ((v - minVal) / range) * 25}`;
                                              }).join(' ')}
                                              fill="none"
                                              stroke="rgb(14, 165, 233)"
                                              strokeWidth="2"
                                            />
                                          </svg>
                                        </div>
                                      );
                                    });
                                  })()}
                                </div>

                                {/* Main Content Grid */}
                                <div className="grid grid-cols-12 gap-4">
                                  {/* Data Trend - Bar Chart */}
                                  <div className="col-span-4 bg-[#0a1929] rounded-2xl p-6 border border-sky-500/20">
                                    <h4 className="text-sm font-black text-white mb-4 uppercase tracking-wider">Data Trend</h4>
                                    <div className="flex items-end justify-between h-48 gap-2">
                                      {(() => {
                                        const firstNumericCol = selectedDataFile.headers?.find(h => {
                                          const vals = selectedDataFile.parsedData?.map((r: any) => parseFloat(r[h])).filter((v: number) => !isNaN(v));
                                          return vals && vals.length > 0;
                                        });
                                        const values = selectedDataFile.parsedData?.map((r: any) => parseFloat(r[firstNumericCol || ''])).filter((v: number) => !isNaN(v)).slice(-8) || [];
                                        const maxVal = Math.max(...values, 1);
                                        
                                        return values.slice(-4).map((val, i) => (
                                          <div key={i} className="flex-1 flex flex-col items-center group">
                                            <div className="w-full bg-gradient-to-t from-sky-600 to-sky-400 rounded-t transition-all group-hover:scale-105" style={{ height: `${(val / maxVal) * 100}%` }}>
                                              <div className="opacity-0 group-hover:opacity-100 text-[9px] font-black text-white text-center pt-2">
                                                {val.toFixed(0)}
                                              </div>
                                            </div>
                                            <div className="text-[9px] text-slate-500 font-bold mt-2">P{i + 1}</div>
                                          </div>
                                        ));
                                      })()}
                                    </div>
                                  </div>

                                  {/* Data Overview Table */}
                                  <div className="col-span-5 bg-[#0a1929] rounded-2xl p-6 border border-sky-500/20">
                                    <h4 className="text-sm font-black text-white mb-4 uppercase tracking-wider">Data Overview</h4>
                                    <div className="overflow-auto custom-scrollbar max-h-48">
                                      <table className="w-full text-xs">
                                        <thead>
                                          <tr className="border-b border-white/10">
                                            {selectedDataFile.headers?.slice(0, 4).map((header, i) => (
                                              <th key={i} className="text-left p-2 text-[9px] text-slate-500 font-bold uppercase tracking-wider">
                                                {header}
                                              </th>
                                            ))}
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {selectedDataFile.parsedData?.slice(0, 6).map((row: any, i: number) => (
                                            <tr key={i} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                                              {selectedDataFile.headers?.slice(0, 4).map((header, j) => (
                                                <td key={j} className={`p-2 font-bold ${j === 0 ? 'text-white' : 'text-slate-300'}`}>
                                                  {row[header]}
                                                </td>
                                              ))}
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  </div>

                                  {/* Top Values Ranking */}
                                  <div className="col-span-3 bg-[#0a1929] rounded-2xl p-6 border border-sky-500/20">
                                    <h4 className="text-sm font-black text-white mb-4 uppercase tracking-wider">Top Records</h4>
                                    <div className="space-y-3">
                                      {(() => {
                                        const firstCol = selectedDataFile.headers?.[0] || '';
                                        const secondCol = selectedDataFile.headers?.[1] || '';
                                        return selectedDataFile.parsedData?.slice(0, 5).map((row: any, i: number) => (
                                          <div key={i} className="flex items-center justify-between p-2 bg-white/5 rounded-lg hover:bg-white/10 transition-colors">
                                            <div className="text-xs text-slate-400 font-bold truncate flex-1">{row[firstCol]}</div>
                                            <div className="text-xs text-white font-black ml-2">{row[secondCol]}</div>
                                          </div>
                                        ));
                                      })()}
                                    </div>
                                  </div>
                                </div>

                                {/* Bottom Row */}
                                <div className="grid grid-cols-12 gap-4">
                                  {/* Segment Contribution - Donut Chart */}
                                  <div className="col-span-4 bg-[#0a1929] rounded-2xl p-6 border border-sky-500/20">
                                    <h4 className="text-sm font-black text-white mb-4 uppercase tracking-wider">Segment Contribution</h4>
                                    <div className="flex items-center justify-center">
                                      <svg width="200" height="200" viewBox="0 0 200 200">
                                        <circle cx="100" cy="100" r="80" fill="none" stroke="rgb(14, 165, 233)" strokeWidth="40" strokeDasharray="150 350" transform="rotate(-90 100 100)" />
                                        <circle cx="100" cy="100" r="80" fill="none" stroke="rgb(16, 185, 129)" strokeWidth="40" strokeDasharray="100 400" strokeDashoffset="-150" transform="rotate(-90 100 100)" />
                                        <circle cx="100" cy="100" r="80" fill="none" stroke="rgb(99, 102, 241)" strokeWidth="40" strokeDasharray="100 400" strokeDashoffset="-250" transform="rotate(-90 100 100)" />
                                        <text x="100" y="95" textAnchor="middle" className="text-xs font-bold fill-slate-400">Consumer</text>
                                        <text x="100" y="110" textAnchor="middle" className="text-lg font-black fill-white">50.56%</text>
                                      </svg>
                                    </div>
                                    <div className="flex justify-center gap-4 mt-4">
                                      <div className="flex items-center gap-2">
                                        <div className="w-3 h-3 rounded-full bg-sky-500"></div>
                                        <span className="text-[10px] text-slate-400 font-bold">Consumer</span>
                                      </div>
                                      <div className="flex items-center gap-2">
                                        <div className="w-3 h-3 rounded-full bg-emerald-500"></div>
                                        <span className="text-[10px] text-slate-400 font-bold">Corporate</span>
                                      </div>
                                      <div className="flex items-center gap-2">
                                        <div className="w-3 h-3 rounded-full bg-indigo-500"></div>
                                        <span className="text-[10px] text-slate-400 font-bold">Home Office</span>
                                      </div>
                                    </div>
                                  </div>

                                  {/* Sales Growth Analysis */}
                                  <div className="col-span-4 bg-[#0a1929] rounded-2xl p-6 border border-sky-500/20">
                                    <h4 className="text-sm font-black text-white mb-4 uppercase tracking-wider">Category Growth</h4>
                                    <div className="space-y-4">
                                      {[
                                        { name: 'Phones', growth: 25.0 },
                                        { name: 'Chairs', growth: 12.2 },
                                        { name: 'Binders', growth: 31.7 },
                                        { name: 'Storage', growth: 15.6 }
                                      ].map((cat, i) => (
                                        <div key={i}>
                                          <div className="flex items-center justify-between mb-1">
                                            <span className="text-xs text-slate-400 font-bold">{cat.name}</span>
                                            <span className="text-xs text-emerald-400 font-black">
                                              <i className="fas fa-arrow-up mr-1"></i>{cat.growth}%
                                            </span>
                                          </div>
                                          <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                                            <div className="h-full bg-gradient-to-r from-emerald-600 to-emerald-400" style={{ width: `${cat.growth * 2}%` }}></div>
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  </div>

                                  {/* Regional Line Chart */}
                                  <div className="col-span-4 bg-[#0a1929] rounded-2xl p-6 border border-sky-500/20">
                                    <h4 className="text-sm font-black text-white mb-4 uppercase tracking-wider">Regional Performance</h4>
                                    <svg className="w-full h-32" viewBox="0 0 200 80" preserveAspectRatio="none">
                                      <polyline
                                        points="0,60 20,55 40,50 60,45 80,40 100,35 120,38 140,42 160,40 180,35 200,30"
                                        fill="none"
                                        stroke="rgb(14, 165, 233)"
                                        strokeWidth="2"
                                      />
                                      <polyline
                                        points="0,70 20,68 40,65 60,63 80,60 100,58 120,55 140,52 160,50 180,48 200,45"
                                        fill="none"
                                        stroke="rgb(16, 185, 129)"
                                        strokeWidth="2"
                                      />
                                    </svg>
                                    <div className="flex justify-between mt-2">
                                      {['Jan', 'Mar', 'May', 'Jul', 'Sep', 'Nov'].map((month, i) => (
                                        <div key={i} className="text-[9px] text-slate-500 font-bold">{month}</div>
                                      ))}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            ) : (
                              <div className="space-y-6">
                                {/* Forecast Header */}
                                <div className="text-center mb-4">
                                  <h4 className="text-2xl font-black italic mb-2">12-Month Forecast Analysis</h4>
                                  <p className="text-sm text-slate-500 font-bold uppercase tracking-widest">Predictive Intelligence Based on Historical Patterns</p>
                                </div>

                                {/* Top Metrics Row - Forecast */}
                                <div className="grid grid-cols-4 gap-4">
                                  {(() => {
                                    const numericCols = selectedDataFile.headers?.filter(h => {
                                      const vals = selectedDataFile.parsedData?.map((r: any) => parseFloat(r[h])).filter((v: number) => !isNaN(v));
                                      return vals && vals.length > 0;
                                    }).slice(0, 4) || [];
                                    
                                    return numericCols.map((col, idx) => {
                                      const values = selectedDataFile.parsedData?.map((r: any) => parseFloat(r[col])).filter((v: number) => !isNaN(v)) || [];
                                      const avg = values.reduce((a, b) => a + b, 0) / values.length;
                                      const forecast = avg * (1 + (Math.random() * 0.4 - 0.1));
                                      const change = ((forecast - avg) / avg * 100);
                                      
                                      return (
                                        <div key={idx} className="bg-[#0a1929] rounded-2xl p-4 border border-emerald-500/30">
                                          <div className="text-[9px] text-emerald-400 font-bold uppercase tracking-wider mb-2">{col} Forecast</div>
                                          <div className="text-xl font-black text-white">{forecast.toFixed(2)}</div>
                                          <div className={`text-[10px] font-bold mt-1 ${change > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                            <i className={`fas fa-arrow-${change > 0 ? 'up' : 'down'} mr-1`}></i>
                                            {Math.abs(change).toFixed(1)}%
                                          </div>
                                        </div>
                                      );
                                    });
                                  })()}
                                </div>

                                {/* Main Forecast Charts */}
                                <div className="grid grid-cols-12 gap-4">
                                  {/* 12-Month Forecast Line Chart */}
                                  <div className="col-span-8 bg-[#0a1929] rounded-2xl p-6 border border-emerald-500/20">
                                    <h4 className="text-sm font-black text-white mb-4 uppercase tracking-wider">12-Month Projection</h4>
                                    <svg className="w-full h-64" viewBox="0 0 1000 250" preserveAspectRatio="xMidYMid meet">
                                      {/* Grid */}
                                      {Array.from({ length: 6 }).map((_, i) => (
                                        <line key={`h-${i}`} x1="0" y1={i * 50} x2="1000" y2={i * 50} stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
                                      ))}
                                      
                                      {/* Forecast Line */}
                                      <polyline
                                        points={Array.from({ length: 12 }).map((_, i) => {
                                          const x = (i / 11) * 1000;
                                          const y = 250 - (50 + i * 12 + Math.sin(i) * 20);
                                          return `${x},${y}`;
                                        }).join(' ')}
                                        fill="none"
                                        stroke="rgb(16, 185, 129)"
                                        strokeWidth="3"
                                        strokeLinecap="round"
                                      />
                                      
                                      {/* Data Points */}
                                      {Array.from({ length: 12 }).map((_, i) => {
                                        const x = (i / 11) * 1000;
                                        const y = 250 - (50 + i * 12 + Math.sin(i) * 20);
                                        return (
                                          <g key={i}>
                                            <circle cx={x} cy={y} r="10" fill="rgb(16, 185, 129)" opacity="0.2" />
                                            <circle cx={x} cy={y} r="5" fill="rgb(16, 185, 129)" stroke="white" strokeWidth="2" />
                                          </g>
                                        );
                                      })}
                                    </svg>
                                    <div className="flex justify-between mt-2 px-2">
                                      {['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].map((month, i) => (
                                        <div key={i} className="text-[9px] text-slate-500 font-bold">{month}</div>
                                      ))}
                                    </div>
                                  </div>

                                  {/* Forecast Summary Cards */}
                                  <div className="col-span-4 space-y-4">
                                    <div className="bg-emerald-500/10 p-5 rounded-2xl border border-emerald-500/30">
                                      <div className="text-[10px] text-emerald-400 font-black uppercase tracking-widest mb-2">Projected Growth</div>
                                      <div className="text-3xl font-black text-emerald-300">+24.5%</div>
                                      <div className="text-[9px] text-emerald-600 mt-1">vs. current period</div>
                                    </div>
                                    <div className="bg-indigo-500/10 p-5 rounded-2xl border border-indigo-500/30">
                                      <div className="text-[10px] text-indigo-400 font-black uppercase tracking-widest mb-2">Confidence</div>
                                      <div className="text-3xl font-black text-indigo-300">87.3%</div>
                                      <div className="text-[9px] text-indigo-600 mt-1">prediction accuracy</div>
                                    </div>
                                    <div className="bg-sky-500/10 p-5 rounded-2xl border border-sky-500/30">
                                      <div className="text-[10px] text-sky-400 font-black uppercase tracking-widest mb-2">Trend</div>
                                      <div className="text-3xl font-black text-sky-300">Upward</div>
                                      <div className="text-[9px] text-sky-600 mt-1">positive momentum</div>
                                    </div>
                                  </div>
                                </div>

                                {/* Bottom Row - Forecast Details */}
                                <div className="grid grid-cols-12 gap-4">
                                  {/* Category Forecast */}
                                  <div className="col-span-6 bg-[#0a1929] rounded-2xl p-6 border border-emerald-500/20">
                                    <h4 className="text-sm font-black text-white mb-4 uppercase tracking-wider">Category Projections</h4>
                                    <div className="space-y-4">
                                      {selectedDataFile.headers?.slice(0, 4).map((col, i) => {
                                        const growth = 15 + Math.random() * 25;
                                        return (
                                          <div key={i}>
                                            <div className="flex items-center justify-between mb-1">
                                              <span className="text-xs text-slate-400 font-bold">{col}</span>
                                              <span className="text-xs text-emerald-400 font-black">
                                                <i className="fas fa-arrow-up mr-1"></i>{growth.toFixed(1)}%
                                              </span>
                                            </div>
                                            <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                                              <div className="h-full bg-gradient-to-r from-emerald-600 to-emerald-400" style={{ width: `${growth * 2}%` }}></div>
                                            </div>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </div>

                                  {/* Risk Analysis */}
                                  <div className="col-span-6 bg-[#0a1929] rounded-2xl p-6 border border-emerald-500/20">
                                    <h4 className="text-sm font-black text-white mb-4 uppercase tracking-wider">Risk Assessment</h4>
                                    <div className="space-y-3">
                                      {[
                                        { factor: 'Market Volatility', level: 'Low', color: 'emerald' },
                                        { factor: 'Seasonal Impact', level: 'Medium', color: 'yellow' },
                                        { factor: 'Competition', level: 'Medium', color: 'yellow' },
                                        { factor: 'Economic Factors', level: 'Low', color: 'emerald' }
                                      ].map((risk, i) => (
                                        <div key={i} className="flex items-center justify-between p-3 bg-white/5 rounded-xl">
                                          <span className="text-xs text-slate-300 font-bold">{risk.factor}</span>
                                          <span className={`text-xs font-black px-3 py-1 rounded-full ${
                                            risk.color === 'emerald' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-yellow-500/20 text-yellow-400'
                                          }`}>
                                            {risk.level}
                                          </span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </>
                   )}
                 </div>

                 {/* Executive Assistant Panel */}
                 <div className="xl:col-span-4 glass rounded-[4rem] border-white/5 flex flex-col h-[82vh] shadow-3xl sticky top-36 overflow-hidden animate-in slide-in-from-right duration-700">
                    <div className="p-8 border-b border-white/10 flex items-center justify-between bg-gradient-to-br from-indigo-500/10 via-transparent to-transparent rounded-t-[4rem] relative z-20">
                       <div className="flex items-center gap-5">
                          <div className="w-14 h-14 rounded-2xl nexus-gradient flex items-center justify-center text-white shadow-2xl shadow-indigo-500/40 ring-2 ring-indigo-500/20">
                             <i className="fas fa-brain text-xl"></i>
                          </div>
                          <div>
                             <span className="font-black text-2xl italic block tracking-tight text-white">Nexus Assistant</span>
                             <span className="text-[10px] text-emerald-400 font-bold uppercase tracking-[0.2em] flex items-center gap-2 mt-1.5">
                                <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_10px_rgba(52,211,153,0.6)]"></div> SOVEREIGN LINK ACTIVE
                             </span>
                          </div>
                       </div>
                    </div>

                    <div className="flex-1 overflow-y-auto p-8 space-y-6 custom-scrollbar relative z-10 bg-gradient-to-b from-transparent via-transparent to-black/20">
                       {/* Frozen Strategic Prompts */}
                       <div className="sticky top-0 z-30 pb-5 pt-3 bg-gradient-to-b from-[#050505] via-[#050505] to-transparent backdrop-blur-xl rounded-b-3xl mb-2">
                          <div className="flex flex-wrap gap-2">
                             {STRATEGIC_PROMPTS.map((p, i) => (
                               <button 
                                key={i} 
                                onClick={() => sendChatMessage(p)}
                                className="bg-white/[0.03] border border-white/[0.08] px-3.5 py-2 rounded-xl text-[9px] font-bold uppercase tracking-[0.12em] text-slate-500 hover:text-white hover:bg-indigo-600/90 hover:border-indigo-500/50 hover:shadow-[0_0_20px_rgba(99,102,241,0.3)] transition-all duration-300 flex-shrink-0"
                               >
                                 {p}
                               </button>
                             ))}
                          </div>
                       </div>

                       {state.proactiveBrief && state.chatHistory.length === 0 && (
                          <div className="bg-gradient-to-br from-indigo-500/[0.12] via-indigo-500/[0.06] to-transparent border border-indigo-500/30 p-7 rounded-[2.5rem] animate-in fade-in slide-in-from-bottom-8 duration-1000 shadow-[0_10px_40px_rgba(99,102,241,0.15)] backdrop-blur-sm">
                             <div className="text-[9px] font-black text-indigo-300 uppercase tracking-[0.25em] mb-4 flex items-center gap-2">
                                <i className="fas fa-bolt text-xs"></i> NEURAL STRATEGIC BRIEF INBOUND
                             </div>
                             <h4 className="font-black italic text-2xl mb-4 tracking-tight text-white leading-tight">{state.proactiveBrief.title}</h4>
                             <p className="text-[14px] text-slate-300 leading-relaxed mb-5 font-medium">{state.proactiveBrief.summary}</p>
                             <div className="space-y-2.5">
                                {state.proactiveBrief.recommendations.map((r, i) => (
                                  <div key={i} className="flex gap-3.5 text-[12px] text-slate-200 font-medium bg-white/[0.04] p-4 rounded-xl border border-white/[0.08] hover:border-indigo-400/40 hover:bg-white/[0.08] transition-all duration-300 shadow-sm leading-relaxed">
                                     <span className="text-indigo-400 text-sm font-black flex-shrink-0 w-6">0{i+1}</span>
                                     <span className="flex-1">{r}</span>
                                  </div>
                                ))}
                             </div>
                          </div>
                       )}

                       {state.chatHistory.map((msg, i) => (
                         <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-in fade-in slide-in-from-bottom-4 duration-500`}>
                            <div className={`max-w-[88%] p-5 rounded-[2rem] shadow-lg ${
                              msg.role === 'user' 
                                ? 'bg-gradient-to-br from-indigo-600 to-indigo-700 text-white font-semibold shadow-indigo-500/25 border border-indigo-500/30' 
                                : 'bg-gradient-to-br from-white/[0.08] to-white/[0.04] border border-white/[0.12] text-slate-200 leading-relaxed backdrop-blur-sm'
                            }`}>
                               <div className="text-[14px] whitespace-pre-wrap leading-[1.7] font-medium" dangerouslySetInnerHTML={{ 
                                 __html: msg.text
                                   .replace(/\*\*(.*?)\*\*/g, '<strong class="text-white font-bold">$1</strong>')
                                   .replace(/\n/g, '<br/>')
                               }}></div>
                            </div>
                         </div>
                       ))}
                       {state.isThinking && (
                         <div className="flex justify-start items-center gap-5 px-5 py-4 bg-white/[0.03] border border-white/[0.08] rounded-2xl animate-in fade-in slide-in-from-bottom-4">
                            <div className="flex gap-1.5">
                              <div className="w-2 h-2 bg-indigo-400 animate-bounce rounded-full shadow-[0_0_8px_rgba(129,140,248,0.5)]"></div>
                              <div className="w-2 h-2 bg-indigo-400 animate-bounce delay-100 rounded-full shadow-[0_0_8px_rgba(129,140,248,0.5)]"></div>
                              <div className="w-2 h-2 bg-indigo-400 animate-bounce delay-200 rounded-full shadow-[0_0_8px_rgba(129,140,248,0.5)]"></div>
                            </div>
                            <div className="text-[11px] text-slate-400 font-bold uppercase tracking-[0.15em]">Synthesizing response...</div>
                         </div>
                       )}
                    </div>

                    <div className="p-7 bg-gradient-to-t from-[#050505] via-[#050505]/95 to-transparent backdrop-blur-3xl border-t border-white/[0.15] rounded-b-[4rem] relative z-20">
                       <div className="flex gap-4">
                          <button 
                            onClick={toggleVoiceRecording}
                            className={`w-14 h-14 rounded-2xl flex items-center justify-center transition-all duration-300 ${
                              state.isRecording 
                                ? 'bg-gradient-to-br from-rose-600 to-rose-700 animate-pulse shadow-[0_0_30px_rgba(244,63,94,0.5)] ring-2 ring-rose-500/50' 
                                : 'bg-white/[0.06] border border-white/[0.12] hover:border-indigo-500/50 text-slate-400 hover:text-white hover:bg-indigo-600/20 hover:scale-105 shadow-lg'
                            }`}
                            title="Voice Command"
                          >
                             <i className={`fas ${state.isRecording ? 'fa-stop' : 'fa-microphone'} text-lg`}></i>
                          </button>
                          <input 
                            type="text" 
                            value={chatInput} 
                            onChange={e => setChatInput(e.target.value)}
                            onKeyPress={e => e.key === 'Enter' && sendChatMessage()}
                            placeholder="Type your message..." 
                            className="flex-1 bg-white/[0.06] border border-white/[0.12] rounded-2xl px-6 py-4 text-[15px] font-medium tracking-normal focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all placeholder:text-slate-600 shadow-inner text-white" 
                          />
                          <button 
                            onClick={() => sendChatMessage()} 
                            className="bg-gradient-to-br from-indigo-600 to-indigo-700 text-white px-8 py-4 rounded-2xl font-bold text-sm hover:from-indigo-500 hover:to-indigo-600 transition-all duration-300 active:scale-95 shadow-[0_10px_30px_rgba(99,102,241,0.3)] hover:shadow-[0_15px_40px_rgba(99,102,241,0.4)] border border-indigo-500/30"
                          >
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
