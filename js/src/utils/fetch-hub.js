/**
 * 统一的 Fetch 拦截中心
 *
 * 替代各模块独立的 fetch hook，避免：
 *   1. 多次 window.fetch 覆写导致递归
 *   2. 每次 completion 请求多次 response.clone()
 *   3. 重复的流式读取与 TextDecoder 实例化
 *
 * 模块通过 registerCompletionHandler(callback) 注册处理器，
 * 在 SSE 流的各生命周期（start/chunk/end）收到统一分发的事件。
 *
 * 同时负责在请求发出前注入系统提示词和记忆内容（请求拦截），
 * 确保无论 DeepSeek 使用 fetch 还是 XHR，注入都能生效。
 *
 * 事件类型（参考 deepseek-pp 的 stream-metrics 设计）：
 *   'start'  - { startTime, model, prompt, route, chatSessionId }
 *   'chunk'  - { chunk, accumulatedText, elapsedMs, tokens, firstTokenMs, serverStats }
 *   'end'    - { tokens, tps, durationMs, model, accumulatedText, serverStats,
 *                tokenSource, speedSource, chatSessionId, assistantMessageId, route }
 *
 * 关键改进（参考 deepseek-pp/stream-metrics.ts）：
 *   - 修复增量 token 计算 bug：用 lastChars 追踪字符位置，而非 lastTokens*3
 *   - 解析 SSE 中的服务端统计（accumulated_token_usage / inserted_at / updated_at / model_type）
 *   - 区分 startTime（请求发出）与 firstTokenMs（首 chunk 到达），TPS 从首 chunk 开始计算
 *   - 路由感知：识别 completion/edit_message/regenerate/continue/resume_stream
 *   - tokenSource/speedSource 双源标记：'server' 优先于 'estimated'
 */

import { estimateTokenUnits } from './token-estimator.js';
import { CONFIG } from '../config.js';
import { stripToolCallsFromHistory } from '../features/history-cleanup.js';
import { applyPromptAugmentation } from './prompt-augmentation.js';
// agent-marker 集中管理续跑标记识别（原 fetch-hub 内联定义已迁移）
import { isAgentContinuationPrompt, AGENT_V2_START_MARKER, AGENT_V2_END_MARKER } from './agent-marker.js';

/** DeepSeek completion 相关端点（与 anti-recall.js 的 XHR hook 保持一致） */
const COMPLETION_ROUTES = {
    '/api/v0/chat/completion': 'completion',
    '/api/v0/chat/edit_message': 'editMessage',
    '/api/v0/chat/regenerate': 'regenerate',
    '/api/v0/chat/continue': 'continue',
    '/api/v0/chat/resume_stream': 'resumeStream'
};

/** DeepSeek 历史消息端点（fetch 路径拦截，清理废弃的工具调用数据） */
const HISTORY_ROUTES = [
    '/api/v0/chat/history_messages'
];

let installed = false;

/**
 * 检查 fetch hook 是否已安装（跨 bundle 共享）
 * 由于 early-boot.js 和 dspro.js 是两个独立 webpack bundle，
 * 各自有独立的模块作用域，installHook 的 installed 标志不共享，
 * 导致 window.fetch 被重复包裹（双包裹），prompt 注入执行两次。
 * 解决方案：installHook 通过 window.__dsFetchHub__.fetchHookInstalled 共享状态。
 * @returns {boolean}
 */
function isHookInstalled() {
    if (typeof window !== 'undefined' && window.__dsFetchHub__) {
        return !!window.__dsFetchHub__.fetchHookInstalled;
    }
    return installed;
}

/**
 * 标记 fetch hook 已安装（跨 bundle 共享）
 */
function markHookInstalled() {
    installed = true;
    if (typeof window !== 'undefined') {
        if (!window.__dsFetchHub__) window.__dsFetchHub__ = {};
        window.__dsFetchHub__.fetchHookInstalled = true;
    }
}

/**
 * 已注册的处理器 Map: id -> { onStart, onChunk, onEnd }
 *
 * 使用 window 全局共享：在 WebView 多 bundle 环境（early-boot 与 main 脚本分离）下，
 * 模块级 const 会在每个 bundle 中各持独立副本，导致 main 脚本注册的 agent handlers
 * 收不到 early-boot XHR hook 拦截到的事件，agent 续跑循环无法触发 onEnd。
 * 通过挂载到 window.__dsFetchHub__.handlers 共享同一份注册表，修复该隔离问题。
 *
 * 油猴单 bundle 环境下行为不变（window 已通过 IIFE 重定向到 unsafeWindow）。
 */
const handlers = (() => {
    if (typeof window === 'undefined') return new Map();
    if (!window.__dsFetchHub__) window.__dsFetchHub__ = {};
    if (!window.__dsFetchHub__.handlers) window.__dsFetchHub__.handlers = new Map();
    return window.__dsFetchHub__.handlers;
})();

/**
 * 分配处理器 ID（window 全局递增，避免多 bundle ID 冲突）
 * @returns {number} 新的处理器 ID
 */
function allocHandlerId() {
    if (typeof window === 'undefined') {
        _localNextId++;
        return _localNextId;
    }
    if (!window.__dsFetchHub__) window.__dsFetchHub__ = {};
    window.__dsFetchHub__.nextId = (window.__dsFetchHub__.nextId || 0) + 1;
    return window.__dsFetchHub__.nextId;
}
let _localNextId = 0;

/**
 * 从 fetch args 解析请求 URL
 * @param {Parameters<typeof fetch>} args
 * @returns {string}
 */
function getUrl(args) {
    return (typeof args[0] === 'string')
        ? args[0]
        : ((args[0] && args[0].url) || '');
}

/**
 * 从 URL 路径匹配 DeepSeek completion 路由
 * @param {string} url
 * @returns {string|null} 路由 key（completion/editMessage/...），不匹配返回 null
 */
function matchRoute(url) {
    if (!url) return null;
    // 去掉 query string
    const qIdx = url.indexOf('?');
    const path = qIdx >= 0 ? url.slice(0, qIdx) : url;
    for (const [prefix, route] of Object.entries(COMPLETION_ROUTES)) {
        if (path.includes(prefix)) return route;
    }
    return null;
}

/**
 * 检测 URL 是否为 DeepSeek 历史消息端点
 * 用于拦截 history_messages 响应，清理废弃的工具调用 XML 和续跑 prompt
 * @param {string} url - 请求 URL
 * @returns {boolean} 是否为历史消息端点
 */
function isHistoryRoute(url) {
    if (!url) return false;
    const qIdx = url.indexOf('?');
    const path = qIdx >= 0 ? url.slice(0, qIdx) : url;
    for (const prefix of HISTORY_ROUTES) {
        if (path.includes(prefix)) return true;
    }
    return false;
}

/**
 * 拦截历史消息响应，清理废弃的工具调用 XML 和续跑 prompt
 *
 * 参考 deepseek-pp/core/interceptor/fetch-hook.ts:interceptHistoryResponse
 * 读取响应 JSON，调用 stripToolCallsFromHistory 清理，返回新的 Response
 *
 * @param {Promise<Response>} responsePromise - 原始 fetch 响应 Promise
 * @returns {Promise<Response>} 清理后的响应
 */
async function interceptHistoryResponse(responsePromise) {
    const response = await responsePromise;
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('json')) return response;

    try {
        const json = await response.json();
        stripToolCallsFromHistory(json);
        return new Response(JSON.stringify(json), {
            headers: response.headers,
            status: response.status,
            statusText: response.statusText
        });
    } catch (e) {
        return response;
    }
}

/**
 * 从 fetch args 的 body 中解析 model / chat_session_id / prompt
 * @param {Parameters<typeof fetch>} args
 * @returns {{ model: string, chatSessionId: string|null, prompt: string|null, bodyJson: object|null }}
 */
function parseRequestMeta(args) {
    const options = args[1] || {};
    const result = { model: 'deepseek-chat', chatSessionId: null, prompt: null, bodyJson: null };
    try {
        if (typeof options.body === 'string') {
            const bodyJson = JSON.parse(options.body);
            result.bodyJson = bodyJson;
            if (bodyJson.model) result.model = bodyJson.model;
            if (bodyJson.chat_session_id) result.chatSessionId = String(bodyJson.chat_session_id);
            if (typeof bodyJson.prompt === 'string') result.prompt = bodyJson.prompt;
        }
    } catch (e) {}
    return result;
}

// agent 续跑标记与识别函数已迁移到 utils/agent-marker.js
// 此处通过 re-export 保持向后兼容（text-process.js 等模块仍从 fetch-hub 导入）
export { isAgentContinuationPrompt, AGENT_V2_START_MARKER, AGENT_V2_END_MARKER } from './agent-marker.js';

/**
 * 在请求发出前注入系统提示词和记忆内容到 prompt
 *
 * 提示词拼装逻辑已抽取到 utils/prompt-augmentation.js 的 buildPromptPrefix，
 * 本函数仅负责：解析 body → 调用统一入口 → 写回 body。
 * anti-recall.js 的 XHR 拦截也调用同一入口，确保两处注入逻辑完全一致。
 *
 * 修改 fetch args 中的 body（原地修改 options.body 字符串）
 * @param {Parameters<typeof fetch>} args
 * @returns {string|null} 用户发送的原始 prompt（用于记忆触发检测），无 prompt 时返回 null
 */
function injectPromptAndMemory(args) {
    const options = args[1];
    if (!options || typeof options.body !== 'string') return null;
    // 调用统一入口构建 prefix 并应用
    const { originalPrompt, newBody } = applyPromptAugmentation(options.body);
    if (newBody !== null) {
        options.body = newBody;
    }

    // 记录原始用户任务给 capability-agent（供工具调用后续跑 prompt 构建）
    // 仅记录非续跑请求（续跑 prompt 包含 <original_task> 标签，不应覆盖）
    if (originalPrompt && typeof window !== 'undefined' && typeof window._dsRecordOriginalTask === 'function') {
        try {
            if (!isAgentContinuationPrompt(originalPrompt)) {
                window._dsRecordOriginalTask(originalPrompt);
            }
        } catch (e) {
            console.warn('[fetch-hub] recordOriginalTask failed:', e);
        }
    } else if (!originalPrompt && typeof window !== 'undefined' && typeof window._dsTouchUserMessageTime === 'function') {
        // 无 prompt 的请求（如 regenerate / continue / resumeStream）：仅刷新时间戳，不覆盖 originalTask
        // 避免后续工具调用因 lastUserMessageTime 过期被 agent 门控跳过
        try {
            window._dsTouchUserMessageTime();
        } catch (e) {}
    }

    return originalPrompt;
}

// ============================================================
// SSE 服务端统计解析（参考 deepseek-pp/stream-codec.ts 的 extractResponseUsageStatsFromParsed）
// ============================================================

/** 服务端统计缓存（贯穿一次 completion 流） */
function createServerStatsState() {
    return {
        startedAtMs: null,        // 服务端 inserted_at（毫秒）
        completedAtMs: null,      // 服务端 updated_at（毫秒）
        accumulatedTokens: null,  // 服务端累计 token 数（含 prompt+context）
        modelType: null,           // 服务端报告的模型类型
        assistantMessageId: null,  // 服务端 response.message_id
        lastParsedLen: 0           // 已解析的累积文本长度（避免重复正则扫描）
    };
}

/**
 * 尝试从累积的 SSE 文本中提取服务端统计字段
 * DeepSeek SSE 格式为每行 `data: {...}` JSON，包含 accumulated_token_usage / inserted_at / updated_at / model_type / response.message_id
 * 采用增量扫描：只解析自上次以来的新增部分（含跨 chunk 的行边界，多扫描 200 字符避免遗漏）
 * @param {string} accumulatedText - 累积的 SSE 文本
 * @param {Object} state - 服务端统计状态
 */
function parseServerStats(accumulatedText, state) {
    if (!accumulatedText || accumulatedText.length <= state.lastParsedLen) return;
    // 增量扫描：从上次解析位置往前回退 200 字符，处理跨 chunk 的行边界
    const start = Math.max(0, state.lastParsedLen - 200);
    const slice = accumulatedText.slice(start);

    // accumulated_token_usage（数字或对象）
    let m = slice.match(/"accumulated_token_usage"\s*:\s*(\d+)/);
    if (m) {
        state.accumulatedTokens = parseInt(m[1], 10);
    } else {
        // 兼容对象形式 { total: N }
        m = slice.match(/"accumulated_token_usage"\s*:\s*\{\s*"total"\s*:\s*(\d+)/);
        if (m) state.accumulatedTokens = parseInt(m[1], 10);
    }

    // inserted_at（秒级 Unix 时间戳）
    m = slice.match(/"inserted_at"\s*:\s*(\d{10})/);
    if (m) {
        const ms = parseInt(m[1], 10) * 1000;
        if (state.startedAtMs === null || ms < state.startedAtMs) state.startedAtMs = ms;
    }

    // updated_at（秒级 Unix 时间戳）
    m = slice.match(/"updated_at"\s*:\s*(\d{10})/);
    if (m) {
        const ms = parseInt(m[1], 10) * 1000;
        if (state.completedAtMs === null || ms > state.completedAtMs) state.completedAtMs = ms;
    }

    // model_type
    m = slice.match(/"model_type"\s*:\s*"([^"]+)"/);
    if (m) state.modelType = m[1];

    // response.message_id（数字）
    m = slice.match(/"message_id"\s*:\s*(\d+)/);
    if (m && state.assistantMessageId === null) state.assistantMessageId = parseInt(m[1], 10);

    state.lastParsedLen = accumulatedText.length;
}

/**
 * 从 SSE 文本中提取用于 token 估算的"输出文本"
 * 参考 deepseek-pp/stream-codec.ts:350 的 extractResponseTextForTokenSpeed
 * 优先取 content / thinking_content / reasoning_content 字段，避免把 JSON 框架字符算入 token
 * @param {string} chunk - 本次 chunk 的原始文本
 * @param {string} accumulatedText - 累积文本（备用）
 * @returns {string} 提取出的可读文本（用于 token 估算）
 */
function extractTextForTokens(chunk, accumulatedText) {
    if (!chunk) return '';
    // 简化策略：先尝试从 data: 行中提取 content/thinking_content/reasoning_content 字段
    // 若解析失败，回退到原始 chunk 文本
    let extracted = '';
    const lines = chunk.split('\n');
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const jsonStr = trimmed.slice(5).trim();
        if (!jsonStr || jsonStr === '[DONE]') continue;
        try {
            const obj = JSON.parse(jsonStr);
            // 多种字段命名兼容（snake_case / camelCase）
            const content = obj.content || obj.choices?.[0]?.delta?.content;
            const thinking = obj.thinking_content || obj.reasoning_content || obj.thinkingContent || obj.reasoningContent;
            if (typeof content === 'string') extracted += content;
            if (typeof thinking === 'string') extracted += thinking;
            // DeepSeek 流式 patch 协议：{ p: 'response/content', v: '...' } 或 { v: [...] }
            if (typeof obj.p === 'string' && typeof obj.v === 'string') {
                if (/content|thinking|reasoning/i.test(obj.p)) extracted += obj.v;
            }
        } catch (e) {
            // JSON 解析失败，回退：直接累积原始 chunk（至少不丢字符）
            extracted += jsonStr;
        }
    }
    return extracted || chunk;
}

/**
 * 观察 SSE 流并逐块分发事件给所有注册的处理器
 * 流式期间统一做一次 token 估算（增量方式），避免每个处理器重复计算
 * @param {ReadableStream<Uint8Array>} body
 * @param {number} startTime - 请求发出时间
 * @param {string} model - 模型名
 * @param {string|null} userPrompt - 用户发送的原始 prompt（用于记忆触发检测）
 * @param {string} route - 路由 key
 * @param {string|null} chatSessionId - 会话 ID
 */
async function observeStream(body, startTime, model, userPrompt, route, chatSessionId) {
    if (!body || !body.getReader) return;

    const reader = body.getReader();
    const decoder = new TextDecoder('utf-8');
    let accumulatedText = '';

    // token 估算状态（修复原 bug：用 lastChars 追踪字符位置，而非 lastTokens*3）
    let lastChars = 0;
    let lastTokens = 0;

    // 服务端统计状态
    const serverStats = createServerStatsState();

    // 首 chunk 时间（用于 TPS 计算，排除 prefill 延迟）
    let firstTokenMs = 0;

    // 分发 start 事件（包含 userPrompt，供记忆模块检测触发关键词）
    for (const h of handlers.values()) {
        try { h.onStart && h.onStart({ startTime, model, prompt: userPrompt, route, chatSessionId }); } catch (e) {}
    }

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value, { stream: true });
            if (!chunk) continue;
            accumulatedText += chunk;

            // 增量解析服务端统计
            parseServerStats(accumulatedText, serverStats);

            // 首 chunk 时间记录
            if (firstTokenMs === 0) {
                firstTokenMs = Date.now();
            }

            // 增量 token 估算（修复 bug：用 lastChars 而非 lastTokens*3）
            const newPart = accumulatedText.slice(lastChars);
            if (newPart.length > 0) {
                lastTokens += estimateTokenUnits(newPart);
                lastChars = accumulatedText.length;
            }

            const elapsedMs = Date.now() - startTime;

            // 分发 chunk 事件
            for (const h of handlers.values()) {
                try {
                    h.onChunk && h.onChunk({
                        chunk,
                        accumulatedText,
                        elapsedMs,
                        tokens: lastTokens,
                        firstTokenMs,
                        serverStats: { ...serverStats }
                    });
                } catch (e) {}
            }
        }
    } catch (e) {
        // 流异常：继续分发 end 事件以清理状态
    }

    // 结束时做一次精确的全量 token 估算
    const finalTokens = estimateTokenUnits(accumulatedText);

    // 决定 token 源：服务端 accumulatedTokens 包含 prompt+context，仅用于总量汇报
    // 生成 token 数仍用估算值（finalTokens），因为服务端 accumulatedTokenUsage 是累计值非本轮生成值
    const tokenSource = 'estimated';
    // 速度源：优先服务端（如果有 inserted_at + updated_at + accumulatedTokens）
    let speedSource = 'estimated';
    let durationMs = startTime ? Date.now() - startTime : 0;
    if (serverStats.startedAtMs !== null && serverStats.completedAtMs !== null) {
        const serverElapsed = serverStats.completedAtMs - serverStats.startedAtMs;
        if (serverElapsed > 0 && Number.isFinite(serverElapsed)) {
            durationMs = serverElapsed;
            speedSource = 'server';
        }
    }

    // TPS 计算：从首 chunk 开始计时，排除 prefill 延迟（参考 deepseek-pp/stream-metrics.ts:63-67）
    let tps = 0;
    if (firstTokenMs > 0) {
        const genElapsedMs = Date.now() - firstTokenMs;
        tps = genElapsedMs > 0 ? finalTokens / (genElapsedMs / 1000) : 0;
    }

    // 分发 end 事件
    for (const h of handlers.values()) {
        try {
            h.onEnd && h.onEnd({
                tokens: finalTokens,
                tps,
                durationMs,
                model,
                accumulatedText,
                serverStats: { ...serverStats },
                tokenSource,
                speedSource,
                chatSessionId,
                assistantMessageId: serverStats.assistantMessageId,
                route
            });
        } catch (e) {}
    }
}

/**
 * 安装统一的 fetch 钩子（单例）
 * - 拦截 history_messages 响应，清理废弃的工具调用 XML 和续跑 prompt
 * - 拦截 completion 系列请求，注入系统提示词 + 流式观察
 */
function installHook() {
    // 跨 bundle 共享的安装状态检测（修复 early-boot.js 与 dspro.js 双包裹问题）
    if (isHookInstalled()) return;
    markHookInstalled();

    const origFetch = window.fetch;
    window.fetch = async function (...args) {
        const url = getUrl(args);
        const route = matchRoute(url);
        const isHistory = isHistoryRoute(url);

        // 历史消息路由：拦截响应，清理废弃数据
        // 参考 deepseek-pp/core/interceptor/fetch-hook.ts:hookFetch 的 history 分支
        if (isHistory && !route) {
            return interceptHistoryResponse(origFetch.apply(this, args));
        }

        let userPrompt = null;
        let meta = { model: 'deepseek-chat', chatSessionId: null, prompt: null, bodyJson: null };

        // 请求拦截：在 completion 系列请求发出前注入系统提示词和记忆内容
        try {
            if (route) {
                userPrompt = injectPromptAndMemory(args);
                meta = parseRequestMeta(args);
            }
        } catch (e) {}

        const response = await origFetch.apply(this, args);

        try {
            if (route && response && response.body && handlers.size > 0) {
                const startTime = Date.now();
                // 只 clone 一次，统一分发给所有处理器
                observeStream(
                    response.clone().body,
                    startTime,
                    meta.model,
                    userPrompt,
                    route,
                    meta.chatSessionId
                );
            }
        } catch (e) {}

        return response;
    };
}

/**
 * 显式安装 fetch 钩子（幂等）
 * 供 early-boot 等需要在最早阶段就装好 hook 的场景使用；
 * 内部与 registerCompletionHandler 共用同一个 installHook 单例。
 * @returns {void}
 */
export function installFetchHook() {
    installHook();
}

/**
 * 注册一个 completion 生命周期处理器
 * @param {Object} callbacks - { onStart?, onChunk?, onEnd? }
 * @returns {number} 处理器 ID，用于 unregister
 */
export function registerCompletionHandler(callbacks) {
    installHook();
    const id = allocHandlerId();
    handlers.set(id, callbacks || {});
    return id;
}

/**
 * 注销指定 ID 的处理器
 * @param {number} id
 */
export function unregisterCompletionHandler(id) {
    handlers.delete(id);
}

// ============================================================
// XHR 流式观察（供 anti-recall.js 调用）
//
// DeepSeek 网页实际通过 XHR 而非 fetch 发送 /api/v0/chat/completion 请求，
// 因此 fetch-hub 的 window.fetch hook 不会被触发。
// 此函数由 anti-recall.js 的 XHR send hook 调用，复用统一的 token 估算、
// 服务端统计解析与事件分发逻辑，确保 token-speed / usage-stats 等模块
// 能收到与 fetch 路径一致的 onStart/onChunk/onEnd 事件。
// ============================================================

/**
 * 观察 XHR 的流式响应并分发 completion 生命周期事件
 * 通过 readystatechange 事件读取原始 responseText 增量，避免与 anti-recall 的 responseText getter 冲突
 * @param {XMLHttpRequest} xhr - XHR 实例
 * @param {Function} getOriginalResponseText - 返回原始（未过滤）responseText 的函数
 * @param {number} startTime - 请求发出时间戳
 * @param {string} model - 模型名
 * @param {string|null} userPrompt - 用户原始 prompt（用于记忆触发检测）
 * @param {string} route - 路由 key（completion/editMessage/regenerate/continue/resumeStream）
 * @param {string|null} chatSessionId - 会话 ID
 */
export function observeXhrStream(xhr, getOriginalResponseText, startTime, model, userPrompt, route, chatSessionId) {
    // 没有注册的处理器时直接跳过，避免无谓的 readystatechange 监听
    if (handlers.size === 0) return;

    let lastLen = 0;              // 上次消费到的 responseText 长度
    let accumulatedText = '';     // 累积的 SSE 文本
    let lastChars = 0;            // 上次 token 估算到的字符位置
    let lastTokens = 0;           // 累积估算 token 数
    let firstTokenMs = 0;         // 首 chunk 到达时间
    let finished = false;         // 是否已分发 end 事件（防止 readystatechange 多次触发）
    const serverStats = createServerStatsState();

    // 分发 start 事件
    for (const h of handlers.values()) {
        try { h.onStart && h.onStart({ startTime, model, prompt: userPrompt, route, chatSessionId }); } catch (e) {}
    }

    /**
     * 消费 responseText 增量并分发 chunk 事件
     */
    const consume = () => {
        try {
            const raw = getOriginalResponseText();
            if (!raw || raw.length <= lastLen) return;
            const newPart = raw.slice(lastLen);
            lastLen = raw.length;
            accumulatedText += newPart;

            // 增量解析服务端统计
            parseServerStats(accumulatedText, serverStats);

            // 首 chunk 时间
            if (firstTokenMs === 0) firstTokenMs = Date.now();

            // 增量 token 估算（与 observeStream 保持一致）
            const newChars = accumulatedText.slice(lastChars);
            if (newChars.length > 0) {
                lastTokens += estimateTokenUnits(newChars);
                lastChars = accumulatedText.length;
            }

            const elapsedMs = Date.now() - startTime;

            // 分发 chunk 事件
            for (const h of handlers.values()) {
                try {
                    h.onChunk && h.onChunk({
                        chunk: newPart,
                        accumulatedText,
                        elapsedMs,
                        tokens: lastTokens,
                        firstTokenMs,
                        serverStats: { ...serverStats }
                    });
                } catch (e) {}
            }
        } catch (e) {}
    };

    /**
     * 结束流：消费剩余数据并分发 end 事件
     */
    const finish = () => {
        if (finished) return;
        finished = true;
        consume(); // 消费可能残留的最后一批数据

        // 最终全量 token 估算
        const finalTokens = estimateTokenUnits(accumulatedText);
        const tokenSource = 'estimated';

        // 速度源：优先服务端统计
        let speedSource = 'estimated';
        let durationMs = startTime ? Date.now() - startTime : 0;
        if (serverStats.startedAtMs !== null && serverStats.completedAtMs !== null) {
            const serverElapsed = serverStats.completedAtMs - serverStats.startedAtMs;
            if (serverElapsed > 0 && Number.isFinite(serverElapsed)) {
                durationMs = serverElapsed;
                speedSource = 'server';
            }
        }

        // TPS 从首 chunk 开始计算，排除 prefill 延迟
        let tps = 0;
        if (firstTokenMs > 0) {
            const genElapsedMs = Date.now() - firstTokenMs;
            tps = genElapsedMs > 0 ? finalTokens / (genElapsedMs / 1000) : 0;
        }

        // 分发 end 事件
        for (const h of handlers.values()) {
            try {
                h.onEnd && h.onEnd({
                    tokens: finalTokens,
                    tps,
                    durationMs,
                    model,
                    accumulatedText,
                    serverStats: { ...serverStats },
                    tokenSource,
                    speedSource,
                    chatSessionId,
                    assistantMessageId: serverStats.assistantMessageId,
                    route
                });
            } catch (e) {}
        }
    };

    // readyState === 3 (LOADING) 时持续消费增量；readyState === 4 (DONE) 时结束
    xhr.addEventListener('readystatechange', function () {
        if (xhr.readyState === 3) {
            consume();
        } else if (xhr.readyState === 4) {
            finish();
        }
    });
}
