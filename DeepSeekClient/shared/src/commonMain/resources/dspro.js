// ==UserScript==
// @name       DeepSeek promax
// @namespace  https://github.com/nalilaidegithub
// @version    3.8.0
// @description 多主题切换、窄边距独立控制、美化、跳转、标题伪装 + 增强角标清理 + 图片链接强化 + 删除线渲染（代码块内不渲染）+ 防撤回（XHR 拦截，流式实时美化）+ Mermaid 图表渲染（含代码/图表切换）+ 自动重试按钮（最多10次）+ 设置项帮助提示 + 消息预设菜单（/触发） + 上下键历史切换 + 自定义字体 + 聊天背景
// @author     Assistant
// @match  *://*.deepseek.com/*
// @match  *://deepseek.com/*
// @icon       https://www.deepseek.com/favicon.ico
// @grant      none
// @license    MIT
// @run-at     document-start
// ==/UserScript==

//   ___              ___         _
//  | _ \___ _ _ _  _| _ \__ _ __| |___
//  |   / -_) '_| || |  _/ _` / _| / -_)
//  |_|_\___|_|  \_, |_| \__,_\__|_\___|
//               |__|
//  DeepSeek Promax Userscript
//  v3.8.0 | https://github.com/nalilaidegithub
//

/******/ (() => { // webpackBootstrap
/******/ 	"use strict";
/******/ 	var __webpack_modules__ = ({

/***/ 384
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   PI: () => (/* binding */ CONFIG),
/* harmony export */   Wf: () => (/* binding */ reloadConfig),
/* harmony export */   ql: () => (/* binding */ saveConfig)
/* harmony export */ });
/* unused harmony export loadConfig */
/**
 * 配置管理模块
 *
 * 负责：
 *   - 定义默认配置 DEFAULTS
 *   - 定义短 ID → CONFIG 键名映射 OPTION_CONFIG_KEYS（用于设置面板 checkbox）
 *   - 从 localStorage 加载 / 保存配置
 *   - 导出全局可变的 CONFIG 对象（其他模块直接引用此对象）
 */

/** 默认配置 */
const DEFAULTS = {
    sakuraEnabled: true,
    imageRenderEnabled: true,
    autoRedirectEnabled: true,
    titleFakerEnabled: true,
    themeColor: 'pink',
    narrowPaddingEnabled: true,
    citationCleanEnabled: true,
    strikethroughEnabled: true,
    antiRecallEnabled: true,
    mermaidEnabled: true,
    autoRetryEnabled: true,
    defaultModeEnabled: false,
    defaultMode: 'default',
    removeForwardEnabled: true,
    removeDownloadAppEnabled: true,
    placeholderTextEnabled: true,
    placeholderText: '说点什么吧～',
    // 导出功能
    exportJsonEnabled: true,
    exportMdEnabled: true,
    exportImageEnabled: false,
    // 系统提示词注入
    promptInjectEnabled: false,
    promptText: '',
    // 隐私保护（敏感词替换）
    privacyShieldEnabled: false,
    sensitiveWords: {},
    caseSensitive: false,
    // 行内代码点击复制
    copyCodeEnabled: true,
    // 文件夹管理（侧边栏嵌入）
    folderPanelEnabled: true,
    // 循环引擎
    loopEngineEnabled: false,
    loopNotifyEnabled: true,
    loopCrashRecoveryEnabled: true,
    titleList: [
        "存在主义危机应对草案",
        "薛定谔的猫当前观测状态",
        "时间管理相对论推导过程",
        "熵增对抗委员会第1024次会议纪要",
        "宇宙终极答案的42号补丁",
        "摸鱼能量守恒定律验证报告",
        "本日精神熵值可视化图表",
        "神经网络的午睡梦话记录",
        "反内卷联盟行动纲领（草稿）",
        "昨日之我与今日之我的函数映射",
        "会议室空气成分分析月度总结",
        "拖延症优先级排序算法优化",
        "人类早期驯服野生键盘珍贵影像",
        "睡眠债利息计算模型",
        "代码屎山生态多样性调查报告"
    ],
    presets: [],
    fontFamily: '',
    fontUrl: '',
    bgImage: '',
    bgOpacity: 0.5,
    messageHistory: []
};

/**
 * 设置面板短 ID → 实际 CONFIG 键名映射
 * 用于 checkbox 的 id 与配置键之间的正确对应
 */
const OPTION_CONFIG_KEYS = {
    sakura: 'sakuraEnabled',
    image: 'imageRenderEnabled',
    strikethrough: 'strikethroughEnabled',
    redirect: 'autoRedirectEnabled',
    title: 'titleFakerEnabled',
    narrow: 'narrowPaddingEnabled',
    citation: 'citationCleanEnabled',
    antiRecall: 'antiRecallEnabled',
    mermaid: 'mermaidEnabled',
    autoRetry: 'autoRetryEnabled',
    defaultMode: 'defaultModeEnabled',
    removeForward: 'removeForwardEnabled',
    removeDownloadApp: 'removeDownloadAppEnabled',
    placeholderText: 'placeholderTextEnabled',
    exportJson: 'exportJsonEnabled',
    exportMd: 'exportMdEnabled',
    exportImage: 'exportImageEnabled',
    promptInject: 'promptInjectEnabled',
    privacyShield: 'privacyShieldEnabled',
    caseSensitive: 'caseSensitive',
    copyCode: 'copyCodeEnabled',
    folderPanel: 'folderPanelEnabled',
    loopEngine: 'loopEngineEnabled',
    loopNotify: 'loopNotifyEnabled',
    loopCrashRecovery: 'loopCrashRecoveryEnabled'
};

/**
 * 从 localStorage 加载配置，合并默认值
 * @returns {Object} 合并后的配置对象
 */
function loadConfig() {
    try {
        const raw = localStorage.getItem('ds_enhance_config');
        if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
    } catch (e) {}
    return { ...DEFAULTS };
}

/**
 * 保存配置到 localStorage
 * @param {Object} config - 配置对象
 */
function saveConfig(config) {
    try {
        localStorage.setItem('ds_enhance_config', JSON.stringify(config));
    } catch (e) {}
}

/** 全局配置对象（可变，其他模块直接引用） */
let CONFIG = loadConfig();

/**
 * 重新加载配置（从 localStorage 刷新到 CONFIG）
 */
function reloadConfig() {
    CONFIG = loadConfig();
    return CONFIG;
}

/* harmony export */ __webpack_require__.d(__webpack_exports__, [
/* harmony export */   "cD", 0, /* binding */ OPTION_CONFIG_KEYS,
/* harmony export */   "zY", 0, /* binding */ DEFAULTS
/* harmony export */ ]);


/***/ },

/***/ 164
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   $W: () => (/* binding */ initHandoff),
/* harmony export */   downloadHandoff: () => (/* binding */ downloadHandoff),
/* harmony export */   generateBackupHandoff: () => (/* binding */ generateBackupHandoff),
/* harmony export */   handoffInChat: () => (/* binding */ handoffInChat)
/* harmony export */ });
/* unused harmony exports initHandoffChannel, sendHandoffToTabs, getPendingHandoff, clearPendingHandoff */
/* harmony import */ var _config_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(384);
/* harmony import */ var _loop_engine_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(433);
/**
 * Handoff 摘要模块
 *
 * 灵感来源：Ghost in the Loop
 *
 * 功能：
 *   1. 一键交接 (Handoff) — 让 AI 生成结构化交接报告，可直接粘贴到其他 AI
 *   2. 备份交接 — 从 DOM 提取最近消息，生成轻量级交接摘要
 *   3. 跨标签页交接 — 通过 BroadcastChannel 传递交接内容
 *
 * 交接报告格式：
 *   # 交接报告
 *   ## 使命 — 我们在做什么以及为什么
 *   ## 已尝试的所有方法 — 每种方法/版本，什么有效，什么失败以及为什么
 *   ## 当前状态 — 现在的准确状态
 *   ## 关键决策与理由
 *   ## 待办事项 — 未解决的问题、风险、未知
 *   ## 下一步 — 具体、有序
 *   ## 给新 AI 的指南 — 如何零基础知识接手
 */




/* ═══════════════════════════════════════════════════
   常量
   ═══════════════════════════════════════════════════ */

/** 让 AI 生成交接报告的指令 */
const HANDOFF_IN_CHAT = `请暂停所有其他工作。为整个对话生成一份完整的交接报告，在一个 markdown 代码块中，结构如下：

# 交接报告
## 使命 — 我们在做什么以及为什么
## 已尝试的所有方法 — 每种方法/版本，什么有效，什么失败以及为什么
## 当前状态 — 现在的准确状态
## 关键决策与理由
## 待办事项 — 未解决的问题、风险、未知
## 下一步 — 具体、有序
## 给新 AI 的指南 — 如何零基础知识接手

请尽可能详尽 — 这份报告是新 AI 唯一的记忆。代码块外不要有任何废话。
以 [[GITL::HALT]] 结尾。`;

/* ═══════════════════════════════════════════════════
   交接报告生成
   ═══════════════════════════════════════════════════ */

/**
 * 一键交接 — 让 AI 生成结构化交接报告
 *
 * 向当前对话发送指令，要求 AI 生成一份完整的交接报告。
 * 报告生成后，用户可复制并粘贴到其他 AI 模型。
 */
function handoffInChat() {
    if (_loop_engine_js__WEBPACK_IMPORTED_MODULE_1__/* ._internals */ .wV.engine.state === 'RUNNING') {
        console.warn('[Handoff] 请先暂停循环引擎');
        return false;
    }

    _loop_engine_js__WEBPACK_IMPORTED_MODULE_1__/* ._internals */ .wV.setPhase('handoff', '🤝 正在生成交接报告…');
    _loop_engine_js__WEBPACK_IMPORTED_MODULE_1__/* ._internals */ .wV.engineSend(HANDOFF_IN_CHAT, false);
    return true;
}

/**
 * 备份交接 — 从 DOM 提取最近消息，生成轻量级交接摘要
 *
 * 当对话卡死或无法继续时，从页面 DOM 提取最近的消息，
 * 生成一个简单的 Markdown 文件供用户下载。
 *
 * @returns {string} Markdown 格式的交接摘要
 */
function generateBackupHandoff() {
    const messages = extractMessagesFromDOM();
    if (!messages.length) {
        return '';
    }

    const lines = [
        '# 🧷 备份交接报告',
        '',
        '*当对话卡死、满了或无法继续时使用。将其粘贴到新对话中继续工作。*',
        '',
        '## 任务概述',
        '',
        extractTaskOverview(messages),
        '',
        '## 最近对话记录',
        ''
    ];

    // 只取最近 10 条消息
    const recent = messages.slice(-10);
    for (const msg of recent) {
        lines.push(`### ${msg.role === 'user' ? '👤 用户' : '🤖 AI'}`);
        lines.push('');
        lines.push(msg.text.slice(0, 2000)); // 每条消息最多 2000 字符
        lines.push('');
    }

    lines.push('---');
    lines.push('*备份交接 — 由 DeepSeek Promax 生成。轻量级版本：仅状态 + 最近 10 条消息。*');

    return lines.join('\n');
}

/**
 * 从 DOM 提取消息记录
 *
 * @returns {Array<{role:string,text:string}>}
 */
function extractMessagesFromDOM() {
    const messages = [];

    // DeepSeek 消息容器选择器
    const msgContainers = document.querySelectorAll('div[class*="ds-message"]');

    for (const container of msgContainers) {
        const isUser = container.querySelector('div[class*="user-message"]') ||
                       container.className.includes('user');

        // 获取文本内容
        const markdown = container.querySelector('div[class*="ds-markdown"], div[class*="markdown"]');
        const text = markdown
            ? (markdown.innerText || markdown.textContent || '').trim()
            : (container.innerText || container.textContent || '').trim();

        if (text.length > 10) {
            messages.push({
                role: isUser ? 'user' : 'assistant',
                text
            });
        }
    }

    return messages;
}

/**
 * 从消息列表中提取任务概述
 *
 * @param {Array} messages - 消息列表
 * @returns {string}
 */
function extractTaskOverview(messages) {
    // 尝试从第一条用户消息中提取任务概述
    const firstUserMsg = messages.find(m => m.role === 'user');
    if (firstUserMsg) {
        const text = firstUserMsg.text.slice(0, 500);
        return text;
    }
    return '（无法提取任务概述）';
}

/**
 * 下载交接报告为 Markdown 文件
 *
 * @param {string} content - Markdown 内容
 * @param {string} [filename] - 文件名
 */
function downloadHandoff(content, filename) {
    if (!content) return;

    const name = filename || `handoff-${new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-')}.md`;
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ═══════════════════════════════════════════════════
   跨标签页交接
   ═══════════════════════════════════════════════════ */

/** BroadcastChannel 实例 */
let handoffChannel = null;

/**
 * 初始化跨标签页交接通道
 */
function initHandoffChannel() {
    try {
        handoffChannel = new BroadcastChannel('ds_promax_handoff');
        handoffChannel.onmessage = (e) => {
            if (e.data?.type === 'handoff') {
                // 存储接收到的交接内容 — 不自动注入
                try {
                    localStorage.setItem('ds_pending_handoff', JSON.stringify({
                        text: e.data.text,
                        from: e.data.from,
                        url: e.data.url,
                        timestamp: Date.now()
                    }));
                } catch (_) {}
            }
        };
    } catch (e) {
        console.warn('[Handoff] BroadcastChannel 不可用:', e);
    }
}

/**
 * 通过 BroadcastChannel 发送交接内容到其他标签页
 *
 * @param {string} text - 交接内容
 */
function sendHandoffToTabs(text) {
    if (!handoffChannel) return;
    try {
        handoffChannel.postMessage({
            type: 'handoff',
            text,
            from: 'DeepSeek',
            url: location.href
        });
    } catch (_) {}
}

/**
 * 获取待处理的跨标签页交接内容
 *
 * @returns {object|null}
 */
function getPendingHandoff() {
    try {
        const raw = localStorage.getItem('ds_pending_handoff');
        if (!raw) return null;
        const data = JSON.parse(raw);
        // 5 分钟内有效
        if (Date.now() - data.timestamp > 300000) {
            localStorage.removeItem('ds_pending_handoff');
            return null;
        }
        return data;
    } catch (_) {
        return null;
    }
}

/**
 * 清除待处理的交接内容
 */
function clearPendingHandoff() {
    try { localStorage.removeItem('ds_pending_handoff'); } catch (_) {}
}

/* ═══════════════════════════════════════════════════
   初始化
   ═══════════════════════════════════════════════════ */

/**
 * 初始化 Handoff 模块
 */
function initHandoff() {
    initHandoffChannel();
    console.log('[Handoff] 交接模块已初始化');
}


/***/ },

/***/ 433
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   pauseLoop: () => (/* binding */ pauseLoop),
/* harmony export */   requestNotifyPermission: () => (/* binding */ requestNotifyPermission),
/* harmony export */   resetLoop: () => (/* binding */ resetLoop),
/* harmony export */   startLoop: () => (/* binding */ startLoop),
/* harmony export */   stopLoop: () => (/* binding */ stopLoop),
/* harmony export */   tF: () => (/* binding */ initLoopEngine)
/* harmony export */ });
/* unused harmony exports detectSignal, extendLimit, primaryAction, getEngineState */
/* harmony import */ var _config_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(384);
/**
 * 循环引擎模块 (Loop Engine)
 *
 * 灵感来源：Ghost in the Loop
 *
 * 功能：
 *   1. 自动循环对话 — 检测 AI 回复完成，根据信号自动继续
 *   2. 信号检测 — [[GITL::PROCEED]] / [[GITL::HALT]] + 模糊匹配
 *   3. 防自动化延迟 — 8-15 秒随机延迟
 *   4. 崩溃恢复 — 状态持久化到 localStorage
 *   5. 桌面通知 — 循环完成/暂停/出错时通知
 *
 * 状态机：IDLE → RUNNING → (PAUSED | COMPLETE | LIMIT)
 */




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

/* ═══════════════════════════════════════════════════
   循环引擎状态
   ═══════════════════════════════════════════════════ */

/** 循环引擎状态对象 */
const engine = {
    state: 'IDLE',           // IDLE | RUNNING | PAUSED | COMPLETE | LIMIT
    round: 0,                // 当前轮次
    maxRounds: DEFAULT_MAX_ROUNDS,
    phase: 'idle',           // idle | generating | reading | countdown | dispatching | decision
    detail: '',              // 状态详情文本
    lastActivity: 0,         // 最后活动时间戳
    lastSignal: 'none',      // none | proceed | halt | short
    lastConfidence: 0,
    originalTask: '',        // 原始任务文本
    replyKey: '',            // 回复指纹（用于检测稳定性）
    replyStableTicks: 0,     // 稳定 tick 数
    staleTicks: 0,           // 过期 tick 数
    countdownUntil: 0,       // 倒计时结束时间
    isSending: false,        // 是否正在发送
    timer: null,             // tick 定时器
    payloadMode: 'loop',     // loop | roadmap
    needsPayload: true       // 是否需要初始 payload
};

/** 持久化键 */
const STORAGE_KEY = 'ds_loop_engine_state';

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
 *   - 遗留关键词 PROCEED / SYSTEM_HALT: +3 分
 *   - 模糊匹配: +2 分
 *   - 进度条 [Step X of Y] (X<Y): +2 分 proceed; (X>=Y): +1 分 halt
 *
 * HALT 优先：平局时 HALT 获胜
 *
 * @param {string} fullText - AI 的完整回复文本
 * @returns {{signal:string,confidence:number,progress:object|null}}
 */
function detectSignal(fullText) {
    if (!fullText || fullText.length < MIN_RESPONSE_LEN) {
        return { signal: 'short', confidence: 0, progress: null };
    }

    const tail = fullText.slice(-2000);
    const low = tail.toLowerCase();

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

    // 进度条
    if (progress && progress.step < progress.total) pScore += 2;
    if (progress && progress.step >= progress.total) hScore += 1;

    // HALT 优先：平局时 HALT 获胜
    if (hScore >= 3 && hScore >= pScore) return { signal: 'halt', confidence: hScore, progress };
    if (pScore >= 3) return { signal: 'proceed', confidence: pScore, progress };

    return { signal: 'unknown', confidence: 0, progress };
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
 * 向输入框注入文本
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
 * 设置循环阶段
 * @param {string} phase - 阶段名称
 * @param {string} [detail] - 阶段详情
 * @returns {boolean} - 阶段是否变化
 */
function setPhase(phase, detail) {
    const changed = engine.phase !== phase || (detail !== undefined && engine.detail !== detail);
    engine.phase = phase;
    if (detail !== undefined) engine.detail = detail;
    return changed;
}

/**
 * 发送桌面通知
 * @param {string} body - 通知正文
 */
function notify(body) {
    if (!_config_js__WEBPACK_IMPORTED_MODULE_0__/* .CONFIG */ .PI.loopNotifyEnabled) return;
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
async function requestNotifyPermission() {
    try {
        if (typeof Notification === 'undefined') return false;
        if (Notification.permission === 'granted') return true;
        const result = await Notification.requestPermission();
        return result === 'granted';
    } catch (_) {
        return false;
    }
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
   自动发送
   ═══════════════════════════════════════════════════ */

/**
 * 向 DeepSeek 发送消息
 *
 * 流程：
 *   1. 等待随机延迟（防自动化）
 *   2. 检查状态是否仍为 RUNNING
 *   3. 检查 AI 是否正在生成（如果是则中止）
 *   4. 找到输入框并注入文本
 *   5. 验证文本已正确填入
 *   6. 找到发送按钮并点击
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
    engine.isSending = true;

    try {
        // 防自动化延迟
        if (!skipDelay) {
            await countdownDelay(randomDelay(engine.round));
        }

        if (engine.state !== 'RUNNING') return false;

        // 检查 AI 是否正在生成
        if (isGenerating()) {
            setPhase('generating', '⚠ AI 正在生成回复');
            console.warn('[LoopEngine] 发送中止 — AI 正在生成');
            return false;
        }

        setPhase('dispatching', '正在发送消息…');

        // 找到输入框并注入文本
        const input = getInput();
        if (!input) {
            setPhase('error', '⚠ 未找到输入框');
            enginePause('未找到聊天输入框');
            return false;
        }

        if (!injectText(input, text)) {
            setPhase('error', '⚠ 文本注入失败');
            enginePause('输入框拒绝了文本注入');
            return false;
        }

        // 等待 React 状态更新
        await sleep(500);

        // 验证文本已正确填入
        const currentText = getInputText();
        if (currentText.length < 4) {
            setPhase('error', '⚠ 输入框文本验证失败');
            enginePause('提示词未能正确填入输入框');
            return false;
        }

        // 找到发送按钮并点击
        const btn = getSendBtn();
        if (!btn) {
            setPhase('error', '⚠ 未找到发送按钮');
            enginePause('未找到安全的发送按钮 — 请手动发送');
            return false;
        }

        try {
            btn.click();
        } catch (e) {
            setPhase('error', '⚠ 发送按钮点击失败');
            return false;
        }

        engine.lastActivity = Date.now();
        setPhase('waiting', '等待 AI 回复…');
        return true;
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
 *   1. 检查看门狗（90 秒软超时 / 180 秒硬超时）
 *   2. 检查轮次上限
 *   3. 读取最新 AI 回复文本
 *   4. 检测回复稳定性 + 信号
 *   5. 根据信号决定：继续发送 / 停止 / 等待
 */
function engineTick() {
    if (engine.state !== 'RUNNING') return;

    // 看门狗
    const idle = Date.now() - engine.lastActivity;
    if (idle > WATCHDOG_HARD) {
        enginePause('看门狗：3 分钟无活动');
        return;
    }
    if (idle > WATCHDOG_SOFT) {
        setPhase('watchdog', '⚠ 看门狗：90 秒空闲');
    }

    // 轮次上限检查
    if (engine.round >= engine.maxRounds) {
        engineLimit();
        return;
    }

    // 读取最新回复
    const text = getLastReplyText();
    const observation = observeReplyText(text);
    const result = text ? detectSignal(text) : { signal: 'short', confidence: 0, progress: null };
    const stopVisible = isGenerating();

    // 判断回复是否就绪（终止状态）
    const terminalReady = !!text &&
        !!result &&
        ['proceed', 'halt'].includes(result.signal) &&
        !stopVisible &&
        observation.stableTicks >= 1;

    // AI 正在生成
    if (stopVisible && !terminalReady) {
        engine.lastActivity = Date.now();
        engine.staleTicks = 0;
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
        // 路线图模式：检查是否需要综合
        if (engine.payloadMode === 'roadmap') {
            // 委托给 roadmap 模块处理
            const handled = window.__dsRoadmapOnHalt?.();
            if (handled) return;
        }
        engineHalt('✅ 任务完成');
        return;
    }

    // PROCEED 信号 — 继续下一步
    if (result.signal === 'proceed') {
        engine.staleTicks = 0;

        // 路线图模式：检查是否需要发送下一步
        if (engine.payloadMode === 'roadmap') {
            const handled = window.__dsRoadmapOnProceed?.(text);
            if (handled) return;
        }

        // 普通循环模式：发送 "继续"
        engine.round++;
        persistState();
        const continueText = '继续。\n\n[Ghost 循环 — 第 ' + engine.round + ' 轮]\n请继续上一步的工作。完成当前步骤后，如果还有剩余工作，请以 [[GITL::PROCEED]] 结尾；如果任务已全部完成，请以 [[GITL::HALT]] 结尾。';
        engineSend(continueText, false);
        return;
    }
}

/**
 * 启动循环引擎
 * @param {string} [taskText] - 初始任务文本（可选）
 */
function startLoop(taskText) {
    if (engine.state === 'RUNNING') return;

    const input = getInput();
    const hasText = input && getInputText().length > 2;
    const hasMessages = getAssistantMessages().length > 0;

    engine.state = 'RUNNING';
    engine.round = 0;
    engine.staleTicks = 0;
    engine.lastActivity = Date.now();
    engine.detail = '正在启动…';
    engine.needsPayload = !hasText && !hasMessages;

    // 如果有初始任务文本
    if (taskText && taskText.trim()) {
        engine.originalTask = taskText.trim();
        engine.payloadMode = 'loop';
        engine.needsPayload = false;
        engine.timer = setInterval(engineTick, TICK_INTERVAL);
        const fullPrompt = taskText.trim() + '\n\n[循环协议]\n请逐步完成这个任务。每完成一个步骤后，如果需要继续下一步，请以 [[GITL::PROCEED]] 结尾；如果任务已全部完成，请以 [[GITL::HALT]] 结尾。';
        engineSend(fullPrompt, true);
    } else if (hasText) {
        // 输入框有文本 — 发送并开始循环
        engine.originalTask = getInputText();
        engine.needsPayload = false;
        engine.timer = setInterval(engineTick, TICK_INTERVAL);
        const btn = getSendBtn();
        if (btn) btn.click();
    } else if (hasMessages) {
        // 恢复已有对话
        engine.needsPayload = false;
        engine.timer = setInterval(engineTick, TICK_INTERVAL);
        engineSend('继续。\n\n[循环恢复]\n请继续之前的工作。完成后以 [[GITL::PROCEED]] 或 [[GITL::HALT]] 结尾。', true);
    } else {
        engine.detail = '请输入任务或打开已有对话';
        engine.state = 'IDLE';
    }

    persistState();
}

/**
 * 暂停循环引擎
 * @param {string} [reason] - 暂停原因
 */
function pauseLoop(reason) {
    enginePause(reason || '已暂停');
}

/**
 * 引擎暂停（内部）
 * @param {string} reason - 暂停原因
 */
function enginePause(reason) {
    if (engine.timer) {
        clearInterval(engine.timer);
        engine.timer = null;
    }
    engine.state = 'PAUSED';
    engine.detail = reason || '已暂停';
    engine.countdownUntil = 0;
    persistState();
    notify('循环已暂停：' + (reason || ''));
}

/**
 * 引擎停止 — 任务完成
 * @param {string} reason - 完成原因
 */
function engineHalt(reason) {
    if (engine.timer) {
        clearInterval(engine.timer);
        engine.timer = null;
    }
    engine.state = 'COMPLETE';
    engine.detail = reason || '✅ 任务完成';
    engine.countdownUntil = 0;
    clearState();
    notify('循环已完成：' + (reason || ''));
}

/**
 * 引擎达到轮次上限
 */
function engineLimit() {
    if (engine.timer) {
        clearInterval(engine.timer);
        engine.timer = null;
    }
    engine.state = 'LIMIT';
    engine.detail = `已达轮次上限 (${engine.maxRounds}) — 可延长或停止`;
    engine.countdownUntil = 0;
    persistState();
    notify('循环已达轮次上限');
}

/**
 * 停止循环引擎（保留进度）
 */
function stopLoop() {
    if (engine.state === 'IDLE' || engine.state === 'COMPLETE') return;
    enginePause('已停止 — 进度已保留，可继续或重置');
}

/**
 * 重置循环引擎
 */
function resetLoop() {
    if (engine.timer) {
        clearInterval(engine.timer);
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
    engine.originalTask = '';
    engine.lastSignal = 'none';
    engine.lastConfidence = 0;
    engine.needsPayload = true;
    engine.payloadMode = 'loop';
    engine.isSending = false;
    clearState();
}

/**
 * 延长轮次上限
 * @param {number} [extra] - 额外轮次
 */
function extendLimit(extra = 20) {
    engine.maxRounds += extra;
    engine.state = 'RUNNING';
    engine.lastActivity = Date.now();
    engine.timer = setInterval(engineTick, TICK_INTERVAL);
    persistState();
}

/**
 * 主操作按钮 — 根据当前状态决定行为
 */
function primaryAction() {
    const s = engine.state;
    if (s === 'RUNNING') return pauseLoop();
    if (s === 'LIMIT') return extendLimit();
    return startLoop();
}

/**
 * 获取引擎状态
 * @returns {object}
 */
function getEngineState() {
    return {
        state: engine.state,
        round: engine.round,
        maxRounds: engine.maxRounds,
        phase: engine.phase,
        detail: engine.detail,
        lastSignal: engine.lastSignal,
        countdownUntil: engine.countdownUntil,
        payloadMode: engine.payloadMode
    };
}

/**
 * 初始化循环引擎 — 检查崩溃恢复
 */
function initLoopEngine() {
    // 检查崩溃恢复
    if (_config_js__WEBPACK_IMPORTED_MODULE_0__/* .CONFIG */ .PI.loopCrashRecoveryEnabled) {
        const restored = restoreState();
        if (restored) {
            console.log('[LoopEngine] 检测到崩溃恢复状态');
        }
    }

    // 请求通知权限
    if (_config_js__WEBPACK_IMPORTED_MODULE_0__/* .CONFIG */ .PI.loopNotifyEnabled) {
        requestNotifyPermission();
    }

    console.log('[LoopEngine] 循环引擎已初始化');
}

/* ═══════════════════════════════════════════════════
   导出内部函数供 roadmap 模块使用
   ═══════════════════════════════════════════════════ */

const _internals = {
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
    SIGIL_PROCEED,
    SIGIL_HALT,
    SIGIL_ROADMAP,
    TICK_INTERVAL
};

/* harmony export */ __webpack_require__.d(__webpack_exports__, [
/* harmony export */   "wV", 0, /* binding */ _internals
/* harmony export */ ]);


/***/ },

/***/ 350
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   dw: () => (/* binding */ initRoadmap),
/* harmony export */   startQueue: () => (/* binding */ startQueue),
/* harmony export */   startRoadmap: () => (/* binding */ startRoadmap),
/* harmony export */   startThinkFirst: () => (/* binding */ startThinkFirst)
/* harmony export */ });
/* unused harmony exports getRoadmapState, resetRoadmap */
/* harmony import */ var _config_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(384);
/* harmony import */ var _loop_engine_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(433);
/**
 * 路线图自动驾驶 + 提示词队列模块
 *
 * 灵感来源：Ghost in the Loop
 *
 * 功能：
 *   1. Roadmap Autopilot — AI 先生成路线图，脚本逐步执行每个步骤
 *   2. Think First — AI 先创建计划再执行
 *   3. Prompt Queue — 粘贴任务列表，依次自动执行
 *
 * 路线图协议：
 *   - AI 在回复中输出 [[GITL::ROADMAP]] 标记
 *   - 标记后跟编号列表（1. 2. 3. ...）
 *   - 脚本解析列表并逐步执行
 *   - 每步完成后 AI 输出 [[GITL::PROCEED]]
 *   - 全部完成后发送综合指令，AI 输出 [[GITL::HALT]]
 */




/* ═══════════════════════════════════════════════════
   路线图状态
   ═══════════════════════════════════════════════════ */

/** 路线图状态对象 */
const roadmap = {
    steps: [],           // 步骤列表
    index: 0,            // 当前步骤索引
    captured: false,     // 是否已捕获路线图
    synthSent: false,    // 是否已发送综合指令
    _reask: false        // 是否已重新请求格式
};

/** 持久化键 */
const STORAGE_KEY = 'ds_roadmap_state';

/* ═══════════════════════════════════════════════════
   状态持久化
   ═══════════════════════════════════════════════════ */

/**
 * 保存路线图状态到 localStorage
 */
function persistRoadmap() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
            steps: roadmap.steps,
            index: roadmap.index,
            captured: roadmap.captured,
            synthSent: roadmap.synthSent
        }));
    } catch (_) {}
}

/**
 * 从 localStorage 恢复路线图状态
 */
function restoreRoadmap() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        const data = JSON.parse(raw);
        roadmap.steps = data.steps || [];
        roadmap.index = data.index || 0;
        roadmap.captured = data.captured || false;
        roadmap.synthSent = data.synthSent || false;
    } catch (_) {}
}

/**
 * 清除路线图状态
 */
function clearRoadmap() {
    roadmap.steps = [];
    roadmap.index = 0;
    roadmap.captured = false;
    roadmap.synthSent = false;
    roadmap._reask = false;
    try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
}

/* ═══════════════════════════════════════════════════
   路线图解析
   ═══════════════════════════════════════════════════ */

/**
 * 从 AI 回复文本中解析路线图
 *
 * 查找 [[GITL::ROADMAP]] 标记，解析后续的编号列表
 *
 * @param {string} fullText - AI 的完整回复文本
 * @returns {boolean} - 是否成功解析路线图
 */
function parseRoadmap(fullText) {
    const at = fullText.lastIndexOf(_loop_engine_js__WEBPACK_IMPORTED_MODULE_1__/* ._internals */ .wV.SIGIL_ROADMAP);
    if (at < 0) return false;

    const after = fullText.slice(at + _loop_engine_js__WEBPACK_IMPORTED_MODULE_1__/* ._internals */ .wV.SIGIL_ROADMAP.length);
    const steps = [];

    for (const line of after.split('\n')) {
        // 遇到信号标记则停止
        if (line.includes(_loop_engine_js__WEBPACK_IMPORTED_MODULE_1__/* ._internals */ .wV.SIGIL_PROCEED) || line.includes(_loop_engine_js__WEBPACK_IMPORTED_MODULE_1__/* ._internals */ .wV.SIGIL_HALT)) break;

        // 匹配编号列表项：1. xxx / 1) xxx / - xxx / * xxx
        const m = line.match(/^\s*(?:\d+[.)]\s+|[-*]\s+)(.+)$/);
        if (m && m[1].trim().length > 3) {
            steps.push(m[1].trim());
        }

        // 最多 30 步
        if (steps.length >= 30) break;
    }

    if (steps.length < 2) return false;

    roadmap.steps = steps;
    roadmap.index = 0;
    roadmap.captured = true;
    roadmap.synthSent = false;
    persistRoadmap();
    return true;
}

/* ═══════════════════════════════════════════════════
   路线图执行
   ═══════════════════════════════════════════════════ */

/**
 * 发送路线图中的下一个步骤
 *
 * 向 AI 发送格式化的步骤指令：
 *   "Continue.
 *
 *    [Ghost roadmap — step X of N]
 *    步骤内容
 *
 *    Complete this step fully and concretely.
 *    End with [[GITL::PROCEED]] when done,
 *    or [[GITL::HALT]] if the entire roadmap is finished."
 */
function sendRoadmapStep() {
    const R = roadmap;
    const i = R.index;
    const n = R.steps.length;

    _loop_engine_js__WEBPACK_IMPORTED_MODULE_1__/* ._internals */ .wV.setPhase('roadmap', `🗺 步骤 ${i + 1}/${n}`);

    const prompt = `继续。

[路线图 — 第 ${i + 1} 步，共 ${n} 步]
${R.steps[i]}

请完整、具体地完成这一步。只输出交付物，不要废话。
完成后如果还有剩余步骤，请以 [[GITL::PROCEED]] 结尾；
如果整个路线图已全部完成，请以 [[GITL::HALT]] 结尾。`;

    _loop_engine_js__WEBPACK_IMPORTED_MODULE_1__/* ._internals */ .wV.engineSend(prompt, false).then(ok => {
        if (ok) {
            R.index = i + 1;
            persistRoadmap();
        }
    });
}

/**
 * 发送路线图最终综合指令
 *
 * 所有步骤完成后，让 AI 汇总所有步骤的输出
 */
function sendRoadmapSynthesis() {
    _loop_engine_js__WEBPACK_IMPORTED_MODULE_1__/* ._internals */ .wV.setPhase('synthesis', '🗺 最终综合');

    const prompt = `继续。

[路线图 — 最终综合]
所有路线图步骤已完成。请编译最终交付物：
将每一步的输出合并为一个完整、干净、可直接使用的结果。
不要回顾过程，不要废话。以 [[GITL::HALT]] 结尾。`;

    _loop_engine_js__WEBPACK_IMPORTED_MODULE_1__/* ._internals */ .wV.engineSend(prompt, false).then(ok => {
        roadmap.synthSent = !!ok;
        persistRoadmap();
    });
}

/**
 * 重新请求路线图格式
 *
 * 当 AI 回复了 PROCEED 但没有 [[GITL::ROADMAP]] 标记时，
 * 请求 AI 只输出路线图块
 */
function reaskRoadmap() {
    roadmap._reask = true;
    _loop_engine_js__WEBPACK_IMPORTED_MODULE_1__/* ._internals */ .wV.setPhase('roadmap', '🗺 未检测到路线图块 — 重新请求格式…');

    const prompt = `在上一条回复中未检测到 [[GITL::ROADMAP]] 标记。
请不要重新研究或执行任何内容。只输出路线图，格式如下：

[[GITL::ROADMAP]]
1. 第一个具体步骤
2. 第二个具体步骤
3. ...

（3-12 步，每步自包含）以 [[GITL::PROCEED]] 结尾。`;

    _loop_engine_js__WEBPACK_IMPORTED_MODULE_1__/* ._internals */ .wV.engineSend(prompt, false);
}

/* ═══════════════════════════════════════════════════
   信号回调 — 供 loop-engine 调用
   ═══════════════════════════════════════════════════ */

/**
 * PROCEED 信号回调 — 路线图模式下处理下一步
 *
 * @param {string} text - AI 回复文本
 * @returns {boolean} - 是否已处理
 */
function onProceed(text) {
    if (_loop_engine_js__WEBPACK_IMPORTED_MODULE_1__/* ._internals */ .wV.engine.payloadMode !== 'roadmap') return false;

    const R = roadmap;
    if (!R.captured) {
        // 尝试解析路线图
        if (parseRoadmap(text)) {
            _loop_engine_js__WEBPACK_IMPORTED_MODULE_1__/* ._internals */ .wV.setPhase('roadmap', `🗺 路线图已捕获：${R.steps.length} 步`);
            sendRoadmapStep();
            return true;
        }
        // 未检测到路线图块 — 重新请求一次
        if (!R._reask) {
            reaskRoadmap();
            return true;
        }
        // 重新请求后仍未检测到 — 回退到普通循环
        return false;
    }

    // 路线图已捕获 — 检查是否还有剩余步骤
    if (R.index < R.steps.length) {
        sendRoadmapStep();
        return true;
    }

    // 所有步骤已完成 — 发送综合指令
    if (!R.synthSent) {
        sendRoadmapSynthesis();
        return true;
    }

    return false;
}

/**
 * HALT 信号回调 — 路线图模式下处理完成
 *
 * @returns {boolean} - 是否已处理
 */
function onHalt() {
    if (_loop_engine_js__WEBPACK_IMPORTED_MODULE_1__/* ._internals */ .wV.engine.payloadMode !== 'roadmap') return false;

    const R = roadmap;
    if (!R.captured) return false;

    // 所有步骤已完成且综合已发送 — 真正完成
    if (R.index >= R.steps.length && R.synthSent) {
        clearRoadmap();
        return false; // 让引擎执行正常的 HALT
    }

    // 步骤未完成但 AI 发了 HALT — 停止
    if (R.index < R.steps.length) {
        _loop_engine_js__WEBPACK_IMPORTED_MODULE_1__/* ._internals */ .wV.enginePause(`路线图在第 ${R.index}/${R.steps.length} 步暂停 — AI 发出了 HALT 信号`);
        return true;
    }

    // 所有步骤完成但综合未发送 — 发送综合
    if (!R.synthSent) {
        sendRoadmapSynthesis();
        return true;
    }

    clearRoadmap();
    return false;
}

// 注册回调到全局
window.__dsRoadmapOnProceed = onProceed;
window.__dsRoadmapOnHalt = onHalt;

/* ═══════════════════════════════════════════════════
   公共 API
   ═══════════════════════════════════════════════════ */

/**
 * 启动路线图自动驾驶
 *
 * 向 AI 发送任务，要求 AI 先生成路线图再执行
 *
 * @param {string} task - 任务描述
 */
function startRoadmap(task) {
    if (!task || !task.trim()) return;

    clearRoadmap();
    _loop_engine_js__WEBPACK_IMPORTED_MODULE_1__/* ._internals */ .wV.engine.payloadMode = 'roadmap';
    _loop_engine_js__WEBPACK_IMPORTED_MODULE_1__/* ._internals */ .wV.engine.originalTask = task.trim();

    const prompt = `${task.trim()}

[路线图自动驾驶协议]
在执行任务之前，先创建一个路线图。路线图是一个编号列表，包含 3-12 个具体、自包含的步骤。

输出格式：
[[GITL::ROADMAP]]
1. 第一个具体步骤
2. 第二个具体步骤
3. ...

然后以 [[GITL::PROCEED]] 结尾。

之后我会逐步指示你执行每个步骤。每步完成后以 [[GITL::PROCEED]] 结尾，全部完成后以 [[GITL::HALT]] 结尾。`;

    // 启动引擎
    Promise.resolve(/* import() */).then(__webpack_require__.bind(__webpack_require__, 433)).then(({ startLoop }) => {
        startLoop(prompt);
    });
}

/**
 * 启动 Think First 模式
 *
 * AI 先创建计划，然后执行
 *
 * @param {string} task - 任务描述
 */
function startThinkFirst(task) {
    if (!task || !task.trim()) return;

    clearRoadmap();
    _loop_engine_js__WEBPACK_IMPORTED_MODULE_1__/* ._internals */ .wV.engine.payloadMode = 'roadmap';

    const prompt = `${task.trim()}

[Think First 协议]
在执行之前，先制定计划：
1. 分析任务目标和约束
2. 列出关键步骤
3. 识别潜在风险

输出格式：
[[GITL::ROADMAP]]
1. 第一个步骤
2. 第二个步骤
3. ...

然后以 [[GITL::PROCEED]] 结尾。之后我会逐步指示你执行。`;

    Promise.resolve(/* import() */).then(__webpack_require__.bind(__webpack_require__, 433)).then(({ startLoop }) => {
        startLoop(prompt);
    });
}

/**
 * 启动提示词队列
 *
 * 将用户粘贴的多行文本解析为步骤列表，依次执行
 *
 * @param {string} rawLines - 多行文本（每行一个任务）
 */
function startQueue(rawLines) {
    if (!rawLines || !rawLines.trim()) return;

    // 解析步骤：去除编号前缀，过滤空行
    const steps = rawLines
        .split('\n')
        .map(s => s.replace(/^\s*(?:\d+[.)]\s+|[-*]\s+)?/, '').trim())
        .filter(s => s.length > 2)
        .slice(0, 30);

    if (!steps.length) return;

    // 设置路线图状态（复用路线图执行机制）
    roadmap.steps = steps;
    roadmap.index = 0;
    roadmap.captured = true;
    roadmap.synthSent = false;
    persistRoadmap();

    // 启动引擎
    _loop_engine_js__WEBPACK_IMPORTED_MODULE_1__/* ._internals */ .wV.engine.payloadMode = 'roadmap';
    _loop_engine_js__WEBPACK_IMPORTED_MODULE_1__/* ._internals */ .wV.engine.originalTask = steps[0];

    Promise.resolve(/* import() */).then(__webpack_require__.bind(__webpack_require__, 433)).then(({ startLoop }) => {
        // 先发送第一个步骤
        startLoop(`继续。

[提示词队列 — 第 1 步，共 ${steps.length} 步]
${steps[0]}

请完整、具体地完成这一步。
完成后如果还有剩余步骤，请以 [[GITL::PROCEED]] 结尾；
如果整个队列已全部完成，请以 [[GITL::HALT]] 结尾。`);
    });

    // 直接发送第一个步骤（绕过路线图解析）
    roadmap.index = 1; // 已经发送了第 0 步
    persistRoadmap();
}

/**
 * 获取路线图状态
 * @returns {object}
 */
function getRoadmapState() {
    return {
        steps: roadmap.steps,
        index: roadmap.index,
        captured: roadmap.captured,
        synthSent: roadmap.synthSent,
        total: roadmap.steps.length
    };
}

/**
 * 重置路线图
 */
function resetRoadmap() {
    clearRoadmap();
}

/**
 * 初始化路线图模块 — 恢复持久化状态
 */
function initRoadmap() {
    restoreRoadmap();
    console.log('[Roadmap] 路线图模块已初始化');
}


/***/ }

/******/ 	});
/************************************************************************/
/******/ 	// The module cache
/******/ 	const __webpack_module_cache__ = {};
/******/ 	
/******/ 	// The require function
/******/ 	function __webpack_require__(moduleId) {
/******/ 		// Check if module is in cache
/******/ 		const cachedModule = __webpack_module_cache__[moduleId];
/******/ 		if (cachedModule !== undefined) {
/******/ 			return cachedModule.exports;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		const module = __webpack_module_cache__[moduleId] = {
/******/ 			// no module.id needed
/******/ 			// no module.loaded needed
/******/ 			exports: {}
/******/ 		};
/******/ 	
/******/ 		// Execute the module function
/******/ 		__webpack_modules__[moduleId](module, module.exports, __webpack_require__);
/******/ 	
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/ 	
/************************************************************************/
/******/ 	/* webpack/runtime/define property getters */
/******/ 	(() => {
/******/ 		// define getter/value functions for harmony exports
/******/ 		__webpack_require__.d = (exports, definition) => {
/******/ 			if(Array.isArray(definition)) {
/******/ 				var i = 0;
/******/ 				while(i < definition.length) {
/******/ 					var key = definition[i++];
/******/ 					var binding = definition[i++];
/******/ 					if(!__webpack_require__.o(exports, key)) {
/******/ 						if(binding === 0) {
/******/ 							Object.defineProperty(exports, key, { enumerable: true, value: definition[i++] });
/******/ 						} else {
/******/ 							Object.defineProperty(exports, key, { enumerable: true, get: binding });
/******/ 						}
/******/ 					} else if(binding === 0) { i++; }
/******/ 				}
/******/ 			} else {
/******/ 				for(var key in definition) {
/******/ 					if(__webpack_require__.o(definition, key) && !__webpack_require__.o(exports, key)) {
/******/ 						Object.defineProperty(exports, key, { enumerable: true, get: definition[key] });
/******/ 					}
/******/ 				}
/******/ 			}
/******/ 		};
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/hasOwnProperty shorthand */
/******/ 	(() => {
/******/ 		__webpack_require__.o = (obj, prop) => (Object.prototype.hasOwnProperty.call(obj, prop))
/******/ 	})();
/******/ 	
/************************************************************************/
let __webpack_exports__ = {};

// EXTERNAL MODULE: ./src/config.js
var config = __webpack_require__(384);
;// ./src/utils.js
/**
 * 工具函数模块
 *
 * 提供全局共享的工具方法：防抖、暗色模式检测、图片 URL 判断、
 * 角标文本清理、Markdown 图片提取、DOM 节点状态检查等。
 */

const utils = {
    /**
     * 防抖函数
     * @param {Function} fn - 需要防抖的函数
     * @param {number} delay - 延迟毫秒数
     * @returns {Function} 防抖后的函数
     */
    debounce(fn, delay) {
        let timer;
        return function (...args) {
            clearTimeout(timer);
            timer = setTimeout(() => fn.apply(this, args), delay);
        };
    },

    /**
     * 检测当前是否为暗色模式
     * @returns {boolean}
     */
    isDarkMode() {
        const html = document.documentElement;
        if (html.hasAttribute('data-theme')) return html.getAttribute('data-theme') === 'dark';
        if (html.classList.contains('dark')) return true;
        const bgColor = getComputedStyle(document.body).backgroundColor;
        if (bgColor) {
            const rgb = bgColor.match(/\d+/g);
            if (rgb && rgb.length >= 3) {
                const brightness = (rgb[0] * 299 + rgb[1] * 587 + rgb[2] * 114) / 1000;
                return brightness < 128;
            }
        }
        return window.matchMedia('(prefers-color-scheme: dark)').matches;
    },

    /**
     * 判断 URL 是否指向图片资源
     * @param {string} url
     * @returns {boolean}
     */
    isImageUrl(url) {
        if (!url) return false;
        const extRegex = /\.(jpe?g|png|gif|bmp|webp|svg|avif|tif|tiff|ico)(\?.*)?$/i;
        if (extRegex.test(url)) return true;
        const imageHosts = ['imgur.com', 'cloudinary.com', 'images.unsplash.com', 'cdn.pixabay.com', 'i.ibb.co', 'image.lexica.art'];
        try {
            const host = new URL(url).hostname.replace(/^www\./, '');
            if (imageHosts.some(h => host.includes(h))) return true;
        } catch (_) {}
        return false;
    },

    /**
     * 移除文本中的角标标记 [reference:N] / [citation:N]
     * @param {string} text
     * @returns {string}
     */
    removeCitationText(text) {
        if (!text) return text;
        return text.replace(/\[(?:reference|citation):\d+\]/gi, '');
    },

    /**
     * 判断元素是否为角标元素
     * @param {Element} el
     * @returns {boolean}
     */
    isCitationElement(el) {
        if (!el) return false;
        if (el.matches && el.matches('.ds-markdown-cite, ._2ed5dee, cite, sup, [data-citation]')) return true;
        if (el.classList && (el.classList.contains('ds-markdown-cite') || el.classList.contains('_2ed5dee'))) return true;
        if (el.matches && el.matches('[data-citation]')) return true;
        const citeSpan = el.querySelector('span.ds-markdown-cite, span._2ed5dee');
        if (citeSpan) return true;
        if (el.textContent && /\[(?:reference|citation):\d+\]/i.test(el.textContent)) return true;
        if (el.classList && el.classList.contains('_49c6e07')) return true;
        return false;
    },

    /**
     * 从文本中提取 Markdown 图片语法 ![alt](url)
     * @param {string} text
     * @returns {Array<{alt:string,url:string,index:number,length:number}>}
     */
    extractMarkdownImage(text) {
        const regex = /!\[([^\]]*)\]\(([^)]+)\)/g;
        const matches = [];
        let match;
        while ((match = regex.exec(text)) !== null) {
            if (this.isImageUrl(match[2])) {
                matches.push({ alt: match[1], url: match[2], index: match.index, length: match[0].length });
            }
        }
        return matches;
    },

    /**
     * 从文本中提取纯图片 URL
     * @param {string} text
     * @returns {Array<{url:string,index:number,length:number}>}
     */
    extractPlainImageUrls(text) {
        const regex = /https?:\/\/[^\s"'<>]+\.(?:jpe?g|png|gif|bmp|webp|svg|avif)(?:\?[^\s"'<>]*)?/gi;
        return [...text.matchAll(regex)].map(m => ({ url: m[0], index: m.index, length: m[0].length }));
    },

    /**
     * 检查节点是否仍然附加在 DOM 中
     * @param {Node} node
     * @returns {boolean}
     */
    isNodeAttached(node) {
        return node && node.parentNode && document.contains(node);
    },

    /**
     * 检查节点是否位于代码块内
     * @param {Node} node
     * @returns {boolean}
     */
    isInsideCodeBlock(node) {
        let current = node;
        while (current && current.nodeType === 1) {
            const tag = current.tagName.toLowerCase();
            if (tag === 'pre' || tag === 'code') return true;
            if (current.classList) {
                for (const cls of current.classList) {
                    if (cls.includes('code') || cls.includes('Code') || cls === 'md-code-block' || cls === 'ds-markdown-code') {
                        return true;
                    }
                }
            }
            current = current.parentNode;
        }
        return false;
    }
};

;// ./src/themes.js
/**
 * 主题颜色配置模块
 *
 * 定义所有可用主题（pink/blue/purple/green/orange）的亮色/暗色配色方案，
 * 并提供根据主题名 + 暗色模式获取配色对象的函数。
 */


/** 主题配色表：每个主题包含 light / dark 两套配色 */
const THEMES = {
    pink: {
        light: { primary: '#f08ca8', primaryHover: '#e67a97', accent: '#ffb7c5', bgSoft: '#fff5f7', cardBg: '#ffffff', border: '#fcd5df', textPrimary: '#4a3040', glow: 'rgba(240,140,168,0.45)', deepThinkActive: '#f08ca8', buttonBg: '#f08ca8', buttonHover: '#e67a97', mainBorderGlow: 'rgba(240,140,168,0.6)', thinkPanelBg: '#fff0f4', thinkPanelBorder: '#fbc0cb', thinkTitleColor: '#e67a97', msgBubbleBg: '#fff5f7', msgBubbleBorder: '#fcd5df', codeBg: '#fce8ed', linkColor: '#e67a97', thinkBg: '#fff0f4' },
        dark: { primary: '#e895a8', primaryHover: '#f0a0b5', accent: '#d47890', bgSoft: '#1a1020', cardBg: '#1e1625', border: '#3d2840', textPrimary: '#e8d5dd', glow: 'rgba(220,140,160,0.4)', deepThinkActive: '#e895a8', buttonBg: '#e895a8', buttonHover: '#f0a0b5', mainBorderGlow: 'rgba(220,140,160,0.55)', thinkPanelBg: '#2a1d28', thinkPanelBorder: '#5a3a50', thinkTitleColor: '#e895a8', msgBubbleBg: '#2a1d28', msgBubbleBorder: '#5a3a50', codeBg: '#2d1f2a', linkColor: '#f0a0b5', thinkBg: '#2a1d28' }
    },
    blue: {
        light: { primary: '#6ba3e8', primaryHover: '#5a92d4', accent: '#a8c9f5', bgSoft: '#f0f6ff', cardBg: '#ffffff', border: '#c5ddf7', textPrimary: '#1f3a5f', glow: 'rgba(107,163,232,0.45)', deepThinkActive: '#6ba3e8', buttonBg: '#6ba3e8', buttonHover: '#5a92d4', mainBorderGlow: 'rgba(107,163,232,0.6)', thinkPanelBg: '#eaf2fb', thinkPanelBorder: '#b8d4f0', thinkTitleColor: '#5a92d4', msgBubbleBg: '#f0f6ff', msgBubbleBorder: '#c5ddf7', codeBg: '#e3edf9', linkColor: '#5a92d4', thinkBg: '#eaf2fb' },
        dark: { primary: '#7db5f2', primaryHover: '#8ec2f7', accent: '#5a8bbf', bgSoft: '#0e1a2a', cardBg: '#132033', border: '#2a405a', textPrimary: '#d0e0f0', glow: 'rgba(107,163,232,0.4)', deepThinkActive: '#7db5f2', buttonBg: '#7db5f2', buttonHover: '#8ec2f7', mainBorderGlow: 'rgba(107,163,232,0.55)', thinkPanelBg: '#1a2a3f', thinkPanelBorder: '#3a5a7a', thinkTitleColor: '#7db5f2', msgBubbleBg: '#1a2a3f', msgBubbleBorder: '#3a5a7a', codeBg: '#1f3147', linkColor: '#8ec2f7', thinkBg: '#1a2a3f' }
    },
    purple: {
        light: { primary: '#b47bd5', primaryHover: '#a068c7', accent: '#d8b8ec', bgSoft: '#f7f0fc', cardBg: '#ffffff', border: '#dcc8ec', textPrimary: '#3a2350', glow: 'rgba(180,123,213,0.45)', deepThinkActive: '#b47bd5', buttonBg: '#b47bd5', buttonHover: '#a068c7', mainBorderGlow: 'rgba(180,123,213,0.6)', thinkPanelBg: '#f1e8fa', thinkPanelBorder: '#d4b8e8', thinkTitleColor: '#a068c7', msgBubbleBg: '#f7f0fc', msgBubbleBorder: '#dcc8ec', codeBg: '#ede0f7', linkColor: '#a068c7', thinkBg: '#f1e8fa' },
        dark: { primary: '#c99ce6', primaryHover: '#d6b0f0', accent: '#8a6aad', bgSoft: '#1a1028', cardBg: '#201833', border: '#3d2a5a', textPrimary: '#e0d0f0', glow: 'rgba(180,123,213,0.4)', deepThinkActive: '#c99ce6', buttonBg: '#c99ce6', buttonHover: '#d6b0f0', mainBorderGlow: 'rgba(180,123,213,0.55)', thinkPanelBg: '#281f3a', thinkPanelBorder: '#4d3a6a', thinkTitleColor: '#c99ce6', msgBubbleBg: '#281f3a', msgBubbleBorder: '#4d3a6a', codeBg: '#2f2347', linkColor: '#d6b0f0', thinkBg: '#281f3a' }
    },
    green: {
        light: { primary: '#6bc9a8', primaryHover: '#58b897', accent: '#a8e0cb', bgSoft: '#f0faf5', cardBg: '#ffffff', border: '#b8e0d0', textPrimary: '#1a4a3a', glow: 'rgba(107,201,168,0.45)', deepThinkActive: '#6bc9a8', buttonBg: '#6bc9a8', buttonHover: '#58b897', mainBorderGlow: 'rgba(107,201,168,0.6)', thinkPanelBg: '#e5f7f0', thinkPanelBorder: '#b0dac8', thinkTitleColor: '#58b897', msgBubbleBg: '#f0faf5', msgBubbleBorder: '#b8e0d0', codeBg: '#e2f2ea', linkColor: '#58b897', thinkBg: '#e5f7f0' },
        dark: { primary: '#7dd9b8', primaryHover: '#90e6c8', accent: '#4d9a80', bgSoft: '#0c1f18', cardBg: '#122a20', border: '#2a4a3a', textPrimary: '#c8e8dd', glow: 'rgba(107,201,168,0.4)', deepThinkActive: '#7dd9b8', buttonBg: '#7dd9b8', buttonHover: '#90e6c8', mainBorderGlow: 'rgba(107,201,168,0.55)', thinkPanelBg: '#1a3328', thinkPanelBorder: '#3a5a4a', thinkTitleColor: '#7dd9b8', msgBubbleBg: '#1a3328', msgBubbleBorder: '#3a5a4a', codeBg: '#203f30', linkColor: '#90e6c8', thinkBg: '#1a3328' }
    },
    orange: {
        light: { primary: '#e8a86b', primaryHover: '#d99555', accent: '#f5cba0', bgSoft: '#fdf7f0', cardBg: '#ffffff', border: '#f0d5b8', textPrimary: '#5a3a20', glow: 'rgba(232,168,107,0.45)', deepThinkActive: '#e8a86b', buttonBg: '#e8a86b', buttonHover: '#d99555', mainBorderGlow: 'rgba(232,168,107,0.6)', thinkPanelBg: '#fcf0e5', thinkPanelBorder: '#f0d0b8', thinkTitleColor: '#d99555', msgBubbleBg: '#fdf7f0', msgBubbleBorder: '#f0d5b8', codeBg: '#f7ece0', linkColor: '#d99555', thinkBg: '#fcf0e5' },
        dark: { primary: '#f0b87a', primaryHover: '#f8c88a', accent: '#c08a5a', bgSoft: '#1f150a', cardBg: '#2a1f12', border: '#4a3a2a', textPrimary: '#f0e0d0', glow: 'rgba(232,168,107,0.4)', deepThinkActive: '#f0b87a', buttonBg: '#f0b87a', buttonHover: '#f8c88a', mainBorderGlow: 'rgba(232,168,107,0.55)', thinkPanelBg: '#33281a', thinkPanelBorder: '#5a4a3a', thinkTitleColor: '#f0b87a', msgBubbleBg: '#33281a', msgBubbleBorder: '#5a4a3a', codeBg: '#3d3020', linkColor: '#f8c88a', thinkBg: '#33281a' }
    },
    border: {
        light: { primary: '#793f82', primaryHover: '#9B7AA0', accent: '#9B7AA0', bgSoft: '#F9F6F4', cardBg: '#FEFBF5', border: '#F2E0E4', textPrimary: '#4A4348', glow: 'rgba(121,63,130,0.35)', deepThinkActive: '#793f82', buttonBg: '#793f82', buttonHover: '#9B7AA0', mainBorderGlow: 'rgba(121,63,130,0.5)', thinkPanelBg: '#F2E0E4', thinkPanelBorder: '#EBE4F0', thinkTitleColor: '#9B7AA0', msgBubbleBg: '#F9F6F4', msgBubbleBorder: '#F2E0E4', codeBg: '#F2E0E4', linkColor: '#9B7AA0', thinkBg: '#F2E0E4' },
        dark: { primary: '#7c8df4', primaryHover: '#9bb0ff', accent: '#7c8df4', bgSoft: '#27282e', cardBg: '#2d2e34', border: '#32333a', textPrimary: 'hsl(232,6%,88%)', glow: 'rgba(124,141,244,0.35)', deepThinkActive: '#7c8df4', buttonBg: '#7c8df4', buttonHover: '#9bb0ff', mainBorderGlow: 'rgba(124,141,244,0.5)', thinkPanelBg: '#2d2e34', thinkPanelBorder: '#32333a', thinkTitleColor: '#9bb0ff', msgBubbleBg: '#2d2e34', msgBubbleBorder: '#32333a', codeBg: '#32333a', linkColor: '#9bb0ff', thinkBg: '#2d2e34' }
    }
};

/**
 * 根据主题名获取当前暗色/亮色模式下的配色对象
 * @param {string} themeName - 主题名（pink/blue/purple/green/orange/original）
 * @returns {Object|null} 配色对象，original 主题返回 null
 */
function getThemeColors(themeName) {
    if (themeName === 'original') return null;
    const theme = THEMES[themeName] || THEMES.pink;
    return theme[utils.isDarkMode() ? 'dark' : 'light'];
}

;// ./src/customizations/border-theme.js
/**
 * Obsidian Border 主题专属样式
 *
 * 仅包含 Border 主题独有的视觉特性：
 *   - 覆盖 DeepSeek 的 --dsw-alias-* CSS 变量系统
 *   - 浅色模式：晨光花园动态渐变背景
 *   - 深色模式：Border 风格纯色背景
 *
 * 通用增强样式（标题竖条、引用块点阵、文字颜色等）已在 styles.js 的
 * getEnhancedThemeCSS() 中统一处理，所有非 original 主题共享。
 *
 * 灵感来源：Obsidian Border 主题
 */

/**
 * 获取 Border 主题的专属 CSS 样式
 * @param {boolean} isDark - 是否为深色模式
 * @returns {string} CSS 文本
 */
function getBorderThemeCSS(isDark) {
    return `
        /* ========== 浅色模式 - 晨光花园渐变背景 ========== */
        body:not([data-ds-dark-theme]) {
            --dsw-alias-bg-base: #F9F6F400;
            --dsw-alias-bg-layer-1: #F9F6F400;
            --dsw-alias-bg-layer-2: #F2E0E4;
            --dsw-alias-bg-layer-3: #EBE4F0;
            --dsw-alias-label-primary: #4A4348;
            --dsw-alias-label-secondary: #8B7F88;
            --dsw-alias-label-tertiary: #A9A0A6;
            --dsw-alias-label-caption: #8B7F88;
            --dsw-alias-brand-primary: #793f82;
            --dsw-alias-brand-text: #9B7AA0;
            --dsw-alias-border-l1: rgba(74,67,72,0.06);
            --dsw-alias-border-l2: rgba(74,67,72,0.10);
            --dsw-alias-border-l3: rgba(74,67,72,0.14);
            --dsw-alias-markdown-inline-code: #F2E0E4;
            --dsw-alias-markdown-code-block: #FEFBF5;
            --dsw-alias-markdown-code-block-banner: #F7F0E3;
            background-color: #F9F6F4;
            background-image:
                radial-gradient(ellipse 80% 60% at 20% 40%, rgba(235,213,216,0.5) 0%, transparent 70%),
                radial-gradient(ellipse 70% 80% at 75% 25%, rgba(220,209,228,0.4) 0%, transparent 70%),
                radial-gradient(ellipse 60% 70% at 50% 80%, rgba(211,224,223,0.45) 0%, transparent 70%);
            background-size: 120% 120%;
            animation: morningGardenShift 3s ease-in-out infinite alternate;
        }
        @keyframes morningGardenShift {
            0% { background-position: 0% 0%, 100% 0%, 50% 100%; }
            50% { background-position: 80% 60%, 10% 80%, 90% 20%; }
            100% { background-position: 30% 90%, 70% 30%, 10% 60%; }
        }
        html, #root, #root > div { background: inherit !important; }
        body:not([data-ds-dark-theme])::before {
            content: ""; position: fixed; top: 0; left: 0; right: 0; bottom: 0; z-index: -999;
            background-color: #F9F6F4;
            background-image:
                radial-gradient(ellipse 80% 60% at 20% 40%, rgba(235,213,216,0.5) 0%, transparent 70%),
                radial-gradient(ellipse 70% 80% at 75% 25%, rgba(220,209,228,0.4) 0%, transparent 70%),
                radial-gradient(ellipse 60% 70% at 50% 80%, rgba(211,224,223,0.45) 0%, transparent 70%);
            background-size: 120% 120%;
            animation: morningGardenShift 3s ease-in-out infinite alternate;
            pointer-events: none;
        }

        /* ========== 深色模式 - Border 风格 ========== */
        body[data-ds-dark-theme] {
            background-image: none !important;
            background-size: auto !important;
            animation: none !important;
            background-color: #27282e !important;
            --dsw-alias-bg-base: #27282e;
            --dsw-alias-bg-layer-1: #27282e;
            --dsw-alias-bg-layer-2: #2d2e34;
            --dsw-alias-bg-layer-3: #32333a;
            --dsw-alias-label-primary: hsl(232,6%,88%);
            --dsw-alias-label-secondary: hsl(232,9%,64%);
            --dsw-alias-label-tertiary: hsl(232,12%,48%);
            --dsw-alias-label-caption: hsl(232,9%,56%);
            --dsw-alias-brand-primary: hsl(232,70%,65%);
            --dsw-alias-brand-text: hsl(232,70%,70%);
        }
        body[data-ds-dark-theme]::before { display: none !important; }
        body[data-ds-dark-theme] ._189b4a0,
        body[data-ds-dark-theme] ._6ffc3c9 { background-color: #27282e; }
    `;
}

;// ./src/styles.js
/**
 * 样式注入模块
 *
 * 管理主题 CSS、窄边距 CSS、Mermaid CSS 的注入与缓存。
 * 当主题、暗色模式、图片渲染开关或窄边距开关变化时，重新注入对应样式。
 */





/**
 * 通用主题增强样式（标题竖条、引用块点阵、文字颜色、侧边栏透明化等）
 * 使用 --anime-* CSS 变量，自动适配每个主题的配色方案
 * @param {boolean} isDark - 是否为深色模式
 * @returns {string} CSS 文本
 */
function getEnhancedThemeCSS(isDark) {
    const dotColor = isDark ? '%23ffffff' : '%23000000';
    const dotOpacity = isDark ? '0.10' : '0.08';
    return `
        /* ========== 消息宽度优化 ========== */
        :root { --message-list-max-width: 75%; }
        .ds-markdown table { width: max-content; max-width: 70%; }

        /* ========== 标题左侧彩色竖条 ========== */
        .ds-markdown h1, .ds-markdown h2, .ds-markdown h3,
        .ds-markdown h4, .ds-markdown h5, .ds-markdown h6 {
            border-left: none !important;
            padding-left: 16px !important;
            position: relative;
        }
        .ds-markdown h1::before, .ds-markdown h2::before, .ds-markdown h3::before,
        .ds-markdown h4::before, .ds-markdown h5::before, .ds-markdown h6::before {
            content: ""; position: absolute; left: 0; top: 4px; bottom: 4px;
            width: 4px; border-radius: 4px;
        }
        .ds-markdown h1::before { background: var(--anime-primary); }
        .ds-markdown h2::before { background: var(--anime-accent); }
        .ds-markdown h3::before { background: var(--anime-link-color); }
        .ds-markdown h4::before { background: var(--anime-primary); opacity: 0.65; }
        .ds-markdown h5::before { background: var(--anime-accent); opacity: 0.65; }
        .ds-markdown h6::before { background: var(--anime-link-color); opacity: 0.65; }

        /* ========== 引用块点阵图案 + 左侧竖条 ========== */
        .ds-markdown blockquote {
            border-left: none !important;
            border-radius: 6px;
            background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='4' height='4' viewBox='0 0 4 4'%3E%3Cpath fill='${dotColor}' fill-opacity='${dotOpacity}' d='M1 3h1v1H1V3zm2-2h1v1H3V1z'%3E%3C/path%3E%3C/svg%3E");
            position: relative;
        }
        .ds-markdown blockquote blockquote { background-image: none !important; }
        .ds-markdown blockquote::before {
            content: ""; position: absolute; left: 0; top: 8px; bottom: 8px;
            width: 4px; border-radius: 4px;
            background: var(--anime-primary);
        }

        /* ========== 文字颜色增强 ========== */
        .ds-markdown strong { color: var(--anime-primary) !important; }
        .ds-markdown em { color: var(--anime-accent) !important; }
        .ds-markdown code:not(pre code):not(.md-code-block code) { color: var(--anime-link-color) !important; }

        /* ========== 数学公式颜色 ========== */
        .ds-markdown-math, .katex, .katex *,
        .math-inline, .math-block { color: var(--anime-link-color) !important; }

        /* ========== 侧边栏/头部透明化（排除思考面板容器 _5ab5d64 / _245c867） ========== */
        .b8812f16, ._519be07, ._233f913,
        .f8d1e4c0, .the-header, .f3d18f6a, ._74c0879,
        ._1d72f01 {
            background-color: transparent !important;
            background: transparent !important;
        }
    `;
}

// 样式缓存状态
let currentThemeName = null;
let currentDarkMode = null;
let currentNarrowState = null;
let currentImageRenderState = null;

/**
 * 确保三个 <style> 元素存在（主题、窄边距、Mermaid）
 * @returns {{themeStyle:HTMLStyleElement, narrowStyle:HTMLStyleElement, mermaidStyle:HTMLStyleElement}}
 */
function ensureStyleElements() {
    let themeStyle = document.getElementById('anime-theme-style');
    if (!themeStyle) {
        themeStyle = document.createElement('style');
        themeStyle.id = 'anime-theme-style';
        document.head.appendChild(themeStyle);
    }
    let narrowStyle = document.getElementById('anime-narrow-style');
    if (!narrowStyle) {
        narrowStyle = document.createElement('style');
        narrowStyle.id = 'anime-narrow-style';
        document.head.appendChild(narrowStyle);
    }
    let mermaidStyle = document.getElementById('anime-mermaid-style');
    if (!mermaidStyle) {
        mermaidStyle = document.createElement('style');
        mermaidStyle.id = 'anime-mermaid-style';
        document.head.appendChild(mermaidStyle);
    }
    return { themeStyle, narrowStyle, mermaidStyle };
}

/**
 * 注入所有样式：主题 CSS + 窄边距 CSS + Mermaid CSS
 * 使用缓存避免重复注入，仅在配置变化时更新。
 */
function injectStyles() {
    const { themeStyle, narrowStyle, mermaidStyle } = ensureStyleElements();
    const themeName = config/* CONFIG */.PI.themeColor || 'pink';
    const narrowOn = config/* CONFIG */.PI.narrowPaddingEnabled;
    const isDark = utils.isDarkMode();
    const imgRender = config/* CONFIG */.PI.imageRenderEnabled;

    // 主题、暗色模式或图片渲染开关变化时重新注入主题样式
    if (themeName !== currentThemeName || isDark !== currentDarkMode || imgRender !== currentImageRenderState) {
        currentThemeName = themeName;
        currentDarkMode = isDark;
        currentImageRenderState = imgRender;
        const t = getThemeColors(themeName);
        if (!t) {
            themeStyle.textContent = '';
        } else {
            themeStyle.textContent = `
                :root {
                    --anime-primary: ${t.primary}; --anime-primary-hover: ${t.primaryHover};
                    --anime-accent: ${t.accent}; --anime-glow: ${t.glow};
                    --anime-radius: 14px; --anime-radius-lg: 20px;
                    --deep-think-active: ${t.deepThinkActive}; --button-bg: ${t.buttonBg};
                    --button-hover: ${t.buttonHover}; --main-border-glow: ${t.mainBorderGlow};
                    --anime-msg-bubble-bg: ${t.msgBubbleBg}; --anime-msg-bubble-border: ${t.msgBubbleBorder};
                    --anime-code-bg: ${t.codeBg}; --anime-link-color: ${t.linkColor};
                    --anime-think-bg: ${t.thinkBg}; --anime-card-bg: ${t.cardBg};
                }
                body, div, p, span, input, textarea, button, select {
                    font-family: var(--anime-custom-font, 'PingFang SC','Hiragino Sans GB','Noto Sans SC','Microsoft YaHei',sans-serif) !important;
                }
                ::selection { background: ${t.primary} !important; color: #fff !important; }
                ::-webkit-scrollbar { width: 7px !important; }
                ::-webkit-scrollbar-track { background: ${isDark ? '#1e1625' : '#fff0f4'} !important; }
                ::-webkit-scrollbar-thumb { background: ${isDark ? '#5a3a50' : '#f8c5d0'} !important; border-radius: 10px !important; }
                ::-webkit-scrollbar-thumb:hover { background: ${t.primary} !important; }
                ._24fad49, ._24fad49 .ds-scroll-area__gutters,
                [class*="sidebar"] [class*="scroll-area"] { border: none !important; outline: none !important; box-shadow: none !important; }
                ._77cefa5._3d616d3, div._77cefa5._3d616d3,
                [class*="chat-container"], main[class*="main"] {
                    border: 2px solid ${t.primary} !important;
                    border-radius: var(--anime-radius-lg) !important;
                    box-shadow: 0 0 20px ${t.mainBorderGlow}, 0 4px 16px rgba(0,0,0,0.1) !important;
                    background: var(--anime-card-bg) !important;
                }
                textarea._27c9245, textarea,
                [class*="input-area"] textarea, [contenteditable="true"] {
                    border: none !important; box-shadow: none !important; outline: none !important;
                    caret-color: ${t.primary} !important;
                    border-radius: var(--anime-radius) !important;
                    background: var(--anime-card-bg) !important; color: ${t.textPrimary} !important;
                }
                textarea:focus, [contenteditable="true"]:focus { border: none !important; box-shadow: none !important; outline: none !important; }
                .ds-message {
                    background: var(--anime-msg-bubble-bg) !important;
                    border: 1px solid var(--anime-msg-bubble-border) !important;
                    border-radius: var(--anime-radius) !important;
                    padding: 6px 12px !important; margin-bottom: 4px !important;
                }
                .md-code-block, .md-code-block-banner, .md-code-block-banner-wrap,
                .md-code-block pre, .ds-markdown pre, ._121d384, .d2a24f03, .efa13877, .md-code-block * {
                    background: var(--anime-code-bg) !important;
                    border-radius: var(--anime-radius) !important;
                }
                .md-code-block { border: 1px solid ${t.border} !important; }
                .ds-markdown code, .md-code-block code { background: var(--anime-code-bg) !important; color: ${t.textPrimary} !important; }
                .ds-markdown a { color: var(--anime-link-color) !important; text-decoration: none !important; }
                .ds-markdown a:hover { text-decoration: underline !important; color: ${t.primaryHover} !important; }
                button[class*="primary"], button[class*="blue"],
                [class*="btn-primary"], [class*="button-primary"] {
                    background: linear-gradient(135deg, ${t.primary}, ${t.accent}) !important;
                    border-color: ${t.primary} !important; color: #fff !important;
                }
                button[class*="primary"]:hover, button[class*="blue"]:hover { background: ${t.buttonHover} !important; }
                .ds-button--primary { background: ${t.buttonBg} !important; border-color: ${t.primary} !important; color: #fff !important; }
                .ds-button--primary:hover { background: ${t.buttonHover} !important; box-shadow: 0 4px 15px ${t.glow} !important; }
                .ds-button--disabled.ds-button--primary { background: ${t.buttonBg} !important; opacity: 0.5; }
                .ds-button--primary svg, .ds-button--primary .ds-icon svg { color: #fff !important; fill: #fff !important; }
                .f79352dc.ds-toggle-button--selected, .f79352dc[aria-pressed="true"], .ds-toggle-button--selected {
                    background: ${t.deepThinkActive} !important; border-color: ${t.deepThinkActive} !important;
                    color: #fff !important; box-shadow: 0 0 12px ${t.glow} !important; transform: scale(1.02) !important;
                }
                .f79352dc.ds-toggle-button--selected svg, .f79352dc[aria-pressed="true"] svg { color: #fff !important; fill: #fff !important; }
                ._245c867._34a54ec {
                    background: var(--anime-think-bg) !important;
                    border: 1px solid ${t.thinkPanelBorder} !important;
                    border-radius: 12px !important; padding: 10px 14px !important; margin-bottom: 6px !important;
                    box-shadow: 0 1px 4px rgba(0,0,0,0.05) !important;
                }
                ._245c867._34a54ec:hover { border-color: ${t.primary} !important; box-shadow: 0 2px 10px ${t.glow} !important; }
                ._5ab5d64 ._5255ff8 { color: ${t.thinkTitleColor} !important; font-weight: 600 !important; }
                ._245c867 .ds-icon { color: ${t.thinkTitleColor} !important; }
                ${imgRender ? `
                .anime-rendered-image {
                    max-width: 100%; border-radius: 12px;
                    margin-top: 8px; display: block; border: 1px solid ${t.border};
                    box-shadow: 0 2px 8px rgba(0,0,0,0.08); transition: all 0.3s ease;
                }
                .anime-rendered-image:hover { border-color: ${t.primary}; box-shadow: 0 4px 12px ${t.glow}; }
                .anime-image-link { display: inline-block; text-decoration: none !important; }
                ` : ''}
                del { text-decoration: line-through; opacity: 0.7; }
                .anime-mermaid-container {
                    background: ${isDark ? '#1a1a2e' : '#f9f9fb'};
                    padding: 12px;
                    border-radius: 12px;
                    margin: 8px 0;
                    border: 1px solid ${t.border};
                    overflow-x: auto;
                    position: relative;
                }
                .anime-mermaid-container svg {
                    max-width: 100%;
                    height: auto;
                }
                .anime-mermaid-container .mermaid-chart {
                    display: block;
                }
                .anime-mermaid-container .anime-mermaid-source {
                    display: none;
                    margin-top: 8px;
                }
                .anime-mermaid-toggle {
                    position: absolute;
                    top: 8px;
                    right: 8px;
                    z-index: 10;
                    background: rgba(0,0,0,0.5);
                    color: #fff;
                    border: none;
                    border-radius: 4px;
                    padding: 4px 10px;
                    cursor: pointer;
                    font-size: 12px;
                    backdrop-filter: blur(4px);
                }
                .anime-mermaid-toggle:hover {
                    background: rgba(0,0,0,0.7);
                }
            `;
            // 所有非 original 主题应用通用增强样式（标题竖条、引用块点阵、文字颜色等）
            if (themeName !== 'original') {
                themeStyle.textContent += getEnhancedThemeCSS(isDark);
            }
            // Border 主题额外追加专属 CSS（渐变背景、--dsw-alias-* 变量覆盖）
            if (themeName === 'border') {
                themeStyle.textContent += getBorderThemeCSS(isDark);
            }
        }
    }

    if (narrowOn !== currentNarrowState) {
        currentNarrowState = narrowOn;
        narrowStyle.textContent = narrowOn ? `
            ._6f2c522, [class*="virtual-list-items"] {
                padding-left: 16px !important; padding-right: 16px !important;
            }
            ._871cbca .aaff8b8f { padding-left: 16px !important; padding-right: 16px !important; }
            ._871cbca .aaff8b8f ._77cefa5,
            ._871cbca .aaff8b8f ._020ab5b,
            ._871cbca .aaff8b8f ._24fad49 {
                padding-left: 0 !important; padding-right: 0 !important;
            }
        ` : '';
    }

    mermaidStyle.textContent = ``;
}

/**
 * 重置样式缓存（暗色模式切换时调用，强制下次 injectStyles 重新注入）
 */
function resetStyleCache() {
    currentDarkMode = null;
}

;// ./src/features/redirect.js
/**
 * 自动跳转模块
 *
 * 当且仅当用户访问 www.deepseek.com 或 deepseek.com 时，
 * 自动跳转到 https://chat.deepseek.com/
 */


/**
 * 执行自动跳转检查
 * 仅在 autoRedirectEnabled 且当前域名为 www.deepseek.com 或 deepseek.com 时跳转
 */
function initRedirect() {
    if (!config/* CONFIG */.PI.autoRedirectEnabled) return;
    const host = location.hostname;
    if (host === 'www.deepseek.com' || host === 'deepseek.com') {
        location.replace('https://chat.deepseek.com/');
    }
}

;// ./src/features/title-faker.js
/**
 * 标题伪装模块
 *
 * 定期将浏览器标签页标题替换为随机趣味标题，保护隐私。
 * 通过 setInterval + MutationObserver 监听标题变化并覆盖。
 */


let titleFakerInterval = null;
let titleFakerObserver = null;
let titleFakerVisibilityHandler = null;
let lastTitle = '';
let isSetting = false;

/**
 * 从标题列表中随机选取一个（避免连续重复）
 * @param {string[]} list - 标题列表
 * @returns {string}
 */
function getRandomTitle(list) {
    if (!list?.length) return 'DeepSeek';
    if (list.length === 1) return list[0];
    let newTitle;
    do { newTitle = list[Math.floor(Math.random() * list.length)]; }
    while (newTitle === lastTitle && list.length > 1);
    return newTitle;
}

/**
 * 设置伪造标题（若功能已禁用则跳过）
 */
function setFakeTitle() {
    if (!config/* CONFIG */.PI.titleFakerEnabled || isSetting) return;
    isSetting = true;
    try {
        const newTitle = getRandomTitle(config/* CONFIG */.PI.titleList || config/* DEFAULTS */.zY.titleList);
        if (document.title !== newTitle) {
            document.title = newTitle;
            lastTitle = newTitle;
        }
    } catch (e) {}
    isSetting = false;
}

/**
 * 启动标题伪装：定时器 + 可见性监听 + MutationObserver
 */
function initTitleFaker() {
    if (!config/* CONFIG */.PI.titleFakerEnabled) return;
    setFakeTitle();
    if (titleFakerInterval) clearInterval(titleFakerInterval);
    titleFakerInterval = setInterval(setFakeTitle, 3000);
    // 保存 handler 引用以便后续移除，避免重复绑定导致内存泄漏
    titleFakerVisibilityHandler = () => { if (!document.hidden) setFakeTitle(); };
    document.addEventListener('visibilitychange', titleFakerVisibilityHandler);
    const titleEl = document.querySelector('title');
    if (titleEl) {
        // 断开旧 observer 避免泄漏
        if (titleFakerObserver) titleFakerObserver.disconnect();
        titleFakerObserver = new MutationObserver(() => {
            if (!config/* CONFIG */.PI.titleFakerEnabled || (config/* CONFIG */.PI.titleList || config/* DEFAULTS */.zY.titleList).includes(document.title)) return;
            setFakeTitle();
        });
        titleFakerObserver.observe(titleEl, { childList: true, characterData: true, subtree: true });
    }
}

/**
 * 停止标题伪装：清除定时器、断开 Observer、移除事件监听
 */
function stopTitleFaker() {
    if (titleFakerInterval) {
        clearInterval(titleFakerInterval);
        titleFakerInterval = null;
    }
    if (titleFakerObserver) {
        titleFakerObserver.disconnect();
        titleFakerObserver = null;
    }
    if (titleFakerVisibilityHandler) {
        document.removeEventListener('visibilitychange', titleFakerVisibilityHandler);
        titleFakerVisibilityHandler = null;
    }
}

;// ./src/features/sakura.js
/**
 * 樱花动画模块
 *
 * 在页面顶层创建 Canvas，渲染飘落的樱花花瓣动画。
 * 支持暗色模式自适应、页面可见性暂停、DPR 缩放。
 */



let sakuraInstance = null;

/**
 * 樱花动画类：管理 Canvas 渲染循环与花瓣粒子
 */
class SakuraEffect {
    constructor() {
        this.canvas = null;
        this.ctx = null;
        this.petals = [];
        this.running = true;
        this._animFrameId = null;
        this._boundAnimate = this._animate.bind(this);
        this._boundVisibility = this._onVisibilityChange.bind(this);
        document.addEventListener('visibilitychange', this._boundVisibility);
        this._init();
        this._boundAnimate();
    }

    /** 初始化 Canvas 与花瓣粒子 */
    _init() {
        this.canvas = document.createElement('canvas');
        this.canvas.id = 'sakura-canvas';
        this.canvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:99999;';
        document.body.appendChild(this.canvas);
        this.ctx = this.canvas.getContext('2d');
        this._resize();
        window.addEventListener('resize', utils.debounce(() => this._resize(), 200));
        const colors = ['rgba(255,183,197,0.85)', 'rgba(255,160,180,0.8)', 'rgba(255,200,210,0.75)'];
        for (let i = 0; i < 32; i++) {
            this.petals.push({
                x: Math.random() * innerWidth,
                y: Math.random() * innerHeight,
                size: 8 + Math.random() * 10,
                speed: 0.8 + Math.random() * 1.6,
                sway: 0.015 + Math.random() * 0.03,
                swayAmp: 20 + Math.random() * 50,
                rot: Math.random() * Math.PI * 2,
                rotSpeed: (Math.random() - 0.5) * 0.04,
                opacity: 0.55 + Math.random() * 0.45,
                swayOff: Math.random() * Math.PI * 2,
                color: colors[Math.floor(Math.random() * colors.length)]
            });
        }
    }

    /** 调整 Canvas 尺寸以匹配窗口 + DPR */
    _resize() {
        const dpr = Math.min(devicePixelRatio, 2);
        this.canvas.width = innerWidth * dpr;
        this.canvas.height = innerHeight * dpr;
        this.canvas.style.width = innerWidth + 'px';
        this.canvas.style.height = innerHeight + 'px';
        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
        this.ctx.scale(dpr, dpr);
    }

    /** 动画帧：更新花瓣位置并绘制 */
    _animate() {
        if (!this.running || !this.canvas) return;
        if (document.hidden) {
            cancelAnimationFrame(this._animFrameId);
            this._animFrameId = null;
            return;
        }
        this.ctx.clearRect(0, 0, innerWidth, innerHeight);
        for (let p of this.petals) {
            p.y += p.speed;
            p.swayOff += p.sway;
            p.x += Math.sin(p.swayOff) * p.swayAmp * 0.06;
            p.rot += p.rotSpeed;
            if (p.y > innerHeight + 30) { p.y = -30; p.x = Math.random() * innerWidth; }
            this.ctx.save();
            this.ctx.globalAlpha = p.opacity;
            this.ctx.translate(p.x, p.y);
            this.ctx.rotate(p.rot);
            this.ctx.beginPath();
            this.ctx.ellipse(0, 0, p.size * 0.55, p.size * 0.35, 0, 0, Math.PI * 2);
            this.ctx.fillStyle = p.color;
            this.ctx.fill();
            this.ctx.restore();
        }
        this._animFrameId = requestAnimationFrame(this._boundAnimate);
    }

    /** 页面可见性变化时暂停/恢复动画 */
    _onVisibilityChange() {
        if (document.hidden) {
            if (this._animFrameId) {
                cancelAnimationFrame(this._animFrameId);
                this._animFrameId = null;
            }
        } else {
            if (this.running && !this._animFrameId) {
                this._animFrameId = requestAnimationFrame(this._boundAnimate);
            }
        }
    }

    /** 销毁实例：停止动画、移除 Canvas、清理事件 */
    destroy() {
        this.running = false;
        if (this._animFrameId) cancelAnimationFrame(this._animFrameId);
        document.removeEventListener('visibilitychange', this._boundVisibility);
        if (this.canvas?.parentNode) this.canvas.parentNode.removeChild(this.canvas);
        this.canvas = null;
        this.ctx = null;
        this.petals = [];
    }
}

/**
 * 初始化（或销毁后重建）樱花动画实例
 */
function initSakura() {
    if (sakuraInstance) { sakuraInstance.destroy(); sakuraInstance = null; }
    if (config/* CONFIG */.PI.sakuraEnabled) sakuraInstance = new SakuraEffect();
}

/** 销毁樱花动画实例 */
function destroySakura() {
    if (sakuraInstance) { sakuraInstance.destroy(); sakuraInstance = null; }
}

;// ./src/features/auto-retry.js
/**
 * 自动重试模块
 *
 * 检测 DeepSeek 回复中的"重新生成"按钮，当出现网络错误时自动点击重试。
 * 通过 SVG path 属性识别特定的重试按钮图标。
 * 最多重试 10 次，每次显示通知提示。
 */


let retryAttempts = {};
let retryNotification = null;

/**
 * 显示重试通知（复用同一 DOM 元素，4 秒后淡出）
 * @param {string} text - 通知文本
 */
function showRetryNotification(text) {
    if (!retryNotification) {
        retryNotification = document.createElement('div');
        retryNotification.id = 'anime-retry-notification';
        retryNotification.style.cssText = `
            position: fixed;
            bottom: 80px;
            right: 20px;
            background: rgba(0,0,0,0.75);
            color: #fff;
            padding: 10px 18px;
            border-radius: 30px;
            font-size: 14px;
            font-weight: 500;
            z-index: 999999;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            backdrop-filter: blur(4px);
            transition: opacity 0.3s;
            pointer-events: none;
            font-family: system-ui, -apple-system, sans-serif;
        `;
        document.body.appendChild(retryNotification);
    }
    retryNotification.textContent = text;
    retryNotification.style.opacity = '1';
    clearTimeout(retryNotification._hideTimer);
    retryNotification._hideTimer = setTimeout(() => {
        retryNotification.style.opacity = '0';
    }, 4000);
}

/**
 * 处理重试按钮：点击并通知
 * @param {HTMLElement} button - 重试按钮
 */
function handleRetryButton(button) {
    if (!config/* CONFIG */.PI.autoRetryEnabled) return;
    if (button.getAttribute('aria-disabled') === 'true' || button.classList.contains('ds-button--disabled')) return;
    const key = location.pathname + '-' + Date.now();
    if (!retryAttempts[key]) retryAttempts[key] = 0;
    const attempts = retryAttempts[key];
    if (attempts >= 10) {
        showRetryNotification('⛔ 已达到最大重试次数 (10)');
        return;
    }
    button.click();
    retryAttempts[key] = attempts + 1;
    showRetryNotification(`🔄 重试中... 第 ${retryAttempts[key]} 次`);
}

/**
 * 扫描页面中的重试按钮（通过 SVG path 属性识别）并自动点击
 * 无参数，扫描整个文档
 */
function scanRetryButton() {
    if (!config/* CONFIG */.PI.autoRetryEnabled) return;
    const buttons = document.querySelectorAll('div.ds-button div.ds-icon svg');
    for (let svg of buttons) {
        const path = svg.querySelector('path');
        if (!path) continue;
        const d = path.getAttribute('d');
        if (d && d.includes('M') && d.includes('C') && d.includes('1.272') && d.includes('6.21348')) {
            let btn = svg.closest('div.ds-button');
            if (btn && !btn.dataset.animeRetryProcessed) {
                btn.dataset.animeRetryProcessed = 'true';
                handleRetryButton(btn);
            }
        }
    }
}

/**
 * 重置重试计数器
 */
function resetRetryAttempts() {
    retryAttempts = {};
}

;// ./src/features/data-store.js
/**
 * 对话数据存储模块（Store）
 *
 * 从 XHR/Fetch 响应中捕获 DeepSeek 对话数据，供导出功能使用。
 * 数据来源：
 *   - /api/v0/chat/history_messages（历史消息列表）
 *   - /api/v0/chat/completion 等（生成消息）
 *
 * 数据结构：
 *   { msgs: [], sid: '', aid: '', title: '' }
 */


/** 从 URL 中提取会话 ID */
function getSidFromUrl() {
    const m = location.href.match(/\/chat\/s\/([0-9a-f-]{36})/i);
    return m ? m[1] : null;
}

/** 在嵌套对象中查找包含 chat_messages 的业务数据负载 */
function findBizPayload(v, depth = 0) {
    if (!v || typeof v !== 'object' || depth > 7) return null;
    if (Array.isArray(v.chat_messages) && v.chat_messages.length > 0) return v;
    for (const item of (Array.isArray(v) ? v : Object.values(v))) {
        const found = findBizPayload(item, depth + 1);
        if (found) return found;
    }
    return null;
}

/** 内部数据状态 */
const _data = { msgs: [], sid: null, aid: null, title: '' };
const _listeners = [];

/** Store 对象 */
const Store = {
    /**
     * 更新数据并通知监听器
     * @param {Object} p - 部分数据
     */
    update(p) {
        Object.assign(_data, p);
        _listeners.forEach(fn => { try { fn({..._data}); } catch(e) {} });
    },

    /** 获取当前数据副本 */
    get() { return {..._data}; },

    /** 是否已有数据 */
    hasData() { return _data.msgs.length > 0; },

    /**
     * 注册数据更新监听器
     * @param {Function} fn - 回调函数
     * @returns {Function} 取消监听函数
     */
    onData(fn) {
        _listeners.push(fn);
        return () => {
            const i = _listeners.indexOf(fn);
            if (i >= 0) _listeners.splice(i, 1);
        };
    },

    /** 清空数据（切换对话时调用） */
    clear() {
        _data.msgs = [];
        _data.sid = null;
        _data.aid = null;
        _data.title = '';
    }
};

/**
 * 处理从 API 响应中提取的业务数据，更新 Store
 * @param {Object} biz - 包含 chat_messages 的业务数据
 */
function handleBiz(biz) {
    biz = findBizPayload(biz) || biz;
    if (!biz?.chat_messages?.length) return;
    const sid = biz.chat_session?.id || biz.chat_session_id || biz.session_id || getSidFromUrl() || _data.sid || '';
    const aid = biz.chat_session?.current_message_id || biz.current_message_id || biz.message_id || '';
    const title = biz.chat_session?.title || biz.title || document.title.replace(/\s*-\s*DeepSeek.*/i, '') || '';
    Store.update({ msgs: biz.chat_messages, sid, aid, title });
}

/**
 * 切换对话时重置 Store 并尝试从 IndexedDB 恢复数据
 * @param {string} targetSid - 目标会话 ID
 */
async function tryReadIDB(targetSid) {
    const sid = targetSid || _data.sid || getSidFromUrl();
    if (_data.msgs.length > 0 || !sid || !indexedDB.databases) return;
    const find = (v, depth) => {
        if (!v || typeof v !== 'object' || depth > 8) return null;
        if (v.chat_session?.id === sid && v.chat_messages?.length > 0) return v;
        for (const item of (Array.isArray(v)?v:Object.values(v))) { const r = find(item, depth+1); if (r) return r; }
        return null;
    };
    try {
        for (const { name } of await indexedDB.databases()) {
            if (!name) continue;
            const db = await new Promise((res, rej) => { const r = indexedDB.open(name); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); });
            for (const store of db.objectStoreNames) {
                const recs = await new Promise(res => { const o=[], r=db.transaction(store,'readonly').objectStore(store).openCursor(); r.onsuccess=e=>{const c=e.target.result;if(!c)return res(o);o.push(c.value);c.continue();};r.onerror=()=>res(o); });
                for (const v of recs) { const f = find(v,0); if (f) { handleBiz(f); db.close(); return; } }
            }
            db.close();
        }
    } catch(e) {}
}

;// ./src/features/anti-recall.js
/**
 * 防撤回模块（XHR 拦截）
 *
 * 通过拦截 XMLHttpRequest 的 response/responseText getter，
 * 实时检测被撤回的回复并替换为本地缓存的存档内容。
 * 支持 SSE 流式响应和历史消息两种场景。
 */



const TEMPLATE_RESPONSE = "TEMPLATE_RESPONSE";
const CONTENT_FILTER = "CONTENT_FILTER";
const RECALL_TIP_EN = "⚠️ This response has been is blocked and archived only on this browser";
const RECALL_TIP_CH = "⚠️ 此回复已被拦截，仅在本浏览器存档";
const RECALL_NOT_FOUND_EN = "⛔️ This response has been blocked and cannot be found in local cache.";
const RECALL_NOT_FOUND_CH = "⛔️ 此回复已被拦截，且无法在本地缓存中找到";

function getRecalledTipMessage(locale) {
    return locale == "zh_CN" ? RECALL_TIP_CH : RECALL_TIP_EN;
}

function getRecallNotFoundMessage(locale) {
    return locale == "zh_CN" ? RECALL_NOT_FOUND_CH : RECALL_NOT_FOUND_EN;
}

function _getKey(sessId, msgId) {
    return "deleted-chat-sess-" + sessId + "-msg-" + msgId;
}

function _parseKey(key, container) {
    if (Array.isArray(container) && key.match(/^[-+]?\d+$/)) {
        let int = parseInt(key);
        if (int < 0) {
            int = container.length + int;
        }
        return int;
    }
    return key;
}

function _setValueByPath(obj, path, value, isAppend) {
    const keys = path.split("/");
    let current = obj;

    for (let i = 0; i < keys.length - 1; i++) {
        let key = _parseKey(keys[i], current);

        if (!(key in current)) {
            const nextKey = _parseKey(keys[i + 1], current);
            current[key] = typeof nextKey === 'number' ? [] : {};
        }

        current = current[key];
    }

    const lastKey = _parseKey(keys[keys.length - 1], current);

    let lastVal = current[lastKey];
    if (isAppend) {
        if (Array.isArray(current[lastKey])) {
            for (let k = 0; k < value.length; k++) {
                current[lastKey].push(value[k]);
            }
        } else {
            current[lastKey] = lastVal + value;
        }
    } else {
        current[lastKey] = value;
    }
    return obj;
}

function DSState() {
    this.fields = {};
    this.sessId = "";
    this.locale = "en_US";
    this.recalled = false;
    this._updatePath = "";
    this._updateMode = "SET";
}

DSState.prototype.update = function(data) {
    let precheck = this.preCheck(data);
    if (data.p) {
        this._updatePath = data.p;
    }
    if (data.o) {
        this._updateMode = data.o;
    }
    let value = data.v;
    if (typeof value == 'object' && this._updatePath == "") {
        for (var key in value) {
            this.fields[key] = value[key];
        }
        return precheck;
    }
    this.setField(this._updatePath, value, this._updateMode);
    return precheck;
}

DSState.prototype.preCheck = function(data) {
    let path = data.p ? data.p : this._updatePath;
    let mode = data.o ? data.o : this._updateMode;
    let modified = false;
    if (mode == "BATCH" && path == "response") {
        for (let i = 0; i < data.v.length; i++) {
            let v = data.v[i];
            if (v.p == "fragments" && v.v[0].type == TEMPLATE_RESPONSE) {
                modified = true;
                data.v[i] = {"v": [{"id": this.fields.response.fragments.length + 1, "type": "TIP", "style": "WARNING", "content": getRecalledTipMessage(this.locale)}], "p": "fragments", "o": "APPEND"};
            }
            if (v.p == "status" && v.v == CONTENT_FILTER) {
                modified = true;
                data.v[i] = {"p": "status", "v": "FINISHED"};
            }
        }
    }
    if (modified) {
        this.recalled = true;
        saveRecalledMessage(this.sessId, this.fields.response.message_id, this.fields.response.fragments);
        return JSON.stringify(data);
    }
    return "";
}

DSState.prototype.setField = function(path, value, mode) {
    if (mode == "BATCH") {
        let subMode = "SET";
        for (let i = 0; i < value.length; i++) {
            let v = value[i];
            if (v.o) {
                subMode = v.o;
            }
            this.setField(path + "/" + v.p, v.v, subMode);
        }
    } else if (mode == "SET") {
        _setValueByPath(this.fields, path, value, false);
    } else if (mode == "APPEND") {
        _setValueByPath(this.fields, path, value, true);
    }
};

function saveRecalledMessage(sessId, msgId, fragments) {
    localStorage.setItem(_getKey(sessId, msgId), JSON.stringify(fragments));
}

function getRecalledMessage(req, sessId, msgId) {
    let frags = JSON.parse(localStorage.getItem(_getKey(sessId, msgId)));
    if (!frags) {
        return [{content: getRecallNotFoundMessage(req.__locale), id: 2, type: TEMPLATE_RESPONSE}];
    }
    frags.push({"id": frags.length + 1, "type": "TIP", "style": "WARNING", "content": getRecalledTipMessage(req.__locale)});
    return frags;
}

function handleEventItem(req, msg) {
    if (!msg.v) {
        return "";
    }
    return req.__dsState.update(msg);
}

function onEventStreamResp(req, res) {
    if (req.__messagesCount === undefined) {
        req.__messagesCount = 0;
        req.__dsState = new DSState();
        req.__dsState.sessId = req.__sessId;
        req.__dsState.locale = req.__locale;
    }
    let lastMessageCount = req.__messagesCount;
    let messages = res.split("\n");
    for (let i = lastMessageCount; i < messages.length - 1; i++) {
        let msg = messages[i];
        let data = {};
        req.__messagesCount++;
        if (!msg.startsWith("data: ")) {
            continue;
        }
        data = JSON.parse(msg.replace("data:", ""));
        let handleRes = handleEventItem(req, data);
        if (handleRes != "") {
            messages[i] = "data: " + handleRes;
        }
    }
    if (req.__dsState.recalled) {
        let res2 = "";
        for (let l = 0; l < messages.length; l++) {
            res2 += messages[l] + "\n";
        }
        return res2;
    }
    return res;
}

function onHistoryMessageResp(req, res) {
    let json = JSON.parse(res);
    if (!json.data || !json.data.biz_data) {
        return res;
    }
    let data = json.data.biz_data;

    // 数据捕获：将对话数据保存到 Store，供导出功能使用
    try { handleBiz(data); } catch(e) {}

    let sessId = data.chat_session.id;
    let modified = false;
    // 防撤回：将被拦截的消息替换为本地缓存的存档内容
    if (config/* CONFIG */.PI.antiRecallEnabled) {
        for (let i = 0; i < data.chat_messages.length; i++) {
            if (data.chat_messages[i].status == CONTENT_FILTER) {
                data.chat_messages[i].fragments = getRecalledMessage(req, sessId, data.chat_messages[i].message_id);
                data.chat_messages[i].status = "FINISHED";
                modified = true;
            }
        }
    }
    if (modified) {
        json.data.biz_data = data;
        res = JSON.stringify(json);
    }
    return res;
}

function onResponse(req) {
    let origRes = req.getOriginalResponse();
    if (req.__reqType == "history" && req.readyState == 4) {
        return onHistoryMessageResp(req, origRes);
    } else if (req.__reqType == "generate" && config/* CONFIG */.PI.antiRecallEnabled) {
        return onEventStreamResp(req, origRes);
    }
    return origRes;
}

let xhrHookInstalled = false;

/**
 * 安装 XHR 钩子，拦截 response/responseText
 * 同时支持：防撤回、系统提示词注入、对话数据捕获
 * 防止重复安装：Object.defineProperty 第二次调用会因属性不可配置而抛出 TypeError
 */
function installXhrHook() {
    if (xhrHookInstalled) return;
    xhrHookInstalled = true;
    let originXhrResponse = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, "response");
    let originXhrResponseText = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, "responseText");
    let originXhrOpen = XMLHttpRequest.prototype.open;
    let originXhrSend = XMLHttpRequest.prototype.send;
    let originXhrSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;

    Object.defineProperty(XMLHttpRequest.prototype, "response", {
        get: function() {
            if (!this.__reqType) {
                return originXhrResponse.get.call(this);
            }
            return onResponse(this);
        },
        set: function(body) {
            return originXhrResponse.set.call(this, body);
        }
    });

    Object.defineProperty(XMLHttpRequest.prototype, "responseText", {
        get: function() {
            if (!this.__reqType) {
                return originXhrResponseText.get.call(this);
            }
            return onResponse(this);
        },
        set: function(body) {
            return originXhrResponseText.set.call(this, body);
        }
    });

    XMLHttpRequest.prototype.getOriginalResponse = function() {
        return originXhrResponse.get.call(this);
    }

    XMLHttpRequest.prototype.open = function(method, url) {
        let [urlPath] = url.split("?");
        if (urlPath == '/api/v0/chat/history_messages') {
            this.__reqType = "history";
        } else if (urlPath == '/api/v0/chat/completion' || urlPath == '/api/v0/chat/edit_message' || urlPath == '/api/v0/chat/regenerate' ||
                   urlPath == '/api/v0/chat/continue' || urlPath == '/api/v0/chat/resume_stream') {
            this.__reqType = "generate";
        }
        return originXhrOpen.apply(this, arguments);
    }

    XMLHttpRequest.prototype.send = function(body) {
        if (!this.__reqType) {
            return originXhrSend.apply(this, arguments);
        }
        if (this.__reqType == "generate") {
            try {
                let bodyJson = JSON.parse(body);
                this.__sessId = bodyJson.chat_session_id;
                // 系统提示词注入：在用户 prompt 前插入系统指令
                if (config/* CONFIG */.PI.promptInjectEnabled && config/* CONFIG */.PI.promptText && bodyJson.prompt) {
                    bodyJson.prompt = '[系统指令]\n' + config/* CONFIG */.PI.promptText + '\n[/系统指令]\n\n' + bodyJson.prompt;
                    arguments[0] = JSON.stringify(bodyJson);
                }
            } catch(e) {}
        }
        return originXhrSend.apply(this, arguments);
    }

    XMLHttpRequest.prototype.setRequestHeader = function(header, value) {
        if (!this.__reqType) {
            return originXhrSetRequestHeader.apply(this, arguments);
        }
        if (header == "x-client-locale") {
            this.__locale = value;
        }
        return originXhrSetRequestHeader.apply(this, arguments);
    }
}

;// ./src/features/default-mode.js
/**
 * 默认模式自动切换模块
 *
 * 通过检测模式选择器（.e362e944 中的 radiogroup）是否重置为快速模式
 * 来判断新对话开始，自动点击用户配置的模式按钮（快速/专家/识图）。
 *
 * 快速模式（default）是 DeepSeek 原生默认，无需点击。
 *
 * 日志前缀：[DS-Mode] 便于在控制台过滤
 */


const LOG = '[DS-Mode]';
let observer = null;
let pollTimer = null;
let cooldown = false;
let wasModeSelectorVisible = false;
let lastIndex = -1;

/**
 * 检测模式选择器是否重置为快速模式（新对话标志）
 * 逻辑：
 *   - radiogroup 从"不存在"变为"存在"（新对话页面加载）
 *   - 或 --selected-index 从非0值变回0（用户在对话中切换了模式后开新对话）
 * @returns {boolean}
 */
function detectNewConversation() {
    const radiogroup = document.querySelector('[role="radiogroup"]');
    if (!radiogroup) {
        wasModeSelectorVisible = false;
        return false;
    }

    // 检查 radiogroup 是否在模式选择器容器内（排除设置弹窗等）
    const container = radiogroup.closest('.e362e944');
    if (!container) return false;

    // 获取当前选中索引
    const selectedIndex = parseInt(radiogroup.style.getPropertyValue('--selected-index') || '0');

    let detected = false;

    // 场景1：从不可见变为可见 → 新对话
    if (!wasModeSelectorVisible) {
        console.log(`${LOG} 模式选择器出现，selectedIndex=${selectedIndex}`);
        detected = true;
    }

    // 场景2：索引从非0值变回0 → 新对话重置
    if (lastIndex > 0 && selectedIndex === 0) {
        console.log(`${LOG} 索引重置 ${lastIndex} → ${selectedIndex}，判定为新对话`);
        detected = true;
    }

    wasModeSelectorVisible = true;
    lastIndex = selectedIndex;
    return detected;
}

/**
 * 查找 DOM 元素上的 React 内部 props
 * @param {Element} el
 * @returns {Object|null}
 */
function getReactProps(el) {
    const keys = Object.getOwnPropertyNames(el);
    for (const key of keys) {
        if (key.startsWith('__reactProps') || key.startsWith('__reactEventHandlers')) {
            return el[key];
        }
    }
    return null;
}

/**
 * 强制触发模式切换（每次只尝试一种方法，避免方法间互相冲突）
 * React 的 DOM 更新是异步的，同步检查 aria-checked 无意义
 * @param {string} targetMode - 目标模式：default / expert / vision
 * @param {number} methodIndex - 使用哪种方法（0=React, 1=click, 2=鼠标事件, 3=键盘）
 */
function forceSelectMode(targetMode, methodIndex = 0) {
    const btn = document.querySelector(`[data-model-type="${targetMode}"]`);
    if (!btn) {
        console.log(`${LOG} forceSelectMode: 未找到 [data-model-type="${targetMode}"] 按钮`);
        return;
    }

    const methods = ['React onClick', 'btn.click()', '鼠标事件序列', '键盘箭头键'];
    const methodName = methods[methodIndex] || methods[0];
    console.log(`${LOG} forceSelectMode("${targetMode}") 方法${methodIndex}: ${methodName}`);

    if (methodIndex === 0) {
        // 方法0：查找 React 内部 props 并调用 onClick
        let el = btn;
        let foundReactProps = false;
        while (el && el !== document.body) {
            const props = getReactProps(el);
            if (props) {
                foundReactProps = true;
                const handlerNames = Object.keys(props).filter(k => k.startsWith('on'));
                console.log(`${LOG} 在 ${el.tagName}.${el.className.split(' ')[0]||''} 上找到 React props，handlers: [${handlerNames.join(', ')}]`);
                const synthEvent = {
                    target: btn, currentTarget: el,
                    preventDefault() {}, stopPropagation() {},
                    nativeEvent: new MouseEvent('click'),
                    type: 'click', bubbles: true,
                };
                if (typeof props.onClick === 'function') {
                    try {
                        console.log(`${LOG}   调用 onClick()...`);
                        props.onClick(synthEvent);
                    } catch (e) {
                        console.log(`${LOG}   onClick() 异常:`, e.message);
                    }
                }
            }
            el = el.parentElement;
        }
        if (!foundReactProps) {
            console.log(`${LOG} 未找到 React props，btn 的 __ 属性:`, Object.getOwnPropertyNames(btn).filter(k => k.startsWith('__')));
        }
    } else if (methodIndex === 1) {
        // 方法1：直接 click()
        try { btn.click(); } catch (e) { console.log(`${LOG} click() 异常:`, e.message); }
    } else if (methodIndex === 2) {
        // 方法2：完整鼠标事件序列
        const rect = btn.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        console.log(`${LOG} 鼠标事件 @ (${cx.toFixed(0)}, ${cy.toFixed(0)})`);
        for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
            try {
                btn.dispatchEvent(new MouseEvent(type, {
                    bubbles: true, cancelable: true, view: window,
                    clientX: cx, clientY: cy,
                }));
            } catch (e) {}
        }
    } else if (methodIndex === 3) {
        // 方法3：键盘箭头键（精确按下所需的次数）
        const modes = ['default', 'expert', 'vision'];
        const targetIndex = modes.indexOf(targetMode);
        const radiogroup = document.querySelector('[role="radiogroup"]');
        if (radiogroup && targetIndex !== -1) {
            const selectedIndex = parseInt(radiogroup.style.getPropertyValue('--selected-index') || '0');
            const diff = targetIndex - selectedIndex;
            console.log(`${LOG} 键盘: 当前 index=${selectedIndex}, 目标 index=${targetIndex}, diff=${diff}`);
            if (diff !== 0) {
                try { radiogroup.focus(); } catch (e) {}
                const key = diff > 0 ? 'ArrowRight' : 'ArrowLeft';
                const presses = Math.abs(diff);
                for (let i = 0; i < presses; i++) {
                    try {
                        radiogroup.dispatchEvent(new KeyboardEvent('keydown', {
                            key, code: key,
                            keyCode: key === 'ArrowRight' ? 39 : 37,
                            which: key === 'ArrowRight' ? 39 : 37,
                            bubbles: true, cancelable: true,
                        }));
                    } catch (e) {}
                }
            }
        }
    }

    console.log(`${LOG} 方法${methodIndex}(${methodName}) 完成`);
}

/**
 * 检查目标模式是否已选中（异步验证，React 重渲染后生效）
 * @param {string} targetMode
 * @returns {boolean}
 */
function isModeSelected(targetMode) {
    const btn = document.querySelector(`[data-model-type="${targetMode}"]`);
    const checked = btn && btn.getAttribute('aria-checked') === 'true';
    console.log(`${LOG} isModeSelected("${targetMode}"): ${checked}`);
    return checked;
}

/**
 * 应用默认模式：每次重试轮换不同方法，避免方法间冲突
 */
function applyDefaultMode() {
    const targetMode = config/* CONFIG */.PI.defaultMode || 'default';
    if (targetMode === 'default') {
        console.log(`${LOG} applyDefaultMode: 目标是 default，无需切换`);
        return;
    }

    console.log(`${LOG} applyDefaultMode: 目标模式=${targetMode}`);
    let attempts = 0;
    const tryClick = () => {
        // 已经是目标模式，无需切换
        if (isModeSelected(targetMode)) {
            console.log(`${LOG} ✅ 已是目标模式，停止重试`);
            return;
        }

        // 每次重试轮换方法（0=React, 1=click, 2=鼠标, 3=键盘）
        const methodIndex = attempts % 4;
        console.log(`${LOG} 第 ${attempts + 1} 次尝试，方法 ${methodIndex}`);
        forceSelectMode(targetMode, methodIndex);

        // 等待 React 重渲染后验证
        setTimeout(() => {
            if (isModeSelected(targetMode)) {
                console.log(`${LOG} ✅ 切换成功（方法 ${methodIndex}）`);
                return;
            }
            console.log(`${LOG} ❌ 第 ${attempts + 1} 次失败（方法 ${methodIndex}）`);
            if (++attempts < 8) {
                setTimeout(tryClick, 300);
            } else {
                console.log(`${LOG} 🔴 达到最大重试次数，放弃`);
            }
        }, 500);
    };
    setTimeout(tryClick, 300);
}

/**
 * 手动触发新对话检测（由按钮点击或快捷键调用）
 * 延迟等待新对话页面渲染后应用默认模式
 */
function manualTrigger() {
    console.log(`${LOG} 🔔 手动触发（按钮/快捷键），等待页面渲染...`);
    cooldown = true;
    // 延迟等待新对话页面加载
    setTimeout(() => {
        applyDefaultMode();
        setTimeout(() => {
            cooldown = false;
            console.log(`${LOG} 冷却结束，恢复检测`);
        }, 3000);
    }, 800);
}

/**
 * 检测新对话并应用默认模式（带冷却避免重复触发）
 */
function checkAndApply() {
    if (cooldown) return;
    if (!detectNewConversation()) return;

    console.log(`${LOG} 🔔 检测到新对话，开始应用默认模式`);
    cooldown = true;
    applyDefaultMode();

    // 5 秒后重置冷却，允许检测下一次新对话
    setTimeout(() => {
        cooldown = false;
        console.log(`${LOG} 冷却结束，恢复检测`);
    }, 5000);
}

/**
 * 初始化默认模式功能
 * MutationObserver 监听 DOM 变化 + 按钮点击 + 快捷键 + 轮询兜底
 */
function initDefaultMode() {
    console.log(`${LOG} initDefaultMode() 被调用, defaultModeEnabled=${config/* CONFIG */.PI.defaultModeEnabled}, defaultMode=${config/* CONFIG */.PI.defaultMode}`);
    if (!config/* CONFIG */.PI.defaultModeEnabled) return;

    console.log(`${LOG} 初始化，配置: defaultMode=${config/* CONFIG */.PI.defaultMode}, enabled=${config/* CONFIG */.PI.defaultModeEnabled}`);

    // 首次检查
    setTimeout(checkAndApply, 500);

    // MutationObserver 监听 DOM 变化（仅 childList，不需要 characterData）
    // characterData 会在流式响应时频繁触发，而模式选择器变化是 childList 变化
    observer = new MutationObserver(() => {
        checkAndApply();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // 轮询兜底（每 2 秒检查一次，降低频率减少开销）
    pollTimer = setInterval(checkAndApply, 2000);

    // 监听"开启新对话"按钮点击（事件委托）
    document.addEventListener('click', (e) => {
        const target = e.target;
        if (!target) return;
        // 匹配包含"开启新对话"文本的按钮，或类名 a084f19e
        const btn = target.closest('.a084f19e');
        if (btn) {
            console.log(`${LOG} 检测到点击"开启新对话"按钮`);
            manualTrigger();
            return;
        }
        // 兜底：检查文本内容
        const el = target.closest('[tabindex]');
        if (el && el.textContent && el.textContent.includes('开启新对话')) {
            console.log(`${LOG} 检测到点击"开启新对话"按钮（文本匹配）`);
            manualTrigger();
        }
    }, true);

    // 监听 Ctrl+J 快捷键
    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey && (e.key === 'j' || e.key === 'J')) {
            console.log(`${LOG} 检测到 Ctrl+J 快捷键`);
            manualTrigger();
        }
    });

    console.log(`${LOG} 监听已启动（Observer + 按钮 + Ctrl+J + 轮询）`);
}

;// ./src/features/remove-components.js
/**
 * 无用组件移除模块
 *
 * 隐藏 DeepSeek 网页端的无用 UI 组件：
 *   1. 转发按钮（._57370c5._5dedc1e / ds-button--iconLabelPrimary）
 *   2. 下载应用入口（._9579690 容器 / 含"下载手机应用"的下拉菜单项）
 *
 * 使用 display:none 隐藏而非 remove() 移除，避免 React 在 commit 阶段
 * 因找不到预期子节点而抛出 NotFoundError: removeChild。
 */


/**
 * 判断元素是否为转发按钮
 * 通过 class 名组合和 SVG 路径特征识别
 * @param {Element} el
 * @returns {boolean}
 */
function isForwardButton(el) {
    if (!el || el.nodeType !== 1) return false;
    // 匹配 ._57370c5._5dedc1e 的转发按钮
    if (el.classList.contains('_57370c5') && el.classList.contains('_5dedc1e')) return true;
    // 匹配 .db183363 的分享/操作按钮
    if (el.classList.contains('db183363')) return true;
    // 兜底：ds-button--iconLabelPrimary 且包含分享/转发 SVG
    if (el.classList.contains('ds-button--iconLabelPrimary')) {
        const label = el.textContent || '';
        if (label.includes('转发') || label.includes('分享')) return true;
    }
    return false;
}

/**
 * 判断元素是否为下载应用入口
 * @param {Element} el
 * @returns {boolean}
 */
function isDownloadAppElement(el) {
    if (!el || el.nodeType !== 1) return false;
    // 匹配 ._9579690 容器
    if (el.classList.contains('_9579690')) return true;
    // 匹配含"下载"文字的 ds-dropdown-menu-option
    if (el.classList.contains('ds-dropdown-menu-option')) {
        const label = el.querySelector('.ds-dropdown-menu-option__label');
        if (label && /下载.*应用|下载.*App/i.test(label.textContent || '')) return true;
    }
    // 匹配含 ad8d4bfc 的下载按钮
    if (el.classList.contains('ad8d4bfc')) return true;
    return false;
}

/**
 * 扫描并隐藏指定容器中的无用组件
 * 使用 display:none 而非 remove()，避免破坏 React 的 DOM 管理
 * @param {Element} root - 扫描根节点
 */
function removeUnwantedComponents(root) {
    if (!root || root.nodeType !== 1) return;

    // 隐藏转发按钮
    if (config/* CONFIG */.PI.removeForwardEnabled) {
        const forwardBtns = root.querySelectorAll('._57370c5._5dedc1e, .db183363, .ds-button--iconLabelPrimary');
        forwardBtns.forEach(el => {
            if (isForwardButton(el) && el.style.display !== 'none') {
                el.style.display = 'none';
            }
        });
    }

    // 隐藏下载应用入口（不处理 ds-dropdown-menu-option，由 menu-inject 负责）
    if (config/* CONFIG */.PI.removeDownloadAppEnabled) {
        const downloadEls = root.querySelectorAll('._9579690, .ad8d4bfc');
        downloadEls.forEach(el => {
            if (isDownloadAppElement(el) && el.style.display !== 'none') {
                el.style.display = 'none';
            }
        });
        // 仅处理不在 ds-dropdown-menu 内的选项
        const allOptions = root.querySelectorAll('.ds-dropdown-menu-option');
        allOptions.forEach(el => {
            if (isDownloadAppElement(el) && el.style.display !== 'none' && !el.closest('.ds-dropdown-menu')) {
                el.style.display = 'none';
            }
        });
    }
}

/**
 * 初始化组件移除：对整个 body 执行一次清理
 * 持续清理由主 MutationObserver（observer.js）的 scheduleScan 集成处理，
 * 不再创建独立 observer，避免双倍监听开销。
 */
function initRemoveComponents() {
    if (document.body) {
        removeUnwantedComponents(document.body);
    }
}

;// ./src/features/mermaid.js
/**
 * Mermaid 图表渲染模块
 *
 * 动态加载 Mermaid.js 库，将代码块中的 Mermaid 语法渲染为可视化图表。
 * 支持：流程图、时序图、甘特图、饼图、状态图等。
 * 替换整个代码块 wrapper，防止 DeepSeek 原生错误渲染覆盖图表。
 * 提供代码/图表切换按钮。
 */



let mermaidLoaded = false;
let mermaidLoading = false;

/**
 * 动态加载 Mermaid.js 库（仅加载一次）
 * @returns {Promise<void>}
 */
function loadMermaid() {
    if (mermaidLoaded) return Promise.resolve();
    if (mermaidLoading) {
        return new Promise((resolve) => {
            const check = setInterval(() => {
                if (mermaidLoaded) { clearInterval(check); resolve(); }
            }, 100);
        });
    }
    mermaidLoading = true;
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js';
        script.onload = () => {
            mermaidLoaded = true;
            mermaidLoading = false;
            if (window.mermaid) {
                window.mermaid.initialize({
                    theme: utils.isDarkMode() ? 'dark' : 'default',
                    securityLevel: 'loose',
                    themeVariables: {
                        primaryColor: '#f08ca8',
                        primaryTextColor: '#333',
                        primaryBorderColor: '#f08ca8',
                        lineColor: '#f08ca8',
                        secondaryColor: '#fcd5df',
                        tertiaryColor: '#fff5f7'
                    }
                });
            }
            resolve();
        };
        script.onerror = () => {
            mermaidLoading = false;
            reject(new Error('Mermaid 库加载失败'));
        };
        document.head.appendChild(script);
    });
}

/**
 * 渲染单个 Mermaid 代码块为图表。
 * 关键修复：替换整个代码块 wrapper（.md-code-block 等），而非仅 pre 元素，
 * 防止 DeepSeek 原生代码块头部 / 错误提示残留覆盖图表。
 * 如果 DeepSeek 自己的渲染器已成功渲染（wrapper 中有 SVG），则跳过。
 * @param {HTMLPreElement} pre - pre 元素
 * @param {HTMLElement} code - code 元素
 */
function renderMermaidElement(pre, code) {
    if (pre.dataset.mermaidProcessed === 'true') return;
    pre.dataset.mermaidProcessed = 'true';
    const content = code.textContent.trim();
    if (!content) return;

    // 查找代码块外层 wrapper，替换整个 wrapper 以移除 DeepSeek 原生代码块头部和错误提示
    const wrapper = pre.closest('.md-code-block')
                  || pre.closest('._121d384')
                  || pre.closest('.d2a24f03')
                  || pre.closest('.efa13877')
                  || pre.parentElement;
    if (!wrapper || !wrapper.parentNode) return;
    // 如果 wrapper 已经是图表容器，跳过
    if (wrapper.classList && wrapper.classList.contains('anime-mermaid-container')) return;
    // 如果 DeepSeek 自己的渲染器已成功渲染（wrapper 中有 SVG），跳过
    if (wrapper.querySelector('svg')) return;

    const container = document.createElement('div');
    container.className = 'anime-mermaid-container';
    container.dataset.mermaidContainer = 'true';

    const sourceWrapper = document.createElement('div');
    sourceWrapper.className = 'anime-mermaid-source';
    const preClone = pre.cloneNode(true);
    preClone.dataset.mermaidProcessed = 'false';
    sourceWrapper.appendChild(preClone);
    container.appendChild(sourceWrapper);

    const chartDiv = document.createElement('div');
    chartDiv.className = 'mermaid-chart';
    container.appendChild(chartDiv);

    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'anime-mermaid-toggle';
    toggleBtn.textContent = '显示代码';
    toggleBtn.addEventListener('click', () => {
        const source = container.querySelector('.anime-mermaid-source');
        const chart = container.querySelector('.mermaid-chart');
        if (source.style.display === 'none') {
            source.style.display = 'block';
            chart.style.display = 'none';
            toggleBtn.textContent = '显示图表';
        } else {
            source.style.display = 'none';
            chart.style.display = 'block';
            toggleBtn.textContent = '显示代码';
        }
    });
    container.appendChild(toggleBtn);

    // 在 wrapper 前插入容器，然后隐藏 wrapper（不移除，避免 React removeChild 错误）
    wrapper.parentNode.insertBefore(container, wrapper);
    wrapper.style.display = 'none';

    loadMermaid().then(() => {
        // 检查容器是否仍在 DOM 中（DeepSeek 可能已重新渲染并替换它）
        if (!utils.isNodeAttached(container)) return;
        if (window.mermaid) {
            const tempDiv = document.createElement('div');
            tempDiv.className = 'mermaid';
            tempDiv.textContent = content;
            chartDiv.appendChild(tempDiv);
            window.mermaid.run({ nodes: [tempDiv] }).catch(err => {
                chartDiv.innerHTML = `<div style="color:red;padding:8px;">⚠️ 图表渲染失败：${err.message}</div>`;
                sourceWrapper.style.display = 'block';
                toggleBtn.textContent = '显示图表';
            });
        }
    }).catch(err => {
        if (!utils.isNodeAttached(container)) return;
        chartDiv.innerHTML = `<div style="color:red;padding:8px;">⚠️ Mermaid 库加载失败</div>`;
        sourceWrapper.style.display = 'block';
        toggleBtn.textContent = '显示图表';
    });
}

/**
 * 扫描容器中的 pre 元素，检测 Mermaid 代码块并渲染。
 * 修复：跳过已在 mermaid 容器内的 pre（克隆的源代码），增加 flowchart 等关键词识别。
 * @param {Element} root - 扫描根元素
 */
function scanMermaid(root) {
    if (!config/* CONFIG */.PI.mermaidEnabled) return;
    if (!root || root.nodeType !== 1) return;
    // 跳过已经是 mermaid 容器的节点
    if (root.classList && root.classList.contains('anime-mermaid-container')) return;
    const pres = root.querySelectorAll('pre:not([data-mermaid-processed])');
    pres.forEach(pre => {
        // 跳过已在我们容器内的 pre（克隆的源代码）
        if (pre.closest('.anime-mermaid-container')) return;
        const code = pre.querySelector('code');
        if (!code) return;
        const text = code.textContent.trim();
        const isMermaid = code.className && (code.className.includes('mermaid') || code.className.includes('language-mermaid')) ||
                          /^(graph|flowchart|sequenceDiagram|gantt|pie|stateDiagram|classDiagram|erDiagram|journey|timeline|gitGraph|mindmap|requirementDiagram|C4Context|sankey|block)/.test(text);
        if (isMermaid) {
            renderMermaidElement(pre, code);
        }
    });
}

;// ./src/features/privacy-shield.js
/**
 * 隐私保护模块（敏感词替换）
 *
 * 将页面文本中的敏感词替换为指定的替代文本。
 * 直接修改 textContent，不改变 DOM 结构，避免 React removeChild 错误。
 * 相比原始 DeepSeek Privacy 脚本的改进：
 *   1. 正则特殊字符转义（修复原脚本 bug）
 *   2. 集成到 processTextNode，避免全文档 TreeWalker 遍历
 *   3. 缓存编译后的正则，提升性能
 */


/** 编译后的正则缓存（避免每次重新编译） */
let _regexCache = null;
let _cacheKey = '';

/**
 * 转义正则特殊字符
 * @param {string} string
 * @returns {string}
 */
function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 获取编译后的正则数组（带缓存）
 * @returns {Array<{regex: RegExp, replacement: string}>}
 */
function getCompiledRegexes() {
    const words = config/* CONFIG */.PI.sensitiveWords || {};
    const keys = Object.keys(words).sort().join('\u0001') + '|' + (config/* CONFIG */.PI.caseSensitive ? '1' : '0');
    if (_cacheKey === keys && _regexCache) return _regexCache;
    _cacheKey = keys;
    _regexCache = [];
    for (const [word, replacement] of Object.entries(words)) {
        if (!word) continue;
        try {
            const regex = new RegExp(escapeRegExp(word), config/* CONFIG */.PI.caseSensitive ? "g" : "gi");
            _regexCache.push({ regex, replacement });
        } catch(e) {}
    }
    return _regexCache;
}

/** 清除正则缓存（配置变更时调用） */
function clearPrivacyCache() {
    _regexCache = null;
    _cacheKey = '';
}

/**
 * 替换文本节点中的敏感词
 * 直接修改 textContent，不改变 DOM 结构
 * @param {Text} textNode
 */
function replaceSensitiveData(textNode) {
    if (!config/* CONFIG */.PI.privacyShieldEnabled) return;
    // 仅处理 DeepSeek 消息容器内的文本节点，避免替换侧边栏、设置面板等非消息区域
    const msgEl = textNode.parentElement?.closest('.ds-message');
    if (!msgEl) return;
    const regexes = getCompiledRegexes();
    if (regexes.length === 0) return;

    const text = textNode.textContent;
    if (!text || text.length < 1) return;

    let modified = text;
    let changed = false;
    for (const { regex, replacement } of regexes) {
        regex.lastIndex = 0;
        const newText = modified.replace(regex, replacement);
        if (newText !== modified) {
            modified = newText;
            changed = true;
        }
    }
    if (changed) {
        textNode.textContent = modified;
    }
}

;// ./src/features/text-process.js
/**
 * 文本处理模块
 *
 * 包含图片渲染、删除线渲染、角标清理、链接扫描等功能。
 * 通过遍历 Text 节点对 DeepSeek 的输出进行实时美化。
 * 处理顺序：角标清理 → 删除线渲染 → 图片渲染（与原版一致）
 */





// ============================================================
// 图片渲染
// ============================================================

/**
 * 创建图片元素
 * @param {string} url - 图片 URL
 * @param {string} alt - 替代文本
 * @returns {HTMLImageElement}
 */
function createImageElement(url, alt = '') {
    const img = document.createElement('img');
    img.src = url;
    img.alt = alt || '图片';
    img.className = 'anime-rendered-image';
    img.loading = 'lazy';
    img.onerror = () => { if (img.parentNode) img.style.display = 'none'; };
    return img;
}

/**
 * 将节点替换为图片链接（用于 scanLinks 中的 <a> 标签替换）
 * 使用 insertBefore + display:none 代替 replaceChild，避免破坏 React 的 DOM 管理
 * @param {Node} node - 待替换的节点
 * @param {string} url - 图片 URL
 * @param {string} alt - 替代文本
 */
function replaceNodeWithImage(node, url, alt) {
    if (!utils.isNodeAttached(node)) return;
    try {
        const img = createImageElement(url, alt);
        const link = document.createElement('a');
        link.href = url; link.target = '_blank'; link.rel = 'noreferrer';
        link.className = 'anime-image-link';
        link.appendChild(img);
        // 在原节点前插入图片链接，然后隐藏原节点（不移除，避免 React removeChild 错误）
        node.parentNode.insertBefore(link, node);
        node.style.display = 'none';
    } catch (e) {}
}

// ============================================================
// 角标清理
// ============================================================

/**
 * 清理文本节点中的角标标记文本 [reference:N] / [citation:N]
 * @param {Text} textNode
 */
function cleanTextCitations(textNode) {
    if (!config/* CONFIG */.PI.citationCleanEnabled) return;
    if (!textNode || textNode.nodeType !== 3) return;
    const original = textNode.textContent;
    const cleaned = utils.removeCitationText(original);
    if (cleaned !== original) {
        textNode.textContent = cleaned;
    }
}

/**
 * 清理元素中的角标 DOM 节点
 * 使用 display:none 隐藏而非 removeChild 移除，避免破坏 React 的 DOM 管理
 * @param {Element} root
 */
function cleanElementCitations(root) {
    if (!config/* CONFIG */.PI.citationCleanEnabled) return;
    if (!root || root.nodeType !== 1) return;
    const candidates = root.querySelectorAll('a, span, cite, sup, [data-citation]');
    candidates.forEach(el => {
        if (utils.isCitationElement(el) && el.style.display !== 'none') {
            el.style.display = 'none';
        }
    });
}

// ============================================================
// 删除线渲染
// ============================================================

/**
 * 在文本节点中渲染 ~~删除线~~ 语法为 <del> 元素
 * @param {Text} textNode
 * @returns {Text[]|null} 新插入的文本节点数组（供图片渲染使用），无匹配时返回 null
 */
function renderStrikethrough(textNode) {
    if (!config/* CONFIG */.PI.strikethroughEnabled) return null;
    if (textNode.nodeType !== 3) return null;
    const text = textNode.textContent;
    if (!/~~.+?~~/.test(text)) return null;
    if (utils.isInsideCodeBlock(textNode)) return null;

    const parent = textNode.parentNode;
    if (!parent) return null;

    const fragment = document.createDocumentFragment();
    let lastIndex = 0;
    const regex = /~~(.+?)~~/g;
    let match;

    while ((match = regex.exec(text)) !== null) {
        if (match.index > lastIndex) {
            fragment.appendChild(document.createTextNode(text.substring(lastIndex, match.index)));
        }
        const del = document.createElement('del');
        del.textContent = match[1];
        fragment.appendChild(del);
        lastIndex = match.index + match[0].length;
    }
    if (lastIndex < text.length) {
        fragment.appendChild(document.createTextNode(text.substring(lastIndex)));
    }

    // 收集 fragment 中的文本节点（插入后需要处理图片渲染）
    const insertedTextNodes = [];
    for (let child of fragment.childNodes) {
        if (child.nodeType === 3) insertedTextNodes.push(child);
    }

    // 在原文本节点前插入 fragment，然后清空原文本节点（不移除，避免 React removeChild 错误）
    parent.insertBefore(fragment, textNode);
    textNode.textContent = '';
    return insertedTextNodes.length > 0 ? insertedTextNodes : null;
}

// ============================================================
// 图片渲染入口
// ============================================================

/**
 * 渲染文本节点中的第一个图片（Markdown 或纯 URL）
 * 仅处理第一个匹配项，在原文本节点前插入 span（包含前置文本 + 图片链接 + 后置文本）
 * 然后清空原文本节点（不移除，避免 React removeChild 错误）
 * @param {Text} textNode
 */
function renderImages(textNode) {
    if (!config/* CONFIG */.PI.imageRenderEnabled) return;
    if (textNode.nodeType !== 3) return;
    if (!utils.isNodeAttached(textNode)) return;

    const text = textNode.textContent || '';
    if (text.trim().length < 5) return;

    try {
        const mdMatches = utils.extractMarkdownImage(text);
        if (mdMatches.length) {
            const first = mdMatches[0];
            const span = document.createElement('span');
            if (first.index > 0) span.appendChild(document.createTextNode(text.substring(0, first.index)));
            const img = createImageElement(first.url, first.alt);
            const link = document.createElement('a');
            link.href = first.url; link.target = '_blank'; link.rel = 'noreferrer';
            link.className = 'anime-image-link'; link.appendChild(img);
            span.appendChild(link);
            const end = first.index + first.length;
            if (end < text.length) span.appendChild(document.createTextNode(text.substring(end)));
            // 在原文本节点前插入 span，然后清空原文本节点
            if (utils.isNodeAttached(textNode)) {
                textNode.parentNode.insertBefore(span, textNode);
                textNode.textContent = '';
            }
            return;
        }

        const urlMatches = utils.extractPlainImageUrls(text);
        if (urlMatches.length) {
            const firstUrl = urlMatches[0];
            const span = document.createElement('span');
            if (firstUrl.index > 0) span.appendChild(document.createTextNode(text.substring(0, firstUrl.index)));
            const img = createImageElement(firstUrl.url);
            const link = document.createElement('a');
            link.href = firstUrl.url; link.target = '_blank'; link.rel = 'noreferrer';
            link.className = 'anime-image-link'; link.appendChild(img);
            span.appendChild(link);
            const end = firstUrl.index + firstUrl.length;
            if (end < text.length) span.appendChild(document.createTextNode(text.substring(end)));
            // 在原文本节点前插入 span，然后清空原文本节点
            if (utils.isNodeAttached(textNode)) {
                textNode.parentNode.insertBefore(span, textNode);
                textNode.textContent = '';
            }
        }
    } catch (e) {}
}

/**
 * 清理文本节点中的系统提示词注入标记 [系统指令]...[/系统指令]
 * 直接修改 textContent，不改变 DOM 结构，避免 React removeChild 错误
 * @param {Text} textNode
 */
function cleanPromptInjection(textNode) {
    if (!config/* CONFIG */.PI.promptInjectEnabled) return;
    const text = textNode.textContent;
    if (!text || !text.includes('[系统指令]')) return;
    // 移除 [系统指令]...[/系统指令] 标记及后面的空白
    const cleaned = text.replace(/\[系统指令\][\s\S]*?\[\/系统指令\]\s*/g, '');
    if (cleaned !== text) {
        textNode.textContent = cleaned;
    }
}

/**
 * 处理单个文本节点：敏感词替换 → 提示词标记清理 → 角标清理 → 删除线渲染 → 图片渲染
 * 如果删除线产生了新文本节点，则遍历它们逐一渲染图片
 * @param {Text} textNode
 */
function processTextNode(textNode) {
    if (textNode.nodeType !== 3) return;
    if (!utils.isNodeAttached(textNode)) return;

    replaceSensitiveData(textNode);
    cleanPromptInjection(textNode);
    cleanTextCitations(textNode);

    let insertedTextNodes = null;
    if (config/* CONFIG */.PI.strikethroughEnabled) {
        insertedTextNodes = renderStrikethrough(textNode);
    }

    if (config/* CONFIG */.PI.imageRenderEnabled) {
        if (insertedTextNodes) {
            // 删除线渲染后产生了新文本节点，遍历它们渲染图片
            // 逆序处理避免索引偏移
            for (let i = insertedTextNodes.length - 1; i >= 0; i--) {
                renderImages(insertedTextNodes[i]);
            }
        } else {
            renderImages(textNode);
        }
    }
}

// ============================================================
// 扫描函数
// ============================================================

/**
 * 扫描容器中的链接，将图片 URL 链接替换为图片元素
 * @param {Element} root
 */
function scanLinks(root) {
    if (!config/* CONFIG */.PI.imageRenderEnabled) return;
    if (!root || root.nodeType !== 1) return;
    const links = root.querySelectorAll('a[href]:not([data-anime-processed])');
    links.forEach(link => {
        if (!utils.isNodeAttached(link) || link.dataset.animeProcessed === 'true') return;
        const url = link.getAttribute('href');
        if (!url || !utils.isImageUrl(url)) return;
        link.dataset.animeProcessed = 'true';
        replaceNodeWithImage(link, url, link.textContent || '');
    });
}

/**
 * 扫描容器中的所有文本节点并处理（逆序遍历）
 * @param {Element} root
 */
function scanTextNodes(root) {
    if (!root || root.nodeType !== 1) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) => {
            const parent = node.parentNode;
            if (parent.tagName === 'SCRIPT' || parent.tagName === 'STYLE' || parent.tagName === 'IMG' || parent.tagName === 'A' ||
                parent.classList.contains('anime-image-link') || parent.classList.contains('anime-rendered-image')) {
                return NodeFilter.FILTER_REJECT;
            }
            return NodeFilter.FILTER_ACCEPT;
        }
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    // 逆序处理避免替换后索引偏移
    for (let i = nodes.length - 1; i >= 0; i--) {
        processTextNode(nodes[i]);
    }
}

/**
 * 全量扫描：角标清理 → 链接扫描 → 文本节点扫描 → Mermaid 图表扫描
 * 每个步骤独立 try-catch，防止单步失败导致整体崩溃
 * @param {Element} root
 */
function fullScan(root) {
    if (!root || root.nodeType !== 1) return;
    // early return：无子节点且非元素时跳过
    if (!root.childNodes || root.childNodes.length === 0) return;
    try { cleanElementCitations(root); } catch (e) {}
    try { scanLinks(root); } catch (e) {}
    try { scanTextNodes(root); } catch (e) {}
    try { scanMermaid(root); } catch (e) {}
}

;// ./src/observer.js
/**
 * MutationObserver 扫描模块
 *
 * 监听 DOM 变化，对新添加的节点和文本变化执行：
 *   - characterData 变化：收集文本节点，防抖批量处理（避免流式响应时逐 token 处理）
 *   - childList 变化：元素节点防抖批量扫描
 *   - 重试按钮扫描：独立防抖，避免每次 mutation 都全文档查询
 *   - 无用组件移除：集成到批量扫描，避免独立 observer
 */






let observer_observer = null;

// childList 批量扫描状态
let pendingElements = new Set();
let scanTimer = null;
const SCAN_DEBOUNCE = 200; // 元素扫描防抖时间

// characterData 批量处理状态
let pendingTextNodes = new Set();
let textScanTimer = null;
const TEXT_DEBOUNCE = 300; // 文本节点防抖时间（流式响应时收集后批量处理）

// 重试按钮扫描防抖状态
let retryTimer = null;
const RETRY_DEBOUNCE = 500;

/**
 * 防抖扫描：收集待处理元素，延迟批量执行 fullScan + 组件移除
 * @param {Element[]} elements - 新添加的元素节点列表
 */
function scheduleScan(elements) {
    for (let el of elements) {
        if (el.nodeType === 1) pendingElements.add(el);
    }
    if (scanTimer) clearTimeout(scanTimer);
    scanTimer = setTimeout(() => {
        const batch = pendingElements;
        pendingElements = new Set();
        scanTimer = null;
        for (let el of batch) {
            if (utils.isNodeAttached(el)) {
                try { fullScan(el); } catch (e) {}
                try { removeUnwantedComponents(el); } catch (e) {}
            }
        }
    }, SCAN_DEBOUNCE);
}

/**
 * 防抖处理 characterData 变化的文本节点
 * 流式响应时收集所有变化的文本节点，停止更新后批量处理
 * @param {Text} node - 文本节点
 */
function scheduleTextProcess(node) {
    pendingTextNodes.add(node);
    if (textScanTimer) clearTimeout(textScanTimer);
    textScanTimer = setTimeout(() => {
        const batch = pendingTextNodes;
        pendingTextNodes = new Set();
        textScanTimer = null;
        for (let tn of batch) {
            if (utils.isNodeAttached(tn)) {
                try { processTextNode(tn); } catch (e) {}
            }
        }
    }, TEXT_DEBOUNCE);
}

/**
 * 防抖扫描重试按钮
 * 避免每次 mutation 都执行全文档 querySelectorAll
 */
function scheduleRetryScan() {
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = setTimeout(() => {
        retryTimer = null;
        try { scanRetryButton(); } catch (e) {}
    }, RETRY_DEBOUNCE);
}

/**
 * MutationObserver 回调：处理 characterData 和 childList 变化
 * 使用防抖策略，避免流式响应时频繁处理
 * @param {MutationRecord[]} mutations
 */
function handleMutations(mutations) {
    let hasChildList = false;
    let hasRetry = false;

    for (const mut of mutations) {
        if (mut.type === 'characterData') {
            const node = mut.target;
            if (node.nodeType === 3 && utils.isNodeAttached(node)) {
                scheduleTextProcess(node);
            }
        } else if (mut.type === 'childList') {
            hasChildList = true;
            for (const node of mut.addedNodes) {
                if (node.nodeType === 3) {
                    if (utils.isNodeAttached(node)) scheduleTextProcess(node);
                } else if (node.nodeType === 1) {
                    scheduleScan([node]);
                }
            }
        }
    }

    // 防抖扫描重试按钮（仅在配置启用时）
    if (config/* CONFIG */.PI.autoRetryEnabled && (hasChildList || hasRetry)) {
        scheduleRetryScan();
    }
}

/**
 * 设置 MutationObserver 监听 document.body 的子节点和文本变化
 * 先断开旧 observer 避免重复监听
 */
function setupObserver() {
    if (observer_observer) observer_observer.disconnect();

    observer_observer = new MutationObserver(handleMutations);

    const observe = () => {
        if (!document.body) return;
        observer_observer.observe(document.body, {
            childList: true,
            subtree: true,
            characterData: true
        });
    };

    if (document.body) {
        observe();
    } else {
        requestAnimationFrame(observe);
    }
}

/**
 * 断开 MutationObserver 并清理所有待处理状态
 */
function disconnectObserver() {
    if (observer_observer) {
        observer_observer.disconnect();
        observer_observer = null;
    }
    // 清理所有待处理的防抖定时器
    if (scanTimer) { clearTimeout(scanTimer); scanTimer = null; }
    if (textScanTimer) { clearTimeout(textScanTimer); textScanTimer = null; }
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
    pendingElements.clear();
    pendingTextNodes.clear();
}

;// ./src/customizations/font.js
/**
 * 字体自定义模块
 *
 * 通过 CSS 变量 --anime-custom-font 注入自定义字体，
 * 配合 styles 模块中的 var(--anime-custom-font, fallback) !important 生效。
 * 支持：系统字体名、在线字体文件（woff2/woff/ttf/otf）、Google Fonts CSS 链接。
 */


/**
 * 根据 URL 扩展名推断 @font-face 的 format() 值
 * @param {string} url - 字体文件 URL
 * @returns {string} 格式标识符
 */
function detectFontFormat(url) {
    const lower = url.toLowerCase().split('?')[0].split('#')[0];
    if (lower.endsWith('.woff2')) return 'woff2';
    if (lower.endsWith('.woff')) return 'woff';
    if (lower.endsWith('.ttf')) return 'truetype';
    if (lower.endsWith('.otf')) return 'opentype';
    if (lower.endsWith('.eot')) return 'embedded-opentype';
    if (lower.endsWith('.svg')) return 'svg';
    return 'truetype';
}

/**
 * 应用自定义字体：通过 CSS 变量 --anime-custom-font 注入，
 * 被 styles 模块的 !important 规则引用。
 */
function applyFont() {
    const family = config/* CONFIG */.PI.fontFamily || '';
    const url = config/* CONFIG */.PI.fontUrl || '';
    const oldFontStyle = document.getElementById('anime-custom-font-style');
    if (oldFontStyle) oldFontStyle.remove();
    // 清除旧的行内样式（兼容旧版本残留）
    document.body.style.fontFamily = '';

    if (!family && !url) {
        // 无自定义字体，移除 CSS 变量
        document.documentElement.style.removeProperty('--anime-custom-font');
        return;
    }

    const style = document.createElement('style');
    style.id = 'anime-custom-font-style';
    let cssText = '';
    let effectiveFamily = family;

    if (url) {
        if (url.endsWith('.css') || url.includes('fonts.googleapis.com')) {
            // Google Fonts 或外部 CSS：@import 加载，使用 family 名称
            cssText += `@import url("${url}");\n`;
        } else {
            // 字体文件：创建 @font-face，自动推断格式
            const fmt = detectFontFormat(url);
            cssText += `
                @font-face {
                    font-family: 'CustomFont';
                    src: url("${url}") format('${fmt}');
                    font-weight: normal;
                    font-style: normal;
                    font-display: swap;
                }
            `.trim() + '\n';
            // 有 URL 字体文件时，优先使用 CustomFont
            effectiveFamily = "'CustomFont'" + (family ? ', ' + family : '');
        }
    }

    if (effectiveFamily) {
        // 通过 CSS 变量注入，被 styles 模块的 !important 规则引用
        cssText += `:root { --anime-custom-font: ${effectiveFamily}; }`;
    }

    style.textContent = cssText;
    document.head.appendChild(style);
}

;// ./src/customizations/placeholder.js
/**
 * 输入框占位符文字修改模块
 *
 * 修改 DeepSeek 输入框（textarea._27c9245）的占位符文字内容，
 * 替换默认的"在此处修改"等灰色提示文字为用户自定义内容。
 * 使用 MutationObserver 持续监听新出现的输入框。
 */


let placeholder_observer = null;

/**
 * 对单个 textarea 应用自定义占位符文字
 * @param {HTMLTextAreaElement} textarea
 */
function applyPlaceholder(textarea) {
    if (!textarea || textarea.tagName !== 'TEXTAREA') return;
    if (!textarea.classList.contains('_27c9245')) return;
    // 避免重复设置相同值触发不必要的事件
    const newText = config/* CONFIG */.PI.placeholderText || '说点什么吧～';
    if (textarea.placeholder !== newText) {
        textarea.placeholder = newText;
    }
}

/**
 * 扫描容器中所有 textarea 并应用占位符
 * @param {Element} root
 */
function applyPlaceholderStyle() {
    if (!config/* CONFIG */.PI.placeholderTextEnabled) return;
    if (!document.body) return;
    const textareas = document.querySelectorAll('textarea._27c9245');
    textareas.forEach(applyPlaceholder);
}

/**
 * 初始化占位符修改：立即应用 + MutationObserver 持续监听
 */
function initPlaceholder() {
    if (!config/* CONFIG */.PI.placeholderTextEnabled) return;

    applyPlaceholderStyle();

    if (placeholder_observer) placeholder_observer.disconnect();
    placeholder_observer = new MutationObserver((mutations) => {
        if (!config/* CONFIG */.PI.placeholderTextEnabled) return;
        for (const mut of mutations) {
            if (mut.type === 'childList') {
                for (const node of mut.addedNodes) {
                    if (node.nodeType === 1) {
                        if (node.tagName === 'TEXTAREA') {
                            applyPlaceholder(node);
                        } else if (node.querySelectorAll) {
                            node.querySelectorAll('textarea._27c9245').forEach(applyPlaceholder);
                        }
                    }
                }
            }
        }
    });
    placeholder_observer.observe(document.body, { childList: true, subtree: true });
}

;// ./src/customizations/background.js
/**
 * 聊天背景自定义模块
 *
 * 允许用户设置自定义背景图片和透明度，
 * 并提供 applyCustomizations 统一入口（字体 + 背景）。
 */





/**
 * 应用聊天背景图片与透明度
 * 通过在 body 上设置 background-image 和 --anime-card-bg-opacity 变量
 */
function applyBackground() {
    const bgImage = config/* CONFIG */.PI.bgImage || '';
    const bgOpacity = config/* CONFIG */.PI.bgOpacity !== undefined ? config/* CONFIG */.PI.bgOpacity : 0.5;
    const oldBgStyle = document.getElementById('anime-custom-bg-style');
    if (oldBgStyle) oldBgStyle.remove();

    if (!bgImage) {
        document.body.style.backgroundImage = '';
        document.documentElement.style.removeProperty('--anime-card-bg-opacity');
        return;
    }

    const style = document.createElement('style');
    style.id = 'anime-custom-bg-style';
    style.textContent = `
        body {
            background-image: url("${bgImage}") !important;
            background-size: cover !important;
            background-position: center !important;
            background-attachment: fixed !important;
        }
        /* 半透明遮罩层：通过伪元素叠加在背景之上 */
        body::before {
            content: '';
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(var(--anime-card-bg-rgb, 255,255,255), ${bgOpacity});
            z-index: -1;
            pointer-events: none;
        }
    `;
    document.head.appendChild(style);
}

/**
 * 统一应用所有自定义项（字体 + 背景 + 占位符文字）
 */
function applyCustomizations() {
    applyFont();
    applyBackground();
    applyPlaceholderStyle();
    initPlaceholder();
}

;// ./src/features/export.js
/**
 * 对话导出模块
 *
 * 支持三种导出格式：
 *   - JSON：原始 API 数据格式（包含 session、messages、fragments）
 *   - Markdown：人类可读的对话记录（含思考过程、时间戳）
 *   - PNG 图片：使用 html2canvas 截图（动态加载 CDN）
 *
 * 数据来源优先级：Store（API 拦截）→ IndexedDB → DOM 提取兜底
 */



const HTML2CANVAS_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';

/**
 * 动态加载 html2canvas 库
 * @returns {Promise<typeof html2canvas>}
 */
function loadHtml2Canvas() {
    if (typeof window.html2canvas === 'function') return Promise.resolve(window.html2canvas);
    return new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = HTML2CANVAS_CDN;
        s.onload = () => {
            if (typeof window.html2canvas === 'function') resolve(window.html2canvas);
            else reject(new Error('html2canvas 加载失败'));
        };
        s.onerror = () => reject(new Error('无法加载 html2canvas，请检查网络'));
        document.head.appendChild(s);
    });
}

/**
 * 从 DOM 提取对话数据（兜底方案，当 API 数据不可用时使用）
 * @returns {Object} { sid, aid, title, msgs, source }
 */
function extractDomExportData() {
    const root = document.querySelector('main') || document.querySelector('[role="main"]') || document.body;
    const selectors = [
        '.ds-message', '.ds-markdown', '[class*="markdown"]', '[class*="Markdown"]',
        '[data-message-id]', '[data-testid*="message"]', '[data-role]',
        '[class*="message"]', '[class*="Message"]', '[class*="prose"]',
        '[class*="content"]', '[class*="chat-message"]', 'article'
    ];
    const seen = new Set();
    const nodes = [];
    selectors.forEach(sel => {
        root.querySelectorAll(sel).forEach(el => {
            if (seen.has(el) || !el.offsetParent) return;
            const text = (el.innerText || el.textContent || '').trim();
            if (text.length < 2) return;
            seen.add(el);
            nodes.push({ el, text });
        });
    });
    if (nodes.length === 0) {
        root.querySelectorAll('p, li, pre, h1, h2, h3, blockquote').forEach(el => {
            if (seen.has(el) || !el.offsetParent) return;
            const text = (el.innerText || el.textContent || '').trim();
            if (text.length < 6) return;
            seen.add(el);
            nodes.push({ el, text });
        });
    }
    // 去重
    const unique = [];
    const textSeen = new Set();
    nodes.forEach(item => {
        const compact = item.text.replace(/\s+/g, ' ').slice(0, 500);
        if (textSeen.has(compact)) return;
        textSeen.add(compact);
        unique.push(item);
    });
    const msgs = unique.map((item, i) => {
        const cls = String(item.el?.className || '').toLowerCase();
        const role = /user|human|question|ask/.test(cls) ? 'USER' :
                     (/assistant|bot|answer|ai|deepseek/.test(cls) ? 'ASSISTANT' : (i % 2 === 0 ? 'USER' : 'ASSISTANT'));
        return {
            message_id: 'dom-' + i,
            role,
            status: 'FINISHED',
            inserted_at: Math.floor(Date.now() / 1000),
            fragments: [{ type: 'RESPONSE', content: item.text }]
        };
    });
    return {
        sid: getSidFromUrl() || 'dom-' + Date.now(),
        aid: '',
        title: document.title.replace(/\s*-\s*DeepSeek.*/i, '') || 'DeepSeek 对话',
        msgs,
        source: 'dom'
    };
}

/**
 * 执行 JSON 或 Markdown 导出
 * @param {string} type - 'json' 或 'md'
 * @param {Object} data - 对话数据
 */
function execExport(type, data) {
    const safeTitle = (data.title || 'DeepSeek').replace(/[/\\?%*:|"<>]/g, '-');
    const dateStr = new Date().toISOString().slice(0, 10);

    if (type === 'json') {
        const blob = new Blob([JSON.stringify({
            chat_session: { id: data.sid, title: data.title },
            chat_messages: data.msgs
        }, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = safeTitle + '_' + dateStr + '.json';
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    } else {
        let md = '# ' + (data.title || 'DeepSeek 对话') + '\n\n';
        data.msgs.forEach(msg => {
            const role = (msg.role || '').toUpperCase() === 'USER' ? '👤 用户' : '🤖 DeepSeek';
            const time = msg.inserted_at ? new Date(msg.inserted_at * 1000).toLocaleString() : '';
            md += '### ' + role + '\n';
            if (time) md += '*' + time + '*\n\n';
            const frags = msg.fragments || [];
            let contentAdded = false;
            frags.forEach(f => {
                if (f.type === 'THINK') {
                    md += '> 💭 思考过程:\n> ' + (f.content || '').replace(/\n/g, '\n> ') + '\n\n';
                    contentAdded = true;
                }
                if (f.type === 'RESPONSE' && f.content) {
                    md += f.content + '\n\n';
                    contentAdded = true;
                }
            });
            if (!contentAdded && msg.content) md += msg.content + '\n\n';
            md += '---\n\n';
        });
        const blob = new Blob([md], { type: 'text/markdown' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = safeTitle + '_' + dateStr + '.md';
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }
}

/**
 * 导出对话为 JSON 或 Markdown
 * @param {string} type - 'json' 或 'md'
 * @returns {Promise<boolean>} 是否成功
 */
async function doExport(type) {
    // 优先使用 Store 中的 API 数据
    if (Store.hasData()) {
        execExport(type, Store.get());
        return true;
    }

    // 尝试从 URL 获取会话 ID 并直接请求 API
    const sid = getSidFromUrl() || Store.get().sid;
    if (sid) {
        try {
            const resp = await fetch('/api/v0/chat/history_messages?chat_session_id=' + sid);
            if (resp.ok) {
                const json = await resp.json();
                const biz = findBizPayload(json?.data?.biz_data) || findBizPayload(json);
                if (biz) {
                    handleBiz(biz);
                    if (Store.hasData()) {
                        execExport(type, Store.get());
                        return true;
                    }
                }
            }
        } catch(e) {}
    }

    // 兜底：从 DOM 提取数据
    const domData = extractDomExportData();
    if (domData.msgs.length > 0) {
        execExport(type, domData);
        return true;
    }

    alert('未找到对话数据，请先打开一个对话后重试');
    return false;
}

/**
 * 导出对话为 PNG 图片
 * 动态加载 html2canvas，支持选择消息范围
 * @returns {Promise<boolean>} 是否成功
 */
async function doImageExport() {
    // 获取消息节点
    const root = document.querySelector('main') || document.querySelector('[role="main"]') || document.body;
    const selectors = ['.ds-message', '[data-message-id]', '[data-testid*="message"]', '[class*="message"]', '[class*="Message"]', 'article'];
    let msgs = [];
    const seen = new Set();
    for (const sel of selectors) {
        const nodes = [...root.querySelectorAll(sel)].filter(el => {
            if (seen.has(el) || el.id?.startsWith('ds-') || el.id?.startsWith('dss-')) return false;
            const text = (el.innerText || el.textContent || '').trim();
            const rect = el.getBoundingClientRect();
            return text.length >= 2 && rect.width >= 80 && rect.height >= 12;
        });
        if (nodes.length) { msgs = nodes; break; }
        nodes.forEach(n => seen.add(n));
    }

    if (!msgs.length) {
        alert('未找到对话内容');
        return false;
    }

    // 加载 html2canvas
    let html2canvas;
    try {
        html2canvas = await loadHtml2Canvas();
    } catch(e) {
        alert(e.message);
        return false;
    }

    // 创建离屏容器并克隆消息
    const container = document.createElement('div');
    container.style.cssText = 'width:760px;max-width:760px;padding:20px;background:#fff;position:fixed;left:-10000px;top:0;color:#111827;font-family:system-ui,sans-serif';
    msgs.forEach(m => {
        const clone = m.cloneNode(true);
        clone.style.setProperty('max-width', '100%', 'important');
        clone.style.setProperty('width', '100%', 'important');
        clone.style.setProperty('box-sizing', 'border-box', 'important');
        container.appendChild(clone);
    });
    document.body.appendChild(container);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

    try {
        const totalText = msgs.reduce((n, el) => n + ((el.innerText || el.textContent || '').length), 0);
        const scale = msgs.length > 16 || totalText > 16000 ? 1 : 1.35;
        const canvas = await html2canvas(container, {
            scale, backgroundColor: '#ffffff', useCORS: true, logging: false, removeContainer: false
        });
        const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
        const a = document.createElement('a');
        a.download = 'deepseek-' + new Date().toISOString().slice(0, 10) + '.png';
        a.href = URL.createObjectURL(blob);
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
        return true;
    } catch(e) {
        alert('截图失败: ' + e.message);
        return false;
    } finally {
        container.remove();
    }
}

;// ./src/ui/settings-panel.js
/**
 * 设置面板模块（分类标签页 + 现代化设计）
 *
 * 分类：
 *   🎨 外观  — 主题、樱花、窄边距、字体、背景
 *   ✨ 功能  — 图片、删除线、角标、Mermaid、防撤回、自动重试
 *   🧹 清理  — 移除转发、移除下载、占位符修改
 *   🔒 隐私  — 标题伪装、自动跳转、标题列表
 *   💬 预设  — 消息预设管理
 *
 * 帮助图标使用弹出框（兼容手机端触摸）。
 */






let settingsModal = null;

/** 各功能开关的帮助描述文本 */
const optionDescriptions = {
    sakura: '在页面中飘落樱花动画，营造氛围',
    image: '自动将 Markdown 图片链接和纯图片 URL 渲染为可点击预览的图片',
    strikethrough: '将 ~~text~~ 转换为删除线样式（代码块内不生效）',
    redirect: '仅当访问 www.deepseek.com 或 deepseek.com 时跳转到 chat.deepseek.com',
    title: '随机更换浏览器标签页标题，保护隐私',
    narrow: '压缩聊天内容的左右内边距，使布局更紧凑',
    citation: '移除回复中的 [citation:数字] 和来源图标',
    antiRecall: '拦截并缓存被撤回的回复，防止内容消失',
    mermaid: '渲染 Mermaid 代码块为图表（流程图、时序图等）',
    autoRetry: '当出现重试按钮时自动点击，最多重试 10 次',
    defaultMode: '新对话开始时自动切换到指定模式（快速/专家/识图）',
    removeForward: '移除消息上的转发/分享按钮',
    removeDownloadApp: '移除页面中的下载应用入口和下拉菜单中的下载选项',
    placeholderText: '修改输入框的占位符提示文字内容',
    exportJson: '将当前对话导出为 JSON 格式（包含完整 API 数据）',
    exportMd: '将当前对话导出为 Markdown 格式（含思考过程、时间戳）',
    exportImage: '将当前对话截图导出为 PNG 图片（需联网加载 html2canvas）',
    promptInject: '在每次发送消息时自动注入系统提示词（DeepSeek 不会显示但会遵循）',
    privacyShield: '将页面中的敏感词替换为指定文本，保护隐私信息',
    copyCode: '点击 Markdown 行内代码时自动复制到剪贴板',
    folderPanel: '在 DeepSeek 侧边栏嵌入文件夹管理面板，支持两层层级结构和会话收藏'
};

// ============================================================
// 帮助弹出框（支持手机端触摸）
// ============================================================

/**
 * 显示帮助弹出框
 * @param {string} text - 帮助文本
 * @param {HTMLElement} anchorEl - 触发元素（用于定位）
 */
function showHelpPopup(text, anchorEl) {
    // 移除已有弹出框
    hideHelpPopup();

    const popup = document.createElement('div');
    popup.id = 'anime-help-popup';
    popup.textContent = text;
    popup.style.cssText = `
        position: fixed;
        background: rgba(0, 0, 0, 0.85);
        color: #fff;
        padding: 8px 14px;
        border-radius: 8px;
        font-size: 13px;
        max-width: 260px;
        z-index: 9999999;
        pointer-events: none;
        line-height: 1.5;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        animation: animeFadeIn 0.15s ease;
    `;

    const rect = anchorEl.getBoundingClientRect();
    let top = rect.bottom + 6;
    let left = rect.left;

    document.body.appendChild(popup);

    // 调整位置防止超出屏幕
    const popupRect = popup.getBoundingClientRect();
    if (left + popupRect.width > window.innerWidth - 8) {
        left = window.innerWidth - popupRect.width - 8;
    }
    if (top + popupRect.height > window.innerHeight - 8) {
        top = rect.top - popupRect.height - 6;
    }

    popup.style.top = top + 'px';
    popup.style.left = left + 'px';
}

/**
 * 隐藏帮助弹出框
 */
function hideHelpPopup() {
    const existing = document.getElementById('anime-help-popup');
    if (existing) existing.remove();
}

// ============================================================
// 预设列表
// ============================================================

function buildPresetList() {
    const presets = config/* CONFIG */.PI.presets || [];
    if (presets.length === 0) return '<div style="color:#999;font-size:13px;padding:8px 0;">暂无预设，添加一个吧</div>';
    return presets.map((p, idx) => `
        <div class="anime-preset-item" data-index="${idx}">
            <span><span class="name">${p.name || '未命名'}</span><span class="prompt">${p.prompt || ''}</span></span>
            <button class="delete-btn" data-index="${idx}">✕</button>
        </div>
    `).join('');
}

function deleteHandler(e) {
    const idx = parseInt(this.dataset.index);
    config/* CONFIG */.PI.presets.splice(idx, 1);
    const container = document.getElementById('preset-list-container');
    if (container) {
        container.innerHTML = buildPresetList();
        container.querySelectorAll('.delete-btn').forEach(btn => {
            btn.addEventListener('click', deleteHandler);
        });
    }
}

// ============================================================
// 创建设置面板
// ============================================================

function createSettingsModal() {
    const modal = document.createElement('div');
    modal.id = 'ds-settings-modal';
    const isDark = utils.isDarkMode();
    modal.style.cssText = `
        position: fixed;
        top: 0; left: 0;
        width: 100%; height: 100%;
        background: rgba(0, 0, 0, 0.5);
        backdrop-filter: blur(6px);
        display: none;
        justify-content: center;
        align-items: center;
        z-index: 999999;
        font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
    `;

    // 注入样式（仅一次）
    if (!document.getElementById('anime-settings-style')) {
        const style = document.createElement('style');
        style.id = 'anime-settings-style';
        style.textContent = `
            @keyframes animeFadeIn { from { opacity: 0; } to { opacity: 1; } }
            @keyframes animeSlideUp { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }
            .anime-settings-card { animation: animeSlideUp 0.25s ease; }
            .anime-toggle { position: relative; display: inline-block; width: 40px; height: 22px; flex-shrink: 0; }
            .anime-toggle input { opacity: 0; width: 0; height: 0; }
            .anime-slider { position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background: #ccc; transition: .25s; border-radius: 22px; }
            .anime-slider:before { position: absolute; content: ""; height: 16px; width: 16px; left: 3px; bottom: 3px; background: white; transition: .25s; border-radius: 50%; }
            .anime-toggle input:checked + .anime-slider { background: var(--anime-primary, #f08ca8); }
            .anime-toggle input:checked + .anime-slider:before { transform: translateX(18px); }
            .anime-row { display: flex; align-items: center; gap: 6px; padding: 7px 0; }
            .anime-row .label-text { flex: 1; font-size: 14px; cursor: pointer; }
            .anime-help-icon { display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; border-radius: 50%; background: rgba(0,0,0,0.08); color: #888; font-size: 12px; font-weight: 700; cursor: pointer; transition: 0.2s; flex-shrink: 0; user-select: none; }
            .anime-help-icon:hover { background: rgba(0,0,0,0.18); color: #555; }
            .anime-tab-bar { display: flex; gap: 2px; border-bottom: 2px solid #e0e0e0; margin-bottom: 12px; flex-wrap: wrap; }
            .anime-tab { padding: 8px 14px; cursor: pointer; font-size: 14px; font-weight: 500; border-bottom: 2px solid transparent; margin-bottom: -2px; transition: 0.2s; border-radius: 6px 6px 0 0; opacity: 0.6; }
            .anime-tab:hover { opacity: 0.85; }
            .anime-tab.active { opacity: 1; border-bottom-color: var(--anime-primary, #f08ca8); color: var(--anime-primary, #f08ca8); }
            .anime-tab-content { display: none; }
            .anime-tab-content.active { display: block; animation: animeFadeIn 0.2s ease; }
            .anime-section-title { font-weight: 600; font-size: 14px; margin: 12px 0 6px; opacity: 0.7; }
            .anime-preset-item { display: flex; align-items: center; justify-content: space-between; padding: 5px 0; border-bottom: 1px solid #eee; }
            .anime-preset-item .name { font-weight: 500; }
            .anime-preset-item .prompt { color: #666; font-size: 13px; margin-left: 8px; }
            .anime-preset-item .delete-btn { background: none; border: none; color: #e74c3c; cursor: pointer; font-size: 16px; }
            .anime-preset-add { display: flex; gap: 8px; margin-top: 8px; flex-wrap: wrap; }
            .anime-preset-add input { flex: 1; min-width: 80px; padding: 5px 10px; border-radius: 8px; border: 1px solid #ccc; }
            .anime-preset-add button { padding: 5px 14px; border: none; border-radius: 8px; background: var(--anime-primary, #f08ca8); color: #fff; cursor: pointer; }
            .anime-input { padding: 5px 10px; border-radius: 8px; border: 1px solid #ccc; width: 100%; font-size: 14px; box-sizing: border-box; }
            .anime-input-row { display: flex; gap: 8px; align-items: center; margin-bottom: 6px; flex-wrap: wrap; }
            .anime-input-row label { font-size: 13px; min-width: 90px; }
        `;
        document.head.appendChild(style);
    }

    const panel = document.createElement('div');
    const t = getThemeColors(config/* CONFIG */.PI.themeColor) || { primary: '#f08ca8', accent: '#ffb7c5' };
    panel.className = 'anime-settings-card';
    panel.style.cssText = `
        background: ${isDark ? '#2a1d28' : '#ffffff'};
        color: ${isDark ? '#e8d5dd' : '#4a3040'};
        border-radius: 20px;
        padding: 24px 28px;
        max-width: 680px;
        width: 92%;
        max-height: 85vh;
        overflow-y: auto;
        box-shadow: 0 24px 64px rgba(0,0,0,0.4);
        border: 1px solid ${isDark ? '#5a3a50' : '#fcd5df'};
    `;

    // 主题颜色选择器
    const themeNames = ['pink','blue','purple','green','orange','border','original'];
    const themeOptions = themeNames.map(name => {
        if (name === 'original') return `<span data-theme="original" style="display:inline-block;padding:2px 12px;border-radius:16px;background:#ccc;color:#333;font-size:13px;cursor:pointer;border:2px solid transparent;margin:3px;">默认</span>`;
        const th = THEMES[name].light;
        return `<span data-theme="${name}" style="display:inline-block;width:28px;height:28px;border-radius:50%;background:${th.primary};cursor:pointer;border:2px solid transparent;box-shadow:0 2px 6px rgba(0,0,0,0.15);margin:3px;" title="${name}"></span>`;
    }).join('');

    // 生成开关行的 HTML
    function toggleRow(id, label) {
        const desc = optionDescriptions[id] || '';
        return `
            <div class="anime-row">
                <span class="label-text" data-toggle="${id}">${label}</span>
                <span class="anime-help-icon" data-help="${desc}">?</span>
                <label class="anime-toggle">
                    <input type="checkbox" id="chk-${id}" ${config/* CONFIG */.PI[config/* OPTION_CONFIG_KEYS */.cD[id]] ? 'checked' : ''}>
                    <span class="anime-slider"></span>
                </label>
            </div>
        `;
    }

    panel.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
            <div>
                <h2 style="margin:0;font-size:22px;font-weight:700;background:linear-gradient(135deg, ${t.primary}, ${t.accent});-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;">⚙️ 脚本设置</h2>
                <span style="font-size:12px;color:${isDark?'#999':'#aaa'};">DeepSeek Promax v3.8.0</span>
            </div>
            <button id="ds-settings-close" style="background:none;border:none;font-size:26px;cursor:pointer;color:inherit;opacity:0.5;transition:0.2s;padding:4px 8px;">&times;</button>
        </div>

        <div class="anime-tab-bar">
            <div class="anime-tab active" data-tab="appearance">🎨 外观</div>
            <div class="anime-tab" data-tab="features">✨ 功能</div>
            <div class="anime-tab" data-tab="cleanup">🧹 清理</div>
            <div class="anime-tab" data-tab="privacy">🔒 隐私</div>
            <div class="anime-tab" data-tab="presets">💬 预设</div>
            <div class="anime-tab" data-tab="export">📤 导出</div>
            <div class="anime-tab" data-tab="loop">👻 循环</div>
        </div>

        <!-- 🎨 外观 -->
        <div class="anime-tab-content active" data-content="appearance">
            <div class="anime-section-title">主题颜色</div>
            <div id="theme-selector" style="display:flex;flex-wrap:wrap;align-items:center;margin-bottom:8px;">${themeOptions}</div>
            ${toggleRow('sakura', '🌸 樱花飘落')}
            ${toggleRow('narrow', '📐 窄边距')}

            <div class="anime-section-title">🔤 字体自定义</div>
            <div class="anime-input-row">
                <label>系统字体：</label>
                <input type="text" class="anime-input" id="font-family" placeholder="如：Arial, 'Microsoft YaHei'" value="${config/* CONFIG */.PI.fontFamily || ''}" style="flex:1;">
            </div>
            <div class="anime-input-row">
                <label>在线字体 URL：</label>
                <input type="text" class="anime-input" id="font-url" placeholder=".woff2 / .ttf 或 Google Fonts CSS" value="${config/* CONFIG */.PI.fontUrl || ''}" style="flex:1;">
            </div>

            <div class="anime-section-title">🖼️ 聊天背景</div>
            <div class="anime-input-row">
                <label>图片 URL：</label>
                <input type="text" class="anime-input" id="bg-image" placeholder="输入图片链接或选择文件" value="${config/* CONFIG */.PI.bgImage || ''}" style="flex:1;">
                <input type="file" id="bg-file-input" accept="image/*" style="max-width:110px;">
            </div>
            <div class="anime-input-row">
                <label>透明度：</label>
                <input type="range" id="bg-opacity" min="0" max="1" step="0.05" value="${config/* CONFIG */.PI.bgOpacity !== undefined ? config/* CONFIG */.PI.bgOpacity : 0.5}" style="flex:1;">
                <span id="bg-opacity-label" style="min-width:32px;text-align:right;">${(config/* CONFIG */.PI.bgOpacity !== undefined ? config/* CONFIG */.PI.bgOpacity : 0.5).toFixed(2)}</span>
            </div>
        </div>

        <!-- ✨ 功能 -->
        <div class="anime-tab-content" data-content="features">
            ${toggleRow('image', '🖼️ 图片渲染')}
            ${toggleRow('strikethrough', '✏️ 删除线渲染')}
            ${toggleRow('citation', '🗑️ 移除角标')}
            ${toggleRow('mermaid', '📊 Mermaid 图表')}
            ${toggleRow('antiRecall', '🛡️ 防撤回')}
            ${toggleRow('autoRetry', '🔄 自动重试')}
            ${toggleRow('copyCode', '📋 行内代码点击复制')}
            ${toggleRow('folderPanel', '📁 文件夹管理')}
            ${toggleRow('defaultMode', '⚡ 默认模式')}
            <div class="anime-input-row" style="margin-top:4px;">
                <label>目标模式：</label>
                <select id="default-mode-select" class="anime-input" style="flex:1;">
                    <option value="default" ${(config/* CONFIG */.PI.defaultMode||'default')==='default'?'selected':''}>快速模式（不切换）</option>
                    <option value="expert" ${config/* CONFIG */.PI.defaultMode==='expert'?'selected':''}>专家模式</option>
                    <option value="vision" ${config/* CONFIG */.PI.defaultMode==='vision'?'selected':''}>识图模式</option>
                </select>
            </div>
        </div>

        <!-- 🧹 清理 -->
        <div class="anime-tab-content" data-content="cleanup">
            ${toggleRow('removeForward', '✂️ 移除转发按钮')}
            ${toggleRow('removeDownloadApp', '📱 移除下载入口')}
            ${toggleRow('placeholderText', '💬 修改占位符文字')}
            <div class="anime-input-row" style="margin-top:4px;">
                <label>占位文字：</label>
                <input type="text" class="anime-input" id="placeholder-text" placeholder="如：说点什么吧～" value="${config/* CONFIG */.PI.placeholderText || ''}" style="flex:1;">
            </div>
        </div>

        <!-- 🔒 隐私 -->
        <div class="anime-tab-content" data-content="privacy">
            ${toggleRow('title', '🎭 标题伪装')}
            ${toggleRow('redirect', '↗️ 自动跳转')}
            <div class="anime-section-title">📝 标题列表（每行一个）</div>
            <textarea id="title-list-text" rows="5" class="anime-input" style="resize:vertical;line-height:1.6;">${(config/* CONFIG */.PI.titleList||config/* DEFAULTS */.zY.titleList).join('\n')}</textarea>
            <div class="anime-section-title" style="margin-top:16px;">🔐 敏感词替换</div>
            ${toggleRow('privacyShield', '🛡️ 启用敏感词替换')}
            ${toggleRow('caseSensitive', '🔍 区分大小写')}
            <div class="anime-preset-add" style="margin-top:6px;">
                <input type="text" id="sensitive-word-input" placeholder="敏感词" style="flex:1;">
                <input type="text" id="sensitive-replacement-input" placeholder="替换为" style="flex:1;">
                <button id="add-sensitive-word-btn">添加</button>
            </div>
            <div id="sensitive-word-list" style="margin-top:8px;"></div>
        </div>

        <!-- 💬 预设 -->
        <div class="anime-tab-content" data-content="presets">
            <div class="anime-section-title">消息预设（输入框中输入 / 触发菜单）</div>
            <div id="preset-list-container">${buildPresetList()}</div>
            <div class="anime-preset-add">
                <input type="text" id="preset-name" placeholder="名称（如：猫娘）" style="flex:1;">
                <input type="text" id="preset-prompt" placeholder="提示词（如：你是一个猫娘）" style="flex:2;">
                <button id="add-preset-btn">添加</button>
            </div>
        </div>

        <!-- 📤 导出 -->
        <div class="anime-tab-content" data-content="export">
            <div class="anime-section-title">对话导出</div>
            ${toggleRow('exportJson', '📥 导出 JSON')}
            ${toggleRow('exportMd', '📝 导出 Markdown')}
            ${toggleRow('exportImage', '📸 导出图片 PNG')}
            <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;">
                <button id="ds-export-json-btn" style="flex:1;min-width:100px;padding:9px;border:none;border-radius:20px;background:rgba(5,150,105,0.8);color:#fff;font-weight:600;font-size:13px;cursor:pointer;transition:0.2s;">📥 立即导出 JSON</button>
                <button id="ds-export-md-btn" style="flex:1;min-width:100px;padding:9px;border:none;border-radius:20px;background:rgba(37,99,235,0.8);color:#fff;font-weight:600;font-size:13px;cursor:pointer;transition:0.2s;">📝 立即导出 MD</button>
                <button id="ds-export-img-btn" style="flex:1;min-width:100px;padding:9px;border:none;border-radius:20px;background:rgba(124,58,237,0.8);color:#fff;font-weight:600;font-size:13px;cursor:pointer;transition:0.2s;">📸 立即截图</button>
            </div>
            <div class="anime-section-title" style="margin-top:16px;">系统提示词注入</div>
            ${toggleRow('promptInject', '🤖 启用提示词注入')}
            <div class="anime-input-row" style="margin-top:4px;">
                <label>提示词内容：</label>
                <textarea id="prompt-inject-text" rows="4" class="anime-input" style="resize:vertical;line-height:1.6;flex:1;" placeholder="输入系统提示词，将在每次对话时自动注入…">${config/* CONFIG */.PI.promptText || ''}</textarea>
            </div>
        </div>

        <!-- 👻 循环引擎 -->
        <div class="anime-tab-content" data-content="loop">
            <div class="anime-section-title">循环引擎</div>
            ${toggleRow('loopEngine', '👻 启用循环引擎')}
            ${toggleRow('loopNotify', '🔔 桌面通知')}
            ${toggleRow('loopCrashRecovery', '🔄 崩溃恢复')}
            <div style="margin-top:10px;padding:10px;border-radius:12px;background:${isDark?'rgba(255,255,255,0.05)':'rgba(0,0,0,0.03)'};font-size:12px;line-height:1.6;color:${isDark?'#aaa':'#666'};">
                <b>信号协议：</b>AI 回复以 <code>[[GITL::PROCEED]]</code> 结尾则自动继续，以 <code>[[GITL::HALT]]</code> 结尾则停止。<br>
                <b>防检测：</b>8-15 秒随机延迟。 <b>看门狗：</b>3 分钟无活动自动暂停。
            </div>

            <div class="anime-section-title" style="margin-top:14px;">▶ 循环模式</div>
            <div class="anime-input-row">
                <label>任务描述：</label>
                <textarea id="loop-task-input" rows="3" class="anime-input" style="resize:vertical;line-height:1.6;flex:1;" placeholder="输入要循环执行的任务…"></textarea>
            </div>
            <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;">
                <button id="ds-loop-start-btn" style="flex:1;min-width:100px;padding:9px;border:none;border-radius:20px;background:rgba(34,197,94,0.8);color:#fff;font-weight:600;font-size:13px;cursor:pointer;transition:0.2s;">▶ 开始循环</button>
                <button id="ds-loop-pause-btn" style="flex:1;min-width:100px;padding:9px;border:none;border-radius:20px;background:rgba(234,179,8,0.8);color:#fff;font-weight:600;font-size:13px;cursor:pointer;transition:0.2s;">⏸ 暂停</button>
                <button id="ds-loop-stop-btn" style="flex:1;min-width:100px;padding:9px;border:none;border-radius:20px;background:rgba(239,68,68,0.8);color:#fff;font-weight:600;font-size:13px;cursor:pointer;transition:0.2s;">⏹ 停止</button>
                <button id="ds-loop-reset-btn" style="flex:1;min-width:100px;padding:9px;border:none;border-radius:20px;background:rgba(107,114,128,0.8);color:#fff;font-weight:600;font-size:13px;cursor:pointer;transition:0.2s;">↺ 重置</button>
            </div>

            <div class="anime-section-title" style="margin-top:14px;">🗺 路线图自动驾驶</div>
            <div class="anime-input-row">
                <label>任务描述：</label>
                <textarea id="roadmap-task-input" rows="3" class="anime-input" style="resize:vertical;line-height:1.6;flex:1;" placeholder="输入任务，AI 会先生成路线图再逐步执行…"></textarea>
            </div>
            <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;">
                <button id="ds-roadmap-start-btn" style="flex:1;min-width:120px;padding:9px;border:none;border-radius:20px;background:rgba(124,58,237,0.8);color:#fff;font-weight:600;font-size:13px;cursor:pointer;transition:0.2s;">🗺 路线图</button>
                <button id="ds-thinkfirst-btn" style="flex:1;min-width:120px;padding:9px;border:none;border-radius:20px;background:rgba(59,130,246,0.8);color:#fff;font-weight:600;font-size:13px;cursor:pointer;transition:0.2s;">🧠 先思考</button>
            </div>

            <div class="anime-section-title" style="margin-top:14px;">📋 提示词队列</div>
            <div class="anime-input-row">
                <label>任务列表：</label>
                <textarea id="queue-input" rows="5" class="anime-input" style="resize:vertical;line-height:1.6;flex:1;" placeholder="每行一个任务，脚本会依次执行…&#10;1. 分析需求&#10;2. 设计架构&#10;3. 编写代码&#10;4. 测试验证"></textarea>
            </div>
            <button id="ds-queue-start-btn" style="width:100%;margin-top:8px;padding:9px;border:none;border-radius:20px;background:rgba(20,184,166,0.8);color:#fff;font-weight:600;font-size:13px;cursor:pointer;transition:0.2s;">📋 开始队列</button>

            <div class="anime-section-title" style="margin-top:14px;">🤝 交接报告</div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
                <button id="ds-handoff-btn" style="flex:1;min-width:120px;padding:9px;border:none;border-radius:20px;background:rgba(236,72,153,0.8);color:#fff;font-weight:600;font-size:13px;cursor:pointer;transition:0.2s;">🤝 生成交接</button>
                <button id="ds-handoff-backup-btn" style="flex:1;min-width:120px;padding:9px;border:none;border-radius:20px;background:rgba(99,102,241,0.8);color:#fff;font-weight:600;font-size:13px;cursor:pointer;transition:0.2s;">📥 备份交接</button>
            </div>
        </div>

        <div style="display:flex;gap:10px;margin-top:18px;">
            <button id="ds-settings-save" style="flex:1;padding:11px;border:none;border-radius:24px;background:linear-gradient(135deg, ${t.primary}, ${t.accent});color:#fff;font-weight:700;font-size:15px;cursor:pointer;box-shadow:0 3px 10px rgba(0,0,0,0.12);transition:0.2s;">💾 保存并应用</button>
            <button id="ds-settings-reset" style="padding:11px 18px;border:1px solid ${isDark?'#5a3a50':'#fcd5df'};border-radius:24px;background:transparent;color:inherit;cursor:pointer;font-weight:600;transition:0.2s;">↺ 恢复默认</button>
        </div>
    `;

    modal.appendChild(panel);
    document.body.appendChild(modal);

    // ===== 事件绑定 =====
    const closeBtn = modal.querySelector('#ds-settings-close');
    const saveBtn = modal.querySelector('#ds-settings-save');
    const resetBtn = modal.querySelector('#ds-settings-reset');

    closeBtn.addEventListener('click', hideSettings);
    saveBtn.addEventListener('click', saveSettings);
    resetBtn.addEventListener('click', resetSettings);

    // 标签页切换
    modal.querySelectorAll('.anime-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const target = tab.dataset.tab;
            modal.querySelectorAll('.anime-tab').forEach(t => t.classList.toggle('active', t === tab));
            modal.querySelectorAll('.anime-tab-content').forEach(c => {
                c.classList.toggle('active', c.dataset.content === target);
            });
        });
    });

    // 导出按钮事件
    const exportJsonBtn = modal.querySelector('#ds-export-json-btn');
    const exportMdBtn = modal.querySelector('#ds-export-md-btn');
    const exportImgBtn = modal.querySelector('#ds-export-img-btn');
    if (exportJsonBtn) exportJsonBtn.addEventListener('click', () => doExport('json'));
    if (exportMdBtn) exportMdBtn.addEventListener('click', () => doExport('md'));
    if (exportImgBtn) exportImgBtn.addEventListener('click', () => doImageExport());

    // 循环引擎事件绑定
    const loopStartBtn = modal.querySelector('#ds-loop-start-btn');
    const loopPauseBtn = modal.querySelector('#ds-loop-pause-btn');
    const loopStopBtn = modal.querySelector('#ds-loop-stop-btn');
    const loopResetBtn = modal.querySelector('#ds-loop-reset-btn');
    const roadmapStartBtn = modal.querySelector('#ds-roadmap-start-btn');
    const thinkFirstBtn = modal.querySelector('#ds-thinkfirst-btn');
    const queueStartBtn = modal.querySelector('#ds-queue-start-btn');
    const handoffBtn = modal.querySelector('#ds-handoff-btn');
    const handoffBackupBtn = modal.querySelector('#ds-handoff-backup-btn');

    if (loopStartBtn) loopStartBtn.addEventListener('click', async () => {
        const { startLoop, requestNotifyPermission } = await Promise.resolve(/* import() */).then(__webpack_require__.bind(__webpack_require__, 433));
        if (config/* CONFIG */.PI.loopNotifyEnabled) await requestNotifyPermission();
        const task = modal.querySelector('#loop-task-input')?.value || '';
        startLoop(task.trim() || undefined);
        hideSettings();
    });
    if (loopPauseBtn) loopPauseBtn.addEventListener('click', async () => {
        const { pauseLoop } = await Promise.resolve(/* import() */).then(__webpack_require__.bind(__webpack_require__, 433));
        pauseLoop('手动暂停');
    });
    if (loopStopBtn) loopStopBtn.addEventListener('click', async () => {
        const { stopLoop } = await Promise.resolve(/* import() */).then(__webpack_require__.bind(__webpack_require__, 433));
        stopLoop();
    });
    if (loopResetBtn) loopResetBtn.addEventListener('click', async () => {
        const { resetLoop } = await Promise.resolve(/* import() */).then(__webpack_require__.bind(__webpack_require__, 433));
        resetLoop();
    });
    if (roadmapStartBtn) roadmapStartBtn.addEventListener('click', async () => {
        const { startRoadmap } = await Promise.resolve(/* import() */).then(__webpack_require__.bind(__webpack_require__, 350));
        const task = modal.querySelector('#roadmap-task-input')?.value || '';
        if (task.trim()) { startRoadmap(task); hideSettings(); }
    });
    if (thinkFirstBtn) thinkFirstBtn.addEventListener('click', async () => {
        const { startThinkFirst } = await Promise.resolve(/* import() */).then(__webpack_require__.bind(__webpack_require__, 350));
        const task = modal.querySelector('#roadmap-task-input')?.value || '';
        if (task.trim()) { startThinkFirst(task); hideSettings(); }
    });
    if (queueStartBtn) queueStartBtn.addEventListener('click', async () => {
        const { startQueue } = await Promise.resolve(/* import() */).then(__webpack_require__.bind(__webpack_require__, 350));
        const lines = modal.querySelector('#queue-input')?.value || '';
        if (lines.trim()) { startQueue(lines); hideSettings(); }
    });
    if (handoffBtn) handoffBtn.addEventListener('click', async () => {
        const { handoffInChat } = await Promise.resolve(/* import() */).then(__webpack_require__.bind(__webpack_require__, 164));
        handoffInChat();
        hideSettings();
    });
    if (handoffBackupBtn) handoffBackupBtn.addEventListener('click', async () => {
        const { generateBackupHandoff, downloadHandoff } = await Promise.resolve(/* import() */).then(__webpack_require__.bind(__webpack_require__, 164));
        const md = generateBackupHandoff();
        if (md) downloadHandoff(md);
    });

    // 敏感词列表渲染与事件
    const sensitiveList = modal.querySelector('#sensitive-word-list');
    const wordInput = modal.querySelector('#sensitive-word-input');
    const replacementInput = modal.querySelector('#sensitive-replacement-input');
    const addWordBtn = modal.querySelector('#add-sensitive-word-btn');

    /** 渲染敏感词列表 */
    function renderSensitiveList() {
        if (!sensitiveList) return;
        const entries = Object.entries(config/* CONFIG */.PI.sensitiveWords || {});
        if (entries.length === 0) {
            sensitiveList.innerHTML = '<div style="color:rgba(128,128,128,0.6);font-size:12px;padding:4px;">暂无敏感词</div>';
            return;
        }
        sensitiveList.innerHTML = entries.map(([word, replacement]) => `
            <div style="display:flex;align-items:center;justify-content:space-between;padding:4px 8px;margin:2px 0;border-radius:8px;background:rgba(128,128,128,0.1);font-size:13px;">
                <span><strong>${word}</strong> → ${replacement}</span>
                <button data-word="${word}" class="remove-sensitive-btn" style="background:rgba(239,68,68,0.2);border:none;border-radius:6px;padding:2px 8px;cursor:pointer;color:#ef4444;font-size:12px;">删除</button>
            </div>
        `).join('');
        sensitiveList.querySelectorAll('.remove-sensitive-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const w = btn.dataset.word;
                delete config/* CONFIG */.PI.sensitiveWords[w];
                (0,config/* saveConfig */.ql)(config/* CONFIG */.PI);
                clearPrivacyCache();
                renderSensitiveList();
            });
        });
    }

    if (addWordBtn) {
        addWordBtn.addEventListener('click', () => {
            const word = (wordInput?.value || '').trim();
            const replacement = (replacementInput?.value || '').trim();
            if (!word) { wordInput?.focus(); return; }
            if (!replacement) { replacementInput?.focus(); return; }
            if (!config/* CONFIG */.PI.sensitiveWords) config/* CONFIG */.PI.sensitiveWords = {};
            config/* CONFIG */.PI.sensitiveWords[word] = replacement;
            (0,config/* saveConfig */.ql)(config/* CONFIG */.PI);
            clearPrivacyCache();
            if (wordInput) wordInput.value = '';
            if (replacementInput) replacementInput.value = '';
            renderSensitiveList();
        });
    }
    renderSensitiveList();

    // 帮助弹出框（点击 ? 图标显示，点击其他地方关闭）
    modal.addEventListener('click', (e) => {
        const helpIcon = e.target.closest('.anime-help-icon');
        if (helpIcon) {
            e.stopPropagation();
            const text = helpIcon.dataset.help || '';
            if (text) showHelpPopup(text, helpIcon);
        } else {
            hideHelpPopup();
        }
    });

    // 点击 label 文字也能切换 toggle
    modal.querySelectorAll('[data-toggle]').forEach(label => {
        label.addEventListener('click', (e) => {
            const id = label.dataset.toggle;
            const checkbox = modal.querySelector('#chk-' + id);
            if (checkbox) {
                checkbox.checked = !checkbox.checked;
                e.stopPropagation();
            }
        });
    });

    // 主题选择器
    const themeSelector = modal.querySelector('#theme-selector');
    themeSelector.addEventListener('click', (e) => {
        const target = e.target.closest('[data-theme]');
        if (!target) return;
        themeSelector.querySelectorAll('[data-theme]').forEach(el => el.style.borderColor = 'transparent');
        target.style.borderColor = '#fff';
        themeSelector.dataset.selectedTheme = target.dataset.theme;
    });
    const currentTheme = config/* CONFIG */.PI.themeColor || 'pink';
    themeSelector.querySelectorAll('[data-theme]').forEach(el => {
        if (el.dataset.theme === currentTheme) el.style.borderColor = '#fff';
    });
    themeSelector.dataset.selectedTheme = currentTheme;

    // 预设添加
    const addBtn = modal.querySelector('#add-preset-btn');
    const nameInput = modal.querySelector('#preset-name');
    const promptInput = modal.querySelector('#preset-prompt');
    addBtn.addEventListener('click', () => {
        const name = nameInput.value.trim();
        const prompt = promptInput.value.trim();
        if (!name || !prompt) { alert('名称和提示词不能为空'); return; }
        const presets = config/* CONFIG */.PI.presets || [];
        if (presets.some(p => p.name === name)) { alert('同名预设已存在'); return; }
        presets.push({ name, prompt });
        config/* CONFIG */.PI.presets = presets;
        const container = modal.querySelector('#preset-list-container');
        container.innerHTML = buildPresetList();
        container.querySelectorAll('.delete-btn').forEach(btn => btn.addEventListener('click', deleteHandler));
        nameInput.value = '';
        promptInput.value = '';
    });

    // 预设删除
    modal.querySelectorAll('.delete-btn').forEach(btn => btn.addEventListener('click', deleteHandler));

    // 背景文件上传
    modal.querySelector('#bg-file-input').addEventListener('change', function(e) {
        const file = this.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => { modal.querySelector('#bg-image').value = ev.target.result; };
        reader.readAsDataURL(file);
        this.value = '';
    });

    // 透明度滑块
    const opacitySlider = modal.querySelector('#bg-opacity');
    const opacityLabel = modal.querySelector('#bg-opacity-label');
    opacitySlider.addEventListener('input', function() {
        opacityLabel.textContent = parseFloat(this.value).toFixed(2);
    });

    // 点击遮罩关闭
    modal.addEventListener('click', (e) => { if (e.target === modal) hideSettings(); });

    return modal;
}

// ============================================================
// 显示/隐藏
// ============================================================

function showSettings() {
    if (!settingsModal) settingsModal = createSettingsModal();
    settingsModal.style.display = 'flex';
    // 同步所有控件状态
    const ids = Object.keys(config/* OPTION_CONFIG_KEYS */.cD);
    ids.forEach(id => {
        const el = document.getElementById('chk-' + id);
        if (el) {
            const key = config/* OPTION_CONFIG_KEYS */.cD[id];
            el.checked = config/* CONFIG */.PI[key] !== undefined ? config/* CONFIG */.PI[key] : true;
        }
    });
    const txt = document.getElementById('title-list-text');
    if (txt) txt.value = (config/* CONFIG */.PI.titleList || config/* DEFAULTS */.zY.titleList).join('\n');
    const sel = document.getElementById('theme-selector');
    if (sel) {
        const theme = config/* CONFIG */.PI.themeColor || 'pink';
        sel.querySelectorAll('[data-theme]').forEach(el => el.style.borderColor = el.dataset.theme === theme ? '#fff' : 'transparent');
        sel.dataset.selectedTheme = theme;
    }
    const container = document.getElementById('preset-list-container');
    if (container) {
        container.innerHTML = buildPresetList();
        container.querySelectorAll('.delete-btn').forEach(btn => btn.addEventListener('click', deleteHandler));
    }
    const fontFamily = document.getElementById('font-family');
    if (fontFamily) fontFamily.value = config/* CONFIG */.PI.fontFamily || '';
    const fontUrl = document.getElementById('font-url');
    if (fontUrl) fontUrl.value = config/* CONFIG */.PI.fontUrl || '';
    const bgImage = document.getElementById('bg-image');
    if (bgImage) bgImage.value = config/* CONFIG */.PI.bgImage || '';
    const bgOpacity = document.getElementById('bg-opacity');
    if (bgOpacity) bgOpacity.value = config/* CONFIG */.PI.bgOpacity !== undefined ? config/* CONFIG */.PI.bgOpacity : 0.5;
    const bgOpacityLabel = document.getElementById('bg-opacity-label');
    if (bgOpacityLabel) bgOpacityLabel.textContent = (config/* CONFIG */.PI.bgOpacity !== undefined ? config/* CONFIG */.PI.bgOpacity : 0.5).toFixed(2);
    const placeholderText = document.getElementById('placeholder-text');
    if (placeholderText) placeholderText.value = config/* CONFIG */.PI.placeholderText || '';
    const defaultModeSelect = document.getElementById('default-mode-select');
    if (defaultModeSelect) defaultModeSelect.value = config/* CONFIG */.PI.defaultMode || 'default';
}

function hideSettings() {
    if (settingsModal) settingsModal.style.display = 'none';
    hideHelpPopup();
}

function getSettingsModal() { return settingsModal; }

function clearSettingsModal() {
    if (settingsModal) {
        settingsModal.remove();
        settingsModal = null;
    }
}

// ============================================================
// 保存/重置
// ============================================================

function saveSettings() {
    // 读取所有 checkbox
    Object.keys(config/* OPTION_CONFIG_KEYS */.cD).forEach(id => {
        const el = document.getElementById('chk-' + id);
        if (el) config/* CONFIG */.PI[config/* OPTION_CONFIG_KEYS */.cD[id]] = el.checked;
    });
    // 标题列表
    const titles = document.getElementById('title-list-text').value.split('\n').map(s => s.trim()).filter(Boolean);
    config/* CONFIG */.PI.titleList = titles.length ? titles : config/* DEFAULTS */.zY.titleList;
    // 主题
    const theme = document.getElementById('theme-selector').dataset.selectedTheme;
    if (theme) config/* CONFIG */.PI.themeColor = theme;
    // 字体
    config/* CONFIG */.PI.fontFamily = document.getElementById('font-family').value.trim();
    config/* CONFIG */.PI.fontUrl = document.getElementById('font-url').value.trim();
    // 背景
    config/* CONFIG */.PI.bgImage = document.getElementById('bg-image').value.trim();
    const bgOpacity = parseFloat(document.getElementById('bg-opacity').value);
    config/* CONFIG */.PI.bgOpacity = isNaN(bgOpacity) ? 0.5 : Math.min(1, Math.max(0, bgOpacity));
    // 占位符文字
    config/* CONFIG */.PI.placeholderText = document.getElementById('placeholder-text').value.trim() || '说点什么吧～';
    // 默认模式
    const modeSelect = document.getElementById('default-mode-select');
    if (modeSelect) config/* CONFIG */.PI.defaultMode = modeSelect.value;
    // 提示词注入文本
    const promptTextArea = document.getElementById('prompt-inject-text');
    if (promptTextArea) config/* CONFIG */.PI.promptText = promptTextArea.value.trim();
    // 清除隐私保护正则缓存（敏感词或大小写设置可能已变更）
    clearPrivacyCache();

    (0,config/* saveConfig */.ql)(config/* CONFIG */.PI);
    hideSettings();
    alert('✅ 设置已保存，正在刷新页面…');
    location.reload();
}

function resetSettings() {
    ;(0,config/* saveConfig */.ql)({ ...config/* DEFAULTS */.zY });
    hideSettings();
    alert('✅ 已恢复默认设置，正在刷新页面…');
    location.reload();
}

;// ./src/ui/menu-inject.js
/**
 * 菜单项注入模块
 *
 * 在 DeepSeek 侧边栏中查找菜单按钮，点击后向下拉菜单中注入"脚本设置"入口。
 * 同时支持手机端 ds-dropdown-menu 下拉菜单的注入。
 * 若找不到菜单按钮，则创建独立的悬浮设置按钮作为备用入口。
 */




let mobileObserver = null;
let menuBtnRetryTimer = null;

/**
 * 查找 DeepSeek 的菜单按钮（多种选择器兜底）
 * @returns {Element|null}
 */
function findMenuBtn() {
    return document.querySelector('._2afd28d[tabindex="0"]') ||
           document.querySelector('._9d8da05')?.closest('[class*="user"], div[role="button"]') ||
           document.querySelector('[aria-label*="用户"], [aria-label*="User"]') ||
           document.querySelector('svg[viewBox="0 0 16 16"] path[d*="M4.55146 8.00001"]')?.closest('[tabindex="0"], div[role="button"]');
}

/**
 * 先关闭 DeepSeek 下拉菜单，再显示设置面板
 *
 * 关键：关闭操作在 showSettings() 之前执行，
 * 此时设置面板尚未显示，click 事件不会影响它。
 */
function closeDropdownThenShowSettings() {
    // 关闭 DeepSeek 下拉菜单
    // 注意：不使用 btn.click()，因为它是 toggle（切换）行为——
    // 若点击菜单项时 DeepSeek 已自动关闭下拉菜单，btn.click() 会重新打开它，
    // 再被 body.click() 关闭，导致 DeepSeek 内部状态紊乱，
    // 第二次点击菜单按钮时将无法正常打开下拉菜单。
    // 改用 Esc 键 + mousedown/click 外部事件，这些操作只会关闭菜单，不会 toggle。

    // 方法1：派发 Esc 键关闭下拉菜单（dropdown 组件通常支持 Esc 关闭）
    try {
        document.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true
        }));
    } catch (e) {}

    // 方法2：派发 mousedown 到 body，触发 onClickOutside 检测（多数库监听 mousedown 而非 click）
    try {
        document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    } catch (e) {}

    // 方法3：派发 click 到 body 触发 DeepSeek 的外部点击检测（兜底）
    try { document.body.click(); } catch (e) {}

    // 方法4：隐藏手机端浮动菜单容器（兜底，使用 display:none 避免破坏 React DOM）
    document.querySelectorAll('.ds-floating-position-wrapper').forEach(w => {
        if (!w.closest('#ds-settings-modal')) w.style.display = 'none';
    });

    // 等待 DeepSeek 关闭下拉菜单后再显示设置
    setTimeout(() => {
        showSettings();
    }, 200);
}

/**
 * 向桌面端下拉菜单中添加"脚本设置"菜单项
 * @param {Element} menu - 下拉菜单容器
 */
function addMenuItemToMenu(menu) {
    if (!menu || menu.querySelector('#ds-settings-menu-item')) return;
    const isDark = utils.isDarkMode();
    const sep = document.createElement('div');
    sep.style.cssText = 'height:1px;background:#ddd;margin:4px 0;';
    menu.appendChild(sep);
    const item = document.createElement('div');
    item.id = 'ds-settings-menu-item';
    item.style.cssText = `padding:8px 16px;cursor:pointer;display:flex;align-items:center;gap:8px;color:${isDark?'#e8d5dd':'#4a3040'};font-size:14px;border-radius:4px;`;
    item.innerHTML = '⚙️ 脚本设置';
    item.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        // 先关闭下拉菜单，再显示设置
        closeDropdownThenShowSettings();
    });
    menu.appendChild(item);
}

/**
 * 向手机端 ds-dropdown-menu 中添加"脚本设置"菜单项
 * 同时移除"下载手机应用"选项（如果启用）
 * @param {Element} menu - ds-dropdown-menu 容器
 */
function addMobileMenuItem(menu) {
    if (!menu || menu.querySelector('#ds-settings-mobile-item')) return;

    // 移除"下载手机应用"选项（由 removeDownloadAppEnabled 控制）
    if (typeof config/* CONFIG */.PI !== 'undefined' && config/* CONFIG */.PI.removeDownloadAppEnabled) {
        const options = menu.querySelectorAll('.ds-dropdown-menu-option');
        options.forEach(opt => {
            const label = opt.querySelector('.ds-dropdown-menu-option__label');
            if (label && /下载.*应用|下载.*App/i.test(label.textContent || '')) {
                opt.style.display = 'none';
            }
        });
    }

    const item = document.createElement('div');
    item.id = 'ds-settings-mobile-item';
    item.className = 'ds-dropdown-menu-option ds-dropdown-menu-option--none';
    item.setAttribute('role', 'menuitem');
    item.style.cssText = 'cursor:pointer;';

    // 图标容器
    const iconWrap = document.createElement('div');
    iconWrap.className = 'ds-dropdown-menu-option__icon';
    iconWrap.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zm0 2a4.5 4.5 0 0 1 4.472 4H10.5a2.5 2.5 0 0 0-4.9-.5L4.2 5.6A4.48 4.48 0 0 1 8 3.5zm-4.472 4.5a4.5 4.5 0 0 0 7.272 3.4l-1.6-1.6A2.5 2.5 0 0 1 5.5 8H3.528z" fill="currentColor"></path></svg>`;

    // 标签
    const label = document.createElement('div');
    label.className = 'ds-dropdown-menu-option__label';
    label.textContent = '脚本设置';

    item.appendChild(iconWrap);
    item.appendChild(label);

    item.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        // 先关闭下拉菜单，再显示设置
        closeDropdownThenShowSettings();
    });

    menu.appendChild(item);
}

/**
 * 移除独立悬浮设置按钮（当菜单按钮找到后）
 */
function removeStandaloneButton() {
    const btn = document.getElementById('ds-standalone-settings');
    if (btn) btn.remove();
}

/**
 * 注入菜单项：监听菜单按钮点击，在下拉菜单出现后注入设置入口
 * 同时监听手机端 ds-dropdown-menu 的出现
 * 使用重试机制确保晚出现的菜单按钮也能被绑定
 */
function injectMenuItem() {
    let btn = findMenuBtn();

    if (btn) {
        attachMenuListener(btn);
        removeStandaloneButton();
    } else {
        // 菜单按钮可能尚未加载，创建悬浮按钮并重试查找
        createStandaloneSettingsButton();

        // 定期重试查找菜单按钮（最多 15 秒）
        let retries = 0;
        menuBtnRetryTimer = setInterval(() => {
            btn = findMenuBtn();
            if (btn) {
                clearInterval(menuBtnRetryTimer);
                menuBtnRetryTimer = null;
                attachMenuListener(btn);
                removeStandaloneButton();
            } else if (++retries > 30) {
                clearInterval(menuBtnRetryTimer);
                menuBtnRetryTimer = null;
            }
        }, 500);
    }

    // 手机端：监听 ds-dropdown-menu 的出现
    if (mobileObserver) mobileObserver.disconnect();
    mobileObserver = new MutationObserver(() => {
        const mobileMenu = document.querySelector('.ds-dropdown-menu');
        if (mobileMenu && mobileMenu.querySelector('.ds-dropdown-menu-option')) {
            // 确保不是我们自己的设置面板
            if (!mobileMenu.closest('#ds-settings-modal')) {
                addMobileMenuItem(mobileMenu);
            }
        }
    });
    mobileObserver.observe(document.body, { childList: true, subtree: true });
}

/**
 * 给菜单按钮绑定点击监听，等待下拉菜单出现后注入
 * @param {Element} btn
 */
function attachMenuListener(btn) {
    btn.addEventListener('click', () => {
        let attempts = 0;
        const tryAdd = () => {
            const menu = document.querySelector('[role="menu"]') ||
                        document.querySelector('.ds-dropdown-menu') ||
                        document.querySelector('[class*="dropdown"]');
            if (menu) {
                if (menu.classList.contains('ds-dropdown-menu') &&
                    menu.querySelector('.ds-dropdown-menu-option')) {
                    addMobileMenuItem(menu);
                } else {
                    addMenuItemToMenu(menu);
                }
                return;
            }
            if (++attempts < 20) requestAnimationFrame(tryAdd);
        };
        requestAnimationFrame(tryAdd);
    });
}

/**
 * 创建独立悬浮设置按钮（备用入口）
 */
function createStandaloneSettingsButton() {
    if (document.getElementById('ds-standalone-settings')) return;
    const btn = document.createElement('div');
    btn.id = 'ds-standalone-settings';
    btn.innerHTML = '⚙️';
    btn.style.cssText = `position:fixed;bottom:20px;right:20px;width:44px;height:44px;border-radius:50%;background:${utils.isDarkMode()?'#e895a8':'#f08ca8'};color:#fff;font-size:22px;display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 4px 12px rgba(0,0,0,0.3);z-index:99999;transition:transform 0.2s;`;
    btn.addEventListener('mouseenter', () => btn.style.transform = 'scale(1.1)');
    btn.addEventListener('mouseleave', () => btn.style.transform = 'scale(1)');
    btn.addEventListener('click', showSettings);
    document.body.appendChild(btn);
}

;// ./src/ui/preset-menu.js
/**
 * 消息预设菜单 + 消息历史记录模块
 *
 * 功能：
 *   1. 在输入框中输入 '/' 时触发预设菜单，支持上下键切换、Enter 确认、Esc 关闭
 *   2. 上下键切换历史消息（仅 TEXTAREA），Enter 发送时记录历史
 *
 * 与原始脚本一致：使用 document 级委托事件监听，剪贴板方式插入预设。
 */


// ============================================================
// 模块级状态
// ============================================================
let presetMenuElement = null;
let presetMenuVisible = false;
let presetSelectedIndex = -1;

// 消息历史状态
let messageHistory = config/* CONFIG */.PI.messageHistory || [];
let historyIndex = -1;
let currentInputValue = '';

// ============================================================
// 输入框查找
// ============================================================

/**
 * 查找 DeepSeek 的消息输入框
 * @returns {HTMLTextAreaElement|null}
 */
function getMessageInput() {
    return document.querySelector('textarea._27c9245');
}

// ============================================================
// 预设菜单 DOM
// ============================================================

/**
 * 创建预设菜单元素（单例）
 * @returns {HTMLDivElement}
 */
function createPresetMenu() {
    if (presetMenuElement) return presetMenuElement;
    const menu = document.createElement('div');
    menu.id = 'anime-preset-menu';
    menu.style.cssText = `
        position: absolute;
        bottom: 100%;
        left: 0;
        background: var(--anime-card-bg, #fff);
        border: 1px solid var(--anime-msg-bubble-border, #ddd);
        border-radius: 12px;
        box-shadow: 0 8px 24px rgba(0,0,0,0.15);
        min-width: 180px;
        max-height: 200px;
        overflow-y: auto;
        z-index: 99999;
        display: none;
        padding: 6px 0;
        font-size: 14px;
        backdrop-filter: blur(4px);
    `;
    document.body.appendChild(menu);
    presetMenuElement = menu;
    return menu;
}

/**
 * 清除菜单中所有项的高亮
 * @param {HTMLElement} menu
 */
function clearMenuHighlight(menu) {
    if (!menu) return;
    const items = menu.querySelectorAll('div');
    items.forEach(el => el.style.background = 'transparent');
}

// ============================================================
// 核心插入函数：剪贴板 + 粘贴（多级降级）
// ============================================================

/**
 * 将预设文本插入到输入框中
 * 策略：剪贴板写入 → execCommand paste → ClipboardEvent → 直接修改 value
 * @param {HTMLTextAreaElement} inputEl - 输入框元素
 * @param {string} prompt - 待插入的预设文本
 */
async function insertPresetIntoInput(inputEl, prompt) {
    if (!inputEl) return;
    // 确保输入框获得焦点
    inputEl.focus();

    // 1. 保存当前剪贴板内容（仅文本）
    let previousClipboard = '';
    try {
        previousClipboard = await navigator.clipboard.readText().catch(() => '');
    } catch (e) {
        // 可能权限问题，忽略
    }

    // 2. 写入预设内容到剪贴板
    try {
        await navigator.clipboard.writeText(prompt);
    } catch (e) {
        // 如果剪贴板写入失败，降级使用 execCommand('insertText')
        try {
            if (document.execCommand('insertText', false, prompt)) {
                inputEl.dispatchEvent(new Event('input', { bubbles: true }));
                return;
            }
        } catch (err) {}
        // 最后降级：直接修改 value + 触发事件
        const val = inputEl.value;
        const start = inputEl.selectionStart;
        const end = inputEl.selectionEnd;
        const before = val.substring(0, start);
        const after = val.substring(end);
        inputEl.value = before + prompt + after;
        const newPos = start + prompt.length;
        inputEl.selectionStart = inputEl.selectionEnd = newPos;
        inputEl.dispatchEvent(new Event('input', { bubbles: true }));
        inputEl.dispatchEvent(new Event('change', { bubbles: true }));
        return;
    }

    // 3. 执行粘贴操作
    try {
        // 方法A：使用 execCommand('paste')，需要用户手势，但点击事件已触发
        if (document.execCommand('paste')) {
            await new Promise(r => requestAnimationFrame(r));
            if (previousClipboard) {
                navigator.clipboard.writeText(previousClipboard).catch(() => {});
            }
            return;
        }
    } catch (e) {
        // execCommand 可能不支持或被拒绝
    }

    // 方法B：手动触发 paste 事件
    try {
        const dt = new DataTransfer();
        dt.setData('text/plain', prompt);
        const pasteEvent = new ClipboardEvent('paste', {
            clipboardData: dt,
            bubbles: true,
            cancelable: true
        });
        inputEl.dispatchEvent(pasteEvent);
        await new Promise(r => setTimeout(r, 50));
        if (inputEl.value.includes(prompt)) {
            if (previousClipboard) {
                navigator.clipboard.writeText(previousClipboard).catch(() => {});
            }
            return;
        }
    } catch (e) {}

    // 方法C：直接修改 value 作为最后手段
    const val = inputEl.value;
    const start = inputEl.selectionStart;
    const end = inputEl.selectionEnd;
    const before = val.substring(0, start);
    const after = val.substring(end);
    inputEl.value = before + prompt + after;
    const newPos = start + prompt.length;
    inputEl.selectionStart = inputEl.selectionEnd = newPos;
    inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    inputEl.dispatchEvent(new Event('change', { bubbles: true }));

    // 恢复剪贴板
    if (previousClipboard) {
        navigator.clipboard.writeText(previousClipboard).catch(() => {});
    }
}

// ============================================================
// 菜单显示/隐藏
// ============================================================

/**
 * 显示预设菜单（定位在输入框上方）
 * @param {HTMLTextAreaElement} inputEl
 */
function showPresetMenu(inputEl) {
    const menu = createPresetMenu();
    const presets = config/* CONFIG */.PI.presets || [];
    if (presets.length === 0) {
        menu.style.display = 'none';
        presetMenuVisible = false;
        presetSelectedIndex = -1;
        return;
    }

    menu.innerHTML = '';
    presets.forEach((p, idx) => {
        const item = document.createElement('div');
        item.textContent = p.name || '未命名';
        item.dataset.index = idx;
        item.style.cssText = `
            padding: 6px 16px;
            cursor: pointer;
            transition: background 0.15s;
            color: var(--anime-text-primary, #333);
        `;
        item.addEventListener('mouseenter', () => {
            clearMenuHighlight(menu);
            item.style.background = 'var(--anime-msg-bubble-bg, #f0f0f0)';
            presetSelectedIndex = idx;
        });
        item.addEventListener('mouseleave', () => {
            if (presetSelectedIndex !== idx) {
                item.style.background = 'transparent';
            }
        });
        // 点击菜单项：调用异步插入函数
        item.addEventListener('click', async (e) => {
            e.stopPropagation();
            const currentInput = getMessageInput();
            if (currentInput) {
                await insertPresetIntoInput(currentInput, p.prompt);
            }
            hidePresetMenu();
        });
        menu.appendChild(item);
    });

    const rect = inputEl.getBoundingClientRect();
    menu.style.left = rect.left + 'px';
    menu.style.bottom = (window.innerHeight - rect.top + 6) + 'px';
    menu.style.display = 'block';
    presetMenuVisible = true;
    presetSelectedIndex = -1;
}

/**
 * 隐藏预设菜单
 */
function hidePresetMenu() {
    if (presetMenuElement) {
        presetMenuElement.style.display = 'none';
        clearMenuHighlight(presetMenuElement);
    }
    presetMenuVisible = false;
    presetSelectedIndex = -1;
}

// ============================================================
// 事件处理（document 级委托）
// ============================================================

/**
 * input 事件：检测 '/' 触发菜单
 * @param {InputEvent} e
 */
function handleInput(e) {
    const input = e.target;
    if (!input || input.tagName !== 'TEXTAREA' || !input.classList.contains('_27c9245')) {
        return;
    }
    const val = input.value;
    const start = input.selectionStart;
    if (start > 0 && val[start - 1] === '/') {
        showPresetMenu(input);
    } else {
        hidePresetMenu();
    }
}

/**
 * keydown 事件：菜单导航 + 历史切换 + 发送记录
 * @param {KeyboardEvent} e
 */
function handleKeydown(e) {
    const input = e.target;
    if (!input || input.tagName !== 'TEXTAREA' || !input.classList.contains('_27c9245')) {
        return;
    }
    const key = e.key;

    // 发送消息时记录历史
    if (key === 'Enter' && !e.shiftKey) {
        const val = input.value.trim();
        if (val) {
            messageHistory.push(val);
            if (messageHistory.length > 100) messageHistory.shift();
            config/* CONFIG */.PI.messageHistory = messageHistory;
            (0,config/* saveConfig */.ql)(config/* CONFIG */.PI);
            historyIndex = -1;
            currentInputValue = '';
        }
        return;
    }

    // 预设菜单键盘控制
    if (presetMenuVisible && presetMenuElement) {
        const items = presetMenuElement.querySelectorAll('div');
        const total = items.length;
        if (total === 0) return;

        if (key === 'ArrowUp' || key === 'ArrowDown') {
            e.preventDefault();
            clearMenuHighlight(presetMenuElement);
            if (key === 'ArrowUp') {
                presetSelectedIndex = (presetSelectedIndex - 1 + total) % total;
            } else {
                presetSelectedIndex = (presetSelectedIndex + 1) % total;
            }
            const target = items[presetSelectedIndex];
            if (target) {
                target.style.background = 'var(--anime-msg-bubble-bg, #f0f0f0)';
                target.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            }
            return;
        }

        if (key === 'Enter') {
            e.preventDefault();
            if (presetSelectedIndex >= 0 && presetSelectedIndex < total) {
                const prompt = config/* CONFIG */.PI.presets[presetSelectedIndex].prompt;
                insertPresetIntoInput(input, prompt);
                hidePresetMenu();
            }
            return;
        }

        if (key === 'Escape') {
            e.preventDefault();
            hidePresetMenu();
            return;
        }
        return;
    }

    // 历史切换（菜单未显示时）
    if (key === 'ArrowUp' || key === 'ArrowDown') {
        e.preventDefault();
        if (messageHistory.length === 0) return;

        if (key === 'ArrowUp') {
            if (historyIndex === -1) {
                currentInputValue = input.value;
                historyIndex = messageHistory.length - 1;
            } else if (historyIndex > 0) {
                historyIndex--;
            } else {
                return;
            }
            input.value = messageHistory[historyIndex];
        } else if (key === 'ArrowDown') {
            if (historyIndex === -1) {
                return;
            } else if (historyIndex < messageHistory.length - 1) {
                historyIndex++;
                input.value = messageHistory[historyIndex];
            } else {
                historyIndex = -1;
                input.value = currentInputValue;
                currentInputValue = '';
            }
        }
        input.selectionStart = input.selectionEnd = input.value.length;
        input.dispatchEvent(new Event('input', { bubbles: true }));
    }
}

/**
 * document click 事件：点击菜单外部时关闭菜单
 * @param {MouseEvent} e
 */
function handleDocumentClick(e) {
    if (presetMenuElement && presetMenuVisible) {
        const input = getMessageInput();
        if (input && (input.contains(e.target) || presetMenuElement.contains(e.target))) {
            return;
        }
        hidePresetMenu();
    }
}

// ============================================================
// 对外接口
// ============================================================

/**
 * 初始化预设菜单 + 消息历史：注册 document 级委托事件监听
 * 使用委托方式，无需等待输入框出现即可生效。
 */
function initPresetMenu() {
    document.addEventListener('input', handleInput);
    document.addEventListener('keydown', handleKeydown);
    document.addEventListener('click', handleDocumentClick);
    window.addEventListener('scroll', () => {
        if (presetMenuVisible) hidePresetMenu();
    }, true);
}

/**
 * 初始化消息历史记录（兼容旧接口，实际逻辑已在 initPresetMenu 中完成）
 */
function initMessageHistory() {
    // 消息历史的键盘处理已集成在 handleKeydown 中
    // 此函数保留为空以兼容 index.js 的调用
}

/**
 * 导出 hidePresetMenu 供 beforeunload 调用
 */


;// ./src/features/copy-code.js
/**
 * 行内代码点击复制模块
 *
 * 点击 Markdown 中的行内代码（<code> 不在 <pre> 或 .md-code-block 内）时，
 * 自动复制内容到剪贴板，并显示 Toast 提示。
 * 支持深色/浅色模式自适应。
 */



let installed = false;

/**
 * 显示 Toast 提示
 * @param {string} message - 提示消息
 */
function showToast(message) {
    const existing = document.querySelector('.ds-copy-toast');
    if (existing) existing.remove();

    const isDark = utils.isDarkMode();
    const toast = document.createElement('div');
    toast.className = 'ds-copy-toast';
    toast.innerHTML = `
        <div class="ds-copy-toast-icon">
            <svg viewBox="0 0 24 24">
                <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
        </div>
        <span>${message}</span>
    `;
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('show'));
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 2000);
}

/**
 * 判断元素是否为行内代码（不在 pre 或代码块中）
 * @param {Element} el
 * @returns {boolean}
 */
function isInlineCode(el) {
    if (el.tagName !== 'CODE') return false;
    if (el.closest('pre')) return false;
    if (el.closest('.md-code-block')) return false;
    if (el.closest('.md-code-block-banner-wrap')) return false;
    return true;
}

/**
 * 注入 Toast 样式（仅一次）
 */
function injectToastStyle() {
    if (document.getElementById('ds-copy-toast-style')) return;
    const style = document.createElement('style');
    style.id = 'ds-copy-toast-style';
    style.textContent = `
        .ds-markdown code:not(pre code):not(.md-code-block code) { cursor: pointer; }
        .ds-copy-toast {
            position: fixed; top: 16px; left: 50%;
            transform: translateX(-50%) translateY(-20px);
            background: #fff; border-radius: 8px; padding: 12px 20px;
            box-shadow: 0 4px 16px rgba(0,0,0,0.12);
            display: flex; align-items: center; gap: 8px;
            z-index: 99999; opacity: 0; transition: all 0.3s ease;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            font-size: 14px; color: #333;
        }
        .ds-copy-toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }
        .ds-copy-toast-icon {
            width: 20px; height: 20px; background: #52c41a; border-radius: 50%;
            display: flex; align-items: center; justify-content: center; flex-shrink: 0;
        }
        .ds-copy-toast-icon svg {
            width: 12px; height: 12px; fill: none; stroke: #fff;
            stroke-width: 2.5; stroke-linecap: round; stroke-linejoin: round;
        }
        body[data-ds-dark-theme] .ds-copy-toast {
            background: #2d2e34; color: #e0e0e0; box-shadow: 0 4px 16px rgba(0,0,0,0.4);
        }
    `;
    document.head.appendChild(style);
}

/**
 * 点击事件处理器
 * @param {Event} e
 */
function handleClick(e) {
    if (!config/* CONFIG */.PI.copyCodeEnabled) return;
    const code = e.target.closest('code');
    if (code && isInlineCode(code)) {
        e.preventDefault();
        e.stopPropagation();
        navigator.clipboard.writeText(code.textContent).then(() => {
            showToast('成功复制到剪贴板！');
        }).catch(() => {
            const textArea = document.createElement('textarea');
            textArea.value = code.textContent;
            document.body.appendChild(textArea);
            textArea.select();
            document.execCommand('copy');
            textArea.remove();
            showToast('成功复制到剪贴板！');
        });
    }
}

/**
 * 安装行内代码点击复制功能
 * 使用事件捕获模式，确保在 DeepSeek 的事件处理之前执行
 */
function initCopyCode() {
    if (installed) return;
    installed = true;
    injectToastStyle();
    document.addEventListener('click', handleClick, true);
}

;// ./src/features/folder-store.js
/**
 * 文件夹管理数据存储与服务层
 *
 * 从 DeepSeek-Enhancer 项目移植，适配油猴脚本环境：
 *   - chrome.storage.local → localStorage
 *   - TypeScript → 纯 JavaScript
 *   - 异步队列 → 同步操作（localStorage 本身同步）
 *
 * 数据模型：
 *   Folder:     { id, name, parentId, order, pinned, createdAt, updatedAt }
 *   FolderItem: { id, folderId, conversationId, title, url, addedAt, order }
 *   FolderData: { folders: Folder[], items: FolderItem[], updatedAt }
 *
 * 层级限制：最多两层（文件夹 > 子文件夹 > 会话）
 *
 * 存储 key：dspro.folders.v1
 */

const STORAGE_KEY = 'dspro.folders.v1';
const MAX_DEPTH = 2; // 最多两层

/**
 * 读取文件夹数据
 * @returns {FolderData}
 */
function readData() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return { folders: [], items: [], updatedAt: 0 };
        const data = JSON.parse(raw);
        if (!data || !Array.isArray(data.folders) || !Array.isArray(data.items)) {
            return { folders: [], items: [], updatedAt: 0 };
        }
        return data;
    } catch {
        return { folders: [], items: [], updatedAt: 0 };
    }
}

/**
 * 写入文件夹数据
 * @param {FolderData} data
 */
function writeData(data) {
    data.updatedAt = Date.now();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

/**
 * 生成唯一 ID
 * @param {string} prefix
 * @param {Set<string>} used
 * @returns {string}
 */
function createUniqueId(prefix, used) {
    let id;
    do {
        const random = (globalThis.crypto?.randomUUID?.() ?? '').slice(0, 8)
                     || Math.random().toString(36).slice(2, 10);
        id = `${prefix}_${random}`;
    } while (used.has(id));
    used.add(id);
    return id;
}

/**
 * 规范化名称（去除首尾空格，非空校验）
 * @param {string} name
 * @returns {string}
 */
function requireName(name) {
    const normalized = (name || '').trim();
    if (!normalized) throw new Error('文件夹名称不能为空');
    return normalized;
}

/**
 * 查找文件夹（不存在则抛错）
 * @param {FolderData} data
 * @param {string} folderId
 * @returns {Folder}
 */
function requireFolder(data, folderId) {
    const folder = data.folders.find(f => f.id === folderId);
    if (!folder) throw new Error(`文件夹不存在: ${folderId}`);
    return folder;
}

/** 文件夹服务对象 */
const FolderStore = {
    /**
     * 获取全部文件夹数据
     * @returns {FolderData}
     */
    getData() {
        return readData();
    },

    /**
     * 创建文件夹
     * @param {string} name - 文件夹名称
     * @param {string|null} parentId - 父文件夹 ID（null 表示顶层）
     * @returns {FolderData}
     */
    createFolder(name, parentId = null) {
        const data = readData();
        const normalizedName = requireName(name);
        if (parentId) {
            const parent = requireFolder(data, parentId);
            if (parent.parentId) throw new Error('最多支持两层文件夹');
        }
        const now = Date.now();
        data.folders.push({
            id: createUniqueId('folder', new Set(data.folders.map(f => f.id))),
            name: normalizedName,
            parentId,
            order: data.folders.filter(f => f.parentId === parentId).length,
            pinned: false,
            createdAt: now,
            updatedAt: now,
        });
        writeData(data);
        return data;
    },

    /**
     * 重命名文件夹
     * @param {string} folderId
     * @param {string} name
     * @returns {FolderData}
     */
    renameFolder(folderId, name) {
        const data = readData();
        const folder = requireFolder(data, folderId);
        const normalizedName = requireName(name);
        if (folder.name === normalizedName) return data;
        folder.name = normalizedName;
        folder.updatedAt = Date.now();
        writeData(data);
        return data;
    },

    /**
     * 删除文件夹（级联删除子文件夹和关联会话项）
     * @param {string} folderId
     * @returns {FolderData}
     */
    deleteFolder(folderId) {
        const data = readData();
        requireFolder(data, folderId);
        const deleted = new Set([folderId]);
        for (const folder of data.folders) {
            if (folder.parentId === folderId) deleted.add(folder.id);
        }
        data.folders = data.folders.filter(f => !deleted.has(f.id));
        data.items = data.items.filter(item => !deleted.has(item.folderId));
        writeData(data);
        return data;
    },

    /**
     * 添加会话到文件夹
     * @param {string} folderId
     * @param {{id:string, title:string, url:string}} conversation
     * @returns {FolderData}
     */
    addConversation(folderId, conversation) {
        const data = readData();
        requireFolder(data, folderId);
        const existing = new Set(
            data.items.filter(i => i.folderId === folderId).map(i => i.conversationId)
        );
        if (existing.has(conversation.id)) return data;
        data.items.push({
            id: createUniqueId('item', new Set(data.items.map(i => i.id))),
            folderId,
            conversationId: conversation.id,
            title: (conversation.title || '').trim() || '未命名对话',
            url: conversation.url,
            addedAt: Date.now(),
            order: data.items.filter(i => i.folderId === folderId).length,
        });
        writeData(data);
        return data;
    },

    /**
     * 从文件夹中移除会话
     * @param {string} itemId
     * @returns {FolderData}
     */
    removeConversation(itemId) {
        const data = readData();
        data.items = data.items.filter(i => i.id !== itemId);
        writeData(data);
        return data;
    },

    /**
     * 移动/复制会话到另一个文件夹
     * @param {string} itemId
     * @param {string} targetFolderId
     * @param {'move'|'copy'} action
     * @returns {FolderData}
     */
    transferConversation(itemId, targetFolderId, action) {
        const data = readData();
        requireFolder(data, targetFolderId);
        const source = data.items.find(i => i.id === itemId);
        if (!source) throw new Error(`会话项不存在: ${itemId}`);
        if (source.folderId === targetFolderId) return data;
        const existsInTarget = data.items.some(
            i => i.folderId === targetFolderId && i.conversationId === source.conversationId
        );
        if (!existsInTarget) {
            data.items.push({
                ...source,
                id: createUniqueId('item', new Set(data.items.map(i => i.id))),
                folderId: targetFolderId,
                addedAt: Date.now(),
                order: data.items.filter(i => i.folderId === targetFolderId).length,
            });
        }
        if (action === 'move') {
            data.items = data.items.filter(i => i.id !== itemId);
        }
        writeData(data);
        return data;
    },

    /**
     * 切换文件夹置顶状态
     * @param {string} folderId
     * @returns {FolderData}
     */
    togglePin(folderId) {
        const data = readData();
        const folder = requireFolder(data, folderId);
        folder.pinned = !folder.pinned;
        folder.updatedAt = Date.now();
        writeData(data);
        return data;
    },

    /**
     * 导出文件夹数据
     * @returns {object}
     */
    exportData() {
        return {
            format: 'dspro.folders.v1',
            version: '1.0',
            exportedAt: new Date().toISOString(),
            data: readData(),
        };
    },

    /**
     * 导入文件夹数据
     * @param {object} payload
     * @param {'merge'|'overwrite'} strategy
     * @returns {FolderData}
     */
    importData(payload, strategy) {
        if (!payload?.data?.folders || !payload?.data?.items) {
            throw new Error('无效的导入数据格式');
        }
        if (strategy === 'overwrite') {
            writeData(JSON.parse(JSON.stringify(payload.data)));
            return payload.data;
        }
        // merge 策略
        const current = readData();
        const imported = payload.data;
        const foldersById = new Map(current.folders.map(f => [f.id, f]));
        const usedFolderIds = new Set(foldersById.keys());
        for (const folder of imported.folders) {
            if (!foldersById.has(folder.id)) {
                const id = createUniqueId('folder', usedFolderIds);
                usedFolderIds.add(id);
                current.folders.push({ ...folder, id });
            }
        }
        const itemKeys = new Set(current.items.map(i => `${i.folderId}:${i.conversationId}`));
        const itemIds = new Set(current.items.map(i => i.id));
        for (const item of imported.items) {
            const key = `${item.folderId}:${item.conversationId}`;
            if (!itemKeys.has(key)) {
                const id = createUniqueId('item', itemIds);
                itemIds.add(id);
                current.items.push({ ...item, id });
            }
        }
        writeData(current);
        return current;
    },

    /**
     * 清空所有文件夹数据
     * @returns {FolderData}
     */
    clearAll() {
        const empty = { folders: [], items: [], updatedAt: Date.now() };
        writeData(empty);
        return empty;
    },
};

;// ./src/features/conversation-detector.js
/**
 * 会话检测与缓存模块
 *
 * 从 DeepSeek-Enhancer 项目移植，适配油猴脚本环境。
 *
 * 功能：
 *   1. 从 URL 路径检测当前会话 ID
 *   2. 获取当前会话标题（从 document.title 或侧边栏链接）
 *   3. 缓存最近会话（最多 120 条，去重）
 *   4. 从侧边栏链接中提取会话列表
 *
 * 会话 URL 格式：https://chat.deepseek.com/a/chat/s/{conversationId}
 *
 * 存储 key：dspro.recentConversations.v1
 */

const RECENT_KEY = 'dspro.recentConversations.v1';
const MAX_RECENT = 120;
const CONVERSATION_PATH_RE = /^\/a\/chat\/s\/([a-f0-9-]{20,})/i;

/** 会话链接选择器 */
const CONVERSATION_LINK_SELECTORS = [
    'a[href*="/a/chat/s/"]',
    'a[href*="/chat/s/"]',
];

/** 侧边栏容器选择器 */
const SIDEBAR_SELECTORS = [
    '.ds-scroll-area',
    '[class*="ds-scroll"]',
    'aside',
    'nav',
    '[class*="sidebar" i]',
    '[class*="sider" i]',
];

/**
 * 从路径中提取会话 ID
 * @param {string} [pathname] - 路径，默认当前页面路径
 * @returns {string|null}
 */
function getConversationIdFromPath(pathname = location.pathname) {
    const match = CONVERSATION_PATH_RE.exec(pathname);
    return match ? match[1] : null;
}

/**
 * 构建会话 URL
 * @param {string} conversationId
 * @returns {string}
 */
function buildConversationUrl(conversationId) {
    return `https://chat.deepseek.com/a/chat/s/${conversationId}`;
}

/**
 * 检测当前活跃会话
 * @returns {{id:string, title:string, url:string}|null}
 */
function getActiveConversation() {
    const id = getConversationIdFromPath();
    if (!id) return null;
    const title = (document.title || '').replace(/\s*-\s*DeepSeek\s*$/i, '').trim() || '未命名对话';
    return { id, title, url: buildConversationUrl(id) };
}

/**
 * 查找 DeepSeek 侧边栏容器
 * @returns {HTMLElement|null}
 */
function findSidebar() {
    for (const selector of CONVERSATION_LINK_SELECTORS) {
        const link = document.querySelector(selector);
        if (!link) continue;
        const container = link.closest('.ds-scroll-area, [class*="ds-scroll"], aside, nav');
        if (container) return container;
    }
    for (const selector of SIDEBAR_SELECTORS) {
        const el = document.querySelector(selector);
        if (el) return el;
    }
    return null;
}

/**
 * 从侧边栏链接中提取会话列表
 * @returns {Array<{id:string, title:string, url:string}>}
 */
function getSidebarConversations() {
    const results = [];
    const seen = new Set();
    for (const selector of CONVERSATION_LINK_SELECTORS) {
        document.querySelectorAll(selector).forEach(link => {
            const href = link.getAttribute('href');
            if (!href) return;
            let url;
            try { url = new URL(href, location.origin); } catch { return; }
            const id = getConversationIdFromPath(url.pathname);
            if (!id || seen.has(id)) return;
            seen.add(id);
            const title = (link.textContent || '').trim() || '未命名对话';
            results.push({ id, title, url: buildConversationUrl(id) });
        });
    }
    return results;
}

/**
 * 读取最近会话缓存
 * @returns {Array<{id:string, title:string, url:string}>}
 */
function readRecentConversations() {
    try {
        const raw = localStorage.getItem(RECENT_KEY);
        if (!raw) return [];
        const data = JSON.parse(raw);
        if (!Array.isArray(data)) return [];
        return data.filter(item =>
            item && typeof item.id === 'string'
                 && typeof item.title === 'string'
                 && typeof item.url === 'string'
        );
    } catch {
        return [];
    }
}

/**
 * 缓存最近会话（去重，最多 120 条）
 * @param {Array<{id:string, title:string, url:string}>} conversations
 */
function cacheRecentConversations(conversations) {
    if (!conversations || conversations.length === 0) return;
    const current = readRecentConversations();
    const byId = new Map();
    for (const conv of [...current, ...conversations]) {
        if (conv.id && conv.url) byId.set(conv.id, conv);
    }
    const orderedIds = new Set();
    for (const conv of [...conversations, ...current]) {
        if (byId.has(conv.id)) orderedIds.add(conv.id);
    }
    const next = Array.from(orderedIds, id => byId.get(id)).slice(0, MAX_RECENT);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
}

/**
 * 自动缓存当前会话（如果有）
 * 在 URL 变化时调用
 */
function autoCacheCurrentConversation() {
    const conv = getActiveConversation();
    if (conv) cacheRecentConversations([conv]);
    return conv;
}

;// ./src/ui/folder-panel.js
/**
 * 文件夹管理 - 侧边栏嵌入面板
 *
 * 在 DeepSeek 侧边栏顶部嵌入文件夹管理面板，支持：
 *   - 两层文件夹层级结构（文件夹 > 子文件夹 > 会话）
 *   - 创建/重命名/删除文件夹
 *   - 添加当前会话到文件夹
 *   - 点击会话跳转
 *   - 折叠/展开文件夹
 *   - 置顶文件夹
 *   - 导入/导出
 *
 * 挂载策略：通过查找 a[href*="/chat/s/"] 定位侧边栏容器，在其顶部插入面板。
 * 如果找不到侧边栏，降级为不显示（不影响其他功能）。
 *
 * 从 DeepSeek-Enhancer 项目移植，React 组件改为纯 DOM 操作。
 */





const PANEL_ID = 'dspro-folder-panel';
const STYLE_ID = 'dspro-folder-panel-style';
let mounted = false;
let lastUrl = '';

/** 注入面板样式（仅一次） */
function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
        #${PANEL_ID} {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            font-size: 13px;
            padding: 8px;
            margin-bottom: 4px;
            border-bottom: 1px solid rgba(128,128,128,0.15);
            max-height: 280px;
            overflow-y: auto;
            flex-shrink: 0;
        }
        #${PANEL_ID}::-webkit-scrollbar { width: 4px; }
        #${PANEL_ID}::-webkit-scrollbar-thumb { background: rgba(128,128,128,0.3); border-radius: 2px; }
        .fp-header {
            display: flex; align-items: center; justify-content: space-between;
            margin-bottom: 6px; padding: 0 2px;
        }
        .fp-title { font-weight: 600; font-size: 13px; display: flex; align-items: center; gap: 4px; }
        .fp-actions { display: flex; gap: 4px; }
        .fp-btn {
            border: none; border-radius: 4px; padding: 2px 6px; cursor: pointer;
            font-size: 12px; line-height: 1.4; background: transparent; color: inherit;
        }
        .fp-btn:hover { background: rgba(128,128,128,0.15); }
        .fp-folder-row {
            display: flex; align-items: center; gap: 2px; padding: 3px 4px;
            border-radius: 4px; cursor: pointer; user-select: none;
        }
        .fp-folder-row:hover { background: rgba(128,128,128,0.1); }
        .fp-folder-row.active { background: rgba(128,128,128,0.15); }
        .fp-toggle { width: 14px; text-align: center; font-size: 10px; flex-shrink: 0; transition: transform 0.15s; }
        .fp-toggle.collapsed { transform: rotate(-90deg); }
        .fp-folder-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .fp-folder-ops { display: none; gap: 1px; flex-shrink: 0; }
        .fp-folder-row:hover .fp-folder-ops { display: flex; }
        .fp-folder-ops button {
            border: none; background: transparent; cursor: pointer; padding: 1px 3px;
            font-size: 11px; border-radius: 3px; color: inherit; opacity: 0.7;
        }
        .fp-folder-ops button:hover { background: rgba(128,128,128,0.2); opacity: 1; }
        .fp-children { margin-left: 16px; display: block; }
        .fp-children.hidden { display: none; }
        .fp-item-row {
            display: flex; align-items: center; gap: 4px; padding: 3px 4px 3px 20px;
            border-radius: 4px; cursor: pointer; user-select: none;
        }
        .fp-item-row:hover { background: rgba(128,128,128,0.1); }
        .fp-item-title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
        .fp-item-del { display: none; border: none; background: transparent; cursor: pointer; padding: 1px 3px; font-size: 11px; opacity: 0.7; color: inherit; }
        .fp-item-row:hover .fp-item-del { display: block; }
        .fp-item-del:hover { color: #ef4444; opacity: 1; }
        .fp-empty { color: rgba(128,128,128,0.5); font-size: 12px; padding: 8px 4px; text-align: center; }
        .fp-add-current {
            display: flex; align-items: center; justify-content: center; gap: 4px;
            margin-top: 6px; padding: 4px 8px; border-radius: 4px; cursor: pointer;
            font-size: 12px; border: 1px dashed rgba(128,128,128,0.3); background: transparent; color: inherit;
        }
        .fp-add-current:hover { background: rgba(128,128,128,0.1); border-color: rgba(128,128,128,0.5); }
        .fp-select-overlay {
            position: fixed; top: 0; left: 0; right: 0; bottom: 0; z-index: 99998;
            background: transparent; display: flex; align-items: center; justify-content: center;
        }
        .fp-select-dialog {
            background: var(--dsw-alias-bg-layer-2, #fff); color: var(--dsw-alias-label-primary, #333);
            border-radius: 12px; padding: 16px; min-width: 280px; max-width: 360px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.2); z-index: 99999;
        }
        .fp-select-dialog h3 { margin: 0 0 12px; font-size: 15px; font-weight: 600; }
        .fp-select-list { max-height: 240px; overflow-y: auto; margin-bottom: 12px; }
        .fp-select-item {
            display: flex; align-items: center; gap: 8px; padding: 8px 12px;
            border-radius: 6px; cursor: pointer; font-size: 13px;
        }
        .fp-select-item:hover { background: rgba(128,128,128,0.12); }
        .fp-select-cancel { width: 100%; padding: 6px; border: none; border-radius: 6px; cursor: pointer; background: rgba(128,128,128,0.15); color: inherit; font-size: 13px; }
        .fp-input-dialog {
            background: var(--dsw-alias-bg-layer-2, #fff); color: var(--dsw-alias-label-primary, #333);
            border-radius: 12px; padding: 20px; min-width: 300px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.2); z-index: 99999;
        }
        .fp-input-dialog h3 { margin: 0 0 12px; font-size: 15px; font-weight: 600; }
        .fp-input-dialog input {
            width: 100%; padding: 8px 12px; border: 1px solid rgba(128,128,128,0.3);
            border-radius: 6px; font-size: 14px; background: transparent; color: inherit; box-sizing: border-box;
        }
        .fp-input-dialog input:focus { outline: none; border-color: var(--dsw-alias-brand-primary, #007bff); }
        .fp-input-actions { display: flex; gap: 8px; margin-top: 12px; }
        .fp-input-actions button {
            flex: 1; padding: 6px 12px; border: none; border-radius: 6px; cursor: pointer; font-size: 13px;
        }
        .fp-input-actions .fp-confirm { background: var(--dsw-alias-brand-primary, #007bff); color: #fff; }
        .fp-input-actions .fp-cancel { background: rgba(128,128,128,0.15); color: inherit; }
    `;
    document.head.appendChild(style);
}

/** HTML 转义 */
function esc(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
}

/**
 * 渲染文件夹面板内容
 * @param {HTMLElement} container
 */
function renderPanel(container) {
    const data = FolderStore.getData();
    const rootFolders = data.folders
        .filter(f => !f.parentId)
        .sort((a, b) => (b.pinned - a.pinned) || (a.order - b.order));

    let html = `
        <div class="fp-header">
            <span class="fp-title">📁 文件夹</span>
            <div class="fp-actions">
                <button class="fp-btn" data-action="new-root" title="新建文件夹">＋</button>
                <button class="fp-btn" data-action="export" title="导出">⬇</button>
                <button class="fp-btn" data-action="import" title="导入">⬆</button>
            </div>
        </div>
    `;

    if (rootFolders.length === 0 && data.items.length === 0) {
        html += `<div class="fp-empty">暂无文件夹，点击 + 创建</div>`;
    } else {
        html += '<div class="fp-tree">';
        for (const folder of rootFolders) {
            html += renderFolderV2(folder, data);
        }
        html += '</div>';
    }

    const active = getActiveConversation();
    if (active) {
        html += `<button class="fp-add-current" data-action="add-current">📌 收藏当前会话到文件夹</button>`;
    }

    container.innerHTML = html;
}

/** 折叠状态缓存（内存中，刷新后重置） */
const _collapsedSet = new Set();

/**
 * 判断文件夹是否折叠
 * @param {string} folderId
 * @returns {boolean}
 */
function isFolderCollapsed(folderId) {
    return _collapsedSet.has(folderId);
}

/**
 * 渲染单个文件夹（使用 _collapsedSet 管理折叠状态）
 * @param {object} folder
 * @param {object} data
 * @param {number} [depth=0]
 * @returns {string}
 */
function renderFolderV2(folder, data, depth = 0) {
    const subFolders = data.folders
        .filter(f => f.parentId === folder.id)
        .sort((a, b) => a.order - b.order);
    const items = data.items
        .filter(i => i.folderId === folder.id)
        .sort((a, b) => a.order - b.order);
    const hasChildren = subFolders.length > 0 || items.length > 0;
    const isExpanded = !isFolderCollapsed(folder.id);

    let html = `
        <div class="fp-folder-row" data-folder-id="${esc(folder.id)}">
            <span class="fp-toggle ${isExpanded ? '' : 'collapsed'}" data-action="toggle" data-folder-id="${esc(folder.id)}">${hasChildren ? '▼' : '·'}</span>
            <span class="fp-folder-name" data-action="toggle" data-folder-id="${esc(folder.id)}">${folder.pinned ? '📌 ' : '📁 '}${esc(folder.name)}</span>
            <span class="fp-folder-ops">
                ${depth === 0 ? `<button data-action="add-sub" data-folder-id="${esc(folder.id)}" title="新建子文件夹">＋</button>` : ''}
                <button data-action="rename" data-folder-id="${esc(folder.id)}" title="重命名">✏</button>
                <button data-action="pin" data-folder-id="${esc(folder.id)}" title="置顶">${folder.pinned ? '📍' : '📌'}</button>
                <button data-action="delete" data-folder-id="${esc(folder.id)}" title="删除">🗑</button>
            </span>
        </div>
    `;

    if (hasChildren) {
        html += `<div class="fp-children ${isExpanded ? '' : 'hidden'}" data-children-of="${esc(folder.id)}">`;
        for (const sub of subFolders) {
            html += renderFolderV2(sub, data, depth + 1);
        }
        for (const item of items) {
            html += `
                <div class="fp-item-row" data-item-id="${esc(item.id)}" data-url="${esc(item.url)}" title="${esc(item.title)}">
                    <span class="fp-item-title" data-action="open-item" data-url="${esc(item.url)}">💬 ${esc(item.title)}</span>
                    <button class="fp-item-del" data-action="del-item" data-item-id="${esc(item.id)}" title="移除">✕</button>
                </div>
            `;
        }
        html += `</div>`;
    }

    return html;
}

/**
 * 显示输入对话框
 * @param {string} title
 * @param {string} [defaultValue]
 * @param {string} [placeholder]
 * @returns {Promise<string|null>}
 */
function showInputDialog(title, defaultValue = '', placeholder = '') {
    return new Promise(resolve => {
        const overlay = document.createElement('div');
        overlay.className = 'fp-select-overlay';
        overlay.innerHTML = `
            <div class="fp-input-dialog">
                <h3>${esc(title)}</h3>
                <input type="text" value="${esc(defaultValue)}" placeholder="${esc(placeholder)}" />
                <div class="fp-input-actions">
                    <button class="fp-cancel">取消</button>
                    <button class="fp-confirm">确定</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        const input = overlay.querySelector('input');
        input.focus();
        input.select();
        const close = (value) => { overlay.remove(); resolve(value); };
        overlay.querySelector('.fp-cancel').addEventListener('click', () => close(null));
        overlay.querySelector('.fp-confirm').addEventListener('click', () => close(input.value.trim()));
        input.addEventListener('keydown', e => {
            if (e.key === 'Enter') close(input.value.trim());
            if (e.key === 'Escape') close(null);
        });
        overlay.addEventListener('click', e => { if (e.target === overlay) close(null); });
    });
}

/**
 * 显示文件夹选择对话框（用于收藏当前会话）
 * @returns {Promise<string|null>} folderId
 */
function showFolderSelectDialog() {
    return new Promise(resolve => {
        const data = FolderStore.getData();
        const folders = data.folders.sort((a, b) => (b.pinned - a.pinned) || (a.order - b.order));
        const overlay = document.createElement('div');
        overlay.className = 'fp-select-overlay';
        let listHtml = '';
        if (folders.length === 0) {
            listHtml = '<div style="text-align:center;padding:16px;color:rgba(128,128,128,0.6);">请先创建文件夹</div>';
        } else {
            for (const f of folders) {
                const indent = f.parentId ? '　' : '';
                listHtml += `<div class="fp-select-item" data-folder-id="${esc(f.id)}">${indent}${f.pinned ? '📌' : '📁'} ${esc(f.name)}</div>`;
            }
        }
        overlay.innerHTML = `
            <div class="fp-select-dialog">
                <h3>选择目标文件夹</h3>
                <div class="fp-select-list">${listHtml}</div>
                <button class="fp-select-cancel">取消</button>
            </div>
        `;
        document.body.appendChild(overlay);
        const close = (value) => { overlay.remove(); resolve(value); };
        overlay.querySelector('.fp-select-cancel').addEventListener('click', () => close(null));
        overlay.querySelectorAll('.fp-select-item').forEach(item => {
            item.addEventListener('click', () => close(item.dataset.folderId));
        });
        overlay.addEventListener('click', e => { if (e.target === overlay) close(null); });
    });
}

/**
 * 处理面板内点击事件（事件委托）
 * @param {Event} e
 */
function handlePanelClick(e) {
    const target = e.target.closest('[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    const folderId = target.dataset.folderId;
    const itemId = target.dataset.itemId;
    const url = target.dataset.url;
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;

    switch (action) {
        case 'toggle': {
            if (folderId) {
                if (_collapsedSet.has(folderId)) _collapsedSet.delete(folderId);
                else _collapsedSet.add(folderId);
                renderPanel(panel);
            }
            break;
        }
        case 'new-root': {
            showInputDialog('新建文件夹', '', '请输入文件夹名称').then(name => {
                if (name) { FolderStore.createFolder(name); renderPanel(panel); }
            });
            break;
        }
        case 'add-sub': {
            showInputDialog('新建子文件夹', '', '请输入子文件夹名称').then(name => {
                if (name) { FolderStore.createFolder(name, folderId); renderPanel(panel); }
            });
            break;
        }
        case 'rename': {
            const folder = FolderStore.getData().folders.find(f => f.id === folderId);
            showInputDialog('重命名文件夹', folder?.name || '', '请输入新名称').then(name => {
                if (name) { FolderStore.renameFolder(folderId, name); renderPanel(panel); }
            });
            break;
        }
        case 'pin': {
            FolderStore.togglePin(folderId);
            renderPanel(panel);
            break;
        }
        case 'delete': {
            if (confirm('确定删除此文件夹及其所有内容？')) {
                FolderStore.deleteFolder(folderId);
                renderPanel(panel);
            }
            break;
        }
        case 'open-item': {
            if (url) {
                e.preventDefault();
                e.stopPropagation();
                window.location.assign(url);
            }
            break;
        }
        case 'del-item': {
            e.preventDefault();
            e.stopPropagation();
            FolderStore.removeConversation(itemId);
            renderPanel(panel);
            break;
        }
        case 'add-current': {
            const active = getActiveConversation();
            if (active) {
                showFolderSelectDialog().then(fid => {
                    if (fid) {
                        FolderStore.addConversation(fid, active);
                        renderPanel(panel);
                    }
                });
            }
            break;
        }
        case 'export': {
            const payload = FolderStore.exportData();
            const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `dspro-folders-${Date.now()}.json`;
            a.click();
            URL.revokeObjectURL(a.href);
            break;
        }
        case 'import': {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.json';
            input.addEventListener('change', () => {
                const file = input.files[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = () => {
                    try {
                        const payload = JSON.parse(reader.result);
                        const strategy = confirm('点击"确定"合并到现有数据，点击"取消"覆盖现有数据') ? 'merge' : 'overwrite';
                        FolderStore.importData(payload, strategy);
                        renderPanel(panel);
                    } catch (err) {
                        alert('导入失败: ' + err.message);
                    }
                };
                reader.readAsText(file);
            });
            input.click();
            break;
        }
    }
}

/**
 * 挂载文件夹面板到侧边栏
 * @returns {boolean} 是否成功挂载
 */
function mountPanel() {
    const sidebar = findSidebar();
    if (!sidebar) return false;
    let panel = document.getElementById(PANEL_ID);
    if (!panel) {
        panel = document.createElement('div');
        panel.id = PANEL_ID;
        panel.addEventListener('click', handlePanelClick);
        sidebar.prepend(panel);
    }
    // 检查面板是否仍在 DOM 中（DeepSeek 可能重新渲染侧边栏）
    if (!document.contains(panel)) {
        panel = document.createElement('div');
        panel.id = PANEL_ID;
        panel.addEventListener('click', handlePanelClick);
        sidebar.prepend(panel);
    }
    renderPanel(panel);
    return true;
}

/**
 * 初始化文件夹面板
 * 使用 MutationObserver 监听侧边栏变化，自动挂载/重新挂载
 */
function initFolderPanel() {
    if (mounted) return;
    mounted = true;
    injectStyle();

    // 自动缓存当前会话
    autoCacheCurrentConversation();

    // 尝试挂载
    if (!mountPanel()) {
        // 侧边栏可能尚未加载，使用 observer 等待
        const bodyObserver = new MutationObserver(() => {
            if (mountPanel()) {
                // 挂载成功后切换为轻量 observer，只监听侧边栏变化
                bodyObserver.disconnect();
                observeSidebarChanges();
            }
        });
        bodyObserver.observe(document.body, { childList: true, subtree: true });

        // 10 秒后停止重试
        setTimeout(() => bodyObserver.disconnect(), 10000);
        return;
    }

    observeSidebarChanges();
}

/**
 * 监听侧边栏变化和 URL 变化
 */
function observeSidebarChanges() {
    // URL 变化时自动缓存当前会话并刷新面板
    const checkUrlChange = () => {
        if (location.href !== lastUrl) {
            lastUrl = location.href;
            autoCacheCurrentConversation();
            const panel = document.getElementById(PANEL_ID);
            if (panel) renderPanel(panel);
        }
    };

    // 监听 popstate
    window.addEventListener('popstate', checkUrlChange);

    // 监听 pushState/replaceState
    const origPush = history.pushState;
    const origReplace = history.replaceState;
    history.pushState = function(...args) {
        origPush.apply(this, args);
        setTimeout(checkUrlChange, 100);
    };
    history.replaceState = function(...args) {
        origReplace.apply(this, args);
        setTimeout(checkUrlChange, 100);
    };

    // 定期检查面板是否仍在 DOM 中（DeepSeek 可能重新渲染侧边栏）
    setInterval(() => {
        const panel = document.getElementById(PANEL_ID);
        if (!panel || !panel.isConnected) {
            mountPanel();
        }
        checkUrlChange();
    }, 3000);
}

// EXTERNAL MODULE: ./src/features/loop-engine.js
var loop_engine = __webpack_require__(433);
// EXTERNAL MODULE: ./src/features/roadmap.js
var roadmap = __webpack_require__(350);
// EXTERNAL MODULE: ./src/features/handoff.js
var handoff = __webpack_require__(164);
;// ./src/index.js
/**
 * 入口文件 - DeepSeek Promax 油猴脚本
 *
 * 负责编排所有模块的初始化顺序：
 *   1. 自动跳转检查（document-start 阶段）
 *   2. 等待 DOM 就绪
 *   3. 注入样式、启动樱花动画、标题伪装
 *   4. 设置 MutationObserver、XHR 钩子、输入监听
 *   5. 应用自定义字体/背景
 *   6. 注入菜单项
 *   7. 延迟全量扫描 + 重试按钮扫描
 *   8. 监听暗色模式切换
 *
 * 暴露 window.DSEnhance 供外部调用。
 */

// ============================================================
// 模块导入
// ============================================================























// ============================================================
// 核心：应用所有功能（用于 reload）
// ============================================================

/**
 * 应用所有功能：样式注入、樱花动画、标题伪装、Observer、XHR 钩子、自定义项、全量扫描
 * 在 window.DSEnhance.reload() 中调用
 */
function applyAllFeatures() {
    injectStyles();
    initSakura();
    stopTitleFaker();
    if (config/* CONFIG */.PI.titleFakerEnabled) initTitleFaker();
    setupObserver();
    installXhrHook();
    resetRetryAttempts();
    applyCustomizations();
    initDefaultMode();
    if (document.body) {
        fullScan(document.body);
        initRemoveComponents();
    }
}

// ============================================================
// DOM 就绪工具
// ============================================================

/**
 * 等待 DOM 就绪（document-start 时 document.body 可能不存在）
 * @returns {Promise<void>}
 */
function domReady() {
    return new Promise((resolve) => {
        if (document.body && document.head) {
            resolve();
        } else {
            const observer = new MutationObserver(() => {
                if (document.body && document.head) {
                    observer.disconnect();
                    resolve();
                }
            });
            observer.observe(document.documentElement, { childList: true, subtree: true });
        }
    });
}

// ============================================================
// 初始化
// ============================================================

/**
 * 主初始化函数
 * 分批启动：关键功能优先，非关键功能延迟到空闲时
 */
async function init() {
    // 1. 自动跳转（document-start 阶段立即执行）
    initRedirect();

    // 2. 等待 DOM 就绪
    await domReady();

    // 3. 第一批：关键功能（样式 + Observer + XHR 钩子，必须尽早生效）
    injectStyles();
    setupObserver();
    installXhrHook();

    // 4. 第二批：UI 增强（下一帧执行，不阻塞首屏）
    requestAnimationFrame(() => {
        initSakura();
        if (config/* CONFIG */.PI.titleFakerEnabled) initTitleFaker();
        applyCustomizations();
        initPresetMenu();
        injectMenuItem();
        initDefaultMode();
        initCopyCode();
        if (config/* CONFIG */.PI.loopEngineEnabled || config/* CONFIG */.PI.loopCrashRecoveryEnabled) {
            try { (0,loop_engine/* initLoopEngine */.tF)(); } catch (e) {}
        }
        if (config/* CONFIG */.PI.loopEngineEnabled) {
            try { (0,roadmap/* initRoadmap */.dw)(); } catch (e) {}
            try { ;(0,handoff/* initHandoff */.$W)(); } catch (e) {}
        }
    });

    // 5. 第三批：全量扫描 + 组件移除 + 文件夹面板（延迟到空闲时，避免阻塞首屏交互）
    const runHeavyTasks = () => {
        try { fullScan(document.body); } catch (e) {}
        try { initRemoveComponents(); } catch (e) {}
        if (config/* CONFIG */.PI.folderPanelEnabled) {
            try { initFolderPanel(); } catch (e) {}
        }
        if (config/* CONFIG */.PI.autoRetryEnabled) {
            try { scanRetryButton(); } catch (e) {}
        }
    };
    if ('requestIdleCallback' in window) {
        requestIdleCallback(runHeavyTasks, { timeout: 2000 });
    } else {
        setTimeout(runHeavyTasks, 800);
    }

    // 6. 对话切换检测：重置 Store 并尝试从 IndexedDB 恢复数据
    const SID_RE = /\/chat\/s\/([0-9a-f-]{36})/i;
    let lastSid = (location.href.match(SID_RE) || [])[1] || '';
    const checkRoute = () => {
        const sid = (location.href.match(SID_RE) || [])[1] || '';
        if (sid !== lastSid) {
            lastSid = sid;
            Store.clear();
            setTimeout(() => tryReadIDB(sid), 1000);
        }
    };
    window.addEventListener('popstate', checkRoute);
    const _ps = history.pushState;
    history.pushState = function() { const r = _ps.apply(this, arguments); checkRoute(); return r; };
    setTimeout(() => tryReadIDB(), 2500);

    // 7. 监听暗色模式切换
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', utils.debounce(() => {
        resetStyleCache();
        injectStyles();
        clearSettingsModal();
        const standalone = document.getElementById('ds-standalone-settings');
        if (standalone) standalone.style.background = utils.isDarkMode() ? '#e895a8' : '#f08ca8';
        applyCustomizations();
    }, 300));

    // 8. 页面卸载前清理 + 保存消息历史
    window.addEventListener('beforeunload', () => {
        stopTitleFaker();
        disconnectObserver();
        destroySakura();
        hidePresetMenu();
        try {
            if (config/* CONFIG */.PI.messageHistory) {
                (0,config/* saveConfig */.ql)(config/* CONFIG */.PI);
            }
        } catch (e) {}
    });

    console.log('🌸 DeepSeek Promax 已激活 v3.8.0');
}

// ============================================================
// 暴露外部接口
// ============================================================

window.DSEnhance = {
    /** 重新加载配置并应用所有功能 */
    reload() {
        ;(0,config/* reloadConfig */.Wf)();
        applyAllFeatures();
    },
    /** 显示设置面板 */
    showSettings: showSettings,
    /** 获取当前配置 */
    getConfig() { return config/* CONFIG */.PI; },
    /** 重置为默认配置 */
    resetConfig() {
        (0,config/* saveConfig */.ql)({ ...config/* DEFAULTS */.zY });
        location.reload();
    }
};

// ============================================================
// 启动
// ============================================================

init();

/******/ })()
;