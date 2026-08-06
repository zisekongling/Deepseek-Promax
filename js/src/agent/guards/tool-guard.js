/**
 * 工具护栏（Tool Guard）
 *
 * 职责：
 *   - 工具执行前：约束检查（注册校验、开关校验、风险等级、频率限制）
 *   - 工具执行后：结果验证（格式校验、异常模式检测、连续失败预警）
 *   - 工具执行后：失败纠正（根据错误类型建议重试/跳过/终止/回退）
 *
 * 设计原则（参考《AI Agent 实战》指南）：
 *   - 故障安全默认值：所有能力默认关闭，必须显式开放
 *   - 输入隔离：安全检查只看结构化数据，不依赖模型自由文本
 *   - 在确认无法恢复之前，不暴露中间态
 *   - 防呆（Poka-yoke）：用设计消除错误，而非事后补救
 *
 * 与 harness.js 的关系：
 *   - harness.js 提供通用约束/验证/纠正框架
 *   - tool-guard.js 是 harness 在工具层面的具体实现
 *   - engine.js 在工具调用前后调用 tool-guard 进行检查
 */

import { constrainToolCall, verifyToolResult, correctToolFailure } from '../core/harness.js';

// ============================================================
// 工具执行前护栏
// ============================================================

/**
 * 工具调用前检查
 *
 * 组合 harness 的 constrainToolCall 与额外业务逻辑：
 *   - 高风险工具（riskLevel === 'high'）需要用户确认
 *   - 执行工具不能并行调用（有副作用）
 *   - 感知工具可并行调用（无副作用）
 *
 * @param {string} toolName - 工具名
 * @param {Object} payload - 调用参数
 * @param {Object} registry - 工具注册中心
 * @param {Object} [options] - 额外选项
 * @param {number} [options.callCount] - 当前轮次已调用次数（用于频率限制）
 * @param {number} [options.maxCallsPerRound] - 每轮最大调用次数（默认 10）
 * @returns {{ allowed: boolean, reason?: string, requireConfirm?: boolean }}
 */
export function preToolCallGuard(toolName, payload, registry, options = {}) {
    // 基础约束检查
    const base = constrainToolCall(toolName, payload, registry);
    if (!base.allowed) return base;

    // 频率限制
    const callCount = options.callCount || 0;
    const maxCalls = options.maxCallsPerRound || 10;
    if (callCount >= maxCalls) {
        return { allowed: false, reason: `单轮工具调用次数已达上限（${maxCalls}）` };
    }

    return { allowed: true, requireConfirm: base.requireConfirm };
}

/**
 * 判断工具是否可以与其他工具并行调用
 * @param {string} toolName - 工具名
 * @param {Object} registry - 工具注册中心
 * @returns {boolean}
 */
export function canParallelCall(toolName, registry) {
    // 感知工具天然可并行
    const desc = registry.getDescriptor(toolName);
    if (!desc) return false;
    return desc.isReadOnly === true || desc.category === 'perception';
}

// ============================================================
// 工具执行后护栏
// ============================================================

/**
 * 工具执行后验证
 *
 * 组合 harness 的 verifyToolResult 与额外校验：
 *   - 检查结果格式完整性
 *   - 检测连续失败模式（熔断预警）
 *   - 高风险工具的结果额外审计
 *
 * @param {string} toolName - 工具名
 * @param {Object} result - 工具执行结果
 * @param {Object} registry - 工具注册中心
 * @param {Array} [history] - 近期执行历史
 * @returns {{ valid: boolean, issue?: string, severity?: 'warn'|'error' }}
 */
export function postToolCallGuard(toolName, result, registry, history = []) {
    const verification = verifyToolResult(toolName, result, history);
    if (!verification.valid) {
        return { valid: false, issue: verification.issue, severity: 'error' };
    }

    // 额外：高风险工具结果校验
    const desc = registry.getDescriptor(toolName);
    if (desc && desc.riskLevel === 'high') {
        if (!result.ok && !result.skipped) {
            return {
                valid: true,
                issue: `高风险工具 "${toolName}" 执行失败，请人工审查`,
                severity: 'warn'
            };
        }
    }

    // 连续失败警告
    if (verification.issue) {
        return { valid: true, issue: verification.issue, severity: 'warn' };
    }

    return { valid: true };
}

/**
 * 工具失败时的纠正策略
 *
 * 组合 harness 的 correctToolFailure：
 *   - retry: 可重试（超时/网络错误，最多 2 次）
 *   - skip: 跳过（权限不足/已确认不可恢复）
 *   - abort: 终止（参数错误，需 AI 修正后重试）
 *   - fallback: 回退到替代工具
 *
 * @param {string} toolName - 工具名
 * @param {Object} result - 失败结果
 * @param {number} [retryCount] - 已重试次数
 * @returns {{ action: 'retry'|'skip'|'abort'|'fallback', reason: string, fallbackTool?: string }}
 */
export function correctToolCall(toolName, result, retryCount = 0) {
    return correctToolFailure(toolName, result, retryCount);
}

// ============================================================
// 批量工具检查
// ============================================================

/**
 * 检查一组工具调用是否可以并行执行
 *
 * 规则：所有工具都是只读/感知类 → 可并行；任一执行类 → 不可并行
 *
 * @param {Array<{name: string}>} toolCalls - 工具调用数组
 * @param {Object} registry - 工具注册中心
 * @returns {{ parallelizable: boolean, serialTools: string[] }}
 */
export function checkParallelizability(toolCalls, registry) {
    const serialTools = [];
    for (const tc of toolCalls) {
        if (!canParallelCall(tc.name, registry)) {
            serialTools.push(tc.name);
        }
    }
    return {
        parallelizable: serialTools.length === 0,
        serialTools
    };
}