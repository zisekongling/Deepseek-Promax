/**
 * @file index.js
 * @description 自动化调度器模块入口
 *
 * 职责：
 *   - initAutomation() 幂等初始化
 *   - 注册 window._dsAutomation 全局 API（listTasks / createTask / runTaskNow /
 *     startScheduler / stopScheduler / getRunningTaskId 等）
 *   - 启动 scheduler（若 CONFIG.automationEnabled）
 *   - 初始化侧栏面板（若 CONFIG.automationEnabled）
 *
 * 集成说明（Phase 6 统一集成）：
 *   - 本模块不修改 config.js / settings-panel.js / 主 index.js
 *   - CONFIG.automationEnabled 在 Phase 6 添加到 config.js 的 DEFAULTS（默认 false）
 *   - 当前若 CONFIG.automationEnabled 为 undefined / false，仅注册全局 API，
 *     不启动 scheduler 与面板，确保不影响未启用该功能的用户
 *   - Phase 6 在主 index.js 的 init() 中按需 import 并调用 initAutomation()
 */

import { CONFIG } from '../../config.js';
import {
    listTasks,
    getTask,
    createTask,
    updateTask,
    deleteTask,
    clearHistory
} from './store.js';
import { startScheduler, stopScheduler, rescheduleTask } from './scheduler.js';
import { runTask, runTaskNow, isRunning, getRunningTaskId } from './runner.js';
import { initAutomationPanel, refreshAutomationPanel } from './panel.js';

/** 模块是否已初始化（幂等保护） */
let initialized = false;

/**
 * 初始化自动化模块（幂等）
 *
 * 执行流程：
 *   1. 幂等检查：已初始化则直接返回
 *   2. 注册 window._dsAutomation 全局 API（无论是否启用都暴露，便于外部调试）
 *   3. 若 CONFIG.automationEnabled 为 true：初始化侧栏面板 + 启动 scheduler
 *
 * @returns {void}
 */
export function initAutomation() {
    if (initialized) return;
    initialized = true;

    // 注册全局 API（题目要求的核心 6 个 + 扩展若干）
    if (typeof window !== 'undefined') {
        window._dsAutomation = {
            // 题目要求的 6 个核心 API
            listTasks,
            createTask,
            runTaskNow,
            startScheduler,
            stopScheduler,
            getRunningTaskId,
            // 扩展 API（便于外部调试与集成）
            getTask,
            updateTask,
            deleteTask,
            clearHistory,
            runTask,
            isRunning,
            rescheduleTask,
            refreshPanel: refreshAutomationPanel
        };
    }

    // 若启用自动化，启动 scheduler 与侧栏面板
    // 注意：CONFIG.automationEnabled 在 Phase 6 才加入 config.js，当前可能为 undefined
    if (CONFIG.automationEnabled === true) {
        try {
            initAutomationPanel();
            startScheduler();
        } catch (e) {
            console.warn('[automation] 初始化失败:', e);
        }
    }
}

export default initAutomation;
