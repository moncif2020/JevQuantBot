import React, { useState, useMemo } from 'react';
import {
  Download,
  Filter,
  ArrowUpDown,
  Search,
  CheckCircle2,
  Clock,
  ExternalLink,
  ChevronDown,
  TrendingUp,
  TrendingDown,
  Layers,
  FileSpreadsheet
} from 'lucide-react';

export interface BacktestTradeLog {
  id: string;
  timestamp: string;
  asset: string;
  type: string;
  timeframe: string;
  entryPrice: number;
  exitPrice?: number;
  pnl?: number;
  pnlPercent?: number;
  status: 'OPEN' | 'CLOSED';
  conviction: number;
  stopLoss: number;
  takeProfit: number;
  confidence?: number;
  duration?: string;
  exitReason?: 'TAKE_PROFIT' | 'STOP_LOSS' | 'JEV_REVERSAL_EXIT' | 'TRAILING_PROFIT' | 'ACTIVE';
}

interface TradeHistoryLogsProps {
  trades: BacktestTradeLog[];
  title?: string;
  subtitle?: string;
}

export const TradeHistoryLogs: React.FC<TradeHistoryLogsProps> = ({
  trades,
  title = 'جدول زمني تفصيلي لنتائج الصفقات (Trade History Logs)',
  subtitle = 'سجل دقيق لجميع الصفقات المنفذة، مع حسابات العائد، مستويات الحماية، والتقييم الاحتمالي لـ Jev AI'
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [assetFilter, setAssetFilter] = useState<'ALL' | string>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'OPEN' | 'CLOSED'>('ALL');
  const [outcomeFilter, setOutcomeFilter] = useState<'ALL' | 'WIN' | 'LOSS'>('ALL');
  const [sortField, setSortField] = useState<'timestamp' | 'pnl' | 'entryPrice' | 'conviction'>('timestamp');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  // Filter & Sort Trades
  const filteredTrades = useMemo(() => {
    return trades
      .filter((trade) => {
        // Search filter
        if (searchTerm) {
          const term = searchTerm.toLowerCase();
          const matchId = trade.id.toLowerCase().includes(term);
          const matchAsset = trade.asset.toLowerCase().includes(term);
          const matchType = trade.type.toLowerCase().includes(term);
          if (!matchId && !matchAsset && !matchType) return false;
        }

        // Asset filter
        if (assetFilter !== 'ALL' && trade.asset !== assetFilter) {
          return false;
        }

        // Status filter
        if (statusFilter !== 'ALL' && trade.status !== statusFilter) {
          return false;
        }

        // Outcome filter
        if (outcomeFilter === 'WIN' && (!trade.pnl || trade.pnl <= 0)) {
          return false;
        }
        if (outcomeFilter === 'LOSS' && (!trade.pnl || trade.pnl >= 0)) {
          return false;
        }

        return true;
      })
      .sort((a, b) => {
        let comp = 0;
        if (sortField === 'timestamp') {
          comp = a.timestamp.localeCompare(b.timestamp);
        } else if (sortField === 'pnl') {
          comp = (a.pnl ?? 0) - (b.pnl ?? 0);
        } else if (sortField === 'entryPrice') {
          comp = a.entryPrice - b.entryPrice;
        } else if (sortField === 'conviction') {
          comp = a.conviction - b.conviction;
        }
        return sortOrder === 'desc' ? -comp : comp;
      });
  }, [trades, searchTerm, assetFilter, statusFilter, outcomeFilter, sortField, sortOrder]);

  // Aggregate stats from current view
  const stats = useMemo(() => {
    const closed = filteredTrades.filter((t) => t.status === 'CLOSED');
    const wins = closed.filter((t) => (t.pnl ?? 0) > 0);
    const losses = closed.filter((t) => (t.pnl ?? 0) < 0);
    const totalPnl = closed.reduce((acc, t) => acc + (t.pnl ?? 0), 0);
    const winRate = closed.length > 0 ? (wins.length / closed.length) * 100 : 0;
    const avgWin = wins.length > 0 ? wins.reduce((acc, t) => acc + (t.pnl ?? 0), 0) / wins.length : 0;
    const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((acc, t) => acc + (t.pnl ?? 0), 0) / losses.length) : 0;
    const profitFactor = avgLoss > 0 ? (wins.reduce((acc, t) => acc + (t.pnl ?? 0), 0) / (losses.reduce((acc, t) => acc + Math.abs(t.pnl ?? 0), 0) || 1)) : wins.length > 0 ? 99 : 0;

    return {
      totalCount: filteredTrades.length,
      closedCount: closed.length,
      openCount: filteredTrades.length - closed.length,
      winsCount: wins.length,
      lossesCount: losses.length,
      totalPnl,
      winRate,
      avgWin,
      avgLoss,
      profitFactor
    };
  }, [filteredTrades]);

  // CSV Export Function
  const exportToCSV = () => {
    if (filteredTrades.length === 0) return;

    // Header row with UTF-8 BOM for Excel Arabic support
    const headers = [
      'Trade ID',
      'Timestamp',
      'Asset',
      'Type',
      'Timeframe',
      'Entry Price (USDT)',
      'Exit Price (USDT)',
      'Stop Loss (USDT)',
      'Take Profit (USDT)',
      'PnL (USDT)',
      'PnL (%)',
      'Status',
      'Conviction Level',
      'Confidence (%)',
      'Exit Reason'
    ];

    const rows = filteredTrades.map((t) => [
      `"${t.id}"`,
      `"${t.timestamp}"`,
      `"${t.asset}"`,
      `"${t.type}"`,
      `"${t.timeframe}"`,
      t.entryPrice.toFixed(2),
      t.exitPrice ? t.exitPrice.toFixed(2) : 'N/A',
      t.stopLoss.toFixed(2),
      t.takeProfit.toFixed(2),
      t.pnl !== undefined ? t.pnl.toFixed(2) : '0.00',
      t.pnlPercent !== undefined ? `${t.pnlPercent.toFixed(2)}%` : '0.00%',
      `"${t.status}"`,
      t.conviction,
      t.confidence ? `${(t.confidence * 100).toFixed(1)}%` : '92.0%',
      `"${t.exitReason || (t.status === 'OPEN' ? 'ACTIVE' : 'TAKE_PROFIT')}"`
    ]);

    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const dateStr = new Date().toISOString().slice(0, 10);
    link.setAttribute('href', url);
    link.setAttribute('download', `JevQuant_Trade_History_Report_${dateStr}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleSort = (field: 'timestamp' | 'pnl' | 'entryPrice' | 'conviction') => {
    if (sortField === field) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortOrder('desc');
    }
  };

  return (
    <div className="bg-slate-900/70 p-5 sm:p-6 rounded-2xl border border-slate-800 space-y-5">
      {/* HEADER & ACTIONS */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800/80 pb-4">
        <div>
          <h3 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
            <Clock className="w-5 h-5 text-emerald-400" />
            {title}
          </h3>
          <p className="text-xs text-slate-400 mt-1">{subtitle}</p>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          {/* EXPORT CSV BUTTON */}
          <button
            onClick={exportToCSV}
            className="flex items-center gap-2 px-3.5 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold rounded-xl shadow-lg shadow-emerald-950/40 border border-emerald-400/30 transition-all cursor-pointer active:scale-95"
            title="تصدير الصفقات إلى ملف CSV متوافق مع Excel وجداول Google"
          >
            <Download className="w-4 h-4" />
            <span>تصدير التقرير (CSV)</span>
          </button>
        </div>
      </div>

      {/* SUMMARY BADGES */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
        <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 flex flex-col justify-between">
          <span className="text-slate-400 text-[11px]">إجمالي الصفقات المعروضة</span>
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-lg font-black text-white font-mono">{stats.totalCount}</span>
            <span className="text-[10px] text-slate-500">
              {stats.closedCount} مغلقة / {stats.openCount} مفتوحة
            </span>
          </div>
        </div>

        <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 flex flex-col justify-between">
          <span className="text-slate-400 text-[11px]">نسبة الصفقات الرابحة</span>
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-lg font-black text-emerald-400 font-mono">
              {stats.winRate.toFixed(1)}%
            </span>
            <span className="text-[10px] text-emerald-500/80">
              {stats.winsCount}W / {stats.lossesCount}L
            </span>
          </div>
        </div>

        <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 flex flex-col justify-between">
          <span className="text-slate-400 text-[11px]">صافي الربح التراكمي</span>
          <div className="flex items-baseline justify-between mt-1">
            <span
              className={`text-lg font-black font-mono ${
                stats.totalPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              {stats.totalPnl >= 0 ? `+$${stats.totalPnl.toLocaleString()}` : `-$${Math.abs(stats.totalPnl).toLocaleString()}`}
            </span>
            <span className="text-[10px] text-cyan-400">
              PF: {stats.profitFactor.toFixed(2)}
            </span>
          </div>
        </div>

        <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 flex flex-col justify-between">
          <span className="text-slate-400 text-[11px]">متوسط الربح / الخسارة</span>
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-xs font-mono font-bold text-emerald-400">
              +${stats.avgWin.toFixed(0)}
            </span>
            <span className="text-xs font-mono font-bold text-rose-400">
              -${stats.avgLoss.toFixed(0)}
            </span>
          </div>
        </div>
      </div>

      {/* FILTER & SEARCH TOOLBAR */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 bg-slate-950/60 p-3 rounded-xl border border-slate-800/80 text-xs">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-3.5 h-3.5 text-slate-500 absolute right-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="بحث بمعرف الصفقة، الأصل، أو نوع الأمر..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-slate-900 border border-slate-800 rounded-lg pr-9 pl-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
          />
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Asset filter */}
          <select
            value={assetFilter}
            onChange={(e) => setAssetFilter(e.target.value)}
            className="bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-cyan-500"
          >
            <option value="ALL">جميع العملات (All Assets)</option>
            <option value="BTC/USDT">Bitcoin (BTC)</option>
            <option value="ETH/USDT">Ethereum (ETH)</option>
            <option value="SOL/USDT">Solana (SOL)</option>
          </select>

          {/* Status filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            className="bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-cyan-500"
          >
            <option value="ALL">جميع الحالات</option>
            <option value="CLOSED">مغلقة (Closed)</option>
            <option value="OPEN">مفتوحة حالياً (Active)</option>
          </select>

          {/* Outcome filter */}
          <select
            value={outcomeFilter}
            onChange={(e) => setOutcomeFilter(e.target.value as any)}
            className="bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-cyan-500"
          >
            <option value="ALL">جميع النتائج</option>
            <option value="WIN">صفقات رابحة (Wins)</option>
            <option value="LOSS">صفقات خاسرة (Losses)</option>
          </select>
        </div>
      </div>

      {/* TABLE */}
      <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/40">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-950 text-slate-400 uppercase text-[10px] border-b border-slate-800 tracking-wider">
            <tr>
              <th className="py-3 px-3">المعرف</th>
              <th
                onClick={() => handleSort('timestamp')}
                className="py-3 px-3 cursor-pointer hover:text-white transition-colors"
              >
                <div className="flex items-center gap-1">
                  <span>الوقت / التاريخ</span>
                  <ArrowUpDown className="w-3 h-3 text-slate-500" />
                </div>
              </th>
              <th className="py-3 px-3">الأصل</th>
              <th className="py-3 px-3">نوع العملية</th>
              <th className="py-3 px-3">الفريم</th>
              <th
                onClick={() => handleSort('entryPrice')}
                className="py-3 px-3 cursor-pointer hover:text-white transition-colors"
              >
                <div className="flex items-center gap-1">
                  <span>سعر الدخول</span>
                  <ArrowUpDown className="w-3 h-3 text-slate-500" />
                </div>
              </th>
              <th className="py-3 px-3">سعر الخروج</th>
              <th className="py-3 px-3">مستويات الحماية (SL / TP)</th>
              <th
                onClick={() => handleSort('conviction')}
                className="py-3 px-3 cursor-pointer hover:text-white transition-colors"
              >
                <div className="flex items-center gap-1">
                  <span>درجة القناعة (Conviction)</span>
                  <ArrowUpDown className="w-3 h-3 text-slate-500" />
                </div>
              </th>
              <th
                onClick={() => handleSort('pnl')}
                className="py-3 px-3 cursor-pointer hover:text-white transition-colors"
              >
                <div className="flex items-center gap-1">
                  <span>الربح المحقق (PnL)</span>
                  <ArrowUpDown className="w-3 h-3 text-slate-500" />
                </div>
              </th>
              <th className="py-3 px-3">الحالة / السبب</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/80 font-mono text-slate-300">
            {filteredTrades.length === 0 ? (
              <tr>
                <td colSpan={11} className="py-8 text-center text-slate-500 font-sans">
                  لا توجد صفقات مطابقة لشروط الفرز الحالية
                </td>
              </tr>
            ) : (
              filteredTrades.map((t) => {
                const isWin = (t.pnl ?? 0) > 0;
                const isLoss = (t.pnl ?? 0) < 0;

                return (
                  <tr key={t.id} className="hover:bg-slate-800/30 transition-colors">
                    {/* ID */}
                    <td className="py-3 px-3 text-slate-400 font-bold">{t.id}</td>

                    {/* Timestamp */}
                    <td className="py-3 px-3 text-slate-300 whitespace-nowrap">
                      {t.timestamp}
                    </td>

                    {/* Asset */}
                    <td className="py-3 px-3 font-sans font-bold text-white whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-cyan-400"></span>
                        {t.asset}
                      </div>
                    </td>

                    {/* Type */}
                    <td className="py-3 px-3 whitespace-nowrap">
                      <span
                        className={`px-2 py-0.5 rounded font-sans text-[11px] font-bold ${
                          t.type.includes('BUY') || t.type.includes('شراء')
                            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                            : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                        }`}
                      >
                        {t.type}
                      </span>
                    </td>

                    {/* Timeframe */}
                    <td className="py-3 px-3 text-slate-300 font-bold">{t.timeframe}</td>

                    {/* Entry */}
                    <td className="py-3 px-3 text-white">
                      ${t.entryPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </td>

                    {/* Exit */}
                    <td className="py-3 px-3">
                      {t.exitPrice ? (
                        <span className="text-slate-200">
                          ${t.exitPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </span>
                      ) : (
                        <span className="text-slate-500 italic">قيد التنفيذ...</span>
                      )}
                    </td>

                    {/* SL / TP */}
                    <td className="py-3 px-3 text-[11px] text-slate-400 whitespace-nowrap">
                      <span className="text-rose-400">SL: ${t.stopLoss}</span>
                      <span className="text-slate-600 mx-1">|</span>
                      <span className="text-emerald-400">TP: ${t.takeProfit}</span>
                    </td>

                    {/* Conviction */}
                    <td className="py-3 px-3">
                      <div className="flex items-center gap-1 font-sans">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            t.conviction >= 3
                              ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                              : t.conviction === 2
                              ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30'
                              : 'bg-slate-800 text-slate-300'
                          }`}
                        >
                          المستوى {t.conviction} ({t.conviction === 3 ? 'High' : t.conviction === 2 ? 'Medium' : 'Standard'})
                        </span>
                      </div>
                    </td>

                    {/* PnL */}
                    <td className="py-3 px-3 font-bold whitespace-nowrap">
                      {t.status === 'CLOSED' ? (
                        <span
                          className={`flex items-center gap-1 ${
                            isWin ? 'text-emerald-400' : isLoss ? 'text-rose-400' : 'text-slate-300'
                          }`}
                        >
                          {isWin ? (
                            <TrendingUp className="w-3.5 h-3.5" />
                          ) : isLoss ? (
                            <TrendingDown className="w-3.5 h-3.5" />
                          ) : null}
                          {isWin ? '+' : ''}${t.pnl?.toLocaleString(undefined, { minimumFractionDigits: 2 })}{' '}
                          <span className="text-[10px]">
                            ({isWin ? '+' : ''}{t.pnlPercent?.toFixed(2)}%)
                          </span>
                        </span>
                      ) : (
                        <span className="text-cyan-400 flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping"></span>
                          صفقة مفتوحة
                        </span>
                      )}
                    </td>

                    {/* Status & Exit Reason */}
                    <td className="py-3 px-3 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-sans font-bold ${
                            t.status === 'CLOSED'
                              ? 'bg-slate-800 text-slate-300'
                              : 'bg-cyan-500/10 text-cyan-400 animate-pulse border border-cyan-500/30'
                          }`}
                        >
                          {t.status}
                        </span>
                        {t.exitReason && (
                          <span className="text-[10px] text-slate-500 font-sans">
                            {t.exitReason === 'TAKE_PROFIT' ? '🎯 TP Hit' : t.exitReason === 'STOP_LOSS' ? '🛑 SL Hit' : t.exitReason === 'TRAILING_PROFIT' ? '📈 Trailing' : ''}
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* FOOTER INFO */}
      <div className="flex flex-col sm:flex-row items-center justify-between text-[11px] text-slate-500 pt-2 border-t border-slate-800/80 gap-2">
        <div className="flex items-center gap-1.5">
          <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" />
          <span>ملف الـ CSV يتضمن ترميز UTF-8 مع BOM لضمان العرض التلقائي السليم للأحرف في Microsoft Excel.</span>
        </div>
        <div className="font-mono text-slate-400">
          عرض {filteredTrades.length} من أصل {trades.length} صفقة
        </div>
      </div>
    </div>
  );
};
