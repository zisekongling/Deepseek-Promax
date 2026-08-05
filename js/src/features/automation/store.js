/**
 * @file store.js
 * @description 自动化任务的本地存储管理（CRUD + 运行历史）
 *
 * 存储位置：localStorage key = ds_automation_tasks
 * 任务结构：
 *   {
 *     id, name, prompt, conversationId,
 *     schedule: { type: 'cron'|'rrule', expr },
 *     enabled, lastRun, lastResult, runHistory: [],
 *     createdAt, updatedAt
 *   }
 * 运行历史结构（runHistory 单条）：
 *   { timestamp, ok, durationMs, error?, resultSummary? }
 * 运行历史最多保留 50 条（FIFO 截断）。
 *
 * 创建/更新任务时调用 schedule.js 的 isValidSchedule 做最小间隔 15 分钟硬约束校验。
 */

import { isValidSchedule } from './schedule.js';

/** localStorage 存储键 */
const STORAGE_KEY = 'ds_automation_tasks';

/** 运行历史最大保留条数 */
const MAX_HISTORY = 50;

/**
 * 从 localStorage 加载全部任务
 * @returns {Array<object>}
 */
function loadAll() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return [];
        const arr = JSON.parse(raw);
        return Array.isArray(arr) ? arr : [];
    } catch {
        return [];
    }
}

/**
 * 保存全部任务到 localStorage
 * @param {Array<object>} tasks
 */
function saveAll(tasks) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
    } catch (e) {
        console.warn('[automation/store] 保存失败:', e);
    }
}

/**
 * 生成任务 ID（时间戳 base36 + 随机后缀）
 * @returns {string}
 */
function genId() {
    return 'a_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

/**
 * 列出全部任务
 * @returns {Array<object>}
 */
export function listTasks() {
    return loadAll();
}

/**
 * 按 ID 获取单个任务
 * @param {string} id - 任务 ID
 * @returns {object|null}
 */
export function getTask(id) {
    return loadAll().find(t => t.id === id) || null;
}

/**
 * 创建任务
 * @param {object} data - 任务数据
 * @param {string} data.name - 任务名称
 * @param {string} data.prompt - 发送给 DeepSeek 的 prompt
 * @param {string} [data.conversationId] - DeepSeek 会话 ID（chat_session_id）
 * @param {{ type: 'cron'|'rrule', expr: string }} data.schedule - 调度配置
 * @param {boolean} [data.enabled=true] - 是否启用
 * @returns {{ ok: true, task: object } | { ok: false, error: { code: string, message: string } }}
 */
export function createTask(data) {
    const schedCheck = isValidSchedule(data && data.schedule);
    if (!schedCheck.ok) return schedCheck;
    const now = Date.now();
    const task = {
        id: genId(),
        name: String(data.name || '').trim() || '未命名任务',
        prompt: String(data.prompt || ''),
        conversationId: data.conversationId ? String(data.conversationId) : null,
        schedule: {
            type: data.schedule.type,
            expr: String(data.schedule.expr).trim()
        },
        enabled: data.enabled !== false,
        lastRun: null,
        lastResult: null,
        runHistory: [],
        createdAt: now,
        updatedAt: now
    };
    const tasks = loadAll();
    tasks.push(task);
    saveAll(tasks);
    return { ok: true, task };
}

/**
 * 更新任务（局部 patch 覆盖）
 * @param {string} id - 任务 ID
 * @param {object} patch - 待覆盖的字段
 * @returns {{ ok: true, task: object } | { ok: false, error: { code: string, message: string } }}
 */
export function updateTask(id, patch) {
    const tasks = loadAll();
    const idx = tasks.findIndex(t => t.id === id);
    if (idx < 0) return { ok: false, error: { code: 'not_found', message: '任务不存在' } };
    if (patch.schedule) {
        const schedCheck = isValidSchedule(patch.schedule);
        if (!schedCheck.ok) return schedCheck;
    }
    const old = tasks[idx];
    const next = {
        ...old,
        ...patch,
        schedule: patch.schedule
            ? { type: patch.schedule.type, expr: String(patch.schedule.expr).trim() }
            : old.schedule,
        updatedAt: Date.now()
    };
    tasks[idx] = next;
    saveAll(tasks);
    return { ok: true, task: next };
}

/**
 * 删除任务
 * @param {string} id - 任务 ID
 * @returns {{ ok: true } | { ok: false, error: { code: string, message: string } }}
 */
export function deleteTask(id) {
    const tasks = loadAll();
    const idx = tasks.findIndex(t => t.id === id);
    if (idx < 0) return { ok: false, error: { code: 'not_found', message: '任务不存在' } };
    tasks.splice(idx, 1);
    saveAll(tasks);
    return { ok: true };
}

/**
 * 记录一次运行结果到运行历史
 * @param {string} id - 任务 ID
 * @param {{ ok: boolean, durationMs?: number, error?: string, resultSummary?: string }} result - 运行结果
 * @returns {{ ok: true, task: object } | { ok: false, error: { code: string, message: string } }}
 */
export function recordRun(id, result) {
    const tasks = loadAll();
    const idx = tasks.findIndex(t => t.id === id);
    if (idx < 0) return { ok: false, error: { code: 'not_found', message: '任务不存在' } };
    const entry = {
        timestamp: Date.now(),
        ok: !!result.ok,
        durationMs: result.durationMs || 0,
        error: result.error || null,
        resultSummary: result.resultSummary || null
    };
    const task = tasks[idx];
    task.runHistory = task.runHistory || [];
    task.runHistory.push(entry);
    // FIFO 截断，最多保留 MAX_HISTORY 条
    if (task.runHistory.length > MAX_HISTORY) {
        task.runHistory = task.runHistory.slice(-MAX_HISTORY);
    }
    task.lastRun = entry.timestamp;
    task.lastResult = { ok: entry.ok, error: entry.error, resultSummary: entry.resultSummary };
    task.updatedAt = entry.timestamp;
    tasks[idx] = task;
    saveAll(tasks);
    return { ok: true, task };
}

/**
 * 清空指定任务的运行历史
 * @param {string} id - 任务 ID
 * @returns {{ ok: true } | { ok: false, error: { code: string, message: string } }}
 */
export function clearHistory(id) {
    const tasks = loadAll();
    const idx = tasks.findIndex(t => t.id === id);
    if (idx < 0) return { ok: false, error: { code: 'not_found', message: '任务不存在' } };
    tasks[idx].runHistory = [];
    tasks[idx].updatedAt = Date.now();
    saveAll(tasks);
    return { ok: true };
}
