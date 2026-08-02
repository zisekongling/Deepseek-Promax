/**
 * 循环引擎模块 (Loop Engine) v2.0
 *
 * 灵感来源：Ghost in the Loop v8.7.0
 *
 * 完整功能：
 *   1. 自动循环对话 — 检测 AI 回复完成，根据信号自动继续
 *   2. 信号检测 — [[GITL::PROCEED]] / [[GITL::HALT]] + 模糊匹配 + 自定义关键词
 *   3. 防自动化延迟 — 8-15 秒随机延迟（首轮 2 秒）
 *   4. 崩溃恢复 — 状态持久化到 localStorage
 *   5. 桌面通知 — 循环完成/暂停/出错时通知
 *   6. Soft Proceed — AI 未输出 sigil 时自动重申协议（最多 2 次）
 *   7. Drift Guard + Reground — 轮次上限软暂停 + 重新锚定到原始任务
 *   8. Send Confirmation Watchdog — 发送后独立验证投递（9 秒窗口）
 *   9. Tab Lock — 多标签页锁，防止冲突发送
 *  10. Reply Baseline — 发送前记录回复基线，防止误判旧回复为终端信号
 *  11. Unattended Mode — 无人值守模式（允许后台标签页运行）
 *  12. Web Worker Ticker — 防止后台标签页 setInterval 节流
 *
 * 状态机：IDLE → RUNNING → (PAUSED | COMPLETE | LIMIT | UNCERTAIN)
 */

import { CONFIG } from '../config.js';
import { utils } from '../utils.js';

/* ═══════════════════════════════════════════════════
   常量定义
   ═══════════════════════════════════════════════════ */

/** 信号标记 */
const SIGIL_PROCEED = '[[GITL::PROCEED]]';
const SIGIL_HALT = '[[GITL::HALT]]';
const SIGIL_ROADMAP = '[[GITL::ROADMAP]]';

/** 遗留关键词 */
const LEGACY_PROCEED = 'PROCEED';
const LEGACY_HALT = 'SYSTEM_HALT';

/** 最小回复长度（短于此认为回复未完成） */
const MIN_RESPONSE_LEN = 50;

/** 循环引擎 tick 间隔（毫秒） */
const TICK_INTERVAL = 2500;

/** 防自动化延迟范围（毫秒） */
const DELAY_FIRST_ROUND = 2000;
const DELAY_MIN = 8000;
const DELAY_MAX = 15000;

/** 看门狗超时（毫秒） */
const WATCHDOG_SOFT = 90000;
const WATCHDOG_HARD = 180000;

/** 默认最大轮次 */
const DEFAULT_MAX_ROUNDS = 20;

/** 软暂停时单次延长轮次 */
const LIMIT_STEP = 20;

/** 发送确认窗口（毫秒）— 发送后必须在此时间内观察到投递证据 */
const SEND_CONFIRM_MS = 9000;

/** 软继续（无 sigil）最大次数 */
const SOFT_PROCEED_MAX = 2;

/** 模糊匹配关键词 */
const FUZZY_PROCEED = [
    'to proceed', 'shall i continue', 'should i continue', 'want me to continue',
    'ready for the next', "type 'continue'", 'type "continue"', 'type continue',
    'say continue', 'continue?', 'next section?', 'go on?', 'ready to proceed',
    'awaiting your', '需要我继续', '是否继续', '继续吗'
];

const FUZZY_HALT = [
    'task complete', 'all sections complete', 'all parts complete', 'that concludes',
    'this concludes', 'fully complete', 'everything is complete', 'all done',
    'sequence complete', 'final section complete', 'session complete',
    '任务完成', '全部完成', '已完成'
];

/** DeepSeek 选择器 */
const SELECTORS = {
    input: 'textarea#chat-input, textarea[placeholder], textarea',
    send: 'div[class*="send"] > div[role="button"], div[role="button"][class*="send"], button[class*="send"]',
    stop: 'div[class*="stop"] > div[role="button"], div[role="button"][class*="stop"], button[class*="stop"]',
    assistant: 'div[class*="ds-markdown"], div[class*="markdown"]'
};

/** 持久化键 */
const STORAGE_KEY = 'ds_loop_engine_state';
const TAB_LOCK_KEY_PREFIX = 'ds_loop_tab_lock:';
const SEND_TIER_KEY_PREFIX = 'ds_loop_send_tier:';

/* ═══════════════════════════════════════════════════
   循环引擎状态
   ═══════════════════════════════════════════════════ */

/** 循环引擎状态对象 */
const engine = {
    state: 'IDLE',           // IDLE | RUNNING | PAUSED | COMPLETE | LIMIT | UNCERTAIN
    round: 0,                // 当前轮次
    maxRounds: DEFAULT_MAX_ROUNDS,
    limitStep: LIMIT_STEP,
    phase: 'idle',           // idle | generating | reading | countdown | dispatching | decision | confirming | error | paused
    detail: '',              // 状态详情文本
    lastActivity: 0,         // 最后活动时间戳
    lastSignal: 'none',      // none | proceed | halt | short
    lastConfidence: 0,
    lastProgress: null,      // {step, total, desc}
    originalTask: '',        // 原始任务文本（用于 reground）
    replyKey: '',            // 回复指纹（用于检测稳定性）
    replyStableTicks: 0,     // 稳定 tick 数
    replyBaseline: null,     // 发送前的回复基线 {assistantCount, assistantTextLength, assistantTail}
    staleTicks: 0,           // 过期 tick 数
    noSigilStreak: 0,        // 连续无 sigil 回复次数
    _nudgedTail: '',         // 上次软继续时的回复尾部（防止重复触发）
    _thinkNoted: false,      // 是否已记录"思考中"状态
    countdownUntil: 0,       // 倒计时结束时间
    isSending: false,        // 是否正在发送
    timer: null,             // tick 定时器
    payloadMode: 'loop',     // loop | think | roadmap
    posture: 'standard',     // standard | evolving | extended
    needsPayload: true,      // 是否需要初始 payload
    // 发送事务（at-most-once send）
    sendPending: false,      // 是否有未确认的发送
    sendDeadline: 0,         // 发送确认截止时间
    sendTxn: null,           // 当前发送事务 {id, state, path, attemptedAt, ...}
    // 漂移防护
    driftEnabled: true,      // 是否启用漂移防护（轮次上限）
    // 无人值守
    unattended: false        // 是否允许后台运行
};

/* ═══════════════════════════════════════════════════
   Web Worker Ticker — 防止后台标签页节流
   ═══════════════════════════════════════════════════ */

const Ticker = {
    _worker: null,
    _iv: null,
    mode: 'none',

    /**
     * 启动 ticker
     * @param {Function} fn - tick 回调
     * @param {number} ms - 间隔毫秒
     * @returns {string} 模式：worker | interval
     */
    start(fn, ms) {
        this.stop();
        // 仅在无人值守模式下尝试使用 Worker（避免不必要的开销）
        if (engine.unattended && typeof Worker !== 'undefined' && typeof Blob !== 'undefined') {
            try {
                const code = 'let i=null;onmessage=e=>{if(e.data&&e.data.cmd==="start"){if(i)clearInterval(i);i=setInterval(()=>postMessage("t"),e.data.ms);}else{clearInterval(i);i=null;}};';
                const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
                this._worker = new Worker(url);
                URL.revokeObjectURL(url);
                this._worker.onmessage = () => {
                    try { fn(); } catch (e) { console.warn('[LoopEngine] tick error:', e); }
                };
                this._worker.postMessage({ cmd: 'start', ms });
                this.mode = 'worker';
                return 'worker';
            } catch (e) {
                console.warn('[LoopEngine] Worker ticker 不可用，回退到 setInterval:', e);
                this._worker = null;
            }
        }
        this._iv = setInterval(fn, ms);
        this.mode = 'interval';
        return 'interval';
    },

    /** 停止 ticker */
    stop() {
        if (this._worker) {
            try {
                this._worker.postMessage({ cmd: 'stop' });
                this._worker.terminate();
            } catch (_) {}
            this._worker = null;
        }
        if (this._iv) {
            clearInterval(this._iv);
            this._iv = null;
        }
        this.mode = 'none';
    }
};

/* ═══════════════════════════════════════════════════
   信号检测引擎（纯逻辑，无 DOM）
   ═══════════════════════════════════════════════════ */

/**
 * 解析进度信息
 * 匹配 [Step X of Y] 或 [Stage X/Y] 格式
 * @param {string} text - 回复文本
 * @returns {{step:number,total:number,desc:string}|null}
 */
function parseProgress(text) {
    const m = text.match(/\[(?:Step|Batch|Stage)\s*(\d+)\s*(?:of|\/)\s*(\d+)\](?:\s*[—–\-]\s*(.+))?/i);
    return m ? { step: +m[1], total: +m[2], desc: (m[3] || '').trim() } : null;
}

/**
 * 信号检测 — 分析 AI 回复文本的尾部，判断是 PROCEED 还是 HALT
 *
 * 评分规则：
 *   - 精确信号 [[GITL::PROCEED]] / [[GITL::HALT]]: +4 分
 *   - 遗留关键词 PROCEED / SYSTEM_HALT: +3 分（仅当 sigil 未匹配时）
 *   - 模糊匹配: +2 分
 *   - 自定义关键词: +2 分
 *   - 进度条 [Step X of Y] (X<Y): +2 分 proceed; (X>=Y): +1 分 halt
 *
 * HALT 优先：平局时 HALT 获胜
 *
 * @param {string} fullText - AI 的完整回复文本
 * @returns {{signal:string,confidence:number,progress:object|null}}
 */
export function detectSignal(fullText) {
    if (!fullText || fullText.length < MIN_RESPONSE_LEN) {
        return { signal: 'short', confidence: 0, progress: null };
    }

    const tail = fullText.slice(-2000);
    const low = tail.toLowerCase();

    // 自定义关键词（来自 CONFIG）
    const cProc = (CONFIG.customProceed || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    const cStop = (CONFIG.customStop || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

    let hScore = 0, pScore = 0;
    const progress = parseProgress(tail);

    // 精确信号（最高权重）
    if (tail.includes(SIGIL_HALT))    hScore += 4;
    if (tail.includes(SIGIL_PROCEED)) pScore += 4;

    // 遗留关键词（仅在信号未匹配时计分，避免子串重复计数）
    if (!tail.includes(SIGIL_HALT)    && tail.includes(LEGACY_HALT))    hScore += 3;
    if (!tail.includes(SIGIL_PROCEED) && tail.includes(LEGACY_PROCEED)) pScore += 3;

    // 模糊匹配
    if (FUZZY_HALT.some(p => low.includes(p)))    hScore += 2;
    if (FUZZY_PROCEED.some(p => low.includes(p))) pScore += 2;

    // 自定义关键词
    if (cStop.some(p => low.includes(p)))  hScore += 2;
    if (cProc.some(p => low.includes(p)))  pScore += 2;

    // 进度条
    if (progress && progress.step < progress.total) pScore += 2;
    if (progress && progress.step >= progress.total) hScore += 1;

    // HALT 优先：平局时 HALT 获胜
    if (hScore >= 3 && hScore >= pScore) return { signal: 'halt', confidence: hScore, progress };
    if (pScore >= 3) return { signal: 'proceed', confidence: pScore, progress };

    return { signal: 'unknown', confidence: Math.max(hScore, pScore), progress };
}

/* ═══════════════════════════════════════════════════
   DeepSeek 平台适配层
   ═══════════════════════════════════════════════════ */

/**
 * 查询选择器匹配的第一个元素
 * @param {string} selector - CSS 选择器
 * @returns {Element|null}
 */
function _q(selector) {
    try { return document.querySelector(selector); } catch (_) { return null; }
}

/**
 * 查询选择器匹配的所有元素
 * @param {string} selector - CSS 选择器
 * @returns {Element[]}
 */
function _qAll(selector) {
    try { return [...document.querySelectorAll(selector)]; } catch (_) { return []; }
}

/**
 * 获取输入框元素
 * @returns {Element|null}
 */
function getInput() {
    return _q(SELECTORS.input);
}

/**
 * 获取发送按钮
 * @returns {Element|null}
 */
function getSendBtn() {
    return _q(SELECTORS.send);
}

/**
 * 获取停止按钮
 * @returns {Element|null}
 */
function getStopBtn() {
    return _q(SELECTORS.stop);
}

/**
 * 获取所有 AI 回复容器
 * @returns {Element[]}
 */
function getAssistantMessages() {
    return _qAll(SELECTORS.assistant);
}

/**
 * 获取最后一条 AI 回复的文本
 * @returns {string}
 */
function getLastReplyText() {
    const msgs = getAssistantMessages();
    if (!msgs.length) return '';
    const last = msgs[msgs.length - 1];
    return (last.innerText || last.textContent || '').trim();
}

/**
 * 检查 AI 是否正在生成回复
 * @returns {boolean} - 如果停止按钮可见，表示正在生成
 */
function isGenerating() {
    const stop = getStopBtn();
    if (!stop) return false;
    const style = window.getComputedStyle(stop);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    if (stop.offsetWidth === 0 || stop.offsetHeight === 0) return false;
    return true;
}

/**
 * 获取输入框当前文本
 * @returns {string}
 */
function getInputText() {
    const input = getInput();
    if (!input) return '';
    const tag = input.tagName.toUpperCase();
    return (tag === 'TEXTAREA' || tag === 'INPUT' ? input.value : input.textContent || '').trim();
}

/**
 * 规范化文本以便比较（去除零宽字符 + 折叠空白）
 * @param {string} text - 文本
 * @returns {string}
 */
function _normalizeStagedText(text) {
    return String(text || '')
        .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * 读取输入框文本（用于发送验证）
 * @param {Element} el - 输入框元素
 * @returns {string}
 */
function _composerText(el) {
    if (!el) return '';
    const tag = String(el.tagName || '').toUpperCase();
    const text = tag === 'TEXTAREA' || tag === 'INPUT' ? el.value : el.textContent;
    return String(text || '').trim();
}

/**
 * 验证输入框中是否完整保留了预期文本
 * @param {Element} input - 输入框元素
 * @param {string} expectedText - 预期文本
 * @returns {boolean}
 */
function _promptStagedInComposer(input, expectedText) {
    if (!input || input.isConnected === false) return false;
    const expected = _normalizeStagedText(expectedText);
    if (!expected) return false;
    return _normalizeStagedText(_composerText(input)) === expected;
}

/**
 * 向输入框注入文本（React 兼容）
 * @param {Element} input - 输入框元素
 * @param {string} text - 要注入的文本
 * @returns {boolean} - 是否注入成功
 */
function injectText(input, text) {
    if (!input) return false;
    try {
        const tag = input.tagName.toUpperCase();
        if (tag === 'TEXTAREA' || tag === 'INPUT') {
            // 使用 React 兼容的方式设置值
            const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
                window.HTMLTextAreaElement.prototype, 'value'
            )?.set || Object.getOwnPropertyDescriptor(
                window.HTMLInputElement.prototype, 'value'
            )?.set;
            if (nativeInputValueSetter) {
                nativeInputValueSetter.call(input, text);
            } else {
                input.value = text;
            }
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
        }
        // contenteditable 元素
        input.focus();
        input.textContent = text;
        input.dispatchEvent(new InputEvent('input', { bubbles: true, data: text }));
        return true;
    } catch (e) {
        console.warn('[LoopEngine] injectText 失败:', e);
        return false;
    }
}

/* ═══════════════════════════════════════════════════
   Tab Lock — 多标签页冲突防护
   ═══════════════════════════════════════════════════ */

const TAB_ID = (crypto.randomUUID?.() || `tab-${Date.now()}-${Math.random().toString(16).slice(2)}`);
let _tabLockInterval = null;

/**
 * 生成当前标签页路径的锁定键
 * @returns {string}
 */
function _tabLockKey() {
    return TAB_LOCK_KEY_PREFIX + location.hostname + ':' + location.pathname.split('/').slice(0, 3).join('/');
}

/**
 * 尝试获取标签页锁（8 秒有效期）
 * @returns {boolean} - 是否获取成功
 */
function claimTabLock() {
    const key = _tabLockKey();
    const now = Date.now();
    try {
        const raw = localStorage.getItem(key);
        const lock = raw ? JSON.parse(raw) : null;
        if (lock && lock.tabId !== TAB_ID && (now - lock.ts < 8000)) {
            return false; // 另一个标签页持有锁
        }
    } catch (_) {}
    try {
        localStorage.setItem(key, JSON.stringify({ tabId: TAB_ID, ts: now }));
    } catch (_) {}
    return true;
}

/**
 * 验证标签页锁（防竞态：先获取，让出短暂时间，再读取确认）
 * @returns {Promise<boolean>}
 */
async function verifyTabLease() {
    if (!claimTabLock()) return false;
    await new Promise(resolve => setTimeout(resolve, 35 + Math.floor(Math.random() * 45)));
    try {
        const raw = localStorage.getItem(_tabLockKey());
        const lock = raw ? JSON.parse(raw) : null;
        return !!lock && lock.tabId === TAB_ID && Date.now() - lock.ts < 8000;
    } catch (_) {
        return false;
    }
}

/**
 * 释放标签页锁
 */
function releaseTabLock() {
    try {
        const key = _tabLockKey();
        const raw = localStorage.getItem(key);
        if (raw) {
            const lock = JSON.parse(raw);
            if (lock.tabId === TAB_ID) localStorage.removeItem(key);
        }
    } catch (_) {}
}

/**
 * 启动标签页心跳（每 5 秒续租）
 */
function startTabHeartbeat() {
    if (_tabLockInterval) clearInterval(_tabLockInterval);
    _tabLockInterval = setInterval(() => {
        if (!claimTabLock()) {
            // 失去所有权 — 暂停
            if (engine.state === 'RUNNING') {
                engine.state = 'PAUSED';
                engine.detail = '⚠ 标签页锁丢失 — 已暂停';
                Ticker.stop();
                engine.timer = null;
                renderExternal();
            }
        }
    }, 5000);
}

/* ═══════════════════════════════════════════════════
   交互安全检查
   ═══════════════════════════════════════════════════ */

/**
 * 判断当前是否允许自动操作（基于焦点和可见性）
 * 无人值守模式不检查焦点；非无人值守模式要求标签页聚焦
 * @returns {boolean}
 */
function isTabSafeToAct() {
    if (!engine.unattended) {
        if (!document.hasFocus()) return false;
        if (document.hidden) return false;
    }
    return claimTabLock(); // 多标签页冲突防护永不放松
}

/**
 * 发送前的安全检查
 * @returns {{ok:boolean,reason:string}}
 */
function assertInteractionSafe() {
    if (!engine.unattended && !document.hasFocus() && engine.state === 'RUNNING') {
        return { ok: false, reason: 'tab-not-focused' };
    }
    if (!claimTabLock()) {
        return { ok: false, reason: 'tab-lock-held-by-other' };
    }
    return { ok: true, reason: 'ok' };
}

/* ═══════════════════════════════════════════════════
   辅助函数
   ═══════════════════════════════════════════════════ */

/**
 * 延迟函数
 * @param {number} ms - 延迟毫秒数
 * @returns {Promise<void>}
 */
function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

/**
 * 随机防自动化延迟
 * 第一轮 2 秒（规划阶段），后续 8-15 秒随机
 * @param {number} round - 当前轮次
 * @returns {number} 延迟毫秒数
 */
function randomDelay(round) {
    if (round <= 1) return DELAY_FIRST_ROUND;
    return DELAY_MIN + Math.random() * (DELAY_MAX - DELAY_MIN);
}

/**
 * 计算回复指纹（长度 + 尾部 180 字符）
 * @param {string} text - 回复文本
 * @returns {string}
 */
function replyFingerprint(text) {
    const s = String(text || '');
    return `${s.length}:${s.slice(-180)}`;
}

/**
 * 观察回复文本变化，返回稳定 tick 数
 * @param {string} text - 当前回复文本
 * @returns {{key:string,stableTicks:number}}
 */
function observeReplyText(text) {
    const key = replyFingerprint(text);
    if (key && key === engine.replyKey) {
        engine.replyStableTicks++;
    } else {
        engine.replyKey = key;
        engine.replyStableTicks = 0;
    }
    return { key, stableTicks: engine.replyStableTicks };
}

/**
 * 检查回复是否已超越发送前的基线（防止把旧回复误判为终端信号）
 * @param {string} text - 当前回复文本
 * @returns {boolean}
 */
function replyAdvancedBeyondBaseline(text) {
    const b = engine.replyBaseline;
    if (!b) return true;
    const count = getAssistantMessages().length;
    const s = String(text || '');
    // 满足任一条件即认为回复已前进
    return count > b.assistantCount ||
           s.length > b.assistantTextLength + 4 ||
           (s.slice(-180) && s.slice(-180) !== b.assistantTail);
}

/**
 * 综合判断回复是否已就绪可读取终端信号
 * @param {string} text - 回复文本
 * @param {object} result - 信号检测结果
 * @param {object} observation - 稳定性观察
 * @param {boolean} stopVisible - 停止按钮是否可见
 * @returns {boolean}
 */
function terminalReplyReady(text, result, observation, stopVisible) {
    return !!text &&
           !!result &&
           ['proceed', 'halt'].includes(result.signal) &&
           !stopVisible &&
           replyAdvancedBeyondBaseline(text) &&
           observation.stableTicks >= 1;
}

/**
 * 设置循环阶段
 * @param {string} phase - 阶段名称
 * @param {string} [detail] - 阶段详情
 * @returns {boolean} - 阶段是否变化
 */
function setPhase(phase, detail) {
    const changed = engine.phase !== phase || (detail !== undefined && engine.detail !== detail);
    engine.phase = phase;
    if (detail !== undefined) engine.detail = detail;
    if (changed) renderExternal();
    return changed;
}

/**
 * 发送桌面通知
 * @param {string} body - 通知正文
 */
function notify(body) {
    if (!CONFIG.loopNotifyEnabled) return;
    try {
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
            new Notification('🌸 DeepSeek Promax', { body });
        }
    } catch (_) {}
}

/**
 * 请求通知权限
 * @returns {Promise<boolean>}
 */
export async function requestNotifyPermission() {
    try {
        if (typeof Notification === 'undefined') return false;
        if (Notification.permission === 'granted') return true;
        const result = await Notification.requestPermission();
        return result === 'granted';
    } catch (_) {
        return false;
    }
}

/**
 * 外部渲染触发（通过自定义事件通知 UI）
 * 监听方（如面板）可订阅 'ds-loop-render' 事件来更新显示
 */
function renderExternal() {
    try {
        window.dispatchEvent(new CustomEvent('ds-loop-render', { detail: getEngineState() }));
    } catch (_) {}
}

/* ═══════════════════════════════════════════════════
   状态持久化（崩溃恢复）
   ═══════════════════════════════════════════════════ */

/**
 * 保存引擎状态到 localStorage（用于崩溃恢复）
 */
function persistState() {
    try {
        const data = {
            state: engine.state,
            round: engine.round,
            maxRounds: engine.maxRounds,
            originalTask: engine.originalTask,
            payloadMode: engine.payloadMode,
            posture: engine.posture,
            driftEnabled: engine.driftEnabled,
            timestamp: Date.now()
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (_) {}
}

/**
 * 从 localStorage 恢复引擎状态
 * @returns {boolean} - 是否恢复了有效状态
 */
function restoreState() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return false;
        const data = JSON.parse(raw);
        // 只恢复 RUNNING 状态（且在 5 分钟内）
        if (data.state === 'RUNNING' && Date.now() - data.timestamp < 300000) {
            engine.round = data.round || 0;
            engine.maxRounds = data.maxRounds || DEFAULT_MAX_ROUNDS;
            engine.originalTask = data.originalTask || '';
            engine.payloadMode = data.payloadMode || 'loop';
            engine.posture = data.posture || 'standard';
            engine.driftEnabled = data.driftEnabled !== false;
            engine.state = 'PAUSED';
            engine.detail = '↻ 从崩溃中恢复 — 点击继续恢复运行';
            return true;
        }
        clearState();
        return false;
    } catch (_) {
        return false;
    }
}

/**
 * 清除持久化状态
 */
function clearState() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
}

/* ═══════════════════════════════════════════════════
   At-most-once 发送（事务性发送 + 投递确认）
   ═══════════════════════════════════════════════════ */

let _pendingSendResolve = null;

/**
 * 开始一次发送尝试（创建事务并打开 9 秒确认窗口）
 * @param {string} path - 发送路径：reviewed-button | reviewed-enter
 * @param {Element} input - 输入框元素
 * @returns {Promise<boolean>} - 是否确认投递成功
 */
function _beginSendAttempt(path, input) {
    const lastText = getLastReplyText() || '';
    const txn = {
        id: crypto.randomUUID?.() || `cmd-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        state: 'dispatching',  // dispatching | committed | uncertain | failed
        path: String(path || 'reviewed-button'),
        attemptedAt: Date.now(),
        assistantCount: getAssistantMessages().length,
        assistantTextLength: lastText.length,
        assistantTail: lastText.slice(-180),
        composerHadText: _composerText(input).length > 0
    };
    engine.sendTxn = txn;
    engine.sendPending = true;
    engine.sendDeadline = Date.now() + SEND_CONFIRM_MS;
    setPhase('confirming', '正在确认发送…');
    return new Promise(resolve => { _pendingSendResolve = resolve; });
}

/**
 * 收集发送投递证据
 * 三种独立证据（满足任一即确认）：
 *   1. assistant-transition：回复数量增加或文本变长
 *   2. composer+stop：输入框被清空 + 停止按钮可见
 *   3. composer+trusted-network：输入框被清空 + 网络活动
 * @returns {{confirmed:boolean,evidence:string}}
 */
function _sendEvidence() {
    const txn = engine.sendTxn;
    if (!txn || txn.state !== 'dispatching') return { confirmed: false, evidence: 'none' };

    const assistantCount = getAssistantMessages().length;
    const assistantTextLength = (getLastReplyText() || '').length;
    if (assistantCount > txn.assistantCount || assistantTextLength > txn.assistantTextLength + 4) {
        return { confirmed: true, evidence: 'assistant-transition' };
    }

    const input = getInput();
    const composerCleared = txn.composerHadText && !!input && _composerText(input).length < 4;
    const stopVisible = isGenerating();
    if (composerCleared && stopVisible) return { confirmed: true, evidence: 'composer+stop' };
    return { confirmed: false, evidence: 'insufficient' };
}

/**
 * 确认发送（提交事务，推进状态）
 * @param {string} evidence - 证据
 * @returns {boolean}
 */
function _confirmSend(evidence) {
    const txn = engine.sendTxn;
    if (!engine.sendPending || !txn || txn.state !== 'dispatching') return false;
    txn.state = 'committed';
    txn.evidence = evidence || 'independent-observation';
    txn.committedAt = Date.now();
    engine.sendPending = false;
    engine.sendDeadline = 0;
    engine.round++;
    engine.lastActivity = Date.now();
    engine.staleTicks = 0;
    engine.replyBaseline = {
        assistantCount: txn.assistantCount,
        assistantTextLength: txn.assistantTextLength,
        assistantTail: txn.assistantTail || ''
    };
    engine.replyKey = '';
    engine.replyStableTicks = 0;
    setPhase('generating', '等待 AI 输出…');
    try { localStorage.setItem(SEND_TIER_KEY_PREFIX + location.hostname, txn.path); } catch (_) {}
    _settleSendPromise(true);
    return true;
}

/**
 * 标记发送为不确定（无法证明投递）
 * 永不重试 — 等待用户人工裁决
 * @returns {boolean}
 */
function _markSendUncertain() {
    const txn = engine.sendTxn;
    if (!engine.sendPending || !txn) return false;
    txn.state = 'uncertain';
    txn.uncertainAt = Date.now();
    engine.sendPending = false;
    engine.sendDeadline = 0;
    setPhase('error', '⚠ 发送无法确认 — 请人工检查');
    enginePause('发送无法确认 — 请检查对话后决定是否重试');
    _settleSendPromise(false);
    return true;
}

/**
 * 解决发送 Promise
 * @param {boolean} ok - 是否成功
 */
function _settleSendPromise(ok) {
    const resolve = _pendingSendResolve;
    _pendingSendResolve = null;
    if (resolve) {
        try { resolve(!!ok); } catch (_) {}
    }
}

/**
 * 人工裁决不确定的发送
 * 永不自动重试 — 由用户决定是否已投递
 * @param {boolean} delivered - 用户确认是否已投递
 * @returns {boolean}
 */
export function reconcileUncertainSend(delivered) {
    const txn = engine.sendTxn;
    if (!txn || txn.state !== 'uncertain') return false;
    if (!delivered) {
        txn.state = 'failed';
        txn.reconciledAt = Date.now();
        engine.detail = '提示词已留在输入框 — 请使用 DeepSeek 自己的发送按钮';
        renderExternal();
        return true;
    }
    txn.state = 'committed';
    txn.evidence = 'human-confirmed';
    txn.committedAt = Date.now();
    engine.round++;
    engine.lastActivity = Date.now();
    engine.staleTicks = 0;
    engine.state = 'RUNNING';
    engine.detail = '✓ 已由用户确认投递';
    engine.timer = Ticker.start(engineTick, TICK_INTERVAL);
    renderExternal();
    return true;
}

/* ═══════════════════════════════════════════════════
   自动发送
   ═══════════════════════════════════════════════════ */

/**
 * 向 DeepSeek 发送消息（事务性发送 + 投递确认）
 *
 * 流程：
 *   1. 安全检查（焦点 + 标签页锁）
 *   2. 等待随机延迟（防自动化）
 *   3. 验证标签页租约（防竞态）
 *   4. 检查 AI 是否正在生成（如果是则中止）
 *   5. 找到输入框并注入文本
 *   6. 验证文本已正确填入
 *   7. 选择唯一发送机制（按钮或 Enter）
 *   8. 开启 9 秒确认窗口，等待投递证据
 *
 * @param {string} text - 要发送的文本
 * @param {boolean} skipDelay - 是否跳过延迟
 * @returns {Promise<boolean>} - 是否发送成功
 */
async function engineSend(text, skipDelay = false) {
    if (engine.isSending) {
        console.warn('[LoopEngine] 发送被阻止 — 锁定中');
        return false;
    }
    const safe = assertInteractionSafe();
    if (!safe.ok) {
        console.warn('[LoopEngine] 发送被阻止 —', safe.reason);
        engine.detail = `⚠ ${safe.reason}`;
        renderExternal();
        return false;
    }
    engine.isSending = true;

    try {
        // 防自动化延迟
        if (!skipDelay) {
            await countdownDelay(randomDelay(engine.round));
        }

        if (engine.state !== 'RUNNING') return false;

        // 验证标签页租约
        if (!await verifyTabLease()) {
            enginePause('另一个标签页占用了此对话');
            return false;
        }

        // 检查 AI 是否正在生成
        if (isGenerating()) {
            setPhase('generating', '⚠ AI 正在生成回复');
            console.warn('[LoopEngine] 发送中止 — AI 正在生成');
            return false;
        }

        setPhase('dispatching', '准备发送…');

        // 找到输入框并注入文本
        const input = getInput();
        if (!input) {
            enginePause('未找到聊天输入框');
            return false;
        }

        if (!injectText(input, text)) {
            enginePause('输入框拒绝了文本注入');
            return false;
        }

        // 等待 React 状态更新
        await sleep(500);

        // 验证文本已正确填入（规范化后比较，避免空白差异）
        if (!_promptStagedInComposer(input, text)) {
            enginePause('提示词未能完整保留在输入框 — 未发送');
            return false;
        }

        // 选择唯一发送机制：优先 reviewed-button，否则 reviewed-enter
        const btn = getSendBtn();
        const strategy = btn ? {
            path: 'reviewed-button',
            run: () => btn.click()
        } : {
            path: 'reviewed-enter',
            run: () => input.dispatchEvent(new KeyboardEvent('keydown', {
                key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
                bubbles: true, cancelable: true, composed: true
            }))
        };

        // 开启发送事务
        const completion = _beginSendAttempt(strategy.path, input);
        try {
            strategy.run();
        } catch (_) {
            _markSendUncertain();
            return false;
        }
        return await completion;
    } catch (e) {
        console.warn('[LoopEngine] Send error:', e);
        if (engine.sendPending) {
            _markSendUncertain();
        }
        return false;
    } finally {
        engine.isSending = false;
    }
}

/**
 * 倒计时延迟（显示剩余秒数）
 * @param {number} ms - 延迟毫秒数
 */
async function countdownDelay(ms) {
    engine.countdownUntil = Date.now() + Math.max(0, ms);
    let shown = -1;
    while (engine.state === 'RUNNING') {
        const left = Math.max(0, engine.countdownUntil - Date.now());
        const sec = Math.ceil(left / 1000);
        if (sec !== shown) {
            shown = sec;
            setPhase('countdown', `${sec} 秒后发送下一条…`);
        }
        if (left <= 0) break;
        await sleep(Math.min(250, left));
    }
    engine.countdownUntil = 0;
}

/* ═══════════════════════════════════════════════════
   循环引擎核心
   ═══════════════════════════════════════════════════ */

/**
 * 引擎 tick — 每 2.5 秒执行一次的核心循环
 *
 * 流程：
 *   1. 处理未确认的发送事务（at-most-once send 观察窗口）
 *   2. 检查看门狗（90 秒软超时 / 180 秒硬超时）
 *   3. 检查轮次上限（漂移防护）
 *   4. 读取最新 AI 回复文本
 *   5. 检测回复稳定性 + 信号
 *   6. 根据信号决定：继续发送 / 停止 / 软继续 / 等待
 */
function engineTick() {
    if (engine.state !== 'RUNNING') return;

    // ── At-most-once send 观察窗口 ──
    if (engine.sendPending) {
        const observed = _sendEvidence();
        if (observed.confirmed) {
            _confirmSend(observed.evidence);
            engine.lastActivity = Date.now();
        } else if (Date.now() >= engine.sendDeadline) {
            _markSendUncertain();
            return;
        } else {
            // 发送未决 — 不解析旧输出，不派发新命令
            return;
        }
    }

    // 看门狗
    const idle = Date.now() - engine.lastActivity;
    if (idle > WATCHDOG_HARD) {
        enginePause('看门狗：3 分钟无活动');
        return;
    }
    if (idle > WATCHDOG_SOFT) {
        setPhase('watchdog', '⚠ 看门狗：90 秒空闲');
    }

    // 漂移防护：轮次上限软检查
    if (engine.driftEnabled && engine.round >= engine.maxRounds) {
        engineLimit();
        return;
    }

    // 读取最新回复
    const text = getLastReplyText();
    const observation = observeReplyText(text);
    const result = text ? detectSignal(text) : { signal: 'short', confidence: 0, progress: null };
    const stopVisible = isGenerating();
    const terminalReady = terminalReplyReady(text, result, observation, stopVisible);

    // AI 正在生成
    if (stopVisible && !terminalReady) {
        engine.lastActivity = Date.now();
        engine.staleTicks = 0;
        engine._thinkNoted = false;
        setPhase('generating', text ? 'AI 正在输出…' : '等待 AI 输出…');
        return;
    }

    // 无文本
    if (!text) {
        setPhase('waiting', '等待 AI 输出…');
        engine.staleTicks++;
        if (engine.staleTicks >= 5) {
            enginePause('未检测到输出');
        }
        return;
    }

    engine.lastSignal = result.signal;
    engine.lastConfidence = result.confidence;
    if (result.progress) engine.lastProgress = result.progress;

    setPhase(
        terminalReady ? 'decision' : 'reading',
        terminalReady
            ? (result.signal === 'halt' ? '检测到 HALT 信号' : '检测到 PROCEED 信号')
            : '正在阅读回复…'
    );

    // 信号为 short — 回复可能未完成
    if (result.signal === 'short') {
        engine.staleTicks++;
        if (engine.staleTicks >= 3) {
            enginePause('回复过短 — 请检查输出');
        }
        return;
    }

    // HALT 信号 — 任务完成
    if (result.signal === 'halt') {
        engine.staleTicks = 0;
        engine.noSigilStreak = 0;
        engine._nudgedTail = '';

        // 路线图模式：委托给 roadmap 模块处理
        if (engine.payloadMode === 'roadmap') {
            const handled = window.__dsRoadmapOnHalt?.();
            if (handled) return;
        }

        // 工作流自动推进
        const wfHandled = window.__dsWorkflowOnHalt?.();
        if (wfHandled) return;

        engineHalt('✅ 任务完成');
        return;
    }

    // PROCEED 信号 — 继续下一步
    if (result.signal === 'proceed') {
        engine.staleTicks = 0;
        engine.noSigilStreak = 0;
        engine._nudgedTail = '';

        // 路线图模式：检查是否需要发送下一步
        if (engine.payloadMode === 'roadmap') {
            const handled = window.__dsRoadmapOnProceed?.(text);
            if (handled) return;
        }

        // 工作流模式：检查是否需要推进到下一阶段
        const wfHandled = window.__dsWorkflowOnProceed?.(text);
        if (wfHandled) return;

        // 普通循环模式：发送 "继续"
        // 附加人格指令（如果开启且每步注入）
        const personaClause = window.__dsPersonaPerTask?.() ? window.__dsResolvePersonaInject?.() || '' : '';
        const continueText = personaClause
            ? `继续。\n\n[激活委员会 — 保持所有指定视角]\n${personaClause}`
            : '继续';
        engineSend(continueText, false);
        return;
    }

    // ── 无信号 — 但仅在 AI 真正空闲时才视为过期 ──
    // 长时间"思考"阶段可能数分钟无 DOM 增长也无停止按钮，
    // 此时不应该误判为过期
    if (isGenerating()) {
        engine.staleTicks = 0;
        if (!engine._thinkNoted) {
            engine._thinkNoted = true;
            setPhase('generating', '🧠 模型仍在思考…');
        }
        return;
    }
    engine._thinkNoted = false;
    engine.staleTicks++;

    if (engine.staleTicks >= 5) {
        // 软继续：DeepSeek 经常完整回答但不输出 sigil
        // 自动重申协议（最多 2 次），每次都消耗一轮以保持漂移防护
        const tail = text.slice(-200);
        if (tail === engine._nudgedTail && (engine.isSending || engine.sendPending)) return;
        if (!engine.isSending && !engine.sendPending && text.length > 20 && engine.noSigilStreak < SOFT_PROCEED_MAX && tail !== engine._nudgedTail) {
            engine.noSigilStreak++;
            engine._nudgedTail = tail;
            engine.staleTicks = 0;
            setPhase('reading', `🕯 回复无 sigil — 软继续 (${engine.noSigilStreak}/${SOFT_PROCEED_MAX}) 并重申协议`);
            const nudgeText = '继续。\n\n[协议提醒 — 你的上一条回复缺少控制标记。从现在起，每条回复必须以以下之一结尾：\n[[GITL::PROCEED]] — 还有剩余工作\n[[GITL::HALT]] — 整个任务已完成\n同时在单独一行包含 "[Step X of Y]" 以便跟踪进度。]';
            engineSend(nudgeText, false);
            return;
        }
        enginePause('连续 2 次软继续后仍无 sigil — 请检查输出（模型可能在忽略协议）');
    }
}

/**
 * 启动循环引擎
 * @param {string} [taskText] - 初始任务文本（可选）
 */
export function startLoop(taskText) {
    if (engine.state === 'RUNNING') return;

    // 如果有未决的发送事务，必须先裁决
    if (engine.sendTxn?.state === 'uncertain') {
        engine.detail = '请先选择"我看到它已发出"或"留待手动发送"';
        renderExternal();
        return;
    }

    const input = getInput();
    const hasText = input && getInputText().length > 2;
    const hasMessages = getAssistantMessages().length > 0;

    // 标记首次运行完成（如有 UI 引用）
    engine.state = 'RUNNING';
    engine.round = 0;
    engine.staleTicks = 0;
    engine.lastActivity = Date.now();
    engine.detail = '正在启动…';
    engine.needsPayload = !hasText && !hasMessages;
    engine.sendPending = false;
    engine.sendTxn = null;
    engine.replyBaseline = null;

    // 启动标签页心跳
    startTabHeartbeat();

    // 如果有初始任务文本
    if (taskText && taskText.trim()) {
        engine.originalTask = taskText.trim().slice(0, 2000); // 保存原始任务用于 reground
        engine.payloadMode = engine.payloadMode || 'loop';
        engine.needsPayload = false;
        engine.timer = Ticker.start(engineTick, TICK_INTERVAL);

        // 构建完整指令：任务 + 协议 + 姿态 + 人格
        const fullPrompt = buildFullPrompt(taskText.trim(), true);
        engineSend(fullPrompt, true);
    } else if (hasText) {
        // 输入框有文本 — 发送并开始循环
        engine.originalTask = getInputText().slice(0, 2000);
        engine.needsPayload = false;
        engine.timer = Ticker.start(engineTick, TICK_INTERVAL);
        const btn = getSendBtn();
        if (btn) {
            // 通过事务性发送触发
            const completion = _beginSendAttempt('reviewed-button', input);
            btn.click();
            completion.then(ok => {
                if (ok) {
                    engine.lastActivity = Date.now();
                }
            });
        }
    } else if (hasMessages) {
        // 恢复已有对话
        engine.needsPayload = false;
        engine.timer = Ticker.start(engineTick, TICK_INTERVAL);
        const resumeText = '继续。\n\n[循环恢复] 请继续之前的工作。完成后以 [[GITL::PROCEED]] 或 [[GITL::HALT]] 结尾。';
        engineSend(resumeText, true);
    } else {
        engine.detail = '请输入任务或打开已有对话';
        engine.state = 'IDLE';
    }

    persistState();
}

/**
 * 构建完整指令：任务 + 协议 + 姿态 + 人格
 * @param {string} task - 任务文本
 * @param {boolean} includeStrategy - 是否包含策略 payload（路线图恢复时应为 false）
 * @returns {string}
 */
function buildFullPrompt(task, includeStrategy) {
    let out = task;

    // 协议 payload（loop / think / roadmap）
    if (includeStrategy) {
        const payload = window.__dsGetPayload?.(engine.payloadMode);
        if (payload) out += payload;
    }

    // 思考姿态
    const postureClause = window.__dsGetPostureClause?.(engine.posture);
    if (postureClause) out += postureClause;

    // 人格
    const persona = window.__dsResolvePersonaInject?.();
    if (persona) out += '\n\n[激活人格]\n' + persona;

    return out;
}

/**
 * 暂停循环引擎
 * @param {string} [reason] - 暂停原因
 */
export function pauseLoop(reason) {
    enginePause(reason || '已暂停');
}

/**
 * 引擎暂停（内部）
 * 如果有未决发送，会标记为 uncertain
 * @param {string} reason - 暂停原因
 */
function enginePause(reason) {
    let interruptedDispatch = false;
    if (engine.sendPending) {
        engine.sendPending = false;
        engine.sendDeadline = 0;
        if (engine.sendTxn && engine.sendTxn.state === 'dispatching') {
            engine.sendTxn.state = 'uncertain';
            engine.sendTxn.uncertainAt = Date.now();
            interruptedDispatch = true;
        }
        _settleSendPromise(false);
    }
    if (engine.timer) {
        Ticker.stop();
        engine.timer = null;
    }
    engine.state = 'PAUSED';
    engine.detail = reason || '已暂停';
    engine.countdownUntil = 0;
    engine.phase = /error|failed|uncertain|watchdog|no output|too short|can't|cannot|无法|未检测|过期/i.test(String(reason || '')) ? 'error' : 'paused';
    persistState();
    notify('循环已暂停：' + (reason || ''));
    renderExternal();
}

/**
 * 引擎停止 — 任务完成
 * @param {string} reason - 完成原因
 */
function engineHalt(reason) {
    if (engine.timer) {
        Ticker.stop();
        engine.timer = null;
    }
    engine.state = 'COMPLETE';
    engine.detail = reason || '✅ 任务完成';
    engine.phase = 'halted';
    engine.countdownUntil = 0;
    engine.needsPayload = true;
    clearState();
    releaseTabLock();
    if (_tabLockInterval) {
        clearInterval(_tabLockInterval);
        _tabLockInterval = null;
    }
    notify('循环已完成：' + (reason || ''));
    renderExternal();
}

/**
 * 引擎达到轮次上限（软暂停）
 */
function engineLimit() {
    if (engine.timer) {
        Ticker.stop();
        engine.timer = null;
    }
    engine.state = 'LIMIT';
    engine.detail = `已达 ${engine.maxRounds} 轮上限 — 点击 ▶ 再运行 ${engine.limitStep} 轮，或 ⊕ 重新锚定`;
    engine.countdownUntil = 0;
    engine.sendPending = false;
    persistState();
    notify(`已达到 ${engine.maxRounds} 轮上限 — 点击继续或重新锚定`);
    renderExternal();
}

/**
 * 停止循环引擎（保留进度）
 */
export function stopLoop() {
    if (engine.state === 'IDLE' || engine.state === 'COMPLETE') return;
    enginePause('已停止 — 进度已保留，可继续或重置');
}

/**
 * 重置循环引擎
 */
export function resetLoop() {
    _settleSendPromise(false);
    if (engine.timer) {
        Ticker.stop();
        engine.timer = null;
    }
    engine.state = 'IDLE';
    engine.round = 0;
    engine.staleTicks = 0;
    engine.phase = 'idle';
    engine.detail = '';
    engine.countdownUntil = 0;
    engine.replyKey = '';
    engine.replyStableTicks = 0;
    engine.replyBaseline = null;
    engine.originalTask = '';
    engine.lastSignal = 'none';
    engine.lastConfidence = 0;
    engine.lastProgress = null;
    engine.needsPayload = true;
    engine.payloadMode = 'loop';
    engine.posture = 'standard';
    engine.isSending = false;
    engine.sendPending = false;
    engine.sendDeadline = 0;
    engine.sendTxn = null;
    engine.noSigilStreak = 0;
    engine._nudgedTail = '';
    engine._thinkNoted = false;
    clearState();
    releaseTabLock();
    if (_tabLockInterval) {
        clearInterval(_tabLockInterval);
        _tabLockInterval = null;
    }
    renderExternal();
}

/**
 * 延长轮次上限（从 LIMIT 状态恢复）
 * @param {number} [extra] - 额外轮次
 */
export function extendLimit(extra = LIMIT_STEP) {
    engine.maxRounds += extra;
    engine.state = 'RUNNING';
    engine.lastActivity = Date.now();
    engine.timer = Ticker.start(engineTick, TICK_INTERVAL);
    persistState();
    renderExternal();
    engineTick();
}

/**
 * 重新锚定（从 LIMIT 状态恢复 + 发送 grounding 指令）
 * 让 AI 重新确认原始任务，避免漂移
 */
export function regroundLoop() {
    const task = (engine.originalTask || '').trim();
    const anchor = task
        ? `\n\n你最初接到的任务是：\n"""\n${task}\n"""\n`
        : '\n';
    const cmd = `[重新锚定 — 漂移检查]\n你已经运行了很多步骤。继续之前，请重新锚定到原始目标。${anchor}
请用 2-3 行：(1) 陈述原始任务是什么；(2) 确认你最近的工作是否仍直接服务于它，还是已经偏离；(3) 如果偏离，立即纠正方向。
然后继续任务。以 [Step X of Y] 和 [[GITL::PROCEED]]（还有剩余工作）或 [[GITL::HALT]]（原始任务确实已完成）结尾。`;
    engine.maxRounds += engine.limitStep;
    engine.state = 'RUNNING';
    engine.detail = '⊕ 正在重新锚定到原始任务…';
    engine.lastActivity = Date.now();
    engine.timer = Ticker.start(engineTick, TICK_INTERVAL);
    persistState();
    renderExternal();
    engineSend(cmd, true);
}

/**
 * 主操作按钮 — 根据当前状态决定行为
 */
export function primaryAction() {
    const s = engine.state;
    if (s === 'RUNNING') return pauseLoop();
    if (s === 'LIMIT') return extendLimit();
    return startLoop();
}

/**
 * 获取引擎状态
 * @returns {object}
 */
export function getEngineState() {
    return {
        state: engine.state,
        round: engine.round,
        maxRounds: engine.maxRounds,
        limitStep: engine.limitStep,
        phase: engine.phase,
        detail: engine.detail,
        lastSignal: engine.lastSignal,
        lastConfidence: engine.lastConfidence,
        lastProgress: engine.lastProgress,
        countdownUntil: engine.countdownUntil,
        payloadMode: engine.payloadMode,
        posture: engine.posture,
        driftEnabled: engine.driftEnabled,
        unattended: engine.unattended,
        sendPending: engine.sendPending,
        sendTxn: engine.sendTxn ? {
            id: engine.sendTxn.id.slice(0, 8),
            state: engine.sendTxn.state,
            path: engine.sendTxn.path,
            evidence: engine.sendTxn.evidence
        } : null,
        remainingRounds: engine.driftEnabled ? Math.max(0, engine.maxRounds - engine.round) : null
    };
}

/**
 * 设置引擎参数（来自 UI）
 * @param {object} opts - 选项
 */
export function setEngineOptions(opts) {
    if (!opts) return;
    if (opts.payloadMode !== undefined) engine.payloadMode = opts.payloadMode;
    if (opts.posture !== undefined) engine.posture = opts.posture;
    if (opts.maxRounds !== undefined) engine.maxRounds = Math.max(1, Math.min(999, opts.maxRounds));
    if (opts.driftEnabled !== undefined) engine.driftEnabled = !!opts.driftEnabled;
    if (opts.unattended !== undefined) engine.unattended = !!opts.unattended;
    persistState();
    renderExternal();
}

/**
 * 初始化循环引擎 — 检查崩溃恢复
 */
export function initLoopEngine() {
    // 检查崩溃恢复
    if (CONFIG.loopCrashRecoveryEnabled) {
        const restored = restoreState();
        if (restored) {
            console.log('[LoopEngine] 检测到崩溃恢复状态');
        }
    }

    // 同步 CONFIG 中的设置
    if (CONFIG.loopDriftEnabled !== undefined) engine.driftEnabled = CONFIG.loopDriftEnabled;
    if (CONFIG.loopUnattended !== undefined) engine.unattended = CONFIG.loopUnattended;
    if (CONFIG.loopMaxRounds) engine.maxRounds = CONFIG.loopMaxRounds;
    if (CONFIG.loopPosture) engine.posture = CONFIG.loopPosture;

    // 请求通知权限
    if (CONFIG.loopNotifyEnabled) {
        requestNotifyPermission();
    }

    // 监听 SPA 路由变化（防止 URL 变化时误暂停）
    // 使用标记防止多次覆写导致递归栈溢出
    let lastHref = location.href;
    window.addEventListener('popstate', () => handleRouteChange(lastHref));
    if (!history.pushState._dsLoopWrapped) {
        const _ps = history.pushState;
        const wrapped = function() {
            const r = _ps.apply(this, arguments);
            setTimeout(() => handleRouteChange(lastHref), 0);
            return r;
        };
        wrapped._dsLoopWrapped = true;
        history.pushState = wrapped;
    }
    if (!history.replaceState._dsLoopWrapped) {
        const _rs = history.replaceState;
        const wrappedRs = function() {
            const r = _rs.apply(this, arguments);
            setTimeout(() => handleRouteChange(lastHref), 0);
            return r;
        };
        wrappedRs._dsLoopWrapped = true;
        history.replaceState = wrappedRs;
    }
    function handleRouteChange(prev) {
        if (location.href === prev) return;
        lastHref = location.href;
        if (engine.state === 'RUNNING') {
            // 同 host + 刚发送过 = 通常是首条消息后的 URL 分配（/ → /c/<uuid>）
            let sameHost = false;
            try { sameHost = new URL(prev).hostname === location.hostname; } catch (_) {}
            const justSent = engine.sendPending || (Date.now() - (engine.lastActivity || 0) < 15000);
            if (sameHost && justSent) return;
            enginePause('路由变化 — 已暂停');
        }
    }

    // 可见性变化时清理过期缓存引用
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible') return;
        // 标签页重新可见 — 触发一次 tick 检查
        if (engine.state === 'RUNNING') {
            engineTick();
        }
    });

    console.log('[LoopEngine] 循环引擎已初始化 v2.0');
}

/* ═══════════════════════════════════════════════════
   导出内部函数供 roadmap / workflows / personas 模块使用
   ═══════════════════════════════════════════════════ */

export const _internals = {
    engine,
    engineSend,
    enginePause,
    engineHalt,
    engineTick,
    setPhase,
    persistState,
    clearState,
    getLastReplyText,
    isGenerating,
    getAssistantMessages,
    getInput,
    getSendBtn,
    injectText,
    buildFullPrompt,
    Ticker,
    SIGIL_PROCEED,
    SIGIL_HALT,
    SIGIL_ROADMAP,
    TICK_INTERVAL,
    DEFAULT_MAX_ROUNDS,
    LIMIT_STEP
};
