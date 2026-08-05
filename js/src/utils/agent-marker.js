/**
 * Agent 续跑消息标记与识别（集中管理）
 *
 * 原先 agent 续跑标记字符串和 isAgentContinuationPrompt 函数散落在三个文件中：
 *   - utils/fetch-hub.js（定义 isAgentContinuationPrompt + prompt 注入调用）
 *   - features/anti-recall.js（import isAgentContinuationPrompt + XHR 注入调用）
 *   - features/history-cleanup.js（自定义 CONTINUATION_MARKER 常量）
 *   - features/text-process.js（硬编码标记字符串做正则清理）
 *
 * 本模块集中管理所有 agent 续跑标记和识别/清理函数，消除重复定义。
 * 各模块通过 import { isAgentContinuationPrompt, AGENT_V2_START_MARKER, ... } 引用。
 *
 * 标记体系（三层保险，参考 deepseek-pp/core/inline-agent/prompt.ts）：
 *   1. v2 边界标记（最可靠）：__DS_AGENT_V2_START__ ... __DS_AGENT_V2_END__
 *   2. v1 末尾标记：__ds_agent_continuation__（向后兼容）
 *   3. 结构化标签：<original_task> + <tool_results>（用户不会同时输入这些标签）
 */

// ============================================================
// 标记常量
// ============================================================

/** v1 末尾标记（向后兼容，刷新后可能被截断） */
export const AGENT_CONTINUATION_MARKER = '__ds_agent_continuation__';

/** v2 边界起始标记（包裹整个续跑 prompt，刷新后仍可识别） */
export const AGENT_V2_START_MARKER = '__DS_AGENT_V2_START__';

/** v2 边界结束标记 */
export const AGENT_V2_END_MARKER = '__DS_AGENT_V2_END__';

// ============================================================
// 识别函数
// ============================================================

/**
 * 检测 prompt 是否包含 agent 续跑结构标签
 *
 * 参考 deepseek-pp/core/inline-agent/prompt.ts:hasInlineAgentContinuationTags
 * 用户消息不会同时包含 <original_task> + <tool_results> 这组结构化标签
 *
 * @param {string} content - 待检测的文本
 * @returns {boolean} true 表示包含续跑结构标签
 */
export function hasAgentContinuationTags(content) {
    if (!content.includes('<original_task>') || !content.includes('</original_task>')) return false;
    return content.includes('<tool_results>') || content.includes('<tool_results_so_far>');
}

/**
 * 检测 prompt 是否为 agent 续跑消息
 *
 * 参考 deepseek-pp/core/inline-agent/prompt.ts:isInlineAgentContinuationPrompt
 *
 * 识别策略（三层保险，任一命中即判定为 agent 消息）：
 *   1. v2 边界标记（最可靠）：包含 __DS_AGENT_V2_START__（用户不会输入此字符串）
 *   2. v1 末尾标记：包含 __ds_agent_continuation__（向后兼容）
 *   3. 结构化识别：包含 <original_task> + <tool_results> 标签 + 关键词
 *
 * 区分目的：续跑消息不需要重复注入系统指令和系统记忆，
 * 只需要注入能力注册提示词（教会 AI 工具调用格式）
 *
 * @param {string} prompt - 待检测的 prompt
 * @returns {boolean} true 表示是 agent 续跑消息
 */
export function isAgentContinuationPrompt(prompt) {
    if (typeof prompt !== 'string' || !prompt) return false;
    // 1. v2 边界标记（最可靠，用户不会输入）
    if (prompt.includes(AGENT_V2_START_MARKER) || prompt.includes(AGENT_V2_END_MARKER)) return true;
    // 2. v1 末尾标记（向后兼容）
    if (prompt.includes(AGENT_CONTINUATION_MARKER)) return true;
    // 3. 结构化识别（参考 deepseek-pp）
    if (!hasAgentContinuationTags(prompt)) return false;
    return prompt.includes('工具续跑任务') ||
        prompt.includes('工具结果') ||
        prompt.includes('Continue like a real agent') ||
        prompt.includes('tool results') ||
        prompt.includes('do not call any tools') ||
        prompt.includes('不要调用任何工具');
}

// ============================================================
// 清理函数（供 text-process.js 统一调用，消除多处重复正则）
// ============================================================

/** v2 标记正则：匹配 __DS_AGENT_V2_START__...__DS_AGENT_V2_END__ 整段 */
const V2_BLOCK_REGEX = new RegExp(
    AGENT_V2_START_MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
    '[\\s\\S]*?' +
    AGENT_V2_END_MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    'g'
);

/** v1 标记正则：匹配 __ds_agent_continuation__ */
const V1_MARKER_REGEX = new RegExp(
    AGENT_CONTINUATION_MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    'g'
);

/** v2 单独起始标记正则 */
const V2_START_REGEX = new RegExp(AGENT_V2_START_MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');

/** v2 单独结束标记正则 */
const V2_END_REGEX = new RegExp(AGENT_V2_END_MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');

/**
 * 清理文本中的所有 agent 续跑标记
 *
 * 清理顺序：
 *   1. 先删除 v2 包裹块（START...END 整段）
 *   2. 再删除残留的单独 v2 标记（处理块不完整的情况）
 *   3. 最后删除 v1 标记
 *
 * @param {string} text - 待清理的文本
 * @returns {string} 清理后的文本
 */
export function cleanAgentMarkers(text) {
    if (typeof text !== 'string' || !text) return text;
    return text
        .replace(V2_BLOCK_REGEX, '')
        .replace(V2_START_REGEX, '')
        .replace(V2_END_REGEX, '')
        .replace(V1_MARKER_REGEX, '');
}

/**
 * 检测文本是否包含任何 agent 续跑标记
 * @param {string} text - 待检测文本
 * @returns {boolean}
 */
export function hasAgentMarker(text) {
    if (typeof text !== 'string' || !text) return false;
    return text.includes(AGENT_V2_START_MARKER) ||
        text.includes(AGENT_V2_END_MARKER) ||
        text.includes(AGENT_CONTINUATION_MARKER);
}
