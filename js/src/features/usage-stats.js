/**
 * 使用量统计模块
 *
 * 记录每轮对话的 token 数、TPS、耗时、模型，生成 7/30 天汇总数据，
 * 并提供统计面板 HTML 渲染（用于嵌入设置面板）。
 * 数据持久化在 localStorage 的 ds_usage_records 中（最多保留 5000 条 / 180 天）。
 *
 * 性能优化：
 *   - 不再独立安装 fetch hook，改由 fetch-hub 统一分发 end 事件
 *   - localStorage 写入做异步批量 + signature 去重（避免重复记录同一请求）
 *   - 读缓存：内存缓存 records，避免每次 readRecords 都 JSON.parse
 *
 * 改进点（参考 deepseek-pp/usage/stats.ts + store.ts）：
 *   - 数据结构升级：增加 id/chatSessionId/assistantMessageId/modelType/tokenSource/speedSource/messageCount
 *   - 记录合并：相同 id 按 server 优先 + 时间戳最新合并
 *   - 进度写入协调器：signature 去重，避免流式 emit 多次导致重复记录
 *   - 5 个统计卡片：总 Token / Sessions / Messages / 连续天数 / 最常用模型
 *   - 热力图级别用相对最大值（非固定阈值）
 *   - 7/30 天可切换
 *   - 每日趋势柱状图（按模型分色堆叠）
 *   - 模型占比甜甜圈图（conic-gradient）
 *   - 上限提升：5000 条 + 180 天保留期
 *   - 归一化模型标签（deepseek-chat → DeepSeek Chat 等）
 */
import { registerCompletionHandler, unregisterCompletionHandler } from '../utils/fetch-hub.js';

const STORAGE_KEY = 'ds_usage_records';
const MAX_RECORDS = 5000;
const RETENTION_DAYS = 180;
const DAY_MS = 24 * 60 * 60 * 1000;
const HEATMAP_BASE_COLOR = '#4a90d9'; // 热力图基础蓝色

/** 模型标签归一化映射（参考 deepseek-pp/usage/stats.ts:123-135） */
const MODEL_LABELS = {
    'deepseek-chat': 'DeepSeek Chat',
    'deepseek-reasoner': 'DeepSeek Reasoner',
    'deepseek-coder': 'DeepSeek Coder',
    'deepseek-expert': 'DeepSeek Expert',
    'deepseek-vision': 'DeepSeek Vision',
    'deepseek-default': 'DeepSeek Default'
};

/** 模型配色（用于趋势柱状图与甜甜圈图） */
const MODEL_COLORS = [
    '#4a90d9', '#f59e0b', '#22c55e', '#8b5cf6',
    '#ec4899', '#06b6d4', '#ef4444', '#6366f1'
];

let installed = false;
let handlerId = 0;

/** 内存缓存：避免每次 readRecords 都 JSON.parse localStorage */
let _cacheRecords = null;
let _cacheDirty = true;

/** 异步写入的防抖定时器与待写入队列 */
let _writeTimer = null;
const WRITE_DEBOUNCE_MS = 400;

// ============================================================
// 进度写入协调器（参考 deepseek-pp/usage/progress-write-coordinator.ts）
// 解决：流式 emit 多次 + 服务端统计后到达导致同一请求重复/乱序写入
// ============================================================

/** 已写入记录的 signature Map: recordId -> signature（LRU 上限 200） */
const _writeSignatures = new Map();
const MAX_TRACKED_SIGNATURES = 200;

/**
 * 判断是否应该写入新记录（signature 去重）
 * @param {string} recordId - 记录 ID（chatSessionId + assistantMessageId 或时间戳）
 * @param {string} signature - 由关键字段组成的签名
 * @returns {boolean} true 表示应该写入
 */
function shouldWrite(recordId, signature) {
    const prev = _writeSignatures.get(recordId);
    if (prev === signature) return false;
    _writeSignatures.set(recordId, signature);
    // LRU 淘汰
    if (_writeSignatures.size > MAX_TRACKED_SIGNATURES) {
        const firstKey = _writeSignatures.keys().next().value;
        _writeSignatures.delete(firstKey);
    }
    return true;
}

/**
 * 构造记录 signature（任意关键字段变化才允许写入）
 * @param {Object} rec - 记录
 * @returns {string}
 */
function buildSignature(rec) {
    return [
        Math.round(rec.tokens || 0),
        rec.tokenSource || '',
        Math.round((rec.tps || 0) * 100) / 100,
        rec.speedSource || '',
        rec.modelType || '',
        rec.assistantMessageId || ''
    ].join('|');
}

/**
 * 读取本地存储的使用记录（带内存缓存）
 * @returns {Array} 记录数组
 */
function readRecords() {
    if (!_cacheDirty && _cacheRecords) return _cacheRecords;
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) {
            _cacheRecords = [];
        } else {
            const arr = JSON.parse(raw);
            _cacheRecords = Array.isArray(arr) ? arr : [];
        }
    } catch (e) {
        _cacheRecords = [];
    }
    _cacheDirty = false;
    return _cacheRecords;
}

/**
 * 清理过期记录：超过 180 天或超过 5000 条
 * 参考deepseek-pp/usage/store.ts:112-119 的 pruneUsageRecords
 */
function pruneRecords() {
    const records = _cacheRecords || [];
    if (records.length === 0) return;
    const now = Date.now();
    const cutoffTs = now - RETENTION_DAYS * DAY_MS;
    let pruned = records.filter(r => (r.timestamp || 0) >= cutoffTs);
    if (pruned.length > MAX_RECORDS) {
        pruned = pruned.slice(pruned.length - MAX_RECORDS);
    }
    if (pruned.length !== records.length) {
        _cacheRecords = pruned;
    }
}

/**
 * 防抖异步写入：将内存中的 records 刷新到 localStorage
 * 多次连续调用会合并为一次实际的 setItem
 */
function scheduleWrite() {
    if (_writeTimer) return;
    _writeTimer = setTimeout(() => {
        _writeTimer = null;
        try {
            pruneRecords();
            const finalRecords = _cacheRecords || [];
            localStorage.setItem(STORAGE_KEY, JSON.stringify(finalRecords));
        } catch (e) {}
    }, WRITE_DEBOUNCE_MS);
}

/**
 * 将时间戳格式化为 YYYY-MM-DD（本地时区）
 * @param {number} ts - 毫秒时间戳
 * @returns {string}
 */
function formatDate(ts) {
    const d = new Date(ts);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

/**
 * 将数字格式化为带千位分隔符的字符串
 * @param {number} num
 * @returns {string}
 */
function formatNumber(num) {
    return new Intl.NumberFormat('en-US').format(Math.round(num || 0));
}

/**
 * 归一化模型标签
 * @param {string} modelType - 原始模型名
 * @returns {string} 归一化后的标签
 */
function getModelLabel(modelType) {
    if (!modelType) return 'DeepSeek Chat';
    const key = String(modelType).toLowerCase();
    if (MODEL_LABELS[key]) return MODEL_LABELS[key];
    // 兼容 deepseek-reasoner-r1 等变体
    for (const [k, v] of Object.entries(MODEL_LABELS)) {
        if (key.includes(k)) return v;
    }
    return modelType;
}

/**
 * 获取模型在配色数组中的索引（稳定哈希）
 * @param {string} modelType
 * @returns {number}
 */
function getModelColorIndex(modelType) {
    const label = getModelLabel(modelType);
    let hash = 0;
    for (let i = 0; i < label.length; i++) {
        hash = ((hash << 5) - hash + label.charCodeAt(i)) | 0;
    }
    return Math.abs(hash) % MODEL_COLORS.length;
}

/**
 * 记录或合并一次对话的使用量（异步写入 localStorage）
 * 参考 deepseek-pp/usage/store.ts:71-99 的 mergeUsageRecord：
 *   - 相同 id 的记录按「服务端优先 + 时间戳最新」合并
 *   - signature 去重避免流式重复 emit
 * @param {Object} payload - { tokens, tps, durationMs, model, serverStats, tokenSource, speedSource, chatSessionId, assistantMessageId, route }
 * @returns {Object|null} 本次生成或合并后的记录
 */
export function recordUsage(payload) {
    if (!payload || payload.tokens <= 0) return null;
    const now = Date.now();
    const modelType = payload.model ||
        (payload.serverStats && payload.serverStats.modelType) ||
        'deepseek-chat';

    // 记录 ID：优先用 chatSessionId + assistantMessageId（保证幂等），否则用时间戳
    const recordId = (payload.chatSessionId && payload.assistantMessageId)
        ? `${payload.chatSessionId}#${payload.assistantMessageId}`
        : `t${now}`;

    const record = {
        id: recordId,
        date: formatDate(now),
        tokens: Math.round(payload.tokens || 0),
        tps: Number(payload.tps || 0).toFixed(1),
        durationMs: Math.round(payload.durationMs || 0),
        modelType: modelType,
        modelLabel: getModelLabel(modelType),
        tokenSource: payload.tokenSource || 'estimated',
        speedSource: payload.speedSource || 'estimated',
        chatSessionId: payload.chatSessionId || null,
        assistantMessageId: payload.assistantMessageId || null,
        route: payload.route || 'completion',
        messageCount: 1,
        timestamp: now
    };

    // signature 去重
    const sig = buildSignature(record);
    if (!shouldWrite(recordId, sig)) return null;

    const records = readRecords();
    // 合并：相同 id 的记录按 server 优先 + 时间戳最新合并
    const existIdx = records.findIndex(r => r.id === recordId);
    if (existIdx >= 0) {
        const exist = records[existIdx];
        // 服务端源优先
        const incomingIsServer = record.tokenSource === 'server' || record.speedSource === 'server';
        const existIsServer = exist.tokenSource === 'server' || exist.speedSource === 'server';
        if (incomingIsServer && !existIsServer) {
            // 覆盖
            records[existIdx] = { ...exist, ...record };
        } else if (!incomingIsServer && existIsServer) {
            // 保留旧的，不更新
            return exist;
        } else if (record.timestamp >= (exist.timestamp || 0)) {
            // 同源，时间戳新的覆盖
            records[existIdx] = { ...exist, ...record };
        } else {
            return exist;
        }
    } else {
        records.push(record);
    }
    _cacheDirty = false;
    // 触发异步防抖写入
    scheduleWrite();
    return record;
}

/**
 * 根据单日 token 总数与范围内最大值计算热力图级别（0-5）
 * 参考 deepseek-pp/usage/stats.ts:154-157：相对最大值，非固定阈值
 * @param {number} tokens - 单日 token 总数
 * @param {number} maxTokens - 范围内最大单日 token 数
 * @returns {number} 级别 0-5
 */
function calcHeatmapLevel(tokens, maxTokens) {
    if (tokens <= 0 || maxTokens <= 0) return 0;
    return Math.max(1, Math.ceil((tokens / maxTokens) * 5));
}

/**
 * 计算当前连续打卡天数
 * 参考 deepseek-pp/usage/stats.ts:159-166
 * @param {Array} dailyMap - 按日期聚合的 Map
 * @param {number} nowTs - 当前时间戳
 * @returns {number}
 */
function calcCurrentStreak(dailyMap, nowTs) {
    let streak = 0;
    let cursor = nowTs;
    // 从今天向前数，遇到 tokens=0 即停止
    for (let i = 0; i < 365; i++) {
        const date = formatDate(cursor);
        const dayData = dailyMap.get(date);
        if (dayData && dayData.tokens > 0) {
            streak++;
        } else if (i > 0) {
            // 允许今天还没数据，但昨天必须有
            break;
        }
        cursor -= DAY_MS;
    }
    return streak;
}

/**
 * 获取使用量汇总（参考 deepseek-pp/usage/stats.ts:17-107 的 summarizeUsage）
 * @param {number} days - 汇总天数（7 或 30，其他值视为 30）
 * @returns {Object} 汇总数据
 */
export function getUsageSummary(days = 7) {
    const rangeDays = (days === 7) ? 7 : 30;
    const records = readRecords();
    const now = Date.now();
    const sinceTs = now - rangeDays * DAY_MS;

    // 过滤指定天数内的记录
    const recent = records.filter(r => (r.timestamp || 0) >= sinceTs);

    // 按天聚合
    const dailyMap = new Map(); // date -> { tokens, messages, sessions: Set, models: Map }
    for (const r of recent) {
        if (!dailyMap.has(r.date)) {
            dailyMap.set(r.date, { tokens: 0, messages: 0, sessions: new Set(), models: new Map() });
        }
        const d = dailyMap.get(r.date);
        d.tokens += r.tokens;
        d.messages += 1;
        if (r.chatSessionId) d.sessions.add(r.chatSessionId);
        if (r.modelType) {
            const mk = r.modelType;
            d.models.set(mk, (d.models.get(mk) || 0) + r.tokens);
        }
    }

    // 全量记录按天聚合（用于连续打卡，不受 rangeDays 限制）
    const allDailyMap = new Map();
    for (const r of records) {
        if (!allDailyMap.has(r.date)) {
            allDailyMap.set(r.date, { tokens: 0, messages: 0 });
        }
        allDailyMap.get(r.date).tokens += r.tokens;
    }

    const totalTokens = recent.reduce((s, r) => s + r.tokens, 0);
    const totalMessages = recent.length;
    // Sessions 统计
    const sessionSet = new Set();
    for (const d of dailyMap.values()) {
        for (const sid of d.sessions) sessionSet.add(sid);
    }
    const sessionCount = sessionSet.size;
    const activeDays = dailyMap.size;
    const avgTps = totalMessages > 0
        ? recent.reduce((s, r) => s + Number(r.tps), 0) / totalMessages
        : 0;
    const currentStreak = calcCurrentStreak(allDailyMap, now);

    // 服务端源记录数
    const serverTokenRecordCount = recent.filter(r => r.tokenSource === 'server' || r.speedSource === 'server').length;

    // 模型维度聚合
    const modelMap = new Map(); // modelType -> { tokens, turns, label }
    for (const r of recent) {
        const mk = r.modelType || 'deepseek-chat';
        if (!modelMap.has(mk)) {
            modelMap.set(mk, { tokens: 0, turns: 0, label: r.modelLabel || getModelLabel(mk) });
        }
        const m = modelMap.get(mk);
        m.tokens += r.tokens;
        m.turns += 1;
    }
    const modelUsage = Array.from(modelMap.entries())
        .map(([key, v]) => ({
            modelType: key,
            modelLabel: v.label,
            tokens: v.tokens,
            turnCount: v.turns,
            share: totalTokens > 0 ? v.tokens / totalTokens : 0
        }))
        .sort((a, b) => b.tokens - a.tokens);
    const mostUsedModel = modelUsage[0] || null;

    // 按天明细（按日期升序，含空桶）
    const dailySummary = [];
    for (let i = rangeDays - 1; i >= 0; i--) {
        const ts = now - i * DAY_MS;
        const date = formatDate(ts);
        const dayData = dailyMap.get(date);
        const dayModels = dayData ? Array.from(dayData.models.entries()).map(([k, v]) => ({
            modelType: k,
            modelLabel: getModelLabel(k),
            tokens: v
        })) : [];
        dailySummary.push({
            date,
            tokens: dayData ? dayData.tokens : 0,
            messages: dayData ? dayData.messages : 0,
            sessions: dayData ? dayData.sessions.size : 0,
            models: dayModels
        });
    }

    // 热力图数据（由旧到新，相对最大值）
    const maxDayTokens = dailySummary.reduce((m, d) => Math.max(m, d.tokens), 0);
    const heatmap = dailySummary.map(d => ({
        day: d.date,
        timestamp: new Date(d.date).getTime(),
        tokens: d.tokens,
        level: calcHeatmapLevel(d.tokens, maxDayTokens)
    }));

    return {
        rangeDays,
        totalTokens,
        sessionCount,
        messageCount: totalMessages,
        turnCount: totalMessages,
        activeDays,
        currentStreak,
        avgTps: Number(avgTps.toFixed(1)),
        serverTokenRecordCount,
        mostUsedModel,
        dailySummary,
        heatmap,
        modelUsage
    };
}

/** 兼容别名 */
export const summarizeUsage = getUsageSummary;

/**
 * 注入统计面板所需的 CSS 样式（仅一次）
 * 增加 7/30 天切换、5 卡片、趋势柱状图、模型占比甜甜圈图
 */
function injectUsageStyle() {
    if (document.getElementById('ds-usage-style')) return;
    const style = document.createElement('style');
    style.id = 'ds-usage-style';
    style.textContent = `
        .ds-usage-panel { padding: 4px 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
        .ds-usage-toolbar {
            display: flex; align-items: center; justify-content: space-between;
            margin-bottom: 12px; gap: 8px;
        }
        .ds-usage-range {
            display: inline-flex; border: 1px solid var(--ds-panel-border, rgba(0,0,0,0.1));
            border-radius: 8px; overflow: hidden;
        }
        .ds-usage-range button {
            border: none; background: transparent; padding: 4px 12px;
            font-size: 12px; cursor: pointer; color: inherit; opacity: 0.7;
            transition: background 0.2s, opacity 0.2s;
        }
        .ds-usage-range button.active {
            background: var(--ds-primary, ${HEATMAP_BASE_COLOR}); color: #fff; opacity: 1;
        }
        .ds-usage-clear-btn {
            font-size: 12px; padding: 4px 10px; border-radius: 6px;
            border: 1px solid rgba(239,68,68,0.3); background: transparent;
            color: #ef4444; cursor: pointer; transition: background 0.2s;
        }
        .ds-usage-clear-btn:hover { background: rgba(239,68,68,0.1); }
        .ds-usage-cards {
            display: grid;
            grid-template-columns: repeat(5, 1fr);
            gap: 8px;
            margin-bottom: 16px;
        }
        .ds-usage-card {
            background: rgba(0,0,0,0.04);
            border-radius: 8px;
            padding: 10px 8px;
            text-align: center;
        }
        .ds-usage-card-label { font-size: 11px; color: #888; margin-bottom: 4px; }
        .ds-usage-card-value { font-size: 15px; font-weight: 600; color: #333; }
        .ds-usage-card-sub { font-size: 10px; color: #aaa; margin-top: 2px; }
        .ds-usage-section-title { font-size: 13px; color: #555; margin: 12px 0 8px; font-weight: 500; }
        .ds-heatmap {
            display: grid;
            grid-template-columns: repeat(15, 1fr);
            gap: 3px;
            --ds-heat-color: ${HEATMAP_BASE_COLOR};
        }
        .ds-heatmap-cell {
            width: 100%;
            aspect-ratio: 1;
            border-radius: 2px;
            background: rgba(0,0,0,0.05);
        }
        .ds-heat-l0 { background: rgba(0,0,0,0.05); }
        .ds-heat-l1 { background: color-mix(in srgb, var(--ds-heat-color) 25%, transparent); }
        .ds-heat-l2 { background: color-mix(in srgb, var(--ds-heat-color) 45%, transparent); }
        .ds-heat-l3 { background: color-mix(in srgb, var(--ds-heat-color) 65%, transparent); }
        .ds-heat-l4 { background: color-mix(in srgb, var(--ds-heat-color) 85%, transparent); }
        .ds-heat-l5 { background: var(--ds-heat-color); }
        .ds-heatmap-legend {
            display: flex; align-items: center; gap: 4px;
            margin-top: 8px; font-size: 11px; color: #888;
        }
        .ds-heatmap-legend .ds-heatmap-cell { width: 12px; aspect-ratio: 1; }
        .ds-usage-trend {
            display: flex; align-items: flex-end; gap: 2px;
            height: 80px; margin-top: 8px;
            border-bottom: 1px solid rgba(0,0,0,0.08);
            padding-bottom: 2px;
        }
        .ds-usage-trend-bar {
            flex: 1; min-width: 4px;
            display: flex; flex-direction: column; justify-content: flex-end;
            cursor: default;
        }
        .ds-usage-trend-bar-seg { width: 100%; min-height: 1px; }
        .ds-usage-trend-labels {
            display: flex; gap: 2px; margin-top: 4px;
            font-size: 10px; color: #aaa;
        }
        .ds-usage-trend-labels span { flex: 1; text-align: center; }
        .ds-usage-model-split {
            display: flex; align-items: center; gap: 12px; margin-top: 8px;
        }
        .ds-usage-donut {
            width: 80px; height: 80px; border-radius: 50%; flex-shrink: 0;
            display: flex; align-items: center; justify-content: center;
            position: relative;
        }
        .ds-usage-donut-inner {
            width: 50px; height: 50px; border-radius: 50%;
            background: var(--ds-card-bg, #fff);
            display: flex; align-items: center; justify-content: center;
            font-size: 10px; font-weight: 600; color: #666; text-align: center;
            line-height: 1.2;
        }
        .ds-usage-model-list { flex: 1; font-size: 11px; }
        .ds-usage-model-row {
            display: flex; align-items: center; gap: 6px; margin-bottom: 4px;
        }
        .ds-usage-model-dot {
            width: 8px; height: 8px; border-radius: 2px; flex-shrink: 0;
        }
        .ds-usage-model-name { flex: 1; color: #555; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .ds-usage-model-share { color: #888; min-width: 36px; text-align: right; }
        body[data-ds-dark-theme] .ds-usage-card { background: rgba(255,255,255,0.06); }
        body[data-ds-dark-theme] .ds-usage-card-label { color: #999; }
        body[data-ds-dark-theme] .ds-usage-card-value { color: #e0e0e0; }
        body[data-ds-dark-theme] .ds-usage-section-title { color: #bbb; }
        body[data-ds-dark-theme] .ds-heat-l0 { background: rgba(255,255,255,0.08); }
        body[data-ds-dark-theme] .ds-usage-donut-inner { background: #1f1f23; color: #ccc; }
        body[data-ds-dark-theme] .ds-usage-model-name { color: #ccc; }
        body[data-ds-dark-theme] .ds-usage-model-share { color: #999; }
        body[data-ds-dark-theme] .ds-usage-trend { border-bottom-color: rgba(255,255,255,0.1); }
        @media (max-width: 540px) {
            .ds-usage-cards { grid-template-columns: repeat(2, 1fr); }
            .ds-heatmap { grid-template-columns: repeat(10, 1fr); }
        }
    `;
    document.head.appendChild(style);
}

/**
 * 构造甜甜圈图的 conic-gradient 字符串
 * 参考 deepseek-pp/UsageSubPage.tsx:320-330 的 buildDonoutGradient
 * @param {Array} modelUsage - 模型用量数组
 * @returns {string}
 */
function buildDonutGradient(modelUsage) {
    if (!modelUsage || modelUsage.length === 0) return 'rgba(0,0,0,0.05)';
    const total = modelUsage.reduce((s, m) => s + m.tokens, 0);
    if (total <= 0) return 'rgba(0,0,0,0.05)';
    let acc = 0;
    const stops = [];
    for (let i = 0; i < modelUsage.length; i++) {
        const pct = (modelUsage[i].tokens / total) * 100;
        const color = MODEL_COLORS[i % MODEL_COLORS.length];
        const start = acc;
        acc += pct;
        stops.push(`${color} ${start}% ${acc}%`);
    }
    return `conic-gradient(${stops.join(', ')})`;
}

/**
 * 渲染使用量统计面板 HTML
 * 包含工具栏（7/30 天切换 + 清除按钮）、5 个统计卡片、热力图、每日趋势柱状图、模型占比甜甜圈图
 * @param {number} [rangeDays=7] - 范围天数（7 或 30）
 * @returns {string} HTML 字符串
 */
export function renderUsagePanel(rangeDays = 7) {
    injectUsageStyle();
    const days = (rangeDays === 7) ? 7 : 30;
    const summary = getUsageSummary(days);

    const heatmapCells = summary.heatmap.map(h =>
        `<div class="ds-heatmap-cell ds-heat-l${h.level}" title="${h.day} · ${formatNumber(h.tokens)} tok"></div>`
    ).join('');

    // 每日趋势柱状图（按模型分色堆叠）
    const maxDayTokens = summary.dailySummary.reduce((m, d) => Math.max(m, d.tokens), 0);
    const trendBars = summary.dailySummary.map(d => {
        const heightPct = maxDayTokens > 0 ? (d.tokens / maxDayTokens) * 100 : 0;
        const segs = (d.models.length > 0 ? d.models : [{ tokens: d.tokens, modelLabel: '' }])
            .map(seg => {
                const segH = d.tokens > 0 ? (seg.tokens / d.tokens) * heightPct : 0;
                const colorIdx = getModelColorIndex(seg.modelType || (seg.modelLabel));
                const color = MODEL_COLORS[colorIdx % MODEL_COLORS.length];
                return `<div class="ds-usage-trend-bar-seg" style="height:${segH}%;background:${color};" title="${seg.modelLabel || 'Unknown'}: ${formatNumber(seg.tokens)} tok"></div>`;
            }).join('');
        return `<div class="ds-usage-trend-bar" style="height:${heightPct}%;" title="${d.date} · ${formatNumber(d.tokens)} tok">${segs}</div>`;
    }).join('');

    // 趋势日期标签（每 N 天显示一次）
    const labelInterval = days === 7 ? 1 : 5;
    const trendLabels = summary.dailySummary.map((d, i) => {
        if (i % labelInterval !== 0 && i !== summary.dailySummary.length - 1) {
            return '<span></span>';
        }
        const dateLabel = d.date.slice(5); // MM-DD
        return `<span>${dateLabel}</span>`;
    }).join('');

    // 模型占比甜甜圈图
    const donutGradient = buildDonutGradient(summary.modelUsage);
    const totalTokensShort = formatNumber(summary.totalTokens);
    const modelRows = summary.modelUsage.slice(0, 5).map((m, i) => {
        const color = MODEL_COLORS[i % MODEL_COLORS.length];
        const sharePct = (m.share * 100).toFixed(1);
        return `
            <div class="ds-usage-model-row">
                <span class="ds-usage-model-dot" style="background:${color};"></span>
                <span class="ds-usage-model-name">${m.modelLabel}</span>
                <span class="ds-usage-model-share">${sharePct}%</span>
            </div>
        `;
    }).join('');

    const mostUsedLabel = summary.mostUsedModel ? summary.mostUsedModel.modelLabel : '—';
    const mostUsedShare = summary.mostUsedModel ? (summary.mostUsedModel.share * 100).toFixed(0) + '%' : '—';
    const serverSamples = `${summary.serverTokenRecordCount}/${summary.messageCount}`;

    return `
        <div class="ds-usage-panel" data-range="${days}">
            <div class="ds-usage-toolbar">
                <div class="ds-usage-range" id="ds-usage-range-switch">
                    <button data-range="7" class="${days === 7 ? 'active' : ''}">7 天</button>
                    <button data-range="30" class="${days === 30 ? 'active' : ''}">30 天</button>
                </div>
                <button class="ds-usage-clear-btn" id="ds-usage-clear-btn">清除记录</button>
            </div>
            <div class="ds-usage-cards">
                <div class="ds-usage-card">
                    <div class="ds-usage-card-label">总 Token</div>
                    <div class="ds-usage-card-value">${formatNumber(summary.totalTokens)}</div>
                    <div class="ds-usage-card-sub">服务端 ${serverSamples}</div>
                </div>
                <div class="ds-usage-card">
                    <div class="ds-usage-card-label">Sessions</div>
                    <div class="ds-usage-card-value">${summary.sessionCount}</div>
                    <div class="ds-usage-card-sub">${summary.turnCount} 轮</div>
                </div>
                <div class="ds-usage-card">
                    <div class="ds-usage-card-label">消息数</div>
                    <div class="ds-usage-card-value">${summary.messageCount}</div>
                    <div class="ds-usage-card-sub">${summary.activeDays} 天活跃</div>
                </div>
                <div class="ds-usage-card">
                    <div class="ds-usage-card-label">连续天数</div>
                    <div class="ds-usage-card-value">${summary.currentStreak}</div>
                    <div class="ds-usage-card-sub">平均 ${summary.avgTps} tps</div>
                </div>
                <div class="ds-usage-card">
                    <div class="ds-usage-card-label">最常用模型</div>
                    <div class="ds-usage-card-value" style="font-size:12px;">${mostUsedLabel}</div>
                    <div class="ds-usage-card-sub">占比 ${mostUsedShare}</div>
                </div>
            </div>
            <div class="ds-usage-section-title">${days} 天活跃热力图</div>
            <div class="ds-heatmap">${heatmapCells}</div>
            <div class="ds-heatmap-legend">
                <span>少</span>
                <div class="ds-heatmap-cell ds-heat-l1"></div>
                <div class="ds-heatmap-cell ds-heat-l2"></div>
                <div class="ds-heatmap-cell ds-heat-l3"></div>
                <div class="ds-heatmap-cell ds-heat-l4"></div>
                <div class="ds-heatmap-cell ds-heat-l5"></div>
                <span>多</span>
            </div>
            <div class="ds-usage-section-title">每日趋势（按模型分色）</div>
            <div class="ds-usage-trend">${trendBars}</div>
            <div class="ds-usage-trend-labels">${trendLabels}</div>
            <div class="ds-usage-section-title">模型占比</div>
            <div class="ds-usage-model-split">
                <div class="ds-usage-donut" style="background:${donutGradient};">
                    <div class="ds-usage-donut-inner">${totalTokensShort}<br>tok</div>
                </div>
                <div class="ds-usage-model-list">${modelRows || '<div style="color:#aaa;font-size:11px;">暂无数据</div>'}</div>
            </div>
        </div>
    `;
}

/**
 * 清除所有使用量记录
 */
export function clearUsageRecords() {
    _cacheRecords = [];
    _cacheDirty = false;
    _writeSignatures.clear();
    try {
        localStorage.removeItem(STORAGE_KEY);
    } catch (e) {}
}

/**
 * 处理 fetch-hub 的 end 事件：记录使用量
 * @param {Object} payload - { tokens, tps, durationMs, model, serverStats, tokenSource, speedSource, chatSessionId, assistantMessageId, route }
 */
function onCompletionEnd(payload) {
    if (!payload || payload.tokens <= 0) return;
    recordUsage(payload);
}

/**
 * 初始化使用量统计
 * 注入面板样式并向 fetch-hub 注册完成事件处理器
 */
export function initUsageStats() {
    if (installed) return;
    installed = true;
    injectUsageStyle();
    // 预热缓存并清理过期记录
    readRecords();
    pruneRecords();
    handlerId = registerCompletionHandler({
        onEnd: onCompletionEnd
    });
}

/**
 * 清理使用量统计模块（对外暴露的可选接口）
 */
export function destroyUsageStats() {
    if (!installed) return;
    installed = false;
    if (handlerId) unregisterCompletionHandler(handlerId);
    handlerId = 0;
    // 确保待写入的数据被 flush
    if (_writeTimer) {
        clearTimeout(_writeTimer);
        _writeTimer = null;
        try {
            pruneRecords();
            if (_cacheRecords) {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(_cacheRecords));
            }
        } catch (e) {}
    }
}
