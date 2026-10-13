# Implementation Plan - JevPaperDatabase Integration & API Endpoints

This plan outlines the integration of the `JevPaperDatabase` class into `standalone_backtester.py` for real-time paper trading logging, and exposing SQLite data via new API endpoints in `server.ts`.

## Proposed Changes

### 1. `standalone_backtester.py`
- Add the `JevPaperDatabase` class definition.
- Initialize `JevPaperDatabase` at the start of paper trading / backtest execution (writing to `jev_paper.db`).
- Call `log_trade` when positions are opened/closed and `log_equity` during candle steps to achieve real-time persistence.

### 2. `server.ts`
- Add Express API endpoints:
  - `GET /api/paper-trades`: Queries `jev_paper.db` and returns recent paper trades.
  - `GET /api/paper-equity`: Queries `jev_paper.db` and returns the equity curve data for UI charts.

## Verification Plan
- Run `python3 standalone_backtester.py` to ensure real-time logging populates `jev_paper.db`.
- Test API endpoints using curl or node test.
- Run `compile_applet` and `lint_applet` to verify overall system integrity.
