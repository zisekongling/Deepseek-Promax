/**
 * Token 速度指示器模块
 *
 * 通过统一的 fetch-hub 拦截 /api/v0/chat/completion 系列 SSE 流，
 * 实时统计输出 token 数与速度，并在每条助手消息的操作栏旁注入一个 badge 显示
 * 形如 "1,234 tok · 56.7 tok/s"。
 * 使用统一的 observer-hub 监听新消息出现；流式结束空闲后自动降低透明度。
 *
 * 性能优化：
 *   - 不再独立安装 fetch hook，改由 fetch-hub 统一分发，避免多次 response.clone()
 *   - 不再独立创建 MutationObserver，改由 registerDomHandler 注册到统一调度
 *   - 流式 chunk 直接使用 fetch-hub 已算好的增量 tokens，避免每次全量重新估算
 *
 * 改进点（参考 deepseek-pp/stream-metrics.ts）：
 *   - TPS 从首 chunk 到达开始计算，排除 prefill 延迟（fetch-hub 已处理）
 *   - 区分 tokenSource / speedSource 双源：'server' 优先于 'estimated'
 *   - 路由感知：切换会话或路由变化时重置流式状态
 *   - 显示服务端累计 token 数（若可用）
 */
import { formatTokenSpeed, formatTokens } from '../utils/token-estimator.js';
import { registerCompletionHandler, unregisterCompletionHandler } from '../utils/fetch-hub.js';
import { registerDomHandler, unregisterDomHandler } from '../utils/observer-hub.js';
import { recordUsageTurn } from './usage/index.js';

const IDLE_DELAY = 2000; // 流结束后多少毫秒进入空闲（降低透明度）

// ============================================================
// Badge 持久化存储
// 解决：发新消息时 DeepSeek 重渲染消息列表、或刷新页面后，badge DOM 丢失。
// 方案：流结束后读取目标消息文本计算指纹，存入 localStorage；
//       DOM 扫描时按指纹匹配恢复 badge 数据。
// ============================================================
const BADGE_STORAGE_KEY = 'ds_token_badges';
const BADGE_MAX_ENTRIES = 500;
const BADGE_WRITE_DEBOUNCE_MS = 300;
const BADGE_TEXT_DELAY_MS = 600; // 流结束后延迟读取文本，等待 React 完成渲染

let _badgeCache = null;
let _badgeWriteTimer = null;

/**
 * 读取 badge 存储缓存（Map: 指纹 -> { tokens, tps, speedSource, ts }）
 * @returns {Map}
 */
function readBadgeStore() {
    if (_badgeCache) return _badgeCache;
    try {
        const raw = localStorage.getItem(BADGE_STORAGE_KEY);
        _badgeCache = raw ? new Map(JSON.parse(raw)) : new Map();
    } catch (e) {
        _badgeCache = new Map();
    }
    return _badgeCache;
}

/**
 * 防抖异步写入 localStorage
 */
function scheduleBadgeWrite() {
    if (_badgeWriteTimer) return;
    _badgeWriteTimer = setTimeout(() => {
        _badgeWriteTimer = null;
        try {
            const store = readBadgeStore();
            const entries = Array.from(store.entries());
            if (entries.length > BADGE_MAX_ENTRIES) {
                entries.splice(0, entries.length - BADGE_MAX_ENTRIES);
            }
            localStorage.setItem(BADGE_STORAGE_KEY, JSON.stringify(entries));
        } catch (e) {}
    }, BADGE_WRITE_DEBOUNCE_MS);
}

/**
 * 根据消息文本计算指纹（长度 + 首尾片段，平衡唯一性与性能）
 * @param {string} text
 * @returns {string}
 */
function makeFingerprint(text) {
    if (!text) return '';
    const trimmed = text.trim();
    if (!trimmed) return '';
    const prefix = trimmed.slice(0, 80);
    const suffix = trimmed.length > 120 ? trimmed.slice(-40) : '';
    return `${trimmed.length}|${prefix}|${suffix}`;
}

/**
 * 保存一条消息的 badge 数据
 * @param {string} text - 消息文本
 * @param {{tokens:number, tps:number, speedSource:string}} data
 */
function saveBadge(text, data) {
    const fp = makeFingerprint(text);
    if (!fp) return;
    const store = readBadgeStore();
    store.set(fp, { ...data, ts: Date.now() });
    scheduleBadgeWrite();
}

/**
 * 根据消息文本查找已保存的 badge 数据
 * @param {string} text
 * @returns {{tokens:number, tps:number, speedSource:string}|null}
 */
function getBadge(text) {
    const fp = makeFingerprint(text);
    if (!fp) return null;
    const store = readBadgeStore();
    return store.get(fp) || null;
}

let installed = false;
let handlerId = 0;
let domHandlerId = 0;

// 当前流式状态：贯穿一次 completion 请求的整个生命周期
let streamState = {
    active: false,
    startTime: 0,
    firstTokenMs: 0,
    route: null,
    chatSessionId: null,
    targetMessage: null,
    badge: null,
    previousLastMessage: null  // 流开始时已有的最后一个助手消息，作为定位新消息的基准
};

/**
 * 注入 badge 所需的 CSS 样式（仅一次）
 * 增加服务端源标识（绿色圆点）与估算源标识（灰色圆点）
 */
function injectBadgeStyle() {
    if (document.getElementById('ds-token-badge-style')) return;
    const style = document.createElement('style');
    style.id = 'ds-token-badge-style';
    style.textContent = `
        .ds-token-badge {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            padding: 2px 8px;
            border-radius: 8px;
            font-size: 11px;
            background: rgba(0,0,0,0.05);
            color: #666;
            transition: opacity 0.3s;
            font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
            user-select: none;
            white-space: nowrap;
        }
        .ds-token-badge.idle { opacity: 0.5; }
        .ds-token-badge .ds-token-src {
            display: inline-block;
            width: 6px;
            height: 6px;
            border-radius: 50%;
            background: #9ca3af;
        }
        .ds-token-badge.src-server .ds-token-src { background: #22c55e; }
        body[data-ds-dark-theme] .ds-token-badge {
            background: rgba(255,255,255,0.08);
            color: #aaa;
        }
        body[data-ds-dark-theme] .ds-token-badge .ds-token-src { background: #6b7280; }
        body[data-ds-dark-theme] .ds-token-badge.src-server .ds-token-src { background: #4ade80; }
    `;
    document.head.appendChild(style);
}

/**
 * 在助手消息容器中查找操作按钮栏元素
 * 依次尝试多种候选选择器，找不到则回退到首个按钮的父容器
 * @param {Element} messageEl - .ds-message 元素
 * @returns {Element|null} 操作栏元素，找不到返回 null
 */
function findActionBar(messageEl) {
    if (!messageEl) return null;
    const candidates = [
        '.ds-message-footer',
        '.ds-message-actions',
        '[class*="message-footer"]',
        '[class*="action-bar"]',
        '[class*="operate"]'
    ];
    for (const sel of candidates) {
        const el = messageEl.querySelector(sel);
        if (el) return el;
    }
    // 回退：包含 ds-button / button 的容器视为操作栏
    const btn = messageEl.querySelector('.ds-button, button');
    return btn ? btn.parentElement : null;
}

/**
 * 判断消息是否为助手消息
 * 关键：DeepSeek 的用户消息 .ds-message 总是包含 d29f3d7d 类，助手消息不含此类
 * 这使得即使新助手消息内容尚未渲染（空容器），也能正确识别为助手消息
 * 不能依赖 .ds-markdown 或 .ds-button 判断：新消息内容渲染前这些元素不存在
 * @param {Element} messageEl - .ds-message 元素
 * @returns {boolean}
 */
function isAssistantMessage(messageEl) {
    if (!messageEl) return false;
    // 用户消息的 .ds-message 总是包含 d29f3d7d 类
    if (messageEl.classList.contains('d29f3d7d')) return false;
    // 助手消息的父容器是 _4f9bf79（用户消息父容器是 _9663006）
    const parent = messageEl.parentElement;
    if (parent && parent.classList.contains('_4f9bf79')) return true;
    // 回退：检查助手特征元素（思考面板、markdown 回答内容等）
    return !!(
        messageEl.querySelector('.ds-markdown') ||
        messageEl.querySelector('._74c0879') ||
        messageEl.querySelector('.ds-assistant-message-main-content') ||
        messageEl.querySelector('[class*="answer"]')
    );
}

/**
 * 从助手消息元素提取可读文本（用于持久化指纹匹配）
 * 优先读取 .ds-markdown 的 textContent
 * @param {Element} messageEl
 * @returns {string}
 */
function extractMessageText(messageEl) {
    if (!messageEl) return '';
    const md = messageEl.querySelector('.ds-markdown');
    return md ? (md.textContent || '') : (messageEl.textContent || '');
}

/**
 * 直接用 tps 设置 badge 显示文本（用于恢复持久化数据，无需反算 elapsedMs）
 * @param {Element} badge - badge 元素
 * @param {number} tokens - token 数
 * @param {number} tps - 每秒 token 数
 * @param {string} speedSource - 速度源：'server' | 'estimated'
 */
function setBadgeDisplay(badge, tokens, tps, speedSource) {
    if (!badge) return;
    const tokenStr = formatTokens(tokens);
    const speedStr = `${Number(tps || 0).toFixed(1)} tok/s`;
    const textEl = badge.querySelector('.ds-token-text');
    if (textEl) textEl.textContent = `${tokenStr} tok · ${speedStr}`;
    badge.classList.toggle('src-server', speedSource === 'server');
}

/**
 * 为指定消息创建或获取 badge
 * @param {Element} messageEl - 助手消息元素
 * @returns {Element|null} badge 元素
 */
function getOrCreateBadge(messageEl) {
    if (!messageEl) return null;
    const existing = messageEl.querySelector('.ds-token-badge');
    if (existing) return existing;
    const actionBar = findActionBar(messageEl);
    const badge = document.createElement('div');
    badge.className = 'ds-token-badge idle';
    badge.innerHTML = '<span class="ds-token-src"></span><span class="ds-token-text">0 tok · 0.0 tok/s</span>';
    if (actionBar) {
        actionBar.insertAdjacentElement('afterend', badge);
    } else {
        messageEl.appendChild(badge);
    }
    return badge;
}

/**
 * 查找当前正在流式输出的助手消息（最新的助手 .ds-message）
 * @returns {Element|null}
 */
function findLatestAssistantMessage() {
    const messages = document.querySelectorAll('.ds-message');
    for (let i = messages.length - 1; i >= 0; i--) {
        if (isAssistantMessage(messages[i])) return messages[i];
    }
    return null;
}

/**
 * 查找基准消息之后新增的助手消息
 * 用于流式期间定位真正的新消息：第一个 chunk 到达时新消息 DOM 可能尚未创建，
 * 需要在基准（流开始时已有的最后一个助手消息）之后查找新增的助手消息
 * @param {Element|null} previousLast - 基准消息（流开始时的最后一个助手消息）
 * @returns {Element|null} 新增的助手消息，找不到返回 null（等待下次 chunk 重试）
 */
function findNewAssistantMessage(previousLast) {
    const messages = document.querySelectorAll('.ds-message');
    if (messages.length === 0) return null;
    // 无基准：取最后一个助手消息（首次对话场景）
    if (!previousLast || !document.contains(previousLast)) {
        // 基准不在 DOM 中（被 React 重渲染替换）：取最后一个助手消息
        // 此时旧消息已被替换，最后一个是新消息
        for (let i = messages.length - 1; i >= 0; i--) {
            if (isAssistantMessage(messages[i])) return messages[i];
        }
        return null;
    }
    // 在 DOM 顺序中找到基准之后第一个新增的助手消息
    let foundPrevious = false;
    for (let i = 0; i < messages.length; i++) {
        if (messages[i] === previousLast) {
            foundPrevious = true;
            continue;
        }
        if (foundPrevious && isAssistantMessage(messages[i])) {
            return messages[i];
        }
    }
    // 基准之后尚未出现新助手消息（新消息 DOM 还未创建）：返回 null 等待下次 chunk 重试
    // 不回退到最后一个助手消息，因为那是上一条旧消息，已有自己的 badge
    return null;
}

/**
 * 更新 badge 显示文本与源标记
 * @param {Element} badge - badge 元素
 * @param {number} tokens - token 数
 * @param {number} elapsedMs - 已耗时（毫秒）
 * @param {string} [speedSource='estimated'] - 速度源：'server' | 'estimated'
 */
function updateBadgeText(badge, tokens, elapsedMs, speedSource = 'estimated') {
    if (!badge) return;
    const tokenStr = formatTokens(tokens);
    const speedStr = formatTokenSpeed(tokens, elapsedMs);
    const textEl = badge.querySelector('.ds-token-text');
    if (textEl) textEl.textContent = `${tokenStr} tok · ${speedStr}`;
    badge.classList.toggle('src-server', speedSource === 'server');
}

/**
 * 将 badge 标记为空闲（降低透明度）
 * @param {Element} badge
 */
function markBadgeIdle(badge) {
    if (!badge) return;
    badge.classList.add('idle');
}

/**
 * 重置流式状态（保留 badge 自身的空闲定时器，其存储在 badge 元素上）
 */
function resetStreamState() {
    streamState.active = false;
    streamState.startTime = 0;
    streamState.firstTokenMs = 0;
    streamState.route = null;
    streamState.chatSessionId = null;
    streamState.targetMessage = null;
    streamState.badge = null;
    streamState.previousLastMessage = null;
}

/**
 * 批量处理新增的元素节点：为助手消息恢复或创建 badge
 * - 流式目标消息跳过（由 onStreamChunk 实时更新，避免冲突）
 * - 其他消息尝试从持久化存储匹配数据恢复 badge；无匹配则标记为空闲
 * @param {Element[]} elements - 本轮新增的元素节点列表
 */
function handleDomElements(elements) {
    for (const el of elements) {
        if (!el || el.nodeType !== 1) continue;
        const messages = el.matches && el.matches('.ds-message')
            ? [el]
            : (el.querySelectorAll ? Array.from(el.querySelectorAll('.ds-message')) : []);
        for (const msg of messages) {
            if (!isAssistantMessage(msg)) continue;
            // 跳过流式目标消息（由 onStreamChunk 实时更新，避免覆盖）
            if (streamState.active && msg === streamState.targetMessage) continue;
            // 已有 badge 的消息不重复处理
            if (msg.querySelector('.ds-token-badge')) continue;
            // 尝试从持久化存储匹配 badge 数据
            const data = getBadge(extractMessageText(msg));
            const badge = getOrCreateBadge(msg);
            if (data) {
                setBadgeDisplay(badge, data.tokens, data.tps, data.speedSource);
            } else {
                markBadgeIdle(badge);
            }
        }
    }
}

/**
 * 处理 fetch-hub 的 chunk 事件：更新 badge
 * TPS 使用首 chunk 到达后的耗时（fetch-hub 已计算好 tps，但 chunk 阶段需要实时计算）
 * @param {Object} payload - { chunk, accumulatedText, elapsedMs, tokens, firstTokenMs, serverStats }
 */
function onStreamChunk(payload) {
    // 首次收到 chunk 时记录时间并绑定目标消息与 badge
    if (streamState.firstTokenMs === 0) {
        streamState.firstTokenMs = payload.firstTokenMs || Date.now();
    }
    // 持续尝试定位新增的助手消息：第一个 chunk 到达时新消息 DOM 可能尚未创建，
    // 需要基于 onStreamStart 记录的基准（previousLastMessage）查找其后新增的消息
    if (!streamState.targetMessage) {
        streamState.targetMessage = findNewAssistantMessage(streamState.previousLastMessage);
    }
    if (streamState.targetMessage) {
        streamState.badge = getOrCreateBadge(streamState.targetMessage);
    }
    if (streamState.badge) {
        streamState.badge.classList.remove('idle');
        // TPS 计算从首 chunk 开始（排除 prefill）
        const tpsElapsed = streamState.firstTokenMs > 0
            ? Date.now() - streamState.firstTokenMs
            : payload.elapsedMs;
        const speedSource = payload.serverStats && (payload.serverStats.startedAtMs !== null && payload.serverStats.completedAtMs !== null)
            ? 'server'
            : 'estimated';
        updateBadgeText(streamState.badge, payload.tokens, tpsElapsed, speedSource);
    }
}

/**
 * 处理 fetch-hub 的 start 事件：初始化流式状态
 * 路由感知：若 chatSessionId 变化则强制重置
 * 记录当前已有的最后一个助手消息作为基准，供 onStreamChunk 定位新增消息
 * @param {Object} payload - { startTime, model, route, chatSessionId }
 */
function onStreamStart(payload) {
    // 路由感知：切换会话重置
    if (streamState.active && payload.chatSessionId && streamState.chatSessionId &&
        payload.chatSessionId !== streamState.chatSessionId) {
        resetStreamState();
    }
    // 在重置前记录基准：当前页面已有的最后一个助手消息
    // 用于在 chunk 阶段区分"新消息"与"旧消息"，避免错误定位到上一条消息
    const baseline = findLatestAssistantMessage();
    resetStreamState();
    streamState.active = true;
    streamState.startTime = payload.startTime;
    streamState.route = payload.route || 'completion';
    streamState.chatSessionId = payload.chatSessionId;
    streamState.previousLastMessage = baseline;
}

/**
 * 处理 fetch-hub 的 end 事件：更新最终数值、延迟进入空闲
 * 同时延迟读取目标消息文本，将 badge 数据持久化到 localStorage，
 * 以便刷新或 DeepSeek 重渲染消息列表后能恢复 badge 显示
 * @param {Object} payload - { tokens, tps, durationMs, model, serverStats, tokenSource, speedSource, accumulatedText }
 */
function onStreamEnd(payload) {
    const badge = streamState.badge;
    const targetMsg = streamState.targetMessage;
    if (badge) {
        // 使用 fetch-hub 已计算好的 tps（从首 chunk 开始）与 speedSource
        // 但 badge 显示需要 elapsedMs，这里用 durationMs（已根据服务端统计校准）
        // 重新计算 elapsed 用于显示：tps = tokens / (elapsedMs/1000) → elapsedMs = tokens / tps * 1000
        const displayElapsed = payload.tps > 0 ? (payload.tokens / payload.tps) * 1000 : payload.durationMs;
        updateBadgeText(badge, payload.tokens, displayElapsed, payload.speedSource || 'estimated');
        // 延迟进入空闲状态（定时器挂在 badge 上，避免被 resetStreamState 清除）
        if (badge._idleTimer) clearTimeout(badge._idleTimer);
        badge._idleTimer = setTimeout(() => markBadgeIdle(badge), IDLE_DELAY);
    }
    // 持久化 badge 数据：延迟读取目标消息文本（等待 React 渲染完成），
    // 用于刷新页面或 DeepSeek 重渲染消息列表后恢复 badge 显示
    if (targetMsg) {
        const tokens = payload.tokens;
        const tps = payload.tps;
        const speedSource = payload.speedSource || 'estimated';
        setTimeout(() => {
            const text = extractMessageText(targetMsg);
            if (text) saveBadge(text, { tokens, tps, speedSource });
        }, BADGE_TEXT_DELAY_MS);
    }

    // 记录 token 用量到 usage 模块（供 30 天统计热力图）
    // 通过 coalescing queue 合并高频写入，不影响主流程
    if (payload.tokens > 0) {
        const recordId = `turn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        recordUsageTurn({
            id: recordId,
            source: 'deepseek-web',
            modelType: payload.model || null,
            totalTokens: payload.tokens,
            tokenSource: payload.tokenSource || 'estimated',
            tps: payload.tps || 0,
            speedSource: payload.speedSource || 'estimated',
            elapsedMs: payload.durationMs || 0,
            messageCount: 2
        }).catch(e => {
            console.warn('[token-speed] recordUsageTurn failed:', e);
        });
    }

    resetStreamState();
}

/**
 * 扫描当前页面所有助手消息，恢复持久化的 badge 显示
 * 用于脚本初始化时处理已存在的 DOM（observer-hub 只处理新增节点）
 */
function restoreExistingBadges() {
    const messages = document.querySelectorAll('.ds-message');
    if (messages.length === 0) return;
    handleDomElements(Array.from(messages));
}

/**
 * 初始化 Token 速度指示器
 * 注入样式、向 fetch-hub 注册处理器、向 observer-hub 注册 DOM 处理器
 * 初始化时主动扫描现有助手消息，从持久化存储恢复 badge
 */
export function initTokenSpeed() {
    if (installed) return;
    installed = true;
    injectBadgeStyle();
    // 预热 badge 存储缓存
    readBadgeStore();
    // 向统一的 fetch-hub 注册 completion 生命周期处理器
    handlerId = registerCompletionHandler({
        onStart: onStreamStart,
        onChunk: onStreamChunk,
        onEnd: onStreamEnd
    });
    // 向统一的 observer-hub 注册 DOM 元素处理器
    domHandlerId = registerDomHandler({ onElements: handleDomElements });
    // 主动扫描现有助手消息，恢复持久化的 badge 数据
    // 延迟执行以确保 DeepSeek 已完成初始渲染
    setTimeout(restoreExistingBadges, 1500);
    // 页面卸载前 flush 待写入的 badge 数据
    window.addEventListener('beforeunload', flushBadgeWrite);
}

/**
 * 立即将待写入的 badge 数据 flush 到 localStorage（供 beforeunload 调用）
 */
function flushBadgeWrite() {
    if (_badgeWriteTimer) {
        clearTimeout(_badgeWriteTimer);
        _badgeWriteTimer = null;
        try {
            const store = readBadgeStore();
            const entries = Array.from(store.entries());
            if (entries.length > BADGE_MAX_ENTRIES) {
                entries.splice(0, entries.length - BADGE_MAX_ENTRIES);
            }
            localStorage.setItem(BADGE_STORAGE_KEY, JSON.stringify(entries));
        } catch (e) {}
    }
}

/**
 * 清理 Token 速度指示器（对外暴露的可选接口）
 */
export function destroyTokenSpeed() {
    if (!installed) return;
    installed = false;
    if (handlerId) unregisterCompletionHandler(handlerId);
    if (domHandlerId) unregisterDomHandler(domHandlerId);
    handlerId = 0;
    domHandlerId = 0;
    window.removeEventListener('beforeunload', flushBadgeWrite);
    // 确保待写入的数据被 flush
    flushBadgeWrite();
}
