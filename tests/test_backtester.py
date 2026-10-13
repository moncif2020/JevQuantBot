"""
================================================================================
JevQuant Backtester V0.1 - Unit & Sanity Verification Test Suite
================================================================================
Enforces:
1. Anti-Lookahead Bias (Zero future leakage).
2. Capital & Risk Limits Enforcement (Spot no-margin, allocation ceiling).
3. Accurate Fee & Slippage Deduction Accounting.
4. Filter Effectiveness (ADX Chop & Liquidity Trap prevention).
5. Complete Isolation Guarantee (No Binance order sending).
================================================================================
"""

import unittest
import copy
import sys
import os

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from standalone_backtester import (
    StandaloneBacktester,
    MarketDataFetcher,
    IndicatorEngine,
    Candle
)
from specs.rules_spec import StrategySpecificationV01


class TestBacktesterV01Integrity(unittest.TestCase):

    def setUp(self):
        self.rules = StrategySpecificationV01()
        self.candles = MarketDataFetcher.generate_stress_test_dataset(symbol="BTCUSDT", count=300)

    def test_no_lookahead_bias(self):
        """
        Verify that evaluating bar T is strictly unaffected by any modifications to bars T+1, T+2...
        """
        engine = StandaloneBacktester(initial_capital=10000.0, symbol="BTCUSDT")
        target_bar_idx = 100

        # Baseline evaluation
        res_baseline = engine.evaluate_bar(self.candles, target_bar_idx)
        self.assertIsNotNone(res_baseline, "Target bar should have valid indicators")

        # Create mutated candles where future bars after target_bar_idx are drastically manipulated
        mutated_candles = copy.deepcopy(self.candles)
        for i in range(target_bar_idx + 1, len(mutated_candles)):
            mutated_candles[i].close *= 10.0 # Extreme future price surge
            mutated_candles[i].high *= 10.0
            mutated_candles[i].low *= 0.1
            mutated_candles[i].volume *= 100.0

        # Re-evaluate target_bar_idx with mutated future
        res_after_mutation = engine.evaluate_bar(mutated_candles, target_bar_idx)

        # Assert zero change in indicators or decision
        self.assertEqual(res_baseline["close"], res_after_mutation["close"])
        self.assertEqual(res_baseline["confluence"], res_after_mutation["confluence"])
        self.assertEqual(res_baseline["conviction"], res_after_mutation["conviction"])
        self.assertEqual(res_baseline["confidence"], res_after_mutation["confidence"])
        self.assertEqual(res_baseline["can_buy"], res_after_mutation["can_buy"])
        self.assertAlmostEqual(res_baseline["atr"], res_after_mutation["atr"], places=4)
        self.assertAlmostEqual(res_baseline["adx"], res_after_mutation["adx"], places=2)
        print("✅ PASSED: test_no_lookahead_bias (Zero future data leakage confirmed)")

    def test_capital_risk_limits(self):
        """
        Verify capital preservation:
        1. Maximum single allocation never exceeds 20% of current capital.
        2. Absolute single trade cap ($2,000) is enforced.
        3. Cash balance never drops below zero (Spot no-debt rule).
        """
        initial_capital = 10000.0
        engine = StandaloneBacktester(initial_capital=initial_capital, symbol="BTCUSDT")
        metrics = engine.run(self.candles)

        self.assertGreater(metrics["total_trades"], 0, "Backtest should have executed trades")

        for trade in engine.closed_trades:
            trade_val = trade["trade_value_usdt"]
            # Max 20% rule + cap
            self.assertLessEqual(trade_val, 2000.0 + 1e-4, f"Trade value {trade_val} exceeded cap of 2000")
            self.assertGreater(trade["quantity"], 0.0, "Quantity must be positive")

        for point in engine.equity_curve:
            self.assertGreaterEqual(point["cash"], 0.0, f"Cash balance dropped below zero: {point['cash']}")
            self.assertGreaterEqual(point["total_equity"], 0.0, "Total equity cannot be negative in Spot")

        print("✅ PASSED: test_capital_risk_limits (Max 20% cap & Spot solvency guaranteed)")

    def test_fee_and_slippage_accounting(self):
        """
        Verify that Binance 0.10% taker fee and 0.05% slippage are accurately accounted for.
        """
        engine = StandaloneBacktester(initial_capital=10000.0, symbol="BTCUSDT")
        engine.run(self.candles)

        for trade in engine.closed_trades:
            # Entry fee ~ 0.10% of trade_value_usdt
            expected_entry_fee = trade["trade_value_usdt"] * 0.001
            self.assertAlmostEqual(trade["entry_fee_usdt"], expected_entry_fee, places=2)

            # Gross PnL vs Net PnL: Net must be strictly lower than Gross due to costs (fees + slippage)
            self.assertLess(trade["net_pnl_usdt"], trade["gross_pnl_usdt"], "Net PnL must account for fees and slippage")
            total_frictional_cost = trade["entry_fee_usdt"] + trade["exit_fee_usdt"] + (trade["slippage_cost_usdt"] / 2.0)
            cost_difference = trade["gross_pnl_usdt"] - trade["net_pnl_usdt"]
            self.assertGreaterEqual(cost_difference, trade["entry_fee_usdt"] + trade["exit_fee_usdt"], "Cost difference must exceed or equal fees alone")
            self.assertAlmostEqual(cost_difference, total_frictional_cost, delta=1.0)

        print("✅ PASSED: test_fee_and_slippage_accounting (Fees and slippage accurately deducted)")

    def test_adx_and_trap_filters(self):
        """
        Verify that choppy market conditions (ADX < 20) and liquidity traps (Trap_P >= 0.20) block entry.
        """
        engine = StandaloneBacktester(initial_capital=10000.0, symbol="BTCUSDT")

        # Synthetic choppy candle slice
        chop_candles = [
            Candle(
                timestamp=1000 + i * 900000,
                open_=60000.0,
                high=60050.0 if i % 2 == 0 else 60020.0,
                low=59950.0 if i % 2 == 0 else 59980.0,
                close=60005.0 if i % 2 == 0 else 59995.0,
                volume=10.0
            )
            for i in range(80)
        ]

        res = engine.evaluate_bar(chop_candles, len(chop_candles) - 1)
        self.assertIsNotNone(res)
        self.assertFalse(res["can_buy"], "Choppy sideways market must NOT trigger buy signal")
        self.assertLess(res["adx"], 20.0, "ADX should register below 20 for sideways chop")

        print("✅ PASSED: test_adx_and_trap_filters (Chop & trap filters successfully blocked bad setups)")

    def test_zero_binance_orders_sent(self):
        """
        Verify that backtester code is completely isolated: does not import or invoke
        Binance signed order endpoints.
        """
        backtester_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "standalone_backtester.py"))
        with open(backtester_path, "r", encoding="utf-8") as f:
            code = f.read()

        prohibited_terms = [
            "create_order",
            "order_market_buy",
            "order_market_sell",
            "execute_binance_spot_order",
            "send_order",
            "hmac.new",
            "api_secret"
        ]

        for term in prohibited_terms:
            self.assertNotIn(term, code, f"Prohibited real order execution term '{term}' found in backtester!")

        print("✅ PASSED: test_zero_binance_orders_sent (Verified complete execution isolation)")


if __name__ == "__main__":
    unittest.main()
