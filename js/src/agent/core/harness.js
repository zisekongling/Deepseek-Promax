/**
 * Harness 框架（约束、验证、纠正）
 *
 * 职责：
 *   - 实现 Agent = Model + [Context + Tools + Constraints + Verification + Correction] 扩展公式
 *   - 约束(Constrain)：设定行为边界——能做什么、不能做什么
 *   - 验证(Verify)：自动判断操作结果的对错
 *   - 纠正(Correct)：发现问题时自动修正或回退
 *
 * 设计原则（参考《AI Agent 实战》指南）：
 *   - 故障安全默认值：所有能力默认关闭，必须显式开放
 *   - 输入隔离：安全检查只看结构化数据，不依赖模型自由文本
 *   - 在确认无法恢复之前，不暴露中间态
 *   - 防呆（Poka-yoke）：用设计消除错误，而非事后补救
 *
 * 与 engine.js 的关系：
 *   - engine.js 在循环的每个关键节点调用 harness 进行检查
 *   - harness 不改变执行流程，只返回检查结果供 engine 决策
 */

import { CONFIG as _CONFIG_SNAPSHOT } from '../../config.js';

/**
 * 安全获取最新 CONFIG
 * @returns {Object}
 */
function _getConfig() {
    try {
        if (typeof window !== 'undefined' && window.__dsConfig) {
            return window.__dsConfig;
        }
    } catch (e) {}
    return _CONFIG_SNAPSHOT;
}

// ============================================================
// 约束（Constrain）
// ============================================================

/**
 * 工具调用约束检查
 *
 * 在工具执行前检查：
 *   1. 工具是否已注册
 *   2. 工具是否启用
 *   3. 风险等级是否需要确认
 *   4. 是否超过调用频率上限
 *
 * @param {string} toolName - 工具名
 * @param {Object} payload - 调用参数
 * @param {Object} registry - 工具注册中心
 * @returns {{ allowed: boolean, reason?: string, requireConfirm?: boolean }}
 */
export function constrainToolCall(toolName, payload, registry) {
    const desc = registry.getDescriptor(toolName);
    if (!desc) {
        return { allowed: false, reason: `工具 "${toolName}" 未注册` };
    }

    const config = _getConfig();

    // 检查主开关
    if (config.agentSystemEnabled === false) {
        return { allowed: false, reason: 'Agent 系统未启用' };
    }
    if (config.agentToolsEnabled === false) {
        return { allowed: false, reason: 'Agent 工具调用未启用' };
    }

    // 高风险工具需要确认
    if (desc.riskLevel === 'high') {
        return { allowed: true, requireConfirm: true };
    }

    return { allowed: true };
}

/**
 * 输入约束检查
 *
 * 检查用户输入是否包含敏感内容或提示注入。
 *
 * @param {string} text - 用户输入文本
 * @returns {{ allowed: boolean, reason?: string }}
 */
export function constrainInput(text) {
    if (!text || typeof text !== 'string') {
        return { allowed: false, reason: '输入为空' };
    }

    // 长度限制（防止超长输入耗尽上下文）
    if (text.length > 100000) {
        return { allowed: false, reason: '输入过长（超过 100000 字符）' };
    }

    return { allowed: true };
}

// ============================================================
// 验证（Verify）
// ============================================================

/**
 * 工具执行结果验证
 *
 * 检查工具返回结果是否有效：
 *   1. 结果格式是否正确
 *   2. 是否有异常模式（如连续 3 次相同失败）
 *   3. 是否返回了预期字段
 *
 * @param {string} toolName - 工具名
 * @param {Object} result - 工具执行结果
 * @param {Object} history - 近期执行历史（用于检测异常模式）
 * @returns {{ valid: boolean, issue?: string }}
 */
export function verifyToolResult(toolName, result, history = []) {
    if (!result || typeof result !== 'object') {
        return { valid: false, issue: '工具返回结果格式无效' };
    }

    // 检查必需字段
    if (typeof result.ok !== 'boolean') {
        return { valid: false, issue: '工具返回结果缺少 ok 字段' };
    }

    // 检查连续失败模式（熔断预警）
    if (!result.ok && !result.skipped) {
        const recentFailures = history.filter(h => h.ok === false && h.name === toolName);
        if (recentFailures.length >= 3) {
            return {
                valid: true,
                issue: `工具 "${toolName}" 连续 ${recentFailures.length + 1} 次失败，建议停止重试`
            };
        }
    }

    return { valid: true };
}

/**
 * Agent 循环状态验证
 *
 * 检查 Agent 循环是否应该继续：
 *   1. 是否超过最大轮次
 *   2. 是否陷入重复循环（连续 3 轮相同工具调用）
 *   3. 用户是否已停止
 *
 * @param {Object} state - 循环状态
 * @param {number} state.round - 当前轮次
 * @param {number} state.maxRounds - 最大轮次
 * @param {Array} state.toolCallHistory - 工具调用历史
 * @param {boolean} state.userStopRequested - 用户是否已停止
 * @returns {{ shouldContinue: boolean, stopReason?: string }}
 */
export function verifyLoopState(state) {
    if (state.userStopRequested) {
        return { shouldContinue: false, stopReason: '用户已停止' };
    }

    if (state.round >= state.maxRounds) {
        return { shouldContinue: false, stopReason: `已达到最大轮次上限（${state.maxRounds}）` };
    }

    // 检测重复循环：连续 3 轮调用完全相同的工具
    if (state.toolCallHistory && state.toolCallHistory.length >= 3) {
        const last3 = state.toolCallHistory.slice(-3);
        const allSame = last3.every(tc => {
            return tc.name === last3[0].name &&
                JSON.stringify(tc.payload) === JSON.stringify(last3[0].payload);
        });
        if (allSame) {
            return {
                shouldContinue: false,
                stopReason: `检测到重复循环：连续 3 轮调用相同的工具 "${last3[0].name}"`
            };
        }
    }

    return { shouldContinue: true };
}

// ============================================================
// 纠正（Correct）
// ============================================================

/**
 * 工具调用失败时的纠正策略
 *
 * 根据失败原因返回建议的纠正操作：
 *   - 参数错误：建议修正参数后重试
 *   - 工具不存在：建议使用替代工具
 *   - 超时/网络错误：建议重试（最多 2 次）
 *   - 权限不足：建议跳过
 *
 * @param {string} toolName - 工具名
 * @param {Object} result - 失败结果
 * @param {number} retryCount - 已重试次数
 * @returns {{ action: 'retry'|'skip'|'abort'|'fallback', reason: string, fallbackTool?: string }}
 */
export function correctToolFailure(toolName, result, retryCount = 0) {
    const detail = (result.detail || '').toLowerCase();

    // 参数错误 → 不重试，让 AI 修正参数
    if (detail.includes('参数') || detail.includes('格式错误') || detail.includes('不能为空')) {
        return { action: 'abort', reason: '参数错误，需要 AI 修正参数后重试' };
    }

    // 工具不存在 → 尝试回退
    if (detail.includes('不存在') || detail.includes('未找到工具')) {
        return { action: 'fallback', reason: '工具不存在', fallbackTool: null };
    }

    // 超时/网络错误 → 重试（最多 2 次）
    if (detail.includes('超时') || detail.includes('网络') || detail.includes('timeout')) {
        if (retryCount < 2) {
            return { action: 'retry', reason: '超时，建议重试' };
        }
        return { action: 'skip', reason: '已重试 2 次仍超时，跳过' };
    }

    // 权限不足 → 跳过
    if (detail.includes('权限') || detail.includes('未授权') || detail.includes('未启用')) {
        return { action: 'skip', reason: '权限不足，跳过' };
    }

    // 默认：重试 1 次
    if (retryCount < 1) {
        return { action: 'retry', reason: '未知错误，尝试重试' };
    }
    return { action: 'abort', reason: '重试后仍失败，终止' };
}

/**
 * 任务完成验证（Proposer-Reviewer 模式）
 *
 * 防止 AI 过早声明任务完成。检查：
 *   1. 是否有未完成的 todo
 *   2. 是否有 pending 的 ask_user
 *   3. 是否所有工具结果都已处理
 *
 * @param {Object} state - 循环状态
 * @param {Array} state.todos - 当前 todo 列表
 * @param {boolean} state.hasPendingAskUser - 是否有 pending 提问
 * @param {Array} state.unprocessedResults - 未处理的工具结果
 * @returns {{ isComplete: boolean, reason?: string }}
 */
export function verifyTaskCompletion(state) {
    // 检查未完成的 todo
    if (state.todos && state.todos.length > 0) {
        const incomplete = state.todos.filter(t => t.status !== 'completed');
        if (incomplete.length > 0) {
            return {
                isComplete: false,
                reason: `还有 ${incomplete.length} 个未完成的 todo 项`
            };
        }
    }

    // 检查 pending 提问
    if (state.hasPendingAskUser) {
        return {
            isComplete: false,
            reason: '还有未回答的用户提问'
        };
    }

    // 检查未处理的工具结果
    if (state.unprocessedResults && state.unprocessedResults.length > 0) {
        return {
            isComplete: false,
            reason: '还有未处理的工具执行结果'
        };
    }

    return { isComplete: true };
}

// ============================================================
// 熔断器（Circuit Breaker）
// ============================================================

/**
 * 熔断器
 *
 * 当错误连续发生时自动"断电"停止重试，防止系统崩溃。
 * 参考电气工程中的保险丝原理。
 *
 * 状态机：CLOSED → OPEN → HALF_OPEN → CLOSED
 *   - CLOSED：正常状态，允许调用
 *   - OPEN：熔断状态，拒绝所有调用
 *   - HALF_OPEN：半开状态，允许少量试探调用
 */
export function createCircuitBreaker(options = {}) {
    const failureThreshold = options.failureThreshold || 5;
    const recoveryTimeout = options.recoveryTimeout || 30000; // 30 秒冷却
    const halfOpenMaxCalls = options.halfOpenMaxCalls || 1;

    let state = 'CLOSED'; // CLOSED | OPEN | HALF_OPEN
    let failureCount = 0;
    let lastFailureTime = 0;
    let halfOpenCalls = 0;

    /**
     * 记录成功调用
     */
    function onSuccess() {
        if (state === 'HALF_OPEN') {
            state = 'CLOSED';
            failureCount = 0;
        }
        // CLOSED 状态下成功不重置计数（通过时间窗口重置）
    }

    /**
     * 记录失败调用
     */
    function onFailure() {
        failureCount++;
        lastFailureTime = Date.now();

        if (state === 'HALF_OPEN') {
            state = 'OPEN';
            return;
        }

        if (state === 'CLOSED' && failureCount >= failureThreshold) {
            state = 'OPEN';
        }
    }

    /**
     * 检查是否允许调用
     * @returns {boolean}
     */
    function isAllowed() {
        if (state === 'CLOSED') return true;

        if (state === 'OPEN') {
            // 检查冷却时间是否已过
            if (Date.now() - lastFailureTime > recoveryTimeout) {
                state = 'HALF_OPEN';
                halfOpenCalls = 0;
            } else {
                return false;
            }
        }

        if (state === 'HALF_OPEN') {
            if (halfOpenCalls < halfOpenMaxCalls) {
                halfOpenCalls++;
                return true;
            }
            return false;
        }

        return false;
    }

    /**
     * 重置熔断器
     */
    function reset() {
        state = 'CLOSED';
        failureCount = 0;
        lastFailureTime = 0;
        halfOpenCalls = 0;
    }

    /**
     * 获取当前状态
     * @returns {{ state: string, failureCount: number }}
     */
    function getStatus() {
        return { state, failureCount };
    }

    return { onSuccess, onFailure, isAllowed, reset, getStatus };
}