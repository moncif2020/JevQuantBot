import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
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
import { Maximize2, Minimize2, ShieldAlert, Target, Compass, RefreshCw, Radio, CheckCircle2, Clock, Database, Check } from 'lucide-react';

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

export interface TimeframeConfig {
  targetCandles: number;
  label: string;
  badgeLabel: string;
  targetSpanDescription: string;
}

// Dynamic timeframe tiered range rule matching user's exact specification
export function getTimeframeConfig(tf: string): TimeframeConfig {
  switch (tf) {
    case '1w':
      return {
        targetCandles: 260, // 5 years of weekly candles
        label: '5 سنوات',
        badgeLabel: '5 سنوات',
        targetSpanDescription: 'سجل 5 سنوات كاملة (دورة ماكرو)',
      };
    case '1d':
      return {
        targetCandles: 1825, // 5 years of daily candles
        label: '3-5 سنوات',
        badgeLabel: '3-5 سنوات',
        targetSpanDescription: 'سجل 3 إلى 5 سنوات (دورة الهالفينج الكاملة)',
      };
    case '4h':
      return {
        targetCandles: 3500, // ~2.4 years of 4h candles
        label: '1.5-3 سنوات',
        badgeLabel: '1.5-3 سنوات',
        targetSpanDescription: 'سجل 1.5 إلى 3 سنوات (متوسط المدى)',
      };
    case '1h':
      return {
        targetCandles: 4500, // ~6.2 months up to 1.5 years
        label: 'سنة-1.5 سنة',
        badgeLabel: '1-1.5 سنة',
        targetSpanDescription: 'سجل سنة إلى 1.5 سنة',
      };
    case '30m':
      return {
        targetCandles: 3500, // 6 months to 1 year
        label: '6 أشهر-سنة',
        badgeLabel: '6 أشهر-سنة',
        targetSpanDescription: 'سجل 6 أشهر إلى سنة',
      };
    case '15m':
      return {
        targetCandles: 3000, // 2 months (60 days)
        label: 'شهران',
        badgeLabel: 'شهران (60 يوم)',
        targetSpanDescription: 'سجل شهرين (60 يوماً)',
      };
    case '5m':
      return {
        targetCandles: 2500, // 2 months / high precision
        label: 'شهران',
        badgeLabel: 'شهران (60 يوم)',
        targetSpanDescription: 'سجل شهرين (60 يوماً)',
      };
    default:
      return {
        targetCandles: 1000,
        label: 'سجل ممتد',
        badgeLabel: 'سجل ممتد',
        targetSpanDescription: 'سجل ممتد',
      };
  }
}

// Format UTC timestamp to readable Arabic/Gregorian date
function formatTimestampToDate(sec: number): string {
  try {
    const d = new Date(sec * 1000);
    return d.toLocaleDateString('ar-EG', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return '';
  }
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

// Generate realistic initial historical OHLCV dataset (offline fallback seed only)
function generateHistoricalCandles(
  basePrice: number,
  atr: number,
  tfSeconds: number,
  count = 200
): { candles: CandlestickData<UTCTimestamp>[]; volumes: HistogramData<UTCTimestamp>[] } {
  const candles: CandlestickData<UTCTimestamp>[] = [];
  const volumes: HistogramData<UTCTimestamp>[] = [];
  
  const nowSec = Math.floor(Date.now() / 1000);
  const startTime = nowSec - count * tfSeconds;

  let currentClose = basePrice * 0.96;

  for (let i = 0; i < count; i++) {
    const time = (startTime + i * tfSeconds) as UTCTimestamp;
    
    const targetDelta = (basePrice - currentClose) * (0.05 + Math.random() * 0.05);
    const noise = (Math.random() - 0.48) * (atr * 0.4);
    const open = currentClose;
    let close = open + targetDelta + noise;
    if (i === count - 1) close = basePrice;

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
  const isDisposedRef = useRef(false);
  const lastCandleRef = useRef<CandlestickData<UTCTimestamp> | null>(null);
  const hasCandlesLoadedRef = useRef(false);

  // Master candles & volume storage in ref to avoid full rerenders
  const candlesDataRef = useRef<{
    candles: CandlestickData<UTCTimestamp>[];
    volumes: HistogramData<UTCTimestamp>[];
  }>({ candles: [], volumes: [] });

  // Abort controller for background backfill requests
  const backfillAbortRef = useRef<AbortController | null>(null);

  // Keep price & ATR refs updated so effect callbacks don't depend on them reactively
  const currentPriceRef = useRef(currentPrice);
  currentPriceRef.current = currentPrice;
  const atrRef = useRef(atr);
  atrRef.current = atr;

  // OHLC hover readout state
  const [hoverOhlc, setHoverOhlc] = useState<{
    open: number;
    high: number;
    low: number;
    close: number;
    changePercent: number;
  } | null>(null);

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isLiveRealData, setIsLiveRealData] = useState(false);
  const [isLoadingKlines, setIsLoadingKlines] = useState(false);

  // Backfill progress status for user UI
  const [backfillState, setBackfillState] = useState<{
    isBackfilling: boolean;
    loadedCount: number;
    targetCount: number;
    oldestDateStr: string | null;
    percent: number;
  }>({
    isBackfilling: false,
    loadedCount: 0,
    targetCount: 1000,
    oldestDateStr: null,
    percent: 100,
  });

  // Filter open trades matching current symbol
  const activeTrades = useMemo(() => {
    return openTrades.filter((t) => t.asset === symbol && t.status === 'OPEN');
  }, [openTrades, symbol]);

  const activeTradesKey = useMemo(() => {
    return activeTrades.map((t) => `${t.id}-${t.entryPrice}-${t.stopLoss}-${t.takeProfit}`).join('|');
  }, [activeTrades]);

  // Safe setter for OHLC to prevent identity change re-renders
  const updateHoverOhlcSafely = useCallback((newOhlc: {
    open: number;
    high: number;
    low: number;
    close: number;
    changePercent: number;
  }) => {
    setHoverOhlc((prev) => {
      if (
        prev &&
        prev.open === newOhlc.open &&
        prev.high === newOhlc.high &&
        prev.low === newOhlc.low &&
        prev.close === newOhlc.close &&
        prev.changePercent === newOhlc.changePercent
      ) {
        return prev;
      }
      return newOhlc;
    });
  }, []);

  // Background backfill loop: pulls older historical batches safely with rate-limit protection
  const runBackgroundBackfill = useCallback(async (
    sym: string,
    tf: string,
    targetCount: number,
    candleSeries: ISeriesApi<'Candlestick'>,
    volumeSeries: ISeriesApi<'Histogram'>,
    signal: AbortSignal
  ) => {
    setBackfillState((prev) => ({ ...prev, isBackfilling: true, targetCount }));

    try {
      while (!signal.aborted && !isDisposedRef.current) {
        const currentCandles = candlesDataRef.current.candles;
        if (currentCandles.length >= targetCount) break;

        const oldestCandle = currentCandles[0];
        if (!oldestCandle) break;

        // Rate limit courtesy delay between background requests: 250ms (strictly protects against 429/bans)
        await new Promise((res) => setTimeout(res, 250));
        if (signal.aborted || isDisposedRef.current) break;

        const endTimeMs = (Number(oldestCandle.time) * 1000) - 1;
        const needed = targetCount - currentCandles.length;
        const batchLimit = Math.min(needed, 1000);

        const resp = await fetch(
          `/api/binance/klines?symbol=${sym}&interval=${tf}&limit=${batchLimit}&endTime=${endTimeMs}`,
          { signal }
        );
        if (!resp.ok) break;

        const data = await resp.json();
        if (signal.aborted || isDisposedRef.current) break;

        if (!data.candles || data.candles.length === 0) {
          // Reached the earliest historical candle available on Binance
          break;
        }

        const incomingCandles: CandlestickData<UTCTimestamp>[] = data.candles;
        const incomingVolumes: HistogramData<UTCTimestamp>[] = data.volumes || [];

        // Combine older candles with current
        const combinedCandles = [...incomingCandles, ...candlesDataRef.current.candles];
        const combinedVolumes = [...incomingVolumes, ...candlesDataRef.current.volumes];

        // Deduplicate and ensure ascending sort
        const mapCandles = new Map<number, CandlestickData<UTCTimestamp>>();
        combinedCandles.forEach((c) => mapCandles.set(Number(c.time), c));
        const sortedCandles = Array.from(mapCandles.values()).sort((a, b) => Number(a.time) - Number(b.time));

        const mapVolumes = new Map<number, HistogramData<UTCTimestamp>>();
        combinedVolumes.forEach((v) => mapVolumes.set(Number(v.time), v));
        const sortedVolumes = Array.from(mapVolumes.values()).sort((a, b) => Number(a.time) - Number(b.time));

        const addedCount = sortedCandles.length - currentCandles.length;
        candlesDataRef.current = { candles: sortedCandles, volumes: sortedVolumes };

        // Preserve user scroll/zoom view position by shifting logical range
        let currentRange: { from: number; to: number } | null = null;
        try {
          if (chartApiRef.current) {
            currentRange = chartApiRef.current.timeScale().getVisibleLogicalRange();
          }
        } catch (e) {}

        // Apply updated dataset
        candleSeries.setData(sortedCandles);
        volumeSeries.setData(sortedVolumes);

        if (currentRange && chartApiRef.current && addedCount > 0) {
          try {
            chartApiRef.current.timeScale().setVisibleLogicalRange({
              from: currentRange.from + addedCount,
              to: currentRange.to + addedCount,
            });
          } catch (e) {}
        }

        const oldestTime = sortedCandles[0]?.time;
        const oldestDateStr = oldestTime ? formatTimestampToDate(Number(oldestTime)) : null;
        const pct = Math.min(100, Math.round((sortedCandles.length / targetCount) * 100));

        setBackfillState({
          isBackfilling: sortedCandles.length < targetCount && incomingCandles.length === batchLimit,
          loadedCount: sortedCandles.length,
          targetCount,
          oldestDateStr,
          percent: pct,
        });

        // If fewer candles than batch limit returned, Binance has reached genesis for this pair
        if (incomingCandles.length < batchLimit) {
          break;
        }
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.warn('Background backfill notice:', err);
      }
    } finally {
      if (!signal.aborted) {
        setBackfillState((prev) => ({ ...prev, isBackfilling: false }));
      }
    }
  }, []);

  // Fetch real Binance klines: Instant 1000-candle view + non-blocking background backfill + silent live sync
  const loadBinanceCandles = useCallback(async (
    candleSeries: ISeriesApi<'Candlestick'>,
    volumeSeries: ISeriesApi<'Histogram'>,
    isCancelled?: () => boolean,
    isSilentBackgroundSync = false,
    forceReload = false
  ) => {
    try {
      const cleanSymbol = symbol.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
      const tfConfig = getTimeframeConfig(timeframe);

      // 1. Silent 15s Background Sync: only updates newest bar(s) without resetting anything
      if (isSilentBackgroundSync && hasCandlesLoadedRef.current && lastCandleRef.current) {
        const resp = await fetch(`/api/binance/klines?symbol=${cleanSymbol}&interval=${timeframe}&limit=10`);
        if (isDisposedRef.current || (isCancelled && isCancelled()) || !resp.ok) return false;

        const data = await resp.json();
        if (data.candles && data.candles.length > 0) {
          const incomingBars: CandlestickData<UTCTimestamp>[] = data.candles;
          const incomingVols = data.volumes || [];
          const lastLocalTime = lastCandleRef.current.time as number;

          const newBars = incomingBars.filter((c) => (c.time as number) >= lastLocalTime);
          if (newBars.length > 0) {
            newBars.forEach((bar) => {
              candleSeries.update(bar);
            });
            if (incomingVols.length > 0) {
              const newVols = incomingVols.filter((v: any) => (v.time as number) >= lastLocalTime);
              newVols.forEach((v: any) => {
                volumeSeries.update(v);
              });
            }
            lastCandleRef.current = newBars[newBars.length - 1];
          } else {
            const latestBar = incomingBars[incomingBars.length - 1];
            candleSeries.update(latestBar);
            lastCandleRef.current = latestBar;
          }

          const currentLast = lastCandleRef.current;
          if (currentLast) {
            updateHoverOhlcSafely({
              open: currentLast.open,
              high: currentLast.high,
              low: currentLast.low,
              close: currentLast.close,
              changePercent: Number((((currentLast.close - currentLast.open) / currentLast.open) * 100).toFixed(2)),
            });
          }
        }
        return true;
      }

      // 2. Initial Mount or Timeframe/Symbol Switch: Instant view with 1000 candles
      if (!hasCandlesLoadedRef.current || forceReload) {
        setIsLoadingKlines(true);
      }

      // Abort any ongoing backfill from previous timeframe or symbol
      if (backfillAbortRef.current) {
        backfillAbortRef.current.abort();
      }
      const abortController = new AbortController();
      backfillAbortRef.current = abortController;

      // Initial batch limit (instant 1000 candles)
      const initialLimit = Math.min(tfConfig.targetCandles, 1000);
      const resp = await fetch(`/api/binance/klines?symbol=${cleanSymbol}&interval=${timeframe}&limit=${initialLimit}`, {
        signal: abortController.signal,
      });

      if (isDisposedRef.current || (isCancelled && isCancelled())) return false;

      if (resp.ok) {
        const data = await resp.json();
        if (isDisposedRef.current || (isCancelled && isCancelled())) return false;

        if (data.candles && data.candles.length > 0) {
          candleSeries.setData(data.candles);
          volumeSeries.setData(data.volumes || []);

          candlesDataRef.current = {
            candles: data.candles,
            volumes: data.volumes || [],
          };

          const lastBar = data.candles[data.candles.length - 1];
          if (lastBar) {
            lastCandleRef.current = lastBar;
            updateHoverOhlcSafely({
              open: lastBar.open,
              high: lastBar.high,
              low: lastBar.low,
              close: lastBar.close,
              changePercent: Number((((lastBar.close - lastBar.open) / lastBar.open) * 100).toFixed(2)),
            });
          }
          hasCandlesLoadedRef.current = true;
          setIsLiveRealData(true);

          const oldestSec = data.candles[0]?.time;
          const oldestDateStr = oldestSec ? formatTimestampToDate(Number(oldestSec)) : null;
          const pct = Math.min(100, Math.round((data.candles.length / tfConfig.targetCandles) * 100));

          setBackfillState({
            isBackfilling: tfConfig.targetCandles > data.candles.length && data.hasMore !== false,
            loadedCount: data.candles.length,
            targetCount: tfConfig.targetCandles,
            oldestDateStr,
            percent: pct,
          });

          // 3. Initiate background backfill if more historical candles are required
          if (data.candles.length < tfConfig.targetCandles && data.hasMore !== false) {
            runBackgroundBackfill(
              cleanSymbol,
              timeframe,
              tfConfig.targetCandles,
              candleSeries,
              volumeSeries,
              abortController.signal
            );
          }

          return true;
        }
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.warn('Real kline fetch fallback to simulated base', err);
      }
    } finally {
      if (!isSilentBackgroundSync) {
        setIsLoadingKlines(false);
      }
    }
    return false;
  }, [symbol, timeframe, updateHoverOhlcSafely, runBackgroundBackfill]);

  // 1. Initial Chart setup - Only once per component mount
  useEffect(() => {
    if (!chartContainerRef.current) return;
    isDisposedRef.current = false;
    let resizeRafId: number | null = null;

    const container = chartContainerRef.current;
    container.innerHTML = '';

    const chart = createChart(container, {
      width: container.clientWidth || 800,
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
          bottom: 0.22,
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
        precision: currentPrice < 10 ? 4 : 2,
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
        top: 0.8,
        bottom: 0,
      },
    });
    volumeSeriesRef.current = volumeSeries;

    // Initial placeholder candles
    const tfSec = getTfSeconds(timeframe);
    const { candles: fallbackCandles, volumes: fallbackVolumes } = generateHistoricalCandles(currentPrice, atr, tfSec, 120);
    try {
      candleSeries.setData(fallbackCandles);
      volumeSeries.setData(fallbackVolumes);
    } catch (e) {}

    const lastBar = fallbackCandles[fallbackCandles.length - 1];
    if (lastBar) {
      lastCandleRef.current = lastBar;
      updateHoverOhlcSafely({
        open: lastBar.open,
        high: lastBar.high,
        low: lastBar.low,
        close: lastBar.close,
        changePercent: Number((((lastBar.close - lastBar.open) / lastBar.open) * 100).toFixed(2)),
      });
    }

    // Subscribe to crosshair move
    const crosshairHandler = (param: any) => {
      if (isDisposedRef.current || !param || !param.time || !param.seriesData) return;
      try {
        const data = param.seriesData.get(candleSeries) as CandlestickData<UTCTimestamp> | undefined;
        if (data) {
          updateHoverOhlcSafely({
            open: data.open,
            high: data.high,
            low: data.low,
            close: data.close,
            changePercent: Number((((data.close - data.open) / data.open) * 100).toFixed(2)),
          });
        }
      } catch (e) {}
    };

    chart.subscribeCrosshairMove(crosshairHandler);

    // Debounced Resize Observer
    const resizeObserver = new ResizeObserver((entries) => {
      if (isDisposedRef.current || !entries || entries.length === 0 || !chartApiRef.current) return;
      const { width } = entries[0].contentRect;
      if (width <= 0) return;
      if (resizeRafId !== null) cancelAnimationFrame(resizeRafId);
      resizeRafId = requestAnimationFrame(() => {
        if (!isDisposedRef.current && chartApiRef.current) {
          try {
            chartApiRef.current.applyOptions({ width });
          } catch (e) {}
        }
      });
    });
    resizeObserver.observe(container);

    return () => {
      isDisposedRef.current = true;
      if (resizeRafId !== null) cancelAnimationFrame(resizeRafId);
      if (backfillAbortRef.current) {
        try {
          backfillAbortRef.current.abort();
        } catch (e) {}
      }
      try {
        resizeObserver.disconnect();
      } catch (e) {}
      try {
        chart.unsubscribeCrosshairMove(crosshairHandler);
      } catch (e) {}
      try {
        chart.remove();
      } catch (e) {}
      chartApiRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
      priceLinesRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 2. Fullscreen toggle dynamic height update (re-use chart instance without dispose)
  useEffect(() => {
    if (!chartApiRef.current || !chartContainerRef.current || isDisposedRef.current) return;
    try {
      chartApiRef.current.applyOptions({
        height: isFullscreen ? 580 : 420,
        width: chartContainerRef.current.clientWidth || 800,
      });
    } catch (e) {}
  }, [isFullscreen]);

  // 3. Symbol or Timeframe change - update data in-place without disposing chart
  useEffect(() => {
    const candleSeries = candleSeriesRef.current;
    const volumeSeries = volumeSeriesRef.current;
    if (!candleSeries || !volumeSeries || !chartApiRef.current || isDisposedRef.current) return;

    let isEffectCancelled = false;

    try {
      const priceForFormat = currentPriceRef.current || 100;
      candleSeries.applyOptions({
        priceFormat: {
          type: 'price',
          precision: priceForFormat < 10 ? 4 : 2,
          minMove: priceForFormat < 10 ? 0.0001 : 0.01,
        },
      });

      // If initial candles have not loaded yet, generate fallback seed so chart is immediately visible
      if (!hasCandlesLoadedRef.current) {
        const tfSec = getTfSeconds(timeframe);
        const { candles: fallbackCandles, volumes: fallbackVolumes } = generateHistoricalCandles(
          currentPriceRef.current,
          atrRef.current,
          tfSec,
          200
        );
        candleSeries.setData(fallbackCandles);
        volumeSeries.setData(fallbackVolumes);

        const lastBar = fallbackCandles[fallbackCandles.length - 1];
        if (lastBar) {
          lastCandleRef.current = lastBar;
          updateHoverOhlcSafely({
            open: lastBar.open,
            high: lastBar.high,
            low: lastBar.low,
            close: lastBar.close,
            changePercent: Number((((lastBar.close - lastBar.open) / lastBar.open) * 100).toFixed(2)),
          });
        }
      }

      // Fetch authentic Binance candles for this symbol/timeframe with full backfill
      loadBinanceCandles(candleSeries, volumeSeries, () => isEffectCancelled, false, true);
    } catch (e) {
      console.warn('Error setting candle data', e);
    }

    return () => {
      isEffectCancelled = true;
    };
  }, [symbol, timeframe, loadBinanceCandles, updateHoverOhlcSafely]);

  // 3b. Silent periodic 15-second background sync for live Binance candles
  useEffect(() => {
    const candleSeries = candleSeriesRef.current;
    const volumeSeries = volumeSeriesRef.current;
    if (!candleSeries || !volumeSeries || isDisposedRef.current) return;

    const intervalId = setInterval(() => {
      if (!isDisposedRef.current && candleSeriesRef.current && volumeSeriesRef.current) {
        loadBinanceCandles(candleSeriesRef.current, volumeSeriesRef.current, undefined, true);
      }
    }, 15000);

    return () => clearInterval(intervalId);
  }, [loadBinanceCandles]);

  // 4. Update latest candle on price tick safely - STRICTLY DEPENDS ONLY ON PRICE & TIMEFRAME
  useEffect(() => {
    if (!candleSeriesRef.current || !currentPrice || isDisposedRef.current) return;
    try {
      const nowSec = Math.floor(Date.now() / 1000);
      const tfSec = getTfSeconds(timeframe);
      const currentBarTime = (Math.floor(nowSec / tfSec) * tfSec) as UTCTimestamp;
      const last = lastCandleRef.current;

      const barTime = last && (last.time as number) >= (currentBarTime as number)
        ? (last.time as UTCTimestamp)
        : currentBarTime;

      const isNewBar = last ? (barTime as number) > (last.time as number) : false;

      const updatedCandle: CandlestickData<UTCTimestamp> = {
        time: barTime,
        open: isNewBar || !last ? currentPrice : last.open,
        high: isNewBar || !last ? currentPrice : Math.max(last.high, currentPrice),
        low: isNewBar || !last ? currentPrice : Math.min(last.low, currentPrice),
        close: currentPrice,
      };

      candleSeriesRef.current.update(updatedCandle);
      lastCandleRef.current = updatedCandle;
    } catch (e) {}
  }, [currentPrice, timeframe]);

  // 5. Draw or update interactive Horizontal Price Lines for active trades
  useEffect(() => {
    const candleSeries = candleSeriesRef.current;
    if (!candleSeries || isDisposedRef.current) return;

    try {
      // Remove existing price lines safely
      priceLinesRef.current.forEach((line) => {
        try {
          candleSeries.removePriceLine(line);
        } catch (e) {}
      });
      priceLinesRef.current = [];

      // Add lines for all open trades on this asset
      activeTrades.forEach((trade) => {
        try {
          const entryLine = candleSeries.createPriceLine({
            price: trade.entryPrice,
            color: '#06b6d4',
            lineWidth: 2,
            lineStyle: LineStyle.Solid,
            axisLabelVisible: true,
            title: 'سعر شراء SPOT',
          });
          priceLinesRef.current.push(entryLine);

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
        } catch (e) {}
      });
    } catch (e) {}
  }, [activeTradesKey, activeTrades]);

  const currentTfConfig = useMemo(() => getTimeframeConfig(timeframe), [timeframe]);
  const timeframes = ['5m', '15m', '30m', '1h', '4h', '1d', '1w'];

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

        {/* Right: Live Data Badge, Historical Depth Status, Timeframe Controls & Fullscreen */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Live Data Badge */}
          <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-[10px] text-emerald-400 font-semibold">
            <Radio className={`w-3 h-3 ${isLiveRealData ? 'text-emerald-400 animate-pulse' : 'text-amber-400'}`} />
            <span>{isLiveRealData ? 'بيانات بينانس الحقيقية (Live Spot)' : (isLoadingKlines ? 'جاري التحميل...' : 'ربط بينانس')}</span>
          </div>

          {/* Dynamic Historical Depth / Backfill Status Badge */}
          {backfillState.isBackfilling ? (
            <div
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-indigo-500/15 border border-indigo-500/30 text-[10px] text-indigo-300 font-mono shadow-sm animate-pulse"
              title={`جاري استكمال الشموع التاريخية السابقة لتغطية ${currentTfConfig.targetSpanDescription}`}
            >
              <RefreshCw className="w-3 h-3 text-indigo-400 animate-spin" />
              <span>استكمال السجل: {backfillState.loadedCount.toLocaleString()} / {backfillState.targetCount.toLocaleString()} شمعة</span>
              <span className="text-indigo-400 font-bold">({backfillState.percent}%)</span>
            </div>
          ) : backfillState.loadedCount > 0 ? (
            <div
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-700/70 text-[10px] text-slate-300 font-mono"
              title={`سجل تاريخي متكامل (${currentTfConfig.targetSpanDescription})${backfillState.oldestDateStr ? ` - من ${backfillState.oldestDateStr} حتى اليوم` : ''}`}
            >
              <CheckCircle2 className="w-3 h-3 text-emerald-400" />
              <span>السجل: {backfillState.loadedCount.toLocaleString()} شمعة</span>
              {backfillState.oldestDateStr && (
                <span className="text-slate-400 hidden xl:inline">({backfillState.oldestDateStr} ⟵ اليوم)</span>
              )}
            </div>
          ) : null}

          {/* Refresh full candles button */}
          <button
            onClick={() => {
              if (candleSeriesRef.current && volumeSeriesRef.current) {
                loadBinanceCandles(candleSeriesRef.current, volumeSeriesRef.current, undefined, false, true);
              }
            }}
            disabled={isLoadingKlines}
            className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white border border-slate-800 transition-colors cursor-pointer"
            title="إعادة جلب الشموع الكاملة من بينانس"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoadingKlines ? 'animate-spin text-emerald-400' : ''}`} />
          </button>

          {/* Timeframe Buttons */}
          <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800">
            {timeframes.map((tf) => {
              const cfg = getTimeframeConfig(tf);
              return (
                <button
                  key={tf}
                  onClick={() => onTimeframeChange && onTimeframeChange(tf)}
                  title={`${tf}: ${cfg.targetSpanDescription} (${cfg.targetCandles.toLocaleString()} شمعة)`}
                  className={`px-2 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center gap-1 ${
                    timeframe === tf
                      ? 'bg-emerald-500 text-slate-950 shadow-sm font-bold'
                      : 'text-slate-400 hover:text-white hover:bg-slate-900'
                  }`}
                >
                  <span>{tf}</span>
                </button>
              );
            })}
          </div>

          {/* Fullscreen Button */}
          <button
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="p-1.5 rounded-lg bg-slate-950 hover:bg-slate-800 text-slate-400 hover:text-white border border-slate-800 transition-all cursor-pointer"
            title={isFullscreen ? 'تصغير الشارت' : 'ملء الشاشة'}
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* CHART CANVAS CONTAINER */}
      <div className="relative w-full bg-[#090d16]">
        {/* Initial First-Load Only Indicator - Never disrupts or obscures chart during 15s sync */}
        {isLoadingKlines && !hasCandlesLoadedRef.current && (
          <div className="absolute inset-0 bg-[#090d16]/75 flex items-center justify-center z-10 pointer-events-none transition-opacity">
            <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-slate-900 border border-slate-700 text-xs text-slate-300 shadow-xl">
              <RefreshCw className="w-3.5 h-3.5 animate-spin text-emerald-400" />
              <span>جاري تحميل شموع بينانس الرسمية ({timeframe})...</span>
            </div>
          </div>
        )}

        {/* Canvas DOM Node */}
        <div
          ref={chartContainerRef}
          className="w-full transition-all"
          style={{ height: isFullscreen ? '580px' : '420px' }}
        />

        {/* ACTIVE SPOT TRADES BADGES ON CHART OVERLAY */}
        {activeTrades.length > 0 && (
          <div className="absolute top-3 left-3 z-10 flex flex-col gap-1.5 pointer-events-none">
            {activeTrades.map((t) => (
              <div
                key={t.id}
                className="bg-slate-950/85 backdrop-blur-md px-3 py-1.5 rounded-xl border border-cyan-500/40 text-[11px] shadow-lg flex items-center gap-2 text-slate-200"
              >
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 animate-ping"></span>
                  <strong className="text-cyan-400 font-bold">صفقة Spot نشطة:</strong>
                </div>
                <span className="font-mono">${t.entryPrice.toLocaleString()}</span>
                {t.takeProfit > 0 && (
                  <span className="text-emerald-400 font-mono">| TP: ${t.takeProfit.toLocaleString()}</span>
                )}
                {t.stopLoss > 0 && (
                  <span className="text-rose-400 font-mono">| SL: ${t.stopLoss.toLocaleString()}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* BOTTOM LEGEND & RISK GUARD BAR */}
      <div className="px-4 py-2 border-t border-slate-800/80 bg-slate-950/80 flex flex-wrap items-center justify-between text-[11px] text-slate-400 gap-2">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded bg-emerald-500 inline-block"></span>
            <span>صعود (Bullish)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded bg-rose-500 inline-block"></span>
            <span>هبوط (Bearish)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-0.5 bg-cyan-400 inline-block"></span>
            <span className="text-cyan-300">سعر الدخول Spot</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-0.5 border-t border-dashed border-emerald-400 inline-block"></span>
            <span className="text-emerald-400">الهدف (TP)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-0.5 border-t border-dashed border-rose-400 inline-block"></span>
            <span className="text-rose-400">الوقف (SL)</span>
          </div>
          {/* Timeframe historical depth rule note */}
          <div className="flex items-center gap-1.5 text-indigo-300 bg-indigo-500/10 px-2 py-0.5 rounded border border-indigo-500/20 font-mono text-[10px]">
            <Clock className="w-3 h-3 text-indigo-400" />
            <span>نطاق {timeframe}: {currentTfConfig.targetSpanDescription}</span>
          </div>
        </div>

        <div className="flex items-center gap-2 font-mono text-[10px]">
          <span className="text-slate-500">معدل التحديث:</span>
          <span className="text-slate-300 font-bold">كل ثانية (Real-time Ticks) + مزامنة بينانس الخلفية</span>
        </div>
      </div>
    </div>
  );
};

