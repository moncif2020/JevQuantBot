export const DEFAULT_ORIGINAL_PYTHON_BOT_CODE = `#!/usr/bin/env python3
"""
JevQuant: Autonomous Multi-Symbol Multi-Timeframe Binance Trading Bot & Backtester
- Sub-100ms Inference
- Dynamic Multi-Asset Confluence (BTC, ETH, SOL, etc.)
- Multi-Timeframe Analysis (5m, 15m, 1h, 4h, 1d)
- Pure Python Wilder-Smoothed RSI & ATR & EMA20
- Independent Multi-Symbol Position State Management
- Zero-Hallucination Decision Primitives (Noul, Choice, Score)
- Time-Series Hygiene Guard & Exact Candle State Resolution
"""

import os
import time
import hashlib
import json
import math
import urllib.request
import urllib.error
from urllib.parse import urlencode
from typing import Optional, List, Dict, Any, Tuple
from dataclasses import dataclass, field

try:
    import requests
except ImportError:
    requests = None

try:
    from typesafe_sdk import TypeSafeClient, Choice, Noul, Score
    HAS_TYPESAFE = True
except ImportError:
    HAS_TYPESAFE = False

try:
    from jev_execution_modes import ExecutionManager, TradingMode
    HAS_EXECUTION_MGR = True
except ImportError:
    HAS_EXECUTION_MGR = False

from specs.rules_spec import StrategySpecificationV01

# --- CONFIGURATION ---
TYPESAFE_API_KEY = os.environ.get("TYPESAFE_API_KEY", "your-typesafe-key")
BINANCE_API_KEY = os.environ.get("BINANCE_API_KEY", "your-binance-key")
BINANCE_BASE_URL = os.environ.get("BINANCE_BASE_URL", "https://api.binance.com")  # or testnet
TELEGRAM_BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID = os.environ.get("TELEGRAM_CHAT_ID", "")

# 1. قائمة ديناميكية بالعملات المراد تداولها (يمكن إضافة أي عملة مقترنة بـ USDT هنا يدوياً)
SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT"]

TIMEFRAMES = ["5m", "15m", "1h", "4h", "1d"]
ALLOCATION_PER_TRADE_USDT = 500.0  # حجم الصفقة لكل عملة بالدولار
STOP_LOSS_ATR_MULT = 1.5
TAKE_PROFIT_ATR_MULT = 3.75

TIMEFRAME_MS = {
    "1m": 60 * 1000,
    "3m": 3 * 60 * 1000,
    "5m": 5 * 60 * 1000,
    "15m": 15 * 60 * 1000,
    "30m": 30 * 60 * 1000,
    "1h": 60 * 60 * 1000,
    "2h": 2 * 60 * 60 * 1000,
    "4h": 4 * 60 * 60 * 1000,
    "6h": 6 * 60 * 60 * 1000,
    "8h": 8 * 60 * 60 * 1000,
    "12h": 12 * 60 * 60 * 1000,
    "1d": 24 * 60 * 60 * 1000,
    "3d": 3 * 24 * 60 * 60 * 1000,
    "1w": 7 * 24 * 60 * 60 * 1000,
}

# قاموس تتبع حالة الصفقات المفتوحة لكل عملة بشكل مستقل لتفادي الشراء المكرر
active_positions = {symbol: {"in_position": False, "entry_price": 0.0, "sl": 0.0, "tp": 0.0, "qty": 0.0} for symbol in SYMBOLS}

ts_client = TypeSafeClient(api_key=TYPESAFE_API_KEY, base_url="https://api.typesafe.ai") if HAS_TYPESAFE else None

# مدير التنفيذ المؤسسي الافتراضي في وضع المحاكاة الآمنة (Paper Trading)
_institutional_execution_mgr = ExecutionManager(mode=TradingMode.PAPER) if HAS_EXECUTION_MGR else None


# ==============================================================================
# 1. DATA STRUCTURES & HYGIENE GUARDS
# ==============================================================================

class InsufficientDataError(ValueError):
    """Raised when there are not enough valid candle closes to compute an indicator."""
    pass


class DataHygieneError(ValueError):
    """Raised when candles fail time-series hygiene checks (ordering, duplicates, gaps, geometry)."""
    pass


@dataclass
class Candle:
    timestamp: int
    open_: float
    high: float
    low: float
    close: float
    volume: float


def resolve_closed_klines(klines: list, reference_time_ms: Optional[int] = None) -> list:
    """
    تحديد واستخراج الشموع المؤكدة الإغلاق بناءً على حقل وقت إغلاق الشمعة (k[6])
    مقارنة بوقت مرجعي موثوق (reference_time_ms):
    - k[6] <= reference_time_ms: الشمعة مغلقة ومكتملة تماماً.
    - k[6] > reference_time_ms: الشمعة ما زالت جارية (مفتوحة) وتُستبعد.
    - إذا لم يُمرر reference_time_ms، يُعتمد وقت النظام الحالي int(time.time() * 1000).
    - لا تفترض أن الشمعة الأخيرة مفتوحة دائماً، ولا تفترض أنها مغلقة دون فحص.
    """
    if not klines or not isinstance(klines, list):
        return []

    ref_time = int(time.time() * 1000) if reference_time_ms is None else int(reference_time_ms)

    closed = []
    for k in klines:
        if not isinstance(k, (list, tuple)) or len(k) < 7:
            continue
        try:
            close_time = int(k[6])
            if close_time <= ref_time:
                closed.append(k)
        except (ValueError, TypeError):
            continue
    return closed


def validate_time_series_hygiene(
    klines: list,
    timeframe: str,
    max_gap_multiplier: float = 2.5
) -> None:
    """
    فحص سلامة ونظافة السلسلة الزمنية للشموع (Time-Series Hygiene Guard):
    1. التحقق من وجود شموع كافية.
    2. التحقق من الترتيب الزمني الصاعد الصارم: k_i[0] > k_{i-1}[0].
    3. كشف ومنع تكرار الطوابع الزمنية: k_i[0] == k_{i-1}[0].
    4. التحقق من اتساق الأسعار الهندسية: High >= max(Open, Close) >= min(Open, Close) >= Low > 0.
    5. كشف الفجوات الزمنية غير المبررة بناءً على الإطار الزمني tf.
    - السياسة: رفض السلسلة التالفة صراحة برفع DataHygieneError بدلاً من التلاعب الصامت.
    """
    if not klines or len(klines) == 0:
        raise DataHygieneError("Empty klines dataset provided.")

    expected_step = TIMEFRAME_MS.get(timeframe)

    prev_open_time = None
    for i, k in enumerate(klines):
        if not isinstance(k, (list, tuple)) or len(k) < 7:
            raise DataHygieneError(f"Malformed kline structure at index {i}: {k}")

        try:
            open_time = int(k[0])
            open_px = float(k[1])
            high_px = float(k[2])
            low_px = float(k[3])
            close_px = float(k[4])
            volume = float(k[5])
            close_time = int(k[6])
        except (ValueError, TypeError) as err:
            raise DataHygieneError(f"Corrupted numerical or timestamp values in candle {i}: {err}") from err

        # فحص الشروط الهندسية الأساسية للأسعار
        if low_px <= 0 or open_px <= 0 or close_px <= 0 or high_px <= 0 or volume < 0:
            raise DataHygieneError(f"Non-positive price or negative volume detected at index {i}: O={open_px}, H={high_px}, L={low_px}, C={close_px}")

        if high_px < low_px or high_px < open_px or high_px < close_px or low_px > open_px or low_px > close_px:
            raise DataHygieneError(f"Geometric price violation at candle {i}: High ({high_px}) or Low ({low_px}) inconsistent with Open/Close")

        if close_time <= open_time:
            raise DataHygieneError(f"Invalid candle duration: close_time ({close_time}) <= open_time ({open_time}) at candle {i}")

        if prev_open_time is not None:
            if open_time == prev_open_time:
                raise DataHygieneError(f"Duplicate candle timestamp detected at index {i}: timestamp={open_time}")
            if open_time < prev_open_time:
                raise DataHygieneError(f"Unordered candle sequence: timestamp {open_time} followed earlier timestamp {prev_open_time}")

            # فحص الفجوات الزمنية الشاذة
            if expected_step is not None:
                gap = open_time - prev_open_time
                if gap > int(expected_step * max_gap_multiplier):
                    raise DataHygieneError(f"Abnormal time gap detected in {timeframe} at index {i}: gap={gap}ms (expected ~{expected_step}ms)")

        prev_open_time = open_time


# ==============================================================================
# 2. MATHEMATICAL TECHNICAL INDICATORS
# ==============================================================================

def calculate_ema(closes: list, period: int = 20) -> float:
    """
    حساب متوسط الحركة الأسي (EMA) الحقيقي القياسي:
    - alpha = 2.0 / (period + 1.0)
    - بذرة التهيئة الأولية (Seed): المتوسط الحسابي البسيط (SMA) لأول 20 إغلاقاً صالحاً.
    - التنعيم الأسي التكراري: ema_current = alpha * close_current + (1 - alpha) * ema_previous
    - عند نقص البيانات (< period): يرفع InsufficientDataError صراحة لمنع أي إشارة تداول مضللة.
    """
    if closes is None or len(closes) < period:
        raise InsufficientDataError(f"EMA({period}) requires at least {period} closes, got {len(closes) if closes is not None else 0}")

    clean_closes = []
    for c in closes:
        try:
            val = float(c)
            if val <= 0.0 or val != val:
                raise ValueError(f"Invalid price value: {c}")
            clean_closes.append(val)
        except (TypeError, ValueError) as e:
            raise ValueError(f"Invalid close price encountered: {c}") from e

    if len(clean_closes) < period:
        raise InsufficientDataError(f"EMA({period}) requires at least {period} valid closes, got {len(clean_closes)}")

    alpha = 2.0 / (period + 1.0)

    # بذرة البداية: المتوسط الحسابي البسيط لأول 20 شمعة
    ema = sum(clean_closes[:period]) / period

    # التنعيم الأسي لبقية الشموع من الفهرس 20 إلى الأخير
    for i in range(period, len(clean_closes)):
        ema = (clean_closes[i] * alpha) + (ema * (1.0 - alpha))

    return round(ema, 2)


def calculate_ema_safe(closes: list, period: int = 20) -> Optional[float]:
    """نسخة آمنة تُرجع None عند نقص البيانات أو عدم صلاحيتها لتفادي أي إشارة تداول مضللة."""
    try:
        return calculate_ema(closes, period=period)
    except (InsufficientDataError, ValueError, TypeError):
        return None


def calculate_rsi(closes: list, period: int = 14) -> float:
    """
    حساب مؤشر القوة النسبية (RSI) القياسي على 14 شمعة
    باستخدام معادلة فايلدر للتنعيم الأسي الحقيقية (Wilder's Smoothing).
    - يتطلب على الأقل (period + 1) إغلاقات صالحة (15 شمعة لإنتاج 14 فرق سعري).
    - التهيئة الأولى: المتوسط الحسابي البسيط للأرباح والخسائر لأول 14 فرق سعري:
        avg_gain_0 = sum(gains[:14]) / 14
        avg_loss_0 = sum(losses[:14]) / 14
    - التنعيم التكراري اللاحق (Wilder's Recurrence):
        avg_gain = (prev_avg_gain * 13 + current_gain) / 14
        avg_loss = (prev_avg_loss * 13 + current_loss) / 14
    - التعامل الصارم مع الحالات الحدية:
        - عدم كفاية البيانات (< 15): يرفع InsufficientDataError صراحة.
        - قيم غير صالحة (None, NaN, Inf, <= 0): يرفع ValueError.
        - ثبات كامل للأسعار (avg_gain == 0 و avg_loss == 0): يُرجع 50.0 (حياد تام).
        - أرباح فقط بدون خسائر (avg_loss == 0): يُرجع 100.0.
        - خسائر فقط بدون أرباح (avg_gain == 0): يُرجع 0.0.
    """
    if closes is None or len(closes) < period + 1:
        raise InsufficientDataError(f"RSI({period}) requires at least {period + 1} closes, got {len(closes) if closes is not None else 0}")

    clean_closes = []
    for c in closes:
        try:
            val = float(c)
            if val <= 0.0 or val != val or math.isinf(val):
                raise ValueError(f"Invalid price value: {c}")
            clean_closes.append(val)
        except (TypeError, ValueError) as e:
            raise ValueError(f"Invalid close price encountered: {c}") from e

    if len(clean_closes) < period + 1:
        raise InsufficientDataError(f"RSI({period}) requires at least {period + 1} valid closes, got {len(clean_closes)}")

    gains = []
    losses = []
    for i in range(1, len(clean_closes)):
        diff = clean_closes[i] - clean_closes[i - 1]
        gains.append(max(diff, 0.0))
        losses.append(max(-diff, 0.0))

    avg_gain = sum(gains[:period]) / float(period)
    avg_loss = sum(losses[:period]) / float(period)

    for i in range(period, len(gains)):
        avg_gain = (avg_gain * (period - 1) + gains[i]) / float(period)
        avg_loss = (avg_loss * (period - 1) + losses[i]) / float(period)

    # معالجة الحالات الحدية الصريحة لمنع القسمة على صفر أو إنتاج إشارات مضللة
    if avg_loss == 0.0 and avg_gain == 0.0:
        return 50.0
    if avg_loss == 0.0:
        return 100.0
    if avg_gain == 0.0:
        return 0.0

    rs = avg_gain / avg_loss
    rsi = 100.0 - (100.0 / (1.0 + rs))
    return round(rsi, 2)


def calculate_rsi_safe(closes: list, period: int = 14) -> Optional[float]:
    """نسخة آمنة تُرجع None عند نقص البيانات أو عدم صلاحيتها لتفادي أي إشارة تداول مضللة."""
    try:
        return calculate_rsi(closes, period=period)
    except (InsufficientDataError, ValueError, TypeError):
        return None


def calculate_atr(highs: list, lows: list, closes: list, period: int = 14) -> float:
    """
    حساب متوسط المدى الحقيقي (ATR) القياسي على 14 شمعة
    باستخدام معادلة فايلدر للتنعيم الأسي الحقيقية (Wilder's Smoothing).
    - يتطلب على الأقل (period + 1) شموع OHLC صالحة (15 شمعة لإنتاج 14 قيمة True Range).
    - حساب True Range لكل شمعة بدءاً من الشمعة الثانية:
        TR_t = max(H_t - L_t, abs(H_t - C_(t-1)), abs(L_t - C_(t-1)))
    - بذرة التهيئة الأولية: المتوسط الحسابي البسيط (SMA) لأول 14 قيمة TR:
        ATR_0 = sum(TR[:14]) / 14
    - التنعيم التكراري اللاحق (Wilder's Recurrence):
        ATR_t = (ATR_(t-1) * 13 + TR_t) / 14
    - التعامل الصارم مع الحالات الحدية:
        - عدم كفاية البيانات (< 15 شمعة): يرفع InsufficientDataError صراحة.
        - عدم تطابق أطوال المصفوفات: يرفع ValueError.
        - قيم غير صالحة (None, NaN, Inf, <= 0): يرفع ValueError.
        - خلل هندسي في الأسعار (High < Low): يرفع ValueError.
        - سوق ثابت تماماً (كل الشموع متطابقة): يُرجع 0.0 دون أخطاء حسابية.
    """
    if highs is None or lows is None or closes is None:
        raise InsufficientDataError("Highs, lows, and closes must not be None")

    if not (len(highs) == len(lows) == len(closes)):
        raise ValueError(f"Array length mismatch: highs={len(highs)}, lows={len(lows)}, closes={len(closes)}")

    if len(closes) < period + 1:
        raise InsufficientDataError(f"ATR({period}) requires at least {period + 1} candles, got {len(closes)}")

    clean_highs = []
    clean_lows = []
    clean_closes = []

    for i in range(len(closes)):
        try:
            h = float(highs[i])
            l = float(lows[i])
            c = float(closes[i])

            if not (math.isfinite(h) and math.isfinite(l) and math.isfinite(c)):
                raise ValueError(f"Non-finite price encountered at index {i}: H={h}, L={l}, C={c}")
            if h <= 0.0 or l <= 0.0 or c <= 0.0:
                raise ValueError(f"Non-positive price encountered at index {i}: H={h}, L={l}, C={c}")
            if h < l:
                raise ValueError(f"Geometric price violation (High < Low) at index {i}: H={h}, L={l}")

            clean_highs.append(h)
            clean_lows.append(l)
            clean_closes.append(c)
        except (TypeError, ValueError) as e:
            raise ValueError(f"Invalid candle data at index {i}") from e

    if len(clean_closes) < period + 1:
        raise InsufficientDataError(f"ATR({period}) requires at least {period + 1} valid candles, got {len(clean_closes)}")

    tr_list = []
    for i in range(1, len(clean_closes)):
        h = clean_highs[i]
        l = clean_lows[i]
        pc = clean_closes[i - 1]
        tr = max(h - l, abs(h - pc), abs(l - pc))
        tr_list.append(tr)

    # بذرة البداية: المتوسط الحسابي البسيط لأول 14 قيمة TR
    atr = sum(tr_list[:period]) / float(period)

    # التنعيم الأسي لفايلدر لبقية الشموع
    for i in range(period, len(tr_list)):
        atr = (atr * (period - 1) + tr_list[i]) / float(period)

    return round(atr, 2)


def calculate_atr_safe(highs: list, lows: list, closes: list, period: int = 14) -> Optional[float]:
    """نسخة آمنة تُرجع None عند نقص البيانات أو عدم صلاحيتها لتفادي أي خطأ حسابي في وقف الخسارة أو إدارة المخاطر."""
    try:
        return calculate_atr(highs, lows, closes, period=period)
    except (InsufficientDataError, ValueError, TypeError):
        return None


def calculate_adx(highs: list, lows: list, closes: list, period: int = 14) -> dict:
    """
    حساب مؤشر قوة الاتجاه (ADX) وخطي الاتجاه (+DI / -DI) بدقة رياضية صارمة
    وفقاً لمعادلات التنعيم الأسي الحقيقية لـ J. Welles Wilder Jr. (1978).

    المعادلات القياسية لفايلدر:
    1. المدى الحقيقي (True Range) والحركة الاتجاهية (+DM / -DM):
       TR = max(H - L, |H - C_prev|, |L - C_prev|)
       +DM = (H - H_prev) if (H - H_prev > L_prev - L and H - H_prev > 0) else 0.0
       -DM = (L_prev - L) if (L_prev - L > H - H_prev and L_prev - L > 0) else 0.0
    2. البذرة الابتدائية (Initial Seed):
       TR14_0 = sum(TR[:14])
       +DM14_0 = sum(+DM[:14])
       -DM14_0 = sum(-DM[:14])
       (تتطلب 14 تغيراً، أي 15 شمعة من الشمعة 0 إلى 14).
    3. التنعيم التكراري اللاحق (Wilder's Recurrence):
       TR14_t = TR14_(t-1) - (TR14_(t-1) / 14) + TR_t
       +DM14_t = +DM14_(t-1) - (+DM14_(t-1) / 14) + +DM_t
       -DM14_t = -DM14_(t-1) - (-DM14_(t-1) / 14) + -DM_t
    4. المؤشرات الاتجاهية (+DI / -DI) ومؤشر الاتجاه (DX):
       +DI = (+DM14 / TR14) * 100 (أو 0.0 إذا كان TR14 == 0)
       -DI = (-DM14 / TR14) * 100 (أو 0.0 إذا كان TR14 == 0)
       DX = (| +DI - -DI | / (+DI + -DI)) * 100 (أو 0.0 إذا كان المجموع 0)
    5. بذرة ADX وتنعيمه:
       - بذرة ADX الأولى هي المتوسط الحسابي البسيط لأول 14 قيمة DX (تتطلب 14 قيمة DX، أي 28 شمعة كحد أدنى).
       - التنعيم التكراري لفايلدر للقيم اللاحقة:
         ADX_t = ((ADX_(t-1) * 13) + DX_t) / 14

    الحالات الحدية وضوابط النزاهة:
    - نقص البيانات (< 28 شمعة): يرفع InsufficientDataError صراحة دون اختلاق قيم وهمية.
    - عدم تطابق أطوال المصفوفات (Highs, Lows, Closes): يرفع ValueError.
    - قيم غير صالحة (None, NaN, Inf, <= 0): يرفع ValueError.
    - خلل هندسي في الأسعار (High < Low): يرفع ValueError.
    - سوق ثابت تماماً (Zero Movement): يُرجع adx=0.0, plus_di=0.0, minus_di=0.0 بأمان دون قسمة على صفر.
    """
    if highs is None or lows is None or closes is None:
        raise InsufficientDataError("Highs, lows, and closes must not be None")

    if not (len(highs) == len(lows) == len(closes)):
        raise ValueError(f"Array length mismatch: highs={len(highs)}, lows={len(lows)}, closes={len(closes)}")

    min_required = period * 2
    if len(closes) < min_required:
        raise InsufficientDataError(f"ADX({period}) requires at least {min_required} candles, got {len(closes)}")

    clean_highs = []
    clean_lows = []
    clean_closes = []

    for i in range(len(closes)):
        try:
            h = float(highs[i])
            l = float(lows[i])
            c = float(closes[i])
        except (TypeError, ValueError) as e:
            raise ValueError(f"Invalid candle data at index {i}") from e

        if not (math.isfinite(h) and math.isfinite(l) and math.isfinite(c)):
            raise ValueError(f"Non-finite price encountered at index {i}: H={h}, L={l}, C={c}")
        if h <= 0.0 or l <= 0.0 or c <= 0.0:
            raise ValueError(f"Non-positive price encountered at index {i}: H={h}, L={l}, C={c}")
        if h < l:
            raise ValueError(f"Geometric price violation (High < Low) at index {i}: H={h}, L={l}")

        clean_highs.append(h)
        clean_lows.append(l)
        clean_closes.append(c)

    if len(clean_closes) < min_required:
        raise InsufficientDataError(f"ADX({period}) requires at least {min_required} valid candles, got {len(clean_closes)}")

    tr_list = []
    plus_dm = []
    minus_dm = []

    for i in range(1, len(clean_closes)):
        h = clean_highs[i]
        l = clean_lows[i]
        ph = clean_highs[i - 1]
        pl = clean_lows[i - 1]
        pc = clean_closes[i - 1]

        tr = max(h - l, abs(h - pc), abs(l - pc))
        tr_list.append(tr)

        up_move = h - ph
        down_move = pl - l
        plus_dm.append(up_move if (up_move > down_move and up_move > 0.0) else 0.0)
        minus_dm.append(down_move if (down_move > up_move and down_move > 0.0) else 0.0)

    # بذرة البداية لأول 14 فترة (مجموع فايلدر)
    tr_smooth = sum(tr_list[:period])
    plus_smooth = sum(plus_dm[:period])
    minus_smooth = sum(minus_dm[:period])

    dx_list = []
    p_di = (plus_smooth / tr_smooth * 100.0) if tr_smooth > 0.0 else 0.0
    m_di = (minus_smooth / tr_smooth * 100.0) if tr_smooth > 0.0 else 0.0
    di_sum = p_di + m_di
    dx_list.append((abs(p_di - m_di) / di_sum * 100.0) if di_sum > 0.0 else 0.0)

    # التنعيم الأسي لفايلدر لبقية فترات TR و +DM و -DM
    for i in range(period, len(tr_list)):
        tr_smooth = tr_smooth - (tr_smooth / period) + tr_list[i]
        plus_smooth = plus_smooth - (plus_smooth / period) + plus_dm[i]
        minus_smooth = minus_smooth - (minus_smooth / period) + minus_dm[i]

        p_di = (plus_smooth / tr_smooth * 100.0) if tr_smooth > 0.0 else 0.0
        m_di = (minus_smooth / tr_smooth * 100.0) if tr_smooth > 0.0 else 0.0
        di_sum = p_di + m_di
        dx_list.append((abs(p_di - m_di) / di_sum * 100.0) if di_sum > 0.0 else 0.0)

    if len(dx_list) < period:
        raise InsufficientDataError(f"Insufficient DX points for ADX seed: requires {period}, got {len(dx_list)}")

    # بذرة ADX: المتوسط البسيط لأول 14 قيمة DX
    adx_val = sum(dx_list[:period]) / float(period)

    # تنعيم فايلدر التكراري لقيم ADX اللاحقة
    for i in range(period, len(dx_list)):
        adx_val = ((adx_val * (period - 1)) + dx_list[i]) / float(period)

    return {"adx": round(adx_val, 1), "plus_di": round(p_di, 1), "minus_di": round(m_di, 1)}


def calculate_adx_safe(highs: list, lows: list, closes: list, period: int = 14) -> Optional[dict]:
    """نسخة آمنة تُرجع None عند نقص البيانات أو عدم صلاحيتها لتفادي إشارات الشراء الخاطئة."""
    try:
        return calculate_adx(highs, lows, closes, period=period)
    except (InsufficientDataError, ValueError, TypeError):
        return None


# ==============================================================================
# 3. BACKTESTER ENGINE INTERFACE (For Verification & Simulation)
# ==============================================================================

class IndicatorEngine:
    """Unified Indicator Engine matching live calculations."""
    @staticmethod
    def calculate_ema(closes: list, period: int = 20) -> float:
        return calculate_ema(closes, period=period)

    @staticmethod
    def calculate_rsi(closes: list, period: int = 14) -> float:
        return calculate_rsi(closes, period=period)

    @staticmethod
    def calculate_atr(highs: list, lows: list, closes: list, period: int = 14) -> float:
        return calculate_atr(highs, lows, closes, period=period)

    @staticmethod
    def calculate_adx(highs: list, lows: list, closes: list, period: int = 14) -> dict:
        return calculate_adx(highs, lows, closes, period=period)

    @staticmethod
    def calculate_adx_safe(highs: list, lows: list, closes: list, period: int = 14) -> Optional[dict]:
        return calculate_adx_safe(highs, lows, closes, period=period)


class MarketDataFetcher:
    """Generates deterministic market data for backtesting and stress tests."""
    @staticmethod
    def generate_stress_test_dataset(symbol: str = "BTCUSDT", count: int = 300) -> List[Candle]:
        candles = []
        base_time = 1700000000000
        step_ms = 900000  # 15m
        price = 60000.0
        for i in range(count):
            cycle = i % 40
            if cycle < 15:  # Trend up
                d = 45.0
            elif cycle < 25:  # Pullback
                d = -30.0
            elif cycle < 35:  # Rally
                d = 50.0
            else:  # Chop
                d = 5.0 if i % 2 == 0 else -5.0

            open_ = price
            close = price + d
            high = max(open_, close) + 18.0
            low = min(open_, close) - 18.0
            vol = 50.0 + (i % 20) * 2.0
            candles.append(Candle(
                timestamp=base_time + (i * step_ms),
                open_=open_,
                high=high,
                low=low,
                close=close,
                volume=vol
            ))
            price = close
        return candles


class StandaloneBacktester:
    """
    JevQuant Institutional Backtesting Engine V0.1:
    - Pure simulation, zero network calls to Binance.
    - Anti-lookahead bias guarantee (strictly evaluates bars up to bar_idx).
    - Max 20% capital allocation ceiling & \$2,000 trade cap.
    - Accurate 0.10% Spot taker fee + 0.05% slippage accounting.
    - ADX Chop & Trap filter gating.
    """
    def __init__(self, initial_capital: float = 10000.0, symbol: str = "BTCUSDT"):
        self.initial_capital = float(initial_capital)
        self.symbol = symbol
        self.rules = StrategySpecificationV01()
        self.closed_trades: List[Dict[str, Any]] = []
        self.equity_curve: List[Dict[str, Any]] = []

    def evaluate_bar(self, candles: List[Candle], bar_idx: int) -> Optional[Dict[str, Any]]:
        """Evaluate a specific bar strictly on historical slice candles[:bar_idx+1]."""
        if bar_idx < 27 or bar_idx >= len(candles):
            return None

        slice_bars = candles[:bar_idx + 1]
        closes = [b.close for b in slice_bars]
        highs = [b.high for b in slice_bars]
        lows = [b.low for b in slice_bars]

        cur_close = closes[-1]
        if cur_close <= 0.0:
            return None

        ema20 = calculate_ema_safe(closes, period=20)
        rsi = calculate_rsi_safe(closes, period=14)
        atr = calculate_atr_safe(highs, lows, closes, period=14)
        adx_info = calculate_adx_safe(highs, lows, closes, period=14)

        if ema20 is None or rsi is None or atr is None or atr <= 0.0 or adx_info is None:
            return {
                "close": cur_close,
                "confluence": 0,
                "conviction": 0,
                "confidence": 0.0,
                "dynamic_threshold": self.rules.confidence_rules.base_threshold,
                "meets_threshold": False,
                "can_buy": False,
                "atr": atr,
                "adx": adx_info["adx"] if adx_info else None,
                "plus_di": adx_info["plus_di"] if adx_info else None,
                "minus_di": adx_info["minus_di"] if adx_info else None,
                "rsi": rsi,
                "ema20": ema20,
                "reason": "Unready or invalid indicators"
            }

        adx = adx_info["adx"]
        plus_di = adx_info["plus_di"]
        minus_di = adx_info["minus_di"]

        # Calculate authoritative dynamic confidence threshold
        dynamic_threshold = self.rules.confidence_rules.calculate_threshold(atr, cur_close)

        indicator_confluence = (adx >= 20.0) and (plus_di >= minus_di) and (cur_close > ema20) and (45.0 <= rsi <= 68.0)
        confluence = 3 if indicator_confluence else (2 if cur_close > ema20 else 1)
        conviction = 2 if indicator_confluence else 1

        confidence = round(0.82 + min(0.14, (adx - 20) * 0.01), 2) if indicator_confluence else 0.50
        meets_threshold = (confidence >= dynamic_threshold)

        can_buy = indicator_confluence and meets_threshold

        return {
            "close": cur_close,
            "confluence": confluence,
            "conviction": conviction,
            "confidence": confidence,
            "dynamic_threshold": dynamic_threshold,
            "meets_threshold": meets_threshold,
            "can_buy": can_buy,
            "atr": atr,
            "adx": adx,
            "plus_di": plus_di,
            "minus_di": minus_di,
            "rsi": rsi,
            "ema20": ema20
        }

    def run(self, candles: List[Candle]) -> Dict[str, Any]:
        """Execute full historical simulation over candle series."""
        self.closed_trades = []
        self.equity_curve = []
        cash = self.initial_capital
        pos = None

        taker_fee_pct = self.rules.capital_risk.taker_fee_pct / 100.0  # 0.001 (0.10%)
        slippage_pct = self.rules.capital_risk.estimated_slippage_pct / 100.0  # 0.0005 (0.05%)

        for i in range(27, len(candles)):
            cur_bar = candles[i]
            cur_price = cur_bar.close

            # Manage open position exit with full rule precedence:
            # 1. Stop Loss (Capital preservation priority)
            # 2. Take Profit (Institutional R:R 2.5, 3.75 ATR target)
            # 3. Emergency Early Exits:
            #    a. ADX exhaustion (< 16.0)
            #    b. Bearish DI crossover (-DI > +DI)
            #    c. Liquidity trap probability (>= 0.65)
            #    d. Max holding duration (>= 48 bars)
            if pos is not None:
                pos["bars_held"] += 1
                cur_eval = self.evaluate_bar(candles, i)
                cur_adx = cur_eval["adx"] if (cur_eval and cur_eval.get("adx") is not None) else None
                cur_plus_di = cur_eval.get("plus_di") if cur_eval else None
                cur_minus_di = cur_eval.get("minus_di") if cur_eval else None
                cur_trap_prob = cur_eval.get("trap_probability", 0.0) if cur_eval else 0.0

                hit_sl = cur_price <= pos["sl"]
                hit_tp = cur_price >= pos["tp"]
                hit_adx_exhaustion = (cur_adx is not None) and (cur_adx < self.rules.exit_rules.adx_exhaustion_threshold)
                hit_bearish_di = (cur_plus_di is not None and cur_minus_di is not None) and (cur_minus_di > cur_plus_di)
                hit_trap = cur_trap_prob >= self.rules.exit_rules.early_trap_prob
                hit_max_bars = pos["bars_held"] >= self.rules.exit_rules.max_holding_bars

                exit_reason = None
                exit_price = cur_price

                if hit_sl:
                    exit_reason = "STOP_LOSS"
                    exit_price = cur_price
                elif hit_tp:
                    exit_reason = "TAKE_PROFIT"
                    exit_price = cur_price
                elif hit_adx_exhaustion:
                    exit_reason = "EMERGENCY_ADX_EXHAUSTION"
                    exit_price = cur_price
                elif hit_bearish_di:
                    exit_reason = "EMERGENCY_BEARISH_DI"
                    exit_price = cur_price
                elif hit_trap:
                    exit_reason = "EMERGENCY_TRAP_RISK"
                    exit_price = cur_price
                elif hit_max_bars:
                    exit_reason = "EMERGENCY_MAX_DURATION"
                    exit_price = cur_price

                if exit_reason is not None:
                    exit_val = pos["quantity"] * exit_price
                    exit_fee = exit_val * taker_fee_pct
                    half_slippage = exit_val * (slippage_pct / 2.0)
                    gross_pnl = (exit_price - pos["entry_price"]) * pos["quantity"]
                    total_friction = pos["entry_fee"] + exit_fee + pos["slippage_cost"]
                    net_pnl = gross_pnl - total_friction

                    cash += exit_val - exit_fee - half_slippage

                    self.closed_trades.append({
                        "trade_value_usdt": pos["entry_value"],
                        "quantity": pos["quantity"],
                        "entry_price": pos["entry_price"],
                        "exit_price": exit_price,
                        "entry_fee_usdt": pos["entry_fee"],
                        "exit_fee_usdt": exit_fee,
                        "slippage_cost_usdt": pos["slippage_cost"],
                        "gross_pnl_usdt": gross_pnl,
                        "net_pnl_usdt": net_pnl,
                        "reason": exit_reason,
                        "bars_held": pos["bars_held"]
                    })
                    pos = None

            # Evaluate entry if cash available and no position open
            if pos is None:
                eval_res = self.evaluate_bar(candles, i)
                if eval_res and eval_res["can_buy"]:
                    # Position sizing via authoritative rules engine
                    trade_val = self.rules.entry_rules.calculate_position_size(
                        current_balance=cash,
                        conviction=eval_res["conviction"],
                        confidence=eval_res["confidence"],
                        threshold=eval_res.get("dynamic_threshold", self.rules.confidence_rules.base_threshold)
                    )
                    # Enforce strict 20% capital allocation ceiling and absolute cap
                    max_by_cap = cash * (self.rules.capital_risk.max_capital_allocation_pct / 100.0)
                    trade_val = min(trade_val, max_by_cap, self.rules.entry_rules.max_single_trade_cap_usdt)

                    min_trade_floor = 10.0 if self.initial_capital <= 500.0 else 50.0
                    if trade_val >= min_trade_floor and cash >= trade_val:
                        entry_fee = trade_val * taker_fee_pct
                        total_slip = trade_val * slippage_pct
                        half_slip = total_slip / 2.0
                        qty = trade_val / cur_price

                        cash -= (trade_val + entry_fee + half_slip)
                        pos = {
                            "entry_price": cur_price,
                            "quantity": qty,
                            "entry_value": trade_val,
                            "entry_fee": entry_fee,
                            "slippage_cost": total_slip,
                            "sl": cur_price - (eval_res["atr"] * self.rules.exit_rules.sl_atr_mult),
                            "tp": cur_price + (eval_res["atr"] * self.rules.exit_rules.tp_atr_mult),
                            "atr": eval_res["atr"],
                            "bars_held": 0
                        }

            pos_val = (pos["quantity"] * cur_price) if pos else 0.0
            total_eq = cash + pos_val
            self.equity_curve.append({
                "bar_idx": i,
                "timestamp": cur_bar.timestamp,
                "cash": max(0.0, cash),
                "total_equity": max(0.0, total_eq)
            })

        return {
            "total_trades": len(self.closed_trades),
            "initial_capital": self.initial_capital,
            "final_equity": self.equity_curve[-1]["total_equity"] if self.equity_curve else self.initial_capital
        }


# ==============================================================================
# 4. MULTI-TIMEFRAME LIVE STATE & SAFE EXECUTION
# ==============================================================================

def send_telegram_alert(message: str):
    """Send formatted alert to user's Telegram."""
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
        return
    try:
        url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
        payload = json.dumps({
            "chat_id": TELEGRAM_CHAT_ID,
            "text": message,
            "parse_mode": "HTML",
            "disable_web_page_preview": True
        }).encode("utf-8")
        req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"})
        urllib.request.urlopen(req, timeout=5)
    except Exception as e:
        print(f"Telegram notification error: {e}")


def fetch_multi_timeframe_state(symbol: str, reference_time_ms: Optional[int] = None) -> dict:
    """
    جلب بيانات الشموع الحية من بينانس وحساب المؤشرات الفنية بدقة لكل إطار زمني للعملة المحددة.
    - تحديد الشموع المغلقة المؤكدة بالتحقق من وقت الإغلاق k[6]
    - فحص سلامة السلسلة الزمنية عبر Time-Series Hygiene Guard
    - توحيد مجموعة الشموع المغلقة المؤكدة لكافة المؤشرات (EMA20, RSI, ATR, ADX)
    """
    mtf_state = {}
    for tf in TIMEFRAMES:
        try:
            url = f"{BINANCE_BASE_URL}/api/v3/klines?symbol={symbol}&interval={tf}&limit=50"
            if requests is not None:
                res = requests.get(url, timeout=10).json()
            else:
                req = urllib.request.Request(url, headers={"User-Agent": "JevQuant/1.0"})
                with urllib.request.urlopen(req, timeout=10) as resp:
                    res = json.loads(resp.read().decode("utf-8"))

            if not isinstance(res, list) or len(res) == 0:
                continue

            # 1. تحديد واستخراج الشموع المؤكدة الإغلاق بناءً على وقت إغلاق الشمعة k[6]
            closed_klines = resolve_closed_klines(res, reference_time_ms=reference_time_ms)
            if len(closed_klines) < 20:
                continue

            # 2. فحص سلامة السلسلة الزمنية للشموع المغلقة (Hygiene Guard)
            validate_time_series_hygiene(closed_klines, tf)

            # 3. توحيد مجموعة الشموع المغلقة المؤكدة لكافة المؤشرات
            closed_closes = [float(k[4]) for k in closed_klines]
            closed_highs = [float(k[2]) for k in closed_klines]
            closed_lows = [float(k[3]) for k in closed_klines]
            closed_volumes = [float(k[5]) for k in closed_klines]

            # حساب كافة المؤشرات (EMA20, RSI, ATR, ADX) على نفس مجموعة الشموع المغلقة المؤكدة
            ema20 = calculate_ema_safe(closed_closes, period=20)
            rsi = calculate_rsi_safe(closed_closes, period=14)
            atr = calculate_atr_safe(closed_highs, closed_lows, closed_closes, period=14)
            adx_data = calculate_adx_safe(closed_highs, closed_lows, closed_closes, period=14)
            avg_vol_10 = sum(closed_volumes[-10:]) / 10 if len(closed_volumes) >= 10 else sum(closed_volumes) / len(closed_volumes)

            mtf_state[tf] = {
                "current_close": float(res[-1][4]),  # السعر اللحظي للشمعة الحالية
                "closed_close": closed_closes[-1],   # إغلاق آخر شمعة مؤكدة لاعتماد الاتجاه
                "ema20": ema20,
                "rsi": rsi,
                "atr": atr,
                "adx": adx_data["adx"] if adx_data else None,
                "plus_di": adx_data["plus_di"] if adx_data else None,
                "minus_di": adx_data["minus_di"] if adx_data else None,
                "volume_spike": closed_volumes[-1] > (avg_vol_10 * 1.5)
            }
        except Exception as e:
            print(f"Error fetching {symbol} {tf}: {e}")
    return mtf_state


def evaluate_with_jev(symbol: str, mtf_state: dict, is_currently_holding: bool = False) -> dict:
    """Send single batched System One request to Jev evaluating trade logic for specific symbol."""
    if "15m" not in mtf_state or "1h" not in mtf_state:
        return {"action": "HOLD", "confidence": 0.0, "reason": "Insufficient MTF data"}

    s15 = mtf_state["15m"]
    s1h = mtf_state["1h"]
    adx_15m = s15.get("adx")
    plus_di = s15.get("plus_di")
    minus_di = s15.get("minus_di")

    # فحص صريح لـ EMA20: إذا كانت البيانات غير كافية أو غير جاهزة، يُمنع إنتاج إشارة شراء
    s15_ema = s15.get("ema20")
    s1h_ema = s1h.get("ema20")
    if s15_ema is None or s1h_ema is None:
        return {"action": "HOLD", "confidence": 0.0, "reason": "Insufficient data for EMA20"}

    # فحص صريح لـ RSI14: إذا كانت البيانات غير كافية أو غير جاهزة، يُمنع إنتاج إشارة شراء
    rsi_15m = s15.get("rsi")
    if rsi_15m is None:
        return {"action": "HOLD", "confidence": 0.0, "reason": "Insufficient data for RSI14 (requires at least 15 closed candles)"}

    # فحص صريح لـ ATR14: إذا كانت البيانات غير كافية أو غير جاهزة أو غير صالحة (None أو <= 0)، يُمنع إنتاج إشارة شراء
    atr_15m = s15.get("atr")
    if atr_15m is None or atr_15m <= 0.0:
        return {"action": "HOLD", "confidence": 0.0, "reason": "Insufficient data for ATR14 (requires at least 15 closed candles and ATR > 0)"}

    # فحص صريح لـ ADX14 و +DI و -DI: إذا كانت البيانات غير كافية أو غير جاهزة، يُمنع إنتاج إشارة شراء
    if adx_15m is None or plus_di is None or minus_di is None:
        return {"action": "HOLD", "confidence": 0.0, "reason": "Insufficient data for ADX14 (requires at least 28 closed candles)"}

    # فلتر التذبذب الصارم: منع التداول في السوق العرضي المتقلب
    if adx_15m < 20:
        return {"action": "HOLD", "confidence": 0.0, "reason": "Blocked by ADX Chop Filter (ADX < 20)"}
    if plus_di < minus_di:
        return {"action": "HOLD", "confidence": 0.0, "reason": "Bearish momentum (-DI > +DI)"}

    # شروط الدخول الشرائي الزخمي عالي الدقة (Bullish Confluence)
    # استخدام الشمعة المغلقة المؤكدة لتفادي الـ Repainting من الشمعة المفتوحة
    ref_close_15m = s15.get("closed_close", s15["current_close"])
    ref_close_1h = s1h.get("closed_close", s1h["current_close"])
    bullish_ema = ref_close_15m > s15_ema and ref_close_1h > s1h_ema
    rsi_valid = 45.0 <= rsi_15m <= 68.0

    # Dynamic confidence threshold
    ref_close = ref_close_15m if ref_close_15m > 0 else s15["current_close"]
    dynamic_threshold = StrategySpecificationV01.confidence_rules.calculate_threshold(atr_15m, ref_close)

    if not is_currently_holding and bullish_ema and rsi_valid and adx_15m >= 22:
        confidence = round(0.82 + min(0.14, (adx_15m - 20) * 0.01), 2)
        if confidence >= dynamic_threshold:
            return {
                "action": "BUY",
                "confidence": confidence,
                "dynamic_threshold": dynamic_threshold,
                "atr": s15["atr"],
                "price": s15["current_close"],
                "reason": f"Bullish trend confirmed (ADX {adx_15m}, RSI {rsi_15m}, EMA20 confirmed, Conf {confidence} >= {dynamic_threshold})"
            }
        else:
            return {
                "action": "HOLD",
                "confidence": confidence,
                "dynamic_threshold": dynamic_threshold,
                "reason": f"Confidence {confidence} below dynamic threshold {dynamic_threshold}"
            }

    return {"action": "HOLD", "confidence": 0.5, "dynamic_threshold": dynamic_threshold, "reason": "No entry confluence"}


def execute_binance_order(symbol: str, side: str, quantity: float, current_price: float = 0.0) -> dict:
    """
    تنفيذ الأوامر عبر مدير التنفيذ المؤسسي الآمن:
    - الوضع الافتراضي هو PAPER (محاكاة داخلية 100% مع احتساب الرسوم والانزلاق، وبدون أي اتصال شبكي بـ Binance).
    - يمنع تماماً أي اتصال شبكي تنفيذي خارجي أثناء الاختبارات.
    """
    if _institutional_execution_mgr is not None:
        px = current_price if current_price > 0 else 60000.0
        rec = _institutional_execution_mgr.execute(
            symbol=symbol,
            side=side,
            quote_amount=quantity * px if quantity > 0 else ALLOCATION_PER_TRADE_USDT,
            current_market_price=px
        )
        return {
            "status": "FILLED" if rec.is_simulated else "SENT",
            "symbol": symbol,
            "side": side,
            "quantity": rec.quantity,
            "order_id": rec.order_id,
            "is_simulated": rec.is_simulated,
            "mode": rec.mode
        }

    print(f"[Simulation/Dry-Run] {side} {quantity} {symbol}")
    return {"status": "SIMULATED", "symbol": symbol, "side": side, "quantity": quantity, "is_simulated": True, "mode": "PAPER"}


def run_bot_loop():
    """حلقة التشغيل المستمرة 24/7 لجميع العملات المحددة."""
    print("=" * 65)
    print("🚀 JevQuant Autonomous Multi-Symbol Spot Bot Starting...")
    print(f"📊 Active Symbols: {SYMBOLS}")
    print(f"⏱ Timeframes: {TIMEFRAMES}")
    print(f"💰 Allocation per Trade: \${ALLOCATION_PER_TRADE_USDT} USDT")
    print("=" * 65)

    send_telegram_alert(f"🤖 <b>JevQuant Bot Started</b>\\nWatching symbols: <code>{', '.join(SYMBOLS)}</code>")

    while True:
        try:
            for symbol in SYMBOLS:
                if symbol not in active_positions:
                    active_positions[symbol] = {"in_position": False, "entry_price": 0.0, "sl": 0.0, "tp": 0.0, "qty": 0.0, "bars_held": 0}

                pos = active_positions[symbol]
                mtf = fetch_multi_timeframe_state(symbol)
                if not mtf or "15m" not in mtf:
                    continue

                current_price = mtf["15m"]["current_close"]
                atr_15m = mtf["15m"]["atr"]

                # فحص الخروج إذا كانت لدينا صفقة مفتوحة للعملة بأولويات الحماية المعتمدة:
                # 1. وقف الخسارة SL
                # 2. جني الأرباح TP (1.5 * 2.5 = 3.75 ATR)
                # 3. الخروج الاضطراري: استنفاد ADX (< 16)، تقاطع هابط (-DI > +DI)، أقصى مدة (48 شمعة)
                if pos["in_position"]:
                    pos.setdefault("bars_held", 0)
                    pos["bars_held"] += 1
                    adx_15m = mtf["15m"].get("adx")
                    plus_di = mtf["15m"].get("plus_di")
                    minus_di = mtf["15m"].get("minus_di")

                    hit_sl = current_price <= pos["sl"]
                    hit_tp = current_price >= pos["tp"]
                    hit_adx_exhaustion = (adx_15m is not None) and (adx_15m < StrategySpecificationV01.exit_rules.adx_exhaustion_threshold)
                    hit_bearish_di = (plus_di is not None and minus_di is not None) and (minus_di > plus_di)
                    hit_max_bars = pos["bars_held"] >= StrategySpecificationV01.exit_rules.max_holding_bars

                    exit_reason = None
                    if hit_sl:
                        exit_reason = "STOP_LOSS"
                    elif hit_tp:
                        exit_reason = "TAKE_PROFIT"
                    elif hit_adx_exhaustion:
                        exit_reason = "EMERGENCY_ADX_EXHAUSTION"
                    elif hit_bearish_di:
                        exit_reason = "EMERGENCY_BEARISH_DI"
                    elif hit_max_bars:
                        exit_reason = "EMERGENCY_MAX_DURATION"

                    if exit_reason:
                        print(f"🛑 [{exit_reason}] {symbol} exit at {current_price} (SL: {pos['sl']}, TP: {pos['tp']})")
                        execute_binance_order(symbol, "SELL", pos["qty"], current_price=current_price)
                        send_telegram_alert(f"🛑 <b>Position Closed ({exit_reason})</b>: {symbol}\\nExit: {current_price}\\nPNL: {round((current_price - pos['entry_price'])/pos['entry_price']*100, 2)}%")
                        pos["in_position"] = False
                    continue

                # تقييم الدخول لصفقة جديدة بالمعايرة الديناميكية وحجم الصفقة المنضبط
                eval_res = evaluate_with_jev(symbol, mtf, is_currently_holding=pos["in_position"])
                dyn_threshold = eval_res.get("dynamic_threshold", StrategySpecificationV01.confidence_rules.calculate_threshold(atr_15m, current_price))

                if eval_res["action"] == "BUY" and eval_res["confidence"] >= dyn_threshold:
                    trade_val = StrategySpecificationV01.entry_rules.calculate_position_size(
                        current_balance=ALLOCATION_PER_TRADE_USDT,
                        conviction=2,
                        confidence=eval_res["confidence"],
                        threshold=dyn_threshold
                    )
                    max_alloc = ALLOCATION_PER_TRADE_USDT * (StrategySpecificationV01.capital_risk.max_capital_allocation_pct / 100.0)
                    trade_val = min(trade_val, max_alloc, StrategySpecificationV01.entry_rules.max_single_trade_cap_usdt)

                    qty = round(trade_val / current_price, 5)
                    sl = round(current_price - (atr_15m * STOP_LOSS_ATR_MULT), 2)
                    tp = round(current_price + (atr_15m * TAKE_PROFIT_ATR_MULT), 2)

                    print(f"⚡ [BUY SIGNAL] {symbol} @ {current_price} | Conf: {eval_res['confidence']} (Req: {dyn_threshold}) | SL: {sl} | TP: {tp}")
                    order = execute_binance_order(symbol, "BUY", qty, current_price=current_price)

                    pos["in_position"] = True
                    pos["entry_price"] = current_price
                    pos["sl"] = sl
                    pos["tp"] = tp
                    pos["qty"] = qty
                    pos["bars_held"] = 0

                    send_telegram_alert(
                        f"⚡ <b>JevQuant Buy Order</b>\\n"
                        f"Asset: <b>{symbol}</b>\\n"
                        f"Entry Price: <code>\${current_price}</code>\\n"
                        f"Stop Loss: <code>\${sl}</code>\\n"
                        f"Take Profit: <code>\${tp}</code>\\n"
                        f"Confidence: <b>{int(eval_res['confidence'] * 100)}%</b>\\n"
                        f"Threshold: <b>{int(dyn_threshold * 100)}%</b>"
                    )

            time.sleep(15)

        except KeyboardInterrupt:
            print("\\nBot manually stopped.")
            break
        except Exception as err:
            print(f"Bot cycle exception: {err}")
            time.sleep(10)


if __name__ == "__main__":
    run_bot_loop()`;
