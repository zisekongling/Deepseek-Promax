/**
 * Usage 模块统计聚合函数（移植自 deepseek-pp/core/usage/stats.ts）
 *
 * 纯函数模块，无 IO 依赖，完全可移植。
 * 提供：
 *   - toLocalDayKey: 时间戳转 'YYYY-MM-DD' 本地时区
 *   - dayKeyToTimestamp: 'YYYY-MM-DD' 转时间戳
 *   - getUsageModelKey/getUsageModelLabel: 模型归一化
 *   - summarizeUsage: 聚合统计（按日/模型分桶 + 热力图 + 连续天数）
 */

import {
    USAGE_RANGE_DAYS_7,
    USAGE_RANGE_DAYS_30,
    TOKEN_METRIC_SOURCE_SERVER
} from './types.js';

// ============================================================
// 日期工具
// ============================================================

/**
 * 时间戳转本地时区 'YYYY-MM-DD'
 * @param {number} timestamp
 * @returns {string}
 */
export function toLocalDayKey(timestamp) {
    const d = new Date(timestamp);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

/**
 * 'YYYY-MM-DD' 转本地时区当日 00:00 的时间戳
 * @param {string} day
 * @returns {number}
 */
export function dayKeyToTimestamp(day) {
    const [y, m, d] = day.split('-').map(Number);
    return new Date(y, m - 1, d).getTime();
}

/**
 * 校验 day key 是否为合法日历日（含闰年）
 * @param {string} day
 * @returns {boolean}
 */
export function isValidDayKey(day) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
    const [y, m, d] = day.split('-').map(Number);
    if (m < 1 || m > 12) return false;
    const daysInMonth = [31, (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28,
        31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return d >= 1 && d <= daysInMonth[m - 1];
}

// ============================================================
// 模型归一化
// ============================================================

/**
 * 模型 key 归一化（小写化，空则 'deepseek-default'）
 * @param {string|null|undefined} modelType
 * @returns {string}
 */
export function getUsageModelKey(modelType) {
    if (!modelType || typeof modelType !== 'string') return 'deepseek-default';
    return modelType.toLowerCase();
}

/**
 * 模型显示标签
 * @param {string|null|undefined} modelType
 * @returns {string}
 */
export function getUsageModelLabel(modelType) {
    const key = getUsageModelKey(modelType);
    if (key.includes('reasoner')) return 'DeepSeek Reasoner';
    if (key.includes('expert')) return 'DeepSeek Expert';
    if (key.includes('vision')) return 'DeepSeek Vision';
    if (key === 'deepseek-default') return 'DeepSeek Chat';
    return modelType || 'DeepSeek Chat';
}

// ============================================================
// 范围归一化
// ============================================================

/**
 * 归一化统计范围天数
 * @param {unknown} value
 * @returns {number} 7 或 30
 */
export function normalizeUsageRangeDays(value) {
    return value === 30 ? 30 : 7;
}

// ============================================================
// 核心聚合
// ============================================================

/**
 * 聚合统计用量记录
 *
 * @param {import('./types.js').UsageTurnRecord[]} records - 全部记录
 * @param {Object} options
 * @param {number} options.rangeDays - 统计范围（7 或 30）
 * @param {number} [options.now=Date.now()] - 当前时间戳（测试可注入）
 * @returns {import('./types.js').UsageSummary}
 */
export function summarizeUsage(records, options) {
    const { rangeDays, now = Date.now() } = options;
    const rangeDays_ = normalizeUsageRangeDays(rangeDays);
    const todayKey = toLocalDayKey(now);
    const todayTs = dayKeyToTimestamp(todayKey);
    const rangeStartTs = todayTs - (rangeDays_ - 1) * 86400000;

    // 过滤范围内的记录
    const inRange = records.filter(r => r.recordedAt >= rangeStartTs);

    // 按日分桶
    const dayMap = new Map();
    for (const r of inRange) {
        if (!dayMap.has(r.day)) {
            dayMap.set(r.day, { totalTokens: 0, turnCount: 0, messageCount: 0 });
        }
        const bucket = dayMap.get(r.day);
        bucket.totalTokens += r.totalTokens;
        bucket.turnCount += 1;
        bucket.messageCount += r.messageCount;
    }

    // 构建日序列（从最早到今天）
    const days = [];
    for (let ts = rangeStartTs; ts <= todayTs; ts += 86400000) {
        const day = toLocalDayKey(ts);
        const bucket = dayMap.get(day) || { totalTokens: 0, turnCount: 0, messageCount: 0 };
        days.push({ day, ...bucket });
    }

    // 计算热力图 level（0-5，按当日 tokens 占比映射）
    const maxDayTokens = Math.max(1, ...days.map(d => d.totalTokens));
    const heatmap = days.map(d => ({
        day: d.day,
        level: d.totalTokens === 0 ? 0 : Math.min(5, Math.ceil((d.totalTokens / maxDayTokens) * 5)),
        totalTokens: d.totalTokens
    }));

    // 按模型分桶
    const modelMap = new Map();
    for (const r of inRange) {
        const key = getUsageModelKey(r.modelType);
        if (!modelMap.has(key)) {
            modelMap.set(key, { modelKey: key, modelLabel: getUsageModelLabel(r.modelType), totalTokens: 0, turnCount: 0 });
        }
        const bucket = modelMap.get(key);
        bucket.totalTokens += r.totalTokens;
        bucket.turnCount += 1;
    }
    const totalTokensAll = inRange.reduce((s, r) => s + r.totalTokens, 0);
    const modelUsage = Array.from(modelMap.values())
        .map(m => ({ ...m, share: totalTokensAll > 0 ? m.totalTokens / totalTokensAll : 0 }))
        .sort((a, b) => b.totalTokens - a.totalTokens);

    // 连续活跃天数（从今天起往前数）
    let currentStreak = 0;
    for (let i = days.length - 1; i >= 0; i--) {
        if (days[i].totalTokens > 0) currentStreak++;
        else break;
    }

    // 活跃天数
    const activeDays = days.filter(d => d.totalTokens > 0).length;

    // 会话数（去重 chatSessionId）
    const sessionSet = new Set();
    for (const r of inRange) {
        if (r.chatSessionId) sessionSet.add(r.chatSessionId);
    }

    // 服务端精确记录数
    const serverTokenRecordCount = inRange.filter(r => r.tokenSource === TOKEN_METRIC_SOURCE_SERVER).length;

    // 最常用模型
    const mostUsedModel = modelUsage.length > 0 ? modelUsage[0] : null;

    return {
        totalTokens: totalTokensAll,
        sessionCount: sessionSet.size,
        messageCount: inRange.reduce((s, r) => s + r.messageCount, 0),
        turnCount: inRange.length,
        activeDays,
        currentStreak,
        serverTokenRecordCount,
        mostUsedModel,
        days,
        heatmap,
        modelUsage
    };
}
