import React, { useEffect, useRef, useState, useMemo } from 'react';
import {
  createChart,
  ColorType,
  LineStyle,
  CandlestickSeries,
  HistogramSeries,
  IChartApi,
  ISeriesApi,
  IPriceLine,
  UTCTimestamp,
  CandlestickData,
  HistogramData,
} from 'lightweight-charts';
import { Maximize2, Minimize2, Layers, ShieldAlert, Target, Compass } from 'lucide-react';

export interface ChartTrade {
  id: string;
  asset: string;
  type: 'شراء Spot' | 'بيع للكاش (USDT)' | string;
  timeframe: string;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  status: 'OPEN' | 'CLOSED';
}

interface TradingViewChartProps {
  symbol: string;
  timeframe: string;
  currentPrice: number;
  atr: number;
  openTrades?: ChartTrade[];
  onTimeframeChange?: (tf: string) => void;
}

// Convert timeframe string to minute multiplier
function getTfSeconds(tf: string): number {
  switch (tf) {
    case '5m': return 5 * 60;
    case '15m': return 15 * 60;
    case '30m': return 30 * 60;
    case '1h': return 60 * 60;
    case '4h': return 4 * 60 * 60;
    case '12h': return 12 * 60 * 60;
    case '1d': return 24 * 60 * 60;
    case '1w': return 7 * 24 * 60 * 60;
    default: return 15 * 60;
  }
}

// Generate realistic initial historical OHLCV dataset
function generateHistoricalCandles(
  basePrice: number,
  atr: number,
  tfSeconds: number,
  count = 120
): { candles: CandlestickData<UTCTimestamp>[]; volumes: HistogramData<UTCTimestamp>[] } {
  const candles: CandlestickData<UTCTimestamp>[] = [];
  const volumes: HistogramData<UTCTimestamp>[] = [];
  
  const nowSec = Math.floor(Date.now() / 1000);
  const startTime = nowSec - count * tfSeconds;

  let currentClose = basePrice * 0.96; // start slightly below and trend towards basePrice

  for (let i = 0; i < count; i++) {
    const time = (startTime + i * tfSeconds) as UTCTimestamp;
    
    // Controlled random walk matching ATR scale
    const targetDelta = (basePrice - currentClose) * (0.05 + Math.random() * 0.05);
    const noise = (Math.random() - 0.48) * (atr * 0.4);
    const open = currentClose;
    let close = open + targetDelta + noise;
    if (i === count - 1) close = basePrice; // match current live price exactly on final candle

    const high = Math.max(open, close) + Math.random() * (atr * 0.25);
    const low = Math.min(open, close) - Math.random() * (atr * 0.25);

    const isUp = close >= open;
    candles.push({
      time,
      open: Number(open.toFixed(2)),
      high: Number(high.toFixed(2)),
      low: Number(low.toFixed(2)),
      close: Number(close.toFixed(2)),
    });

    const baseVol = basePrice > 1000 ? 45 : 320;
    const vol = Number((baseVol * (0.6 + Math.random() * 0.9)).toFixed(2));
    volumes.push({
      time,
      value: vol,
      color: isUp ? 'rgba(16, 185, 129, 0.4)' : 'rgba(244, 63, 94, 0.4)',
    });

    currentClose = close;
  }

  return { candles, volumes };
}

export const TradingViewChart: React.FC<TradingViewChartProps> = ({
  symbol,
  timeframe,
  currentPrice,
  atr,
  openTrades = [],
  onTimeframeChange,
}) => {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartApiRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);

  // OHLC hover readout state
  const [hoverOhlc, setHoverOhlc] = useState<{
    open: number;
    high: number;
    low: number;
    close: number;
    changePercent: number;
  } | null>(null);

  const [isFullscreen, setIsFullscreen] = useState(false);

  // Filter open trades matching current symbol
  const activeTrades = useMemo(() => {
    return openTrades.filter((t) => t.asset === symbol && t.status === 'OPEN');
  }, [openTrades, symbol]);

  // Initial Chart setup
  useEffect(() => {
    if (!chartContainerRef.current) return;

    // Clean up previous instance if any
    if (chartApiRef.current) {
      chartApiRef.current.remove();
      chartApiRef.current = null;
    }

    const container = chartContainerRef.current;
    const chart = createChart(container, {
      width: container.clientWidth,
      height: isFullscreen ? 580 : 420,
      layout: {
        background: { type: ColorType.Solid, color: '#090d16' },
        textColor: '#94a3b8',
        fontSize: 11,
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
      },
      grid: {
        vertLines: { color: 'rgba(30, 41, 59, 0.45)' },
        horzLines: { color: 'rgba(30, 41, 59, 0.45)' },
      },
      crosshair: {
        mode: 1, // Magnet crosshair
        vertLine: {
          color: 'rgba(148, 163, 184, 0.4)',
          width: 1,
          style: LineStyle.Dotted,
          labelBackgroundColor: '#1e293b',
        },
        horzLine: {
          color: 'rgba(148, 163, 184, 0.4)',
          width: 1,
          style: LineStyle.Dotted,
          labelBackgroundColor: '#1e293b',
        },
      },
      rightPriceScale: {
        borderColor: '#1e293b',
        scaleMargins: {
          top: 0.1,
          bottom: 0.22, // Reserve lower area for volume
        },
        autoScale: true,
      },
      timeScale: {
        borderColor: '#1e293b',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 12,
        barSpacing: 8,
      },
      handleScroll: {
        vertTouchDrag: false,
      },
    });

    chartApiRef.current = chart;

    // Candlestick Series (Emerald Up, Rose Down)
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#10b981',
      downColor: '#f43f5e',
      borderVisible: false,
      wickUpColor: '#10b981',
      wickDownColor: '#f43f5e',
      priceFormat: {
        type: 'price',
        precision: currentPrice < 10 ? 4 : currentPrice < 1000 ? 2 : 2,
        minMove: currentPrice < 10 ? 0.0001 : 0.01,
      },
    });
    candleSeriesRef.current = candleSeries;

    // Volume Series
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: '', // overlay
    });
    volumeSeries.priceScale().applyOptions({
      scaleMargins: {
        top: 0.8, // display in bottom 20%
        bottom: 0,
      },
    });
    volumeSeriesRef.current = volumeSeries;

    // Generate & feed historical bars
    const tfSec = getTfSeconds(timeframe);
    const { candles, volumes } = generateHistoricalCandles(currentPrice, atr, tfSec, 120);
    candleSeries.setData(candles);
    volumeSeries.setData(volumes);

    // Initial OHLC reading
    const lastBar = candles[candles.length - 1];
    if (lastBar) {
      setHoverOhlc({
        open: lastBar.open,
        high: lastBar.high,
        low: lastBar.low,
        close: lastBar.close,
        changePercent: Number((((lastBar.close - lastBar.open) / lastBar.open) * 100).toFixed(2)),
      });
    }

    // Subscribe to crosshair move for real-time OHLC inspection
    chart.subscribeCrosshairMove((param) => {
      if (!param || !param.time || !param.seriesData) {
        if (lastBar) {
          setHoverOhlc({
            open: lastBar.open,
            high: lastBar.high,
            low: lastBar.low,
            close: lastBar.close,
            changePercent: Number((((lastBar.close - lastBar.open) / lastBar.open) * 100).toFixed(2)),
          });
        }
        return;
      }
      const data = param.seriesData.get(candleSeries) as CandlestickData<UTCTimestamp> | undefined;
      if (data) {
        setHoverOhlc({
          open: data.open,
          high: data.high,
          low: data.low,
          close: data.close,
          changePercent: Number((((data.close - data.open) / data.open) * 100).toFixed(2)),
        });
      }
    });

    // Resize Observer for fluid responsiveness
    const resizeObserver = new ResizeObserver((entries) => {
      if (!entries || entries.length === 0 || !chartApiRef.current) return;
      const { width } = entries[0].contentRect;
      chartApiRef.current.applyOptions({ width });
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartApiRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
      priceLinesRef.current = [];
    };
  }, [symbol, timeframe, isFullscreen]);

  // Update latest candle on price tick
  useEffect(() => {
    if (!candleSeriesRef.current || !currentPrice) return;
    const nowSec = Math.floor(Date.now() / 1000);
    const tfSec = getTfSeconds(timeframe);
    const currentBarTime = (Math.floor(nowSec / tfSec) * tfSec) as UTCTimestamp;

    // Update active candle with new tick
    candleSeriesRef.current.update({
      time: currentBarTime,
      open: hoverOhlc ? hoverOhlc.open : currentPrice,
      high: Math.max(hoverOhlc ? hoverOhlc.high : currentPrice, currentPrice),
      low: Math.min(hoverOhlc ? hoverOhlc.low : currentPrice, currentPrice),
      close: currentPrice,
    });
  }, [currentPrice, timeframe]);

  // Draw or update interactive Horizontal Price Lines for active trades (Entry, SL, TP)
  useEffect(() => {
    const candleSeries = candleSeriesRef.current;
    if (!candleSeries) return;

    // Remove existing price lines
    priceLinesRef.current.forEach((line) => {
      try {
        candleSeries.removePriceLine(line);
      } catch (e) {
        // ignore if already destroyed
      }
    });
    priceLinesRef.current = [];

    // Add lines for all open trades on this asset
    activeTrades.forEach((trade) => {
      // 1. Entry Line (Solid Cyan / Emerald)
      const entryLine = candleSeries.createPriceLine({
        price: trade.entryPrice,
        color: '#06b6d4',
        lineWidth: 2,
        lineStyle: LineStyle.Solid,
        axisLabelVisible: true,
        title: 'سعر شراء SPOT',
      });
      priceLinesRef.current.push(entryLine);

      // 2. Stop Loss Line (Dashed Crimson - Exit to USDT Cash)
      if (trade.stopLoss > 0) {
        const slLine = candleSeries.createPriceLine({
          price: trade.stopLoss,
          color: '#f43f5e',
          lineWidth: 2,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: 'وقف وخروج للكاش (SL)',
        });
        priceLinesRef.current.push(slLine);
      }

      // 3. Take Profit Line (Dashed Emerald)
      if (trade.takeProfit > 0) {
        const tpLine = candleSeries.createPriceLine({
          price: trade.takeProfit,
          color: '#10b981',
          lineWidth: 2,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: 'هدف بيع وربح (TP)',
        });
        priceLinesRef.current.push(tpLine);
      }
    });
  }, [activeTrades, symbol]);

  const timeframes = ['5m', '15m', '30m', '1h', '4h', '1d'];

  return (
    <div className="bg-slate-900/90 rounded-2xl border border-slate-800/90 overflow-hidden shadow-2xl flex flex-col">
      {/* CHART HEADER: ASSET, OHLC READOUT & TIMEFRAME BAR */}
      <div className="px-4 py-3 border-b border-slate-800/80 bg-slate-950/70 flex flex-wrap items-center justify-between gap-3">
        {/* Left: Symbol & OHLC readout */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="font-extrabold text-sm text-white tracking-tight">{symbol}</span>
            <span className="text-[11px] font-mono text-emerald-400 font-bold">
              ${currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </span>
          </div>

          {/* Unboxed Metadata OHLC */}
          {hoverOhlc && (
            <div className="flex items-center gap-2 text-[11px] font-mono text-slate-400 tabular-nums">
              <span>O: <strong className="text-slate-200">{hoverOhlc.open.toFixed(2)}</strong></span>
              <span aria-hidden="true" className="text-slate-600">·</span>
              <span>H: <strong className="text-slate-200">{hoverOhlc.high.toFixed(2)}</strong></span>
              <span aria-hidden="true" className="text-slate-600">·</span>
              <span>L: <strong className="text-slate-200">{hoverOhlc.low.toFixed(2)}</strong></span>
              <span aria-hidden="true" className="text-slate-600">·</span>
              <span>C: <strong className={hoverOhlc.changePercent >= 0 ? 'text-emerald-400' : 'text-rose-400'}>{hoverOhlc.close.toFixed(2)}</strong></span>
              <span aria-hidden="true" className="text-slate-600">·</span>
              <span className={hoverOhlc.changePercent >= 0 ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                {hoverOhlc.changePercent >= 0 ? '+' : ''}{hoverOhlc.changePercent}%
              </span>
            </div>
          )}
        </div>

        {/* Right: Timeframe Segmented Controls & Fullscreen */}
        <div className="flex items-center gap-2">
          {onTimeframeChange && (
            <div className="flex items-center gap-1 bg-slate-900 p-1 rounded-lg border border-slate-800">
              {timeframes.map((tf) => (
                <button
                  key={tf}
                  onClick={() => onTimeframeChange(tf)}
                  className={`px-2 py-0.5 rounded text-[11px] font-semibold transition-all cursor-pointer ${
                    timeframe === tf
                      ? 'bg-emerald-500 text-slate-950 font-bold shadow'
                      : 'text-slate-400 hover:text-white hover:bg-slate-800'
                  }`}
                >
                  {tf}
                </button>
              ))}
            </div>
          )}

          <button
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white border border-slate-800 transition-colors cursor-pointer"
            title={isFullscreen ? 'إغلاق ملء الشاشة' : 'تكبير الرسم البياني'}
          >
            {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* ACTIVE TRADE LINES LEGEND */}
      {activeTrades.length > 0 && (
        <div className="px-4 py-1.5 bg-slate-950/95 border-b border-slate-800/60 flex items-center justify-between text-xs text-slate-300">
          <div className="flex items-center gap-4">
            <span className="text-[11px] font-semibold text-slate-400 flex items-center gap-1.5">
              <Compass className="w-3.5 h-3.5 text-cyan-400" />
              صفقة Spot المفتوحة ({activeTrades[0].type}):
            </span>
            <div className="flex items-center gap-3 text-[11px] font-mono tabular-nums">
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-0.5 bg-cyan-400 inline-block"></span>
                <span>سعر الشراء: <strong className="text-cyan-300">${activeTrades[0].entryPrice.toLocaleString()}</strong></span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-0.5 bg-rose-500 inline-block border-b border-rose-500 border-dashed"></span>
                <span className="flex items-center gap-1">
                  <ShieldAlert className="w-3 h-3 text-rose-400" />
                  الوقف للكاش (SL): <strong className="text-rose-400">${activeTrades[0].stopLoss.toLocaleString()}</strong>
                </span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-0.5 bg-emerald-400 inline-block border-b border-emerald-400 border-dashed"></span>
                <span className="flex items-center gap-1">
                  <Target className="w-3 h-3 text-emerald-400" />
                  هدف الربح (TP): <strong className="text-emerald-400">${activeTrades[0].takeProfit.toLocaleString()}</strong>
                </span>
              </span>
            </div>
          </div>
          <span className="text-[10px] text-cyan-400 bg-cyan-500/10 px-2 py-0.5 rounded border border-cyan-500/20 font-bold">
            خطوط تفاعلية على الشموع
          </span>
        </div>
      )}

      {/* CANVAS CONTAINER */}
      <div
        ref={chartContainerRef}
        className="w-full relative transition-all"
        style={{ height: isFullscreen ? '580px' : '420px' }}
      />
    </div>
  );
};
