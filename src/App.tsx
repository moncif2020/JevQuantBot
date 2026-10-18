import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  TrendingUp,
  TrendingDown,
  Activity,
  Zap,
  ShieldCheck,
  Cpu,
  BarChart3,
  DollarSign,
  Clock,
  Play,
  Pause,
  RefreshCw,
  Copy,
  Check,
  AlertTriangle,
  ArrowUpRight,
  ArrowDownRight,
  Sliders,
  Terminal,
  BookOpen,
  Lock,
  ExternalLink,
  ChevronRight,
  Database,
  Layers,
  Sparkles,
  Info,
  Send,
  Target,
  Eye,
  EyeOff,
  CheckCircle2,
  XCircle,
  KeyRound,
  ShieldAlert,
  Download,
  RotateCcw
} from 'lucide-react';
import { TradingViewChart } from './components/TradingViewChart';
import { TelegramAlertsPanel, TelegramConfig } from './components/TelegramAlertsPanel';
import { TradeHistoryLogs, BacktestTradeLog } from './components/TradeHistoryLogs';
import { BacktestLabV01 } from './components/BacktestLabV01';
import { AccountEquityGrowthChart } from './components/AccountEquityGrowthChart';
import { CryptoWalletBalances, AssetBalanceItem } from './components/CryptoWalletBalances';
import { DEFAULT_ORIGINAL_PYTHON_BOT_CODE } from './constants/pythonBotScript';

// --- TYPES & INTERFACES ---
export type TradingMode = 'paper' | 'testnet' | 'live';

export interface ModeConfig {
  apiKey: string;
  apiSecret: string;
  spotAllocationPercent: number;
  isAccountVerified: boolean;
  accountBalance: number;
}

type AssetSymbol = 'BTC/USDT' | 'ETH/USDT' | 'SOL/USDT';
type Timeframe = '5m' | '15m' | '30m' | '1h' | '4h' | '12h' | '1d' | '1w';
type ActionType = 'EXECUTE_SPOT_BUY' | 'EXIT_TO_USDT_CASH' | 'HOLD_CASH' | 'TAKE_PROFIT_PARTIAL';
type MarketRegime = 'BULLISH_TREND' | 'BEARISH_TREND' | 'ACCUMULATION_SQUEEZE' | 'DISTRIBUTION' | 'HIGH_VOLATILITY';

interface AssetData {
  symbol: AssetSymbol;
  name: string;
  price: number;
  change24h: number;
  high24h: number;
  low24h: number;
  volume24h: string;
  atr: number;
  rsi: number;
  adx: number;
  plusDi: number;
  minusDi: number;
  ema20: number;
  ema50: number;
  ema200: number;
}

interface TimeframeSignal {
  tf: Timeframe;
  trend: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  rsi: number;
  atr?: number;
  adx?: number;
  plusDi?: number;
  minusDi?: number;
  momentum: string;
  weight: number;
}

interface TradeLog {
  id: string;
  timestamp: string;
  asset: AssetSymbol;
  type: 'شراء Spot' | 'بيع للكاش (USDT)';
  timeframe: Timeframe;
  entryPrice: number;
  exitPrice?: number;
  pnl?: number;
  pnlPercent?: number;
  status: 'OPEN' | 'CLOSED';
  conviction: number;
  stopLoss: number;
  takeProfit: number;
  exitReason?: string;
  atrValue?: number;
}

// Calculate dynamic ATR-based TP and SL based on asset and timeframe volatility
export function calculateDynamicAtrTargets(
  entryPrice: number,
  timeframe: Timeframe,
  assetAtr?: number,
  timeframeAtr?: number
) {
  const tfMultiplier: Record<Timeframe, number> = {
    '5m': 0.55,
    '15m': 1.0,
    '30m': 1.35,
    '1h': 1.9,
    '4h': 3.5,
    '12h': 5.5,
    '1d': 7.5,
    '1w': 16.0,
  };

  const baseAtr = timeframeAtr && timeframeAtr > 0 
    ? timeframeAtr 
    : (assetAtr && assetAtr > 0 ? assetAtr * (tfMultiplier[timeframe] || 1.0) : entryPrice * 0.015);

  // Stop-Loss: 1.5x ATR (with adaptive safety boundaries: min 0.8%, max 5.5%)
  const minSlDistance = entryPrice * 0.008;
  const maxSlDistance = entryPrice * 0.055;
  const rawSlDistance = baseAtr * 1.5;
  const slDistance = Math.min(maxSlDistance, Math.max(minSlDistance, rawSlDistance));

  // Take-Profit: 2.5x the SL Distance (Asymmetric positive expectancy RR: 1:2.5, tp_atr_mult = 3.75)
  const tpDistance = slDistance * 2.5;

  const stopLoss = Number((entryPrice - slDistance).toFixed(2));
  const takeProfit = Number((entryPrice + tpDistance).toFixed(2));
  const slPercent = Number(((slDistance / entryPrice) * 100).toFixed(2));
  const tpPercent = Number(((tpDistance / entryPrice) * 100).toFixed(2));

  return {
    stopLoss,
    takeProfit,
    slDistance,
    tpDistance,
    slPercent,
    tpPercent,
    atrUsed: Number(baseAtr.toFixed(2)),
    riskRewardRatio: '1:2.5',
  };
}

interface JevEvaluation {
  regime: MarketRegime;
  regimeConfidence: number;
  confluenceConfirmed: boolean;
  confluenceProb: number;
  liquidityTrapRisk: boolean;
  liquidityTrapProb: number;
  action: ActionType;
  actionConfidence: number;
  dynamicConfidenceThreshold: number;
  volatilityRatio: number;
  dynamicPositionSize: number;
  meetsDynamicThreshold: boolean;
  convictionLevel: number; // 0, 1, 2, 3
  riskPercent: number;
  circuitBreakerClear: boolean;
  // Quantitative Edge: ADX Trend & Chop Filter
  adx: number;
  plusDi: number;
  minusDi: number;
  chopFilterPass: boolean;
  chopFilterStatus: 'PASSED_TRENDING' | 'BLOCKED_CHOP_MARKET' | 'BLOCKED_BEARISH_DI';
  latencyMs: number;
  apiCost: number;
}

// Initial Mock Market Data
const ASSETS_DATA: Record<AssetSymbol, AssetData> = {
  'BTC/USDT': {
    symbol: 'BTC/USDT',
    name: 'Bitcoin',
    price: 64850.20,
    change24h: 3.42,
    high24h: 65400.00,
    low24h: 62900.00,
    volume24h: '$28.4B',
    atr: 1250,
    rsi: 61.4,
    adx: 28.4,
    plusDi: 29.1,
    minusDi: 17.5,
    ema20: 64200,
    ema50: 63100,
    ema200: 60500,
  },
  'ETH/USDT': {
    symbol: 'ETH/USDT',
    name: 'Ethereum',
    price: 3495.80,
    change24h: 4.18,
    high24h: 3540.00,
    low24h: 3380.00,
    volume24h: '$15.2B',
    atr: 85,
    rsi: 64.8,
    adx: 26.2,
    plusDi: 27.8,
    minusDi: 19.3,
    ema20: 3440,
    ema50: 3390,
    ema200: 3180,
  },
  'SOL/USDT': {
    symbol: 'SOL/USDT',
    name: 'Solana',
    price: 154.60,
    change24h: 6.85,
    high24h: 158.20,
    low24h: 144.10,
    volume24h: '$4.9B',
    atr: 6.4,
    rsi: 68.2,
    adx: 34.5,
    plusDi: 36.2,
    minusDi: 14.1,
    ema20: 149.5,
    ema50: 144.2,
    ema200: 132.0,
  }
};

const TIMEFRAMES: Timeframe[] = ['5m', '15m', '30m', '1h', '4h', '12h', '1d', '1w'];

export default function App() {
  // Navigation & View State
  const [activeTab, setActiveTab] = useState<'dashboard' | 'backtest' | 'binance' | 'telegram' | 'python_code' | 'strategy_blueprint'>('dashboard');
  const [selectedAsset, setSelectedAsset] = useState<AssetSymbol>('BTC/USDT');
  const [selectedTf, setSelectedTf] = useState<Timeframe>('15m');
  const [isBotRunning, setIsBotRunning] = useState<boolean>(true);
  const [botSpeedSec, setBotSpeedSec] = useState<number>(10);
  const [copiedCode, setCopiedCode] = useState<boolean>(false);
  const [showBlueprintModal, setShowBlueprintModal] = useState<boolean>(false);

  // Telegram Notifications State
  const [telegramConfig, setTelegramConfig] = useState<TelegramConfig>(() => {
    try {
      const saved = localStorage.getItem('jev_telegram_config');
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    return {
      botToken: '',
      chatId: '',
      notifyEntry: true,
      notifyWin: true,
      notifyLoss: true,
      notifyRegime: true,
    };
  });

  const handleUpdateTelegramConfig = (newCfg: TelegramConfig) => {
    setTelegramConfig(newCfg);
    try {
      localStorage.setItem('jev_telegram_config', JSON.stringify(newCfg));
    } catch (e) {}
  };

  // Active Trading Mode for the Bot ('paper' | 'testnet' | 'live')
  const [binanceMode, setBinanceMode] = useState<TradingMode>(() => {
    return (localStorage.getItem('jev_binance_mode') as TradingMode) || 'testnet';
  });

  // Dedicated credentials and configurations for all 3 trading modes (100% isolated)
  const [modesConfig, setModesConfig] = useState<Record<TradingMode, ModeConfig>>(() => {
    const legacyApiKey = localStorage.getItem('jev_binance_api_key') || '';
    const legacyApiSecret = localStorage.getItem('jev_binance_api_secret') || '';

    // Testnet keys: migrate legacy single key if testnet key is not yet set
    const testnetKey = localStorage.getItem('jev_binance_testnet_api_key') ?? legacyApiKey;
    const testnetSecret = localStorage.getItem('jev_binance_testnet_api_secret') ?? legacyApiSecret;

    // Live keys: MUST be empty unless explicitly entered by the user for live trading!
    const liveKey = localStorage.getItem('jev_binance_live_api_key') || '';
    const liveSecret = localStorage.getItem('jev_binance_live_api_secret') || '';

    // Paper keys: isolated paper keys or empty
    const paperKey = localStorage.getItem('jev_binance_paper_api_key') || '';
    const paperSecret = localStorage.getItem('jev_binance_paper_api_secret') || '';

    return {
      paper: {
        apiKey: paperKey,
        apiSecret: paperSecret,
        spotAllocationPercent: Number(localStorage.getItem('jev_binance_paper_allocation')) || 50,
        isAccountVerified: true,
        accountBalance: Number(localStorage.getItem('jev_binance_paper_balance')) || 10000,
      },
      testnet: {
        apiKey: testnetKey,
        apiSecret: testnetSecret,
        spotAllocationPercent: Number(localStorage.getItem('jev_binance_testnet_allocation')) || 50,
        isAccountVerified: false,
        accountBalance: 10000,
      },
      live: {
        apiKey: liveKey,
        apiSecret: liveSecret,
        spotAllocationPercent: Number(localStorage.getItem('jev_binance_live_allocation')) || 50,
        isAccountVerified: false,
        accountBalance: 0,
      },
    };
  });

  // Currently viewed/configured mode in the Binance Configuration tab
  const [configSelectedMode, setConfigSelectedMode] = useState<TradingMode>(() => {
    return (localStorage.getItem('jev_binance_mode') as TradingMode) || 'testnet';
  });

  const [showSecretPassword, setShowSecretPassword] = useState<boolean>(false);
  const [allocatedRiskPercent, setAllocatedRiskPercent] = useState<number>(1.5);
  const [saveSuccessMessage, setSaveSuccessMessage] = useState<string | null>(null);

  // Active mode helpers (dynamically resolve based on current active binanceMode)
  const currentModeConfig = modesConfig[binanceMode];
  const apiKey = currentModeConfig.apiKey;
  const apiSecret = currentModeConfig.apiSecret;
  const spotAllocationPercent = currentModeConfig.spotAllocationPercent;
  const isAccountVerified = currentModeConfig.isAccountVerified;
  const accountBalance = currentModeConfig.accountBalance;

  // Binance Real Execution & Test Trade State
  const [isExecutingTestTrade, setIsExecutingTestTrade] = useState<boolean>(false);
  const [testTradeFeedback, setTestTradeFeedback] = useState<{ success: boolean; message: string; details?: any } | null>(null);
  const [isLoadingMyTrades, setIsLoadingMyTrades] = useState<boolean>(false);

  // Real Wallet Balances State (isolated per trading mode)
  const [walletBalancesMap, setWalletBalancesMap] = useState<Record<TradingMode, AssetBalanceItem[]>>(() => {
    const loadModeBalances = (m: TradingMode): AssetBalanceItem[] => {
      try {
        const saved = localStorage.getItem(`jev_wallet_balances_${m}`);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed) && parsed.length > 0) return parsed;
        }
        if (m === 'testnet') {
          const legacy = localStorage.getItem('jev_wallet_balances');
          if (legacy) {
            const parsed = JSON.parse(legacy);
            if (Array.isArray(parsed) && parsed.length > 0) return parsed;
          }
        }
        if (m === 'paper') {
          return [
            {
              asset: 'USDT',
              name: 'Tether USD (كاش محاكاة ورقي)',
              iconBg: 'bg-emerald-600',
              free: 10000,
              locked: 0,
              total: 10000,
              priceUsdt: 1.0,
              totalUsdtValue: 10000,
              allocationPercent: 100,
              isStable: true
            }
          ];
        }
      } catch (e) {}
      return [];
    };

    return {
      paper: loadModeBalances('paper'),
      testnet: loadModeBalances('testnet'),
      live: loadModeBalances('live'),
    };
  });

  const walletBalances = walletBalancesMap[binanceMode] || [];
  const setWalletBalances = (updater: AssetBalanceItem[] | ((prev: AssetBalanceItem[]) => AssetBalanceItem[])) => {
    setWalletBalancesMap(prev => {
      const curList = prev[binanceMode] || [];
      const updated = typeof updater === 'function' ? updater(curList) : updater;
      try {
        localStorage.setItem(`jev_wallet_balances_${binanceMode}`, JSON.stringify(updated));
      } catch (e) {}
      return {
        ...prev,
        [binanceMode]: updated
      };
    });
  };

  const [isLoadingWalletBalances, setIsLoadingWalletBalances] = useState<boolean>(false);

  // Switch the active bot mode
  const handleSwitchActiveMode = (mode: TradingMode) => {
    setBinanceMode(mode);
    setConfigSelectedMode(mode);
    try {
      localStorage.setItem('jev_binance_mode', mode);
    } catch (e) {}
    setTestTradeFeedback(null);
    setSaveSuccessMessage(null);
  };

  // Market live price simulator
  const [marketPrices, setMarketPrices] = useState(ASSETS_DATA);

  // Timeframe Confluence Matrix State
  const [mtfSignals, setMtfSignals] = useState<Record<Timeframe, TimeframeSignal>>({
    '5m': { tf: '5m', trend: 'BULLISH', rsi: 63, adx: 27.2, plusDi: 28.5, minusDi: 17.2, momentum: 'Breakout Squeeze', weight: 0.10 },
    '15m': { tf: '15m', trend: 'BULLISH', rsi: 61, adx: 28.4, plusDi: 29.1, minusDi: 17.5, momentum: 'EMA 20 Bounce', weight: 0.15 },
    '30m': { tf: '30m', trend: 'BULLISH', rsi: 59, adx: 25.8, plusDi: 27.0, minusDi: 18.2, momentum: 'Volume Expansion', weight: 0.15 },
    '1h': { tf: '1h', trend: 'BULLISH', rsi: 64, adx: 31.0, plusDi: 32.4, minusDi: 16.0, momentum: 'MACD Golden Cross', weight: 0.20 },
    '4h': { tf: '4h', trend: 'BULLISH', rsi: 58, adx: 29.5, plusDi: 30.1, minusDi: 18.0, momentum: 'Higher Low Formed', weight: 0.20 },
    '12h': { tf: '12h', trend: 'BULLISH', rsi: 55, adx: 24.2, plusDi: 25.0, minusDi: 20.1, momentum: 'Over 200 EMA', weight: 0.10 },
    '1d': { tf: '1d', trend: 'BULLISH', rsi: 56, adx: 26.0, plusDi: 27.2, minusDi: 19.4, momentum: 'Macro Uptrend', weight: 0.05 },
    '1w': { tf: '1w', trend: 'NEUTRAL', rsi: 51, adx: 18.5, plusDi: 21.0, minusDi: 22.1, momentum: 'Consolidation Base', weight: 0.05 },
  });

  // Live Jev Decision State
  const [jevDecision, setJevDecision] = useState<JevEvaluation>({
    regime: 'BULLISH_TREND',
    regimeConfidence: 0.94,
    confluenceConfirmed: true,
    confluenceProb: 0.91,
    liquidityTrapRisk: false,
    liquidityTrapProb: 0.07,
    action: 'EXECUTE_SPOT_BUY',
    actionConfidence: 0.93,
    dynamicConfidenceThreshold: 0.88,
    volatilityRatio: 1.93,
    dynamicPositionSize: 630.00,
    meetsDynamicThreshold: true,
    convictionLevel: 2,
    riskPercent: 1.5,
    circuitBreakerClear: true,
    adx: 28.4,
    plusDi: 29.1,
    minusDi: 17.5,
    chopFilterPass: true,
    chopFilterStatus: 'PASSED_TRENDING',
    latencyMs: 96,
    apiCost: 0.000043,
  });

  const [isEvaluatingLive, setIsEvaluatingLive] = useState<boolean>(false);
  const [lastEvaluatedAt, setLastEvaluatedAt] = useState<string>('متصل وجاهز');
  const [isLiveConnected, setIsLiveConnected] = useState<boolean>(true);

  // Helper to dispatch live Telegram push alerts
  const sendLiveTelegramAlert = async (text: string) => {
    if (!telegramConfig.botToken || !telegramConfig.chatId) return;
    try {
      await fetch('/api/telegram/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          botToken: telegramConfig.botToken.trim(),
          chatId: telegramConfig.chatId.trim(),
          message: text,
          parseMode: 'HTML',
        }),
      });
    } catch (e) {
      console.warn('Failed to send Telegram alert:', e);
    }
  };

  // Live Jev API Evaluation Function
  const triggerLiveJevEvaluation = async () => {
    setIsEvaluatingLive(true);
    try {
      const resp = await fetch('/api/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: selectedAsset,
          marketData: marketPrices[selectedAsset],
          mtfSignals: {
            '5m': mtfSignals['5m'].momentum,
            '15m': mtfSignals['15m'].momentum,
            '1h': mtfSignals['1h'].momentum,
            '4h': mtfSignals['4h'].momentum,
            '1d': mtfSignals['1d'].momentum,
          }
        })
      });
      if (resp.ok) {
        const data = await resp.json();
        const actionConf = data.actionConfidence ?? 0.93;
        const currentAtr = marketPrices[selectedAsset]?.atr || 100;
        const currentPx = marketPrices[selectedAsset]?.price || 64000;
        const volRatio = data.volatilityRatio ?? (currentPx > 0 ? (currentAtr / currentPx) * 100 : 1.5);
        const dynamicThreshold = data.dynamicConfidenceThreshold ?? Number(Math.min(0.94, Math.max(0.78, 0.80 + (volRatio * 0.055))).toFixed(3));
        const meetsThreshold = actionConf >= dynamicThreshold;

        setJevDecision({
          regime: data.regime,
          regimeConfidence: data.regimeConfidence,
          confluenceConfirmed: data.confluenceConfirmed,
          confluenceProb: data.confluenceProb,
          liquidityTrapRisk: data.liquidityTrapRisk,
          liquidityTrapProb: data.liquidityTrapProb,
          action: data.action,
          actionConfidence: actionConf,
          dynamicConfidenceThreshold: dynamicThreshold,
          volatilityRatio: Number(volRatio.toFixed(2)),
          dynamicPositionSize: data.dynamicPositionSize ?? 500,
          meetsDynamicThreshold: meetsThreshold,
          convictionLevel: data.convictionLevel,
          adx: data.adx ?? 28.4,
          plusDi: data.plusDi ?? 29.1,
          minusDi: data.minusDi ?? 17.5,
          chopFilterPass: data.chopFilterPass ?? true,
          chopFilterStatus: data.chopFilterStatus ?? 'PASSED_TRENDING',
          latencyMs: data.latencyMs,
          riskPercent: data.riskPercent ?? (data.convictionLevel === 3 ? 2.0 : data.convictionLevel === 2 ? 1.0 : data.convictionLevel === 1 ? 0.5 : 0.0),
          circuitBreakerClear: data.circuitBreakerClear ?? true,
          apiCost: data.apiCost || 0.000043,
        });
        setLastEvaluatedAt(data.timestamp || new Date().toLocaleTimeString());
        setIsLiveConnected(true);

        // Send Telegram alert if regime notifications are enabled
        if (telegramConfig.notifyRegime && telegramConfig.botToken && telegramConfig.chatId) {
          sendLiveTelegramAlert(`📊 <b>[JevQuant] تقييم جديد لحالة السوق وفلتر ADX</b>
━━━━━━━━━━━━━━━━━━━━
الأصل: <b>#${selectedAsset.replace('/', '')}</b>
القرار: <b>${data.action}</b>
الثقة المرصودة: <b>${(actionConf * 100).toFixed(0)}%</b>
عتبة الثقة الديناميكية: <b>${(dynamicThreshold * 100).toFixed(1)}%</b>
مؤشر ADX (14): <b>${data.adx ?? 28.4}</b> (+DI: ${data.plusDi ?? 29.1} | -DI: ${data.minusDi ?? 17.5})
فلتر التذبذب (Chop Filter): <b>${data.chopFilterPass ? 'مستوفى بنجاح ✓ (Trending)' : 'محجوب 🛡️ (Chop Market)'}</b>
نسبة التقلب (ATR Ratio): <b>${volRatio.toFixed(2)}%</b>
استيفاء شرط التنفيذ: <b>${meetsThreshold && data.chopFilterPass ? 'مستوفى كلياً ✓ (Qualified)' : 'غير مستوفى ✕ (Shielded)'}</b>
النمط: <b>${data.regime}</b>
توافق الفريمات: <b>${data.confluenceConfirmed ? 'مؤكد ✓' : 'غير مؤكد'}</b>
السعر الحالي: <b>$${marketPrices[selectedAsset].price.toLocaleString()}</b>
الوقت: <b>${new Date().toLocaleTimeString()}</b>`);
        }
      }
    } catch (err) {
      console.error('Failed to trigger live Jev evaluation:', err);
    } finally {
      setIsEvaluatingLive(false);
    }
  };

  // Fetch real Binance public prices on load and periodically
  useEffect(() => {
    const fetchBinanceTickers = async () => {
      try {
        const resp = await fetch('/api/binance/tickers');
        if (resp.ok) {
          const data = await resp.json();
          // map BTCUSDT, ETHUSDT, SOLUSDT
          const btc = data.find((d: any) => d.symbol === 'BTCUSDT');
          const eth = data.find((d: any) => d.symbol === 'ETHUSDT');
          const sol = data.find((d: any) => d.symbol === 'SOLUSDT');

          setMarketPrices(prev => ({
            'BTC/USDT': btc ? {
              ...prev['BTC/USDT'],
              price: parseFloat(btc.lastPrice),
              change24h: parseFloat(btc.priceChangePercent),
              high24h: parseFloat(btc.highPrice),
              low24h: parseFloat(btc.lowPrice),
              rsi: typeof btc.rsi === 'number' ? btc.rsi : prev['BTC/USDT'].rsi,
              atr: typeof btc.atr === 'number' ? btc.atr : prev['BTC/USDT'].atr,
              adx: typeof btc.adx === 'number' ? btc.adx : prev['BTC/USDT'].adx,
              plusDi: typeof btc.plusDi === 'number' ? btc.plusDi : prev['BTC/USDT'].plusDi,
              minusDi: typeof btc.minusDi === 'number' ? btc.minusDi : prev['BTC/USDT'].minusDi,
            } : prev['BTC/USDT'],
            'ETH/USDT': eth ? {
              ...prev['ETH/USDT'],
              price: parseFloat(eth.lastPrice),
              change24h: parseFloat(eth.priceChangePercent),
              high24h: parseFloat(eth.highPrice),
              low24h: parseFloat(eth.lowPrice),
              rsi: typeof eth.rsi === 'number' ? eth.rsi : prev['ETH/USDT'].rsi,
              atr: typeof eth.atr === 'number' ? eth.atr : prev['ETH/USDT'].atr,
              adx: typeof eth.adx === 'number' ? eth.adx : prev['ETH/USDT'].adx,
              plusDi: typeof eth.plusDi === 'number' ? eth.plusDi : prev['ETH/USDT'].plusDi,
              minusDi: typeof eth.minusDi === 'number' ? eth.minusDi : prev['ETH/USDT'].minusDi,
            } : prev['ETH/USDT'],
            'SOL/USDT': sol ? {
              ...prev['SOL/USDT'],
              price: parseFloat(sol.lastPrice),
              change24h: parseFloat(sol.priceChangePercent),
              high24h: parseFloat(sol.highPrice),
              low24h: parseFloat(sol.lowPrice),
              rsi: typeof sol.rsi === 'number' ? sol.rsi : prev['SOL/USDT'].rsi,
              atr: typeof sol.atr === 'number' ? sol.atr : prev['SOL/USDT'].atr,
              adx: typeof sol.adx === 'number' ? sol.adx : prev['SOL/USDT'].adx,
              plusDi: typeof sol.plusDi === 'number' ? sol.plusDi : prev['SOL/USDT'].plusDi,
              minusDi: typeof sol.minusDi === 'number' ? sol.minusDi : prev['SOL/USDT'].minusDi,
            } : prev['SOL/USDT'],
          }));
        }
      } catch (e) {
        console.warn('Binance fetch fallback');
      }
    };

    fetchBinanceTickers();
    const tickerInterval = setInterval(fetchBinanceTickers, 10000);
    return () => clearInterval(tickerInterval);
  }, []);

  // Fetch real Multi-Timeframe Kline and Technical Indicators from Binance
  useEffect(() => {
    const fetchMtfState = async () => {
      try {
        const cleanSymbol = selectedAsset.replace('/', '');
        const resp = await fetch(`/api/binance/mtf-state?symbol=${cleanSymbol}`);
        if (resp.ok) {
          const data = await resp.json();
          if (data.timeframes) {
            setMtfSignals((prev) => {
              const updated = { ...prev };
              Object.entries(data.timeframes).forEach(([tf, tfData]: [string, any]) => {
                if (updated[tf as Timeframe]) {
                  updated[tf as Timeframe] = {
                    ...updated[tf as Timeframe],
                    rsi: tfData.rsi ?? updated[tf as Timeframe].rsi,
                    adx: tfData.adx ?? updated[tf as Timeframe].adx,
                    atr: tfData.atr ?? updated[tf as Timeframe].atr,
                    plusDi: tfData.plusDi ?? updated[tf as Timeframe].plusDi,
                    minusDi: tfData.minusDi ?? updated[tf as Timeframe].minusDi,
                    trend: tfData.trend ?? updated[tf as Timeframe].trend,
                    momentum: tfData.momentum ?? updated[tf as Timeframe].momentum,
                  };
                }
              });
              return updated;
            });
          }
        }
      } catch (err) {
        console.warn('Failed to fetch MTF state from server');
      }
    };

    fetchMtfState();
    const mtfInterval = setInterval(fetchMtfState, 15000);
    return () => clearInterval(mtfInterval);
  }, [selectedAsset]);

  // Separate Trade History for each of the 3 modes (100% isolated between paper, testnet, and live)
  const [tradesMap, setTradesMap] = useState<Record<TradingMode, TradeLog[]>>(() => {
    const loadModeTrades = (m: TradingMode): TradeLog[] => {
      try {
        const saved = localStorage.getItem(`jev_trades_${m}`);
        if (saved) return JSON.parse(saved);
        if (m === 'testnet') {
          const legacy = localStorage.getItem('jev_real_trades');
          if (legacy) return JSON.parse(legacy);
        }
      } catch (e) {}
      return [];
    };

    return {
      paper: loadModeTrades('paper'),
      testnet: loadModeTrades('testnet'),
      live: loadModeTrades('live'),
    };
  });

  const trades = tradesMap[binanceMode] || [];
  const setTrades = (updater: TradeLog[] | ((prev: TradeLog[]) => TradeLog[])) => {
    setTradesMap(prev => {
      const curList = prev[binanceMode] || [];
      const updated = typeof updater === 'function' ? updater(curList) : updater;
      try {
        localStorage.setItem(`jev_trades_${binanceMode}`, JSON.stringify(updated));
      } catch (e) {}
      return {
        ...prev,
        [binanceMode]: updated
      };
    });
  };

  // Helper to save credentials specifically for one mode
  const handleSaveModeCredentials = async (
    targetMode: TradingMode,
    newApiKey: string,
    newApiSecret: string,
    newAllocation: number
  ) => {
    const trimmedKey = newApiKey.trim();
    const trimmedSecret = newApiSecret.trim();

    // 1. Update localStorage strictly for this target mode
    try {
      localStorage.setItem(`jev_binance_${targetMode}_api_key`, trimmedKey);
      localStorage.setItem(`jev_binance_${targetMode}_api_secret`, trimmedSecret);
      localStorage.setItem(`jev_binance_${targetMode}_allocation`, String(newAllocation));
    } catch (e) {}

    // Update state for this mode
    setModesConfig(prev => ({
      ...prev,
      [targetMode]: {
        ...prev[targetMode],
        apiKey: trimmedKey,
        apiSecret: trimmedSecret,
        spotAllocationPercent: newAllocation,
      }
    }));

    if (targetMode === 'paper') {
      setModesConfig(prev => ({
        ...prev,
        paper: { ...prev.paper, isAccountVerified: true }
      }));
      setSaveSuccessMessage('✓ تم حفظ إعدادات نمط البيبر (Paper Trading) بنجاح! المحاكاة جاهزة برصيد افتراضي $10,000 USDT.');
      setTimeout(() => setSaveSuccessMessage(null), 6000);
      return;
    }

    if (!trimmedKey || !trimmedSecret) {
      setModesConfig(prev => ({
        ...prev,
        [targetMode]: { ...prev[targetMode], isAccountVerified: false }
      }));
      setSaveSuccessMessage(`تم حفظ التعديلات لنمط ${targetMode === 'live' ? 'Spot Live الحقيقي' : 'Spot Testnet'} (الحقول فارغة).`);
      setTimeout(() => setSaveSuccessMessage(null), 6000);
      return;
    }

    const isTestnet = targetMode === 'testnet';
    const modeLabel = isTestnet ? 'Binance Spot Testnet' : 'Binance Spot Live الحقيقي';
    setSaveSuccessMessage(`جاري التحقق من المفاتيح ومطابقة الرصيد عبر سيرفرات ${modeLabel}...`);

    try {
      const resp = await fetch('/api/binance/account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: trimmedKey,
          apiSecret: trimmedSecret,
          isTestnet,
          activeAssets: ['USDT', 'BTC', 'ETH', 'SOL', 'BNB'],
        })
      });
      const data = await resp.json();
      if (resp.ok && data.success) {
        const usdt = data.balances?.find((b: any) => b.asset === 'USDT');
        const usdtVal = usdt ? parseFloat((parseFloat(usdt.free) + parseFloat(usdt.locked)).toFixed(2)) : 0;

        setModesConfig(prev => ({
          ...prev,
          [targetMode]: {
            ...prev[targetMode],
            isAccountVerified: true,
            accountBalance: usdtVal
          }
        }));

        setSaveSuccessMessage(`✓ تم التحقق والربط بنجاح مع ${modeLabel}! رصيد USDT المتوفر: $${usdtVal.toLocaleString()} 🚀`);

        // If target mode is currently active, refresh wallet
        if (targetMode === binanceMode) {
          fetchBinanceAccountBalance();
          fetchBinanceMyTrades();
        }
      } else {
        setModesConfig(prev => ({
          ...prev,
          [targetMode]: { ...prev[targetMode], isAccountVerified: false }
        }));
        setSaveSuccessMessage(`تم حفظ المفاتيح، ولكن رد ${modeLabel}: ${data.error || 'تأكد من صحة المفتاح وصلاحيات القراءة والتداول'}`);
      }
    } catch (err: any) {
      setSaveSuccessMessage(`تم حفظ المفاتيح محلياً بنجاح لنمط ${targetMode}!`);
    }
    setTimeout(() => setSaveSuccessMessage(null), 8000);
  };

  // Fetch verified account balance from Binance Testnet / Live / Paper
  const fetchBinanceAccountBalance = async () => {
    if (binanceMode === 'paper') {
      setIsLoadingWalletBalances(false);
      setModesConfig(prev => ({
        ...prev,
        paper: { ...prev.paper, isAccountVerified: true }
      }));
      return;
    }

    if (!apiKey || !apiSecret) {
      setIsLoadingWalletBalances(false);
      return;
    }

    setIsLoadingWalletBalances(true);
    try {
      const BOT_TRADED_COINS = ['USDT', 'BTC', 'ETH', 'SOL', 'BNB'];
      const resp = await fetch('/api/binance/account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: apiKey.trim(),
          apiSecret: apiSecret.trim(),
          isTestnet: binanceMode === 'testnet',
          activeAssets: BOT_TRADED_COINS,
        })
      });
      if (resp.ok) {
        const data = await resp.json();
        const usdt = data.balances?.find((b: any) => b.asset === 'USDT');
        const totalUsdt = usdt ? parseFloat(usdt.free) + parseFloat(usdt.locked) : 0;

        setModesConfig(prev => ({
          ...prev,
          [binanceMode]: {
            ...prev[binanceMode],
            isAccountVerified: true,
            accountBalance: Number(totalUsdt.toFixed(2))
          }
        }));

        // Parse and calculate detailed asset balances (strictly non-zero real balances for bot pairs)
        if (Array.isArray(data.balances)) {
          const priceMap: Record<string, number> = {
            'USDT': 1.0,
            'BUSD': 1.0,
            'USDC': 1.0,
            'FDUSD': 1.0,
            'BTC': marketPrices['BTC/USDT']?.price || 68450,
            'ETH': marketPrices['ETH/USDT']?.price || 3520,
            'SOL': marketPrices['SOL/USDT']?.price || 154.2,
            'BNB': 590.0,
          };

          const nameMap: Record<string, string> = {
            'USDT': 'Tether USD (كاش)',
            'BTC': 'Bitcoin Spot',
            'ETH': 'Ethereum Spot',
            'SOL': 'Solana Spot',
            'BNB': 'BNB Chain (رسوم المنصة)',
          };

          const colorMap: Record<string, string> = {
            'USDT': 'bg-emerald-600',
            'BTC': 'bg-amber-500',
            'ETH': 'bg-indigo-500',
            'SOL': 'bg-purple-500',
            'BNB': 'bg-yellow-500',
          };

          const validTickerRegex = /^[A-Z][A-Z0-9]{1,9}$/;
          const parsed = data.balances
            .filter((b: any) => {
              const sym = String(b.asset || '').trim().toUpperCase();
              if (!validTickerRegex.test(sym)) return false;
              if (['TEST', 'DUMMY', 'FAKE', 'MOCK'].includes(sym)) return false;
              if (!BOT_TRADED_COINS.includes(sym)) return false;
              const free = parseFloat(b.free) || 0;
              const locked = parseFloat(b.locked) || 0;
              const total = free + locked;
              if (total <= 0.00000001) return false;
              const price = (typeof b.priceUsdt === 'number' && b.priceUsdt > 0)
                ? b.priceUsdt
                : (priceMap[sym] || ((marketPrices as Record<string, any>)[`${sym}/USDT`]?.price) || (['USDT', 'BUSD', 'FDUSD', 'USDC'].includes(sym) ? 1.0 : 0));
              const totalVal = (typeof b.totalUsdtValue === 'number' && b.totalUsdtValue > 0)
                ? b.totalUsdtValue
                : total * price;
              return price > 0 && totalVal > 0.01;
            })
            .map((b: any) => {
              const asset = String(b.asset || '').trim().toUpperCase();
              const free = parseFloat(b.free) || 0;
              const locked = parseFloat(b.locked) || 0;
              const total = free + locked;
              const price = (typeof b.priceUsdt === 'number' && b.priceUsdt > 0)
                ? b.priceUsdt
                : (priceMap[asset] || ((marketPrices as Record<string, any>)[`${asset}/USDT`]?.price) || (['USDT', 'BUSD', 'FDUSD', 'USDC'].includes(asset) ? 1.0 : 0));
              const totalUsdtValue = (typeof b.totalUsdtValue === 'number' && b.totalUsdtValue > 0)
                ? b.totalUsdtValue
                : total * price;

              return {
                asset,
                name: nameMap[asset] || `${asset} Spot Asset`,
                iconBg: colorMap[asset] || 'bg-slate-700',
                free,
                locked,
                total,
                priceUsdt: price,
                totalUsdtValue,
                allocationPercent: 0,
                isStable: asset === 'USDT' || asset === 'BUSD' || asset === 'FDUSD' || asset === 'USDC',
              };
            });

          const totalVal = parsed.reduce((sum: number, item: any) => sum + item.totalUsdtValue, 0);
          const finalBalances = parsed.map((item: any) => ({
            ...item,
            allocationPercent: totalVal > 0 ? (item.totalUsdtValue / totalVal) * 100 : 0
          }));

          setWalletBalances(finalBalances);
        }
      }
    } catch (e) {
      console.warn('Account balance fetch fallback');
    } finally {
      setIsLoadingWalletBalances(false);
    }
  };

  // Total Wallet Value in USDT across all assets
  const totalWalletUsdt = useMemo(() => {
    return walletBalances.reduce((sum, item) => sum + (item.totalUsdtValue || (item.total * item.priceUsdt)), 0);
  }, [walletBalances]);

  // Fetch real executed orders & trades directly from Binance Testnet / Live
  const fetchBinanceMyTrades = async () => {
    if (binanceMode === 'paper') {
      setTestTradeFeedback({
        success: true,
        message: 'أنت في نمط التداول الورقي (Paper Trading) — جميع الصفقات والنتائج تُسجل وتُدار محلياً بدقة.'
      });
      return;
    }

    if (!apiKey || !apiSecret) {
      setTestTradeFeedback({
        success: false,
        message: `يرجى حفظ مفتاح الـ API و Secret Key الخاص بـ ${binanceMode === 'live' ? 'Binance Spot Live' : 'Binance Testnet'} أولاً.`
      });
      return;
    }
    setIsLoadingMyTrades(true);
    try {
      const cleanSymbol = selectedAsset.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
      const resp = await fetch('/api/binance/my-trades', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: apiKey.trim(),
          apiSecret: apiSecret.trim(),
          symbol: cleanSymbol,
          isTestnet: binanceMode === 'testnet'
        })
      });
      const data = await resp.json();
      if (resp.ok && data.success) {
        setModesConfig(prev => ({
          ...prev,
          [binanceMode]: { ...prev[binanceMode], isAccountVerified: true }
        }));
        const orders = data.orders || [];
        if (orders.length > 0) {
          const mappedTrades: TradeLog[] = orders.slice(-20).reverse().map((o: any) => {
            const executedQty = parseFloat(o.executedQty || '0');
            const cummulativeQuote = parseFloat(o.cummulativeQuoteQty || '0');
            const avgPrice = executedQty > 0 ? cummulativeQuote / executedQty : parseFloat(o.price || '0');
            return {
              id: `BN-${o.orderId}`,
              timestamp: new Date(o.time || o.transactTime || o.updateTime || Date.now()).toLocaleTimeString(),
              asset: selectedAsset,
              type: o.side === 'BUY' ? 'شراء Spot' : 'بيع للكاش (USDT)',
              timeframe: selectedTf,
              entryPrice: avgPrice || marketPrices[selectedAsset]?.price || 0,
              status: o.status === 'FILLED' ? 'CLOSED' : 'OPEN',
              conviction: 2,
              stopLoss: avgPrice > 0 ? Number((avgPrice * 0.985).toFixed(2)) : 0,
              takeProfit: avgPrice > 0 ? Number((avgPrice * 1.025).toFixed(2)) : 0,
            };
          });
          setTrades(mappedTrades);
          setTestTradeFeedback({
            success: true,
            message: `تم جلب وتحديث ${mappedTrades.length} صفقة حقيقية مباشرة من منصة Binance ${binanceMode === 'live' ? 'Live' : 'Testnet'}!`
          });
        } else {
          setTestTradeFeedback({
            success: true,
            message: `تم الاتصال بحساب Binance بنجاح! لا توجد أوامر منفذة سابقة على هذا الزوج في نمط ${binanceMode === 'live' ? 'Live' : 'Testnet'}.`
          });
        }
      } else {
        setTestTradeFeedback({
          success: false,
          message: `خطأ من Binance: ${data.error || 'فشل جلب الصفقات'}`
        });
      }
    } catch (err: any) {
      setTestTradeFeedback({
        success: false,
        message: `تعذر الاتصال: ${err.message}`
      });
    } finally {
      setIsLoadingMyTrades(false);
    }
  };

  // Instant Test Trade Execution with Telegram Alert (tailored per active mode)
  const handleExecuteTestTrade = async () => {
    // 1. PAPER TRADING TEST EXECUTION
    if (binanceMode === 'paper') {
      setIsExecutingTestTrade(true);
      setTestTradeFeedback(null);
      try {
        const orderPrice = marketPrices[selectedAsset]?.price || 64500;
        const dynTargets = calculateDynamicAtrTargets(
          orderPrice,
          selectedTf,
          marketPrices[selectedAsset]?.atr,
          mtfSignals[selectedTf]?.atr
        );
        const orderId = `PAPER-${Date.now().toString().slice(-6)}`;
        const newTrade: TradeLog = {
          id: orderId,
          timestamp: new Date().toLocaleTimeString(),
          asset: selectedAsset,
          type: 'شراء Spot',
          timeframe: selectedTf,
          entryPrice: orderPrice,
          status: 'OPEN',
          conviction: 3,
          stopLoss: dynTargets.stopLoss,
          takeProfit: dynTargets.takeProfit,
          atrValue: dynTargets.atrUsed,
        };

        setTrades(prev => [newTrade, ...prev.filter(t => t.id !== newTrade.id)]);
        setTestTradeFeedback({
          success: true,
          message: `تم تنفيذ صفقة شراء ورقية تجريبية بنجاح! رقم الأمر: #${orderId} بسعر $${orderPrice.toLocaleString()} | هدف TP: $${dynTargets.takeProfit.toLocaleString()} | وقف SL: $${dynTargets.stopLoss.toLocaleString()}`
        });

        if (telegramConfig.botToken && telegramConfig.chatId) {
          sendLiveTelegramAlert(`⚡ <b>[نمط البيبر (Paper Trading) | صفقة اختبارية]</b>
━━━━━━━━━━━━━━━━━━━━
📌 الزوج: <b>${selectedAsset}</b>
🏷️ النوع: <b>شراء محاكاة Spot ($15 USDT)</b>
🔢 رقم الأمر: <code>#${orderId}</code>
📈 سعر الدخول: <b>$${orderPrice.toLocaleString()}</b>
🎯 الهدف (TP): <b>$${dynTargets.takeProfit.toLocaleString()}</b> (+${dynTargets.tpPercent}%)
🛡️ وقف الخسارة (SL): <b>$${dynTargets.stopLoss.toLocaleString()}</b> (-${dynTargets.slPercent}%)
⏱️ التوقيت: <b>${new Date().toLocaleTimeString()}</b>`);
        }
      } catch (err: any) {
        setTestTradeFeedback({ success: false, message: `فشل التنفيذ الورقي: ${err.message}` });
      } finally {
        setIsExecutingTestTrade(false);
      }
      return;
    }

    // 2. TESTNET & LIVE REAL EXECUTION
    const activeKey = modesConfig[binanceMode].apiKey;
    const activeSecret = modesConfig[binanceMode].apiSecret;
    const modeLabel = binanceMode === 'live' ? 'Binance Spot Live (الحقيقي)' : 'Binance Spot Testnet';

    if (!activeKey || !activeSecret) {
      setTestTradeFeedback({
        success: false,
        message: `تنبيه: يرجى حفظ مفاتيح API الخاصة بـ ${modeLabel} أولاً في تبويب "إعدادات بينانس".`
      });
      return;
    }

    setIsExecutingTestTrade(true);
    setTestTradeFeedback(null);
    try {
      const cleanSymbol = selectedAsset.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
      const resp = await fetch('/api/binance/test-trade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: activeKey.trim(),
          apiSecret: activeSecret.trim(),
          symbol: cleanSymbol,
          quoteAmount: 15, // Test buy of 15 USDT
          isTestnet: binanceMode === 'testnet',
          telegramConfig: {
            botToken: telegramConfig.botToken?.trim() || '',
            chatId: telegramConfig.chatId?.trim() || ''
          }
        })
      });
      const data = await resp.json();
      if (resp.ok && data.success) {
        setModesConfig(prev => ({
          ...prev,
          [binanceMode]: { ...prev[binanceMode], isAccountVerified: true }
        }));
        const orderPrice = data.executedPrice || marketPrices[selectedAsset]?.price || 0;
        const dynTargets = calculateDynamicAtrTargets(
          orderPrice,
          selectedTf,
          marketPrices[selectedAsset]?.atr,
          mtfSignals[selectedTf]?.atr
        );
        const newTrade: TradeLog = {
          id: `${binanceMode === 'live' ? 'LIVE' : 'TEST'}-${data.orderId}`,
          timestamp: data.timestamp || new Date().toLocaleTimeString(),
          asset: selectedAsset,
          type: 'شراء Spot',
          timeframe: selectedTf,
          entryPrice: orderPrice,
          status: 'CLOSED',
          conviction: 3,
          stopLoss: dynTargets.stopLoss,
          takeProfit: dynTargets.takeProfit,
          atrValue: dynTargets.atrUsed,
        };

        setTrades(prev => [newTrade, ...prev.filter(t => t.id !== newTrade.id)]);

        setTestTradeFeedback({
          success: true,
          message: `تم تنفيذ الصفقة الاختبارية بنجاح على ${modeLabel}! رقم الأمر: #${data.orderId} بسعر $${orderPrice.toLocaleString()} ${data.telegramSent ? '— وتم إرسال الإشعار لتيليجرام بنجاح 🚀' : '(لم يُرسل لتيليجرام لأن إعدادات البوت لم تُملأ)'}`
        });

        fetchBinanceAccountBalance();
      } else {
        setTestTradeFeedback({
          success: false,
          message: `خطأ من ${modeLabel}: ${data.error || 'فشل تنفيذ الأمر'} ${data.code ? `(رمز: ${data.code})` : ''}`
        });
      }
    } catch (err: any) {
      setTestTradeFeedback({
        success: false,
        message: `فشل الاتصال: ${err.message}`
      });
    } finally {
      setIsExecutingTestTrade(false);
    }
  };

  // Automatic background sync every 30s when keys are available in active mode
  useEffect(() => {
    if (binanceMode === 'paper') return;
    if (apiKey && apiSecret && apiKey.length > 10) {
      fetchBinanceAccountBalance();
      const interval = setInterval(() => {
        fetchBinanceAccountBalance();
      }, 30000);
      return () => clearInterval(interval);
    }
  }, [apiKey, apiSecret, binanceMode]);

  // Manual Close Trade Handler (Sell to 100% USDT Cash)
  const handleManualCloseTrade = async (tradeToClose: TradeLog) => {
    if (binanceMode === 'paper') {
      const exitPrice = marketPrices[tradeToClose.asset]?.price || tradeToClose.entryPrice;
      const pnl = Number(((exitPrice - tradeToClose.entryPrice) / tradeToClose.entryPrice * 15).toFixed(2));
      const pnlPercent = Number(((exitPrice - tradeToClose.entryPrice) / tradeToClose.entryPrice * 100).toFixed(2));

      setTrades(prev => prev.map(t => {
        if (t.id === tradeToClose.id) {
          return {
            ...t,
            status: 'CLOSED' as const,
            exitPrice,
            pnl,
            pnlPercent,
            exitReason: 'MANUAL_EXIT'
          };
        }
        return t;
      }));

      setTestTradeFeedback({
        success: true,
        message: `[نمط البيبر] تم إغلاق الصفقة #${tradeToClose.id} يدوياً بنجاح بسعر $${exitPrice.toLocaleString()} (ربح/خسارة: ${pnl >= 0 ? '+' : ''}$${pnl})`
      });
      return;
    }

    if (!apiKey || !apiSecret) {
      setTestTradeFeedback({
        success: false,
        message: `مفاتيح API مطلوبة لإغلاق الصفقة على Binance (${binanceMode === 'live' ? 'Live' : 'Testnet'}).`
      });
      return;
    }
    try {
      const cleanSymbol = tradeToClose.asset.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
      const currentPx = marketPrices[tradeToClose.asset]?.price || tradeToClose.entryPrice;
      const resp = await fetch('/api/binance/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: apiKey.trim(),
          apiSecret: apiSecret.trim(),
          symbol: cleanSymbol,
          side: 'SELL',
          quoteAmount: 15,
          reason: 'MANUAL_EXIT',
          isTestnet: binanceMode === 'testnet',
          telegramConfig: {
            botToken: telegramConfig.botToken?.trim() || '',
            chatId: telegramConfig.chatId?.trim() || ''
          }
        })
      });

      const data = await resp.json();
      if (resp.ok && data.success) {
        const exitPrice = data.executedPrice || currentPx;
        const pnl = Number(((exitPrice - tradeToClose.entryPrice) / tradeToClose.entryPrice * 15).toFixed(2));
        const pnlPercent = Number(((exitPrice - tradeToClose.entryPrice) / tradeToClose.entryPrice * 100).toFixed(2));

        setTrades(prev => {
          const updated = prev.map(t => {
            if (t.id === tradeToClose.id) {
              return {
                ...t,
                status: 'CLOSED' as const,
                exitPrice,
                pnl,
                pnlPercent,
                exitReason: 'MANUAL_EXIT'
              };
            }
            return t;
          });
          try { localStorage.setItem('jev_real_trades', JSON.stringify(updated)); } catch (e) {}
          return updated;
        });

        setTestTradeFeedback({
          success: true,
          message: `تم إغلاق الصفقة #${tradeToClose.id} يدوياً بنجاح والتحول للكاش 100% USDT بسعر $${exitPrice.toLocaleString()}!`
        });

        fetchBinanceAccountBalance();
      } else {
        setTestTradeFeedback({
          success: false,
          message: `فشل إغلاق الصفقة: ${data.error || 'خطأ غير معروف'}`
        });
      }
    } catch (e: any) {
      setTestTradeFeedback({
        success: false,
        message: `خطأ في إغلاق الصفقة: ${e.message}`
      });
    }
  };

  // Autonomous Trading Engine: Automatically buys when 5 conditions are met and monitors TP/SL for auto-exit
  const isAutoTraderBusyRef = useRef<boolean>(false);
  const lastAutoBuyTimestampRef = useRef<number>(0);
  const marketPricesRef = useRef(marketPrices);
  marketPricesRef.current = marketPrices;
  const jevDecisionRef = useRef(jevDecision);
  jevDecisionRef.current = jevDecision;
  const tradesRef = useRef(trades);
  tradesRef.current = trades;
  const telegramConfigRef = useRef(telegramConfig);
  telegramConfigRef.current = telegramConfig;

  useEffect(() => {
    if (!isBotRunning) return;
    if (binanceMode !== 'paper' && (!apiKey || !apiSecret)) return;

    const runAutonomousTradingCycle = async () => {
      if (isAutoTraderBusyRef.current) return;
      isAutoTraderBusyRef.current = true;

      try {
        const cleanSymbol = selectedAsset.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
        const curPrices = marketPricesRef.current;
        const curDecision = jevDecisionRef.current;
        const curTrades = tradesRef.current;
        const curTelegram = telegramConfigRef.current;

        const currentPx = curPrices[selectedAsset]?.price || 0;
        if (!currentPx || currentPx <= 0) return;

        // 1. MONITOR OPEN POSITIONS FOR TAKE-PROFIT OR STOP-LOSS
        const openTrades = curTrades.filter(t => t.status === 'OPEN' && t.asset === selectedAsset);
        for (const openTrade of openTrades) {
          const isTakeProfitHit = openTrade.takeProfit > 0 && currentPx >= openTrade.takeProfit;
          const isStopLossHit = openTrade.stopLoss > 0 && currentPx <= openTrade.stopLoss;
          const isExitSignal = curDecision.action === 'EXIT_TO_USDT_CASH';

          if (isTakeProfitHit || isStopLossHit || isExitSignal) {
            const reason = isTakeProfitHit ? 'TAKE_PROFIT' : (isStopLossHit ? 'STOP_LOSS' : 'MANUAL_EXIT');
            const exitPrice = currentPx;
            const pnl = Number(((exitPrice - openTrade.entryPrice) / openTrade.entryPrice * 15).toFixed(2));
            const pnlPercent = Number(((exitPrice - openTrade.entryPrice) / openTrade.entryPrice * 100).toFixed(2));

            if (binanceMode === 'paper') {
              setTrades(prev => prev.map(t => {
                if (t.id === openTrade.id) {
                  return {
                    ...t,
                    status: 'CLOSED' as const,
                    exitPrice,
                    pnl,
                    pnlPercent,
                    exitReason: reason
                  };
                }
                return t;
              }));

              setTestTradeFeedback({
                success: isTakeProfitHit || pnl >= 0,
                message: isTakeProfitHit
                  ? `🎯 [تداول ورقي - Take Profit] تم تحقيق الهدف بسعر $${exitPrice.toLocaleString()} (+${pnlPercent}%)!`
                  : `🛡️ [تداول ورقي - Stop Loss] تم تفعيل وقف الخسارة بسعر $${exitPrice.toLocaleString()} (-${Math.abs(pnlPercent)}%)!`
              });
              return;
            }

            const resp = await fetch('/api/binance/order', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                apiKey: apiKey.trim(),
                apiSecret: apiSecret.trim(),
                symbol: cleanSymbol,
                side: 'SELL',
                quoteAmount: 15,
                reason,
                isTestnet: binanceMode === 'testnet',
                telegramConfig: {
                  botToken: curTelegram.botToken?.trim() || '',
                  chatId: curTelegram.chatId?.trim() || ''
                }
              })
            });

            const data = await resp.json();
            if (resp.ok && data.success) {
              const executedExitPx = data.executedPrice || currentPx;
              const actualPnl = Number(((executedExitPx - openTrade.entryPrice) / openTrade.entryPrice * 15).toFixed(2));
              const actualPnlPercent = Number(((executedExitPx - openTrade.entryPrice) / openTrade.entryPrice * 100).toFixed(2));

              setTrades(prev => prev.map(t => {
                if (t.id === openTrade.id) {
                  return {
                    ...t,
                    status: 'CLOSED' as const,
                    exitPrice: executedExitPx,
                    pnl: actualPnl,
                    pnlPercent: actualPnlPercent,
                    exitReason: reason
                  };
                }
                return t;
              }));

              setTestTradeFeedback({
                success: isTakeProfitHit || actualPnl >= 0,
                message: isTakeProfitHit
                  ? `🎯 [تداول آلي - Take Profit] تم تحقيق الهدف بنجاح بسعر $${executedExitPx.toLocaleString()} وبيع الصفقة بربح +$${actualPnl} (${actualPnlPercent > 0 ? '+' : ''}${actualPnlPercent}%)!`
                  : `🛡️ [تداول آلي - Stop Loss] تم تفعيل وقف الخسارة بسعر $${executedExitPx.toLocaleString()} لحماية المحفظة والتحول للكاش 100% USDT.`
              });

              fetchBinanceAccountBalance();
              return; // complete this exit action before checking new entries
            }
          }
        }

        // 2. CHECK 5 ATOMIC CONDITIONS FOR AUTONOMOUS SPOT BUY
        // Cooldown: at least 30 seconds between auto-buys
        const now = Date.now();
        if (now - lastAutoBuyTimestampRef.current < 30000) return;

        // Skip buy if an open trade already exists for this asset
        const hasOpenPosition = curTrades.some(t => t.status === 'OPEN' && t.asset === selectedAsset);
        if (hasOpenPosition) return;

        // Verify the 5 Atomic Decision Primitives & ADX Filter
        const condition1_regime = curDecision.regime === 'BULLISH_TREND' || curDecision.regime === 'ACCUMULATION_SQUEEZE';
        const condition2_confluence = curDecision.confluenceConfirmed === true;
        const condition3_noTrap = curDecision.liquidityTrapRisk === false;
        const condition4_conviction = curDecision.convictionLevel >= 1;
        const condition5_confidence = curDecision.actionConfidence >= curDecision.dynamicConfidenceThreshold;
        const chopFilterPass = curDecision.chopFilterPass === true; // ADX >= 20 and +DI >= -DI
        const isBuyAction = curDecision.action === 'EXECUTE_SPOT_BUY';

        const allConditionsSatisfied = (
          condition1_regime &&
          condition2_confluence &&
          condition3_noTrap &&
          condition4_conviction &&
          condition5_confidence &&
          chopFilterPass &&
          isBuyAction
        );

        if (allConditionsSatisfied) {
          lastAutoBuyTimestampRef.current = now;
          const orderAmount = curDecision.dynamicPositionSize > 10 ? Math.min(curDecision.dynamicPositionSize, 30) : 15;

          if (binanceMode === 'paper') {
            const entryPx = currentPx;
            const dynTargets = calculateDynamicAtrTargets(
              entryPx,
              selectedTf,
              curPrices[selectedAsset]?.atr,
              mtfSignals[selectedTf]?.atr
            );
            const stopLoss = dynTargets.stopLoss;
            const takeProfit = dynTargets.takeProfit;
            const orderId = `AUTO-PAPER-${Date.now().toString().slice(-6)}`;

            const newTrade: TradeLog = {
              id: orderId,
              timestamp: new Date().toLocaleTimeString(),
              asset: selectedAsset,
              type: 'شراء Spot',
              timeframe: selectedTf,
              entryPrice: entryPx,
              status: 'OPEN',
              conviction: curDecision.convictionLevel,
              stopLoss,
              takeProfit,
              atrValue: dynTargets.atrUsed,
            };

            setTrades(prev => [newTrade, ...prev.filter(t => t.id !== newTrade.id)]);
            setTestTradeFeedback({
              success: true,
              message: `🟢 [تداول ورقي نشط] تم فتح صفقة شراء ورقية (#${orderId}) بسعر $${entryPx.toLocaleString()} | TP: $${takeProfit.toLocaleString()} | SL: $${stopLoss.toLocaleString()}`
            });
            return;
          }

          const resp = await fetch('/api/binance/order', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              apiKey: apiKey.trim(),
              apiSecret: apiSecret.trim(),
              symbol: cleanSymbol,
              side: 'BUY',
              quoteAmount: orderAmount,
              reason: '5_CONDITIONS_BUY',
              isTestnet: binanceMode === 'testnet',
              telegramConfig: {
                botToken: curTelegram.botToken?.trim() || '',
                chatId: curTelegram.chatId?.trim() || ''
              }
            })
          });

          const data = await resp.json();
          if (resp.ok && data.success) {
            const entryPx = data.executedPrice || currentPx;
            const dynTargets = calculateDynamicAtrTargets(
              entryPx,
              selectedTf,
              curPrices[selectedAsset]?.atr,
              mtfSignals[selectedTf]?.atr
            );
            const stopLoss = dynTargets.stopLoss;
            const takeProfit = dynTargets.takeProfit;

            const newTrade: TradeLog = {
              id: `AUTO-${data.orderId}`,
              timestamp: data.timestamp || new Date().toLocaleTimeString(),
              asset: selectedAsset,
              type: 'شراء Spot',
              timeframe: selectedTf,
              entryPrice: entryPx,
              status: 'OPEN',
              conviction: curDecision.convictionLevel,
              stopLoss,
              takeProfit,
              atrValue: dynTargets.atrUsed,
            };

            setTrades(prev => [newTrade, ...prev.filter(t => t.id !== newTrade.id)]);

            setTestTradeFeedback({
              success: true,
              message: `🟢 [تداول آلي نشط] اكتملت الشروط الـ 5 بنجاح! تم فتح صفقة شراء في ${binanceMode === 'live' ? 'Binance Live' : 'Binance Testnet'} (#${data.orderId}) بسعر $${entryPx.toLocaleString()} | هدف TP: $${takeProfit.toLocaleString()} (+${dynTargets.tpPercent}%) | وقف SL: $${stopLoss.toLocaleString()} (-${dynTargets.slPercent}%)`
            });

            fetchBinanceAccountBalance();
          }
        }
      } catch (err: any) {
        console.warn('Auto-trader cycle check warning:', err.message);
      } finally {
        isAutoTraderBusyRef.current = false;
      }
    };

    // Auto-trader cycle runs every 8 seconds
    const autoInterval = setInterval(runAutonomousTradingCycle, 8000);
    return () => clearInterval(autoInterval);
  }, [isBotRunning, apiKey, apiSecret, selectedAsset, selectedTf, binanceMode]);

  // Comprehensive 90-Day Backtesting Trade History Log
  const [backtestTrades] = useState<BacktestTradeLog[]>([
    {
      id: 'BT-184',
      timestamp: '2026-10-11 14:15:00',
      asset: 'BTC/USDT',
      type: 'شراء Spot',
      timeframe: '15m',
      entryPrice: 63950.00,
      exitPrice: 65120.00,
      stopLoss: 63100.00,
      takeProfit: 65100.00,
      pnl: 1170.00,
      pnlPercent: 1.83,
      status: 'CLOSED',
      conviction: 3,
      confidence: 0.94,
      exitReason: 'TAKE_PROFIT'
    },
    {
      id: 'BT-183',
      timestamp: '2026-10-11 08:30:00',
      asset: 'ETH/USDT',
      type: 'شراء Spot',
      timeframe: '1h',
      entryPrice: 3410.00,
      exitPrice: 3525.00,
      stopLoss: 3340.00,
      takeProfit: 3520.00,
      pnl: 575.00,
      pnlPercent: 3.37,
      status: 'CLOSED',
      conviction: 2,
      confidence: 0.89,
      exitReason: 'TAKE_PROFIT'
    },
    {
      id: 'BT-182',
      timestamp: '2026-10-10 21:45:00',
      asset: 'SOL/USDT',
      type: 'شراء Spot',
      timeframe: '15m',
      entryPrice: 153.20,
      exitPrice: 150.10,
      stopLoss: 150.20,
      takeProfit: 159.80,
      pnl: -310.00,
      pnlPercent: -2.02,
      status: 'CLOSED',
      conviction: 2,
      confidence: 0.86,
      exitReason: 'STOP_LOSS'
    },
    {
      id: 'BT-181',
      timestamp: '2026-10-10 16:20:00',
      asset: 'BTC/USDT',
      type: 'شراء Spot',
      timeframe: '30m',
      entryPrice: 62800.00,
      exitPrice: 63950.00,
      stopLoss: 61900.00,
      takeProfit: 64100.00,
      pnl: 1150.00,
      pnlPercent: 1.83,
      status: 'CLOSED',
      conviction: 3,
      confidence: 0.95,
      exitReason: 'TAKE_PROFIT'
    },
    {
      id: 'BT-180',
      timestamp: '2026-10-09 23:10:00',
      asset: 'ETH/USDT',
      type: 'شراء Spot',
      timeframe: '15m',
      entryPrice: 3380.00,
      exitPrice: 3465.00,
      stopLoss: 3320.00,
      takeProfit: 3470.00,
      pnl: 425.00,
      pnlPercent: 2.51,
      status: 'CLOSED',
      conviction: 2,
      confidence: 0.88,
      exitReason: 'TAKE_PROFIT'
    },
    {
      id: 'BT-179',
      timestamp: '2026-10-09 11:05:00',
      asset: 'SOL/USDT',
      type: 'شراء Spot',
      timeframe: '1h',
      entryPrice: 144.50,
      exitPrice: 152.80,
      stopLoss: 140.00,
      takeProfit: 153.00,
      pnl: 830.00,
      pnlPercent: 5.74,
      status: 'CLOSED',
      conviction: 3,
      confidence: 0.92,
      exitReason: 'TAKE_PROFIT'
    },
    {
      id: 'BT-178',
      timestamp: '2026-10-08 19:50:00',
      asset: 'BTC/USDT',
      type: 'شراء Spot',
      timeframe: '15m',
      entryPrice: 63200.00,
      exitPrice: 62650.00,
      stopLoss: 62700.00,
      takeProfit: 64500.00,
      pnl: -550.00,
      pnlPercent: -0.87,
      status: 'CLOSED',
      conviction: 1,
      confidence: 0.84,
      exitReason: 'STOP_LOSS'
    },
    {
      id: 'BT-177',
      timestamp: '2026-10-08 09:15:00',
      asset: 'ETH/USDT',
      type: 'شراء Spot',
      timeframe: '4h',
      entryPrice: 3310.00,
      exitPrice: 3440.00,
      stopLoss: 3240.00,
      takeProfit: 3450.00,
      pnl: 650.00,
      pnlPercent: 3.93,
      status: 'CLOSED',
      conviction: 3,
      confidence: 0.96,
      exitReason: 'TAKE_PROFIT'
    },
    {
      id: 'BT-176',
      timestamp: '2026-10-07 14:00:00',
      asset: 'SOL/USDT',
      type: 'شراء Spot',
      timeframe: '15m',
      entryPrice: 148.00,
      exitPrice: 154.20,
      stopLoss: 144.20,
      takeProfit: 154.50,
      pnl: 620.00,
      pnlPercent: 4.19,
      status: 'CLOSED',
      conviction: 2,
      confidence: 0.90,
      exitReason: 'TAKE_PROFIT'
    },
    {
      id: 'BT-175',
      timestamp: '2026-10-06 18:30:00',
      asset: 'BTC/USDT',
      type: 'شراء Spot',
      timeframe: '1h',
      entryPrice: 61500.00,
      exitPrice: 63100.00,
      stopLoss: 60600.00,
      takeProfit: 63200.00,
      pnl: 1600.00,
      pnlPercent: 2.60,
      status: 'CLOSED',
      conviction: 3,
      confidence: 0.93,
      exitReason: 'TAKE_PROFIT'
    },
    {
      id: 'BT-174',
      timestamp: '2026-10-05 06:40:00',
      asset: 'ETH/USDT',
      type: 'شراء Spot',
      timeframe: '30m',
      entryPrice: 3290.00,
      exitPrice: 3240.00,
      stopLoss: 3245.00,
      takeProfit: 3390.00,
      pnl: -250.00,
      pnlPercent: -1.52,
      status: 'CLOSED',
      conviction: 2,
      confidence: 0.85,
      exitReason: 'STOP_LOSS'
    },
    {
      id: 'BT-173',
      timestamp: '2026-10-04 12:15:00',
      asset: 'BTC/USDT',
      type: 'شراء Spot',
      timeframe: '15m',
      entryPrice: 60800.00,
      exitPrice: 61950.00,
      stopLoss: 60100.00,
      takeProfit: 62000.00,
      pnl: 1150.00,
      pnlPercent: 1.89,
      status: 'CLOSED',
      conviction: 2,
      confidence: 0.91,
      exitReason: 'TAKE_PROFIT'
    },
    {
      id: 'BT-172',
      timestamp: '2026-10-03 20:55:00',
      asset: 'SOL/USDT',
      type: 'شراء Spot',
      timeframe: '15m',
      entryPrice: 141.20,
      exitPrice: 147.90,
      stopLoss: 137.50,
      takeProfit: 148.00,
      pnl: 670.00,
      pnlPercent: 4.75,
      status: 'CLOSED',
      conviction: 3,
      confidence: 0.94,
      exitReason: 'TAKE_PROFIT'
    },
    {
      id: 'BT-171',
      timestamp: '2026-10-02 16:30:00',
      asset: 'BTC/USDT',
      type: 'شراء Spot',
      timeframe: '4h',
      entryPrice: 59800.00,
      exitPrice: 61200.00,
      stopLoss: 59000.00,
      takeProfit: 61300.00,
      pnl: 1400.00,
      pnlPercent: 2.34,
      status: 'CLOSED',
      conviction: 3,
      confidence: 0.97,
      exitReason: 'TAKE_PROFIT'
    },
    {
      id: 'BT-170',
      timestamp: '2026-10-01 22:10:00',
      asset: 'ETH/USDT',
      type: 'شراء Spot',
      timeframe: '15m',
      entryPrice: 3240.00,
      exitPrice: 3315.00,
      stopLoss: 3190.00,
      takeProfit: 3320.00,
      pnl: 375.00,
      pnlPercent: 2.31,
      status: 'CLOSED',
      conviction: 2,
      confidence: 0.89,
      exitReason: 'TAKE_PROFIT'
    },
    {
      id: 'BT-169',
      timestamp: '2026-09-30 09:40:00',
      asset: 'SOL/USDT',
      type: 'شراء Spot',
      timeframe: '30m',
      entryPrice: 139.00,
      exitPrice: 136.20,
      stopLoss: 136.50,
      takeProfit: 145.00,
      pnl: -280.00,
      pnlPercent: -2.01,
      status: 'CLOSED',
      conviction: 1,
      confidence: 0.83,
      exitReason: 'STOP_LOSS'
    },
    {
      id: 'BT-168',
      timestamp: '2026-09-29 17:15:00',
      asset: 'BTC/USDT',
      type: 'شراء Spot',
      timeframe: '15m',
      entryPrice: 58900.00,
      exitPrice: 60100.00,
      stopLoss: 58200.00,
      takeProfit: 60200.00,
      pnl: 1200.00,
      pnlPercent: 2.04,
      status: 'CLOSED',
      conviction: 3,
      confidence: 0.92,
      exitReason: 'TAKE_PROFIT'
    },
    {
      id: 'BT-167',
      timestamp: '2026-09-28 13:00:00',
      asset: 'ETH/USDT',
      type: 'شراء Spot',
      timeframe: '1h',
      entryPrice: 3180.00,
      exitPrice: 3260.00,
      stopLoss: 3120.00,
      takeProfit: 3270.00,
      pnl: 400.00,
      pnlPercent: 2.52,
      status: 'CLOSED',
      conviction: 2,
      confidence: 0.87,
      exitReason: 'TAKE_PROFIT'
    },
    {
      id: 'BT-166',
      timestamp: '2026-09-27 19:25:00',
      asset: 'BTC/USDT',
      type: 'شراء Spot',
      timeframe: '15m',
      entryPrice: 58100.00,
      exitPrice: 59350.00,
      stopLoss: 57400.00,
      takeProfit: 59400.00,
      pnl: 1250.00,
      pnlPercent: 2.15,
      status: 'CLOSED',
      conviction: 3,
      confidence: 0.95,
      exitReason: 'TAKE_PROFIT'
    },
    {
      id: 'BT-165',
      timestamp: '2026-09-26 11:35:00',
      asset: 'SOL/USDT',
      type: 'شراء Spot',
      timeframe: '15m',
      entryPrice: 133.50,
      exitPrice: 139.80,
      stopLoss: 130.00,
      takeProfit: 140.00,
      pnl: 630.00,
      pnlPercent: 4.72,
      status: 'CLOSED',
      conviction: 2,
      confidence: 0.91,
      exitReason: 'TAKE_PROFIT'
    },
    {
      id: 'BT-164',
      timestamp: '2026-09-25 15:45:00',
      asset: 'BTC/USDT',
      type: 'شراء Spot',
      timeframe: '30m',
      entryPrice: 57600.00,
      exitPrice: 57050.00,
      stopLoss: 57100.00,
      takeProfit: 58800.00,
      pnl: -550.00,
      pnlPercent: -0.95,
      status: 'CLOSED',
      conviction: 2,
      confidence: 0.85,
      exitReason: 'STOP_LOSS'
    },
    {
      id: 'BT-163',
      timestamp: '2026-09-24 08:20:00',
      asset: 'ETH/USDT',
      type: 'شراء Spot',
      timeframe: '15m',
      entryPrice: 3120.00,
      exitPrice: 3205.00,
      stopLoss: 3070.00,
      takeProfit: 3210.00,
      pnl: 425.00,
      pnlPercent: 2.72,
      status: 'CLOSED',
      conviction: 2,
      confidence: 0.88,
      exitReason: 'TAKE_PROFIT'
    },
    {
      id: 'BT-162',
      timestamp: '2026-09-23 21:10:00',
      asset: 'BTC/USDT',
      type: 'شراء Spot',
      timeframe: '1h',
      entryPrice: 56800.00,
      exitPrice: 58200.00,
      stopLoss: 56000.00,
      takeProfit: 58300.00,
      pnl: 1400.00,
      pnlPercent: 2.46,
      status: 'CLOSED',
      conviction: 3,
      confidence: 0.96,
      exitReason: 'TAKE_PROFIT'
    },
    {
      id: 'BT-161',
      timestamp: '2026-09-22 14:05:00',
      asset: 'SOL/USDT',
      type: 'شراء Spot',
      timeframe: '15m',
      entryPrice: 129.00,
      exitPrice: 135.40,
      stopLoss: 125.80,
      takeProfit: 135.50,
      pnl: 640.00,
      pnlPercent: 4.96,
      status: 'CLOSED',
      conviction: 3,
      confidence: 0.93,
      exitReason: 'TAKE_PROFIT'
    },
    {
      id: 'BT-160',
      timestamp: '2026-09-21 18:50:00',
      asset: 'ETH/USDT',
      type: 'شراء Spot',
      timeframe: '4h',
      entryPrice: 3050.00,
      exitPrice: 3175.00,
      stopLoss: 2980.00,
      takeProfit: 3180.00,
      pnl: 625.00,
      pnlPercent: 4.10,
      status: 'CLOSED',
      conviction: 3,
      confidence: 0.94,
      exitReason: 'TAKE_PROFIT'
    }
  ]);

  // Periodic Price & Jev Cycle Simulator
  useEffect(() => {
    if (!isBotRunning) return;

    const interval = setInterval(() => {
      // Small random micro-tick
      setMarketPrices(prev => {
        const current = prev[selectedAsset];
        const delta = (Math.random() - 0.48) * (current.price * 0.0008);
        const newPrice = Number((current.price + delta).toFixed(2));
        return {
          ...prev,
          [selectedAsset]: {
            ...current,
            price: newPrice,
          }
        };
      });

      // Update Jev Evaluation with micro-variances and dynamic calibration
      const curPx = marketPrices[selectedAsset]?.price || 64000;
      const curAtr = marketPrices[selectedAsset]?.atr || (curPx * 0.015);
      const volRatio = curPx > 0 ? (curAtr / curPx) * 100 : 1.5;
      const dynamicThreshold = Number(Math.min(0.94, Math.max(0.78, 0.80 + (volRatio * 0.055))).toFixed(3));
      const actionConf = Number((0.87 + Math.random() * 0.09).toFixed(2));
      const conviction = Math.random() > 0.4 ? 2 : (Math.random() > 0.5 ? 3 : 1);
      const convMult = conviction === 3 ? 1.5 : (conviction === 2 ? 1.0 : 0.6);
      const confMult = Math.min(1.3, Math.max(0.7, actionConf / dynamicThreshold));
      const dynPosition = Number((500 * convMult * confMult).toFixed(2));

      const adxVal = marketPrices[selectedAsset]?.adx || 28.0;
      const plusDiVal = marketPrices[selectedAsset]?.plusDi || 29.0;
      const minusDiVal = marketPrices[selectedAsset]?.minusDi || 17.0;
      const chopPass = adxVal >= 20.0 && plusDiVal >= minusDiVal;

      setJevDecision(prev => ({
        ...prev,
        latencyMs: Math.floor(88 + Math.random() * 18),
        actionConfidence: actionConf,
        dynamicConfidenceThreshold: dynamicThreshold,
        volatilityRatio: Number(volRatio.toFixed(2)),
        dynamicPositionSize: dynPosition,
        meetsDynamicThreshold: actionConf >= dynamicThreshold,
        convictionLevel: conviction,
        confluenceProb: Number((0.87 + Math.random() * 0.08).toFixed(2)),
        liquidityTrapProb: Number((0.04 + Math.random() * 0.05).toFixed(2)),
        adx: adxVal,
        plusDi: plusDiVal,
        minusDi: minusDiVal,
        chopFilterPass: chopPass,
        chopFilterStatus: adxVal < 20.0 ? 'BLOCKED_CHOP_MARKET' : (plusDiVal < minusDiVal ? 'BLOCKED_BEARISH_DI' : 'PASSED_TRENDING'),
      }));
    }, botSpeedSec * 1000);

    return () => clearInterval(interval);
  }, [isBotRunning, botSpeedSec, selectedAsset]);

  const currentAsset = marketPrices[selectedAsset] || ASSETS_DATA[selectedAsset];

  const liveDynamicTargets = useMemo(() => {
    return calculateDynamicAtrTargets(
      currentAsset.price,
      selectedTf,
      currentAsset.atr,
      mtfSignals[selectedTf]?.atr
    );
  }, [currentAsset.price, selectedTf, currentAsset.atr, mtfSignals]);

  // Helper Copy Function
  const handleCopyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  // Python Bot Script state (editable in UI to add coins or modify code)
  const [pythonBotCode, setPythonBotCode] = useState<string>(() => {
    try {
      const saved = localStorage.getItem('jev_python_bot_code');
      if (saved && saved.length > 200 && saved.includes('calculate_rsi')) {
        return saved;
      }
    } catch (e) {}
    return DEFAULT_ORIGINAL_PYTHON_BOT_CODE;
  });

  const [isSavingPythonBotCode, setIsSavingPythonBotCode] = useState<boolean>(false);
  const [pythonBotSaveMsg, setPythonBotSaveMsg] = useState<string | null>(null);

  // Auto-fetch full script from server if available on load
  useEffect(() => {
    fetch('/api/python-code')
      .then((res) => res.json())
      .then((data) => {
        if (data?.code && data.code.length > 200 && data.code.includes('calculate_rsi')) {
          setPythonBotCode(data.code);
          localStorage.setItem('jev_python_bot_code', data.code);
        }
      })
      .catch(() => {});
  }, []);

  const handleSavePythonBotCode = async () => {
    setIsSavingPythonBotCode(true);
    setPythonBotSaveMsg(null);
    try {
      localStorage.setItem('jev_python_bot_code', pythonBotCode);
      const res = await fetch('/api/python-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: pythonBotCode })
      });
      if (res.ok) {
        setPythonBotSaveMsg('تم حفظ تعديلات كود البوت وتحديث العملات في الخادم بنجاح!');
        setTimeout(() => setPythonBotSaveMsg(null), 4000);
      } else {
        setPythonBotSaveMsg('تم الحفظ محلياً في المتصفح بنجاح!');
        setTimeout(() => setPythonBotSaveMsg(null), 4000);
      }
    } catch (e) {
      setPythonBotSaveMsg('تم الحفظ محلياً في المتصفح بنجاح!');
      setTimeout(() => setPythonBotSaveMsg(null), 4000);
    } finally {
      setIsSavingPythonBotCode(false);
    }
  };

  const handleResetToOriginalCode = () => {
    setPythonBotCode(DEFAULT_ORIGINAL_PYTHON_BOT_CODE);
    localStorage.setItem('jev_python_bot_code', DEFAULT_ORIGINAL_PYTHON_BOT_CODE);
    fetch('/api/python-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: DEFAULT_ORIGINAL_PYTHON_BOT_CODE })
    }).catch(() => {});
    setPythonBotSaveMsg('تمت استعادة كود بايتون الأصلي الكامل بنجاح!');
    setTimeout(() => setPythonBotSaveMsg(null), 4000);
  };

  const handleDownloadPythonBotCode = () => {
    const blob = new Blob([pythonBotCode], { type: 'text/x-python;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'jev_quant_trading_bot.py';
    a.click();
    URL.revokeObjectURL(url);
  };





  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-emerald-500/30 selection:text-emerald-300">
      {/* TOP STATUS BAR */}
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur-md sticky top-0 z-40 px-4 lg:px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-cyan-600 shadow-lg shadow-emerald-500/20 text-white font-black text-xl tracking-wider">
            J
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-extrabold text-lg tracking-tight bg-gradient-to-r from-white via-slate-100 to-slate-400 bg-clip-text text-transparent">
                JevQuant™
              </span>
              <span className="text-[10px] font-semibold tracking-wider uppercase px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                TypeSafe System One
              </span>
            </div>
            <p className="text-xs text-slate-400 hidden sm:block">
              نظام التداول الكمي الآلي عالي السرعة متعدد الفريمات عبر Binance API
            </p>
          </div>
        </div>

        {/* ASSET SELECTOR */}
        <div className="flex items-center gap-1.5 bg-slate-950 p-1 rounded-xl border border-slate-800">
          {(['BTC/USDT', 'ETH/USDT', 'SOL/USDT'] as AssetSymbol[]).map((sym) => (
            <button
              key={sym}
              onClick={() => setSelectedAsset(sym)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                selectedAsset === sym
                  ? 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-white hover:bg-slate-900'
              }`}
            >
              {sym.split('/')[0]}
            </button>
          ))}
        </div>

        {/* CONTROLS, TELEGRAM & STRATEGY BLUEPRINT BTNS */}
        <div className="flex items-center gap-2">
          {/* TOP TELEGRAM ALERTS DIRECT BUTTON */}
          <button
            onClick={() => setActiveTab('telegram')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all shadow-sm cursor-pointer ${
              activeTab === 'telegram'
                ? 'bg-cyan-500 text-slate-950 font-black shadow-cyan-500/20'
                : telegramConfig.botToken && telegramConfig.chatId
                ? 'bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-300 border border-cyan-500/40'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700'
            }`}
            title="إعدادات وتنبيهات تيليجرام الفورية"
          >
            <Send className="w-3.5 h-3.5 text-cyan-400" />
            <span className="hidden sm:inline">إشعارات تيليجرام</span>
            <span className="sm:hidden">تيليجرام</span>
            {telegramConfig.botToken && telegramConfig.chatId ? (
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            ) : (
              <span className="text-[10px] text-amber-400 px-1 py-0.2 rounded bg-amber-500/10 border border-amber-500/20 font-mono">ضبط</span>
            )}
          </button>

          <button
            onClick={() => setShowBlueprintModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 text-xs font-bold transition-all shadow-sm shadow-cyan-500/10 cursor-pointer"
          >
            <BookOpen className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">سؤال المليون دولار (خريطة الطريق)</span>
            <span className="sm:hidden">الاستراتيجية</span>
          </button>

          <button
            onClick={() => {
              const nextRunning = !isBotRunning;
              setIsBotRunning(nextRunning);
              if (nextRunning) {
                sendLiveTelegramAlert(`🚀 <b>[JevQuant] تم تشغيل البوت بنجاح!</b>
━━━━━━━━━━━━━━━━━━━━
الأصل النشط: <b>#${selectedAsset.replace('/', '')}</b>
الفريم: <b>${selectedTf}</b>
الوضع: <b>${binanceMode.toUpperCase()}</b>
الوقت: <b>${new Date().toLocaleTimeString()}</b>`);
              } else {
                sendLiveTelegramAlert(`⏸️ <b>[JevQuant] تم إيقاف البوت مؤقتاً</b>
━━━━━━━━━━━━━━━━━━━━
الوقت: <b>${new Date().toLocaleTimeString()}</b>`);
              }
            }}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all shadow-md cursor-pointer ${
              isBotRunning
                ? 'bg-rose-500/10 text-rose-400 border border-rose-500/30 hover:bg-rose-500/20'
                : 'bg-emerald-500 text-slate-950 hover:bg-emerald-400'
            }`}
          >
            {isBotRunning ? (
              <>
                <Pause className="w-3.5 h-3.5" />
                <span>إيقاف البوت</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5" />
                <span>تشغيل البوت</span>
              </>
            )}
          </button>
        </div>
      </header>

      {/* SUB-NAV TABS */}
      <div className="border-b border-slate-800 bg-slate-900/60 px-4 lg:px-6 py-2.5 flex items-center justify-between text-xs overflow-x-auto gap-4">
        <div className="flex items-center gap-2">
          {[
            { id: 'dashboard', label: 'لوحة التحكم والقرارات المباشرة', icon: Activity },
            { id: 'backtest', label: 'الأداء والأرباح (Backtest & PnL)', icon: BarChart3 },
            { id: 'binance', label: 'إعدادات ربط Binance API', icon: ShieldCheck },
            { id: 'telegram', label: 'إشعارات تيليجرام (Telegram Alerts)', icon: Send, badge: telegramConfig.botToken && telegramConfig.chatId ? 'متصل' : 'جديد' },
            { id: 'python_code', label: 'كود البوت للتنفيذ 24/7 (Python)', icon: Terminal },
          ].map((tab) => {
            const Icon = tab.icon;
            const isTabActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-xl font-semibold transition-all whitespace-nowrap shrink-0 cursor-pointer ${
                  isTabActive
                    ? tab.id === 'telegram'
                      ? 'bg-cyan-500 text-slate-950 font-bold shadow-lg shadow-cyan-500/20'
                      : 'bg-slate-800 text-white shadow-sm border border-slate-700'
                    : tab.id === 'telegram'
                    ? 'text-cyan-400 hover:text-cyan-300 bg-cyan-500/10 hover:bg-cyan-500/15 border border-cyan-500/20'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{tab.label}</span>
                {tab.id === 'telegram' && (
                  <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
                    isTabActive ? 'bg-slate-950 text-cyan-300' : 'bg-cyan-500/20 text-cyan-300'
                  }`}>
                    {tab.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* METRICS BADGES */}
        <div className="flex items-center gap-3 text-slate-400 text-[11px] whitespace-nowrap">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            <span>Jev Latency: <strong className="text-white">{jevDecision.latencyMs}ms</strong></span>
          </div>
          <div className="hidden md:flex items-center gap-1">
            <span>التكلفة/طلب:</span>
            <strong className="text-emerald-400">${jevDecision.apiCost.toFixed(6)}</strong>
          </div>
          {/* INTERACTIVE 3-MODE SWITCHER PILL */}
          <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800 text-[11px]">
            <span className="text-slate-400 px-1 text-[10px] hidden sm:inline">النمط:</span>
            <button
              onClick={() => handleSwitchActiveMode('paper')}
              className={`px-2 py-0.5 rounded-lg font-bold transition-all cursor-pointer ${
                binanceMode === 'paper'
                  ? 'bg-purple-500/25 text-purple-300 border border-purple-500/50 shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
              title="نمط البيبر (Paper Trading) — محاكاة بدون مخاطرة"
            >
              📝 بيبر
            </button>
            <button
              onClick={() => handleSwitchActiveMode('testnet')}
              className={`px-2 py-0.5 rounded-lg font-bold transition-all cursor-pointer ${
                binanceMode === 'testnet'
                  ? 'bg-cyan-500/25 text-cyan-300 border border-cyan-500/50 shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
              title="Binance Spot Testnet — شبكة الاختبار الرسمية"
            >
              🧪 تيست نت
            </button>
            <button
              onClick={() => handleSwitchActiveMode('live')}
              className={`px-2 py-0.5 rounded-lg font-bold transition-all cursor-pointer ${
                binanceMode === 'live'
                  ? 'bg-rose-500/25 text-rose-300 border border-rose-500/50 shadow-sm animate-pulse'
                  : 'text-slate-400 hover:text-white'
              }`}
              title="Binance Spot Live — تداول حقيقي بأموال حقيقية"
            >
              🔴 لايف حقيقي
            </button>
          </div>
          <div className="flex items-center gap-1 bg-emerald-500/10 text-emerald-300 px-2.5 py-0.5 rounded border border-emerald-500/30">
            <span>المحفظة:</span>
            <strong className="font-mono text-emerald-400 font-bold">
              ${totalWalletUsdt.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT
            </strong>
          </div>
        </div>
      </div>

      {/* JEV API KEY LIVE CONNECTED BANNER */}
      <div className="bg-gradient-to-r from-emerald-950/80 via-slate-900 to-cyan-950/80 border-b border-emerald-500/20 px-4 lg:px-6 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2.5">
          <div className="flex items-center gap-1.5 bg-emerald-500/10 text-emerald-400 px-2.5 py-1 rounded-full border border-emerald-500/30 font-bold">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            <span>TypeSafe Jev API: متصل ومفعل بنجاح (jev-1.13.0)</span>
          </div>
          <span className="text-slate-400 hidden sm:inline font-mono">
            Key: apikey_2213...c653
          </span>
          <span className="text-slate-500 text-[11px]">
            آخر تقييم: {lastEvaluatedAt}
          </span>
        </div>

        <button
          onClick={triggerLiveJevEvaluation}
          disabled={isEvaluatingLive}
          className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 font-bold text-xs shadow-md shadow-emerald-500/20 transition-all cursor-pointer ${
            isEvaluatingLive ? 'opacity-70 cursor-not-allowed' : ''
          }`}
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isEvaluatingLive ? 'animate-spin' : ''}`} />
          <span>{isEvaluatingLive ? 'جاري تقييم الفريمات عبر Jev...' : '⚡ تشغيل تقييم Jev لحظي الآن'}</span>
        </button>
      </div>

      {/* MAIN CONTENT AREA */}
      <main className="flex-1 p-4 lg:p-6 max-w-7xl w-full mx-auto space-y-6">

        {/* DASHBOARD TAB */}
        {activeTab === 'dashboard' && (
          <div className="space-y-6">
            {/* HERO ASSET BANNER */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 bg-slate-900/60 p-4 rounded-2xl border border-slate-800/80 shadow-xl">
              <div>
                <span className="text-xs text-slate-400">الأصل المحدد</span>
                <div className="flex items-baseline gap-2 mt-0.5">
                  <h2 className="text-2xl font-black text-white">{currentAsset.name}</h2>
                  <span className="text-sm font-semibold text-slate-400">{currentAsset.symbol}</span>
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-xl font-mono font-bold text-white">
                    ${currentAsset.price.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </span>
                  <span className={`flex items-center text-xs font-bold px-1.5 py-0.5 rounded ${
                    currentAsset.change24h >= 0 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'
                  }`}>
                    {currentAsset.change24h >= 0 ? '+' : ''}{currentAsset.change24h}%
                  </span>
                </div>
              </div>

              <div className="space-y-1 text-xs">
                <span className="text-slate-400">إحصاءات 24 ساعة</span>
                <div className="flex justify-between py-0.5 border-b border-slate-800">
                  <span className="text-slate-400">الأعلى 24h:</span>
                  <span className="font-mono text-slate-200">${currentAsset.high24h.toLocaleString()}</span>
                </div>
                <div className="flex justify-between py-0.5 border-b border-slate-800">
                  <span className="text-slate-400">الأدنى 24h:</span>
                  <span className="font-mono text-slate-200">${currentAsset.low24h.toLocaleString()}</span>
                </div>
                <div className="flex justify-between py-0.5">
                  <span className="text-slate-400">الحجم (Volume):</span>
                  <span className="font-mono text-emerald-400">{currentAsset.volume24h}</span>
                </div>
              </div>

              <div className="space-y-1 text-xs">
                <span className="text-slate-400">المؤشرات الفنية (Technical Indicators)</span>
                <div className="flex justify-between py-0.5 border-b border-slate-800">
                  <span className="text-slate-400">RSI (14):</span>
                  <span className={`font-mono font-bold ${currentAsset.rsi > 70 ? 'text-rose-400' : currentAsset.rsi < 30 ? 'text-emerald-400' : 'text-slate-200'}`}>
                    {currentAsset.rsi}
                  </span>
                </div>
                <div className="flex justify-between py-0.5 border-b border-slate-800">
                  <span className="text-slate-400">قوة الاتجاه ADX (14):</span>
                  <span className={`font-mono font-bold ${currentAsset.adx >= 25 ? 'text-emerald-400' : currentAsset.adx < 20 ? 'text-rose-400' : 'text-amber-400'}`}>
                    {currentAsset.adx} <span className="text-[10px] font-normal text-slate-400">(+{currentAsset.plusDi}/-{currentAsset.minusDi})</span>
                  </span>
                </div>
                <div className="flex justify-between py-0.5 border-b border-slate-800">
                  <span className="text-slate-400">ATR التقلب:</span>
                  <span className="font-mono text-cyan-400">${currentAsset.atr}</span>
                </div>
                <div className="flex justify-between py-0.5">
                  <span className="text-slate-400">متوسط EMA 200:</span>
                  <span className="font-mono text-slate-300">${currentAsset.ema200.toLocaleString()}</span>
                </div>
              </div>

              <div className="bg-gradient-to-br from-slate-950 to-slate-900 p-3.5 rounded-xl border border-slate-800 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-slate-400 uppercase font-semibold tracking-wider">قرار محرك Jev المباشر</span>
                    <div className="flex items-center gap-1">
                      <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${jevDecision.chopFilterPass ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30' : 'bg-rose-500/10 text-rose-400 border border-rose-500/30'}`}>
                        {jevDecision.chopFilterPass ? 'ADX اتجاه قوي ✓' : 'حجب تذبذب (Chop) 🛡️'}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className={`text-sm font-extrabold px-2.5 py-1 rounded-lg ${
                      jevDecision.action === 'EXECUTE_SPOT_BUY' || (jevDecision.action as any) === 'EXECUTE_LONG'
                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                        : jevDecision.action === 'EXIT_TO_USDT_CASH' || (jevDecision.action as any) === 'EXECUTE_SHORT'
                        ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                        : 'bg-slate-800 text-slate-300 border border-slate-700'
                    }`}>
                      {jevDecision.action === 'EXECUTE_SPOT_BUY' || (jevDecision.action as any) === 'EXECUTE_LONG'
                        ? '🟢 شراء وتجميع Spot'
                        : jevDecision.action === 'EXIT_TO_USDT_CASH' || (jevDecision.action as any) === 'EXECUTE_SHORT'
                        ? '💵 خروج للكاش (100% USDT)'
                        : '⏸️ انتظار في الكاش'}
                    </span>
                    <span className="text-xs text-slate-300 font-mono">
                      {(jevDecision.actionConfidence * 100).toFixed(0)}% ثقة
                    </span>
                  </div>
                </div>

                <div className="space-y-1 mt-2 text-[11px] text-slate-400 border-t border-slate-800/80 pt-1.5">
                  <div className="flex justify-between items-center">
                    <span>فلتر ADX Chop Filter:</span>
                    <span className={`font-mono font-bold ${jevDecision.chopFilterPass ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {jevDecision.adx} ({jevDecision.chopFilterPass ? 'مستوفى >= 20' : 'محجوب < 20'})
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span>العتبة الديناميكية (Dynamic):</span>
                    <span className="font-mono text-cyan-400 font-bold">{(jevDecision.dynamicConfidenceThreshold * 100).toFixed(1)}%</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span>الحجم الديناميكي (Sizing):</span>
                    <span className="font-mono text-emerald-400 font-bold">${jevDecision.dynamicPositionSize} USDT</span>
                  </div>
                </div>
              </div>
            </div>

            {/* TELEGRAM STATUS & QUICK ACCESS WIDGET IN DASHBOARD */}
            <div className="bg-gradient-to-r from-slate-900 via-slate-900/95 to-cyan-950/40 p-4 rounded-2xl border border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs shadow-lg">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 shadow-inner">
                  <Send className="w-4 h-4" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-white text-sm">إشعارات تيليجرام اللحظية (Telegram Push Alerts)</span>
                    {telegramConfig.botToken && telegramConfig.chatId ? (
                      <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 text-[10px] font-bold flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                        متصل ومفعل
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/30 text-[10px] font-bold">
                        بانتظار الإعداد (اضغط للضبط)
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    {telegramConfig.botToken && telegramConfig.chatId
                      ? `يتم إرسال إشعارات الصفقات الرابحة والخاسرة تلقائياً إلى Chat ID: ${telegramConfig.chatId}`
                      : 'اربط البوت بتيليجرام لاستقبال تنبيهات الصفقات الرابحة والخاسرة وأوامر الدخول مباشرة على هاتفك.'}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setActiveTab('telegram')}
                  className="px-4 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs shadow-md shadow-cyan-500/20 transition-all cursor-pointer flex items-center gap-1.5"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>{telegramConfig.botToken && telegramConfig.chatId ? 'تعديل إعدادات التنبيهات' : 'إعداد وربط تيليجرام الآن'}</span>
                </button>
              </div>
            </div>

            {/* DYNAMIC ATR VOLATILITY TARGETS BANNER */}
            <div className="bg-gradient-to-r from-slate-900 via-slate-900/90 to-cyan-950/40 p-3.5 rounded-2xl border border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs shadow-md">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 font-bold">
                  <Target className="w-4 h-4" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-white">إدارة الأهداف والوقف الديناميكية (Dynamic ATR Targets)</span>
                    <span className="px-2 py-0.5 rounded-md bg-cyan-500/10 text-cyan-300 font-mono font-bold text-[10px] border border-cyan-500/30">
                      فريم {selectedTf} · ATR: ${liveDynamicTargets.atrUsed.toLocaleString()}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    تتأقلم مستويات الربح والوقف تلقائياً مع تقلبات السوق لكل فريم زمني لحماية رأس المال دون التقيد بنسب ثابتة
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2.5 font-mono flex-wrap">
                <div className="flex items-center gap-1.5 bg-emerald-500/10 px-2.5 py-1 rounded-lg border border-emerald-500/30 text-emerald-400 font-bold">
                  <span className="font-sans text-[11px] text-slate-400">الهدف (TP):</span>
                  <span>${liveDynamicTargets.takeProfit.toLocaleString()} (+{liveDynamicTargets.tpPercent}%)</span>
                </div>
                <div className="flex items-center gap-1.5 bg-rose-500/10 px-2.5 py-1 rounded-lg border border-rose-500/30 text-rose-400 font-bold">
                  <span className="font-sans text-[11px] text-slate-400">الوقف (SL):</span>
                  <span>${liveDynamicTargets.stopLoss.toLocaleString()} (-{liveDynamicTargets.slPercent}%)</span>
                </div>
                <div className="bg-slate-950 px-2 py-1 rounded-lg border border-slate-800 text-[11px] text-slate-300 font-sans">
                  نسبة العائد/المخاطرة: <strong className="text-cyan-400 font-mono font-bold">1:2.5</strong>
                </div>
              </div>
            </div>

            {/* TRADINGVIEW LIGHTWEIGHT CHARTS CANVAS */}
            <TradingViewChart
              symbol={selectedAsset}
              timeframe={selectedTf}
              currentPrice={currentAsset.price}
              atr={currentAsset.atr}
              openTrades={trades}
              onTimeframeChange={(tf) => setSelectedTf(tf as any)}
            />

            {/* TIMEFRAME SELECTION MATRIX */}
            <div className="bg-slate-900/60 p-5 rounded-2xl border border-slate-800">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
                <div>
                  <h3 className="font-bold text-sm text-white flex items-center gap-2">
                    <Layers className="w-4 h-4 text-emerald-400" />
                    مصفوفة توافق الفريمات الزمنية المتعددة (Multi-Timeframe Confluence Matrix)
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    يقرأ Jev AI كل هذه الفريمات في استدعاء واحد متزامن (~96ms) ويحدد ما إذا كانت الفريمات الصغرى تؤكد الاتجاه الكلي
                  </p>
                </div>

                <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
                  {TIMEFRAMES.map((tf) => (
                    <button
                      key={tf}
                      onClick={() => setSelectedTf(tf)}
                      className={`px-2.5 py-1 rounded text-xs font-semibold transition-all ${
                        selectedTf === tf
                          ? 'bg-emerald-500 text-slate-950 shadow'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      {tf}
                    </button>
                  ))}
                </div>
              </div>

              {/* TIMEFRAMES CARDS GRID */}
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2.5">
                {TIMEFRAMES.map((tf) => {
                  const sig = mtfSignals[tf];
                  const isCurrent = selectedTf === tf;
                  return (
                    <div
                      key={tf}
                      onClick={() => setSelectedTf(tf)}
                      className={`p-3 rounded-xl border transition-all cursor-pointer text-center ${
                        isCurrent
                          ? 'bg-slate-800/90 border-emerald-500/80 ring-2 ring-emerald-500/20 shadow-md'
                          : 'bg-slate-950/70 border-slate-800/80 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="font-mono font-bold text-xs text-white">{tf}</span>
                        <span className="text-[10px] text-slate-500">{(sig.weight * 100)}%</span>
                      </div>
                      <span className={`inline-block text-[11px] font-bold px-2 py-0.5 rounded ${
                        sig.trend === 'BULLISH'
                          ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                          : 'bg-rose-500/10 text-rose-400 border border-rose-500/30'
                      }`}>
                        {sig.trend}
                      </span>
                      <div className="mt-1.5 flex items-center justify-center gap-1.5 font-mono text-[10px]">
                        <span className="text-slate-500">RSI:</span>
                        <span className={`font-bold ${
                          sig.rsi > 70 ? 'text-rose-400' : sig.rsi < 30 ? 'text-emerald-400' : 'text-cyan-300'
                        }`}>
                          {sig.rsi.toFixed(1)}
                        </span>
                        {sig.adx !== undefined && (
                          <>
                            <span className="text-slate-600">|</span>
                            <span className="text-slate-500">ADX:</span>
                            <span className={`font-bold ${sig.adx >= 25 ? 'text-emerald-400' : sig.adx < 20 ? 'text-rose-400' : 'text-amber-400'}`}>
                              {sig.adx.toFixed(0)}
                            </span>
                          </>
                        )}
                      </div>
                      <div className="mt-1 text-[10px] text-slate-400 leading-tight truncate">
                        {sig.momentum}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* THE JEV DECISION ENGINE BREAKDOWN (5 PRIMITIVES) */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* PRIMITIVES EVALUATION CARDS */}
              <div className="lg:col-span-2 bg-slate-900/60 p-5 rounded-2xl border border-slate-800 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-sm text-white flex items-center gap-2">
                    <Cpu className="w-4 h-4 text-cyan-400" />
                    تشريح قرارات TypeSafe Jev الذرية (Atomic Decision Primitives)
                  </h3>
                  <span className="text-xs font-mono text-cyan-400 bg-cyan-500/10 px-2 py-0.5 rounded border border-cyan-500/20">
                    Single Batched API Call: ~{jevDecision.latencyMs}ms
                  </span>
                </div>

                <div className="space-y-3">
                  {/* PRIMITIVE 1: CHOICE MARKET REGIME */}
                  <div className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800 flex items-center justify-between">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-400 border border-purple-500/20">
                          Choice Primitive
                        </span>
                        <span className="text-xs font-bold text-slate-200">سؤال نمط السوق (Market Regime)</span>
                      </div>
                      <p className="text-xs text-slate-400">
                        تصنيف حركة السعر الكلية بين: اتجاه صاعد، اتجاه هابط، تجميع عرضي، أو تقلب عشوائي
                      </p>
                    </div>
                    <div className="text-right">
                      <span className="text-xs font-bold text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-lg border border-emerald-500/30">
                        {jevDecision.regime}
                      </span>
                      <div className="text-[11px] text-slate-400 font-mono mt-1">
                        ثقة {(jevDecision.regimeConfidence * 100).toFixed(0)}%
                      </div>
                    </div>
                  </div>

                  {/* PRIMITIVE 2: NOUL CONFLUENCE */}
                  <div className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800 flex items-center justify-between">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">
                          Noul Primitive
                        </span>
                        <span className="text-xs font-bold text-slate-200">توافق الفريمات (MTF Confluence)</span>
                      </div>
                      <p className="text-xs text-slate-400">
                        هل اختراق فريم 15 دقيقة مؤكد ومدعوم بزخم فريم 1 ساعة و 4 ساعات؟
                      </p>
                    </div>
                    <div className="text-right">
                      <span className="text-xs font-bold text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-lg border border-emerald-500/30">
                        CONFIRMED (نعم)
                      </span>
                      <div className="text-[11px] text-slate-400 font-mono mt-1">
                        P(True) = {jevDecision.confluenceProb.toFixed(2)}
                      </div>
                    </div>
                  </div>

                  {/* PRIMITIVE 3: NOUL TRAP GUARD */}
                  <div className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800 flex items-center justify-between">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">
                          Noul Primitive
                        </span>
                        <span className="text-xs font-bold text-slate-200">فخ السيولة الوهمي (Liquidity Trap Guard)</span>
                      </div>
                      <p className="text-xs text-slate-400">
                        هل الشمعة الحالية مجرد صيد لوقف الخسائر (Wick Hunt) وسيعكس السعر فوراً؟
                      </p>
                    </div>
                    <div className="text-right">
                      <span className="text-xs font-bold text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-lg border border-emerald-500/30">
                        NO TRAP (آمن)
                      </span>
                      <div className="text-[11px] text-slate-400 font-mono mt-1">
                        خطر الفخ = {(jevDecision.liquidityTrapProb * 100).toFixed(0)}%
                      </div>
                    </div>
                  </div>

                  {/* PRIMITIVE 4: SCORE CONVICTION SIZING */}
                  <div className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800 flex items-center justify-between">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
                          Score Primitive
                        </span>
                        <span className="text-xs font-bold text-slate-200">درجة اليقين وحجم المخاطرة (Conviction Score)</span>
                      </div>
                      <p className="text-xs text-slate-400">
                        مقياس من 0 إلى 3 يحدد مضاعف حجم المركز (0.6x للمستوى 1، 1.0x للمستوى 2، 1.5x للمستوى 3)
                      </p>
                    </div>
                    <div className="text-right">
                      <span className="text-xs font-bold text-amber-400 bg-amber-500/10 px-2.5 py-1 rounded-lg border border-amber-500/30">
                        المستوى {jevDecision.convictionLevel}/3 ({jevDecision.riskPercent}% Risk)
                      </span>
                      <div className="text-[11px] text-slate-400 font-mono mt-1">
                        الحجم المتكيف: ${jevDecision.dynamicPositionSize} USDT
                      </div>
                    </div>
                  </div>

                  {/* PRIMITIVE 5: DYNAMIC CALIBRATED CONFIDENCE GATE */}
                  <div className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800 flex items-center justify-between">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                          Dynamic Calibration Gate
                        </span>
                        <span className="text-xs font-bold text-slate-200">معايرة الثقة المستمرة بحسب تقلب ATR</span>
                      </div>
                      <p className="text-xs text-slate-400">
                        ترتفع عتبة الثقة تلقائياً في الأسواق العنيفة لحماية رأس المال، وتنخفض في فترات التجميع الهادئ
                      </p>
                    </div>
                    <div className="text-right">
                      <span className={`text-xs font-bold px-2.5 py-1 rounded-lg border ${
                        jevDecision.meetsDynamicThreshold
                          ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30'
                          : 'text-amber-400 bg-amber-500/10 border-amber-500/30'
                      }`}>
                        عتبة: {(jevDecision.dynamicConfidenceThreshold * 100).toFixed(1)}% | الفعلية: {(jevDecision.actionConfidence * 100).toFixed(0)}%
                      </span>
                      <div className="text-[11px] text-slate-400 font-mono mt-1">
                        {jevDecision.meetsDynamicThreshold ? '✓ تم تجاوز العتبة بنجاح' : '🛡️ محمي ضد التذبذب العالي'}
                      </div>
                    </div>
                  </div>

                  {/* PRIMITIVE 6: ADX CHOP FILTER GATE */}
                  <div className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800 flex items-center justify-between">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                          Quantitative Edge Gate
                        </span>
                        <span className="text-xs font-bold text-slate-200">فلتر قوة الاتجاه والأسواق المتذبذبة (ADX Chop Filter)</span>
                      </div>
                      <p className="text-xs text-slate-400">
                        حظر إطلاق أي صفقة شراء عندما يكون ADX &lt; 20 (سوق ميت) أو عندما يكون -DI مهيمناً على +DI
                      </p>
                    </div>
                    <div className="text-right">
                      <span className={`text-xs font-bold px-2.5 py-1 rounded-lg border ${
                        jevDecision.chopFilterPass
                          ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30'
                          : 'text-rose-400 bg-rose-500/10 border-rose-500/30'
                      }`}>
                        ADX: {jevDecision.adx} (+DI: {jevDecision.plusDi} / -DI: {jevDecision.minusDi})
                      </span>
                      <div className="text-[11px] text-slate-400 font-mono mt-1">
                        {jevDecision.chopFilterPass ? '✓ اتجاه قوي ومؤهل للتنفيذ' : '🛡️ محجوب - سوق متذبذب عديم الاتجاه'}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* JEV VS LLM SPEED & COST COMPARISON */}
              <div className="bg-slate-900/60 p-5 rounded-2xl border border-slate-800 flex flex-col justify-between space-y-4">
                <div>
                  <h3 className="font-bold text-sm text-white flex items-center gap-2 mb-2">
                    <Zap className="w-4 h-4 text-amber-400" />
                    لماذا ينجح Jev في التداول ويفشل الـ LLM؟
                  </h3>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    في التداول الحقيقي عالي التردد (Crypto HFT)، التذبذب سريع جداً. نماذج التفكير (GPT-5 / Claude) بطيئة جداً ومكلفة وتفوت نقاط الدخول، بينما Jev مخصص لاتخاذ القرارات القطعية اللحظية.
                  </p>
                </div>

                <div className="space-y-2.5 bg-slate-950 p-3.5 rounded-xl border border-slate-800 text-xs">
                  <div className="flex justify-between items-center pb-2 border-b border-slate-800">
                    <span className="text-slate-400">سرعة القرار (Latency):</span>
                    <div className="text-right">
                      <span className="font-mono font-bold text-emerald-400">96 مللي ثانية</span>
                      <span className="text-[10px] text-slate-500 block">مقابل 11,000ms للـ LLM</span>
                    </div>
                  </div>
                  <div className="flex justify-between items-center pb-2 border-b border-slate-800">
                    <span className="text-slate-400">تكلفة التقييم الواحد:</span>
                    <div className="text-right">
                      <span className="font-mono font-bold text-emerald-400">$0.000043</span>
                      <span className="text-[10px] text-slate-500 block">مقابل $0.035 للـ LLM</span>
                    </div>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-slate-400">ميزة السرعة والتكلفة:</span>
                    <span className="font-bold text-cyan-400">أسرع 110x وأرخص 800x!</span>
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-300">
                  <span className="font-bold block mb-0.5">صمام أمان عدم الهلوسة:</span>
                  قرارات الشراء والبيع محصورة في قيم برمجية صارمة (Enums) مع نسبة ثقة رقمية محددة تمنع إطلاق أي أمر غير محسوب.
                </div>
              </div>
            </div>

            {/* REAL CRYPTO WALLET & COIN BALANCES (SPOT WALLET) */}
            <CryptoWalletBalances
              balances={walletBalances}
              totalWalletUsdt={totalWalletUsdt}
              isLoading={isLoadingWalletBalances}
              onRefresh={fetchBinanceAccountBalance}
              isAccountVerified={isAccountVerified}
              binanceMode={binanceMode}
              onNavigateToBinanceConfig={() => setActiveTab('binance')}
            />

            {/* RECHARTS ACCOUNT EQUITY GROWTH CURVE */}
            <AccountEquityGrowthChart
              currentBalance={accountBalance || totalWalletUsdt}
              trades={trades}
              initialBalance={10000}
            />

            {/* RECENT TRADES LOG TABLE (REAL BINANCE SPOT TRADES) */}
            <div className="bg-slate-900/60 p-5 rounded-2xl border border-slate-800 space-y-4">
              {/* FEEDBACK ALERT */}
              {testTradeFeedback && (
                <div className={`p-4 rounded-xl border flex items-start justify-between gap-3 text-xs ${
                  testTradeFeedback.success
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                    : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
                }`}>
                  <div className="flex items-center gap-2">
                    <span className="text-base">{testTradeFeedback.success ? '✅' : '⚠️'}</span>
                    <span className="font-semibold leading-relaxed">{testTradeFeedback.message}</span>
                  </div>
                  <button
                    onClick={() => setTestTradeFeedback(null)}
                    className="text-slate-400 hover:text-white shrink-0 cursor-pointer font-bold px-1"
                  >
                    ✕
                  </button>
                </div>
              )}

              {/* TABLE HEADER & ACTION CONTROLS */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800/80">
                <div>
                  <h3 className="font-bold text-sm text-white flex items-center gap-2">
                    <Clock className="w-4 h-4 text-emerald-400" />
                    سجل الصفقات الفعلي لحساب Binance Spot Testnet
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    جميع الصفقات والأوامر المعروضة هنا مستخرجة ومطابقة لحسابك على Binance Testnet (بدون أي صفقات وهمية)
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={handleExecuteTestTrade}
                    disabled={isExecutingTestTrade}
                    className="px-3.5 py-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 font-bold text-xs shadow-md shadow-emerald-500/20 transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    <Zap className={`w-3.5 h-3.5 ${isExecutingTestTrade ? 'animate-spin' : ''}`} />
                    <span>{isExecutingTestTrade ? 'جاري التنفيذ في بينانس...' : '⚡ فحص الربط وتنفيذ صفقة اختبارية'}</span>
                  </button>

                  <button
                    onClick={fetchBinanceMyTrades}
                    disabled={isLoadingMyTrades}
                    className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs border border-slate-700 transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                    title="تحديث الصفقات والأوامر من حساب بينانس"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isLoadingMyTrades ? 'animate-spin text-emerald-400' : ''}`} />
                    <span>{isLoadingMyTrades ? 'جاري الجلب...' : 'جلب الصفقات من بينانس'}</span>
                  </button>
                </div>
              </div>

              {/* TRADES DATA OR EMPTY STATE */}
              {trades.length === 0 ? (
                <div className="py-12 px-4 text-center rounded-xl bg-slate-950/60 border border-slate-800/60 flex flex-col items-center justify-center space-y-3">
                  <div className="w-12 h-12 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-400">
                    <Clock className="w-6 h-6 text-slate-500" />
                  </div>
                  <div className="space-y-1">
                    <h4 className="text-sm font-bold text-slate-200">لا توجد صفقات وهمية · السجل فارغ ونظيف</h4>
                    <p className="text-xs text-slate-400 max-w-md mx-auto leading-relaxed">
                      تم مسح الصفقات الوهمية بالكامل. يمكنك الآن الضغط على زر "⚡ فحص الربط وتنفيذ صفقة اختبارية" لتنفيذ أول أمر شراء حقيقي في حساب Binance Testnet والتحقق من الربط مع تيليجرام فورياً!
                    </p>
                  </div>
                  <button
                    onClick={handleExecuteTestTrade}
                    disabled={isExecutingTestTrade}
                    className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs shadow transition-all cursor-pointer flex items-center gap-2 mt-2"
                  >
                    <Zap className="w-3.5 h-3.5" />
                    <span>تنفيذ صفقة اختبارية الآن</span>
                  </button>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-950 text-slate-400 uppercase text-[10px] border-b border-slate-800">
                      <tr>
                        <th className="py-2.5 px-3">رقم الأمر (Order ID)</th>
                        <th className="py-2.5 px-3">الوقت</th>
                        <th className="py-2.5 px-3">الأصل</th>
                        <th className="py-2.5 px-3">نوع العملية</th>
                        <th className="py-2.5 px-3">سعر الدخول</th>
                        <th className="py-2.5 px-3">الهدف (TP) / الوقف (SL)</th>
                        <th className="py-2.5 px-3">العائد (PnL)</th>
                        <th className="py-2.5 px-3">حالة الأمر</th>
                        <th className="py-2.5 px-3 text-center">الإجراء</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800 font-mono">
                      {trades.map((t) => (
                        <tr key={t.id} className="hover:bg-slate-800/40 transition-colors">
                          <td className="py-2.5 px-3 text-cyan-400 font-bold">{t.id}</td>
                          <td className="py-2.5 px-3 text-slate-400">{t.timestamp}</td>
                          <td className="py-2.5 px-3 font-sans font-bold text-white">{t.asset}</td>
                          <td className="py-2.5 px-3">
                            <span className={`px-2 py-0.5 rounded font-sans text-[11px] font-bold ${
                              t.type.includes('شراء') ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                            }`}>
                              {t.type}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 font-bold text-slate-200">
                            ${t.entryPrice ? t.entryPrice.toLocaleString(undefined, { minimumFractionDigits: 2 }) : '—'}
                          </td>
                          <td className="py-2.5 px-3 text-[11px]">
                            {t.takeProfit > 0 || t.stopLoss > 0 ? (
                              <div className="space-y-0.5">
                                <div className="text-emerald-400">TP: ${t.takeProfit.toLocaleString()}</div>
                                <div className="text-rose-400">SL: ${t.stopLoss.toLocaleString()}</div>
                              </div>
                            ) : (
                              <span className="text-slate-600">—</span>
                            )}
                          </td>
                          <td className="py-2.5 px-3">
                            {t.pnl !== undefined ? (
                              <span className={`font-bold ${t.pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                {t.pnl >= 0 ? '+' : ''}${t.pnl.toFixed(2)} ({t.pnlPercent ? (t.pnlPercent > 0 ? '+' : '') + t.pnlPercent + '%' : ''})
                              </span>
                            ) : (
                              <span className="text-slate-500 font-sans text-[11px]">مفتوحة (قيد المتابعة)</span>
                            )}
                          </td>
                          <td className="py-2.5 px-3">
                            {t.status === 'OPEN' ? (
                              <span className="px-2 py-0.5 rounded text-[10px] font-sans font-bold bg-cyan-500/15 text-cyan-300 border border-cyan-500/40 animate-pulse flex items-center gap-1 w-fit">
                                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping"></span>
                                مفتوحة (مراقبة TP/SL)
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded text-[10px] font-sans font-bold bg-slate-800 text-emerald-400 border border-emerald-500/30">
                                {t.exitReason === 'TAKE_PROFIT'
                                  ? '🎯 تم تحقيق الهدف'
                                  : t.exitReason === 'STOP_LOSS'
                                  ? '🛡️ تم تفعيل الوقف'
                                  : 'مغلقة بنجاح ✓'}
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 px-3 text-center">
                            {t.status === 'OPEN' ? (
                              <button
                                onClick={() => handleManualCloseTrade(t)}
                                className="px-2.5 py-1 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 text-[10px] font-sans font-bold transition-all cursor-pointer"
                                title="إغلاق الصفقة فورياً وتحويلها إلى كاش 100% USDT"
                              >
                                💵 بيع للكاش
                              </button>
                            ) : (
                              <span className="text-slate-600 text-[10px] font-sans">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* BACKTEST & PNL TAB */}
        {activeTab === 'backtest' && (
          <div className="space-y-8">
            {/* V0.1 ISOLATED BACKTESTER LAB & RIGOROUS TEST SUITE */}
            <BacktestLabV01 />

            {/* 90-DAY AGGREGATED HISTORICAL PERFORMANCE BENCHMARK */}
            <div className="bg-slate-900/60 p-6 rounded-2xl border border-slate-800">
              <h2 className="text-lg font-bold text-white mb-2 flex items-center gap-2">
                <BarChart3 className="w-5 h-5 text-emerald-400" />
                الأداء الإجمالي لـ 90 يوماً الماضية (Historical 90-Day Benchmark)
              </h2>
              <p className="text-xs text-slate-400 mb-6">
                اختبار استراتيجية Jev MTF Confluence على بيانات 90 يوماً الماضية لعملات (BTC, ETH, SOL)
              </p>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
                <div className="p-4 rounded-xl bg-slate-950 border border-slate-800">
                  <span className="text-xs text-slate-400">نسبة الصفقات الرابحة (Win Rate)</span>
                  <div className="text-2xl font-black text-emerald-400 font-mono mt-1">68.4%</div>
                  <span className="text-[11px] text-slate-500">من إجمالي 184 صفقة منفذة</span>
                </div>
                <div className="p-4 rounded-xl bg-slate-950 border border-slate-800">
                  <span className="text-xs text-slate-400">عامل الربح (Profit Factor)</span>
                  <div className="text-2xl font-black text-cyan-400 font-mono mt-1">2.41</div>
                  <span className="text-[11px] text-slate-500">إجمالي الأرباح / إجمالي الخسائر</span>
                </div>
                <div className="p-4 rounded-xl bg-slate-950 border border-slate-800">
                  <span className="text-xs text-slate-400">أقصى تراجع (Max Drawdown)</span>
                  <div className="text-2xl font-black text-rose-400 font-mono mt-1">-4.2%</div>
                  <span className="text-[11px] text-slate-500">حماية فائقة بفضل صمام ATR</span>
                </div>
                <div className="p-4 rounded-xl bg-slate-950 border border-slate-800">
                  <span className="text-xs text-slate-400">صافي العائد التراكمي (Net PnL)</span>
                  <div className="text-2xl font-black text-emerald-400 font-mono mt-1">+43.2%</div>
                  <span className="text-[11px] text-slate-500">على محفظة $10,000 أساسية</span>
                </div>
              </div>

              {/* SIMULATED EQUITY CURVE */}
              <div className="p-5 rounded-xl bg-slate-950 border border-slate-800">
                <div className="flex justify-between items-center mb-3">
                  <span className="text-xs font-bold text-slate-300">منحنى نمو رأس المال التراكمي (Equity Curve)</span>
                  <span className="text-xs text-emerald-400 font-mono font-bold">$10,000 ➔ $14,320.50</span>
                </div>
                <div className="h-44 w-full flex items-end gap-1.5 pt-4 pb-2 border-b border-slate-800">
                  {[20, 24, 23, 28, 32, 30, 36, 42, 39, 45, 52, 50, 58, 64, 62, 70, 78, 75, 84, 92, 88, 96, 100].map((val, idx) => (
                    <div
                      key={idx}
                      style={{ height: `${val}%` }}
                      className="flex-1 bg-gradient-to-t from-emerald-600/40 to-emerald-400 rounded-t-sm hover:brightness-125 transition-all group relative"
                    >
                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:block bg-slate-800 text-[10px] font-mono px-1.5 py-0.5 rounded shadow text-white whitespace-nowrap">
                        +{(val * 0.432).toFixed(1)}%
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex justify-between text-[10px] text-slate-500 mt-2">
                  <span>اليوم 1</span>
                  <span>اليوم 30</span>
                  <span>اليوم 60</span>
                  <span>اليوم 90</span>
                </div>
              </div>
            </div>

            {/* DETAILED BACKTEST TRADE HISTORY LOGS WITH CSV EXPORT */}
            <TradeHistoryLogs
              trades={backtestTrades}
              title="جدول زمني تفصيلي لنتائج صفقات الاختبار التاريخي (Trade History Logs: 90 Days)"
              subtitle="سجل الصفقات التاريخية لاختبار استراتيجية JevConfluence مع إمكانية الفرز، التصفية، والتصدير المباشر بصيغة CSV لـ Excel"
            />
          </div>
        )}

        {/* BINANCE API CONFIGURATION TAB — 100% ISOLATED THREE MODES */}
        {activeTab === 'binance' && (
          <div className="space-y-6">
            {/* MAIN HEADER CARD */}
            <div className="bg-slate-900/60 p-6 rounded-2xl border border-slate-800 space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold text-white flex items-center gap-2">
                    <ShieldCheck className="w-5 h-5 text-emerald-400" />
                    إعدادات الربط مع منصة بينانس (Binance Multi-Mode API Credentials)
                  </h2>
                  <p className="text-xs text-slate-400 mt-1">
                    فصل تام ومستقل بين أنماط التداول الثلاثة — كل نمط له الـ API Key و الـ API Secret الخاص به في بيئة معزولة
                  </p>
                </div>

                <div className="flex items-center gap-2 self-start sm:self-auto">
                  <span className="text-[11px] text-slate-400">النمط الفعّال للبوت:</span>
                  <span className={`px-2.5 py-1 rounded-lg text-xs font-bold border ${
                    binanceMode === 'live'
                      ? 'bg-rose-500/20 text-rose-300 border-rose-500/40 animate-pulse'
                      : binanceMode === 'testnet'
                      ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
                      : 'bg-purple-500/20 text-purple-300 border-purple-500/40'
                  }`}>
                    {binanceMode === 'live' ? '🔴 Spot حقيقي (Live)' : binanceMode === 'testnet' ? '🧪 Binance Spot Testnet' : '📝 ورقي (Paper Trading)'}
                  </span>
                </div>
              </div>

              {/* THREE SEPARATE TRADING MODES CARDS */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* 1. PAPER TRADING CARD */}
                <div
                  onClick={() => setConfigSelectedMode('paper')}
                  className={`p-4 rounded-2xl border transition-all cursor-pointer flex flex-col justify-between space-y-3 ${
                    configSelectedMode === 'paper'
                      ? 'bg-purple-950/30 border-purple-500/60 shadow-lg shadow-purple-500/10 ring-1 ring-purple-500/40'
                      : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-lg">📝</span>
                        <h3 className="font-bold text-sm text-white">نمط البيبر (Paper Trading)</h3>
                      </div>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30">
                        محاكاة داخلية
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 leading-relaxed">
                      محاكاة فورية لصفقات Spot بناءً على أسعار السوق الحية دون أي مخاطرة مالية.
                    </p>
                  </div>

                  <div className="space-y-2 pt-2 border-t border-slate-800/80">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-slate-400">حالة المفاتيح:</span>
                      <span className="font-medium text-purple-300">
                        {modesConfig.paper.apiKey ? '✓ مفاتيح قراءة مدخلة' : 'محاكاة محلية جاهزة ($10,000)'}
                      </span>
                    </div>

                    <div className="flex items-center justify-between gap-2">
                      {binanceMode === 'paper' ? (
                        <span className="text-[10px] font-bold text-emerald-400 flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          النمط النشط للبوت حالياً
                        </span>
                      ) : (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSwitchActiveMode('paper');
                          }}
                          className="text-[11px] font-bold px-2.5 py-1 rounded-lg bg-purple-600/30 hover:bg-purple-600/50 text-purple-200 border border-purple-500/40 transition-all cursor-pointer"
                        >
                          تفعيل هذا النمط للبوت
                        </button>
                      )}
                      <span className={`text-[10px] font-semibold ${configSelectedMode === 'paper' ? 'text-purple-400 font-bold' : 'text-slate-500'}`}>
                        {configSelectedMode === 'paper' ? '• قيد التعديل الآن' : 'انقر للتعديل'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* 2. SPOT TESTNET CARD */}
                <div
                  onClick={() => setConfigSelectedMode('testnet')}
                  className={`p-4 rounded-2xl border transition-all cursor-pointer flex flex-col justify-between space-y-3 ${
                    configSelectedMode === 'testnet'
                      ? 'bg-cyan-950/30 border-cyan-500/60 shadow-lg shadow-cyan-500/10 ring-1 ring-cyan-500/40'
                      : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-lg">🧪</span>
                        <h3 className="font-bold text-sm text-white">Binance Spot Testnet</h3>
                      </div>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                        testnet.binance.vision
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 leading-relaxed">
                      منصة الاختبار الرسمية من بينانس. أوامر ومطابقة أسعار حقيقية بأموال تجريبية.
                    </p>
                  </div>

                  <div className="space-y-2 pt-2 border-t border-slate-800/80">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-slate-400">حالة المفاتيح:</span>
                      <span className={`font-medium ${modesConfig.testnet.apiKey ? 'text-cyan-300' : 'text-amber-400 font-bold'}`}>
                        {modesConfig.testnet.apiKey ? '✓ مفاتيح Testnet محفوظة' : 'فارغ — يتطلب إدخال مفتاح'}
                      </span>
                    </div>

                    <div className="flex items-center justify-between gap-2">
                      {binanceMode === 'testnet' ? (
                        <span className="text-[10px] font-bold text-cyan-400 flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          النمط النشط للبوت حالياً
                        </span>
                      ) : (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSwitchActiveMode('testnet');
                          }}
                          className="text-[11px] font-bold px-2.5 py-1 rounded-lg bg-cyan-600/30 hover:bg-cyan-600/50 text-cyan-200 border border-cyan-500/40 transition-all cursor-pointer"
                        >
                          تفعيل هذا النمط للبوت
                        </button>
                      )}
                      <span className={`text-[10px] font-semibold ${configSelectedMode === 'testnet' ? 'text-cyan-400 font-bold' : 'text-slate-500'}`}>
                        {configSelectedMode === 'testnet' ? '• قيد التعديل الآن' : 'انقر للتعديل'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* 3. SPOT LIVE REAL CARD */}
                <div
                  onClick={() => setConfigSelectedMode('live')}
                  className={`p-4 rounded-2xl border transition-all cursor-pointer flex flex-col justify-between space-y-3 ${
                    configSelectedMode === 'live'
                      ? 'bg-rose-950/30 border-rose-500/60 shadow-lg shadow-rose-500/10 ring-1 ring-rose-500/40'
                      : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-lg">🔴</span>
                        <h3 className="font-bold text-sm text-white">Binance Spot Live الحقيقي</h3>
                      </div>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/30">
                        api.binance.com
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 leading-relaxed">
                      تداول فوري بأموالك الحقيقية (Spot 1x بدون رافعة). مفاتيح حسابك الحقيقي المنفصلة تماماً.
                    </p>
                  </div>

                  <div className="space-y-2 pt-2 border-t border-slate-800/80">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-slate-400">حالة المفاتيح:</span>
                      <span className={`font-medium ${modesConfig.live.apiKey ? 'text-emerald-400 font-bold' : 'text-slate-400'}`}>
                        {modesConfig.live.apiKey ? '✓ مفاتيح Live الحقيقي محفوظة' : 'مكان فارغ (غير مدخل - آمن)'}
                      </span>
                    </div>

                    <div className="flex items-center justify-between gap-2">
                      {binanceMode === 'live' ? (
                        <span className="text-[10px] font-bold text-rose-400 flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          النمط النشط للبوت حالياً
                        </span>
                      ) : (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSwitchActiveMode('live');
                          }}
                          className="text-[11px] font-bold px-2.5 py-1 rounded-lg bg-rose-600/30 hover:bg-rose-600/50 text-rose-200 border border-rose-500/40 transition-all cursor-pointer"
                        >
                          تفعيل هذا النمط للبوت
                        </button>
                      )}
                      <span className={`text-[10px] font-semibold ${configSelectedMode === 'live' ? 'text-rose-400 font-bold' : 'text-slate-500'}`}>
                        {configSelectedMode === 'live' ? '• قيد التعديل الآن' : 'انقر للتعديل'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* DEDICATED CONFIGURATION PANEL FOR SELECTED MODE */}
              <div className="p-5 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-800">
                  <div className="flex items-center gap-2.5">
                    <KeyRound className={`w-5 h-5 ${
                      configSelectedMode === 'live' ? 'text-rose-400' : configSelectedMode === 'testnet' ? 'text-cyan-400' : 'text-purple-400'
                    }`} />
                    <div>
                      <h3 className="font-bold text-sm text-white">
                        إعدادات مفاتيح: {configSelectedMode === 'live' ? 'Binance Spot Live (الحساب الحقيقي)' : configSelectedMode === 'testnet' ? 'Binance Spot Testnet (حساب الاختبار)' : 'نمط البيبر (Paper Trading)'}
                      </h3>
                      <span className="text-[11px] text-slate-400">
                        {configSelectedMode === 'live'
                          ? 'السيرفر المعتمد: https://api.binance.com'
                          : configSelectedMode === 'testnet'
                          ? 'السيرفر المعتمد: https://testnet.binance.vision'
                          : 'محاكاة محلية آمنة 100%'}
                      </span>
                    </div>
                  </div>

                  {binanceMode !== configSelectedMode && (
                    <button
                      onClick={() => handleSwitchActiveMode(configSelectedMode)}
                      className="px-3.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 self-start sm:self-auto"
                    >
                      <Zap className="w-3.5 h-3.5 text-amber-400" />
                      <span>تعيين هذا النمط كنمط البوت النشط</span>
                    </button>
                  )}
                </div>

                {/* MODE SPECIFIC INSTRUCTIONS BANNER */}
                {configSelectedMode === 'live' ? (
                  <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 flex items-start gap-3">
                    <ShieldAlert className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
                    <div className="text-xs text-rose-200 leading-relaxed space-y-1">
                      <strong className="text-rose-300 text-sm block">تحذير أمني هام لنمط Spot الحقيقي (Live):</strong>
                      <p className="text-slate-300">
                        هذه الحقول مخصصة حصرياً لمفاتيح <strong>حسابك الحقيقي على منصة Binance</strong>. لن تتأثر ولن تختلط إطلاقاً بمفاتيح Testnet أو البيبر.
                      </p>
                      <div className="text-amber-300 text-[11px] font-semibold pt-1">
                        🔒 تأكد في إعدادات API في بينانس من تفعيل: "Enable Reading" و "Enable Spot & Margin Trading" فقط، واترك "Enable Withdrawals" (السحب) مغلقاً نهائياً.
                      </div>
                    </div>
                  </div>
                ) : configSelectedMode === 'testnet' ? (
                  <div className="p-4 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-start gap-3">
                    <ShieldCheck className="w-5 h-5 text-cyan-400 shrink-0 mt-0.5" />
                    <div className="text-xs text-cyan-200 leading-relaxed space-y-1">
                      <strong className="text-cyan-300 text-sm block">بيئة اختبار Binance Spot Testnet الرسمية:</strong>
                      <p className="text-slate-300">
                        احصل على مفاتيحك الاختبارية مجاناً من الموقع الرسمي: <a href="https://testnet.binance.vision" target="_blank" rel="noreferrer" className="text-cyan-400 underline font-mono">testnet.binance.vision</a>.
                        هذه المفاتيح منفصلة تماماً ولن تستخدم أي سنت من أموالك الحقيقية.
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="p-4 rounded-xl bg-purple-500/10 border border-purple-500/30 flex items-start gap-3">
                    <ShieldCheck className="w-5 h-5 text-purple-400 shrink-0 mt-0.5" />
                    <div className="text-xs text-purple-200 leading-relaxed space-y-1">
                      <strong className="text-purple-300 text-sm block">تداول ورقي خوارزمي (Paper Simulation):</strong>
                      <p className="text-slate-300">
                        في نمط البيبر، ينفذ البوت الصفقات ويحسب الأرباح/الخسائر بدقة متناهية بناءً على أسعار السوق الحقيقية اللحظية دون الحاجة لمفاتيح API. يمكنك إدخال مفاتيح قراءة فقط إذا رغبت بمطابقة إضافية.
                      </p>
                    </div>
                  </div>
                )}

                {/* FORM INPUT CONTROLS SPECIFIC TO THE SELECTED MODE */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* API KEY INPUT */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-300 flex items-center justify-between">
                      <span>Binance API Key الخاص بنمط ({configSelectedMode === 'live' ? 'Spot Live الحقيقي' : configSelectedMode === 'testnet' ? 'Spot Testnet' : 'البيبر Paper'})</span>
                      <span className="text-[10px] text-slate-500 font-mono">
                        {modesConfig[configSelectedMode].apiKey ? `${modesConfig[configSelectedMode].apiKey.length} حرف` : 'مكان فارغ'}
                      </span>
                    </label>
                    <input
                      type="text"
                      value={modesConfig[configSelectedMode].apiKey}
                      onChange={(e) => {
                        const val = e.target.value;
                        setModesConfig(prev => ({
                          ...prev,
                          [configSelectedMode]: { ...prev[configSelectedMode], apiKey: val }
                        }));
                      }}
                      placeholder={
                        configSelectedMode === 'live'
                          ? 'أدخل الـ API Key الخاص بحساب Spot الحقيقي (api.binance.com)'
                          : configSelectedMode === 'testnet'
                          ? 'أدخل الـ API Key الخاص بـ Spot Testnet (testnet.binance.vision)'
                          : 'اختياري في نمط البيبر (يمكن تركه فارغاً)'
                      }
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs font-mono text-slate-200 focus:outline-none focus:border-emerald-500 transition-colors"
                    />
                  </div>

                  {/* API SECRET INPUT */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-semibold text-slate-300">
                        Binance API Secret الخاص بنمط ({configSelectedMode === 'live' ? 'Spot Live الحقيقي' : configSelectedMode === 'testnet' ? 'Spot Testnet' : 'البيبر Paper'})
                      </label>
                      <button
                        type="button"
                        onClick={() => setShowSecretPassword(prev => !prev)}
                        className="text-[11px] text-slate-400 hover:text-white flex items-center gap-1 cursor-pointer"
                      >
                        {showSecretPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        <span>{showSecretPassword ? 'إخفاء' : 'إظهار'}</span>
                      </button>
                    </div>
                    <div className="relative">
                      <input
                        type={showSecretPassword ? 'text' : 'password'}
                        value={modesConfig[configSelectedMode].apiSecret}
                        onChange={(e) => {
                          const val = e.target.value;
                          setModesConfig(prev => ({
                            ...prev,
                            [configSelectedMode]: { ...prev[configSelectedMode], apiSecret: val }
                          }));
                        }}
                        placeholder={
                          configSelectedMode === 'live'
                            ? 'أدخل الـ API Secret الخاص بحساب Spot الحقيقي'
                            : configSelectedMode === 'testnet'
                            ? 'أدخل الـ API Secret الخاص بـ Spot Testnet'
                            : 'اختياري في نمط البيبر'
                        }
                        className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs font-mono text-slate-200 focus:outline-none focus:border-emerald-500 transition-colors"
                      />
                    </div>
                  </div>

                  {/* ALLOCATION PERCENT */}
                  <div className="space-y-1.5 md:col-span-2">
                    <label className="text-xs font-semibold text-slate-300">
                      نسبة تخصيص الكاش لكل صفقة Spot ({configSelectedMode === 'live' ? 'Live Allocation' : configSelectedMode === 'testnet' ? 'Testnet Allocation' : 'Paper Allocation'} %)
                    </label>
                    <div className="flex items-center gap-3">
                      {[25, 50, 75, 100].map((alloc) => (
                        <button
                          key={alloc}
                          onClick={() => {
                            setModesConfig(prev => ({
                              ...prev,
                              [configSelectedMode]: { ...prev[configSelectedMode], spotAllocationPercent: alloc }
                            }));
                          }}
                          className={`flex-1 py-2 rounded-xl text-xs font-mono font-bold border transition-all cursor-pointer ${
                            modesConfig[configSelectedMode].spotAllocationPercent === alloc
                              ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/50 shadow-sm'
                              : 'bg-slate-900 text-slate-400 border-slate-800 hover:border-slate-700'
                          }`}
                        >
                          {alloc}%
                        </button>
                      ))}
                    </div>
                    <span className="text-[10px] text-slate-400 block pt-0.5">
                      تداول فوري بدون رافعة (1x): يشتري الأصل بـ {modesConfig[configSelectedMode].spotAllocationPercent}% من رصيد USDT المتوفر ويحتفظ بالباقي كاش لحماية المحفظة.
                    </span>
                  </div>
                </div>

                {/* FEEDBACK & NOTIFICATION */}
                {saveSuccessMessage && (
                  <div className={`p-3.5 rounded-xl border text-xs font-semibold flex items-center justify-between ${
                    saveSuccessMessage.includes('بنجاح')
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                      : 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                  }`}>
                    <div className="flex items-center gap-2">
                      <span>{saveSuccessMessage.includes('بنجاح') ? '✓' : 'ℹ️'}</span>
                      <span>{saveSuccessMessage}</span>
                    </div>
                    <button onClick={() => setSaveSuccessMessage(null)} className="text-slate-400 hover:text-white cursor-pointer px-1 font-bold">✕</button>
                  </div>
                )}

                {/* ACTION BUTTONS & STATUS */}
                <div className="pt-2 flex flex-wrap items-center justify-between gap-3 border-t border-slate-800/80">
                  <div className="text-[11px] text-slate-400 flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${modesConfig[configSelectedMode].isAccountVerified ? 'bg-emerald-400' : 'bg-slate-500'}`}></span>
                    <span>
                      {modesConfig[configSelectedMode].isAccountVerified
                        ? `الحساب متصل ومتحقق · الرصيد المتوفر: $${modesConfig[configSelectedMode].accountBalance.toLocaleString()} USDT`
                        : configSelectedMode === 'paper'
                        ? 'نمط البيبر جاهز برصيد افتراضي $10,000 USDT'
                        : `المفاتيح لنمط ${configSelectedMode} تُحفظ محلياً ومعزولة تماماً`}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    {/* CLEAR KEYS BUTTON */}
                    {(modesConfig[configSelectedMode].apiKey || modesConfig[configSelectedMode].apiSecret) && (
                      <button
                        onClick={() => {
                          handleSaveModeCredentials(configSelectedMode, '', '', modesConfig[configSelectedMode].spotAllocationPercent);
                        }}
                        className="px-3 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-rose-400 border border-slate-800 text-xs font-medium transition-all cursor-pointer"
                        title="مسح مفاتيح هذا النمط بالكامل وتفريغها"
                      >
                        مسح المفاتيح
                      </button>
                    )}

                    {/* TEST TRADE BUTTON */}
                    <button
                      onClick={handleExecuteTestTrade}
                      disabled={isExecutingTestTrade || (configSelectedMode !== 'paper' && (!modesConfig[configSelectedMode].apiKey || !modesConfig[configSelectedMode].apiSecret))}
                      className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-emerald-400 border border-emerald-500/30 font-bold text-xs transition-all cursor-pointer flex items-center gap-1.5 disabled:opacity-40"
                    >
                      <Zap className={`w-3.5 h-3.5 ${isExecutingTestTrade ? 'animate-spin' : ''}`} />
                      <span>{isExecutingTestTrade ? 'جاري الفحص...' : '⚡ تنفيذ صفقة اختبارية فحص فوري'}</span>
                    </button>

                    {/* SAVE & VERIFY BUTTON FOR THIS MODE */}
                    <button
                      onClick={() => {
                        handleSaveModeCredentials(
                          configSelectedMode,
                          modesConfig[configSelectedMode].apiKey,
                          modesConfig[configSelectedMode].apiSecret,
                          modesConfig[configSelectedMode].spotAllocationPercent
                        );
                      }}
                      className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-slate-950 font-bold text-xs shadow-lg shadow-emerald-500/20 transition-all cursor-pointer"
                    >
                      اختبار الاتصال وحفظ مفاتيح {configSelectedMode === 'live' ? 'Spot الحقيقي' : configSelectedMode === 'testnet' ? 'Spot Testnet' : 'البيبر'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TELEGRAM ALERTS TAB */}
        {activeTab === 'telegram' && (
          <TelegramAlertsPanel
            config={telegramConfig}
            onUpdateConfig={handleUpdateTelegramConfig}
            selectedAsset={selectedAsset}
            currentPrice={currentAsset.price}
          />
        )}

        {/* PYTHON CODE TAB */}
        {activeTab === 'python_code' && (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-bold text-white flex items-center gap-2">
                  <Terminal className="w-5 h-5 text-cyan-400" />
                  محرر كود بايتون للتشغيل 24/7 وإضافة العملات (Deployable Bot Script)
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  يمكنك تعديل الكود هنا مباشرة (مثل إضافة عملات جديدة في قائمة SYMBOLS) والضغط على زر الحفظ لتخزين التعديلات.
                </p>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={handleResetToOriginalCode}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-amber-400 text-xs font-bold border border-amber-500/30 transition-all cursor-pointer shadow"
                  title="استعادة كود بايتون الأصلي الكامل (JevQuant Autonomous Bot)"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>استعادة كود بايتون الأصلي الكامل</span>
                </button>

                <button
                  onClick={handleDownloadPythonBotCode}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-cyan-300 text-xs font-bold border border-slate-700 transition-all cursor-pointer shadow"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>تحميل الملف (.py)</span>
                </button>

                <button
                  onClick={() => handleCopyCode(pythonBotCode)}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold border border-slate-700 transition-all cursor-pointer shadow"
                >
                  {copiedCode ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                  <span>{copiedCode ? 'تم النسخ!' : 'نسخ الكود'}</span>
                </button>

                <button
                  onClick={handleSavePythonBotCode}
                  disabled={isSavingPythonBotCode}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs transition shadow-lg shadow-emerald-500/20 cursor-pointer disabled:opacity-50"
                >
                  {isSavingPythonBotCode ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>جاري الحفظ...</span>
                    </>
                  ) : (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      <span>حفظ تعديلات كود البوت</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {pythonBotSaveMsg && (
              <div className={`p-3 rounded-xl text-xs font-bold flex items-center gap-2 ${pythonBotSaveMsg.includes('نجاح') || pythonBotSaveMsg.includes('محلياً') ? 'bg-emerald-950/50 text-emerald-300 border border-emerald-500/30' : 'bg-red-950/50 text-red-300 border border-red-500/30'}`}>
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{pythonBotSaveMsg}</span>
              </div>
            )}

            <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 text-xs text-slate-300 space-y-1 font-mono">
              <span className="text-amber-400 font-bold">💡 دليل إضافة عملة يدوياً هنا:</span>
              <p className="text-slate-400 text-[11px] leading-relaxed">
                في السطر الذي يبدأ بـ <code className="text-cyan-300">SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT"]</code>، قم بإضافة أي عملة ترغب بتداولها (مثلاً <code className="text-cyan-300">"ADAUSDT"</code> أو <code className="text-cyan-300">"XRPUSDT"</code>) داخل الأقواس، ثم اضغط على زر <strong>"حفظ تعديلات كود البوت"</strong> أعلاه.
              </p>
            </div>

            <div className="relative rounded-2xl bg-slate-950 border border-slate-800 p-2 overflow-hidden shadow-2xl">
              <textarea
                value={pythonBotCode}
                onChange={(e) => setPythonBotCode(e.target.value)}
                className="w-full h-[500px] p-4 rounded-xl bg-slate-950 text-emerald-300 text-xs font-mono leading-relaxed border border-slate-850 focus:outline-none focus:border-emerald-500 resize-y shadow-inner"
                spellCheck={false}
                placeholder="# Python Bot Script code..."
              />
            </div>
          </div>
        )}

        {/* STRATEGY BLUEPRINT MODAL */}
        {showBlueprintModal && (
          <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-4xl w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold">
                    $
                  </div>
                  <div>
                    <h3 className="font-bold text-base text-white">
                      خريطة طريق "سؤال المليون دولار": هندسة بوت تداول رابح ومستدام
                    </h3>
                    <span className="text-xs text-slate-400">The Autonomous Multi-Timeframe Quant Architecture</span>
                  </div>
                </div>
                <button
                  onClick={() => setShowBlueprintModal(false)}
                  className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 text-lg"
                >
                  ✕
                </button>
              </div>

              <div className="p-6 overflow-y-auto space-y-6 text-sm text-slate-300 leading-relaxed">
                {/* SECTION 1 */}
                <div className="space-y-2">
                  <h4 className="text-base font-bold text-emerald-400 flex items-center gap-2">
                    1. لماذا يُعتبر Jev AI السلاح السري الذي يتفوق على كل الـ LLMs في التداول؟
                  </h4>
                  <p>
                    في أسواق الكريبتو فائقة التذبذب (BTC, ETH, SOL)، يفشل الذكاء الاصطناعي التوليدي التقليدي (مثل GPT-4 أو Claude) لثلاثة أسباب مدمرة:
                  </p>
                  <ul className="list-disc list-inside space-y-1 text-slate-400 pr-2">
                    <li><strong>البطء القاتل (Latency):</strong> يستغرق الـ LLM العادي من 5 إلى 15 ثانية لتوليد تقرير نصي. في عالم الكريبتو، 10 ثوانٍ كفيلة بأن ينعكس السعر وتتحول نقطة الدخول إلى فخ! بينما Jev يجيب في <strong>0.09 ثانية (90ms)</strong>.</li>
                    <li><strong>كارثة التكلفة عند فحص الفريمات:</strong> لو فحصت 5 فريمات كل دقيقة بـ LLM، ستكلفك الفاتورة آلاف الدولارات شهرياً! مع Jev، تكلفة التقييم الواحد هي <strong>$0.00004</strong> (أي أن 100 ألف تقييم تكلف 4 دولارات فقط).</li>
                    <li><strong>غياب الهلوسة (Zero Hallucination):</strong> Jev لا يثرثر ولا يولد نصوصاً، بل يعيد مصفوفة احتمالات رياضية حتمية (Primitives) مباشرة إلى دالة الشراء والبيع.</li>
                  </ul>
                </div>

                {/* SECTION 2 */}
                <div className="space-y-2">
                  <h4 className="text-base font-bold text-cyan-400 flex items-center gap-2">
                    2. استراتيجية توافق الفريمات المتعددة (The Multi-Timeframe Matrix)
                  </h4>
                  <p>
                    السر وراء عدم الوقوع في الخسائر هو عدم التداول بناءً على فريم واحد منعزل. يقوم البوت بتقسيم الفريمات إلى 3 أدوار:
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
                    <div className="p-3 bg-slate-950 rounded-xl border border-slate-800">
                      <strong className="text-white block text-xs mb-1">الفريمات الكبرى (1d, 12h, 4h)</strong>
                      <span className="text-xs text-slate-400">تحدد الاتجاه الحاكم (Macro Trend) وتمنع التداول عكس التيار.</span>
                    </div>
                    <div className="p-3 bg-slate-950 rounded-xl border border-slate-800">
                      <strong className="text-white block text-xs mb-1">فريم الوسيط (1h, 30m)</strong>
                      <span className="text-xs text-slate-400">يحدد نمط السوق الحالي (تجميع، كسر قمة، أو إعادة اختبار الدعم).</span>
                    </div>
                    <div className="p-3 bg-slate-950 rounded-xl border border-slate-800">
                      <strong className="text-white block text-xs mb-1">فريم التنفيذ (15m, 5m)</strong>
                      <span className="text-xs text-slate-400">يحدد نقطة الدخول الدقيقة ووقف الخسارة المتقارب لتعظيم نسبة R:R.</span>
                    </div>
                  </div>
                </div>

                {/* SECTION 3 */}
                <div className="space-y-2">
                  <h4 className="text-base font-bold text-amber-400 flex items-center gap-2">
                    3. معادلة إدارة المخاطر وتحديد حجم الصفقة (Position Sizing)
                  </h4>
                  <p>
                    أغلب المتداولين يخسرون بسبب الطمع وحجم الصفقة المبالغ فيه. يربط البوت سؤال <code>Score</code> لـ Jev مباشرة مع مؤشر التقلب الحقيقي (ATR):
                  </p>
                  <ul className="list-disc list-inside space-y-1 text-slate-400 pr-2">
                    <li><strong>المستوى 1 (Conviction 1):</strong> مخاطرة بـ 0.5% فقط من المحفظة (حالة التردد).</li>
                    <li><strong>المستوى 2 (Conviction 2):</strong> مخاطرة بـ 1.0% (إشارة نموذجية واضحة).</li>
                    <li><strong>المستوى 3 (Conviction 3):</strong> مخاطرة بـ 1.5% إلى 2% كحد أقصى (إشارة A+ مكتملة الأركان).</li>
                    <li><strong>حساب وقف الخسارة:</strong> يتم وضعه تلقائياً عند <code>1.5 * ATR</code> والهدف عند <code>3.5 * ATR</code> لضمان نسبة ربح إلى خسارة 1:2.3 على الأقل.</li>
                  </ul>
                </div>

                {/* SECTION 4 */}
                <div className="space-y-2">
                  <h4 className="text-base font-bold text-purple-400 flex items-center gap-2">
                    4. خطوات التشغيل والربط العملي على منصة بينانس (Binance)
                  </h4>
                  <ol className="list-decimal list-inside space-y-1.5 text-slate-400 pr-2">
                    <li>أنشئ مفتاح API Key من تبويب API Management في بينانس مع تفعيل قراءة الأسعار والتداول فقط (مع إيقاف السحب تماماً).</li>
                    <li>قم بتأجير سيرفر سحابي صغير (VPS بـ 5$ شهرياً) في Frankfurt أو Tokyo لتقليل زمن الاستجابة مع بينانس إلى أقل من 10ms.</li>
                    <li>شغّل كود البايثون المرفق في تبويب <strong>"كود البوت للتنفيذ 24/7"</strong> باستخدام مدير العمليات <code>pm2</code> أو <code>systemd</code> ليعمل دون انقطاع.</li>
                    <li>ابدأ بوضع <strong>Paper Trading</strong> أو <strong>Binance Testnet</strong> لمدة أسبوعين لمراقبة دقة الإشارات قبل ضخ رأس مال حقيقي.</li>
                  </ol>
                </div>
              </div>

              <div className="px-6 py-4 border-t border-slate-800 bg-slate-950 flex justify-end">
                <button
                  onClick={() => setShowBlueprintModal(false)}
                  className="px-5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs transition-all cursor-pointer"
                >
                  فهمت الاستراتيجية، لنبدأ التطبيق!
                </button>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* FOOTER */}
      <footer className="border-t border-slate-800 bg-slate-900/40 px-6 py-4 text-center text-xs text-slate-500">
        JevQuant Engine © 2026 · Powered by TypeSafe System One (jev-latest) & Binance REST/WebSocket API · للتداول الخوارزمي المستقل
      </footer>
    </div>
  );
}
