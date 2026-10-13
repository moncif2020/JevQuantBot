import React, { useState } from 'react';
import {
  Send,
  Bell,
  CheckCircle2,
  AlertCircle,
  Smartphone,
  ShieldCheck,
  Zap,
  TrendingUp,
  TrendingDown,
  Eye,
  EyeOff,
  Copy,
  Check,
  ExternalLink,
  MessageSquare,
  Sparkles,
  Info
} from 'lucide-react';

export interface TelegramConfig {
  botToken: string;
  chatId: string;
  notifyEntry: boolean;
  notifyWin: boolean;
  notifyLoss: boolean;
  notifyRegime: boolean;
}

interface TelegramAlertsPanelProps {
  config: TelegramConfig;
  onUpdateConfig: (newConfig: TelegramConfig) => void;
  selectedAsset: string;
  currentPrice: number;
}

export const TelegramAlertsPanel: React.FC<TelegramAlertsPanelProps> = ({
  config,
  onUpdateConfig,
  selectedAsset,
  currentPrice,
}) => {
  const [showToken, setShowToken] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [activePreview, setActivePreview] = useState<'entry' | 'win' | 'loss' | 'summary'>('win');

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Pre-formatted messages for testing and preview (Pure Binance Spot Standard)
  const generateMessage = (type: 'entry' | 'win' | 'loss' | 'summary') => {
    const time = new Date().toLocaleTimeString();
    switch (type) {
      case 'entry':
        return `🟢 <b>[JevQuant Spot] أمر شراء وتجميع فوري</b>
━━━━━━━━━━━━━━━━━━━━
السوق:       <b>Binance Spot (بدون رافعة)</b>
الأصل:       <b>#${selectedAsset.replace('/', '')} (15m)</b>
سعر الشراء:  <b>$${currentPrice.toLocaleString()}</b>
وقف الكاش:   <b>$${(currentPrice * 0.982).toFixed(2)} (-1.8%)</b> 🛡️
هدف البيع:   <b>$${(currentPrice * 1.042).toFixed(2)} (+4.2%)</b> 🎯
يقين Jev:    <b>Level 2 (ثقة: 94%)</b>
حجم الكاش:   <b>50% من رصيد USDT المتاح</b>
الوقت:       <b>${time}</b>`;

      case 'win':
        return `✅ <b>[JevQuant Spot] تحقيق الهدف والبيع للكاش بنجاح!</b> 🎯
━━━━━━━━━━━━━━━━━━━━
الأصل:       <b>#${selectedAsset.replace('/', '')}</b>
العملية:     <b>بيع كامل إلى 100% USDT كاش</b> 🚀
صافي الربح:  <b>+$580.00 USDT (+3.95%)</b>
سعر الشراء:  <b>$${(currentPrice * 0.96).toFixed(2)}</b>
سعر البيع:   <b>$${currentPrice.toLocaleString()}</b>
معامل العائد: <b>1:2.3 R:R المحقق</b>
رصيد المحفظة: <b>$14,320.50 (+43.2% إجمالي)</b>`;

      case 'loss':
        return `🛑 <b>[JevQuant Spot] تفعيل صمام الأمان والتحول للكاش</b>
━━━━━━━━━━━━━━━━━━━━
الأصل:       <b>#${selectedAsset.replace('/', '')}</b>
العملية:     <b>بيع فوري إلى 100% USDT لحماية رأس المال</b>
صافي الأثر:  <b>-$145.00 USDT (-1.0%)</b>
سعر الشراء:  <b>$${(currentPrice * 1.018).toFixed(2)}</b>
سعر الخروج:  <b>$${currentPrice.toLocaleString()}</b>
ملاحظة:      <b>تجنب هبوط إضافي - لا يوجد أي خطر تصفية</b>`;

      case 'summary':
        return `📊 <b>[JevQuant Spot] تقرير حالة السوق والذكاء الاصطناعي</b>
━━━━━━━━━━━━━━━━━━━━
سوق التداول: <b>Binance Spot الفوري</b>
حالة السوق:  <b>BULLISH_TREND (صاعد قوي)</b>
أصل التركيز: <b>#${selectedAsset}</b>
السعر الحالي: <b>$${currentPrice.toLocaleString()}</b>
توافق الفريمات: <b>مؤكد عبر 1h و 4h (P = 0.91)</b>
حالة المحفظة: <b>مستقرة في الأصول الصاعدة وتتحول للكاش في الهبوط</b>`;
    }
  };

  // Send real alert through server proxy /api/telegram/send
  const sendTestAlert = async (type: 'entry' | 'win' | 'loss' | 'summary') => {
    setActivePreview(type);
    if (!config.botToken || !config.chatId) {
      setStatusMessage({
        type: 'error',
        text: 'يرجى إدخال Bot Token و Chat ID أولاً لإرسال إشعار حقيقي إلى تيليجرام.',
      });
      setTimeout(() => setStatusMessage(null), 5000);
      return;
    }

    setIsSending(true);
    setStatusMessage(null);

    try {
      const msg = generateMessage(type);
      const res = await fetch('/api/telegram/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          botToken: config.botToken.trim(),
          chatId: config.chatId.trim(),
          message: msg,
          parseMode: 'HTML',
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setStatusMessage({
          type: 'success',
          text: 'تم إرسال الإشعار بنجاح إلى هاتفك عبر تيليجرام! تفقد تطبيق تيليجرام الآن.',
        });
      } else {
        setStatusMessage({
          type: 'error',
          text: `فشل الإرسال: ${data.error || 'تأكد من صحة التوكن ورقم الـ Chat ID واضغط Start للبوت'}`
        });
      }
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text: `خطأ في الاتصال: ${err.message}`
      });
    } finally {
      setIsSending(false);
      setTimeout(() => setStatusMessage(null), 6000);
    }
  };

  return (
    <div className="space-y-6">
      {/* HEADER BANNER */}
      <div className="bg-slate-900/80 p-6 rounded-2xl border border-slate-800 shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-2 rounded-xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
              <Send className="w-5 h-5" />
            </span>
            <h2 className="text-lg font-bold text-white tracking-tight">
              ربط إشعارات تيليجرام الفورية (Telegram Live Telemetry)
            </h2>
          </div>
          <p className="text-xs text-slate-400 mt-1 max-w-2xl leading-relaxed">
            استقبل تنبيهات فورية على هاتفك المحمول عند فتح أي صفقة جديدة، وعند تحقيق الهدف والربح، أو عند ضرب وقف الخسارة لحماية رأس مالك، بالإضافة لتقارير دورية عن حالة السوق.
          </p>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <div className="px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-300 font-mono">
            <span>الحالة: </span>
            {config.botToken && config.chatId ? (
              <strong className="text-emerald-400">متصل وجاهز للإرسال ✓</strong>
            ) : (
              <strong className="text-amber-400">بانتظار إدخال المفاتيح</strong>
            )}
          </div>
        </div>
      </div>

      {/* 3-STEP VIBE CODER GUIDE */}
      <div className="bg-slate-900/60 p-5 rounded-2xl border border-slate-800">
        <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider mb-3 flex items-center gap-1.5">
          <Sparkles className="w-4 h-4 text-cyan-400" />
          طريقة الحصول على المفاتيح في دقيقة واحدة (بدون أي برمجة):
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
          {/* STEP 1 */}
          <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="font-bold text-cyan-400 font-mono">الخطوة 1: إنشاء البوت</span>
              <span className="text-[10px] text-slate-500">15 ثانية</span>
            </div>
            <p className="text-slate-400 leading-relaxed">
              افتح تطبيق تيليجرام وابحث عن الحساب الرسمي:
              <strong className="text-white block font-mono">@BotFather</strong>
              أرسل له الأمر <code className="text-cyan-300">/newbot</code> واختر اسماً للبوت، وسيعطيك الـ <strong>API Token</strong> مباشرة.
            </p>
          </div>

          {/* STEP 2 */}
          <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="font-bold text-emerald-400 font-mono">الخطوة 2: معرف المحادثة</span>
              <span className="text-[10px] text-slate-500">10 ثوانٍ</span>
            </div>
            <p className="text-slate-400 leading-relaxed">
              افتح بوتك الجديد واضغط على <strong>Start</strong>. ثم افتح البوت المساعد:
              <strong className="text-white block font-mono">@userinfobot</strong>
              سيرسل لك رقمك التعريفي <strong>Id</strong> (مثال: <span className="text-emerald-300 font-mono">987654321</span>).
            </p>
          </div>

          {/* STEP 3 */}
          <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="font-bold text-amber-400 font-mono">الخطوة 3: اللصق والتفعيل</span>
              <span className="text-[10px] text-slate-500">فوري</span>
            </div>
            <p className="text-slate-400 leading-relaxed">
              ألصق الـ <strong>Token</strong> والـ <strong>Chat ID</strong> في الحقول أدناه، واضغط على زر "اختبار إرسال إشعار" لتصلك أول رسالة على هاتفك فوراً!
            </p>
          </div>
        </div>
      </div>

      {/* TWO COLUMNS: CONFIGURATION & SMARTPHONE SIMULATOR */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* LEFT COLUMN: SETTINGS FORM (7 COLS) */}
        <div className="lg:col-span-7 space-y-5 bg-slate-900/60 p-5 rounded-2xl border border-slate-800">
          <h3 className="font-bold text-sm text-white flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            إعدادات مفاتيح تيليجرام
          </h3>

          {/* INPUTS */}
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300 flex items-center justify-between">
                <span>Telegram Bot Token</span>
                <span className="text-[10px] text-slate-500">من @BotFather</span>
              </label>
              <div className="relative">
                <input
                  type={showToken ? 'text' : 'password'}
                  value={config.botToken}
                  onChange={(e) => onUpdateConfig({ ...config, botToken: e.target.value })}
                  placeholder="مثال: 7281938219:AAEfK9Z08Yw3s..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs font-mono text-slate-200 focus:outline-none focus:border-cyan-500 pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowToken(!showToken)}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                >
                  {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300 flex items-center justify-between">
                <span>Telegram Chat ID</span>
                <span className="text-[10px] text-slate-500">من @userinfobot</span>
              </label>
              <input
                type="text"
                value={config.chatId}
                onChange={(e) => onUpdateConfig({ ...config, chatId: e.target.value })}
                placeholder="مثال: 948271032"
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs font-mono text-slate-200 focus:outline-none focus:border-cyan-500"
              />
            </div>
          </div>

          {/* NOTIFICATION PREFERENCES TOGGLES */}
          <div className="space-y-2 pt-2 border-t border-slate-800">
            <span className="text-xs font-bold text-slate-300 block mb-2">تخصيص أنواع الإشعارات المرسلة:</span>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <label className="flex items-center justify-between p-3 rounded-xl bg-slate-950 border border-slate-800 cursor-pointer hover:border-slate-700 transition-all">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-cyan-400"></span>
                  <span className="text-xs text-slate-200 font-medium">إشعار فتح صفقة جديدة</span>
                </div>
                <input
                  type="checkbox"
                  checked={config.notifyEntry}
                  onChange={(e) => onUpdateConfig({ ...config, notifyEntry: e.target.checked })}
                  className="rounded border-slate-700 text-cyan-500 focus:ring-0 cursor-pointer"
                />
              </label>

              <label className="flex items-center justify-between p-3 rounded-xl bg-slate-950 border border-slate-800 cursor-pointer hover:border-slate-700 transition-all">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                  <span className="text-xs text-slate-200 font-medium">إشعار الصفقات الرابحة (TP)</span>
                </div>
                <input
                  type="checkbox"
                  checked={config.notifyWin}
                  onChange={(e) => onUpdateConfig({ ...config, notifyWin: e.target.checked })}
                  className="rounded border-slate-700 text-emerald-500 focus:ring-0 cursor-pointer"
                />
              </label>

              <label className="flex items-center justify-between p-3 rounded-xl bg-slate-950 border border-slate-800 cursor-pointer hover:border-slate-700 transition-all">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-rose-400"></span>
                  <span className="text-xs text-slate-200 font-medium">إشعار وقف الخسارة (SL)</span>
                </div>
                <input
                  type="checkbox"
                  checked={config.notifyLoss}
                  onChange={(e) => onUpdateConfig({ ...config, notifyLoss: e.target.checked })}
                  className="rounded border-slate-700 text-rose-500 focus:ring-0 cursor-pointer"
                />
              </label>

              <label className="flex items-center justify-between p-3 rounded-xl bg-slate-950 border border-slate-800 cursor-pointer hover:border-slate-700 transition-all">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-purple-400"></span>
                  <span className="text-xs text-slate-200 font-medium">تقرير حالة السوق والاتجاه</span>
                </div>
                <input
                  type="checkbox"
                  checked={config.notifyRegime}
                  onChange={(e) => onUpdateConfig({ ...config, notifyRegime: e.target.checked })}
                  className="rounded border-slate-700 text-purple-500 focus:ring-0 cursor-pointer"
                />
              </label>
            </div>
          </div>

          {/* STATUS NOTIFICATION TOAST */}
          {statusMessage && (
            <div
              className={`p-3.5 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all ${
                statusMessage.type === 'success'
                  ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/30'
                  : 'bg-rose-500/10 text-rose-300 border border-rose-500/30'
              }`}
            >
              {statusMessage.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
              ) : (
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
              )}
              <span>{statusMessage.text}</span>
            </div>
          )}

          {/* DISPATCH TEST BUTTONS */}
          <div className="pt-2 border-t border-slate-800 space-y-2">
            <span className="text-xs font-bold text-slate-300 block">اختبار الإرسال المباشر على هاتفك:</span>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <button
                onClick={() => sendTestAlert('entry')}
                disabled={isSending}
                className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-cyan-500/30 text-xs font-semibold transition-all cursor-pointer text-center"
              >
                تجربة فتح صفقة
              </button>
              <button
                onClick={() => sendTestAlert('win')}
                disabled={isSending}
                className="px-3 py-2 rounded-xl bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-xs font-bold transition-all cursor-pointer text-center"
              >
                تجربة صفقة رابحة 🎯
              </button>
              <button
                onClick={() => sendTestAlert('loss')}
                disabled={isSending}
                className="px-3 py-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 text-xs font-bold transition-all cursor-pointer text-center"
              >
                تجربة وقف الخسارة 🛑
              </button>
              <button
                onClick={() => sendTestAlert('summary')}
                disabled={isSending}
                className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-purple-300 border border-purple-500/30 text-xs font-semibold transition-all cursor-pointer text-center"
              >
                تجربة تقرير السوق 📊
              </button>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: SMARTPHONE MOCKUP & LIVE TELEGRAM PREVIEW (5 COLS) */}
        <div className="lg:col-span-5 flex flex-col items-center justify-center">
          <div className="w-full max-w-sm rounded-[2.5rem] bg-slate-950 border-4 border-slate-800 p-3 shadow-2xl relative">
            {/* PHONE SPEAKER & CAMERA NOTCH */}
            <div className="w-28 h-4 bg-slate-900 rounded-full mx-auto mb-3 flex items-center justify-center">
              <div className="w-3 h-3 rounded-full bg-slate-950 mr-2"></div>
              <div className="w-10 h-1.5 bg-slate-800 rounded-full"></div>
            </div>

            {/* TELEGRAM HEADER */}
            <div className="bg-[#17212b] rounded-t-2xl px-3.5 py-2.5 flex items-center justify-between border-b border-slate-800/80">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-500 to-cyan-600 flex items-center justify-center text-white font-black text-xs shadow">
                  J
                </div>
                <div>
                  <div className="flex items-center gap-1">
                    <span className="text-xs font-bold text-white">JevQuant Bot</span>
                    <span className="text-[10px] text-cyan-400">✓</span>
                  </div>
                  <span className="text-[10px] text-slate-400 block -mt-0.5">bot · online</span>
                </div>
              </div>
              <span className="text-[10px] text-slate-400">تيليجرام</span>
            </div>

            {/* CHAT MESSAGES BODY */}
            <div className="bg-[#0e1621] p-3 space-y-3 min-h-[340px] max-h-[380px] overflow-y-auto text-xs rounded-b-2xl">
              {/* DATE SEPARATOR */}
              <div className="text-center">
                <span className="bg-[#182533] text-slate-400 text-[10px] px-2.5 py-0.5 rounded-full">
                  اليوم
                </span>
              </div>

              {/* MESSAGE BUBBLE */}
              <div className="bg-[#182533] text-slate-100 p-3 rounded-2xl rounded-tl-sm border border-slate-700/50 shadow-md space-y-1.5 text-right font-sans">
                <div
                  className="font-mono text-[11px] leading-relaxed whitespace-pre-wrap"
                  dangerouslySetInnerHTML={{
                    __html: generateMessage(activePreview),
                  }}
                />
                <div className="flex justify-end items-center gap-1 text-[9px] text-slate-400 pt-1">
                  <span>{new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  <span className="text-cyan-400">✓✓</span>
                </div>
              </div>

              {/* PREVIEW SWITCHER PILLS INSIDE MOCKUP */}
              <div className="pt-2 flex flex-wrap gap-1 justify-center">
                {[
                  { id: 'win', label: 'صفقة رابحة' },
                  { id: 'entry', label: 'فتح صفقة' },
                  { id: 'loss', label: 'وقف خسارة' },
                  { id: 'summary', label: 'ملخص السوق' },
                ].map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setActivePreview(p.id as any)}
                    className={`text-[10px] px-2 py-0.5 rounded-md font-semibold transition-all ${
                      activePreview === p.id
                        ? 'bg-cyan-500 text-slate-950'
                        : 'bg-slate-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {/* PHONE BOTTOM BAR */}
            <div className="w-32 h-1 bg-slate-800 rounded-full mx-auto mt-3"></div>
          </div>
          <span className="text-[11px] text-slate-500 mt-2">معاينة حية لشكل الإشعار على هاتفك</span>
        </div>
      </div>
    </div>
  );
};
