# JevQuant Phase 2.6D — Implementation Plan

## Objective
Remediate UI discrepancies identified in the Phase 2.6C UI-to-Engine Parity Audit without modifying any strategy formulas, thresholds, or backend rules:
1. **Task 1**: Correct misleading `1.5% Risk` terminology to reflect Conviction Level and Allocation Multiplier rather than false account-equity risk.
2. **Task 2**: Distinguish Theoretical Position Size from Final Capital-Constrained Position Size (applying the 20% available cash cap / 100 USDT cap for 500 USDT equity).
3. **Task 3**: Correct ADX / DI blocking explanations to explicitly identify bearish directional dominance (`-DI > +DI`) when ADX = 34, +DI = 13.4, and -DI = 37, rather than attributing it to a directionless chop market.
4. **Task 4**: Add/update unit tests verifying these UI and calculation consistency constraints.

---

## Proposed Changes

### 1. `src/App.tsx` & `server.ts`
- Update UI rendering for risk labels: replace misleading risk-percentage strings with explicit **Conviction Level** (e.g. `Level 3/3`) and **Allocation Multiplier** (e.g. `1.5x`).
- Display both **Theoretical Position Size** and **Final Constrained Position Size** (reflecting the 20% available cash / absolute cap constraint).
- Fix ADX and DI blocking message mapping so that when `ADX >= 20` and `+DI < -DI`, the UI displays bearish directional dominance (`BLOCKED_BEARISH_DI`) rather than low-ADX chop.

### 2. `tests/test_backtester.py` (or new test file / test methods)
- Add unit tests verifying:
  - Conviction score is not presented as account-equity risk.
  - Position size constraints (500 USDT capital with 20% cap yields max 100 USDT).
  - ADX/DI blocking reason for ADX = 34, +DI = 13.4, -DI = 37.

---

## Verification Plan

1. **Automated Tests**: Run `python3 -m unittest discover -s tests -p "test_*.py"` to confirm all 65+ tests pass.
2. **Build Verification**: Run `compile_applet` to ensure successful TypeScript compilation.
3. **Execution Safety**: Confirm zero Binance API calls, zero order submissions, and zero backtest execution.
