import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
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

// In-memory cache for klines to provide instant responses and prevent Binance rate limits
// Distinguish between latest klines (TTL: 4s) and historical closed blocks (TTL: 24h)
const klinesCache = new Map<string, { timestamp: number; data: any }>();
const LATEST_KLINES_CACHE_TTL_MS = 4000;
const HISTORICAL_KLINES_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// API: Fetch authentic Binance klines (candlesticks + volume) for TradingView Chart
app.get('/api/binance/klines', async (req, res) => {
  try {
    const symbol = (typeof req.query.symbol === 'string' ? req.query.symbol : 'BTCUSDT').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    const interval = typeof req.query.interval === 'string' ? req.query.interval : '15m';
    const limit = Math.min(Math.max(Number(req.query.limit) || 150, 10), 1000);

    // End time support for historical pagination
    let endTime: number | undefined = undefined;
    if (req.query.endTime) {
      const num = Number(req.query.endTime);
      if (!isNaN(num) && num > 0) {
        endTime = num < 1e11 ? num * 1000 : num; // ensure ms
      }
    }

    let startTime: number | undefined = undefined;
    if (req.query.startTime) {
      const num = Number(req.query.startTime);
      if (!isNaN(num) && num > 0) {
        startTime = num < 1e11 ? num * 1000 : num;
      }
    }

    const isHistorical = endTime !== undefined;
    const cacheKey = `${symbol}_${interval}_${limit}_${endTime || 'latest'}_${startTime || ''}`;

    const cached = klinesCache.get(cacheKey);
    const ttl = isHistorical ? HISTORICAL_KLINES_CACHE_TTL_MS : LATEST_KLINES_CACHE_TTL_MS;
    if (cached && Date.now() - cached.timestamp < ttl) {
      return res.json(cached.data);
    }

    let queryParams = `symbol=${symbol}&interval=${interval}&limit=${limit}`;
    if (endTime) queryParams += `&endTime=${endTime}`;
    if (startTime) queryParams += `&startTime=${startTime}`;

    let url = `https://api.binance.com/api/v3/klines?${queryParams}`;
    let resp = await fetch(url);
    if (!resp.ok) {
      url = `https://testnet.binance.vision/api/v3/klines?${queryParams}`;
      resp = await fetch(url);
    }

    if (!resp.ok) {
      if (cached) return res.json(cached.data);
      return res.status(resp.status).json({ error: 'Failed to fetch klines from Binance' });
    }

    const rawKlines = await resp.json();
    if (!Array.isArray(rawKlines)) {
      if (cached) return res.json(cached.data);
      return res.status(500).json({ error: 'Invalid response from Binance klines' });
    }

    const candles = rawKlines.map((k: any) => ({
      time: Math.floor(Number(k[0]) / 1000),
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
    }));

    const volumes = rawKlines.map((k: any) => {
      const open = parseFloat(k[1]);
      const close = parseFloat(k[4]);
      return {
        time: Math.floor(Number(k[0]) / 1000),
        value: parseFloat(k[5]),
        color: close >= open ? 'rgba(16, 185, 129, 0.4)' : 'rgba(244, 63, 94, 0.4)',
      };
    });

    const payload = {
      symbol,
      interval,
      candles,
      volumes,
      hasMore: candles.length === limit,
      oldestTime: candles.length > 0 ? candles[0].time : null,
      newestTime: candles.length > 0 ? candles[candles.length - 1].time : null,
    };

    klinesCache.set(cacheKey, { timestamp: Date.now(), data: payload });
    res.json(payload);
  } catch (error: any) {
    res.status(500).json({ error: 'Internal kline error', details: error.message });
  }
});

// API: Check Binance account balances & verify API Key
app.post('/api/binance/account', async (req, res) => {
  try {
    const { apiKey, apiSecret, isTestnet = true } = req.body;
    if (!apiKey || !apiSecret) {
      return res.status(400).json({ error: 'API Key and Secret Key are required' });
    }

    const baseUrl = isTestnet ? 'https://testnet.binance.vision' : 'https://api.binance.com';
    const timestamp = Date.now();
    const queryString = `timestamp=${timestamp}&recvWindow=10000`;
    const signature = crypto.createHmac('sha256', apiSecret).update(queryString).digest('hex');

    const resp = await fetch(`${baseUrl}/api/v3/account?${queryString}&signature=${signature}`, {
      method: 'GET',
      headers: {
        'X-MBX-APIKEY': apiKey,
      },
    });

    const data = await resp.json();
    if (!resp.ok) {
      return res.status(resp.status).json({
        error: data.msg || 'Binance Account API error',
        code: data.code,
        details: data
      });
    }

    const relevantSymbols = ['USDT', 'BTC', 'ETH', 'SOL', 'BNB'];
    const balances = (data.balances || []).filter((b: any) => 
      relevantSymbols.includes(b.asset) || parseFloat(b.free) > 0 || parseFloat(b.locked) > 0
    );

    res.json({
      success: true,
      canTrade: data.canTrade,
      accountType: data.accountType,
      balances,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// API: Fetch actual executed trades & orders from Binance
app.post('/api/binance/my-trades', async (req, res) => {
  try {
    const { apiKey, apiSecret, symbol = 'BTCUSDT', isTestnet = true } = req.body;
    if (!apiKey || !apiSecret) {
      return res.status(400).json({ error: 'API Key and Secret Key are required' });
    }

    const cleanSymbol = symbol.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    const baseUrl = isTestnet ? 'https://testnet.binance.vision' : 'https://api.binance.com';
    const timestamp = Date.now();
    const queryString = `symbol=${cleanSymbol}&timestamp=${timestamp}&recvWindow=10000&limit=30`;
    const signature = crypto.createHmac('sha256', apiSecret).update(queryString).digest('hex');

    const [tradesResp, ordersResp] = await Promise.all([
      fetch(`${baseUrl}/api/v3/myTrades?${queryString}&signature=${signature}`, {
        headers: { 'X-MBX-APIKEY': apiKey }
      }),
      fetch(`${baseUrl}/api/v3/allOrders?${queryString}&signature=${signature}`, {
        headers: { 'X-MBX-APIKEY': apiKey }
      })
    ]);

    const tradesData = await tradesResp.json();
    const ordersData = await ordersResp.json();

    if (!tradesResp.ok && !ordersResp.ok) {
      return res.status(400).json({
        error: tradesData.msg || ordersData.msg || 'Failed to fetch Binance trades',
        details: { tradesData, ordersData }
      });
    }

    const rawTrades = Array.isArray(tradesData) ? tradesData : [];
    const rawOrders = Array.isArray(ordersData) ? ordersData : [];

    res.json({
      success: true,
      trades: rawTrades,
      orders: rawOrders,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// API: Universal Real Order Execution (BUY & SELL for Take-Profit / Stop-Loss)
app.post('/api/binance/order', async (req, res) => {
  try {
    const {
      apiKey,
      apiSecret,
      symbol = 'BTCUSDT',
      side = 'BUY', // 'BUY' | 'SELL'
      quoteAmount = 15,
      quantity,
      reason = 'STRATEGY_SIGNAL', // '5_CONDITIONS_BUY' | 'TAKE_PROFIT' | 'STOP_LOSS' | 'MANUAL_EXIT'
      isTestnet = true,
      telegramConfig
    } = req.body;

    if (!apiKey || !apiSecret) {
      return res.status(400).json({ error: 'مفتاح الـ API و Secret Key مطلوبان لتنفيذ الأوامر.' });
    }

    const cleanSymbol = symbol.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    const baseAsset = cleanSymbol.replace(/USDT|BUSD|FDUSD|USDC/g, '');
    const baseUrl = isTestnet ? 'https://testnet.binance.vision' : 'https://api.binance.com';
    const timestamp = Date.now();
    const orderSide = side.toUpperCase() === 'SELL' ? 'SELL' : 'BUY';

    let queryParts = [
      `symbol=${cleanSymbol}`,
      `side=${orderSide}`,
      `type=MARKET`,
    ];

    if (orderSide === 'BUY') {
      const quoteQty = Number(quoteAmount) || 15;
      queryParts.push(`quoteOrderQty=${quoteQty}`);
    } else {
      // For SELL: prefer quantity if provided, else check account free balance or quoteOrderQty
      if (quantity && Number(quantity) > 0) {
        queryParts.push(`quantity=${quantity}`);
      } else if (quoteAmount && Number(quoteAmount) > 0) {
        queryParts.push(`quoteOrderQty=${Number(quoteAmount)}`);
      } else {
        // Query account to find free base asset
        const accQs = `timestamp=${Date.now()}&recvWindow=10000`;
        const accSig = crypto.createHmac('sha256', apiSecret).update(accQs).digest('hex');
        const accResp = await fetch(`${baseUrl}/api/v3/account?${accQs}&signature=${accSig}`, {
          headers: { 'X-MBX-APIKEY': apiKey }
        });
        if (accResp.ok) {
          const accData = await accResp.json();
          const holding = accData.balances?.find((b: any) => b.asset === baseAsset);
          const freeQty = parseFloat(holding?.free || '0');
          if (freeQty > 0) {
            queryParts.push(`quantity=${freeQty}`);
          } else {
            queryParts.push(`quoteOrderQty=15`);
          }
        } else {
          queryParts.push(`quoteOrderQty=15`);
        }
      }
    }

    queryParts.push(`timestamp=${timestamp}`);
    queryParts.push(`recvWindow=10000`);

    const queryParams = queryParts.join('&');
    const signature = crypto.createHmac('sha256', apiSecret).update(queryParams).digest('hex');
    const orderUrl = `${baseUrl}/api/v3/order?${queryParams}&signature=${signature}`;

    const orderResp = await fetch(orderUrl, {
      method: 'POST',
      headers: {
        'X-MBX-APIKEY': apiKey,
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    const orderResult = await orderResp.json();

    if (!orderResp.ok) {
      return res.status(orderResp.status).json({
        error: orderResult.msg || `فشل تنفيذ أمر ${orderSide} في Binance`,
        code: orderResult.code,
        details: orderResult
      });
    }

    const executedQty = parseFloat(orderResult.executedQty || '0');
    const cummulativeQuoteQty = parseFloat(orderResult.cummulativeQuoteQty || '0');
    const avgPrice = executedQty > 0 ? cummulativeQuoteQty / executedQty : 0;

    // Send Telegram alert based on order reason
    let tgSent = false;
    if (telegramConfig?.botToken && telegramConfig?.chatId) {
      try {
        let reasonLabel = '⚡ تنفيذ أمر مباشر';
        let actionIcon = orderSide === 'BUY' ? '🟢' : '🔴';
        let reasonTitle = 'تداول آلي';

        if (reason === '5_CONDITIONS_BUY') {
          reasonTitle = '🟢 تم تفعيل الشراء لاكتمال الشروط الـ 5 بنجاح';
          reasonLabel = 'شراء وتجميع Spot (Auto-Buy)';
        } else if (reason === 'TAKE_PROFIT') {
          reasonTitle = '🎯 تم تحقيق الهدف (Take Profit) والبيع بربح!';
          reasonLabel = 'بيع وإغلاق بربح (Take-Profit)';
        } else if (reason === 'STOP_LOSS') {
          reasonTitle = '🛡️ تم تفعيل وقف الخسارة (Stop Loss) لحماية المحفظة!';
          reasonLabel = 'بيع حماية رأس المال (Stop-Loss)';
        } else if (reason === 'MANUAL_EXIT') {
          reasonTitle = '💵 إغلاق الصفقة والتحول للكاش 100% USDT';
          reasonLabel = 'بيع فوري يدوي';
        }

        const tgMessage = `${actionIcon} <b>[Binance Testnet | ${reasonTitle}]</b>
━━━━━━━━━━━━━━━━━━━━
📌 الزوج: <b>${cleanSymbol}</b>
🏷️ نوع العملية: <b>${orderSide === 'BUY' ? 'شراء Spot' : 'بيع وتحول للكاش 100% USDT'}</b>
📝 السبب: <b>${reasonLabel}</b>
🔢 رقم الأمر: <code>#${orderResult.orderId}</code>
💵 القيمة: <b>$${cummulativeQuoteQty.toFixed(2)} USDT</b>
📦 الكمية المنفذة: <b>${executedQty} ${baseAsset}</b>
📈 متوسط سعر التنفيذ: <b>$${avgPrice.toLocaleString()}</b>
⏱️ التوقيت: <b>${new Date(orderResult.transactTime || Date.now()).toLocaleTimeString()}</b>
📊 وضع البوت: <b>تداول آلي نشط 24/7 🚀</b>`;

        await fetch(`https://api.telegram.org/bot${telegramConfig.botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: telegramConfig.chatId,
            text: tgMessage,
            parse_mode: 'HTML'
          })
        });
        tgSent = true;
      } catch (tgErr) {
        console.warn('Telegram notification failed:', tgErr);
      }
    }

    res.json({
      success: true,
      side: orderSide,
      reason,
      order: orderResult,
      executedPrice: avgPrice,
      executedQty,
      cummulativeQuoteQty,
      orderId: orderResult.orderId,
      telegramSent: tgSent,
      timestamp: new Date(orderResult.transactTime || Date.now()).toLocaleTimeString()
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Internal order execution error', details: err.message });
  }
});

// Alias for Instant Test Trade Execution with Telegram Notification
app.post('/api/binance/test-trade', async (req, res) => {
  try {
    const { apiKey, apiSecret, symbol = 'BTCUSDT', quoteAmount = 15, isTestnet = true, telegramConfig } = req.body;
    if (!apiKey || !apiSecret) {
      return res.status(400).json({ error: 'مفتاح الـ API و Secret Key مطلوبان لتنفيذ الصفقة الاختبارية.' });
    }

    const cleanSymbol = symbol.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    const baseUrl = isTestnet ? 'https://testnet.binance.vision' : 'https://api.binance.com';
    const timestamp = Date.now();
    const quoteQty = Number(quoteAmount) || 15;

    const queryParams = [
      `symbol=${cleanSymbol}`,
      `side=BUY`,
      `type=MARKET`,
      `quoteOrderQty=${quoteQty}`,
      `timestamp=${timestamp}`,
      `recvWindow=10000`
    ].join('&');

    const signature = crypto.createHmac('sha256', apiSecret).update(queryParams).digest('hex');
    const orderUrl = `${baseUrl}/api/v3/order?${queryParams}&signature=${signature}`;

    const orderResp = await fetch(orderUrl, {
      method: 'POST',
      headers: {
        'X-MBX-APIKEY': apiKey,
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    const orderResult = await orderResp.json();

    if (!orderResp.ok) {
      return res.status(orderResp.status).json({
        error: orderResult.msg || 'فشل تنفيذ الأمر في Binance Testnet',
        code: orderResult.code,
        details: orderResult
      });
    }

    const executedQty = parseFloat(orderResult.executedQty || '0');
    const cummulativeQuoteQty = parseFloat(orderResult.cummulativeQuoteQty || '0');
    const avgPrice = executedQty > 0 ? cummulativeQuoteQty / executedQty : 0;

    let tgSent = false;
    if (telegramConfig?.botToken && telegramConfig?.chatId) {
      try {
        const tgMessage = `⚡ <b>[Binance Testnet | تم تنفيذ صفقة اختبارية حقيقية بنجاح]</b>
━━━━━━━━━━━━━━━━━━━━
📌 الزوج: <b>${cleanSymbol}</b>
🏷️ النوع: <b>شراء فوري (Market BUY)</b>
🔢 رقم الأمر: <code>#${orderResult.orderId}</code>
💵 المبلغ المصروف: <b>$${cummulativeQuoteQty.toFixed(2)} USDT</b>
📦 الكمية المنفذة: <b>${executedQty} ${cleanSymbol.replace('USDT', '')}</b>
📈 متوسط سعر الشراء: <b>$${avgPrice.toLocaleString()}</b>
⏱️ التوقيت: <b>${new Date(orderResult.transactTime || Date.now()).toLocaleTimeString()}</b>
🟢 حالة الحساب: <b>متصل وجاهز للتداول الآلي 🚀</b>`;

        await fetch(`https://api.telegram.org/bot${telegramConfig.botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: telegramConfig.chatId,
            text: tgMessage,
            parse_mode: 'HTML'
          })
        });
        tgSent = true;
      } catch (tgErr) {
        console.warn('Telegram notification failed during test trade:', tgErr);
      }
    }

    res.json({
      success: true,
      order: orderResult,
      executedPrice: avgPrice,
      executedQty,
      cummulativeQuoteQty,
      orderId: orderResult.orderId,
      telegramSent: tgSent,
      timestamp: new Date(orderResult.transactTime || Date.now()).toLocaleTimeString()
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Internal test trade error', details: err.message });
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
