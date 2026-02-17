
import { StockDataPoint } from '../types';

export const fetchStockHistory = async (symbol: string): Promise<StockDataPoint[]> => {
  // Simulating a Yahoo Finance fetch with realistic drift and volatility
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
  // Simulated S&P 500 returns
  return Array.from({ length }, () => (Math.random() - 0.49) * 0.015);
};
