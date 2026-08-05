/**
 * 续跑 Prompt 构建（参考 deepseek-pp/core/inline-agent/prompt.ts:buildContinuationPrompt）
 *
 * 将工具调用结果包装在 <original_task> + <tool_results> XML 块中，
 * 让 AI 看到工具执行结果并继续对话。
 *
 * v2 边界标记：用 START + END 包裹整个 prompt，解决刷新后识别混乱问题。
 */

import {
    state,
    AGENT_V2_START_MARKER,
    AGENT_V2_END_MARKER,
    getMaxRounds
} from './state-store.js';
import { getContinuationMarker } from '../history-cleanup.js';

/**
 * 构建续跑 prompt
 *
 * @param {string} originalTask - 原始用户任务
 * @param {Array<{ name: string, ok: boolean, summary: string, detail?: string }>} toolResults - 工具调用结果
 * @param {{ roundsSinceTodo?: number, todoCount?: number }} [options] - 可选参数，用于注入 todo 状态和 reminder
 * @returns {string} 续跑 prompt 文本
 */
export function buildContinuationPrompt(originalTask, toolResults, options) {
    // 只有真正的失败（ok=false 且非 skipped）才需要 AI 修正参数重试
    // skipped 场景（记忆已存在、记忆已删除）是正常行为，不需要重试
    const hasFailures = toolResults.some(r => !r.ok && !r.skipped);
    // 优先使用 toolName（英文工具名），兼容 name 字段（中文标签）
    const results = toolResults.map(r => ({
        tool: r.toolName || r.name,
        ok: r.ok,
        skipped: r.skipped || false,
        summary: r.summary,
        detail: r.detail || ''
    }));

    // 检测是否包含 start_agent 调用（Agent 显式启动信号）
    const hasStartAgent = toolResults.some(r => (r.toolName || r.name) === 'start_agent' && r.agentStarted);

    // 构建基础 prompt 数组
    const lines = [
        hasStartAgent
            ? 'Agent 模式已启动。你现在可以像真正的 Agent 一样执行任务：分析需求 → 调用工具 → 基于结果继续推进。请开始执行任务，需要操作时调用相应工具。'
            : '以下是工具续跑任务刚刚执行的工具结果。请像真正的 Agent 一样，基于原始任务和这些工具结果继续推进。',
        '任务完成后，务必在回复末尾调用 agent_finish 工具结束 Agent 循环；只有确实需要更多信息时才继续调用工具。',
        '不要要求用户点击继续，也不要输出伪工具调用 JSON；需要继续操作时只输出可执行 XML 工具标签。',
        '',
        '<original_task>',
        clampText(originalTask, 8000),
        '</original_task>',
        ...(hasFailures ? [
            '至少一个工具执行失败。不要因为可恢复错误就停止；先阅读 summary/detail，并修正参数或改用合适的下一步继续完成任务。'
        ] : []),
        '',
        '<tool_results>',
        JSON.stringify(results, null, 2),
        '</tool_results>'
    ];

    // 注入 user_answers 块（如果工具结果中包含 ask_user 的用户回答）
    const askUserResult = toolResults.find(r => (r.toolName || r.name) === 'ask_user' && r.userAnswers);
    if (askUserResult && Array.isArray(askUserResult.userAnswers) && askUserResult.userAnswers.length > 0) {
        const formattedAnswers = askUserResult.userAnswers.map(a => ({
            question: a.question || '',
            answer: a.answer,
            custom: !!a.custom
        }));
        lines.push(
            '',
            '<user_answers>',
            JSON.stringify(formattedAnswers, null, 2),
            '</user_answers>'
        );
    }

    // 注入 todo 状态块（如果当前有 todo 清单）
    const todoCount = options && typeof options.todoCount === 'number'
        ? options.todoCount
        : (typeof window !== 'undefined' && typeof window._dsGetTodoCount === 'function'
            ? window._dsGetTodoCount()
            : 0);
    if (todoCount > 0 && typeof window !== 'undefined' && typeof window._dsTodoRead === 'function') {
        try {
            const todoState = window._dsTodoRead();
            if (todoState && todoState.ok && todoState.detail) {
                lines.push('', '<todo_status>', todoState.detail, '</todo_status>');
            }
        } catch (e) {}
    }

    // 注入 nag reminder（如果连续未更新 todo）
    const roundsSinceTodo = options && typeof options.roundsSinceTodo === 'number'
        ? options.roundsSinceTodo
        : state.roundsSinceTodo;
    if (roundsSinceTodo >= 3 && todoCount > 0) {
        lines.push(
            '',
            '<reminder>',
            `你的任务清单已经 ${roundsSinceTodo} 轮未更新。请回顾任务进度：`,
            '- 如果某步骤已完成，调用 todo_write 把它标记为 completed',
            '- 如果发现新需求，追加到清单',
            '- 如果整体计划偏离，重新规划清单',
            '</reminder>'
        );
    }

    // 安全上限提示（仅接近上限时提醒）
    const maxRounds = getMaxRounds();
    const remaining = maxRounds - state.continuationRound - 1;
    if (remaining <= 5) {
        lines.push('', `(注意：已连续续跑 ${state.continuationRound + 1} 轮，为避免无限循环，请尽快完成任务并调用 agent_finish 结束)`);
    }

    // v1 末尾标记（向后兼容）
    lines.push('', getContinuationMarker());

    // v2 边界标记：用 START + END 包裹整个 prompt
    return AGENT_V2_START_MARKER + '\n' + lines.join('\n') + '\n' + AGENT_V2_END_MARKER;
}

/**
 * 限制文本长度（参考 deepseek-pp 的 clampText）
 * @param {string} text - 原始文本
 * @param {number} maxLength - 最大长度
 * @returns {string}
 */
export function clampText(text, maxLength) {
    if (!text) return text;
    return text.length > maxLength ? text.slice(0, maxLength) + '\n...[truncated]' : text;
}
