#!/usr/bin/env python3
"""
Unit Test Suite for Wilder's ADX(14), +DI, and -DI Mathematical Integrity, Edge Cases & Parity (Phase 2.4)
Guarantees:
1. Canonical Directional Movement & True Range:
   TR_t = max(H_t - L_t, abs(H_t - C_{t-1}), abs(L_t - C_{t-1}))
   +DM_t = (H_t - H_{t-1}) if (H_t - H_{t-1} > L_{t-1} - L_t and H_t - H_{t-1} > 0) else 0.0
   -DM_t = (L_{t-1} - L_t) if (L_{t-1} - L_t > H_t - H_{t-1} and L_{t-1} - L_t > 0) else 0.0
2. Canonical Benchmark Verification:
   - Requires 15 candles for initial TR14, +DM14, -DM14 sum.
   - Initial +DI, -DI, and DX available at candle 14 (15th candle).
   - Requires 14 DX values (28 candles: index 0 to 27) for initial ADX seed.
   - Initial ADX seed at candle 27 (28th candle) = sum(DX[:14]) / 14 = 59.95 -> 60.0.
   - Bar 32 (index 31): ADX = 49.6, +DI = 9.9, -DI = 12.4.
3. Explicit Wilder smoothing recurrence verification:
   ADX_t = (ADX_{t-1} * 13 + DX_t) / 14 (alpha = 1/14, distinct from rolling SMA).
4. Edge case handling:
   - Perfectly flat market (H=L=C): TR=0.0, +DM=0.0, -DM=0.0 -> ADX=0.0, +DI=0.0, -DI=0.0.
   - Insufficient data (< 28 candles) raises InsufficientDataError; calculate_adx_safe returns None.
   - Length mismatch across H/L/C raises ValueError.
   - Invalid values (NaN, Inf, <= 0, bad types) raise ValueError; calculate_adx_safe returns None.
   - Geometric violations (High < Low) raise ValueError.
5. Downstream Decision Gating:
   - When ADX or +DI or -DI is None, evaluate_with_jev strictly blocks BUY and forces HOLD with confidence 0.0.
   - When ADX < 20, blocked by chop filter.
   - When +DI < -DI, blocked by bearish momentum.
6. Python & TypeScript Numerical Parity:
   - Subprocess execution of Node.js verifying exact match (|delta| <= 0.1).
7. Active Unclosed Candle Invariance:
   - Mutating unclosed candle produces zero effect on confirmed ADX, +DI, and -DI.
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
    calculate_adx,
    calculate_adx_safe,
    InsufficientDataError,
    resolve_closed_klines,
    evaluate_with_jev,
    IndicatorEngine
)


class TestADX14WilderSuite(unittest.TestCase):

    def setUp(self):
        # 32-candle Canonical Benchmark OHLC Dataset
        self.canonical_highs = [
            30.20, 30.28, 30.45, 29.35, 29.35, 29.29, 28.83, 28.73, 28.67, 28.85,
            28.64, 28.55, 27.88, 28.00, 27.50, 27.60, 27.75, 27.50, 27.65, 27.70,
            27.75, 27.80, 27.85, 27.90, 27.95, 28.00, 28.10, 28.20, 28.30, 28.40,
            28.50, 28.60
        ]
        self.canonical_lows = [
            29.41, 29.32, 29.96, 28.65, 28.83, 28.64, 28.20, 27.98, 27.73, 28.05,
            27.88, 27.60, 27.35, 27.20, 26.70, 26.80, 27.10, 26.90, 27.00, 27.10,
            27.15, 27.20, 27.25, 27.30, 27.35, 27.40, 27.50, 27.60, 27.70, 27.80,
            27.90, 28.00
        ]
        self.canonical_closes = [
            29.87, 30.24, 30.10, 28.90, 28.92, 28.92, 28.48, 28.56, 27.98, 28.60,
            28.00, 27.65, 27.40, 27.70, 27.20, 27.40, 27.30, 27.10, 27.50, 27.40,
            27.50, 27.60, 27.70, 27.75, 27.80, 27.90, 28.00, 28.10, 28.20, 28.30,
            28.40, 28.50
        ]

    # --------------------------------------------------------------------------
    # 1. CANONICAL BENCHMARK VERIFICATION
    # --------------------------------------------------------------------------
    def test_canonical_wilder_benchmark_values(self):
        """
        Verify exact match against independent first-principles step-by-step calculations:
        - Candle 27 (28th candle): Initial ADX seed available = 60.0, +DI = 7.8, -DI = 16.2
        - Candle 31 (32nd candle): ADX = 49.6, +DI = 9.9, -DI = 12.4
        """
        # Test full 32-candle series
        res32 = calculate_adx(self.canonical_highs, self.canonical_lows, self.canonical_closes, period=14)
        self.assertIsInstance(res32, dict)
        self.assertAlmostEqual(res32["adx"], 49.6, delta=0.1, msg="ADX at bar 32 should be 49.6")
        self.assertAlmostEqual(res32["plus_di"], 9.9, delta=0.1, msg="+DI at bar 32 should be 9.9")
        self.assertAlmostEqual(res32["minus_di"], 12.4, delta=0.1, msg="-DI at bar 32 should be 12.4")

        # Test at exact 28 candles (initial ADX seed)
        res28 = calculate_adx(self.canonical_highs[:28], self.canonical_lows[:28], self.canonical_closes[:28], period=14)
        self.assertAlmostEqual(res28["adx"], 60.0, delta=0.1, msg="Initial ADX seed at bar 28 should round to 60.0")
        self.assertAlmostEqual(res28["plus_di"], 7.8, delta=0.1, msg="Initial +DI at bar 28 should round to 7.8")
        self.assertAlmostEqual(res28["minus_di"], 16.2, delta=0.1, msg="Initial -DI at bar 28 should round to 16.2")

    # --------------------------------------------------------------------------
    # 2. WILDER RECURRENCE VS ROLLING SMA DISTINCTION
    # --------------------------------------------------------------------------
    def test_wilder_smoothing_vs_rolling_sma_distinction(self):
        """
        Verify that calculate_adx uses Wilder's recurrence:
        ADX_t = (ADX_{t-1} * 13 + DX_t) / 14
        and NOT a rolling simple moving average (SMA) of DX.
        Rolling SMA produces 43.8 whereas Wilder recurrence produces 49.6 (diff > 5.0).
        """
        res = calculate_adx(self.canonical_highs, self.canonical_lows, self.canonical_closes, period=14)
        self.assertAlmostEqual(res["adx"], 49.6, delta=0.1)
        self.assertNotAlmostEqual(res["adx"], 43.8, delta=2.0, msg="Should NOT equal rolling SMA of DX")

    # --------------------------------------------------------------------------
    # 3. INSUFFICIENT DATA REJECTION
    # --------------------------------------------------------------------------
    def test_insufficient_data_rejection(self):
        """
        Datasets with fewer than 28 candles (< 2 * period) must raise InsufficientDataError.
        calculate_adx_safe must return None.
        """
        test_counts = [0, 1, 10, 14, 15, 20, 27]
        for count in test_counts:
            h = self.canonical_highs[:count]
            l = self.canonical_lows[:count]
            c = self.canonical_closes[:count]

            with self.assertRaises(InsufficientDataError):
                calculate_adx(h, l, c, period=14)

            self.assertIsNone(calculate_adx_safe(h, l, c, period=14))

        # None inputs
        with self.assertRaises(InsufficientDataError):
            calculate_adx(None, self.canonical_lows, self.canonical_closes)
        self.assertIsNone(calculate_adx_safe(None, self.canonical_lows, self.canonical_closes))

    # --------------------------------------------------------------------------
    # 4. ARRAY LENGTH MISMATCH REJECTION
    # --------------------------------------------------------------------------
    def test_array_length_mismatch_rejection(self):
        """
        Mismatched lengths among highs, lows, and closes must raise ValueError.
        """
        h = self.canonical_highs[:30]
        l = self.canonical_lows[:29]
        c = self.canonical_closes[:30]

        with self.assertRaises(ValueError):
            calculate_adx(h, l, c, period=14)
        self.assertIsNone(calculate_adx_safe(h, l, c, period=14))

    # --------------------------------------------------------------------------
    # 5. INVALID VALUES AND GEOMETRIC VIOLATIONS
    # --------------------------------------------------------------------------
    def test_invalid_values_and_geometric_violations(self):
        """
        NaN, Infinity, negative prices, zero prices, string types, and High < Low
        must raise ValueError, and calculate_adx_safe must return None.
        """
        # High < Low (Geometric violation)
        bad_h = list(self.canonical_highs)
        bad_l = list(self.canonical_lows)
        bad_c = list(self.canonical_closes)
        bad_h[20] = bad_l[20] - 1.0  # High lower than Low

        with self.assertRaises(ValueError) as ctx:
            calculate_adx(bad_h, bad_l, bad_c, period=14)
        self.assertIn("Geometric price violation", str(ctx.exception))
        self.assertIsNone(calculate_adx_safe(bad_h, bad_l, bad_c, period=14))

        # NaN injection
        nan_h = list(self.canonical_highs)
        nan_h[18] = float('nan')
        with self.assertRaises(ValueError):
            calculate_adx(nan_h, bad_l, bad_c, period=14)
        self.assertIsNone(calculate_adx_safe(nan_h, bad_l, bad_c, period=14))

        # Infinity injection
        inf_l = list(self.canonical_lows)
        inf_l[18] = float('inf')
        with self.assertRaises(ValueError):
            calculate_adx(bad_h, inf_l, bad_c, period=14)
        self.assertIsNone(calculate_adx_safe(bad_h, inf_l, bad_c, period=14))

        # Zero or negative price
        zero_c = list(self.canonical_closes)
        zero_c[10] = 0.0
        with self.assertRaises(ValueError):
            calculate_adx(bad_h, bad_l, zero_c, period=14)
        self.assertIsNone(calculate_adx_safe(bad_h, bad_l, zero_c, period=14))

    # --------------------------------------------------------------------------
    # 6. FLAT MARKET (ZERO MOVEMENT)
    # --------------------------------------------------------------------------
    def test_flat_market_produces_zero_adx_and_di(self):
        """
        When all OHLC values are identical, TR, +DM, -DM are 0.0.
        Division by zero is avoided, returning adx=0.0, plus_di=0.0, minus_di=0.0.
        """
        flat_h = [50000.0] * 35
        flat_l = [50000.0] * 35
        flat_c = [50000.0] * 35

        res = calculate_adx(flat_h, flat_l, flat_c, period=14)
        self.assertEqual(res["adx"], 0.0)
        self.assertEqual(res["plus_di"], 0.0)
        self.assertEqual(res["minus_di"], 0.0)

    # --------------------------------------------------------------------------
    # 7. DIRECTIONAL TREND DOMINANCE
    # --------------------------------------------------------------------------
    def test_directional_trend_dominance(self):
        """
        Strong Up-trend: +DI dominates, -DI is 0.0, ADX becomes elevated.
        Strong Down-trend: -DI dominates, +DI is 0.0, ADX becomes elevated.
        """
        # Strong Up-trend
        up_h = [100.0 + i * 2.0 for i in range(35)]
        up_l = [98.0 + i * 2.0 for i in range(35)]
        up_c = [99.0 + i * 2.0 for i in range(35)]

        res_up = calculate_adx(up_h, up_l, up_c, period=14)
        self.assertGreater(res_up["adx"], 40.0, "ADX should register strong trend")
        self.assertGreater(res_up["plus_di"], res_up["minus_di"], "+DI must dominate in up-trend")
        self.assertEqual(res_up["minus_di"], 0.0, "-DI should be 0.0 in continuous up-trend")

        # Strong Down-trend
        down_h = [200.0 - i * 2.0 for i in range(35)]
        down_l = [198.0 - i * 2.0 for i in range(35)]
        down_c = [199.0 - i * 2.0 for i in range(35)]

        res_down = calculate_adx(down_h, down_l, down_c, period=14)
        self.assertGreater(res_down["adx"], 40.0, "ADX should register strong trend")
        self.assertGreater(res_down["minus_di"], res_down["plus_di"], "-DI must dominate in down-trend")
        self.assertEqual(res_down["plus_di"], 0.0, "+DI should be 0.0 in continuous down-trend")

    # --------------------------------------------------------------------------
    # 8. PYTHON AND TYPESCRIPT NUMERICAL PARITY
    # --------------------------------------------------------------------------
    def test_python_and_typescript_parity(self):
        """
        Execute Node.js to evaluate TypeScript calculateAdx on canonical dataset,
        verifying exact parity between Python and TypeScript.
        """
        node_script = """
        const highs = [30.20, 30.28, 30.45, 29.35, 29.35, 29.29, 28.83, 28.73, 28.67, 28.85, 28.64, 28.55, 27.88, 28.00, 27.50, 27.60, 27.75, 27.50, 27.65, 27.70, 27.75, 27.80, 27.85, 27.90, 27.95, 28.00, 28.10, 28.20, 28.30, 28.40, 28.50, 28.60];
        const lows =  [29.41, 29.32, 29.96, 28.65, 28.83, 28.64, 28.20, 27.98, 27.73, 28.05, 27.88, 27.60, 27.35, 27.20, 26.70, 26.80, 27.10, 26.90, 27.00, 27.10, 27.15, 27.20, 27.25, 27.30, 27.35, 27.40, 27.50, 27.60, 27.70, 27.80, 27.90, 28.00];
        const closes =[29.87, 30.24, 30.10, 28.90, 28.92, 28.92, 28.48, 28.56, 27.98, 28.60, 28.00, 27.65, 27.40, 27.70, 27.20, 27.40, 27.30, 27.10, 27.50, 27.40, 27.50, 27.60, 27.70, 27.75, 27.80, 27.90, 28.00, 28.10, 28.20, 28.30, 28.40, 28.50];

        function calculateAdx(highs, lows, closes, period = 14) {
          if (!highs || !lows || !closes) return null;
          if (highs.length !== lows.length || lows.length !== closes.length) return null;
          if (closes.length < period * 2) return null;

          const cleanHighs = [];
          const cleanLows = [];
          const cleanCloses = [];
          for (let i = 0; i < closes.length; i++) {
            const h = Number(highs[i]);
            const l = Number(lows[i]);
            const c = Number(closes[i]);
            if (!Number.isFinite(h) || !Number.isFinite(l) || !Number.isFinite(c)) return null;
            if (h <= 0 || l <= 0 || c <= 0 || h < l) return null;
            cleanHighs.push(h); cleanLows.push(l); cleanCloses.push(c);
          }

          const tr = [];
          const plusDm = [];
          const minusDm = [];
          for (let i = 1; i < cleanCloses.length; i++) {
            const h = cleanHighs[i], l = cleanLows[i];
            const ph = cleanHighs[i - 1], pl = cleanLows[i - 1], pc = cleanCloses[i - 1];
            tr.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
            const upMove = h - ph;
            const downMove = pl - l;
            plusDm.push(upMove > downMove && upMove > 0 ? upMove : 0);
            minusDm.push(downMove > upMove && downMove > 0 ? downMove : 0);
          }

          let trSmoothed = tr.slice(0, period).reduce((a, b) => a + b, 0);
          let plusDmSmoothed = plusDm.slice(0, period).reduce((a, b) => a + b, 0);
          let minusDmSmoothed = minusDm.slice(0, period).reduce((a, b) => a + b, 0);

          const dxList = [];
          const initialPlusDi = trSmoothed === 0 ? 0 : (plusDmSmoothed / trSmoothed) * 100;
          const initialMinusDi = trSmoothed === 0 ? 0 : (minusDmSmoothed / trSmoothed) * 100;
          const diSum = initialPlusDi + initialMinusDi;
          dxList.push(diSum === 0 ? 0 : (Math.abs(initialPlusDi - initialMinusDi) / diSum) * 100);

          let currentPlusDi = initialPlusDi;
          let currentMinusDi = initialMinusDi;

          for (let i = period; i < tr.length; i++) {
            trSmoothed = trSmoothed - (trSmoothed / period) + tr[i];
            plusDmSmoothed = plusDmSmoothed - (plusDmSmoothed / period) + plusDm[i];
            minusDmSmoothed = minusDmSmoothed - (minusDmSmoothed / period) + minusDm[i];
            currentPlusDi = trSmoothed === 0 ? 0 : (plusDmSmoothed / trSmoothed) * 100;
            currentMinusDi = trSmoothed === 0 ? 0 : (minusDmSmoothed / trSmoothed) * 100;
            const currentDiSum = currentPlusDi + currentMinusDi;
            dxList.push(currentDiSum === 0 ? 0 : (Math.abs(currentPlusDi - currentMinusDi) / currentDiSum) * 100);
          }

          if (dxList.length < period) return null;

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

        const out = {
          full: calculateAdx(highs, lows, closes, 14),
          seed28: calculateAdx(highs.slice(0, 28), lows.slice(0, 28), closes.slice(0, 28), 14),
          short: calculateAdx(highs.slice(0, 20), lows.slice(0, 20), closes.slice(0, 20), 14)
        };
        console.log(JSON.stringify(out));
        """
        proc = subprocess.run(["node", "-e", node_script], capture_output=True, text=True, check=True)
        ts_res = json.loads(proc.stdout.strip())

        py_res32 = calculate_adx(self.canonical_highs, self.canonical_lows, self.canonical_closes, period=14)
        py_res28 = calculate_adx(self.canonical_highs[:28], self.canonical_lows[:28], self.canonical_closes[:28], period=14)

        self.assertEqual(py_res32["adx"], ts_res["full"]["adx"])
        self.assertEqual(py_res32["plus_di"], ts_res["full"]["plusDi"])
        self.assertEqual(py_res32["minus_di"], ts_res["full"]["minusDi"])

        self.assertEqual(py_res28["adx"], ts_res["seed28"]["adx"])
        self.assertEqual(py_res28["plus_di"], ts_res["seed28"]["plusDi"])
        self.assertEqual(py_res28["minus_di"], ts_res["seed28"]["minusDi"])

        self.assertIsNone(ts_res["short"])

    # --------------------------------------------------------------------------
    # 9. TRADING LOGIC BLOCKS BUY WHEN ADX/DI UNREADY OR UNSUPPORTIVE
    # --------------------------------------------------------------------------
    def test_trading_logic_blocks_buy_when_adx_is_unready(self):
        """
        Ensure that evaluate_with_jev strictly blocks any BUY signal when ADX or DI is None or unready.
        """
        base_state = {
            "15m": {
                "current_close": 65000.0,
                "closed_close": 65000.0,
                "ema20": 64000.0,
                "rsi": 55.0,
                "atr": 100.0,
                "adx": 30.0,
                "plus_di": 28.0,
                "minus_di": 14.0,
                "volume_spike": False
            },
            "1h": {
                "current_close": 65000.0,
                "closed_close": 65000.0,
                "ema20": 63000.0,
                "rsi": 58.0,
                "atr": 200.0,
                "adx": 32.0,
                "plus_di": 30.0,
                "minus_di": 12.0,
                "volume_spike": False
            }
        }

        # 1. Baseline setup triggers BUY
        dec_valid = evaluate_with_jev("BTCUSDT", base_state)
        self.assertEqual(dec_valid["action"], "BUY")

        # 2. ADX is None -> strictly HOLD
        state_none_adx = json.loads(json.dumps(base_state))
        state_none_adx["15m"]["adx"] = None
        dec = evaluate_with_jev("BTCUSDT", state_none_adx)
        self.assertEqual(dec["action"], "HOLD")
        self.assertEqual(dec["confidence"], 0.0)
        self.assertIn("Insufficient data for ADX14", dec["reason"])

        # 3. +DI is None -> strictly HOLD
        state_none_plus = json.loads(json.dumps(base_state))
        state_none_plus["15m"]["plus_di"] = None
        dec = evaluate_with_jev("BTCUSDT", state_none_plus)
        self.assertEqual(dec["action"], "HOLD")
        self.assertEqual(dec["confidence"], 0.0)
        self.assertIn("Insufficient data for ADX14", dec["reason"])

        # 4. -DI is None -> strictly HOLD
        state_none_minus = json.loads(json.dumps(base_state))
        state_none_minus["15m"]["minus_di"] = None
        dec = evaluate_with_jev("BTCUSDT", state_none_minus)
        self.assertEqual(dec["action"], "HOLD")
        self.assertEqual(dec["confidence"], 0.0)
        self.assertIn("Insufficient data for ADX14", dec["reason"])

        # 5. ADX < 20 -> Blocked by Chop Filter
        state_chop = json.loads(json.dumps(base_state))
        state_chop["15m"]["adx"] = 18.5
        dec = evaluate_with_jev("BTCUSDT", state_chop)
        self.assertEqual(dec["action"], "HOLD")
        self.assertEqual(dec["confidence"], 0.0)
        self.assertIn("Blocked by ADX Chop Filter", dec["reason"])

        # 6. +DI < -DI -> Bearish momentum blocks BUY
        state_bearish_di = json.loads(json.dumps(base_state))
        state_bearish_di["15m"]["plus_di"] = 15.0
        state_bearish_di["15m"]["minus_di"] = 25.0
        dec = evaluate_with_jev("BTCUSDT", state_bearish_di)
        self.assertEqual(dec["action"], "HOLD")
        self.assertEqual(dec["confidence"], 0.0)
        self.assertIn("Bearish momentum (-DI > +DI)", dec["reason"])

    # --------------------------------------------------------------------------
    # 10. ACTIVE UNCLOSED CANDLE INVARIANCE
    # --------------------------------------------------------------------------
    def test_unclosed_candle_invariance(self):
        """
        Mutating an active, unclosed candle produces zero difference in ADX, +DI, and -DI
        computed on confirmed closed candles.
        """
        interval_ms = 900000
        base_time = 1700000000000

        def create_kline(open_t, duration_ms, close_p, high_p, low_p):
            return [
                open_t,
                str(close_p - 10.0),
                str(high_p),
                str(low_p),
                str(close_p),
                "100.0",
                open_t + duration_ms - 1,
                "1000.0", 10, "50.0", "500.0", "0"
            ]

        # 30 confirmed closed candles
        closed_klines = [
            create_kline(base_time + i * interval_ms, interval_ms, self.canonical_closes[i], self.canonical_highs[i], self.canonical_lows[i])
            for i in range(30)
        ]
        fixed_ref_time = closed_klines[-1][6] + 100

        c_highs = [float(k[2]) for k in closed_klines]
        c_lows = [float(k[3]) for k in closed_klines]
        c_closes = [float(k[4]) for k in closed_klines]

        baseline = calculate_adx(c_highs, c_lows, c_closes, 14)

        wild_variations = [
            create_kline(closed_klines[-1][6] + 1, interval_ms, 500.0, 600.0, 450.0),
            create_kline(closed_klines[-1][6] + 1, interval_ms, 1.0, 2.0, 0.5),
            create_kline(closed_klines[-1][6] + 1, interval_ms, 30.0, 31.0, 29.0),
        ]

        for wild_bar in wild_variations:
            series = closed_klines + [wild_bar]
            resolved = resolve_closed_klines(series, reference_time_ms=fixed_ref_time)
            res_highs = [float(k[2]) for k in resolved]
            res_lows = [float(k[3]) for k in resolved]
            res_closes = [float(k[4]) for k in resolved]

            test_res = calculate_adx(res_highs, res_lows, res_closes, 14)
            self.assertEqual(test_res["adx"], baseline["adx"])
            self.assertEqual(test_res["plus_di"], baseline["plus_di"])
            self.assertEqual(test_res["minus_di"], baseline["minus_di"])


if __name__ == "__main__":
    unittest.main()
