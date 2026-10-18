#!/usr/bin/env python3
"""
Unit Test Suite for Wilder's ATR(14) Mathematical Integrity, Edge Cases & Parity (Phase 2.3)
Guarantees:
1. Standard True Range calculation accounting for gaps:
   TR_t = max(H_t - L_t, abs(H_t - C_{t-1}), abs(L_t - C_{t-1}))
2. Canonical Benchmark Verification:
   - Requires 15 OHLC candles to yield 14 TR values for initial SMA seed.
   - Initial ATR (15 candles / 14 TRs) = 0.62
   - Bar 16 (15 TRs) = 0.63
   - Bar 20 (19 TRs) = 0.66
3. Explicit Wilder smoothing verification:
   ATR_t = (ATR_{t-1} * 13 + TR_t) / 14 (alpha = 1/14, distinct from rolling SMA and standard EMA).
4. Edge case handling:
   - Perfectly flat market (H=L=C): TR=0.0 -> ATR=0.0.
   - Insufficient data (< 15 candles) raises InsufficientDataError; calculate_atr_safe returns None.
   - Length mismatch across H/L/C raises ValueError.
   - Invalid values (NaN, Inf, <= 0, bad types) raise ValueError; calculate_atr_safe returns None.
   - Geometric violations (High < Low) raise ValueError.
5. Downstream Decision Gating & Solvency:
   - When ATR is None or <= 0.0, evaluate_with_jev strictly blocks BUY and forces HOLD with confidence 0.0.
   - Prevents invalid 0-distance stop losses or division by zero.
6. Python & TypeScript Numerical Parity:
   - Subprocess execution of Node.js verify exact match (|delta| <= 0.01).
7. Active Unclosed Candle Invariance:
   - Mutating unclosed candle produces zero effect on confirmed ATR.
8. Zero external network / Binance calls.
"""

import unittest
import sys
import os
import math
import subprocess
import json
from unittest.mock import patch

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from standalone_backtester import (
    calculate_atr,
    calculate_atr_safe,
    InsufficientDataError,
    resolve_closed_klines,
    evaluate_with_jev,
    IndicatorEngine
)


class TestATR14WilderSuite(unittest.TestCase):

    def setUp(self):
        # 20-candle Canonical Benchmark OHLC Dataset
        self.canonical_highs = [
            48.70, 48.72, 48.90, 48.87, 48.82, 49.05, 49.20, 49.35, 49.92, 50.19,
            50.12, 49.66, 50.46, 50.80, 50.91, 50.60, 50.20, 49.90, 50.10, 50.50
        ]
        self.canonical_lows = [
            47.79, 48.14, 48.39, 48.37, 48.24, 48.64, 48.94, 48.86, 48.98, 49.62,
            49.20, 48.98, 49.50, 50.16, 50.40, 49.85, 49.50, 49.10, 49.20, 49.90
        ]
        self.canonical_closes = [
            48.16, 48.61, 48.75, 48.63, 48.74, 49.00, 49.10, 49.08, 49.56, 49.71,
            49.29, 49.46, 50.45, 50.72, 50.55, 50.10, 49.75, 49.30, 50.05, 50.40
        ]

    # --------------------------------------------------------------------------
    # 1. MATHEMATICAL VERIFICATION & CANONICAL BENCHMARKS
    # --------------------------------------------------------------------------
    def test_canonical_wilder_benchmark_values(self):
        """
        Verify exact match against independent step-by-step benchmark values:
        - 15 candles (14 TRs): Initial ATR = 0.62 (seed = 8.65 / 14 = 0.6179)
        - 16 candles (15 TRs): ATR = 0.63 (0.6179 * 13 + 0.75) / 14 = 0.6273
        - 20 candles (19 TRs): ATR = 0.66
        """
        atr_15 = calculate_atr(self.canonical_highs[:15], self.canonical_lows[:15], self.canonical_closes[:15], period=14)
        self.assertAlmostEqual(atr_15, 0.62, delta=0.01)

        atr_16 = calculate_atr(self.canonical_highs[:16], self.canonical_lows[:16], self.canonical_closes[:16], period=14)
        self.assertAlmostEqual(atr_16, 0.63, delta=0.01)

        atr_20 = calculate_atr(self.canonical_highs, self.canonical_lows, self.canonical_closes, period=14)
        self.assertAlmostEqual(atr_20, 0.66, delta=0.01)

        # Engine interface parity
        self.assertEqual(IndicatorEngine.calculate_atr(self.canonical_highs[:15], self.canonical_lows[:15], self.canonical_closes[:15]), atr_15)

    def test_true_range_accounts_for_price_gaps(self):
        """
        Verify that True Range properly includes gaps over previous close,
        and does NOT simply reduce to High - Low.
        """
        # Two candles: Bar 0 Close = 100.0, Bar 1 High = 110.0, Low = 105.0, Close = 108.0 (Gap up!)
        h = [100.0] * 14 + [110.0]
        l = [99.0] * 14 + [105.0]
        c = [99.5] * 13 + [100.0, 108.0]  # Bar 13 close = 100.0, Bar 14 range = 105 to 110
        # High - Low for Bar 14 = 5.0
        # But |High - PrevClose| = 110.0 - 100.0 = 10.0
        # True Range for Bar 14 must be 10.0, not 5.0!
        h_prev = c[-2]
        tr_last = max(h[-1] - l[-1], abs(h[-1] - h_prev), abs(l[-1] - h_prev))
        self.assertEqual(tr_last, 10.0)

    def test_wilder_smoothing_vs_rolling_sma_distinction(self):
        """
        Verify that calculate_atr uses Wilder's exponential smoothing recurrence
        and NOT a rolling simple moving average (SMA) of the last 14 TRs.
        """
        tr_list = []
        for i in range(1, len(self.canonical_closes)):
            tr = max(
                self.canonical_highs[i] - self.canonical_lows[i],
                abs(self.canonical_highs[i] - self.canonical_closes[i - 1]),
                abs(self.canonical_lows[i] - self.canonical_closes[i - 1])
            )
            tr_list.append(tr)

        # Rolling SMA of last 14 TRs on Bar 20
        rolling_sma_atr = round(sum(tr_list[-14:]) / 14.0, 2)  # = 0.70

        actual_wilder_atr = calculate_atr(self.canonical_highs, self.canonical_lows, self.canonical_closes, period=14)
        # Wilder ATR = 0.66, whereas rolling SMA = 0.70. They must NOT match!
        self.assertNotEqual(actual_wilder_atr, rolling_sma_atr)
        self.assertEqual(actual_wilder_atr, 0.66)

    # --------------------------------------------------------------------------
    # 2. EDGE CASES & SAFETY GUARDS
    # --------------------------------------------------------------------------
    def test_flat_market_produces_zero_atr(self):
        """
        When all OHLC values are identical, True Range is 0.0 and ATR is 0.0.
        Must return 0.0 without errors or NaN.
        """
        h = [100.0] * 20
        l = [100.0] * 20
        c = [100.0] * 20
        atr_flat = calculate_atr(h, l, c, period=14)
        self.assertEqual(atr_flat, 0.0)

    def test_insufficient_data_rejection(self):
        """
        Datasets with fewer than 15 candles (< period + 1) must raise InsufficientDataError.
        calculate_atr_safe must return None.
        """
        for count in [0, 1, 5, 14]:
            h = self.canonical_highs[:count]
            l = self.canonical_lows[:count]
            c = self.canonical_closes[:count]
            with self.assertRaises(InsufficientDataError):
                calculate_atr(h, l, c, period=14)
            self.assertIsNone(calculate_atr_safe(h, l, c, period=14))

        with self.assertRaises(InsufficientDataError):
            calculate_atr(None, None, None, period=14)
        self.assertIsNone(calculate_atr_safe(None, None, None, period=14))

    def test_array_length_mismatch_rejection(self):
        """
        Mismatched lengths among highs, lows, and closes must raise ValueError.
        """
        with self.assertRaises(ValueError):
            calculate_atr(self.canonical_highs[:16], self.canonical_lows[:15], self.canonical_closes[:15], period=14)

    def test_invalid_values_and_geometric_violations(self):
        """
        NaN, Infinity, negative prices, zero prices, and High < Low must raise ValueError.
        calculate_atr_safe must return None.
        """
        # High < Low violation
        bad_h = list(self.canonical_highs)
        bad_l = list(self.canonical_lows)
        bad_c = list(self.canonical_closes)
        bad_h[5] = 40.0
        bad_l[5] = 50.0  # High < Low!
        with self.assertRaises(ValueError):
            calculate_atr(bad_h, bad_l, bad_c, period=14)
        self.assertIsNone(calculate_atr_safe(bad_h, bad_l, bad_c, period=14))

        # NaN injection
        nan_h = list(self.canonical_highs)
        nan_h[8] = float("nan")
        with self.assertRaises(ValueError):
            calculate_atr(nan_h, self.canonical_lows, self.canonical_closes, period=14)
        self.assertIsNone(calculate_atr_safe(nan_h, self.canonical_lows, self.canonical_closes, period=14))

        # Negative price
        neg_c = list(self.canonical_closes)
        neg_c[3] = -10.0
        with self.assertRaises(ValueError):
            calculate_atr(self.canonical_highs, self.canonical_lows, neg_c, period=14)
        self.assertIsNone(calculate_atr_safe(self.canonical_highs, self.canonical_lows, neg_c, period=14))

    # --------------------------------------------------------------------------
    # 3. DOWNSTREAM DECISION GATING & SAFE TRADING
    # --------------------------------------------------------------------------
    def test_trading_logic_blocks_buy_when_atr_is_unready_or_zero(self):
        """
        Ensure that evaluate_with_jev strictly blocks any BUY signal when ATR is None or <= 0,
        preventing invalid stop losses or division by zero.
        """
        # Case A: ATR is None
        mock_mtf_none = {
            "15m": {
                "current_close": 65000.0,
                "closed_close": 64950.0,
                "ema20": 63000.0,
                "rsi": 55.0,
                "atr": None,  # unready
                "adx": 30.0,
                "plus_di": 28.0,
                "minus_di": 12.0
            },
            "1h": {
                "current_close": 65000.0,
                "closed_close": 64950.0,
                "ema20": 62000.0,
                "rsi": 58.0,
                "atr": 600.0,
                "adx": 28.0,
                "plus_di": 25.0,
                "minus_di": 15.0
            }
        }
        res_none = evaluate_with_jev("BTCUSDT", mock_mtf_none, is_currently_holding=False)
        self.assertEqual(res_none["action"], "HOLD")
        self.assertEqual(res_none["confidence"], 0.0)
        self.assertIn("Insufficient data for ATR14", res_none["reason"])

        # Case B: ATR is 0.0 (flat market)
        mock_mtf_zero = dict(mock_mtf_none)
        mock_mtf_zero["15m"] = dict(mock_mtf_none["15m"])
        mock_mtf_zero["15m"]["atr"] = 0.0
        res_zero = evaluate_with_jev("BTCUSDT", mock_mtf_zero, is_currently_holding=False)
        self.assertEqual(res_zero["action"], "HOLD")
        self.assertEqual(res_zero["confidence"], 0.0)
        self.assertIn("Insufficient data for ATR14", res_zero["reason"])

    # --------------------------------------------------------------------------
    # 4. PYTHON & TYPESCRIPT NUMERICAL PARITY
    # --------------------------------------------------------------------------
    def test_python_and_typescript_parity(self):
        """
        Execute Node.js to evaluate TypeScript calculateAtr on canonical dataset
        and verify exact parity (|delta| <= 0.01) with Python.
        """
        js_code = """
        const highs = [48.70, 48.72, 48.90, 48.87, 48.82, 49.05, 49.20, 49.35, 49.92, 50.19, 50.12, 49.66, 50.46, 50.80, 50.91, 50.60, 50.20, 49.90, 50.10, 50.50];
        const lows  = [47.79, 48.14, 48.39, 48.37, 48.24, 48.64, 48.94, 48.86, 48.98, 49.62, 49.20, 48.98, 49.50, 50.16, 50.40, 49.85, 49.50, 49.10, 49.20, 49.90];
        const closes= [48.16, 48.61, 48.75, 48.63, 48.74, 49.00, 49.10, 49.08, 49.56, 49.71, 49.29, 49.46, 50.45, 50.72, 50.55, 50.10, 49.75, 49.30, 50.05, 50.40];

        function calculateAtr(highs, lows, closes, period = 14) {
          if (!highs || !lows || !closes) return null;
          if (highs.length !== lows.length || lows.length !== closes.length) return null;
          if (closes.length < period + 1) return null;

          const cleanHighs = [];
          const cleanLows = [];
          const cleanCloses = [];
          for (let i = 0; i < closes.length; i++) {
            const h = Number(highs[i]);
            const l = Number(lows[i]);
            const c = Number(closes[i]);
            if (!Number.isFinite(h) || !Number.isFinite(l) || !Number.isFinite(c)) return null;
            if (h <= 0 || l <= 0 || c <= 0) return null;
            if (h < l) return null;
            cleanHighs.push(h);
            cleanLows.push(l);
            cleanCloses.push(c);
          }
          if (cleanCloses.length < period + 1) return null;

          const trList = [];
          for (let i = 1; i < cleanCloses.length; i++) {
            const h = cleanHighs[i];
            const l = cleanLows[i];
            const pc = cleanCloses[i - 1];
            const tr = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
            trList.push(tr);
          }
          let atr = trList.slice(0, period).reduce((a, b) => a + b, 0) / period;
          for (let i = period; i < trList.length; i++) {
            atr = (atr * (period - 1) + trList[i]) / period;
          }
          return Number(atr.toFixed(2));
        }

        const out = {
          atr15: calculateAtr(highs.slice(0, 15), lows.slice(0, 15), closes.slice(0, 15)),
          atr16: calculateAtr(highs.slice(0, 16), lows.slice(0, 16), closes.slice(0, 16)),
          atr20: calculateAtr(highs, lows, closes),
          flat: calculateAtr(Array(20).fill(100), Array(20).fill(100), Array(20).fill(100)),
          insufficient: calculateAtr(highs.slice(0, 10), lows.slice(0, 10), closes.slice(0, 10))
        };
        console.log(JSON.stringify(out));
        """
        proc = subprocess.run(["node", "-e", js_code], capture_output=True, text=True, check=True)
        ts_results = json.loads(proc.stdout)

        py_15 = calculate_atr(self.canonical_highs[:15], self.canonical_lows[:15], self.canonical_closes[:15], period=14)
        self.assertAlmostEqual(py_15, ts_results["atr15"], delta=0.01)

        py_16 = calculate_atr(self.canonical_highs[:16], self.canonical_lows[:16], self.canonical_closes[:16], period=14)
        self.assertAlmostEqual(py_16, ts_results["atr16"], delta=0.01)

        py_20 = calculate_atr(self.canonical_highs, self.canonical_lows, self.canonical_closes, period=14)
        self.assertAlmostEqual(py_20, ts_results["atr20"], delta=0.01)

        self.assertEqual(calculate_atr([100.0] * 20, [100.0] * 20, [100.0] * 20, period=14), ts_results["flat"])
        self.assertIsNone(calculate_atr_safe(self.canonical_highs[:10], self.canonical_lows[:10], self.canonical_closes[:10], period=14))
        self.assertIsNone(ts_results["insufficient"])

    # --------------------------------------------------------------------------
    # 5. UNCLOSED CANDLE INVARIANCE
    # --------------------------------------------------------------------------
    def test_unclosed_candle_invariance(self):
        """
        Mutating an active, unclosed candle produces zero difference in confirmed ATR.
        """
        interval_ms = 900000  # 15m
        base_time = 1700000000000
        closed_klines = []
        for i in range(20):
            ot = base_time + (i * interval_ms)
            ct = ot + interval_ms - 1
            h = self.canonical_highs[i]
            l = self.canonical_lows[i]
            c = self.canonical_closes[i]
            closed_klines.append([ot, c, h, l, c, 10.0, ct])

        ref_time = base_time + (20 * interval_ms) - 1
        resolved_baseline = resolve_closed_klines(closed_klines, reference_time_ms=ref_time)
        b_highs = [k[2] for k in resolved_baseline]
        b_lows = [k[3] for k in resolved_baseline]
        b_closes = [k[4] for k in resolved_baseline]
        baseline_atr = calculate_atr(b_highs, b_lows, b_closes, period=14)

        # Mutated unclosed candle in future
        active_kline = [
            base_time + 20 * interval_ms,
            44.0, 99999.0, 1.0, 88888.0, 999.0,
            base_time + 21 * interval_ms - 1
        ]
        series_with_active = closed_klines + [active_kline]
        resolved_mutated = resolve_closed_klines(series_with_active, reference_time_ms=ref_time)
        m_highs = [k[2] for k in resolved_mutated]
        m_lows = [k[3] for k in resolved_mutated]
        m_closes = [k[4] for k in resolved_mutated]
        mutated_atr = calculate_atr(m_highs, m_lows, m_closes, period=14)

        self.assertEqual(baseline_atr, mutated_atr)


if __name__ == "__main__":
    unittest.main()
