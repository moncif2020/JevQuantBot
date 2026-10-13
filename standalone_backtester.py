#!/usr/bin/env python3
"""
================================================================================
JevQuant Pure Standalone Backtester Engine (V0.1 Isolated Simulator)
================================================================================
CRITICAL ARCHITECTURAL GUARANTEES:
1. Complete Isolation: Does NOT import any Binance order placement functions.
2. Zero Key Requirements: Uses only public klines or synthetic stress data.
3. Strict Lookahead Bias Prevention: Bar-by-bar progression evaluation.
4. Accurate Cost Model: Real deduction of 0.10% Binance Spot fees and 0.05% slippage.
5. Rich CSV & JSON Output: Full institutional metrics and trade history log.
================================================================================
"""

import sys
import os
import math
import json
import csv
import time
import sqlite3
import urllib.request
import urllib.error
from typing import List, Dict, Any, Tuple, Optional
from datetime import datetime, timezone, timedelta

# Import V0.1 Static Rules Specification
sys.path.insert(0, os.path.dirname(__file__))
from specs.rules_spec import StrategySpecificationV01, EntryRules, ExitRules, CapitalRiskRules

class Candle:
    __slots__ = ('timestamp', 'open', 'high', 'low', 'close', 'volume')
    def __init__(self, timestamp: int, open_: float, high: float, low: float, close: float, volume: float):
        self.timestamp = timestamp
        self.open = float(open_)
        self.high = float(high)
        self.low = float(low)
        self.close = float(close)
        self.volume = float(volume)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "timestamp": self.timestamp,
            "open": self.open,
            "high": self.high,
            "low": self.low,
            "close": self.close,
            "volume": self.volume
        }

class IndicatorEngine:
    """
    Pure mathematical technical indicators computed strictly up to bar index 't'.
    Guarantees ZERO lookahead leakage.
    """
    @staticmethod
    def calculate_ema(prices: List[float], period: int) -> float:
        if len(prices) < period or period <= 0:
            return prices[-1] if prices else 0.0
        multiplier = 2.0 / (period + 1.0)
        # Seed with SMA of the first 'period' elements
        ema = sum(prices[:period]) / period
        for price in prices[period:]:
            ema = (price - ema) * multiplier + ema
        return ema

    @staticmethod
    def calculate_atr(candles: List[Candle], period: int = 14) -> float:
        if len(candles) < 2:
            return candles[-1].high - candles[-1].low if candles else 0.0
        
        tr_list = []
        for i in range(1, len(candles)):
            c = candles[i]
            prev_c = candles[i - 1]
            tr = max(
                c.high - c.low,
                abs(c.high - prev_c.close),
                abs(c.low - prev_c.close)
            )
            tr_list.append(tr)
        
        if len(tr_list) < period:
            return sum(tr_list) / len(tr_list) if tr_list else 0.0
        
        # Wilder's Smoothing for ATR
        atr = sum(tr_list[:period]) / period
        for tr in tr_list[period:]:
            atr = (atr * (period - 1) + tr) / period
        return atr

    @staticmethod
    def calculate_adx(candles: List[Candle], period: int = 14) -> Tuple[float, float, float]:
        """
        Calculates ADX, +DI, -DI up to the current candle with Wilder's smoothing.
        Returns: (adx, plus_di, minus_di)
        """
        if len(candles) < period * 2:
            return 25.0, 20.0, 15.0 # Neutral baseline if insufficient history

        plus_dm_list = []
        minus_dm_list = []
        tr_list = []

        for i in range(1, len(candles)):
            curr = candles[i]
            prev = candles[i - 1]

            up_move = curr.high - prev.high
            down_move = prev.low - curr.low

            if up_move > down_move and up_move > 0:
                plus_dm_list.append(up_move)
            else:
                plus_dm_list.append(0.0)

            if down_move > up_move and down_move > 0:
                minus_dm_list.append(down_move)
            else:
                minus_dm_list.append(0.0)

            tr = max(
                curr.high - curr.low,
                abs(curr.high - prev.close),
                abs(curr.low - prev.close)
            )
            tr_list.append(tr)

        # Initial smoothed sum
        smooth_tr = sum(tr_list[:period])
        smooth_plus_dm = sum(plus_dm_list[:period])
        smooth_minus_dm = sum(minus_dm_list[:period])

        dx_list = []
        for i in range(period, len(tr_list)):
            smooth_tr = smooth_tr - (smooth_tr / period) + tr_list[i]
            smooth_plus_dm = smooth_plus_dm - (smooth_plus_dm / period) + plus_dm_list[i]
            smooth_minus_dm = smooth_minus_dm - (smooth_minus_dm / period) + minus_dm_list[i]

            if smooth_tr == 0:
                plus_di = 0.0
                minus_di = 0.0
            else:
                plus_di = (smooth_plus_dm / smooth_tr) * 100.0
                minus_di = (smooth_minus_dm / smooth_tr) * 100.0

            di_sum = plus_di + minus_di
            dx = (abs(plus_di - minus_di) / di_sum * 100.0) if di_sum > 0 else 0.0
            dx_list.append((dx, plus_di, minus_di))

        if not dx_list:
            return 25.0, 20.0, 15.0

        if len(dx_list) < period:
            adx = sum(x[0] for x in dx_list) / len(dx_list)
            return round(adx, 2), round(dx_list[-1][1], 2), round(dx_list[-1][2], 2)

        adx = sum(x[0] for x in dx_list[:period]) / period
        for dx, p_di, m_di in dx_list[period:]:
            adx = (adx * (period - 1) + dx) / period

        return round(adx, 2), round(dx_list[-1][1], 2), round(dx_list[-1][2], 2)


class MarketDataFetcher:
    """
    Provides data to the backtester without any authentication credentials:
    1. Public Binance REST API for real spot candles
    2. Realistic Synthetic Stress-Testing data generator
    """
    @staticmethod
    def fetch_binance_public_klines(symbol: str = "BTCUSDT", interval: str = "15m", limit: int = 500) -> List[Candle]:
        url = f"https://api.binance.com/api/v3/klines?symbol={symbol}&interval={interval}&limit={limit}"
        req = urllib.request.Request(
            url,
            headers={"User-Agent": "JevQuant-Backtest/1.0 (Public Research Client)"}
        )
        try:
            with urllib.request.urlopen(req, timeout=8) as response:
                if response.status == 200:
                    data = json.loads(response.read().decode('utf-8'))
                    candles = []
                    for item in data:
                        # [0: open_time, 1: open, 2: high, 3: low, 4: close, 5: volume, ...]
                        candles.append(Candle(
                            timestamp=int(item[0]),
                            open_=float(item[1]),
                            high=float(item[2]),
                            low=float(item[3]),
                            close=float(item[4]),
                            volume=float(item[5])
                        ))
                    print(f"✅ Successfully fetched {len(candles)} public candles for {symbol} ({interval}) from Binance Public API.")
                    return candles
        except Exception as e:
            print(f"⚠️ Notice: Unable to reach Binance Public API ({e}). Falling back to deterministic Stress-Test dataset.")
        return MarketDataFetcher.generate_stress_test_dataset(symbol=symbol, count=limit)

    @staticmethod
    def generate_stress_test_dataset(symbol: str = "BTCUSDT", count: int = 500) -> List[Candle]:
        """
        Synthesizes a realistic institutional stress-testing market cycle:
        - Phase 1 (Bars 0-120): Accumulation & Ranging Chop (ADX < 20) -> should NOT trigger entries.
        - Phase 2 (Bars 121-250): Institutional Markup Bull Trend (High ADX > 28, +DI > -DI) -> Valid Buy Entries with TP.
        - Phase 3 (Bars 251-340): Liquidity Trap & False Breakout (Spike + violent reversal) -> Tests Stop-Loss & Trap Filter.
        - Phase 4 (Bars 341-430): High Volatility Recovery with high ATR -> Tests Dynamic Confidence Scaling.
        - Phase 5 (Bars 431-500): Second Trend Extension with multiple target hits.
        """
        base_price = 60000.0 if "BTC" in symbol else (3200.0 if "ETH" in symbol else 140.0)
        start_ts = int((datetime.now(timezone.utc) - timedelta(minutes=15 * count)).timestamp() * 1000)
        current_price = base_price
        candles: List[Candle] = []

        for i in range(count):
            ts = start_ts + (i * 15 * 60 * 1000)
            
            # Regime determination
            if i < 120:
                # Chop / range
                drift = math.sin(i / 5.0) * 0.001
                vol = 0.002
            elif i < 250:
                # Strong Bull Markup
                drift = 0.0012 + math.sin(i / 10.0) * 0.0004
                vol = 0.004
            elif i < 340:
                # Liquidity Trap & Bear Whipsaw
                if i < 280:
                    drift = 0.0025 # parabolic push into resistance
                    vol = 0.006
                else:
                    drift = -0.0035 # sudden sharp dump
                    vol = 0.009
            elif i < 430:
                # High Volatility Consolidation
                drift = math.cos(i / 8.0) * 0.002
                vol = 0.008
            else:
                # Steady upward continuation
                drift = 0.0008
                vol = 0.0035

            open_p = current_price
            delta = open_p * (drift + (math.sin(i * 1.7) * vol))
            close_p = max(1.0, open_p + delta)
            
            high_wiggle = abs(delta) * (1.2 + abs(math.cos(i)))
            low_wiggle = abs(delta) * (1.2 + abs(math.sin(i)))
            high_p = max(open_p, close_p) + high_wiggle
            low_p = min(open_p, close_p) - low_wiggle
            vol_amount = round(100.0 + abs(math.sin(i)) * 500.0, 2)

            candles.append(Candle(
                timestamp=ts,
                open_=round(open_p, 2),
                high=round(high_p, 2),
                low=round(low_p, 2),
                close=round(close_p, 2),
                volume=vol_amount
            ))
            current_price = close_p

        return candles


class StandaloneBacktester:
    """
    Isolated Backtesting Engine adhering to Rules Specification V0.1.
    """
    def __init__(self, initial_capital: float = 10000.0, symbol: str = "BTCUSDT"):
        self.rules = StrategySpecificationV01()
        self.symbol = symbol
        self.initial_capital = initial_capital
        self.cash_balance = initial_capital
        self.holding_qty = 0.0
        self.open_position: Optional[Dict[str, Any]] = None
        self.closed_trades: List[Dict[str, Any]] = []
        self.equity_curve: List[Dict[str, Any]] = []

    def evaluate_bar(self, history: List[Candle], current_bar_idx: int) -> Optional[Dict[str, Any]]:
        """
        Pure deterministic decision at bar 'current_bar_idx' using ONLY history[0 : current_bar_idx + 1].
        """
        sub_candles = history[: current_bar_idx + 1]
        if len(sub_candles) < 40:
            return None # Insufficient history for accurate EMAs and ADX

        current_candle = sub_candles[-1]
        close_prices = [c.close for c in sub_candles]
        close_px = current_candle.close

        # Indicators
        ema9 = IndicatorEngine.calculate_ema(close_prices, 9)
        ema21 = IndicatorEngine.calculate_ema(close_prices, 21)
        ema50 = IndicatorEngine.calculate_ema(close_prices, 50)
        atr14 = IndicatorEngine.calculate_atr(sub_candles, 14)
        adx, plus_di, minus_di = IndicatorEngine.calculate_adx(sub_candles, 14)

        # Dynamic Confidence Threshold
        vol_ratio = (atr14 / close_px) * 100.0 if close_px > 0 else 1.5
        dyn_threshold = self.rules.confidence_rules.calculate_threshold(atr14, close_px)

        # Multi-timeframe trend confluence proxy:
        bullish_alignment = (close_px > ema9 > ema21 > ema50)
        confluence_score = 4 if bullish_alignment else (3 if (close_px > ema21 > ema50) else (2 if close_px > ema50 else 1))

        # ADX trend strength filter
        trend_strong = (adx >= self.rules.adx_rules.min_adx_threshold)
        directional_ok = (plus_di > minus_di) if self.rules.adx_rules.require_plus_di_greater_than_minus_di else True
        adx_passed = trend_strong and directional_ok

        # Trap Probability proxy (upper wick exhaustion relative to ATR)
        upper_wick = current_candle.high - max(current_candle.open, current_candle.close)
        trap_prob = min(0.95, max(0.05, (upper_wick / max(atr14, 0.01)) * 0.45))

        # Conviction score
        if confluence_score >= 4 and adx >= 28 and trap_prob < 0.15:
            conviction = 3
        elif confluence_score >= 3 and adx >= 22 and trap_prob < 0.20:
            conviction = 2
        elif confluence_score >= 2:
            conviction = 1
        else:
            conviction = 0

        # Confidence calibrated
        confidence = round(min(0.97, 0.75 + (confluence_score * 0.04) + (0.05 if adx_passed else -0.10) - (trap_prob * 0.15)), 3)

        # Decision
        can_buy = (
            confluence_score >= self.rules.entry_rules.min_confluence_score and
            conviction >= self.rules.entry_rules.min_conviction_level and
            trap_prob < self.rules.entry_rules.max_trap_probability and
            adx_passed and
            confidence >= dyn_threshold
        )

        return {
            "can_buy": can_buy,
            "confluence": confluence_score,
            "conviction": conviction,
            "confidence": confidence,
            "dyn_threshold": dyn_threshold,
            "trap_prob": trap_prob,
            "adx": adx,
            "plus_di": plus_di,
            "minus_di": minus_di,
            "atr": atr14,
            "close": close_px
        }

    def run(self, candles: List[Candle]) -> Dict[str, Any]:
        """
        Executes strict bar-by-bar progression across candles.
        """
        self.cash_balance = self.initial_capital
        self.holding_qty = 0.0
        self.open_position = None
        self.closed_trades = []
        self.equity_curve = []

        fee_rate = self.rules.capital_risk.taker_fee_pct / 100.0 # 0.001 (0.1%)
        slippage_rate = self.rules.capital_risk.estimated_slippage_pct / 100.0 # 0.0005 (0.05%)

        trade_counter = 0

        for i in range(len(candles)):
            curr_bar = candles[i]
            eval_state = self.evaluate_bar(candles, i)
            
            # 1. Manage Active Position (Check for Exits)
            if self.open_position is not None:
                pos = self.open_position
                pos["bars_held"] += 1
                exit_price = None
                exit_reason = None

                # Check Stop Loss (Intra-bar low breached SL)
                if curr_bar.low <= pos["stop_loss"]:
                    # Filled at SL with slippage
                    exit_price = pos["stop_loss"] * (1.0 - slippage_rate)
                    exit_reason = "STOP_LOSS"
                # Check Take Profit (Intra-bar high reached TP)
                elif curr_bar.high >= pos["take_profit"]:
                    exit_price = pos["take_profit"] * (1.0 - slippage_rate)
                    exit_reason = "TAKE_PROFIT"
                # Check Emergency / Dynamic Exit Conditions
                elif eval_state is not None:
                    if eval_state["trap_prob"] >= self.rules.exit_rules.early_trap_prob:
                        exit_price = curr_bar.close * (1.0 - slippage_rate)
                        exit_reason = "TRAP_DETECTED"
                    elif eval_state["adx"] < self.rules.exit_rules.adx_exhaustion_threshold:
                        exit_price = curr_bar.close * (1.0 - slippage_rate)
                        exit_reason = "ADX_EXHAUSTION"
                    elif pos["bars_held"] >= self.rules.exit_rules.max_holding_bars:
                        exit_price = curr_bar.close * (1.0 - slippage_rate)
                        exit_reason = "MAX_BARS_TIMEOUT"

                # Execute Exit if triggered
                if exit_price is not None:
                    gross_proceeds = pos["quantity"] * exit_price
                    exit_fee = gross_proceeds * fee_rate
                    net_proceeds = gross_proceeds - exit_fee
                    
                    self.cash_balance += net_proceeds
                    self.holding_qty = 0.0

                    gross_pnl = gross_proceeds - (pos["quantity"] * pos["entry_price_raw"])
                    total_fees = pos["entry_fee"] + exit_fee
                    total_slippage = pos["slippage_cost"] + (pos["quantity"] * exit_price * slippage_rate)
                    net_pnl = net_proceeds - pos["total_cost_basis"]
                    net_pnl_pct = (net_pnl / pos["total_cost_basis"]) * 100.0

                    closed_record = {
                        "trade_id": pos["trade_id"],
                        "symbol": self.symbol,
                        "side": "SPOT_BUY",
                        "entry_time": datetime.fromtimestamp(pos["entry_timestamp"] / 1000, tz=timezone.utc).strftime('%Y-%m-%d %H:%M:%S'),
                        "exit_time": datetime.fromtimestamp(curr_bar.timestamp / 1000, tz=timezone.utc).strftime('%Y-%m-%d %H:%M:%S'),
                        "bars_held": pos["bars_held"],
                        "entry_price": round(pos["entry_price_effective"], 2),
                        "exit_price": round(exit_price, 2),
                        "quantity": round(pos["quantity"], 6),
                        "trade_value_usdt": round(pos["total_cost_basis"], 2),
                        "entry_fee_usdt": round(pos["entry_fee"], 4),
                        "exit_fee_usdt": round(exit_fee, 4),
                        "slippage_cost_usdt": round(total_slippage, 4),
                        "gross_pnl_usdt": round(gross_pnl, 2),
                        "net_pnl_usdt": round(net_pnl, 2),
                        "net_return_pct": round(net_pnl_pct, 2),
                        "exit_reason": exit_reason,
                        "stop_loss": round(pos["stop_loss"], 2),
                        "take_profit": round(pos["take_profit"], 2),
                        "conviction": pos["conviction"],
                        "calibrated_confidence": pos["confidence"],
                        "dynamic_threshold": pos["dyn_threshold"]
                    }
                    self.closed_trades.append(closed_record)
                    self.open_position = None

            # 2. Check for New Spot Entry
            elif eval_state is not None and eval_state["can_buy"]:
                allocation_usdt = self.rules.entry_rules.calculate_position_size(
                    current_balance=self.cash_balance,
                    conviction=eval_state["conviction"],
                    confidence=eval_state["confidence"],
                    threshold=eval_state["dyn_threshold"]
                )

                if allocation_usdt >= 50.0 and allocation_usdt <= self.cash_balance:
                    trade_counter += 1
                    raw_entry_price = curr_bar.close
                    # Slippage increases effective buy price
                    effective_entry_price = raw_entry_price * (1.0 + slippage_rate)
                    
                    # Binance Spot Taker Fee
                    entry_fee = allocation_usdt * fee_rate
                    capital_invested = allocation_usdt - entry_fee
                    quantity = capital_invested / effective_entry_price

                    self.cash_balance -= allocation_usdt
                    self.holding_qty = quantity

                    # Stop Loss and Take Profit calculated using ATR
                    sl_dist = eval_state["atr"] * self.rules.exit_rules.sl_atr_mult
                    tp_dist = eval_state["atr"] * self.rules.exit_rules.tp_atr_mult
                    stop_loss = max(1.0, raw_entry_price - sl_dist)
                    take_profit = raw_entry_price + tp_dist

                    self.open_position = {
                        "trade_id": f"BT-V01-{trade_counter:03d}",
                        "entry_timestamp": curr_bar.timestamp,
                        "entry_price_raw": raw_entry_price,
                        "entry_price_effective": effective_entry_price,
                        "quantity": quantity,
                        "total_cost_basis": allocation_usdt,
                        "entry_fee": entry_fee,
                        "slippage_cost": allocation_usdt * slippage_rate,
                        "stop_loss": stop_loss,
                        "take_profit": take_profit,
                        "bars_held": 0,
                        "conviction": eval_state["conviction"],
                        "confidence": eval_state["confidence"],
                        "dyn_threshold": eval_state["dyn_threshold"]
                    }

            # 3. Record Equity Curve Point
            curr_pos_val = (self.holding_qty * curr_bar.close) if self.holding_qty > 0 else 0.0
            total_equity = self.cash_balance + curr_pos_val
            self.equity_curve.append({
                "timestamp": curr_bar.timestamp,
                "datetime": datetime.fromtimestamp(curr_bar.timestamp / 1000, tz=timezone.utc).strftime('%Y-%m-%d %H:%M:%S'),
                "cash": round(self.cash_balance, 2),
                "position_value": round(curr_pos_val, 2),
                "total_equity": round(total_equity, 2)
            })

        # Compile Institutional Performance Metrics
        return self._generate_performance_metrics()

    def _generate_performance_metrics(self) -> Dict[str, Any]:
        final_equity = self.equity_curve[-1]["total_equity"] if self.equity_curve else self.initial_capital
        total_net_pnl = final_equity - self.initial_capital
        net_return_pct = (total_net_pnl / self.initial_capital) * 100.0

        total_trades = len(self.closed_trades)
        winning_trades = [t for t in self.closed_trades if t["net_pnl_usdt"] > 0]
        losing_trades = [t for t in self.closed_trades if t["net_pnl_usdt"] <= 0]
        
        win_count = len(winning_trades)
        loss_count = len(losing_trades)
        win_rate = (win_count / total_trades * 100.0) if total_trades > 0 else 0.0

        gross_profit = sum(t["net_pnl_usdt"] for t in winning_trades)
        gross_loss = abs(sum(t["net_pnl_usdt"] for t in losing_trades))
        profit_factor = (gross_profit / gross_loss) if gross_loss > 0 else (99.0 if gross_profit > 0 else 1.0)

        # Max Drawdown Calculation
        peak = self.initial_capital
        max_dd_amount = 0.0
        max_dd_pct = 0.0

        for pt in self.equity_curve:
            eq = pt["total_equity"]
            if eq > peak:
                peak = eq
            dd = peak - eq
            dd_pct = (dd / peak) * 100.0 if peak > 0 else 0.0
            if dd > max_dd_amount:
                max_dd_amount = dd
            if dd_pct > max_dd_pct:
                max_dd_pct = dd_pct

        avg_win = (gross_profit / win_count) if win_count > 0 else 0.0
        avg_loss = (gross_loss / loss_count) if loss_count > 0 else 0.0
        payoff_ratio = (avg_win / avg_loss) if avg_loss > 0 else (avg_win if avg_win > 0 else 0.0)

        total_fees = sum(t["entry_fee_usdt"] + t["exit_fee_usdt"] for t in self.closed_trades)
        total_slippage = sum(t["slippage_cost_usdt"] for t in self.closed_trades)

        return {
            "strategy_version": "0.1.0",
            "symbol": self.symbol,
            "initial_capital_usdt": round(self.initial_capital, 2),
            "final_equity_usdt": round(final_equity, 2),
            "net_cumulative_pnl_usdt": round(total_net_pnl, 2),
            "net_cumulative_return_pct": round(net_return_pct, 2),
            "profit_factor": round(profit_factor, 2),
            "max_drawdown_pct": round(max_dd_pct, 2),
            "max_drawdown_usdt": round(max_dd_amount, 2),
            "total_trades": total_trades,
            "win_rate_pct": round(win_rate, 2),
            "winning_trades_count": win_count,
            "losing_trades_count": loss_count,
            "average_win_usdt": round(avg_win, 2),
            "average_loss_usdt": round(avg_loss, 2),
            "payoff_ratio": round(payoff_ratio, 2),
            "total_fees_paid_usdt": round(total_fees, 2),
            "total_slippage_cost_usdt": round(total_slippage, 2)
        }

    def export_csv(self, file_path: str = "backtest_trades_v0_1.csv") -> str:
        """
        Exports granular trade logs into standard CSV format.
        """
        if not self.closed_trades:
            return ""
        
        fieldnames = list(self.closed_trades[0].keys())
        with open(file_path, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()
            for row in self.closed_trades:
                writer.writerow(row)
        return file_path

    def export_performance_json(self, file_path: str = "backtest_performance_v0_1.json") -> str:
        metrics = self._generate_performance_metrics()
        with open(file_path, "w", encoding="utf-8") as f:
            json.dump(metrics, f, indent=2, ensure_ascii=False)
        return file_path

    def export_sqlite(self, db_path: str = "jev_paper.db") -> str:
        """
        Saves paper trading virtual wallet state, full trade history, and equity curve into SQLite database.
        """
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS paper_wallets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                initial_capital REAL,
                current_cash REAL,
                symbol TEXT,
                updated_at TEXT
            )
        """)

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS trades (
                trade_id TEXT PRIMARY KEY,
                symbol TEXT,
                side TEXT,
                entry_time TEXT,
                exit_time TEXT,
                entry_price REAL,
                exit_price REAL,
                quantity REAL,
                net_pnl_usdt REAL,
                exit_reason TEXT,
                conviction INTEGER,
                confidence REAL
            )
        """)

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS equity_curve (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp INTEGER,
                datetime TEXT,
                cash REAL,
                position_value REAL,
                total_equity REAL
            )
        """)

        now_str = datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S')
        cursor.execute("""
            INSERT INTO paper_wallets (initial_capital, current_cash, symbol, updated_at)
            VALUES (?, ?, ?, ?)
        """, (self.initial_capital, self.cash_balance, self.symbol, now_str))

        for t in self.closed_trades:
            cursor.execute("""
                INSERT OR REPLACE INTO trades (
                    trade_id, symbol, side, entry_time, exit_time, entry_price, exit_price,
                    quantity, net_pnl_usdt, exit_reason, conviction, confidence
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                t.get("trade_id"),
                t.get("symbol"),
                t.get("side"),
                t.get("entry_time"),
                t.get("exit_time"),
                t.get("entry_price"),
                t.get("exit_price"),
                t.get("quantity"),
                t.get("net_pnl_usdt"),
                t.get("exit_reason"),
                t.get("conviction"),
                t.get("calibrated_confidence")
            ))

        for eq in self.equity_curve:
            cursor.execute("""
                INSERT INTO equity_curve (timestamp, datetime, cash, position_value, total_equity)
                VALUES (?, ?, ?, ?, ?)
            """, (
                eq.get("timestamp"),
                eq.get("datetime"),
                eq.get("cash"),
                eq.get("position_value"),
                eq.get("total_equity")
            ))

        conn.commit()
        conn.close()
        return db_path


def main():
    import argparse
    parser = argparse.ArgumentParser(description="JevQuant Standalone Backtester V0.1")
    parser.add_argument("--mode", choices=["stress", "binance"], default="stress", help="Data source: synthetic stress-test or public Binance klines")
    parser.add_argument("--symbol", default="BTCUSDT", help="Crypto trading pair")
    parser.add_argument("--capital", type=float, default=500.0, help="Starting capital in USDT (Default: 500 USDT Paper Wallet)")
    parser.add_argument("--count", type=int, default=500, help="Number of 15m candles")
    args = parser.parse_args()

    print("=" * 70)
    print("🚀 JEVQUANT STANDALONE ISOLATED BACKTESTER & PAPER TRADING V0.1")
    print("=" * 70)
    print(f"• Mode:               {args.mode.upper()}")
    print(f"• Symbol:             {args.symbol}")
    print(f"• Starting Capital:   ${args.capital:,.2f} USDT (Virtual Paper Wallet)")
    print(f"• Candles Count:      {args.count}")
    print(f"• Rules Specification: specs/trading_rules_v0_1.json")
    print("=" * 70)

    # 1. Fetch or generate candles
    if args.mode == "binance":
        candles = MarketDataFetcher.fetch_binance_public_klines(symbol=args.symbol, interval="15m", limit=args.count)
    else:
        print("⚡ Generating Multi-Regime Institutional Stress Testing Dataset...")
        candles = MarketDataFetcher.generate_stress_test_dataset(symbol=args.symbol, count=args.count)

    # 2. Run simulation
    engine = StandaloneBacktester(initial_capital=args.capital, symbol=args.symbol)
    metrics = engine.run(candles)

    # 3. Export artifacts (CSV, JSON, and SQLite jev_paper.db)
    csv_path = engine.export_csv("backtest_trades_v0_1.csv")
    json_path = engine.export_performance_json("backtest_performance_v0_1.json")
    db_path = engine.export_sqlite("jev_paper.db")

    # 4. Display institutional summary
    print("\n" + "=" * 70)
    print("📊 PAPER TRADING & BACKTEST PERFORMANCE REPORT (INSTITUTIONAL METRICS)")
    print("=" * 70)
    print(f"• Initial Capital:        ${metrics['initial_capital_usdt']:,.2f} USDT")
    print(f"• Final Equity:           ${metrics['final_equity_usdt']:,.2f} USDT")
    print(f"• Net Cumulative PnL:     ${metrics['net_cumulative_pnl_usdt']:+,.2f} USDT ({metrics['net_cumulative_return_pct']:+.2f}%)")
    print(f"• Profit Factor:          {metrics['profit_factor']}")
    print(f"• Max Drawdown:           {metrics['max_drawdown_pct']}% (${metrics['max_drawdown_usdt']:,.2f})")
    print(f"• Total Executed Trades:  {metrics['total_trades']}")
    print(f"• Win Rate:               {metrics['win_rate_pct']}% ({metrics['winning_trades_count']} Won / {metrics['losing_trades_count']} Lost)")
    print(f"• Payoff Ratio (Win/Loss):{metrics['payoff_ratio']}")
    print(f"• Total Fees & Slippage:  ${metrics['total_fees_paid_usdt'] + metrics['total_slippage_cost_usdt']:,.2f} USDT")
    print("=" * 70)
    print(f"💾 Trade CSV Log written to:       {csv_path}")
    print(f"💾 Performance JSON written to:   {json_path}")
    print(f"💾 Paper Trading SQLite DB:       {db_path}")
    print("=" * 70 + "\n")


if __name__ == "__main__":
    main()
