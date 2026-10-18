#!/usr/bin/env python3
"""
Unit and Safety Verification Test Suite for JevQuant Execution Modes
Guarantees:
1. PAPER is default, blocks any real Binance orders, tracks virtual balance (500 USDT) & fees (0.10%).
2. TESTNET requires testnet credentials and rejects live keys.
3. LIVE is disabled by default, strictly requires confirmation phrase, preflight, and manual approval.
4. SecurityViolationError raised if safety checks bypassed.
5. Circuit breaker halts live trading on error.
"""

import unittest
import sys
import os

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from jev_execution_modes import (
    TradingMode,
    PaperBroker,
    TestnetBroker,
    LiveBroker,
    ExecutionManager,
    SecurityViolationError,
    SafetyCheckFailedError
)

class TestExecutionModes(unittest.TestCase):

    def test_default_mode_is_paper(self):
        """Verify default mode in ExecutionManager is PAPER."""
        mgr = ExecutionManager()
        self.assertEqual(mgr.mode, TradingMode.PAPER)
        summary = mgr.paper_broker.get_account_summary()
        self.assertEqual(summary["usdt_balance"], 500.0)
        self.assertTrue(summary["is_simulated"])

    def test_paper_trading_accounting_and_fees(self):
        """Verify paper broker simulates BUY and SELL, deducts 0.10% fees, and updates balance."""
        broker = PaperBroker(initial_capital_usdt=500.0, taker_fee_pct=0.10, slippage_pct=0.05)
        
        # BUY $100 of BTC at $60,000
        order_buy = broker.execute_order(
            symbol="BTCUSDT",
            side="BUY",
            quote_amount=100.0,
            current_market_price=60000.0,
            stop_loss=58000.0,
            take_profit=64000.0
        )
        self.assertTrue(order_buy.is_simulated)
        self.assertEqual(order_buy.mode, "PAPER")
        self.assertEqual(order_buy.fee, 0.10) # 0.10% of $100
        self.assertEqual(broker.usdt_balance, 400.0)
        self.assertIn("BTCUSDT", broker.positions)

        # SELL at $63,000 (profit)
        order_sell = broker.execute_order(
            symbol="BTCUSDT",
            side="SELL",
            quote_amount=0.0,
            current_market_price=63000.0
        )
        self.assertTrue(order_sell.is_simulated)
        self.assertGreater(order_sell.realized_pnl, 0.0)
        self.assertNotIn("BTCUSDT", broker.positions)
        self.assertGreater(broker.usdt_balance, 500.0)

    def test_paper_blocks_insufficient_funds(self):
        """Verify paper broker rejects orders exceeding virtual balance."""
        broker = PaperBroker(initial_capital_usdt=500.0)
        with self.assertRaises(ValueError):
            broker.execute_order("ETHUSDT", "BUY", quote_amount=600.0, current_market_price=3000.0)

    def test_testnet_rejects_empty_or_live_keys(self):
        """Verify TestnetBroker rejects empty credentials or keys with live identifiers."""
        with self.assertRaises(ValueError):
            TestnetBroker("", "")
        with self.assertRaises(SecurityViolationError):
            TestnetBroker("live_prod_key_12345", "secret")

    def test_live_mode_disabled_by_default(self):
        """Verify LiveBroker cannot be created without exact Arabic confirmation phrase."""
        with self.assertRaises(SecurityViolationError):
            LiveBroker(
                api_key="real_api_key",
                api_secret="real_secret",
                confirmation_phrase="wrong phrase"
            )

    def test_live_mode_rejects_testnet_keys(self):
        """Verify LiveBroker strictly rejects testnet keys."""
        with self.assertRaises(SecurityViolationError):
            LiveBroker(
                api_key="testnet_key_abc",
                api_secret="secret",
                confirmation_phrase=LiveBroker.REQUIRED_APPROVAL_PHRASE
            )

    def test_live_mode_blocks_execution_without_preflight_and_manual_approval(self):
        """Verify LiveBroker prevents orders if pre-flight or manual approval missing."""
        live_broker = LiveBroker(
            api_key="valid_production_key_45678",
            api_secret="valid_production_secret",
            confirmation_phrase=LiveBroker.REQUIRED_APPROVAL_PHRASE
        )
        
        # Pre-flight not passed
        with self.assertRaises(SecurityViolationError):
            live_broker.execute_spot_order("BTCUSDT", "BUY", 100.0)

        # Force preflight passed but without documented manual approval
        live_broker.preflight_passed = True
        with self.assertRaises(SecurityViolationError):
            live_broker.execute_spot_order("BTCUSDT", "BUY", 100.0)

        # Grant manual approval
        live_broker.document_manual_approval("Admin")
        self.assertIsNotNone(live_broker.manual_approval_timestamp)

        # Exceeding trade cap (e.g. 1000 > 500 limit)
        with self.assertRaises(SecurityViolationError):
            live_broker.execute_spot_order("BTCUSDT", "BUY", 1000.0)

    def test_live_mode_emergency_kill_switch(self):
        """Verify triggering emergency kill-switch immediately locks live trading."""
        live_broker = LiveBroker(
            api_key="valid_prod_key",
            api_secret="valid_prod_secret",
            confirmation_phrase=LiveBroker.REQUIRED_APPROVAL_PHRASE
        )
        live_broker.preflight_passed = True
        live_broker.document_manual_approval("Admin")

        live_broker.trigger_emergency_kill_switch("Manual circuit breaker test")
        self.assertTrue(live_broker.is_circuit_breaker_tripped)
        with self.assertRaises(SecurityViolationError):
            live_broker.execute_spot_order("BTCUSDT", "BUY", 50.0)

if __name__ == "__main__":
    unittest.main()
