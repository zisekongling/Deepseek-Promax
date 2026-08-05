/**
 * 历史消息清理模块
 *
 * 参考 deepseek-pp/core/interceptor/history-cleanup.ts 的设计：
 *   - 拦截 DeepSeek 的 history_messages API 响应
 *   - 清理 AI 消息中的工具调用 XML（如 <memory_save>...</memory_save>）
 *   - 将续跑 prompt 用户消息替换为不可见占位符
 *
 * 这样刷新页面或切换会话后，废弃的工具调用数据不会重新显示。
 *
 * 三层防御策略（参考 deepseek-pp）：
 *   1. 流式输出时 text-process.js 实时清理 DOM 中的工具调用 XML
 *   2. 历史消息加载时本模块清理 API 响应中的工具调用 XML（持久化隐藏）
 *   3. 续跑 prompt 用特殊标记标识，加载时替换为不可见占位符
 */
import { TOOL_NAMES } from './capability-register.js';
import { createXmlToolCallRegex, getDefaultCatalog, getToolDescriptor } from './tool-descriptors.js';
import { cleanVisibleUserPromptMarks, extractVisibleUserPrompt, hasVisibleUserPromptMark } from '../utils/prompt-visibility.js';
import { isAgentContinuationPrompt } from '../utils/agent-marker.js';

/** 续跑 prompt 的不可见占位符（参考 deepseek-pp 的 INLINE_AGENT_CONTINUATION_PLACEHOLDER） */
const CONTINUATION_PLACEHOLDER = '\u2063\u2064\u2063';

/**
 * 续跑 prompt 的可见 Agent 标记文本
 *
 * 历史消息中的续跑 prompt 被清理后，替换为此标记文本
 * text-process.js 扫描到此标记后会渲染为可见的 Agent 徽章
 */
const AGENT_BADGE_MARKER = '[Agent 自主产生]';

/** 续跑 prompt 的末尾标记（脚本专用，用户不会输入） */
const CONTINUATION_MARKER = '__ds_agent_continuation__';

/**
 * 清理历史消息 JSON 中的工具调用 XML 和续跑 prompt
 *
 * 参考 deepseek-pp/core/interceptor/history-cleanup.ts:stripToolCallsFromHistory
 * 遍历 chat_messages 数组，清理每条消息的 content 和 fragments 字段。
 *
 * @param {Object} json - DeepSeek history_messages API 的响应 JSON
 */
export function stripToolCallsFromHistory(json) {
    if (!json || !json.data) return;
    const data = json.data.biz_data || json.data;
    const messages = data.chat_messages;
    if (!Array.isArray(messages)) return;

    for (const msg of messages) {
        _stripMessageToolCalls(msg);
    }
}

/**
 * 判断消息是否为 AI 助手消息
 *
 * DeepSeek 的消息对象通过 message_role / role / type 字段区分发送者：
 *   - "assistant" 或 "ai"：AI 助手消息
 *   - "user"：用户消息
 *
 * 参考 deepseek-pp/core/interceptor/history-cleanup.ts:isAssistantStoredMessage
 *
 * @param {Object} msg - 消息对象
 * @returns {boolean} true 表示是 AI 助手消息
 */
function _isAssistantMessageData(msg) {
    if (!msg || typeof msg !== 'object') return false;
    const role = String(
        msg.message_role || msg.role || msg.type || ''
    ).toLowerCase();
    return role === 'assistant' || role === 'ai';
}

/**
 * 判断消息是否为 agent 续跑 prompt（用户消息但由脚本发送）
 *
 * 使用 isAgentContinuationPrompt 统一识别，与 fetch-hub.js 保持一致
 *
 * @param {Object} msg - 消息对象
 * @returns {boolean} true 表示是 agent 续跑 prompt
 */
function _isAgentContinuationData(msg) {
    // 检查 content 字段
    if (isAgentContinuationPrompt(msg.content)) return true;
    // 检查 fragments 字段
    if (Array.isArray(msg.fragments)) {
        const joined = msg.fragments
            .filter(f => f && typeof f.content === 'string')
            .map(f => f.content)
            .join('');
        if (isAgentContinuationPrompt(joined)) return true;
    }
    return false;
}

/**
 * 从续跑 prompt 文本中提取工具调用摘要
 *
 * 解析 <tool_results> JSON 数组，提取每个工具的 name 并映射为中文标签
 * 用于在 Agent 徽章上显示"做了什么"
 *
 * @param {string} text - 续跑 prompt 全文
 * @returns {string} 工具摘要文本（如"保存记忆 · 审查记忆"），解析失败返回空字符串
 */
function _extractToolSummaryFromText(text) {
    try {
        const match = text.match(/<tool_results>([\s\S]*?)<\/tool_results>/);
        if (!match) return '';
        const results = JSON.parse(match[1].trim());
        if (!Array.isArray(results) || results.length === 0) return '';
        const names = results.slice(0, 3).map(r => r.tool || r.name || '').filter(Boolean);
        // fallback 标签映射（descriptor 未覆盖时使用，保留向后兼容）
        const labelMap = {
            memory_save: '保存记忆',
            memory_update: '更新记忆',
            memory_delete: '删除记忆',
            memory_import_preview: '预览导入',
            memory_merge: '融合记忆',
            memory_review: '审查记忆',
            memory_recall: '报告调用'
        };
        // 优先查 descriptor（含 MCP 动态工具的描述），fallback 到 labelMap，最后用工具名
        const summary = names.map(name => {
            const desc = getToolDescriptor(name);
            if (desc && desc.description) return desc.description;
            return labelMap[name] || name;
        });
        if (results.length > 3) summary.push('+' + (results.length - 3));
        return summary.join(' · ');
    } catch (e) {
        return '';
    }
}

/**
 * 尝试用括号补全解析 JSON（用于检测未闭合工具调用的 JSON 是否有效）
 *
 * 当 AI 输出 <tool_name>{"key":"value"} 但缺少 </tool_name> 闭标签时，
 * JSON 本身可能是完整的（以 } 结尾）或缺少闭合括号（如 {"focus":"重复记忆" ）。
 * 此函数尝试补全缺失的 } 或 ] 后解析，用于判断是否应该清理该片段。
 *
 * @param {string} body - 待检测的 JSON 文本
 * @returns {boolean} true 表示 JSON 可解析（应该清理），false 表示不可解析（保留）
 */
function _tryParseJSONWithBracketCompletion(body) {
    if (!body || typeof body !== 'string') return false;
    try {
        // 先尝试直接解析
        JSON.parse(body);
        return true;
    } catch (e) {
        // 尝试补全缺失的闭合括号
        try {
            let cleaned = body.trim();
            // 统计字符串外的括号数量
            let braceDepth = 0;
            let bracketDepth = 0;
            let inStr = false;
            let escNext = false;
            for (let i = 0; i < cleaned.length; i++) {
                const ch = cleaned[i];
                if (escNext) { escNext = false; continue; }
                if (ch === '\\') { escNext = true; continue; }
                if (ch === '"') { inStr = !inStr; continue; }
                if (inStr) continue;
                if (ch === '{') braceDepth++;
                else if (ch === '}') braceDepth--;
                else if (ch === '[') bracketDepth++;
                else if (ch === ']') bracketDepth--;
            }
            if (braceDepth > 0) cleaned += '}'.repeat(braceDepth);
            if (bracketDepth > 0) cleaned += ']'.repeat(bracketDepth);
            JSON.parse(cleaned);
            return true;
        } catch (e2) {
            return false;
        }
    }
}

/**
 * 清理单条消息中的工具调用 XML 和续跑 prompt
 *
 * 安全策略（参考 deepseek-pp 的清理逻辑）：
 *   - AI 助手消息：清理工具调用 XML、能力说明、未完成片段（AI 输出的废弃数据）
 *   - agent 续跑 prompt（用户消息但由脚本发送）：替换为不可见占位符
 *   - 普通用户消息：**不清理**（保护用户输入的内容不被误删）
 *
 * 处理两个字段：
 *   - msg.content：字符串形式的消息内容
 *   - msg.fragments：数组形式的消息片段（DeepSeek 的主要存储格式）
 *
 * @param {Object} msg - 消息对象
 */
function _stripMessageToolCalls(msg) {
    if (!msg || typeof msg !== 'object') return;

    // 安全检查：区分消息类型
    const isAssistant = _isAssistantMessageData(msg);
    const isContinuation = _isAgentContinuationData(msg);

    // 普通用户消息（非 agent 续跑）：不清理，保护用户输入
    if (!isAssistant && !isContinuation) return;

    // 处理 content 字段
    if (typeof msg.content === 'string') {
        msg.content = _cleanMessageText(msg.content);
    }

    // 处理 fragments 字段（DeepSeek 的主要存储格式）
    if (Array.isArray(msg.fragments)) {
        _stripFragmentsToolCalls(msg.fragments);
    }
}

/**
 * 清理消息文本中的工具调用 XML、续跑 prompt 和 AI 废弃数据
 *
 * 策略（参考 deepseek-pp 的多层清理）：
 *   1. 续跑 prompt（<original_task> + <tool_results>）→ 替换为不可见占位符
 *   2. 工具调用 XML（<memory_save>...</memory_save>）→ 移除 XML，保留其他文本
 *   3. 重复的能力说明（"工具调用格式"、"可用工具" 等）→ 移除
 *   4. 未完成的工具调用 XML 片段 → 移除
 *
 * @param {string} text - 原始消息文本
 * @returns {string} 清理后的文本
 */
function _cleanMessageText(text) {
    if (!text || typeof text !== 'string') return text;

    // 1. 优先检查可见性标记（用户消息的可靠标识）
    // prompt-augmentation 在用户消息外层包裹了 start/end 标记 + metadata 行
    // 刷新后 DeepSeek 历史接口返回的 prompt 含这些标记，需先提取原始用户输入
    // 防御性顺序：必须在 agent 续跑检测之前执行，否则注入了能力提示词（含
    // <original_task>/<tool_results> 结构化标签和"工具结果"关键词）的用户消息
    // 会被 isAgentContinuationPrompt 误判为 agent 续跑，导致用户输入被当成 agent 自主产生
    if (hasVisibleUserPromptMark(text)) {
        // 优先提取标记内的原始 prompt（最准确）
        const extracted = extractVisibleUserPrompt(text);
        if (extracted !== null) {
            text = extracted;
        }
        // 清除残留的标记和 metadata（处理标记不完整的情况）
        text = cleanVisibleUserPromptMarks(text);
        // 提取后的 text 是纯用户输入，不会含 agent 续跑标记，继续走后续清理
    }

    // 2. 检测 agent 续跑 prompt：使用统一的 isAgentContinuationPrompt 识别
    // 替换为可见的 Agent 标记文本（让用户知道这是 agent 自主产生的消息）
    // text-process.js 扫描到此标记后会渲染为可见的 Agent 徽章
    // 此时真正的用户消息已被提取为纯文本，不会被误判为 agent 续跑
    if (isAgentContinuationPrompt(text)) {
        // 尝试提取工具摘要，附加到标记文本中
        const toolSummary = _extractToolSummaryFromText(text);
        return toolSummary ? `[Agent 自主产生|${toolSummary}]` : AGENT_BADGE_MARKER;
    }

    let cleaned = text;

    // 1.5 移除单独的 <tool_results> / <original_task> 标签
    // 这些标签是 agent 续跑 prompt 的内部数据，AI 可能直接输出（模仿格式）
    // 始终清理这些标签，避免内部数据外露
    if (cleaned.includes('<tool_results>') || cleaned.includes('<original_task>') ||
        cleaned.includes('</tool_results>') || cleaned.includes('</original_task>')) {
        cleaned = cleaned
            .replace(/<tool_results>[\s\S]*?<\/tool_results>/g, '')
            .replace(/<original_task>[\s\S]*?<\/original_task>/g, '')
            // 处理未闭合的标签（只有开标签没有闭标签）
            .replace(/<tool_results>[^\n]*$/g, '')
            .replace(/<original_task>[^\n]*$/g, '')
            .replace(/<\/?(?:tool_results|original_task)>/g, '')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }

    // 2. 移除完整的工具调用 XML（这是"调用数据"，始终清理）
    // 动态构建正则：catalog 从 getDefaultRegistry() 派生，含 MCP 动态工具（mcp__server__tool）
    // createXmlToolCallRegex 内部用 WeakMap 缓存 catalog → 正则，避免重复构建
    // register/unregister 时 _invalidateCaches 会清空缓存，确保动态工具变更后正则重建
    const toolCallRegex = createXmlToolCallRegex(getDefaultCatalog());
    const hasToolCallXml = toolCallRegex.test(cleaned);
    toolCallRegex.lastIndex = 0; // 重置 lastIndex，避免 global 正则的状态影响后续调用
    if (hasToolCallXml) {
        cleaned = cleaned.replace(toolCallRegex, '');
    }

    // 3. 移除重复的能力说明段落（参考 deepseek-pp 的 sanitizeInternalPromptText）
    // AI 有时会重复输出注入的 [能力] 提示词内容
    //
    // 安全策略：只在文本**完全由能力说明组成**时才清理
    //   - 先模拟清理能力说明，检查清理后是否还有实质内容
    //   - 如果清理后文本为空或极短（≤10字符），说明是纯废弃数据，执行清理
    //   - 如果清理后仍有实质内容，说明 AI 在正常回复中引用了能力说明，不清理
    //     （保护 AI 的正常回复数据不被误删）
    const hasCapabilityMarker = cleaned.includes('工具调用格式') ||
        cleaned.includes('可用工具') ||
        cleaned.includes('你可以通过输出 XML 标签来调用工具');
    if (hasCapabilityMarker) {
        const testCleaned = cleaned
            .replace(/##\s*工具调用格式[\s\S]*?(?=##\s|$)/g, '')
            .replace(/##\s*可用工具[\s\S]*?(?=##\s|$)/g, '')
            .replace(/你可以通过输出 XML 标签来调用工具[^\n]*\n?/g, '')
            .replace(/标签名必须与下方"可用工具"中的名称完全一致[^\n]*\n?/g, '')
            .replace(/不要使用 <invoke name="[^>]*>[^\n]*\n?/g, '')
            .replace(/工具调用 XML 必须放在最终回复内容中[^\n]*\n?/g, '')
            .replace(/扩展会自动执行工具调用[^\n]*\n?/g, '')
            .replace(/每次调用 memory_save 必须生成唯一的 id 字段[^\n]*\n?/g, '')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
        // 只有清理后文本为空或极短时，才实际执行清理
        if (testCleaned.length <= 10) {
            cleaned = testCleaned;
        }
    }

    // 4. 移除未完成的工具调用 XML 片段
    // 参考 deepseek-pp 的 streaming-tool-text.ts：处理流式输出残留的未闭合标签
    // 处理两种情况：
    //   - 孤立的闭标签（没有对应开标签）：直接移除
    //   - 未闭合的开标签（有开标签但无闭标签）：如果 JSON 可解析，移除整个片段
    for (const name of TOOL_NAMES) {
        const openTag = '<' + name + '>';
        const closeTag = '</' + name + '>';
        // 4a. 只移除孤立的闭标签（没有对应开标签的闭标签）
        if (!cleaned.includes(openTag) && cleaned.includes(closeTag)) {
            cleaned = cleaned.replace(new RegExp(closeTag.replace(/[<>/]/g, '\\$&'), 'g'), '');
        }
        // 4b. 处理未闭合的开标签：如果开标签后的 JSON 可解析，移除整个片段
        // 这样可以清理 AI 输出的不完整工具调用（缺 } 或缺闭标签）
        if (cleaned.includes(openTag) && !cleaned.includes(closeTag)) {
            const openIdx = cleaned.indexOf(openTag);
            const body = cleaned.slice(openIdx + openTag.length).trim();
            if (body && _tryParseJSONWithBracketCompletion(body)) {
                // JSON 可解析，移除从开标签到末尾的内容
                cleaned = cleaned.slice(0, openIdx).trim();
            }
        }
    }

    // 清理多余空白
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();

    return cleaned;
}

/**
 * 清理 fragments 数组中的工具调用 XML
 *
 * DeepSeek 将消息内容分散在多个 fragment 中，需要先合并文本判断，
 * 再将清理结果写回第一个 fragment，其余置空。
 *
 * 参考 deepseek-pp/core/interceptor/history-cleanup.ts:stripFragmentToolCalls
 *
 * @param {Array<Object>} fragments - fragment 数组
 */
function _stripFragmentsToolCalls(fragments) {
    if (!Array.isArray(fragments) || fragments.length === 0) return;

    // 收集所有文本类型的 fragment
    const textFragments = fragments.filter(
        f => f && typeof f.content === 'string'
    );
    if (textFragments.length === 0) return;

    // 合并所有 fragment 的文本
    const joined = textFragments.map(f => f.content).join('');
    if (!joined) return;

    // 检测是否需要清理（使用统一的 isAgentContinuationPrompt 识别续跑 prompt）
    // 动态正则：含 MCP 工具（mcp__server__tool 格式），与 _cleanMessageText 使用同一来源
    const toolCallRegex = createXmlToolCallRegex(getDefaultCatalog());
    const hasContinuation = isAgentContinuationPrompt(joined);
    const hasToolCall = toolCallRegex.test(joined);
    toolCallRegex.lastIndex = 0; // 重置 lastIndex，避免 global 正则的状态影响后续调用
    const hasCapabilityMarker = joined.includes('工具调用格式') ||
        joined.includes('可用工具') ||
        joined.includes('你可以通过输出 XML 标签来调用工具');
    const hasToolFragment = TOOL_NAMES.some(name =>
        joined.includes('<' + name) || joined.includes('</' + name)
    );
    if (!hasContinuation && !hasToolCall && !hasCapabilityMarker && !hasToolFragment) return;

    // 清理文本
    const cleaned = _cleanMessageText(joined);

    // 将清理结果写回第一个 fragment，其余置空
    textFragments.forEach((frag, idx) => {
        frag.content = idx === 0 ? cleaned : '';
    });
}

/**
 * 获取续跑 prompt 的可识别标记
 * 供 capability-agent.js 在构建续跑 prompt 时添加
 *
 * @returns {string} 标记字符串
 */
export function getContinuationMarker() {
    return CONTINUATION_MARKER;
}

/**
 * 获取续跑 prompt 的不可见占位符
 *
 * @returns {string} 占位符字符串
 */
export function getContinuationPlaceholder() {
    return CONTINUATION_PLACEHOLDER;
}
