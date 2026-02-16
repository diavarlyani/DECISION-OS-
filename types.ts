
export enum Department {
  FINANCE = 'Finance',
  OPERATIONS = 'Operations',
  MARKETING = 'Marketing'
}

export interface DataFile {
  id: string;
  name: string;
  type: 'structured' | 'unstructured';
  format: string;
  content: any;
  parsedData?: any[];
  headers?: string[];
  size: number;
  timestamp: number;
  isPrimary?: boolean;
}

export interface MetricSummary {
  growth: number;
  volatility: number;
  sharpe: number;
  beta: number;
  covariance: number;
  cagr: number;
  confidence: number;
}

export interface StrategicBrief {
  title: string;
  summary: string;
  recommendations: string[];
  riskLevel: 'Low' | 'Medium' | 'High';
  timestamp: number;
}

export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
  reasoningSteps?: string[];
  timestamp: number;
  isProactive?: boolean;
}

export interface StockDataPoint {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface AppState {
  view: 'landing' | 'workspace';
  selectedDept: Department;
  files: DataFile[];
  stockSymbol: string;
  stockHistory: StockDataPoint[];
  chatHistory: ChatMessage[];
  isThinking: boolean;
  isRecording: boolean;
  activeTab: 'dashboard' | 'brief' | 'agents';
  subTab: 'live' | 'predictive';
  isPlayingAudio: boolean;
  proactiveBrief: StrategicBrief | null;
  isLoadingStock: boolean;
  error: string | null;
}
