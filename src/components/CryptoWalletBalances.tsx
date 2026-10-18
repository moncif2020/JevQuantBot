import React, { useState, useMemo } from 'react';
import {
  Wallet,
  RefreshCw,
  Coins,
  Eye,
  EyeOff,
  Lock,
  Unlock,
  KeyRound,
  ArrowRight,
  ShieldCheck,
  CheckCircle2,
  Sparkles
} from 'lucide-react';

export interface AssetBalanceItem {
  asset: string;
  name: string;
  iconBg: string;
  free: number;
  locked: number;
  total: number;
  priceUsdt: number;
  totalUsdtValue: number;
  allocationPercent: number;
  isStable?: boolean;
}

interface CryptoWalletBalancesProps {
  balances: AssetBalanceItem[];
  totalWalletUsdt: number;
  isLoading: boolean;
  onRefresh: () => void;
  isAccountVerified: boolean;
  binanceMode: 'paper' | 'testnet' | 'live';
  onNavigateToBinanceConfig?: () => void;
}

// The official trading currencies supported by the bot (BTC/USDT, ETH/USDT, SOL/USDT)
const BOT_CORE_ASSETS = ['USDT', 'BTC', 'ETH', 'SOL'];

export const CryptoWalletBalances: React.FC<CryptoWalletBalancesProps> = ({
  balances,
  totalWalletUsdt,
  isLoading,
  onRefresh,
  isAccountVerified,
  binanceMode,
  onNavigateToBinanceConfig,
}) => {
  const [includeBnbFees, setIncludeBnbFees] = useState<boolean>(true);
  const [showValues, setShowValues] = useState<boolean>(true);

  // 1. Strictly filter only the bot's official coins (USDT, BTC, ETH, SOL, and optional BNB for fees)
  const allowedSymbols = useMemo(() => {
    return includeBnbFees ? [...BOT_CORE_ASSETS, 'BNB'] : BOT_CORE_ASSETS;
  }, [includeBnbFees]);

  const displayedBalances = useMemo(() => {
    const list = balances.filter((b) => {
      const sym = String(b.asset || '').trim().toUpperCase();
      if (!allowedSymbols.includes(sym)) return false;
      const free = Number(b.free) || 0;
      const locked = Number(b.locked) || 0;
      const total = free + locked;
      return total > 0.00000001;
    });

    const totalVal = list.reduce((sum, item) => sum + (item.totalUsdtValue || (item.total * item.priceUsdt)), 0);

    return list.map((item) => ({
      ...item,
      allocationPercent: totalVal > 0 ? ((item.totalUsdtValue || (item.total * item.priceUsdt)) / totalVal) * 100 : 0,
    }));
  }, [balances, allowedSymbols]);

  // 2. Real total valuation based strictly on the bot's assets
  const currentTotalUsdt = useMemo(() => {
    return displayedBalances.reduce((sum, item) => sum + (item.totalUsdtValue || (item.total * item.priceUsdt)), 0);
  }, [displayedBalances]);

  // Check if account has BNB
  const hasBnbBalance = balances.some((b) => b.asset.toUpperCase() === 'BNB' && b.total > 0);

  return (
    <div className="bg-slate-900/60 p-5 rounded-2xl border border-slate-800 space-y-5">
      {/* HEADER & ACTIONS */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-gradient-to-br from-emerald-500/20 to-teal-500/10 text-emerald-400 border border-emerald-500/30">
            <Wallet className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-base text-white">
                محفظة عملات البوت الرسمية (BTC · ETH · SOL · USDT)
              </h3>
              <span
                className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold flex items-center gap-1 ${
                  isAccountVerified
                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                    : 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
                }`}
              >
                {isAccountVerified ? (
                  <>
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                    <span>Binance {binanceMode === 'testnet' ? 'Testnet متصل' : 'Live متصل'}</span>
                  </>
                ) : (
                  <span>بانتظار ربط المفاتيح</span>
                )}
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              عرض مخصص وحصري للعملات الثلاث التي يتداول عليها البوت (BTC, ETH, SOL) ورصيد الكاش (USDT)
            </p>
          </div>
        </div>

        {/* CONTROLS */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* BNB TOGGLE */}
          {hasBnbBalance && (
            <button
              onClick={() => setIncludeBnbFees(!includeBnbFees)}
              className={`px-2.5 py-1.5 rounded-xl border text-xs font-medium transition-all cursor-pointer flex items-center gap-1.5 ${
                includeBnbFees
                  ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                  : 'bg-slate-950 border-slate-800 text-slate-500 hover:text-slate-300'
              }`}
              title="إظهار أو استبعاد رصيد BNB المخصص لخصم رسوم منصة Binance"
            >
              <Coins className="w-3.5 h-3.5 text-amber-400" />
              <span>{includeBnbFees ? 'إخفاء BNB (رسوم)' : 'إظهار BNB (رسوم)'}</span>
            </button>
          )}

          <button
            onClick={() => setShowValues(!showValues)}
            className="p-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-400 hover:text-white transition-all cursor-pointer text-xs flex items-center gap-1.5"
            title="إخفاء/إظهار مبالغ الرصيد"
          >
            {showValues ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            <span className="hidden md:inline">{showValues ? 'إخفاء الأرقام' : 'إظهار الأرقام'}</span>
          </button>

          <button
            onClick={onRefresh}
            disabled={isLoading}
            className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs border border-slate-700 transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            title="تحديث الأرصدة فورياً من Binance"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-emerald-400' : ''}`} />
            <span>{isLoading ? 'جاري التحديث...' : 'تحديث الأرصدة'}</span>
          </button>
        </div>
      </div>

      {/* STATE 1: NOT CONNECTED */}
      {!isAccountVerified && displayedBalances.length === 0 ? (
        <div className="p-8 rounded-xl bg-slate-950/70 border border-slate-800 flex flex-col items-center justify-center text-center space-y-4">
          <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center shadow-inner">
            <KeyRound className="w-7 h-7" />
          </div>
          <div className="space-y-1.5 max-w-md">
            <h4 className="text-sm font-bold text-white">لم يتم ربط مفاتيح Binance Testnet بعد</h4>
            <p className="text-xs text-slate-400 leading-relaxed">
              المحفظة تعرض فقط العملات الثلاث المعتمدة في البوت (BTC, ETH, SOL) ورصيد الكاش USDT. يرجى ربط مفاتيح API الخاصة بك لتتبع الأرصدة الحقيقية.
            </p>
          </div>
          {onNavigateToBinanceConfig && (
            <button
              onClick={onNavigateToBinanceConfig}
              className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs shadow-lg shadow-emerald-500/20 transition-all cursor-pointer flex items-center gap-2"
            >
              <ShieldCheck className="w-4 h-4" />
              <span>الانتقال لإعدادات ربط Binance API</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      ) : isAccountVerified && displayedBalances.length === 0 ? (
        /* STATE 2: ZERO BALANCES */
        <div className="p-8 rounded-xl bg-slate-950/70 border border-slate-800 flex flex-col items-center justify-center text-center space-y-3">
          <div className="w-12 h-12 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 flex items-center justify-center">
            <Coins className="w-6 h-6 text-slate-500" />
          </div>
          <div className="space-y-1 max-w-md">
            <h4 className="text-sm font-bold text-slate-200">لا توجد أرصدة في عملات البوت (BTC, ETH, SOL, USDT)</h4>
            <p className="text-xs text-slate-400 leading-relaxed">
              تم فحص حسابك في Binance Testnet بنجاح ولكن رصيد USDT أو العملات الثلاث صفر. يمكنك الحصول على USDT تجريبي من Binance Faucet لبدء التداول.
            </p>
          </div>
        </div>
      ) : (
        /* STATE 3: REAL BOT ASSETS POPULATED */
        <>
          {/* TOTAL VALUATION OVERVIEW BANNER */}
          <div className="bg-gradient-to-r from-slate-950 via-slate-900 to-slate-950 p-4 rounded-xl border border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400">إجمالي قيمة محفظة تداول البوت (Bot Trading Portfolio Value)</span>
                <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  {displayedBalances.length} أصول معتمدة
                </span>
              </div>
              <div className="flex items-baseline gap-2 mt-1">
                <span className="font-mono tabular-nums text-2xl md:text-3xl font-black text-white">
                  {showValues ? `$${currentTotalUsdt.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '•••••••'}
                </span>
                <span className="text-xs font-bold text-emerald-400">USDT</span>
              </div>
            </div>

            {/* PORTFOLIO ALLOCATION BAR */}
            <div className="flex-1 max-w-md space-y-1.5">
              <div className="flex justify-between text-[11px] text-slate-400">
                <span>توزيع أصول البوت</span>
                <span className="font-mono tabular-nums text-white">{displayedBalances.length} أصل</span>
              </div>
              <div className="h-2.5 w-full bg-slate-800 rounded-full overflow-hidden flex">
                {displayedBalances.map((b) => {
                  if (b.allocationPercent <= 0) return null;
                  return (
                    <div
                      key={b.asset}
                      style={{ width: `${b.allocationPercent}%` }}
                      className={`h-full ${b.iconBg} transition-all duration-500`}
                      title={`${b.asset}: ${b.allocationPercent.toFixed(1)}%`}
                    />
                  );
                })}
              </div>
              <div className="flex flex-wrap items-center gap-3 text-[10px] text-slate-400 pt-0.5">
                {displayedBalances.map((b) => (
                  <div key={b.asset} className="flex items-center gap-1 font-mono">
                    <span className={`w-2 h-2 rounded-full ${b.iconBg}`}></span>
                    <span className="text-slate-300 font-bold">{b.asset}</span>
                    <span className="tabular-nums">({b.allocationPercent.toFixed(1)}%)</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ASSETS TABLE */}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-950 text-slate-400 uppercase text-[10px] border-b border-slate-800">
                <tr>
                  <th className="py-2.5 px-3">العملة (Asset)</th>
                  <th className="py-2.5 px-3">الرصيد المتاح (Free)</th>
                  <th className="py-2.5 px-3">الرصيد المحجوز (Locked)</th>
                  <th className="py-2.5 px-3">الرصيد الكلي (Total)</th>
                  <th className="py-2.5 px-3">السعر الحالي (Price)</th>
                  <th className="py-2.5 px-3">القيمة الإجمالية (USDT Value)</th>
                  <th className="py-2.5 px-3 text-center">النسبة من المحفظة (%)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80 font-mono tabular-nums">
                {displayedBalances.map((item) => (
                  <tr key={item.asset} className="hover:bg-slate-800/40 transition-colors">
                    {/* ASSET NAME & BADGE */}
                    <td className="py-3 px-3">
                      <div className="flex items-center gap-2.5">
                        <div className={`w-7 h-7 rounded-lg ${item.iconBg} flex items-center justify-center font-bold text-xs text-white shadow-inner font-sans`}>
                          {item.asset.slice(0, 3)}
                        </div>
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold text-white font-sans">{item.asset}</span>
                            {item.isStable && (
                              <span className="text-[9px] px-1 rounded bg-slate-800 text-slate-400 font-sans">
                                كاش أساسي
                              </span>
                            )}
                            {item.asset === 'BNB' && (
                              <span className="text-[9px] px-1 rounded bg-amber-500/20 text-amber-300 font-sans border border-amber-500/30">
                                رسوم المنصة
                              </span>
                            )}
                          </div>
                          <span className="text-[10px] text-slate-500 font-sans block">{item.name}</span>
                        </div>
                      </div>
                    </td>

                    {/* FREE BALANCE */}
                    <td className="py-3 px-3">
                      <div className="flex items-center gap-1 text-slate-200 font-semibold">
                        <Unlock className="w-3 h-3 text-emerald-400/70 shrink-0" />
                        <span>{showValues ? item.free.toLocaleString(undefined, { maximumFractionDigits: 6 }) : '••••'}</span>
                      </div>
                    </td>

                    {/* LOCKED BALANCE */}
                    <td className="py-3 px-3">
                      <div className="flex items-center gap-1 text-slate-400">
                        {item.locked > 0 ? (
                          <>
                            <Lock className="w-3 h-3 text-amber-400/80 shrink-0" />
                            <span className="text-amber-300 font-semibold">
                              {showValues ? item.locked.toLocaleString(undefined, { maximumFractionDigits: 6 }) : '•••'}
                            </span>
                          </>
                        ) : (
                          <span className="text-slate-600">0.00</span>
                        )}
                      </div>
                    </td>

                    {/* TOTAL BALANCE */}
                    <td className="py-3 px-3 font-bold text-white">
                      {showValues ? item.total.toLocaleString(undefined, { maximumFractionDigits: 6 }) : '••••'}
                    </td>

                    {/* LIVE PRICE */}
                    <td className="py-3 px-3 text-slate-300">
                      ${item.priceUsdt.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>

                    {/* USDT VALUE */}
                    <td className="py-3 px-3">
                      <span className="font-extrabold text-emerald-400 text-sm">
                        {showValues ? `$${item.totalUsdtValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '••••••'}
                      </span>
                    </td>

                    {/* ALLOCATION % */}
                    <td className="py-3 px-3 text-center">
                      <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-slate-950 border border-slate-800">
                        <span className="text-[11px] font-bold text-slate-200">
                          {item.allocationPercent.toFixed(1)}%
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
};
