"""
JevQuant Institutional Spot Strategy - Specification & Rules Engine V0.1
Defines immutable trading rules, risk limits, entry/exit criteria, and fee structures.
"""

from dataclasses import dataclass
from typing import Dict, Any, List
import json
import os

@dataclass(frozen=True)
class CapitalRiskRules:
    initial_capital_usdt: float = 10000.0
    max_capital_allocation_pct: float = 20.0
    max_open_positions: int = 1
    trading_mode: str = "SPOT_ONLY"
    allow_leverage: bool = False
    allow_shorting: bool = False
    cash_reserve_floor_pct: float = 0.0
    maker_fee_pct: float = 0.10
    taker_fee_pct: float = 0.10
    estimated_slippage_pct: float = 0.05

@dataclass(frozen=True)
class ADXFilterRules:
    period: int = 14
    min_adx_threshold: float = 20.0
    require_plus_di_greater_than_minus_di: bool = True

@dataclass(frozen=True)
class DynamicConfidenceRules:
    base_threshold: float = 0.80
    volatility_multiplier: float = 0.055
    min_clamp: float = 0.78
    max_clamp: float = 0.94

    def calculate_threshold(self, atr: float, close: float) -> float:
        if close <= 0:
            return self.base_threshold
        vol_ratio = (atr / close) * 100.0
        raw = self.base_threshold + (vol_ratio * self.volatility_multiplier)
        return max(self.min_clamp, min(self.max_clamp, round(raw, 3)))

@dataclass(frozen=True)
class EntryRules:
    action_required: str = "EXECUTE_SPOT_BUY"
    min_confluence_score: int = 3
    min_conviction_level: int = 2
    max_trap_probability: float = 0.20
    adx_filter: ADXFilterRules = ADXFilterRules()
    confidence_rules: DynamicConfidenceRules = DynamicConfidenceRules()
    base_usdt_amount: float = 1000.0
    max_single_trade_cap_usdt: float = 2000.0

    def calculate_position_size(self, current_balance: float, conviction: int, confidence: float, threshold: float) -> float:
        conviction_mults = {0: 0.0, 1: 0.6, 2: 1.0, 3: 1.5}
        c_mult = conviction_mults.get(conviction, 0.0)
        conf_mult = max(0.7, min(1.3, confidence / max(threshold, 0.01)))
        
        target_allocation = self.base_usdt_amount * c_mult * conf_mult
        # Max cap is the lesser of the absolute trade cap or 20% of current capital
        max_by_capital = current_balance * 0.20
        allowed = min(target_allocation, self.max_single_trade_cap_usdt, max_by_capital)
        return max(0.0, allowed)

@dataclass(frozen=True)
class ExitRules:
    sl_atr_mult: float = 1.5
    tp_atr_mult: float = 3.75 # 1.5 * 2.5
    early_trap_prob: float = 0.65
    adx_exhaustion_threshold: float = 16.0
    max_holding_bars: int = 48

class StrategySpecificationV01:
    VERSION = "0.1.0"
    capital_risk = CapitalRiskRules()
    adx_rules = ADXFilterRules()
    confidence_rules = DynamicConfidenceRules()
    entry_rules = EntryRules()
    exit_rules = ExitRules()

    @classmethod
    def load_from_json(cls, file_path: str = None) -> Dict[str, Any]:
        if file_path is None:
            file_path = os.path.join(os.path.dirname(__file__), "trading_rules_v0_1.json")
        with open(file_path, "r", encoding="utf-8") as f:
            return json.load(f)
