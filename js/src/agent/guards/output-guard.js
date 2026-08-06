/**
 * 输出护栏（Output Guard）
 *
 * 职责：
 *   - AI 回复验证：检测空回复、截断回复、异常短回复
 *   - 工具调用结果校验：格式完整性、必需字段
 *   - 任务完成验证：Proposer-Reviewer 模式，防止过早终止
 *   - 循环状态监控：轮次上限、重复循环检测、熔断状态
 *
 * 设计原则（参考《AI Agent 实战》指南）：
 *   - Proposer-Reviewer 模式：AI 提议"完成"，Reviewer 验证是否真正完成
 *   - 在确认无法恢复之前，不暴露中间态给用户
 *   - 熔断器：当错误连续发生时自动"断电"停止重试
 */

import { verifyTaskCompletion } from '../core/harness.js';

// ============================================================
// AI 回复验证
// ============================================================

/**
 * 验证 AI 回复是否完整
 *
 * 检查：空回复、截断回复（以截断标记结尾）、异常短回复。
 *
 * @param {string} content - AI 回复文本
 * @param {Object} [options] - 选项
 * @param {number} [options.minLength] - 最小长度（字节，默认 10）
 * @returns {{ valid: boolean, issue?: string }}
 */
export function validateReplyContent(content, options = {}) {
    const minLength = options.minLength || 10;

    if (!content || typeof content !== 'string') {
        return { valid: false, issue: 'AI 回复为空' };
    }

    // 截断检测
    if (content.endsWith('...[truncated]') || content.endsWith('...')) {
        return { valid: false, issue: 'AI 回复可能被截断' };
    }

    // 异常短回复（排除工具调用场景）
    if (content.trim().length < minLength && !content.includes('</')) {
        return { valid: true, issue: 'AI 回复异常短，可能不完整' };
    }

    return { valid: true };
}

/**
 * 验证工具调用结果
 *
 * 检查：ok 字段、summary 字段、异常结果
 *
 * @param {Object} result - 工具调用结果
 * @returns {{ valid: boolean, issue?: string }}
 */
export function validateToolResult(result) {
    if (!result || typeof result !== 'object') {
        return { valid: false, issue: '工具返回结果为空或格式无效' };
    }

    if (typeof result.ok !== 'boolean') {
        return { valid: false, issue: '工具返回结果缺少 ok 字段' };
    }

    if (!result.summary || typeof result.summary !== 'string') {
        return { valid: true, issue: '工具返回结果缺少 summary 字段' };
    }

    return { valid: true };
}

// ============================================================
// 任务完成验证（Proposer-Reviewer 模式）
// ============================================================

/**
 * 验证 Agent 是否真正完成了任务
 *
 * 组合 harness 的 verifyTaskCompletion：
 *   1. 是否有未完成的 todo
 *   2. 是否有 pending 的 ask_user
 *   3. 是否所有工具结果都已处理
 *
 * @param {Object} state - Agent 循环状态
 * @param {Array} state.todos - 当前 todo 列表
 * @param {boolean} state.hasPendingAskUser - 是否有 pending 提问
 * @param {Array} state.unprocessedResults - 未处理的工具结果
 * @returns {{ isComplete: boolean, reason?: string }}
 */
export function reviewTaskCompletion(state) {
    return verifyTaskCompletion(state);
}

// ============================================================
// 循环状态监控
// ============================================================

/**
 * 检测 Agent 是否陷入重复循环
 *
 * 连续 3 轮调用完全相同的工具（名称 + 参数一致）视为重复循环。
 *
 * @param {Array} toolCallHistory - 工具调用历史
 * @returns {{ detected: boolean, toolName?: string }}
 */
export function detectRepetitiveLoop(toolCallHistory) {
    if (!toolCallHistory || toolCallHistory.length < 3) {
        return { detected: false };
    }

    const last3 = toolCallHistory.slice(-3);
    const allSame = last3.every(tc => {
        return tc.name === last3[0].name &&
            JSON.stringify(tc.payload) === JSON.stringify(last3[0].payload);
    });

    if (allSame) {
        return {
            detected: true,
            toolName: last3[0].name
        };
    }

    return { detected: false };
}

/**
 * 评估 Agent 循环的健康状态
 *
 * 综合检查：轮次使用率、重复循环、连续失败、熔断状态。
 *
 * @param {Object} state - Agent 循环状态
 * @param {number} state.round - 当前轮次
 * @param {number} state.maxRounds - 最大轮次
 * @param {Array} state.toolCallHistory - 工具调用历史
 * @param {number} state.consecutiveFailures - 连续失败次数
 * @param {Object} circuitBreakerStatus - 熔断器状态 { state, failureCount }
 * @returns {{ healthy: boolean, warnings: string[], shouldStop: boolean, stopReason?: string }}
 */
export function assessLoopHealth(state, circuitBreakerStatus) {
    const warnings = [];
    let shouldStop = false;
    let stopReason = null;

    // 轮次使用率检查
    const roundRatio = state.round / state.maxRounds;
    if (roundRatio > 0.8) {
        warnings.push(`轮次使用率 ${Math.round(roundRatio * 100)}%（${state.round}/${state.maxRounds}）`);
    }
    if (state.round >= state.maxRounds) {
        shouldStop = true;
        stopReason = `已达到最大轮次上限（${state.maxRounds}）`;
    }

    // 重复循环检测
    const repetitive = detectRepetitiveLoop(state.toolCallHistory);
    if (repetitive.detected) {
        warnings.push(`检测到重复循环：连续 3 轮调用 "${repetitive.toolName}"`);
        shouldStop = true;
        stopReason = `检测到重复循环：连续 3 轮调用相同的工具 "${repetitive.toolName}"`;
    }

    // 连续失败检查
    if (state.consecutiveFailures >= 3) {
        warnings.push(`连续 ${state.consecutiveFailures} 次工具调用失败`);
    }

    // 熔断器状态检查
    if (circuitBreakerStatus && circuitBreakerStatus.state === 'OPEN') {
        warnings.push('熔断器已开启，拒绝所有工具调用');
        shouldStop = true;
        stopReason = '熔断器已开启';
    }

    return {
        healthy: warnings.length === 0 && !shouldStop,
        warnings,
        shouldStop,
        stopReason
    };
}