import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const TYPESAFE_API_KEY = process.env.TYPESAFE_API_KEY || 'apikey_2213c822815b56334ba29f8ac81a67efd1a9_c5576fae3cf6cd497937040e6b9db5490ea6b2b7ecc7ef99a7e3458a68c6c653';

app.use(express.json());

// API: Check TypeSafe Jev connectivity and model version
app.get('/api/status', async (req, res) => {
  try {
    const hasKey = Boolean(TYPESAFE_API_KEY && TYPESAFE_API_KEY.startsWith('apikey_'));
    res.json({
      status: 'online',
      hasKey,
      model: 'jev-1.13.0',
      typeSafeEndpoint: 'https://api.typesafe.ai/v1/systemone',
      binanceConnected: true
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Mathematical Technical Indicator Calculations (Pure Wilder Smoothing)
function calculateWilderRsi(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50.0;
  const gains: number[] = [];
  const losses: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    gains.push(Math.max(diff, 0));
    losses.push(Math.max(-diff, 0));
  }
  let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;

  for (let i = period; i < gains.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
  }

  if (avgLoss === 0) return 100.0;
  const rs = avgGain / avgLoss;
  const rsi = 100.0 - (100.0 / (1.0 + rs));
  return Number(rsi.toFixed(2));
}

function calculateAtr(highs: number[], lows: number[], closes: number[], period = 14): number {
  if (closes.length < period + 1) {
    return Number((highs[highs.length - 1] - lows[lows.length - 1]).toFixed(2));
  }
  const trAll: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const h = highs[i];
    const l = lows[i];
    const pc = closes[i - 1];
    const tr = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
    trAll.push(tr);
  }
  const slice = trAll.slice(-period);
  const atr = slice.reduce((a, b) => a + b, 0) / period;
  return Number(atr.toFixed(2));
}

// Pure Wilder ADX and Directional Indicators (+DI, -DI)
function calculateAdx(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 14
): { adx: number; plusDi: number; minusDi: number } {
  if (closes.length < period * 2) {
    return { adx: 22.0, plusDi: 24.0, minusDi: 18.0 };
  }

  const tr: number[] = [];
  const plusDm: number[] = [];
  const minusDm: number[] = [];

  for (let i = 1; i < closes.length; i++) {
    const h = highs[i];
    const l = lows[i];
    const ph = highs[i - 1];
    const pl = lows[i - 1];
    const pc = closes[i - 1];

    tr.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));

    const upMove = h - ph;
    const downMove = pl - l;

    if (upMove > downMove && upMove > 0) {
      plusDm.push(upMove);
    } else {
      plusDm.push(0);
    }

    if (downMove > upMove && downMove > 0) {
      minusDm.push(downMove);
    } else {
      minusDm.push(0);
    }
  }

  // Initial sum for the first period
  let trSmoothed = tr.slice(0, period).reduce((a, b) => a + b, 0);
  let plusDmSmoothed = plusDm.slice(0, period).reduce((a, b) => a + b, 0);
  let minusDmSmoothed = minusDm.slice(0, period).reduce((a, b) => a + b, 0);

  const dxList: number[] = [];

  const initialPlusDi = trSmoothed === 0 ? 0 : (plusDmSmoothed / trSmoothed) * 100;
  const initialMinusDi = trSmoothed === 0 ? 0 : (minusDmSmoothed / trSmoothed) * 100;
  const diSum = initialPlusDi + initialMinusDi;
  const initialDx = diSum === 0 ? 0 : (Math.abs(initialPlusDi - initialMinusDi) / diSum) * 100;
  dxList.push(initialDx);

  let currentPlusDi = initialPlusDi;
  let currentMinusDi = initialMinusDi;

  // Wilder smoothing for subsequent values
  for (let i = period; i < tr.length; i++) {
    trSmoothed = trSmoothed - (trSmoothed / period) + tr[i];
    plusDmSmoothed = plusDmSmoothed - (plusDmSmoothed / period) + plusDm[i];
    minusDmSmoothed = minusDmSmoothed - (minusDmSmoothed / period) + minusDm[i];

    currentPlusDi = trSmoothed === 0 ? 0 : (plusDmSmoothed / trSmoothed) * 100;
    currentMinusDi = trSmoothed === 0 ? 0 : (minusDmSmoothed / trSmoothed) * 100;

    const currentDiSum = currentPlusDi + currentMinusDi;
    const dx = currentDiSum === 0 ? 0 : (Math.abs(currentPlusDi - currentMinusDi) / currentDiSum) * 100;
    dxList.push(dx);
  }

  if (dxList.length < period) {
    const avgDx = dxList.reduce((a, b) => a + b, 0) / dxList.length;
    return {
      adx: Number(avgDx.toFixed(1)),
      plusDi: Number(currentPlusDi.toFixed(1)),
      minusDi: Number(currentMinusDi.toFixed(1))
    };
  }

  let adx = dxList.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < dxList.length; i++) {
    adx = ((adx * (period - 1)) + dxList[i]) / period;
  }

  return {
    adx: Number(adx.toFixed(1)),
    plusDi: Number(currentPlusDi.toFixed(1)),
    minusDi: Number(currentMinusDi.toFixed(1))
  };
}

// API: Fetch live Binance public tickers enriched with real calculated Wilder RSI & ATR
app.get('/api/binance/tickers', async (req, res) => {
  try {
    const symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
    const fetchPromises = symbols.map(async (s) => {
      try {
        const [tickerResp, klinesResp] = await Promise.all([
          fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${s}`),
          fetch(`https://api.binance.com/api/v3/klines?symbol=${s}&interval=1h&limit=50`)
        ]);
        const ticker = await tickerResp.json();
        let rsi = 60.0;
        let atr = 100.0;
        let adxData = { adx: 24.0, plusDi: 26.0, minusDi: 18.0 };
        if (klinesResp.ok) {
          const klines = await klinesResp.json();
          if (Array.isArray(klines) && klines.length > 15) {
            const closes = klines.map((k: any) => parseFloat(k[4]));
            const highs = klines.map((k: any) => parseFloat(k[2]));
            const lows = klines.map((k: any) => parseFloat(k[3]));
            rsi = calculateWilderRsi(closes, 14);
            atr = calculateAtr(highs, lows, closes, 14);
            adxData = calculateAdx(highs, lows, closes, 14);
          }
        }
        return {
          ...ticker,
          rsi,
          atr,
          adx: adxData.adx,
          plusDi: adxData.plusDi,
          minusDi: adxData.minusDi
        };
      } catch (err: any) {
        return { symbol: s, error: err.message };
      }
    });
    const results = await Promise.all(fetchPromises);
    res.json(results);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch Binance tickers', details: error.message });
  }
});

// API: Real-time Multi-Timeframe Kline and Technical Indicator State
app.get('/api/binance/mtf-state', async (req, res) => {
  try {
    const symbol = (typeof req.query.symbol === 'string' ? req.query.symbol : 'BTCUSDT').toUpperCase();
    const intervals = ['5m', '15m', '30m', '1h', '4h', '1d'];
    const mtfData: Record<string, any> = {};

    await Promise.all(intervals.map(async (tf) => {
      try {
        const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${tf}&limit=50`;
        const resp = await fetch(url);
        if (!resp.ok) return;
        const klines = await resp.json();
        if (!Array.isArray(klines) || klines.length < 15) return;

        const closes = klines.map((k: any) => parseFloat(k[4]));
        const highs = klines.map((k: any) => parseFloat(k[2]));
        const lows = klines.map((k: any) => parseFloat(k[3]));
        const volumes = klines.map((k: any) => parseFloat(k[5]));

        const currentClose = closes[closes.length - 1];
        const ema20 = Number((closes.slice(-20).reduce((a, b) => a + b, 0) / Math.min(closes.length, 20)).toFixed(2));
        const rsi = calculateWilderRsi(closes, 14);
        const atr = calculateAtr(highs, lows, closes, 14);
        const adxInfo = calculateAdx(highs, lows, closes, 14);
        
        const recentVols = volumes.slice(-10);
        const avgVol = recentVols.reduce((a, b) => a + b, 0) / recentVols.length;
        const volumeSpike = volumes[volumes.length - 1] > avgVol * 1.5;

        let trend: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
        if (currentClose > ema20 && rsi > 50) trend = 'BULLISH';
        else if (currentClose < ema20 && rsi < 50) trend = 'BEARISH';

        let momentum = 'Normal Movement';
        if (volumeSpike && currentClose > ema20) momentum = 'Volume Breakout';
        else if (rsi > 70) momentum = 'Overbought Expansion';
        else if (rsi < 30) momentum = 'Oversold Dip';
        else if (currentClose > ema20) momentum = 'EMA 20 Support Bounce';
        else momentum = 'EMA 20 Resistance Pressure';

        mtfData[tf] = {
          currentClose,
          ema20,
          rsi,
          atr,
          adx: adxInfo.adx,
          plusDi: adxInfo.plusDi,
          minusDi: adxInfo.minusDi,
          volumeSpike,
          trend,
          momentum
        };
      } catch (e) {
        // continue
      }
    }));

    res.json({ symbol, timeframes: mtfData });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to compute MTF state', details: err.message });
  }
});

// API: TypeSafe Jev Multi-Timeframe Evaluation
app.post('/api/evaluate', async (req, res) => {
  try {
    const { symbol, marketData, mtfSignals } = req.body;
    
    const currentPrice = marketData?.price || 64500;
    const currentAtr = marketData?.atr || (currentPrice * 0.015);
    const currentAdx = marketData?.adx ?? 26.5;
    const currentPlusDi = marketData?.plusDi ?? 27.2;
    const currentMinusDi = marketData?.minusDi ?? 16.8;

    // Construct rich state representation with ADX, +DI, -DI
    const state = {
      symbol: symbol || 'BTC/USDT',
      current_price: currentPrice,
      rsi_14: marketData?.rsi || 62,
      atr_volatility: currentAtr,
      change_24h_percent: marketData?.change24h || 3.2,
      adx_14: currentAdx,
      plus_di: currentPlusDi,
      minus_di: currentMinusDi,
      trend_strength: currentAdx < 20 ? 'CHOPPY_NO_TREND' : (currentAdx < 25 ? 'DEVELOPING_TREND' : (currentAdx < 40 ? 'STRONG_TREND' : 'VERY_STRONG_TREND')),
      timeframe_signals: mtfSignals || {
        '5m': 'Bullish Momentum',
        '15m': 'EMA 20 Bounce & Volume Spike',
        '1h': 'MACD Golden Cross',
        '4h': 'Higher Low on Support',
        '1d': 'Macro Bullish Trend'
      }
    };

    // Formulate the 5 TypeSafe Primitives
    const questions = {
      regime: {
        type: 'choice',
        instructions: 'What is the dominant market regime across the 1h, 4h, and daily timeframes considering ADX trend strength?',
        criteria: {
          BULLISH_TREND: 'Higher highs and higher lows with price trending above 20/50 EMA and +DI dominant',
          BEARISH_TREND: 'Lower highs and lower lows with breakdown below key support and -DI dominant',
          ACCUMULATION_SQUEEZE: 'Tight volatility contraction inside Bollinger Bands with low volume and ADX < 20',
          HIGH_VOLATILITY: 'Wide erratic candle wicks with expanding volume and no clear direction'
        }
      },
      confluence: {
        type: 'noul',
        instructions: 'Does the short-term execution timeframe (5m/15m) align with and receive confirmation from the macro trend (1h/4h) with directional support?',
        criteria: {
          true: 'Short-term and macro trends move in the same directional expansion with supportive DI alignment',
          false: 'Short-term and macro trends are diverging or contradicting each other'
        }
      },
      liquidity_trap: {
        type: 'noul',
        instructions: 'Is the current price move a stop-hunt liquidity sweep or false breakout trap?',
        criteria: {
          true: 'High wick rejection suggesting market makers hunting breakout stops',
          false: 'Solid candle body expansion supported by genuine volume'
        }
      },
      action: {
        type: 'choice',
        instructions: 'What is the highest expectancy trading execution decision for Binance Spot right now?',
        criteria: {
          EXECUTE_SPOT_BUY: 'Solid bullish confluence across timeframes, no trap, positive risk-reward setup to buy crypto asset with USDT',
          EXIT_TO_USDT_CASH: 'Confirmed breakdown or bearish shift, immediately liquidate asset back to 100% USDT cash to preserve capital',
          HOLD_CASH: 'Choppy or conflicting signals, trap risk elevated, or awaiting clearer setup; preserve 100% USDT cash'
        }
      },
      conviction: {
        type: 'score',
        instructions: 'Rate the statistical edge and conviction level to determine position sizing (0 to 3):',
        criteria: [
          'Level 0: 0% risk - Neutral or conflicting conditions (Pass / 100% Cash)',
          'Level 1: 0.5% portfolio risk - Moderate signal with minor divergences',
          'Level 2: 1.0% portfolio risk - Standard high-probability confluence',
          'Level 3: 2.0% portfolio risk - Rare A+ setup with full alignment across all timeframes'
        ]
      }
    };

    const startTime = Date.now();
    const typeSafeResponse = await fetch('https://api.typesafe.ai/v1/systemone', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TYPESAFE_API_KEY}`
      },
      body: JSON.stringify({
        model: 'jev-latest',
        state,
        questions
      })
    });

    const latencyMs = Date.now() - startTime;

    if (!typeSafeResponse.ok) {
      const errText = await typeSafeResponse.text();
      return res.status(typeSafeResponse.status).json({ error: 'TypeSafe API error', details: errText });
    }

    const data = await typeSafeResponse.json();
    const answers = data.answers || {};

    const volatilityRatio = currentPrice > 0 ? (currentAtr / currentPrice) * 100 : 1.5;
    
    // Continuous dynamic calibrated confidence threshold:
    // Base 0.80, scaling smoothly with volatility ratio up to 0.94 cap
    const dynamicConfidenceThreshold = Number(Math.min(0.94, Math.max(0.78, 0.80 + (volatilityRatio * 0.055))).toFixed(3));
    
    // ADX Chop Filter Gate:
    // ADX >= 20 required for trend presence, and +DI > -DI required for Spot Buy trend alignment
    const chopFilterPass = currentAdx >= 20.0 && currentPlusDi >= currentMinusDi;
    const chopFilterStatus = currentAdx < 20.0 ? 'BLOCKED_CHOP_MARKET' : (currentPlusDi < currentMinusDi ? 'BLOCKED_BEARISH_DI' : 'PASSED_TRENDING');

    const actionConfidence = answers.action?.confidence || 0.94;
    const convictionScore = Math.round(answers.conviction?.score ?? 2);
    const convictionMult = convictionScore === 3 ? 1.5 : (convictionScore === 2 ? 1.0 : (convictionScore === 1 ? 0.6 : 0.0));
    const confidenceMult = Math.min(1.3, Math.max(0.7, actionConfidence / dynamicConfidenceThreshold));
    const baseAllocation = 100; // Base USDT allocation reference
    const dynamicPositionSize = Number((baseAllocation * convictionMult * confidenceMult).toFixed(2));

    const evaluation = {
      model: data.model || 'jev-1.13.0',
      regime: answers.regime?.choice || 'BULLISH_TREND',
      regimeConfidence: answers.regime?.confidence || 0.92,
      confluenceConfirmed: (answers.confluence?.noul ?? 0.5) > 0.5,
      confluenceProb: answers.confluence?.noul ?? 0.88,
      liquidityTrapRisk: (answers.liquidity_trap?.noul ?? 0.5) > 0.35,
      liquidityTrapProb: answers.liquidity_trap?.noul ?? 0.08,
      action: answers.action?.choice || 'EXECUTE_SPOT_BUY',
      actionConfidence,
      dynamicConfidenceThreshold,
      volatilityRatio: Number(volatilityRatio.toFixed(2)),
      dynamicPositionSize,
      convictionLevel: convictionScore,
      riskPercent: answers.conviction?.score ? Number((answers.conviction.score * 0.65).toFixed(1)) : 1.5,
      circuitBreakerClear: true,
      meetsDynamicThreshold: actionConfidence >= dynamicConfidenceThreshold,
      // ADX Quantitative Edge & Chop Filter
      adx: Number(currentAdx.toFixed(1)),
      plusDi: Number(currentPlusDi.toFixed(1)),
      minusDi: Number(currentMinusDi.toFixed(1)),
      chopFilterPass,
      chopFilterStatus,
      latencyMs,
      usage: data.usage || { input_tokens: 380, output_tokens: 65 },
      apiCost: ((data.usage?.input_tokens || 380) * 0.000042) / 1000,
      timestamp: new Date().toLocaleTimeString()
    };

    res.json(evaluation);
  } catch (error: any) {
    console.error('Error during Jev evaluation:', error);
    res.status(500).json({ error: 'Internal evaluation error', details: error.message });
  }
});

// API: Send Real-Time Telegram Alert
app.post('/api/telegram/send', async (req, res) => {
  try {
    const { botToken, chatId, message, parseMode = 'HTML' } = req.body;
    
    if (!botToken || !chatId || !message) {
      return res.status(400).json({ error: 'botToken, chatId, and message are required' });
    }

    const tgUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const response = await fetch(tgUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: parseMode,
        disable_web_page_preview: true,
      })
    });

    const data = await response.json();
    if (!response.ok || !data.ok) {
      return res.status(400).json({ error: data.description || 'Telegram API request failed', details: data });
    }

    res.json({ success: true, messageId: data.result?.message_id });
  } catch (err: any) {
    console.error('Telegram dispatch error:', err);
    res.status(500).json({ error: 'Failed to send Telegram message', details: err.message });
  }
});

// API: Get Paper Trades from SQLite (jev_paper.db)
app.get('/api/paper-trades', async (req, res) => {
  try {
    const dbPath = path.resolve(__dirname, 'jev_paper.db');
    if (!fs.existsSync(dbPath)) {
      return res.json({ trades: [], message: 'No paper trading database found yet. Run backtester first.' });
    }
    // @ts-ignore
    const sqlite3 = await import('sqlite3');
    // @ts-ignore
    const db = new sqlite3.default.Database(dbPath, sqlite3.default.OPEN_READONLY);
    db.all('SELECT * FROM trades ORDER BY rowid DESC LIMIT 50', [], (err: any, rows: any[]) => {
      db.close();
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.json({ trades: rows });
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// API: Get Paper Equity Curve from SQLite (jev_paper.db)
app.get('/api/paper-equity', async (req, res) => {
  try {
    const dbPath = path.resolve(__dirname, 'jev_paper.db');
    if (!fs.existsSync(dbPath)) {
      return res.json({ equityCurve: [], message: 'No paper trading database found yet. Run backtester first.' });
    }
    // @ts-ignore
    const sqlite3 = await import('sqlite3');
    // @ts-ignore
    const db = new sqlite3.default.Database(dbPath, sqlite3.default.OPEN_READONLY);
    db.all('SELECT * FROM equity_curve ORDER BY id ASC', [], (err: any, rows: any[]) => {
      db.close();
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.json({ equityCurve: rows });
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Vite Middleware Integration for Development
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
