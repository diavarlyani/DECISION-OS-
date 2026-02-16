
import { StockDataPoint, MetricSummary } from '../types';

export const calculateBeta = (stockReturns: number[], marketReturns: number[]): number => {
  if (stockReturns.length !== marketReturns.length) return 1.0;
  const n = stockReturns.length;
  const meanStock = stockReturns.reduce((a, b) => a + b, 0) / n;
  const meanMarket = marketReturns.reduce((a, b) => a + b, 0) / n;

  let covariance = 0;
  let marketVariance = 0;

  for (let i = 0; i < n; i++) {
    covariance += (stockReturns[i] - meanStock) * (marketReturns[i] - meanMarket);
    marketVariance += Math.pow(marketReturns[i] - meanMarket, 2);
  }

  return marketVariance === 0 ? 1.0 : covariance / marketVariance;
};

export const calculateCovariance = (arr1: number[], arr2: number[]): number => {
  if (arr1.length !== arr2.length || arr1.length === 0) return 0;
  const n = arr1.length;
  const mean1 = arr1.reduce((a, b) => a + b, 0) / n;
  const mean2 = arr2.reduce((a, b) => a + b, 0) / n;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += (arr1[i] - mean1) * (arr2[i] - mean2);
  }
  return sum / (n - 1);
};

export const runMonteCarlo = (returns: number[], horizon: number = 30, simulations: number = 500) => {
  const results = [];
  for (let s = 0; s < simulations; s++) {
    let price = 100;
    for (let h = 0; h < horizon; h++) {
      const randReturn = returns[Math.floor(Math.random() * returns.length)];
      price *= (1 + randReturn);
    }
    results.push(price);
  }
  results.sort((a, b) => a - b);
  return {
    p5: results[Math.floor(simulations * 0.05)],
    p50: results[Math.floor(simulations * 0.5)],
    p95: results[Math.floor(simulations * 0.95)],
  };
};

export const generateForecast = (data: number[], steps: number = 6) => {
  // Simple linear regression forecast
  const n = data.length;
  const x = Array.from({ length: n }, (_, i) => i);
  const y = data;

  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = y.reduce((a, b) => a + b, 0);
  const sumXY = x.reduce((a, i) => a + i * y[i], 0);
  const sumXX = x.reduce((a, i) => a + i * i, 0);

  const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;

  const forecast = [];
  for (let i = n; i < n + steps; i++) {
    forecast.push(slope * i + intercept);
  }
  
  // Calculate R-Squared for confidence
  const yMean = sumY / n;
  const ssTot = y.reduce((a, v) => a + Math.pow(v - yMean, 2), 0);
  const ssRes = y.reduce((a, v, i) => a + Math.pow(v - (slope * i + intercept), 2), 0);
  const rSquared = ssTot === 0 ? 0 : 1 - (ssRes / ssTot);

  return { forecast, rSquared };
};
