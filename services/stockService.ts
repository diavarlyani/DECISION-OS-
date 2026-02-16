
import { StockDataPoint } from '../types';
import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export const fetchStockHistory = async (symbol: string): Promise<StockDataPoint[]> => {
  try {
    // Try to fetch from backend (which uses Yahoo Finance)
    const response = await axios.get(`${API_URL}/api/stock/${symbol}`, {
      timeout: 10000,
    });
    
    if (response.data && response.data.data && response.data.data.length > 0) {
      return response.data.data.map((d: any) => ({
        date: d.date,
        open: parseFloat(d.open.toFixed(2)),
        high: parseFloat(d.high.toFixed(2)),
        low: parseFloat(d.low.toFixed(2)),
        close: parseFloat(d.close.toFixed(2)),
        volume: d.volume
      }));
    } else {
      // No data returned - stock doesn't exist
      throw new Error('STOCK_NOT_FOUND');
    }
  } catch (error: any) {
    // Check if it's a 404 or stock not found error
    if (error.response?.status === 404 || error.message === 'STOCK_NOT_FOUND') {
      throw new Error('STOCK_NOT_FOUND');
    }
    console.warn('Failed to fetch real stock data:', error);
    throw error;
  }
};

const fetchSimulatedData = (symbol: string): StockDataPoint[] => {
  const points: StockDataPoint[] = [];
  let basePrice = symbol === 'TSLA' ? 240 : symbol === 'AAPL' ? 190 : 150;
  const now = new Date();

  for (let i = 60; i >= 0; i--) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    
    const change = (Math.random() - 0.48) * (basePrice * 0.03);
    const open = basePrice;
    const close = basePrice + change;
    const high = Math.max(open, close) + Math.random() * 2;
    const low = Math.min(open, close) - Math.random() * 2;
    const volume = Math.floor(Math.random() * 1000000) + 500000;

    points.push({
      date: date.toISOString().split('T')[0],
      open: parseFloat(open.toFixed(2)),
      high: parseFloat(high.toFixed(2)),
      low: parseFloat(low.toFixed(2)),
      close: parseFloat(close.toFixed(2)),
      volume
    });

    basePrice = close;
  }
  return points;
};

export const getMarketBenchmark = (length: number): number[] => {
  // Simulated S&P 500 returns (could be enhanced with real data)
  return Array.from({ length }, () => (Math.random() - 0.49) * 0.015);
};
