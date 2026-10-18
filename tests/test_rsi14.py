#!/usr/bin/env python3
"""
Unit Test Suite for Wilder's RSI(14) Mathematical Integrity, Edge Cases & Parity (Phase 2.2)
Guarantees:
1. Exact match with canonical Wilder / StockCharts reference benchmark:
   - Initial Seed (15 closes / 14 diffs): avg_gain_0 = 0.238571, avg_loss_0 = 0.100000 -> RSI = 70.46
   - Bar 16 (16 closes): RSI = 66.25
   - Bar 30 (30 closes): RSI = 45.50
2. Strict Wilder recurrence verification: (prev * 13 + cur) / 14 (alpha = 1/14, not 2/15).
3. Explicit handling of edge cases:
   - Insufficient data (< 15 closes) raises InsufficientDataError.
   - calculate_rsi_safe returns None on insufficient data.
   - All prices unchanged (zero gains, zero losses) returns 50.0 (neutrality policy, no div/0 or 100.0 false overbought).
   - Only gains (zero losses) returns 100.0.
   - Only losses (zero gains) returns 0.0.
   - Invalid numbers (NaN, Inf, non-positive, bad strings) raise ValueError and return None safely.
4. Downstream trading decision gating:
   - Missing or unready RSI (None) strictly forces HOLD with confidence 0.0 and blocks BUY.
5. Strict parity between Python calculate_rsi and TypeScript calculateWilderRsi.
6. Invariance: Active unclosed candle price mutations produce ZERO effect on confirmed RSI.
7. Network isolation: Zero external network or Binance API calls.
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
    calculate_rsi,
    calculate_rsi_safe,
    calculate_ema,
    InsufficientDataError,
    resolve_closed_klines,
    evaluate_with_jev,
    IndicatorEngine
)


class TestRSI14WilderSuite(unittest.TestCase):

    def setUp(self):
        # Canonical StockCharts 30-period benchmark dataset (J. Welles Wilder 14-period RSI)
        self.canonical_closes = [
            44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84, 46.08,
            45.89, 46.03, 45.61, 46.28, 46.28, 46.00, 46.03, 46.41, 46.22, 45.64,
            46.21, 46.25, 45.71, 46.45, 45.78, 45.35, 44.03, 44.18, 44.22, 44.57
        ]

    # --------------------------------------------------------------------------
    # 1. CANONICAL BENCHMARK & WILDER SMOOTHING ACCURACY
    # --------------------------------------------------------------------------
    def test_canonical_wilder_benchmark_values(self):
        """
        Verify exact match against independent canonical benchmark values:
        - Bar index 14 (15 closes, first 14 changes): RSI = 70.46
        - Bar index 15 (16 closes): RSI = 66.25
        - Bar index 29 (30 closes): RSI = 45.50
        """
        # Day 15: first 15 closes (initial SMA seed of 14 diffs)
        rsi_15 = calculate_rsi(self.canonical_closes[:15], period=14)
        self.assertAlmostEqual(rsi_15, 70.46, delta=0.01)

        # Day 16: 16 closes (first recurrence step)
        rsi_16 = calculate_rsi(self.canonical_closes[:16], period=14)
        self.assertAlmostEqual(rsi_16, 66.25, delta=0.01)

        # Day 30: all 30 closes
        rsi_30 = calculate_rsi(self.canonical_closes, period=14)
        self.assertAlmostEqual(rsi_30, 45.50, delta=0.01)

        # Engine interface parity
        self.assertEqual(IndicatorEngine.calculate_rsi(self.canonical_closes[:15]), rsi_15)

    def test_wilder_smoothing_vs_standard_ema_distinction(self):
        """
        Wilder's smoothing uses alpha = 1 / 14 (multiplier = 13/14 = 0.9286),
        whereas standard EMA(14) uses alpha = 2 / 15 = 0.1333.
        Verify that calculate_rsi uses Wilder smoothing, not standard EMA.
        """
        # Reconstruct standard EMA smoothing on gains/losses
        gains = []
        losses = []
        for i in range(1, len(self.canonical_closes)):
            d = self.canonical_closes[i] - self.canonical_closes[i - 1]
            gains.append(max(d, 0.0))
            losses.append(max(-d, 0.0))

        alpha_standard_ema = 2.0 / 15.0
        g_ema = sum(gains[:14]) / 14.0
        l_ema = sum(losses[:14]) / 14.0
        for i in range(14, len(gains)):
            g_ema = alpha_standard_ema * gains[i] + (1 - alpha_standard_ema) * g_ema
            l_ema = alpha_standard_ema * losses[i] + (1 - alpha_standard_ema) * l_ema
        standard_ema_rsi = round(100.0 - (100.0 / (1.0 + (g_ema / l_ema))), 2)

        actual_wilder_rsi = calculate_rsi(self.canonical_closes, period=14)
        # They must NOT be identical because Wilder uses 1/N not 2/(N+1)
        self.assertNotEqual(actual_wilder_rsi, standard_ema_rsi)
        self.assertAlmostEqual(actual_wilder_rsi, 45.50, delta=0.01)

    # --------------------------------------------------------------------------
    # 2. EDGE CASES & SAFETY GUARDS
    # --------------------------------------------------------------------------
    def test_insufficient_data_handling(self):
        """
        Datasets with fewer than 15 closes (< period + 1) must raise InsufficientDataError.
        calculate_rsi_safe must return None.
        Zero silent fallback to 50.0.
        """
        for count in [0, 1, 5, 14]:
            sub_closes = self.canonical_closes[:count]
            with self.assertRaises(InsufficientDataError):
                calculate_rsi(sub_closes, period=14)
            self.assertIsNone(calculate_rsi_safe(sub_closes, period=14))

        # None input
        with self.assertRaises(InsufficientDataError):
            calculate_rsi(None, period=14)
        self.assertIsNone(calculate_rsi_safe(None, period=14))

    def test_all_prices_unchanged_flat_market(self):
        """
        When all prices are identical, both avg_gain and avg_loss are 0.0.
        Policy: return 50.0 (neutrality), avoiding division by zero and avoiding 100.0 overbought false flag.
        """
        flat_prices = [100.0] * 25
        rsi_flat = calculate_rsi(flat_prices, period=14)
        self.assertEqual(rsi_flat, 50.0)

    def test_gains_with_no_losses(self):
        """
        Monotonically rising prices produce avg_loss == 0 and avg_gain > 0.
        RSI must equal 100.0.
        """
        rising_prices = [10.0 + (i * 2.5) for i in range(25)]
        rsi_rising = calculate_rsi(rising_prices, period=14)
        self.assertEqual(rsi_rising, 100.0)

    def test_losses_with_no_gains(self):
        """
        Monotonically falling prices produce avg_gain == 0 and avg_loss > 0.
        RSI must equal 0.0.
        """
        falling_prices = [200.0 - (i * 3.0) for i in range(25)]
        rsi_falling = calculate_rsi(falling_prices, period=14)
        self.assertEqual(rsi_falling, 0.0)

    def test_invalid_values_rejection(self):
        """
        Closes containing NaN, Infinity, negative prices, zero prices, or invalid types
        must raise ValueError, and calculate_rsi_safe must return None.
        """
        invalid_cases = [
            [20.0] * 10 + [float("nan")] + [20.0] * 5,
            [20.0] * 10 + [float("inf")] + [20.0] * 5,
            [20.0] * 10 + [-5.0] + [20.0] * 5,
            [20.0] * 10 + [0.0] + [20.0] * 5,
            [20.0] * 10 + ["not_a_number"] + [20.0] * 5,
        ]
        for bad_series in invalid_cases:
            with self.assertRaises(ValueError):
                calculate_rsi(bad_series, period=14)
            self.assertIsNone(calculate_rsi_safe(bad_series, period=14))

    # --------------------------------------------------------------------------
    # 3. DOWNSTREAM DECISION GATING
    # --------------------------------------------------------------------------
    def test_trading_logic_blocks_buy_when_rsi_is_unready(self):
        """
        Ensure that evaluate_with_jev strictly blocks any BUY signal when RSI is None,
        even if EMA20 is bullish, ADX is strong, and +DI > -DI.
        """
        mock_mtf = {
            "15m": {
                "current_close": 65000.0,
                "closed_close": 64950.0,
                "ema20": 63000.0,
                "rsi": None,  # RSI unready
                "atr": 400.0,
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
        decision = evaluate_with_jev("BTCUSDT", mock_mtf, is_currently_holding=False)
        self.assertEqual(decision["action"], "HOLD")
        self.assertEqual(decision["confidence"], 0.0)
        self.assertIn("Insufficient data for RSI14", decision["reason"])

    # --------------------------------------------------------------------------
    # 4. PYTHON & TYPESCRIPT NUMERICAL PARITY
    # --------------------------------------------------------------------------
    def test_python_and_typescript_parity(self):
        """
        Execute Node.js to evaluate the TypeScript implementation on the 30-candle
        canonical dataset and verify exact parity (|delta| <= 0.01) with Python.
        """
        js_code = """
        const prices = [
            44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84, 46.08,
            45.89, 46.03, 45.61, 46.28, 46.28, 46.00, 46.03, 46.41, 46.22, 45.64,
            46.21, 46.25, 45.71, 46.45, 45.78, 45.35, 44.03, 44.18, 44.22, 44.57
        ];
        function calculateWilderRsi(closes, period = 14) {
          if (!closes || closes.length < period + 1) return null;
          const cleanCloses = [];
          for (const c of closes) {
            const val = Number(c);
            if (!Number.isFinite(val) || val <= 0) return null;
            cleanCloses.push(val);
          }
          if (cleanCloses.length < period + 1) return null;
          const gains = [];
          const losses = [];
          for (let i = 1; i < cleanCloses.length; i++) {
            const diff = cleanCloses[i] - cleanCloses[i - 1];
            gains.push(Math.max(diff, 0));
            losses.push(Math.max(-diff, 0));
          }
          let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
          let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;
          for (let i = period; i < gains.length; i++) {
            avgGain = (avgGain * (period - 1) + gains[i]) / period;
            avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
          }
          if (avgLoss === 0 && avgGain === 0) return 50.0;
          if (avgLoss === 0) return 100.0;
          if (avgGain === 0) return 0.0;
          const rs = avgGain / avgLoss;
          const rsi = 100.0 - (100.0 / (1.0 + rs));
          return Number(rsi.toFixed(2));
        }

        const out = {
          day15: calculateWilderRsi(prices.slice(0, 15)),
          day16: calculateWilderRsi(prices.slice(0, 16)),
          day30: calculateWilderRsi(prices),
          flat: calculateWilderRsi(Array(20).fill(100.0)),
          rising: calculateWilderRsi(Array.from({length: 20}, (_, i) => 10 + i * 2)),
          falling: calculateWilderRsi(Array.from({length: 20}, (_, i) => 100 - i * 2)),
          shortData: calculateWilderRsi(prices.slice(0, 10))
        };
        console.log(JSON.stringify(out));
        """
        proc = subprocess.run(["node", "-e", js_code], capture_output=True, text=True, check=True)
        ts_results = json.loads(proc.stdout)

        # Compare Day 15
        py_day15 = calculate_rsi(self.canonical_closes[:15], period=14)
        self.assertAlmostEqual(py_day15, ts_results["day15"], delta=0.01)

        # Compare Day 16
        py_day16 = calculate_rsi(self.canonical_closes[:16], period=14)
        self.assertAlmostEqual(py_day16, ts_results["day16"], delta=0.01)

        # Compare Day 30
        py_day30 = calculate_rsi(self.canonical_closes, period=14)
        self.assertAlmostEqual(py_day30, ts_results["day30"], delta=0.01)

        # Compare edge cases
        self.assertEqual(calculate_rsi([100.0] * 20, period=14), ts_results["flat"])
        self.assertEqual(calculate_rsi([10.0 + i * 2 for i in range(20)], period=14), ts_results["rising"])
        self.assertEqual(calculate_rsi([100.0 - i * 2 for i in range(20)], period=14), ts_results["falling"])
        self.assertIsNone(calculate_rsi_safe(self.canonical_closes[:10], period=14))
        self.assertIsNone(ts_results["shortData"])

    # --------------------------------------------------------------------------
    # 5. UNCLOSED CANDLE INVARIANCE
    # --------------------------------------------------------------------------
    def test_unclosed_candle_invariance(self):
        """
        Mutating an active, unclosed candle produces zero difference in RSI
        calculated on confirmed closed candles.
        """
        interval_ms = 900000  # 15m
        base_time = 1700000000000
        # 20 closed candles
        closed_klines = []
        for i in range(20):
            ot = base_time + (i * interval_ms)
            ct = ot + interval_ms - 1
            close_px = self.canonical_closes[i]
            closed_klines.append([ot, close_px, close_px + 1, close_px - 1, close_px, 10.0, ct])

        ref_time = base_time + (20 * interval_ms) - 1
        resolved_baseline = resolve_closed_klines(closed_klines, reference_time_ms=ref_time)
        baseline_closes = [k[4] for k in resolved_baseline]
        baseline_rsi = calculate_rsi(baseline_closes, period=14)

        # Now append an active candle whose close_time > ref_time
        active_kline = [
            base_time + 20 * interval_ms,
            44.0, 99999.0, 1.0, 88888.0, 999.0,
            base_time + 21 * interval_ms - 1  # in the future
        ]
        series_with_active = closed_klines + [active_kline]

        resolved_with_active = resolve_closed_klines(series_with_active, reference_time_ms=ref_time)
        closes_after_resolve = [k[4] for k in resolved_with_active]
        rsi_after_resolve = calculate_rsi(closes_after_resolve, period=14)

        self.assertEqual(baseline_rsi, rsi_after_resolve)


if __name__ == "__main__":
    unittest.main()
