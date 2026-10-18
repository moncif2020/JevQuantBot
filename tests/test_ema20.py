#!/usr/bin/env python3
"""
Unit Test Suite for EMA20 Mathematical Integrity, Data Quality & Safety (Phase 2.1)
Guarantees:
1. Exact match with canonical benchmark values using alpha = 2 / (20 + 1) and SMA seed.
2. Explicit rejection of insufficient data (< 20 closes) with InsufficientDataError.
3. No fallback to misleading alternative averages.
4. Validation and rejection of NaN, Inf, non-positive, or invalid data.
5. Exact Candle State Resolution: checks k[6] (close_time) against reference time (Mission 1).
6. Unified Indicator Inputs: mutating open/unclosed candle produces zero change across EMA20, RSI, ATR, ADX (Mission 2).
7. Time-Series Hygiene Guard: strictly rejects unordered timestamps, duplicates, and abnormal gaps (Mission 3).
8. Decision gating: blocks any BUY signal when EMA20 is unready (None).
9. Strict Transport-Level Network Isolation: blocks any socket/HTTP requests to Binance (Mission 5).
"""

import unittest
import sys
import os
import math
import socket
from unittest.mock import patch, MagicMock

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from standalone_backtester import (
    calculate_ema,
    calculate_ema_safe,
    calculate_rsi,
    calculate_atr,
    calculate_adx,
    InsufficientDataError,
    DataHygieneError,
    resolve_closed_klines,
    validate_time_series_hygiene,
    evaluate_with_jev,
    execute_binance_order
)

class TestEMA20RemediationSuite(unittest.TestCase):

    def setUp(self):
        # 30-candle canonical dataset (Standard StockCharts / Quant Benchmark)
        self.canonical_closes = [
            22.27, 22.19, 22.08, 22.17, 22.18, 22.13, 22.23, 22.43, 22.24, 22.29,
            22.15, 22.39, 22.38, 22.61, 23.36, 24.05, 23.75, 23.83, 23.95, 23.63,
            23.82, 23.87, 23.65, 23.19, 23.10, 23.33, 22.68, 23.10, 22.40, 22.17
        ]

    # --------------------------------------------------------------------------
    # 1. MATHEMATICAL VERIFICATION & BENCHMARKS
    # --------------------------------------------------------------------------
    def test_canonical_benchmark_values(self):
        """
        Verify that EMA20 matches independent ground truth values computed via:
        alpha = 2 / 21
        seed = sum(closes[:20]) / 20 = 22.7155 -> 22.72
        Bar 20 (close=23.82): EMA = 22.8207 -> 22.82
        Bar 29 (close=22.17): EMA = 22.8863 -> 22.89
        """
        ema_20 = calculate_ema(self.canonical_closes[:20], period=20)
        expected_seed = round(sum(self.canonical_closes[:20]) / 20.0, 2)
        self.assertEqual(ema_20, expected_seed)
        self.assertEqual(ema_20, 22.72)

        ema_21 = calculate_ema(self.canonical_closes[:21], period=20)
        self.assertEqual(ema_21, 22.82)

        ema_30 = calculate_ema(self.canonical_closes, period=20)
        self.assertEqual(ema_30, 22.89)

    def test_insufficient_data_rejection(self):
        """
        Verify that datasets with fewer than 20 candles raise InsufficientDataError,
        and safe function returns None (no artificial or misleading averages).
        """
        short_series = [100.0 + i for i in range(19)]
        with self.assertRaises(InsufficientDataError):
            calculate_ema(short_series, period=20)

        with self.assertRaises(InsufficientDataError):
            calculate_ema([], period=20)

        with self.assertRaises(InsufficientDataError):
            calculate_ema(None, period=20)

        self.assertIsNone(calculate_ema_safe(short_series, period=20))
        self.assertIsNone(calculate_ema_safe([], period=20))
        self.assertIsNone(calculate_ema_safe(None, period=20))

    def test_invalid_data_types_and_values(self):
        """
        Verify strict rejection of NaN, Inf, non-positive numbers, and bad strings.
        """
        nan_series = [100.0] * 19 + [float('nan')]
        with self.assertRaises(ValueError):
            calculate_ema(nan_series, period=20)
        self.assertIsNone(calculate_ema_safe(nan_series, period=20))

        negative_series = [100.0] * 19 + [-50.0]
        with self.assertRaises(ValueError):
            calculate_ema(negative_series, period=20)
        self.assertIsNone(calculate_ema_safe(negative_series, period=20))

        zero_series = [100.0] * 19 + [0.0]
        with self.assertRaises(ValueError):
            calculate_ema(zero_series, period=20)
        self.assertIsNone(calculate_ema_safe(zero_series, period=20))

        bad_str_series = [100.0] * 19 + ["corrupted"]
        with self.assertRaises(ValueError):
            calculate_ema(bad_str_series, period=20)
        self.assertIsNone(calculate_ema_safe(bad_str_series, period=20))

    def test_temporal_ordering_sensitivity(self):
        """Verify that altering chronological order changes EMA."""
        ema_forward = calculate_ema(self.canonical_closes, period=20)
        reversed_closes = list(reversed(self.canonical_closes))
        ema_reversed = calculate_ema(reversed_closes, period=20)
        self.assertNotEqual(ema_forward, ema_reversed)

    # --------------------------------------------------------------------------
    # 2. MISSION 1: EXACT CANDLE STATE RESOLUTION (Closed vs Open)
    # --------------------------------------------------------------------------
    def _create_mock_kline(self, open_time: int, interval_ms: int, close_px: float) -> list:
        # Binance kline: [open_time, open, high, low, close, vol, close_time, ...]
        close_time = open_time + interval_ms - 1
        return [open_time, close_px - 5.0, close_px + 10.0, close_px - 10.0, close_px, 100.0, close_time, 0, 0, 0, 0, 0]

    def test_candle_resolution_historical_all_closed(self):
        """1. A historical series where all candles end in the past must keep all candles."""
        interval_ms = 900000 # 15m
        base_time = 1700000000000
        klines = [self._create_mock_kline(base_time + i * interval_ms, interval_ms, 60000.0 + i) for i in range(25)]
        
        # Reference time is after the last candle's close_time
        ref_time = klines[-1][6] + 1000
        resolved = resolve_closed_klines(klines, reference_time_ms=ref_time)
        self.assertEqual(len(resolved), 25, "All historical candles must be kept as closed")
        self.assertEqual(resolved[-1][0], klines[-1][0])

    def test_candle_resolution_active_unclosed_candle_excluded(self):
        """2. A series ending with an active candle (close_time > ref_time) must exclude the active candle."""
        interval_ms = 900000 # 15m
        base_time = 1700000000000
        klines = [self._create_mock_kline(base_time + i * interval_ms, interval_ms, 60000.0 + i) for i in range(25)]
        
        # Reference time is in the middle of candle index 24 (so it is NOT closed yet)
        ref_time = klines[-1][0] + (interval_ms // 2)
        resolved = resolve_closed_klines(klines, reference_time_ms=ref_time)
        self.assertEqual(len(resolved), 24, "Unclosed active candle must be excluded")
        self.assertEqual(resolved[-1][0], klines[-2][0], "Last resolved candle must be candle 23")

    def test_candle_resolution_single_open_candle(self):
        """3. A series containing only a single open candle must resolve to 0 closed candles."""
        interval_ms = 900000
        base_time = 1700000000000
        klines = [self._create_mock_kline(base_time, interval_ms, 60000.0)]
        ref_time = base_time + 1000 # Still open
        resolved = resolve_closed_klines(klines, reference_time_ms=ref_time)
        self.assertEqual(len(resolved), 0, "Single open candle must result in empty closed list")

    def test_candle_resolution_no_valid_closed_candles(self):
        """4. Series with empty list or invalid candles returns empty list safely."""
        self.assertEqual(resolve_closed_klines([], reference_time_ms=1700000000000), [])
        self.assertEqual(resolve_closed_klines(None, reference_time_ms=1700000000000), [])

    def test_candle_resolution_reproducible_injected_clock(self):
        """5. Historical data tested with a fixed injected reference time produces deterministic results."""
        interval_ms = 900000
        base_time = 1700000000000
        klines = [self._create_mock_kline(base_time + i * interval_ms, interval_ms, 60000.0) for i in range(10)]
        
        fixed_ref_clock = klines[4][6] # exactly at close of bar 4
        resolved = resolve_closed_klines(klines, reference_time_ms=fixed_ref_clock)
        self.assertEqual(len(resolved), 5, "Bars 0 to 4 must be closed at fixed reference time")

    # --------------------------------------------------------------------------
    # 3. MISSION 2: UNIFIED INDICATOR INPUTS (Anti-Repainting Invariance)
    # --------------------------------------------------------------------------
    def test_unified_indicator_inputs_invariance(self):
        """
        Verify that mutating/perturbing an active unclosed candle produces ZERO change
        across ALL 4 indicators: EMA20, RSI(14), ATR(14), and ADX(14).
        """
        interval_ms = 900000
        base_time = 1700000000000
        
        # 30 confirmed closed candles
        closed_klines = [self._create_mock_kline(base_time + i * interval_ms, interval_ms, 60000.0 + (i * 25.0)) for i in range(30)]
        fixed_ref_time = closed_klines[-1][6] + 100 # all 30 closed
        
        c_closes = [k[4] for k in closed_klines]
        c_highs = [k[2] for k in closed_klines]
        c_lows = [k[3] for k in closed_klines]
        
        baseline_ema = calculate_ema(c_closes, 20)
        baseline_rsi = calculate_rsi(c_closes, 14)
        baseline_atr = calculate_atr(c_highs, c_lows, c_closes, 14)
        baseline_adx = calculate_adx(c_highs, c_lows, c_closes, 14)

        # Append wild active candles (surge 500%, flash crash 90%)
        wild_variations = [
            self._create_mock_kline(closed_klines[-1][6] + 1, interval_ms, 300000.0), # Extreme spike
            self._create_mock_kline(closed_klines[-1][6] + 1, interval_ms, 6000.0),   # Flash crash
            self._create_mock_kline(closed_klines[-1][6] + 1, interval_ms, 60000.0)
        ]

        for wild_bar in wild_variations:
            full_series = closed_klines + [wild_bar]
            # Use resolve_closed_klines with fixed_ref_time
            extracted_closed = resolve_closed_klines(full_series, reference_time_ms=fixed_ref_time)
            
            ext_closes = [k[4] for k in extracted_closed]
            ext_highs = [k[2] for k in extracted_closed]
            ext_lows = [k[3] for k in extracted_closed]

            self.assertEqual(calculate_ema(ext_closes, 20), baseline_ema)
            self.assertEqual(calculate_rsi(ext_closes, 14), baseline_rsi)
            self.assertEqual(calculate_atr(ext_highs, ext_lows, ext_closes, 14), baseline_atr)
            self.assertEqual(calculate_adx(ext_highs, ext_lows, ext_closes, 14), baseline_adx)

    # --------------------------------------------------------------------------
    # 4. MISSION 3: TIME-SERIES HYGIENE GUARD
    # --------------------------------------------------------------------------
    def test_hygiene_guard_accepts_valid_series(self):
        interval_ms = 900000
        base_time = 1700000000000
        klines = [self._create_mock_kline(base_time + i * interval_ms, interval_ms, 60000.0) for i in range(25)]
        # Should not raise
        validate_time_series_hygiene(klines, "15m")

    def test_hygiene_guard_rejects_unordered_timestamps(self):
        interval_ms = 900000
        base_time = 1700000000000
        klines = [self._create_mock_kline(base_time + i * interval_ms, interval_ms, 60000.0) for i in range(25)]
        # Swap bar 10 and 11
        klines[10], klines[11] = klines[11], klines[10]
        with self.assertRaises(DataHygieneError) as ctx:
            validate_time_series_hygiene(klines, "15m")
        self.assertIn("Unordered candle sequence", str(ctx.exception))

    def test_hygiene_guard_rejects_duplicate_timestamps(self):
        interval_ms = 900000
        base_time = 1700000000000
        klines = [self._create_mock_kline(base_time + i * interval_ms, interval_ms, 60000.0) for i in range(25)]
        # Duplicate timestamp at bar 15
        klines[15][0] = klines[14][0]
        with self.assertRaises(DataHygieneError) as ctx:
            validate_time_series_hygiene(klines, "15m")
        self.assertIn("Duplicate candle timestamp", str(ctx.exception))

    def test_hygiene_guard_rejects_geometric_violation(self):
        interval_ms = 900000
        base_time = 1700000000000
        klines = [self._create_mock_kline(base_time + i * interval_ms, interval_ms, 60000.0) for i in range(25)]
        # Corrupt bar 5: High < Low
        klines[5][2] = 50000.0
        klines[5][3] = 70000.0
        with self.assertRaises(DataHygieneError) as ctx:
            validate_time_series_hygiene(klines, "15m")
        self.assertIn("Geometric price violation", str(ctx.exception))

    def test_hygiene_guard_rejects_abnormal_gaps(self):
        interval_ms = 900000 # 15m
        base_time = 1700000000000
        klines = [self._create_mock_kline(base_time + i * interval_ms, interval_ms, 60000.0) for i in range(25)]
        # Inject huge gap between bar 10 and 11 (3 hours instead of 15m)
        klines[11][0] = klines[10][0] + (3 * 3600 * 1000)
        klines[11][6] = klines[11][0] + interval_ms - 1
        with self.assertRaises(DataHygieneError) as ctx:
            validate_time_series_hygiene(klines, "15m", max_gap_multiplier=2.5)
        self.assertIn("Abnormal time gap detected", str(ctx.exception))

    # --------------------------------------------------------------------------
    # 5. DECISION GATING & STRICT ISOLATION
    # --------------------------------------------------------------------------
    def test_trading_logic_blocks_buy_when_ema_is_unready(self):
        mock_mtf_missing_ema = {
            "15m": {
                "current_close": 65000.0,
                "closed_close": 64950.0,
                "ema20": None,
                "rsi": 55.0,
                "atr": 400.0,
                "adx": 30.0,
                "plus_di": 28.0,
                "minus_di": 12.0
            },
            "1h": {
                "current_close": 65000.0,
                "closed_close": 64950.0,
                "ema20": 63000.0,
                "rsi": 58.0,
                "atr": 600.0,
                "adx": 28.0,
                "plus_di": 25.0,
                "minus_di": 15.0
            }
        }
        decision = evaluate_with_jev("BTCUSDT", mock_mtf_missing_ema, is_currently_holding=False)
        self.assertEqual(decision["action"], "HOLD")
        self.assertEqual(decision["confidence"], 0.0)
        self.assertIn("Insufficient data for EMA20", decision["reason"])

    def test_strict_network_isolation_blocks_outbound_orders(self):
        """
        Mission 5: Transport-level isolation check.
        Ensures that calling execute_binance_order uses PaperBroker simulation
        and never makes outbound network calls.
        """
        # Patch socket.socket.connect at the transport layer to ensure any outbound attempt fails
        with patch("socket.socket.connect", side_effect=RuntimeError("NETWORK BLOCKED DURING TEST")):
            res = execute_binance_order("BTCUSDT", "BUY", 0.005, current_price=60000.0)
            self.assertTrue(res.get("is_simulated", False))
            self.assertEqual(res.get("mode"), "PAPER")

if __name__ == "__main__":
    unittest.main()
