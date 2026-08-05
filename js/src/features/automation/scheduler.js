/**
 * @file scheduler.js
 * @description 页面级自动化调度器（基于 setTimeout，单例）
 *
 * 特性：
 *   - 单例模式：startScheduler / stopScheduler 幂等
 *   - 页面打开时生效：遍历所有 enabled 任务，为每个计算 nextRun 并 setTimeout
 *   - 页面关闭行为：setTimeout 自然失效，不补跑；页面重新打开后 startScheduler
 *     重新计算（getNextRun 基于 now 返回未来的运行，自动跳过过去的错过的运行）
 *   - visibilitychange 监听：页面隐藏时暂停（清除所有 timer，省电），
 *     可见时恢复并重新调度所有任务
 *   - rescheduleTask(id)：任务更新后重新计算
 *
 * setTimeout 上限处理：浏览器 setTimeout 最大延迟约 2^31-1 ms（约 24.8 天），
 * 超出会立即触发。本调度器对 delay > 24 天的情况做分片（先等 24 天再重新计算），
 * 避免立即误触发。cron 的前瞻上限为 370 天，RRULE 不限；远期任务通过分片逐步逼近。
 *
 * 参考：deepseek-pp/core/automation/scheduler.ts（service-worker 版本），
 *   本实现为页面级简化版，去掉持久化 lease / claim / reconcile 逻辑。
 */

import { listTasks, getTask } from './store.js';
import { parseCron, parseRRule, getNextRun } from './schedule.js';
import { runTask } from './runner.js';

/** setTimeout 安全延迟上限（2^31-1 ms，约 24.8 天），留 1 秒余量 */
const MAX_SAFE_TIMEOUT_MS = 2147483000;

/** 长延迟分片时的重计算提前量（到期前 5 秒重新计算，避免边界抖动） */
const RECALC_LEAD_MS = 5000;

/** 单例状态 */
const _state = {
    /** 调度器是否启动 */
    running: false,
    /** taskId -> setTimeout 句柄 */
    timers: new Map(),
    /** visibilitychange 事件处理器引用（用于移除监听） */
    visibilityHandler: null
};

/**
 * 解析任务调度并返回下次运行时间
 * @param {object} task - 任务对象
 * @returns {Date|null} 下次运行时间，无有效调度返回 null
 */
function computeNextRun(task) {
    if (!task.enabled || !task.schedule) return null;
    const sched = task.schedule;
    const parsed = sched.type === 'cron' ? parseCron(sched.expr) : parseRRule(sched.expr);
    if (!parsed.ok) return null;
    return getNextRun(parsed.schedule, new Date());
}

/**
 * 为单个任务调度 setTimeout
 * @param {object} task - 任务对象
 */
function scheduleTask(task) {
    // 清除该任务旧的 timer
    const old = _state.timers.get(task.id);
    if (old) clearTimeout(old);
    _state.timers.delete(task.id);

    if (!task.enabled) return;
    const nextRun = computeNextRun(task);
    if (!nextRun) return;
    const delay = nextRun.getTime() - Date.now();
    if (delay < 0) return; // 已过去，跳过（不补跑）

    if (delay > MAX_SAFE_TIMEOUT_MS) {
        // 超出 setTimeout 上限：先等安全时长，到期前重新计算（分片逼近）
        const timerId = setTimeout(() => {
            _state.timers.delete(task.id);
            if (!_state.running) return;
            const latest = getTask(task.id);
            if (latest && latest.enabled) scheduleTask(latest);
        }, MAX_SAFE_TIMEOUT_MS - RECALC_LEAD_MS);
        _state.timers.set(task.id, timerId);
        return;
    }

    const timerId = setTimeout(() => {
        _state.timers.delete(task.id);
        if (!_state.running) return;
        // 触发运行；运行完成后重新调度下一次
        runTask(task.id)
            .catch(() => {})
            .finally(() => {
                if (_state.running) {
                    const latest = getTask(task.id);
                    if (latest && latest.enabled) scheduleTask(latest);
                }
            });
    }, delay);
    _state.timers.set(task.id, timerId);
}

/**
 * 按 ID 重新调度任务（任务更新 / 启用 / 禁用后调用）
 * @param {string} id - 任务 ID
 */
export function rescheduleTask(id) {
    if (!_state.running) return;
    const old = _state.timers.get(id);
    if (old) { clearTimeout(old); _state.timers.delete(id); }
    const task = getTask(id);
    if (task && task.enabled) scheduleTask(task);
}

/**
 * 启动调度器（单例，幂等）
 * 遍历所有 enabled 任务，为每个计算 nextRun 并 setTimeout
 */
export function startScheduler() {
    if (_state.running) return;
    _state.running = true;

    // 注册 visibilitychange 监听：隐藏暂停，可见恢复
    _state.visibilityHandler = () => {
        if (document.hidden) {
            // 暂停：清除所有 timer（不触发运行）
            for (const tid of _state.timers.values()) clearTimeout(tid);
            _state.timers.clear();
        } else if (_state.running) {
            // 恢复：重新调度所有 enabled 任务
            for (const task of listTasks()) {
                if (task.enabled) scheduleTask(task);
            }
        }
    };
    document.addEventListener('visibilitychange', _state.visibilityHandler);

    // 初始调度所有 enabled 任务
    for (const task of listTasks()) {
        if (task.enabled) scheduleTask(task);
    }
}

/**
 * 停止调度器（清除所有 timeout，移除 visibilitychange 监听）
 */
export function stopScheduler() {
    _state.running = false;
    for (const tid of _state.timers.values()) clearTimeout(tid);
    _state.timers.clear();
    if (_state.visibilityHandler) {
        document.removeEventListener('visibilitychange', _state.visibilityHandler);
        _state.visibilityHandler = null;
    }
}
