import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3004;

// Middleware
app.use(cors());
app.use(express.json());

// In-memory storage (replace with real database later)
const storage = {
  users: new Map(),
  sessions: new Map(),
  chatHistory: new Map(),
  files: new Map(),
};

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'online', timestamp: Date.now() });
});

// Get stock data from Yahoo Finance
app.get('/api/stock/:symbol', async (req, res) => {
  const { symbol } = req.params;
  
  try {
    const response = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=3mo&interval=1d`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0',
        },
      }
    );
    
    if (!response.ok) {
      return res.status(404).json({ error: 'Stock not found', message: `Ticker symbol "${symbol}" does not exist` });
    }
    
    const data = await response.json();
    
    // Check if Yahoo Finance returned an error
    if (data.chart.error) {
      return res.status(404).json({ error: 'Stock not found', message: `Ticker symbol "${symbol}" does not exist` });
    }
    
    const result = data.chart.result[0];
    
    if (!result || !result.timestamp || result.timestamp.length === 0) {
      return res.status(404).json({ error: 'Stock not found', message: `Ticker symbol "${symbol}" does not exist` });
    }
    
    const timestamps = result.timestamp;
    const quotes = result.indicators.quote[0];
    
    const stockData = timestamps.map((timestamp, i) => ({
      date: new Date(timestamp * 1000).toISOString().split('T')[0],
      open: quotes.open[i] || 0,
      high: quotes.high[i] || 0,
      low: quotes.low[i] || 0,
      close: quotes.close[i] || 0,
      volume: quotes.volume[i] || 0,
    })).filter(d => d.close > 0);
    
    if (stockData.length === 0) {
      return res.status(404).json({ error: 'Stock not found', message: `No data available for ticker symbol "${symbol}"` });
    }
    
    res.json({ symbol, data: stockData });
  } catch (error) {
    console.error('Stock fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch stock data', message: error.message });
  }
});

// Save chat history
app.post('/api/chat/save', (req, res) => {
  const { sessionId, messages } = req.body;
  storage.chatHistory.set(sessionId, messages);
  res.json({ success: true });
});

// Get chat history
app.get('/api/chat/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const messages = storage.chatHistory.get(sessionId) || [];
  res.json({ messages });
});

// Save files
app.post('/api/files/save', (req, res) => {
  const { sessionId, files } = req.body;
  storage.files.set(sessionId, files);
  res.json({ success: true });
});

// Get files
app.get('/api/files/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const files = storage.files.get(sessionId) || [];
  res.json({ files });
});
//AAPL
app.listen(PORT, () => {
  console.log(`🚀 NEXUS OS Backend running on http://localhost:${PORT}`);
  console.log(`📊 Stock API: http://localhost:${PORT}/api/stock/AAPL`);
});
