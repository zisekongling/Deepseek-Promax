/**
 * Usage 模块存储层（移植自 deepseek-pp/core/usage/store.ts）
 *
 * 提供 token 用量记录的持久化与查询能力。
 * 使用 coalescing-mutation-queue 合并高频写入（每条消息都记录用量）。
 *
 * 存储：
 *   key: deepseek_pp_usage_turns_v1
 *   value: UsageTurnRecord[]（纯数组，无信封）
 *
 * 自动裁剪：
 *   - 超过 MAX_RECORDS（5000）条时删除最旧的
 *   - 超过 RETENTION_DAYS（180 天）的记录自动删除
 *
 * 合并策略（相同 id）：
 *   - server 优先于 estimated
 *   - 否则取 recordedAt 较新的
 */

import { createCoalescingMutationQueue } from '../../persistence/coalescing-mutation-queue.js';
import { createSerialOperationQueue } from '../../persistence/serial-operation-queue.js';
import { toLocalDayKey, isValidDayKey, summarizeUsage, normalizeUsageRangeDays } from './stats.js';
import {
    USAGE_SOURCE_DEEPSEEK_WEB,
    TOKEN_METRIC_SOURCE_SERVER,
    TOKEN_METRIC_SOURCE_ESTIMATED,
    MAX_RECORDS,
    RETENTION_DAYS
} from './types.js';

/** localStorage 键名 */
export const USAGE_STORAGE_KEY = 'deepseek_pp_usage_turns_v1';

/** 串行队列（保证读-改-写原子性） */
const queue = createSerialOperationQueue();

// ============================================================
// 编解码
// ============================================================

/**
 * 校验并解码单条记录
 * @param {unknown} value
 * @param {string} path
 * @returns {import('./types.js').UsageTurnRecord}
 */
function decodeUsageRecord(value, path) {
    if (!value || typeof value !== 'object') {
        throw new Error(`[usage] ${path}: expected object`);
    }
    const r = /** @type {any} */ (value);
    if (typeof r.id !== 'string' || !r.id) {
        throw new Error(`[usage] ${path}.id: expected non-empty string`);
    }
    if (typeof r.recordedAt !== 'number' || !Number.isFinite(r.recordedAt)) {
        throw new Error(`[usage] ${path}.recordedAt: expected finite number`);
    }
    if (typeof r.day !== 'string' || !isValidDayKey(r.day)) {
        throw new Error(`[usage] ${path}.day: expected valid YYYY-MM-DD, got ${r.day}`);
    }
    if (typeof r.source !== 'string') {
        throw new Error(`[usage] ${path}.source: expected string`);
    }
    if (r.chatSessionId !== null && typeof r.chatSessionId !== 'string') {
        throw new Error(`[usage] ${path}.chatSessionId: expected string or null`);
    }
    if (r.assistantMessageId !== null && typeof r.assistantMessageId !== 'number') {
        throw new Error(`[usage] ${path}.assistantMessageId: expected number or null`);
    }
    if (r.modelType !== null && typeof r.modelType !== 'string') {
        throw new Error(`[usage] ${path}.modelType: expected string or null`);
    }
    if (typeof r.totalTokens !== 'number' || !Number.isFinite(r.totalTokens)) {
        throw new Error(`[usage] ${path}.totalTokens: expected finite number`);
    }
    if (r.tokenSource !== TOKEN_METRIC_SOURCE_SERVER && r.tokenSource !== TOKEN_METRIC_SOURCE_ESTIMATED) {
        throw new Error(`[usage] ${path}.tokenSource: expected 'server' or 'estimated'`);
    }
    if (typeof r.tps !== 'number' || !Number.isFinite(r.tps)) {
        throw new Error(`[usage] ${path}.tps: expected finite number`);
    }
    if (r.speedSource !== TOKEN_METRIC_SOURCE_SERVER && r.speedSource !== TOKEN_METRIC_SOURCE_ESTIMATED) {
        throw new Error(`[usage] ${path}.speedSource: expected 'server' or 'estimated'`);
    }
    if (typeof r.elapsedMs !== 'number' || !Number.isFinite(r.elapsedMs)) {
        throw new Error(`[usage] ${path}.elapsedMs: expected finite number`);
    }
    if (typeof r.messageCount !== 'number' || !Number.isFinite(r.messageCount)) {
        throw new Error(`[usage] ${path}.messageCount: expected finite number`);
    }
    return { ...r };
}

/**
 * 校验并解码记录数组
 * @param {unknown} value
 * @param {string} path
 * @returns {import('./types.js').UsageTurnRecord[]}
 */
function decodeUsageRecords(value, path) {
    if (!Array.isArray(value)) {
        throw new Error(`[usage] ${path}: expected array`);
    }
    return value.map((v, i) => decodeUsageRecord(v, `${path}[${i}]`));
}

// ============================================================
// 底层读写（已加锁）
// ============================================================

/**
 * 读取全部记录（不加锁，供已加锁路径调用）
 * @returns {import('./types.js').UsageTurnRecord[]}
 */
function readUsageRecordsAlreadyOwned() {
    const raw = localStorage.getItem(USAGE_STORAGE_KEY);
    if (raw === null) return [];
    try {
        return decodeUsageRecords(JSON.parse(raw), 'usage');
    } catch (e) {
        console.warn('[usage] readUsageRecords decode failed:', e);
        return [];
    }
}

/**
 * 写入记录数组（不加锁）
 * @param {import('./types.js').UsageTurnRecord[]} records
 */
function saveUsageRecordsAlreadyOwned(records) {
    localStorage.setItem(USAGE_STORAGE_KEY, JSON.stringify(records));
}

// ============================================================
// 合并策略
// ============================================================

/**
 * 合并两条相同 id 的记录
 *
 * 规则：
 *   - server 优先于 estimated（无论 recordedAt）
 *   - 否则取 recordedAt 较新的
 *
 * @param {import('./types.js').UsageTurnRecord} a
 * @param {import('./types.js').UsageTurnRecord} b
 * @returns {import('./types.js').UsageTurnRecord}
 */
function mergeUsageRecord(a, b) {
    if (a.tokenSource === TOKEN_METRIC_SOURCE_SERVER && b.tokenSource !== TOKEN_METRIC_SOURCE_SERVER) {
        return a;
    }
    if (b.tokenSource === TOKEN_METRIC_SOURCE_SERVER && a.tokenSource !== TOKEN_METRIC_SOURCE_SERVER) {
        return b;
    }
    return b.recordedAt >= a.recordedAt ? b : a;
}

// ============================================================
// 裁剪
// ============================================================

/**
 * 裁剪记录：超过 MAX_RECORDS 删最旧；超过 RETENTION_DAYS 删过期
 * @param {import('./types.js').UsageTurnRecord[]} records
 * @returns {import('./types.js').UsageTurnRecord[]}
 */
function trimRecords(records) {
    const now = Date.now();
    const retentionMs = RETENTION_DAYS * 86400000;
    // 先按时间过滤
    let result = records.filter(r => now - r.recordedAt < retentionMs);
    // 再按数量裁剪（保留最新的 MAX_RECORDS 条）
    if (result.length > MAX_RECORDS) {
        result = result
            .slice()
            .sort((a, b) => b.recordedAt - a.recordedAt)
            .slice(0, MAX_RECORDS);
    }
    return result;
}

// ============================================================
// 对外 API
// ============================================================

/** 合并变更队列（高频写入合并） */
const mutationQueue = createCoalescingMutationQueue(async (records) => {
    saveUsageRecordsAlreadyOwned(records);
});

/**
 * 记录一次用量（合并写入）
 *
 * @param {import('./types.js').UsageTurnInput} input - 用量输入
 * @returns {Promise<import('./types.js').UsageTurnRecord>} 标准化后的记录
 */
export async function recordUsageTurn(input) {
    return queue.run(async () => {
        const records = readUsageRecordsAlreadyOwned();
        const now = Date.now();

        // 标准化为 record
        const recordedAt = input.recordedAt ?? now;
        const record = {
            id: input.id,
            recordedAt,
            day: toLocalDayKey(recordedAt),
            source: input.source || USAGE_SOURCE_DEEPSEEK_WEB,
            chatSessionId: input.chatSessionId ?? null,
            assistantMessageId: input.assistantMessageId ?? null,
            modelType: input.modelType ?? null,
            totalTokens: input.totalTokens,
            tokenSource: input.tokenSource,
            tps: input.tps || 0,
            speedSource: input.speedSource,
            elapsedMs: input.elapsedMs || 0,
            messageCount: input.messageCount ?? 2
        };

        // 合并相同 id 的记录
        const idx = records.findIndex(r => r.id === record.id);
        if (idx >= 0) {
            records[idx] = mergeUsageRecord(records[idx], record);
        } else {
            records.push(record);
        }

        // 裁剪
        const trimmed = trimRecords(records);

        // 通过合并队列写入（高频写入合并为一次实际 I/O）
        await mutationQueue.mutate(trimmed);

        return record;
    });
}

/**
 * 获取用量统计汇总
 * @param {unknown} rangeDaysInput - 范围天数（7 或 30）
 * @returns {Promise<import('./types.js').UsageSummary>}
 */
export async function getUsageSummary(rangeDaysInput) {
    return queue.run(async () => {
        const records = readUsageRecordsAlreadyOwned();
        return summarizeUsage(records, {
            rangeDays: normalizeUsageRangeDays(rangeDaysInput),
            now: Date.now()
        });
    });
}

/**
 * 获取全部记录（原始数据，供调试/导出用）
 * @returns {Promise<import('./types.js').UsageTurnRecord[]>}
 */
export async function getUsageRecords() {
    return queue.run(async () => readUsageRecordsAlreadyOwned().slice());
}

/**
 * 清空全部记录
 * @returns {Promise<void>}
 */
export async function clearUsageRecords() {
    return queue.run(async () => {
        localStorage.removeItem(USAGE_STORAGE_KEY);
    });
}
