# 🚀 NEXUS OS - Complete Setup Guide

## Quick Start (5 Minutes)

### Step 1: Install Dependencies
```bash
npm install
```

### Step 2: Get Your Gemini API Key
1. Go to [Google AI Studio](https://ai.google.dev/)
2. Click "Get API Key"
3. Create a new API key
4. Copy the key

### Step 3: Configure Environment
```bash
# Copy the example file
cp .env.local.example .env.local

# Edit the file and paste your API key
# Replace 'your_gemini_api_key_here' with your actual key
```

Your `.env.local` should look like:
```env
GEMINI_API_KEY=AIzaSyC...your_actual_key_here
VITE_API_URL=http://localhost:3001
```

### Step 4: Run the Application
```bash
# Start both frontend and backend
npm run dev:all
```

### Step 5: Open in Browser
Navigate to: **http://localhost:3000**

---

## 🎯 First Time Usage

### 1. **Landing Page**
- You'll see the NEXUS OS landing page
- Enter a stock ticker (try: **AAPL**, **TSLA**, **NVDA**, **GOOGL**)
- Click **"FINANCE SECTOR"** to analyze stocks
- Or click **"NEXUS VISION"** to upload data files

### 2. **Finance Sector Demo**
```
1. Enter ticker: AAPL
2. Click "FINANCE SECTOR"
3. Wait for real stock data to load (3-5 seconds)
4. View the candlestick chart
5. Toggle between "Live OHLC" and "Neural Projection"
6. Ask the AI: "What should I do with this stock?"
```

### 3. **AI Assistant Demo**
Try these strategic prompts:
- "Synthesize current risk vectors"
- "Run neural performance projection"
- "Benchmark volatility vs S&P 500"
- "Suggest capital allocation strategy"

### 4. **Voice Commands** (Optional)
- Click the microphone icon
- Allow browser microphone access
- Say: "What are the key risks?"
- AI will respond with voice

---

## 🔧 Troubleshooting

### Problem: "Failed to fetch stock data"
**Solution:**
1. Make sure backend is running: `npm run dev:server`
2. Check backend logs for errors
3. Try a different stock ticker
4. App will fallback to simulated data automatically

### Problem: "Gemini API Error"
**Solution:**
1. Check your `.env.local` file exists
2. Verify API key is correct (no extra spaces)
3. Ensure you have API quota remaining
4. Restart the dev server: `Ctrl+C` then `npm run dev:all`

### Problem: "Port 3000 already in use"
**Solution:**
```bash
# Kill the process using port 3000
lsof -ti:3000 | xargs kill -9

# Or change the port in vite.config.ts
```

### Problem: "Port 3001 already in use"
**Solution:**
```bash
# Kill the process using port 3001
lsof -ti:3001 | xargs kill -9
```

### Problem: Voice not working
**Solution:**
1. Use Chrome or Edge (best compatibility)
2. Allow microphone permissions
3. Use HTTPS in production (required for speech API)

---

## 📊 Testing Real Stock Data

### Test the Backend API Directly
```bash
# Test health check
curl http://localhost:3001/api/health

# Test stock data (should return real Yahoo Finance data)
curl http://localhost:3001/api/stock/AAPL

# Test with different stocks
curl http://localhost:3001/api/stock/TSLA
curl http://localhost:3001/api/stock/NVDA
curl http://localhost:3001/api/stock/MSFT
```

### Verify Real Data vs Simulated
- **Real data**: Shows actual market dates and realistic prices
- **Simulated data**: Shows today's date with generated prices
- Check browser console for "Failed to fetch real stock data" warning

---

## 🎨 Customization

### Change Color Scheme
Edit `index.html` - look for gradient colors:
```css
/* Change primary colors */
.nexus-gradient {
    background: linear-gradient(135deg, #4f46e5 0%, #0ea5e9 100%);
}
```

### Add More Stock Tickers
The app supports ANY valid stock ticker:
- US Stocks: AAPL, GOOGL, MSFT, AMZN, META
- Tech: NVDA, AMD, INTC, TSLA
- Crypto: BTC-USD, ETH-USD
- International: Add exchange suffix (e.g., RELIANCE.NS)

### Customize AI Prompts
Edit `App.tsx` - find `STRATEGIC_PROMPTS`:
```typescript
const STRATEGIC_PROMPTS = [
  "Your custom prompt here",
  "Another strategic question",
  // Add more...
];
```

---

## 🚀 Production Deployment

### Option 1: Vercel (Frontend) + Railway (Backend)

**Frontend (Vercel):**
```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel

# Set environment variables in Vercel dashboard
GEMINI_API_KEY=your_key
VITE_API_URL=https://your-backend.railway.app
```

**Backend (Railway):**
1. Push code to GitHub
2. Connect Railway to your repo
3. Deploy the `server` folder
4. Set PORT environment variable

### Option 2: Single Server (VPS/AWS/DigitalOcean)
```bash
# Build frontend
npm run build

# Serve with Node.js
npm install -g serve
serve -s dist -l 3000 &

# Run backend
node server/index.js &
```

### Option 3: Docker (Coming Soon)
```bash
# Build and run with Docker Compose
docker-compose up -d
```

---

## 📈 Performance Tips

### 1. **Optimize Stock Data Loading**
- Backend caches Yahoo Finance responses
- Reduce API calls by storing data locally
- Use WebSocket for real-time updates (future)

### 2. **Improve AI Response Time**
- Use `gemini-2.0-flash` for faster responses
- Reduce `maxOutputTokens` for shorter answers
- Cache common queries

### 3. **Reduce Bundle Size**
```bash
# Analyze bundle
npm run build
npx vite-bundle-visualizer
```

---

## 🔐 Security Best Practices

### 1. **API Keys**
- ✅ Store in `.env.local` (never commit)
- ✅ Use environment variables
- ❌ Never hardcode in source files
- ❌ Never expose in client-side code

### 2. **Backend Security**
```javascript
// Add rate limiting
import rateLimit from 'express-rate-limit';

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});

app.use('/api/', limiter);
```

### 3. **CORS Configuration**
```javascript
// Restrict CORS in production
app.use(cors({
  origin: 'https://your-domain.com',
  credentials: true
}));
```

---

## 📚 Learning Resources

### Understanding the Code
- **App.tsx**: Main React component with state management
- **services/geminiService.ts**: AI integration and prompts
- **services/stockService.ts**: Yahoo Finance API wrapper
- **utils/math.ts**: Financial calculations (Beta, Sharpe, etc.)
- **server/index.js**: Express backend for data persistence

### Key Concepts
- **Beta**: Measures volatility vs market (>1 = more volatile)
- **Sharpe Ratio**: Risk-adjusted returns (higher = better)
- **Covariance**: Correlation with market movements
- **R²**: Confidence score for predictions (0-100%)

### External APIs
- [Google Gemini AI](https://ai.google.dev/docs)
- [Yahoo Finance API](https://query1.finance.yahoo.com/)
- [Web Speech API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API)

---

## 🆘 Getting Help

### Check Logs
```bash
# Frontend logs (in browser)
Open DevTools > Console

# Backend logs (in terminal)
Check the terminal running `npm run dev:server`
```

### Common Error Messages

| Error | Cause | Solution |
|-------|-------|----------|
| "API_KEY is not defined" | Missing .env.local | Create .env.local with GEMINI_API_KEY |
| "Failed to fetch" | Backend not running | Run `npm run dev:server` |
| "Stock not found" | Invalid ticker | Use valid ticker (e.g., AAPL) |
| "Rate limit exceeded" | Too many API calls | Wait or upgrade API plan |

---

## ✅ Verification Checklist

Before reporting issues, verify:

- [ ] Node.js installed (v18+): `node --version`
- [ ] Dependencies installed: `npm install` completed
- [ ] `.env.local` exists with valid API key
- [ ] Frontend running on port 3000
- [ ] Backend running on port 3001
- [ ] Browser console shows no errors
- [ ] Network tab shows successful API calls

---

## 🎉 You're Ready!

Your NEXUS OS is now fully operational. Start by:
1. Entering a stock ticker (AAPL, TSLA, NVDA)
2. Exploring the AI assistant
3. Asking strategic questions
4. Uploading data files in NEXUS Vision

**Enjoy your executive intelligence platform! 🚀**
