/**
 * 文本处理模块
 *
 * 包含图片渲染、删除线渲染、角标清理、链接扫描等功能。
 * 通过遍历 Text 节点对 DeepSeek 的输出进行实时美化。
 * 处理顺序：角标清理 → 删除线渲染 → 图片渲染（与原版一致）
 */
import { CONFIG } from '../config.js';
import { utils } from '../utils.js';
import { scanMermaid } from './mermaid.js';
import { replaceSensitiveData } from './privacy-shield.js';
import { requiresAgentFeedback, isAgentFinishTool, TOOL_NAMES } from './capability-register.js';
import { AGENT_V2_START_MARKER, AGENT_V2_END_MARKER } from '../utils/fetch-hub.js';
import { isToolCallStarting } from '../utils/streaming-tool-parser.js';

// ============================================================
// 图片渲染
// ============================================================

/**
 * 创建图片元素
 * @param {string} url - 图片 URL
 * @param {string} alt - 替代文本
 * @returns {HTMLImageElement}
 */
function createImageElement(url, alt = '') {
    const img = document.createElement('img');
    img.src = url;
    img.alt = alt || '图片';
    img.className = 'anime-rendered-image';
    img.loading = 'lazy';
    img.onerror = () => { if (img.parentNode) img.style.display = 'none'; };
    return img;
}

/**
 * 将节点替换为图片链接（用于 scanLinks 中的 <a> 标签替换）
 * 使用 insertBefore + display:none 代替 replaceChild，避免破坏 React 的 DOM 管理
 * @param {Node} node - 待替换的节点
 * @param {string} url - 图片 URL
 * @param {string} alt - 替代文本
 */
function replaceNodeWithImage(node, url, alt) {
    if (!utils.isNodeAttached(node)) return;
    try {
        const img = createImageElement(url, alt);
        const link = document.createElement('a');
        link.href = url; link.target = '_blank'; link.rel = 'noreferrer';
        link.className = 'anime-image-link';
        link.appendChild(img);
        // 在原节点前插入图片链接，然后隐藏原节点（不移除，避免 React removeChild 错误）
        node.parentNode.insertBefore(link, node);
        node.style.display = 'none';
    } catch (e) {}
}

// ============================================================
// 角标清理
// ============================================================

/**
 * 清理文本节点中的角标标记文本 [reference:N] / [citation:N]
 * @param {Text} textNode
 */
function cleanTextCitations(textNode) {
    if (!CONFIG.citationCleanEnabled) return;
    if (!textNode || textNode.nodeType !== 3) return;
    const original = textNode.textContent;
    const cleaned = utils.removeCitationText(original);
    if (cleaned !== original) {
        textNode.textContent = cleaned;
    }
}

/**
 * 清理元素中的角标 DOM 节点
 * 使用 display:none 隐藏而非 removeChild 移除，避免破坏 React 的 DOM 管理
 * @param {Element} root
 */
function cleanElementCitations(root) {
    if (!CONFIG.citationCleanEnabled) return;
    if (!root || root.nodeType !== 1) return;
    const candidates = root.querySelectorAll('a, span, cite, sup, [data-citation]');
    candidates.forEach(el => {
        if (utils.isCitationElement(el) && el.style.display !== 'none') {
            el.style.display = 'none';
        }
    });
}

// ============================================================
// 删除线渲染
// ============================================================

/**
 * 在文本节点中渲染 ~~删除线~~ 语法为 <del> 元素
 * @param {Text} textNode
 * @returns {Text[]|null} 新插入的文本节点数组（供图片渲染使用），无匹配时返回 null
 */
function renderStrikethrough(textNode) {
    if (!CONFIG.strikethroughEnabled) return null;
    if (textNode.nodeType !== 3) return null;
    const text = textNode.textContent;
    if (!/~~.+?~~/.test(text)) return null;
    if (utils.isInsideCodeBlock(textNode)) return null;

    const parent = textNode.parentNode;
    if (!parent) return null;

    const fragment = document.createDocumentFragment();
    let lastIndex = 0;
    const regex = /~~(.+?)~~/g;
    let match;

    while ((match = regex.exec(text)) !== null) {
        if (match.index > lastIndex) {
            fragment.appendChild(document.createTextNode(text.substring(lastIndex, match.index)));
        }
        const del = document.createElement('del');
        del.textContent = match[1];
        fragment.appendChild(del);
        lastIndex = match.index + match[0].length;
    }
    if (lastIndex < text.length) {
        fragment.appendChild(document.createTextNode(text.substring(lastIndex)));
    }

    // 收集 fragment 中的文本节点（插入后需要处理图片渲染）
    const insertedTextNodes = [];
    for (let child of fragment.childNodes) {
        if (child.nodeType === 3) insertedTextNodes.push(child);
    }

    // 在原文本节点前插入 fragment，然后清空原文本节点（不移除，避免 React removeChild 错误）
    parent.insertBefore(fragment, textNode);
    textNode.textContent = '';
    return insertedTextNodes.length > 0 ? insertedTextNodes : null;
}

// ============================================================
// 图片渲染入口
// ============================================================

/**
 * 渲染文本节点中的第一个图片（Markdown 或纯 URL）
 * 仅处理第一个匹配项，在原文本节点前插入 span（包含前置文本 + 图片链接 + 后置文本）
 * 然后清空原文本节点（不移除，避免 React removeChild 错误）
 * @param {Text} textNode
 */
function renderImages(textNode) {
    if (!CONFIG.imageRenderEnabled) return;
    if (textNode.nodeType !== 3) return;
    if (!utils.isNodeAttached(textNode)) return;

    const text = textNode.textContent || '';
    if (text.trim().length < 5) return;

    try {
        const mdMatches = utils.extractMarkdownImage(text);
        if (mdMatches.length) {
            const first = mdMatches[0];
            const span = document.createElement('span');
            if (first.index > 0) span.appendChild(document.createTextNode(text.substring(0, first.index)));
            const img = createImageElement(first.url, first.alt);
            const link = document.createElement('a');
            link.href = first.url; link.target = '_blank'; link.rel = 'noreferrer';
            link.className = 'anime-image-link'; link.appendChild(img);
            span.appendChild(link);
            const end = first.index + first.length;
            if (end < text.length) span.appendChild(document.createTextNode(text.substring(end)));
            // 在原文本节点前插入 span，然后清空原文本节点
            if (utils.isNodeAttached(textNode)) {
                textNode.parentNode.insertBefore(span, textNode);
                textNode.textContent = '';
            }
            return;
        }

        const urlMatches = utils.extractPlainImageUrls(text);
        if (urlMatches.length) {
            const firstUrl = urlMatches[0];
            const span = document.createElement('span');
            if (firstUrl.index > 0) span.appendChild(document.createTextNode(text.substring(0, firstUrl.index)));
            const img = createImageElement(firstUrl.url);
            const link = document.createElement('a');
            link.href = firstUrl.url; link.target = '_blank'; link.rel = 'noreferrer';
            link.className = 'anime-image-link'; link.appendChild(img);
            span.appendChild(link);
            const end = firstUrl.index + firstUrl.length;
            if (end < text.length) span.appendChild(document.createTextNode(text.substring(end)));
            // 在原文本节点前插入 span，然后清空原文本节点
            if (utils.isNodeAttached(textNode)) {
                textNode.parentNode.insertBefore(span, textNode);
                textNode.textContent = '';
            }
        }
    } catch (e) {}
}

/**
 * 清理文本节点中的系统注入标记（系统指令 + 系统记忆 + 能力说明）
 * 直接修改 textContent，不改变 DOM 结构，避免 React removeChild 错误
 * @param {Text} textNode
 */
function cleanPromptInjection(textNode) {
    const text = textNode.textContent;
    if (!text) return;
    // 检测 [系统指令] / [系统记忆] / [能力] 任一标记
    if (!text.includes('[系统指令]') && !text.includes('[系统记忆]') && !text.includes('[能力]')) return;
    // 移除 [系统指令]...[/系统指令]、[系统记忆]...[/系统记忆]、[能力]...[/能力] 标记及后面的空白
    const cleaned = text
        .replace(/\[系统指令\][\s\S]*?\[\/系统指令\]\s*/g, '')
        .replace(/\[系统记忆\][\s\S]*?\[\/系统记忆\]\s*/g, '')
        .replace(/\[能力\][\s\S]*?\[\/能力\]\s*/g, '');
    if (cleaned !== text) {
        textNode.textContent = cleaned;
    }
}

/**
 * 解析生效的工具名集合（统一工具名来源）
 *
 * 优先级：window._dsToolNames（运行时覆盖，由 capability-register.js 挂载）>
 *         import 的 TOOL_NAMES（动态数组，通过 splice 与 registry 同步）
 *
 * 两来源均指向同一数组引用（capability-register.js 在 initCapabilityRegister 时
 * 将 TOOL_NAMES 赋给 window._dsToolNames），因此动态注册的 MCP 工具
 * （mcp__server__tool 格式）会被自动识别。
 *
 * @returns {string[]} 生效的工具名数组
 */
function _resolveToolNames() {
    if (typeof window !== 'undefined' &&
        Array.isArray(window._dsToolNames) &&
        window._dsToolNames.length > 0) {
        return window._dsToolNames;
    }
    return TOOL_NAMES;
}

/**
 * 检测文本是否包含工具调用 XML 片段（开标签或闭标签）
 *
 * 替代原硬编码的 memory_* 列表（行 485-498），支持动态工具名与 MCP 工具名。
 *
 * 实现：
 *   1. 调用 streaming-tool-parser.js 的 isToolCallStarting 做开标签预判
 *      （复用流式解析器的跨 chunk 前缀检测逻辑，作为 Phase 6 集成点）
 *   2. 补充检测闭标签 </tool_name>（isToolCallStarting 只检测开标签，
 *      闭标签需单独检测，用于清理"孤立的闭标签"流式残留）
 *
 * @param {string} text - 待检测文本
 * @returns {boolean} true 表示文本包含工具调用片段
 */
function _hasToolFragment(text) {
    if (!text) return false;
    const toolNames = _resolveToolNames();
    if (toolNames.length === 0) return false;
    // 1. 用流式解析器做开标签预判（含跨 chunk 不完整前缀检测）
    if (isToolCallStarting(text, toolNames)) return true;
    // 2. 补充检测闭标签（isToolCallStarting 只检测开标签）
    for (const name of toolNames) {
        if (text.includes('</' + name)) return true;
    }
    return false;
}

/**
 * 判断文本节点所属的消息是否为 AI 助手消息
 *
 * DeepSeek 的 DOM 结构区分（参考 token-speed.js 的 isAssistantMessage）：
 *   - 用户消息：.ds-message 包含 d29f3d7d 类，或父容器是 _9663006
 *   - AI 助手消息：.ds-message 不含 d29f3d7d，父容器是 _4f9bf79
 *
 * 用于区分用户消息和 AI 消息，确保用户消息不会被 AI 废弃数据清理逻辑误删
 *
 * @param {Text} textNode - 文本节点
 * @returns {boolean} true 表示是 AI 助手消息
 */
function _isAssistantMessage(textNode) {
    if (!textNode || !textNode.parentElement) return false;
    const messageEl = textNode.parentElement.closest('.ds-message, [data-message-id]');
    if (!messageEl) {
        // 无法确定消息类型时，保守处理：视为 AI 消息（允许清理）
        return true;
    }
    // 用户消息的 .ds-message 总是包含 d29f3d7d 类
    if (messageEl.classList.contains('d29f3d7d')) return false;
    // 助手消息的父容器是 _4f9bf79
    const parent = messageEl.parentElement;
    if (parent && parent.classList.contains('_4f9bf79')) return true;
    // 回退：检查助手特征元素
    return !!(
        messageEl.querySelector('.ds-markdown') ||
        messageEl.querySelector('.ds-assistant-message-main-content') ||
        messageEl.querySelector('[class*="answer"]')
    );
}

/**
 * 清理 agent 续跑 prompt 并替换为可见的 Agent 徽章
 *
 * agent 续跑 prompt 是 capability-agent.js 自动发送的消息，包含：
 *   - __ds_agent_continuation__ 标记
 *   - <original_task> 原始用户任务
 *   - <tool_results> 工具调用结果
 *
 * 处理策略（标记为 agent 自主产生，而非完全隐藏）：
 *   - 清除原始续跑文本（<original_task>/<tool_results>/标记等内部数据）
 *   - 在消息容器中插入可见的 Agent 徽章，标明"此消息由 Agent 自主产生"
 *   - 徽章显示工具调用摘要（如"保存记忆 · 审查记忆"等）
 *
 * 安全策略：
 *   - 只处理包含完整续跑标记的消息（__ds_agent_continuation__ 或 <original_task> + <tool_results>）
 *   - 不会误处理普通用户消息（普通用户消息不含这些标记）
 *
 * @param {Text} textNode - 文本节点
 */
function cleanContinuationPrompt(textNode) {
    const text = textNode.textContent;
    if (!text) return;

    // 情况0：v2 边界标记检测（优先处理，最可靠）
    // v2 标记 __DS_AGENT_V2_START__ ... __DS_AGENT_V2_END__ 包裹整个续跑 prompt
    // 刷新后仍能稳定识别，解决 v1 末尾标记可能被截断的问题
    if (text.includes(AGENT_V2_START_MARKER) || text.includes(AGENT_V2_END_MARKER)) {
        const toolSummary = _extractToolSummaryFromContinuation(text);
        // 移除 v2 边界标记及内部所有续跑数据
        const strippedText = text
            .replace(/__DS_AGENT_V2_START__[\s\S]*?__DS_AGENT_V2_END__/g, '')
            .replace(/__DS_AGENT_V2_START__/g, '')
            .replace(/__DS_AGENT_V2_END__/g, '')
            .replace(/<tool_results>[\s\S]*?<\/tool_results>/g, '')
            .replace(/<original_task>[\s\S]*?<\/original_task>/g, '')
            .replace(/<user_answers>[\s\S]*?<\/user_answers>/g, '')
            .replace(/<todo_status>[\s\S]*?<\/todo_status>/g, '')
            .replace(/<reminder>[\s\S]*?<\/reminder>/g, '')
            .replace(/__ds_agent_continuation__/g, '')
            .replace(/\s+/g, ' ')
            .trim();

        if (strippedText.length <= 3) {
            // 文本完全由 v2 标记包裹的续跑数据构成：替换为不可见占位符，插入徽章
            textNode.textContent = '\u2063\u2064\u2063';
            _insertAgentBadge(textNode, toolSummary || '工具调用');
        } else {
            // 文本包含其他内容：只清理续跑标记和标签，保留其他文本
            let cleaned = text
                .replace(/__DS_AGENT_V2_START__[\s\S]*?__DS_AGENT_V2_END__/g, '')
                .replace(/__DS_AGENT_V2_START__/g, '')
                .replace(/__DS_AGENT_V2_END__/g, '')
                .replace(/<tool_results>[\s\S]*?<\/tool_results>/g, '')
                .replace(/<original_task>[\s\S]*?<\/original_task>/g, '')
                .replace(/<user_answers>[\s\S]*?<\/user_answers>/g, '')
                .replace(/<todo_status>[\s\S]*?<\/todo_status>/g, '')
                .replace(/<reminder>[\s\S]*?<\/reminder>/g, '')
                .replace(/__ds_agent_continuation__/g, '')
                .replace(/\n{3,}/g, '\n\n')
                .trim();
            textNode.textContent = cleaned;
            _insertAgentBadge(textNode, toolSummary || '工具调用');
        }
        return;
    }

    // 情况1：history-cleanup.js 已将续跑 prompt 替换为 [Agent 自主产生|...] 标记文本
    // 此时直接渲染为 Agent 徽章（文本格式：[Agent 自主产生|工具摘要] 或 [Agent 自主产生]）
    const badgeMarkerMatch = text.match(/^\[Agent 自主产生(?:\|([^\]]*))?\]$/);
    if (badgeMarkerMatch) {
        const toolSummary = badgeMarkerMatch[1] || '工具调用';
        // 替换为不可见占位符，然后插入徽章
        textNode.textContent = '\u2063\u2064\u2063';
        _insertAgentBadge(textNode, toolSummary);
        return;
    }

    // 情况2：包含 <tool_results> 标签（无论是否有其他续跑标记）
    // <tool_results> 是 agent 续跑 prompt 的核心标志，单独出现也应处理
    // 可能场景：续跑 prompt 被部分截断、AI 模仿格式输出、历史消息加载残留
    if (text.includes('<tool_results>')) {
        // 从续跑 prompt 中提取工具调用摘要（用于徽章显示）
        const toolSummary = _extractToolSummaryFromContinuation(text);

        // 检查文本是否**完全由** <tool_results> 构成（纯续跑数据，应替换为徽章）
        // 还是 <tool_results> 只是文本的一部分（混合内容，只清理标签）
        const strippedText = text
            .replace(/<tool_results>[\s\S]*?<\/tool_results>/g, '')
            .replace(/<original_task>[\s\S]*?<\/original_task>/g, '')
            .replace(/__ds_agent_continuation__/g, '')
            .replace(/\s+/g, ' ')
            .trim();

        if (strippedText.length <= 3) {
            // 文本完全由续跑数据构成：替换为不可见占位符，插入 Agent 徽章
            textNode.textContent = '\u2063\u2064\u2063';
            _insertAgentBadge(textNode, toolSummary);
        } else {
            // 文本包含其他内容：只清理 <tool_results> 等标签，保留其他文本
            let cleaned = text
                .replace(/<tool_results>[\s\S]*?<\/tool_results>/g, '')
                .replace(/<original_task>[\s\S]*?<\/original_task>/g, '')
                .replace(/__ds_agent_continuation__/g, '')
                .replace(/\n{3,}/g, '\n\n')
                .trim();
            textNode.textContent = cleaned;
            // 仍然插入徽章（标明此处有 agent 数据被清理）
            _insertAgentBadge(textNode, toolSummary);
        }
        return;
    }

    // 情况3：包含 <original_task> 但不包含 <tool_results>（部分残留）
    if (text.includes('<original_task>') || text.includes('__ds_agent_continuation__')) {
        const toolSummary = _extractToolSummaryFromContinuation(text);
        let cleaned = text
            .replace(/<original_task>[\s\S]*?<\/original_task>/g, '')
            .replace(/__ds_agent_continuation__/g, '')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
        if (cleaned.length <= 3) {
            textNode.textContent = '\u2063\u2064\u2063';
            _insertAgentBadge(textNode, toolSummary || '工具调用');
        } else {
            textNode.textContent = cleaned;
            _insertAgentBadge(textNode, toolSummary || '工具调用');
        }
        return;
    }
}

/**
 * 从续跑 prompt 文本中提取工具调用摘要
 *
 * 解析 <tool_results> JSON 数组，提取每个工具的 name 和 summary
 * 用于在 Agent 徽章上显示"做了什么"
 *
 * @param {string} text - 续跑 prompt 全文
 * @returns {string} 工具摘要文本（如"保存记忆 · 审查记忆"）
 */
function _extractToolSummaryFromContinuation(text) {
    try {
        const match = text.match(/<tool_results>([\s\S]*?)<\/tool_results>/);
        if (!match) return '工具调用';
        const results = JSON.parse(match[1].trim());
        if (!Array.isArray(results) || results.length === 0) return '工具调用';
        // 提取每个工具的 name，最多显示 3 个
        const names = results.slice(0, 3).map(r => r.tool || r.name || '未知').filter(Boolean);
        const labelMap = {
            memory_save: '保存记忆',
            memory_update: '更新记忆',
            memory_delete: '删除记忆',
            memory_import_preview: '预览导入',
            memory_merge: '融合记忆',
            memory_review: '审查记忆',
            memory_recall: '报告调用'
        };
        const summary = names.map(name => labelMap[name] || name);
        if (results.length > 3) summary.push('+' + (results.length - 3));
        return summary.join(' · ');
    } catch (e) {
        return '工具调用';
    }
}

/**
 * 在消息容器中插入可见的 Agent 徽章
 *
 * 徽章样式：紫色渐变背景，带机器人图标和"Agent 自主产生"文字
 * 显示工具调用摘要，让用户知道 agent 做了什么
 *
 * @param {Node} referenceNode - 参考节点（用于定位消息容器）
 * @param {string} toolSummary - 工具调用摘要文本
 */
function _insertAgentBadge(referenceNode, toolSummary) {
    if (!referenceNode || !referenceNode.parentElement) return;
    try {
        // 向上查找消息容器（.ds-message 或带 data-message-id 的元素）
        const messageEl = referenceNode.parentElement.closest('.ds-message, [data-message-id]') ||
            referenceNode.parentElement.closest('[data-virtual-list-item-key]');
        if (!messageEl) return;
        // 避免重复插入
        if (messageEl.querySelector('.ds-agent-badge')) return;

        const badge = document.createElement('div');
        badge.className = 'ds-agent-badge';
        badge.innerHTML = `
            <div class="ds-agent-badge-icon">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M8 1.5C5.5 1.5 3.5 3.5 3.5 6v2H3a1 1 0 0 0-1 1v3a1 1 0 0 0 1 1h1v1a1 1 0 0 0 2 0v-1h4v1a1 1 0 0 0 2 0v-1h1a1 1 0 0 0 1-1V9a1 1 0 0 0-1-1h-.5V6c0-2.5-2-4.5-4.5-4.5z" fill="currentColor"/>
                    <circle cx="6" cy="8" r="1" fill="#fff"/>
                    <circle cx="10" cy="8" r="1" fill="#fff"/>
                </svg>
            </div>
            <div class="ds-agent-badge-content">
                <span class="ds-agent-badge-title">Agent 自主产生</span>
                <span class="ds-agent-badge-summary">${toolSummary}</span>
            </div>
        `;
        // 插入到消息容器的最前面
        messageEl.insertBefore(badge, messageEl.firstChild);
    } catch (e) {}
}

/**
 * 清理 AI 输出的废弃数据
 *
 * 参考 deepseek-pp 的处理策略：
 *   1. streaming-tool-text.ts：流式输出时实时抑制工具调用 XML（含未完成片段）
 *   2. prompt/visibility.ts:sanitizeInternalPromptText：清理工具格式提醒
 *   3. history-cleanup.ts:stripToolBlocksFromText：移除工具调用块
 *
 * 安全策略（确保不清理 AI 的正常回复数据）：
 *   - 只处理 AI 助手消息（_isAssistantMessage 返回 true）
 *   - 不处理普通用户消息（避免误删用户输入的内容）
 *   - agent 续跑 prompt 由 cleanContinuationPrompt 单独处理
 *   - 工具调用 XML：始终清理（这是"调用数据"）
 *   - 能力说明段落：只在文本**完全由能力说明组成**时才清理
 *     （如果文本中还有其他实质内容，说明 AI 在正常回复中引用了能力说明，不清理）
 *
 * @param {Text} textNode - 文本节点
 */
function cleanAIWasteData(textNode) {
    const text = textNode.textContent;
    if (!text) return;

    // 安全检查：只处理 AI 助手消息
    // 用户消息（包括 agent 续跑 prompt）不经过此函数，避免误删
    if (!_isAssistantMessage(textNode)) return;

    // 快速检测：包含能力说明标记或工具标签碎片
    const hasCapabilityMarker = text.includes('工具调用格式') ||
        text.includes('可用工具') ||
        text.includes('你可以通过输出 XML 标签来调用工具');
    // 工具碎片检测：使用动态工具名（含 MCP 工具 mcp__server__tool 格式），
    // 替代原硬编码的 7 个 memory_* 列表，与 scanToolCallElements 工具名来源一致
    const hasToolFragment = _hasToolFragment(text);
    // 检测续跑数据标签（<tool_results> / <original_task> / 续跑标记 / v2 边界标记）
    // AI 可能直接输出这些标签（模仿格式），需要清理
    const hasContinuationData = text.includes('<tool_results>') ||
        text.includes('</tool_results>') ||
        text.includes('<original_task>') ||
        text.includes('</original_task>') ||
        text.includes('__ds_agent_continuation__') ||
        text.includes(AGENT_V2_START_MARKER) ||
        text.includes(AGENT_V2_END_MARKER);
    if (!hasCapabilityMarker && !hasToolFragment && !hasContinuationData) return;

    // ===== 整消息容器清理兜底（修复 2：跨段落 XML 清理）=====
    // 当工具调用 XML 被跨段落拆分时，单 textNode 清理失效。
    // 此处检查 textNode 所属消息容器是否含跨段落工具调用 XML：
    //   - 若 _processMessageForToolCalls 已处理（dsToolProcessed 标记）：
    //     调 _stripToolCallFragmentsAcrossParagraphs(stripFullXml=false) 清理残留孤立片段
    //   - 若 _processMessageForToolCalls 尚未处理：
    //     跳过工具调用 XML 清理（避免误删 _processMessageForToolCalls 需要的 XML），
    //     只清理能力说明段落和续跑数据标签
    let skipToolFragmentClean = false;
    try {
        const messageContainer = _findMessageContainer(textNode);
        if (messageContainer) {
            const fullText = messageContainer.textContent || '';
            if (fullText && fullText.length >= 10 && _hasToolFragment(fullText)) {
                if (messageContainer.dataset.dsToolProcessed === 'true') {
                    // _processMessageForToolCalls 已处理，清理残留孤立片段（不含完整 XML）
                    const toolNames = _resolveToolNames();
                    if (toolNames.length > 0) {
                        _stripToolCallFragmentsAcrossParagraphs(messageContainer, toolNames, { stripFullXml: false });
                    }
                } else {
                    // 含跨段落工具调用 XML，但 _processMessageForToolCalls 尚未处理
                    // 跳过工具调用 XML 清理（让 _processMessageForToolCalls 处理）
                    skipToolFragmentClean = true;
                }
            }
        }
    } catch (e) {
        // 整消息清理失败时回退到单 textNode 清理（保持向后兼容）
    }

    let cleaned = text;

    // 1. 移除工具调用 XML（这是"调用数据"，始终清理）
    // 参考 deepseek-pp 的 streaming-tool-text.ts：流式输出时检测到开标签即进入 SUPPRESSING 状态
    // 处理三种情况：
    //   - 完整的 XML（有开闭标签）：移除（已由 scanToolCallElements 执行）
    //   - 孤立的闭标签：移除（流式残留）
    //   - 未闭合的开标签 + 可解析的 JSON：移除（缺少闭标签的工具调用）
    //   - 未闭合的开标签 + 不可解析的 JSON：不处理，留给 scanToolCallElements 等待
    if (hasToolFragment && !skipToolFragmentClean) {
        const toolNames = _resolveToolNames();
        if (toolNames.length > 0) {
            // 只移除完整的工具调用 XML（已执行但 textContent 残留）
            const fullPattern = new RegExp(
                '<(' + toolNames.join('|') + ')>[\\s\\S]*?</\\1>',
                'g'
            );
            cleaned = cleaned.replace(fullPattern, '');

            // 只移除孤立的闭标签（没有对应开标签的闭标签）
            for (const name of toolNames) {
                const openTag = '<' + name + '>';
                const closeTag = '</' + name + '>';
                if (!cleaned.includes(openTag) && cleaned.includes(closeTag)) {
                    cleaned = cleaned.replace(new RegExp(closeTag.replace(/[<>/]/g, '\\$&'), 'g'), '');
                }
            }

            // 处理未闭合的开标签：隐藏 textNode 所在元素，不修改 textContent
            //
            // 关键修复：原逻辑移除未闭合开标签后的内容会导致流式输出累积被破坏，
            // 当闭标签 </tool_name> 到达时，开标签和参数 JSON 已被清理，
            // scanToolCallElements 无法识别完整 XML，工具不会被执行。
            //
            // 新策略：检测到未闭合的开标签时，隐藏 textNode 所在的段落元素（display:none），
            // 不修改 textContent。这样：
            //   1. 用户看不到暴露的工具调用参数（视觉隐藏）
            //   2. textContent 保持完整，流式输出正常累积
            //   3. 闭标签到达后 scanToolCallElements 能识别完整 XML 并执行工具
            //   4. 工具执行后 _processParagraphForToolCalls 会清理 XML 并恢复显示
            for (const name of toolNames) {
                const openTag = '<' + name + '>';
                const closeTag = '</' + name + '>';
                // 只处理有开标签但无闭标签的情况
                if (!cleaned.includes(openTag) || cleaned.includes(closeTag)) continue;

                // 隐藏 textNode 所在的段落元素，不修改 textContent
                // 保护流式输出累积过程，等闭标签到达后由 scanToolCallElements 处理
                const parentEl = textNode.parentElement;
                if (parentEl) {
                    parentEl.style.display = 'none';
                }
                // 不修改 cleaned，保持 textContent 完整
                return;
            }

            // 处理不完整的开标签前缀（跨 chunk 残片，如 "<web_sea" 或 "<memory_sav"）
            // 流式输出中开标签可能被拆分到多个 chunk，不完整前缀也会暴露在页面上
            // 同样采用隐藏策略，不修改 textContent
            const lastLt = cleaned.lastIndexOf('<');
            if (lastLt !== -1) {
                const tail = cleaned.slice(lastLt);
                // tail 不含 '>'，说明是未完成的开标签
                if (tail.indexOf('>') === -1) {
                    for (const name of toolNames) {
                        const prefix = '<' + name;
                        // tail 是某个工具开标签的前缀（如 "<web_sea" 是 "<web_search>" 的前缀）
                        if (prefix.startsWith(tail) || tail.startsWith(prefix)) {
                            // 隐藏 textNode 所在的段落元素，不修改 textContent
                            const parentEl = textNode.parentElement;
                            if (parentEl) {
                                parentEl.style.display = 'none';
                            }
                            return;
                        }
                    }
                }
            }
        }
    }

    // 1.5 移除续跑数据标签（<tool_results> / <original_task> / 续跑标记 / v2 边界标记）
    // 这些标签是 agent 续跑 prompt 的内部数据，AI 可能直接输出（模仿格式）
    // 始终清理这些标签，避免内部数据外露
    if (hasContinuationData) {
        cleaned = cleaned
            .replace(/__DS_AGENT_V2_START__[\s\S]*?__DS_AGENT_V2_END__/g, '')
            .replace(/__DS_AGENT_V2_START__/g, '')
            .replace(/__DS_AGENT_V2_END__/g, '')
            .replace(/<tool_results>[\s\S]*?<\/tool_results>/g, '')
            .replace(/<original_task>[\s\S]*?<\/original_task>/g, '')
            .replace(/__ds_agent_continuation__/g, '')
            // 处理未闭合的标签（只有开标签没有闭标签）
            .replace(/<tool_results>[^\n]*$/g, '')
            .replace(/<original_task>[^\n]*$/g, '');
    }

    // 2. 移除重复的能力说明段落（参考 deepseek-pp 的 isToolReminderOnly）
    // AI 有时会重复输出注入的 [能力] 提示词内容
    //
    // 安全策略：只在文本**完全由能力说明组成**时才清理
    //   - 先模拟清理能力说明，检查清理后是否还有实质内容
    //   - 如果清理后文本为空或极短（≤10字符），说明是纯废弃数据，执行清理
    //   - 如果清理后仍有实质内容，说明 AI 在正常回复中引用了能力说明，不清理
    //     （保护 AI 的正常回复数据不被误删）
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
        // 这样可以避免误删 AI 正常回复中引用的能力说明文本
        if (testCleaned.length <= 10) {
            cleaned = testCleaned;
        }
    }

    // 清理多余空白
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();

    if (cleaned !== text) {
        textNode.textContent = cleaned;
    }

    // 清理完文本后，检查消息容器是否变空，若空则隐藏整个容器
    cleanupEmptyMessageContainer(textNode);
}

/**
 * 清理空的 AI 消息容器（agent 废弃数据清理的最后一层）
 *
 * 当 cleanAIWasteData / cleanContinuationPrompt 清理完文本节点后，
 * 消息容器可能变成空白或仅剩占位符。这种空消息容器会显示为空白气泡，
 * 严重影响界面整洁。
 *
 * 清理策略（从最大对话框开始）：
 *   1. 从 textNode 向上查找最大的消息容器：
 *      - AI 消息：div._4f9bf79[data-virtual-list-item-key]（最大对话框容器）
 *      - 用户消息（agent 续跑）：div._9663006[data-virtual-list-item-key]
 *   2. 检查容器内的可见文本内容（排除占位符、零宽字符、纯空白）
 *   3. 如果容器内容为空，用 style.display = 'none' 隐藏整个容器
 *      （不删除 DOM 节点，避免 React 状态不一致）
 *
 * 安全策略：
 *   - 只隐藏 AI 消息容器（_4f9bf79）和 agent 续跑消息容器（_9663006 且含续跑标记）
 *   - 不隐藏普通用户消息容器（保护用户输入）
 *   - 检查容器内是否有工具调用卡片（.ds-tool-call-card），有则不隐藏
 *   - 检查容器内是否有实质文本内容（长度 > 3 的可见文本），有则不隐藏
 *
 * @param {Text} textNode - 被清理的文本节点
 */
function cleanupEmptyMessageContainer(textNode) {
    if (!textNode || !textNode.parentElement) return;

    // 向上查找最大的消息容器
    // 优先查找带 data-virtual-list-item-key 的容器（桌面端虚拟列表项）
    let messageContainer = textNode.parentElement.closest('[data-virtual-list-item-key]');
    // WebView 回退：移动端无 data-virtual-list-item-key，直接查找 .ds-message
    if (!messageContainer) {
        messageContainer = textNode.parentElement.closest('.ds-message');
    }
    if (!messageContainer) return;

    // 判断容器类型（WebView 兼容：不依赖 CSS module 类名 _4f9bf79 / _9663006）
    const isAIContainer = _isAIContainer(messageContainer);
    const isUserContainer = !isAIContainer && messageContainer.classList.contains('_9663006');

    // 只处理 AI 消息容器和用户消息容器（agent 续跑）
    if (!isAIContainer && !isUserContainer) return;

    // 用户消息容器：只清理 agent 续跑产生的空消息
    // 检查容器内是否包含续跑标记或占位符（含 v2 边界标记）
    if (isUserContainer) {
        const containerText = messageContainer.textContent || '';
        const hasContinuationMarker = containerText.includes('__ds_agent_continuation__') ||
            containerText.includes(AGENT_V2_START_MARKER) ||
            containerText.includes(AGENT_V2_END_MARKER) ||
            containerText.includes('\u2063\u2064\u2063') ||
            (containerText.includes('<original_task>') && containerText.includes('<tool_results>'));
        // 含 Agent 徽章的容器也是 agent 续跑消息（清理后只剩徽章+占位符），需要清理
        const hasAgentBadge = !!messageContainer.querySelector('.ds-agent-badge');
        if (!hasContinuationMarker && !hasAgentBadge) return; // 普通用户消息不清理
    }

    // 检查容器内是否有工具调用卡片（有卡片说明工具调用已执行，不隐藏）
    if (messageContainer.querySelector('.ds-tool-call-card')) return;
    // 检查容器内是否有工具调用 notice（增量渲染的 notice 容器，说明工具已执行）
    // 修复 bug：AI 回复只含工具调用 XML 时，清理 XML 后文本为空，但工具已执行，
    // notice 容器存在，此时不应隐藏消息（工具调用是 AI 的有效行为）
    if (messageContainer.querySelector('.ds-tool-call-notice')) return;
    // 检查容器内是否有 Agent 徽章（agent 续跑消息标记，有徽章说明是 agent 消息）
    // agent 消息的清理由专门的 _cleanupAgentResidualMessages 处理，此处不隐藏
    if (messageContainer.querySelector('.ds-agent-badge')) return;

    // 关键修复：含未处理工具调用 XML 的容器不隐藏
    // 刷新后 AI 消息含工具调用 XML，cleanAIWasteData 清理 XML 后 visibleText 为空，
    // 但工具调用尚未被 scanToolCallElements 执行（异步流程）。
    // 如果此时隐藏容器，工具调用永远无法执行，AI 消息也会消失。
    // 策略：检测容器 textContent 是否含工具调用 XML，含则跳过隐藏，等工具执行完再决定。
    const containerRawText = messageContainer.textContent || '';
    if (containerRawText && _hasToolFragment(containerRawText)) {
        return;
    }

    // 检查容器内的可见文本内容（排除占位符、零宽字符、纯空白）
    const visibleText = (messageContainer.textContent || '')
        .replace(/\u2063/g, '')  // 移除不可见占位符
        .replace(/\u2064/g, '')  // 移除不可见占位符
        .replace(/\u200b/g, '')  // 移除零宽空格
        .replace(/\u200c/g, '')  // 移除零宽非连接符
        .replace(/\u200d/g, '')  // 移除零宽连接符
        .replace(/\s+/g, ' ')    // 压缩空白
        .trim();

    // 如果可见文本为空或极短（≤3字符），隐藏整个容器
    if (visibleText.length <= 3) {
        // 关键修复：刷新后工具调用 XML 已被 history-cleanup 清除，
        // cleanupEmptyMessageContainer 在 _restoreToolCallNoticeFromStorage 之前执行，
        // 导致 AI 消息容器被隐藏后，恢复的 notice 卡片不可见。
        // 策略：检查 sessionStorage 中是否存有待恢复的工具调用结果，有则跳过隐藏，
        // 让 _restoreToolCallNoticeFromStorage 后续恢复 notice 卡片。
        if (isAIContainer && _hasPendingToolResultsInStorage(messageContainer)) {
            return;
        }
        // 检查是否已被隐藏，避免重复操作
        if (messageContainer.style.display !== 'none') {
            messageContainer.style.display = 'none';
        }
    }
}

/**
 * 清理 Agent 残留消息
 *
 * agent 续跑消息（用户消息容器 _9663006）在 cleanContinuationPrompt 处理后
 * 只剩 ds-agent-badge + 占位符（\u2063\u2064\u2063），用户要求完全隐藏这类消息。
 *
 * 清理策略：
 *   - 扫描含 ds-agent-badge 的消息容器（data-virtual-list-item-key）
 *   - 检查容器内是否有实质文本内容（排除占位符、零宽字符、纯空白）
 *   - 若无实质文本，用 style.display = 'none' 隐藏整个容器
 *   - 不删除 DOM 节点（遵守 project_memory 硬约束：不删除 React 管理的 DOM 节点）
 *
 * 安全策略：
 *   - 只处理含 ds-agent-badge 的容器（明确是 agent 消息）
 *   - 有实质文本的容器不隐藏（可能 AI 在 agent 消息后有正常回复）
 *   - 有工具调用 notice/card 的容器不隐藏（工具已执行）
 *
 * @param {Element} root - 扫描根元素
 */
function _cleanupAgentResidualMessages(root) {
    if (!root) return;
    // 查找所有含 ds-agent-badge 的消息容器
    const badges = root.querySelectorAll('.ds-agent-badge');
    for (const badge of badges) {
        // 向上查找消息容器：优先 data-virtual-list-item-key（桌面端），回退 .ds-message（WebView）
        let container = badge.closest('[data-virtual-list-item-key]');
        if (!container) {
            container = badge.closest('.ds-message');
        }
        if (!container) continue;
        // 已隐藏则跳过
        if (container.style.display === 'none') continue;
        // 有工具调用 notice/card 则不隐藏（工具已执行，消息有意义）
        if (container.querySelector('.ds-tool-call-notice')) continue;
        if (container.querySelector('.ds-tool-call-card')) continue;
        // 检查可见文本内容（排除占位符、零宽字符、纯空白）
        // 关键修复：同时排除 .ds-agent-badge 子树的文本，
        // 否则 badge 内的"Agent 自主产生工具调用"会让 visibleText 长度 > 3，
        // 导致 agent 续跑消息容器无法被隐藏（徽章泄漏问题）
        const visibleText = _getVisibleTextExcluding(container, '.ds-agent-badge');
        // 可见文本为空或极短（≤3字符），隐藏整个容器
        if (visibleText.length <= 3) {
            container.style.display = 'none';
        }
    }
}

/**
 * 计算容器内的可见文本，排除指定选择器匹配的子树
 *
 * 用于 _cleanupAgentResidualMessages 和 cleanupEmptyMessageContainer：
 *   - agent 续跑消息清理后只剩 ds-agent-badge + 占位符
 *   - 计算 visibleText 时需排除 badge 文本（"Agent 自主产生"等），
 *     否则 visibleText 长度 > 3，容器无法被隐藏，导致徽章泄漏
 *
 * 实现：克隆容器，从克隆中移除匹配元素，再读 textContent
 * 性能：仅在小范围（单个消息容器）执行，性能可接受
 *
 * @param {Element} container - 容器元素
 * @param {string} excludeSelector - 需排除的子元素选择器
 * @returns {string} 排除指定子树后的可见文本（已清理占位符和空白）
 */
function _getVisibleTextExcluding(container, excludeSelector) {
    if (!container) return '';
    try {
        // cloneNode(true) 深克隆，避免修改原 DOM
        const clone = container.cloneNode(true);
        // 从克隆中移除需排除的子树
        if (excludeSelector) {
            const excluded = clone.querySelectorAll(excludeSelector);
            excluded.forEach(el => el.remove());
        }
        // 计算可见文本（排除占位符、零宽字符、纯空白）
        return (clone.textContent || '')
            .replace(/\u2063/g, '')  // 移除不可见占位符
            .replace(/\u2064/g, '')  // 移除不可见占位符
            .replace(/\u200b/g, '')  // 移除零宽空格
            .replace(/\u200c/g, '')  // 移除零宽非连接符
            .replace(/\u200d/g, '')  // 移除零宽连接符
            .replace(/\s+/g, ' ')    // 压缩空白
            .trim();
    } catch (e) {
        return '';
    }
}

// ============================================================
// 工具调用结果持久化（修复刷新后 notice 卡片丢失）
// ============================================================

/** 存储 key 前缀 */
const TOOL_RESULTS_STORAGE_PREFIX = 'ds_tool_results_';
/** 单条存储的最大长度（避免超出存储容量限制） */
const TOOL_RESULTS_STORAGE_MAX_LEN = 100000;
/** 存储的版本号（用于后续格式升级） */
const TOOL_RESULTS_STORAGE_VERSION = 1;

/**
 * 检测 sessionStorage 是否真正可用（不仅存在对象，还能正常读写）
 *
 * Android WebView 中，若未设置 domStorageEnabled=true，
 * sessionStorage 对象可能存在但 getItem/setItem 会抛异常。
 * 此函数通过实际读写测试确认可用性。
 *
 * @returns {boolean} true 表示 sessionStorage 可正常使用
 */
let _sessionStorageAvailable = null;
function _isSessionStorageAvailable() {
    if (_sessionStorageAvailable !== null) return _sessionStorageAvailable;
    if (typeof sessionStorage === 'undefined') {
        _sessionStorageAvailable = false;
        return false;
    }
    try {
        const testKey = '__ds_stg_test__';
        sessionStorage.setItem(testKey, '1');
        const val = sessionStorage.getItem(testKey);
        sessionStorage.removeItem(testKey);
        _sessionStorageAvailable = (val === '1');
        return _sessionStorageAvailable;
    } catch (e) {
        _sessionStorageAvailable = false;
        return false;
    }
}

/**
 * 获取存储后端（优先 sessionStorage，不可用时回退到 window.name）
 *
 * window.name 在页面刷新后仍然存在（同一 tab/WebView 内），
 * 可用作 session 级存储。数据格式：_ds_storage_ + JSON 序列化的键值对。
 *
 * 注意：window.name 是同步的，但容量有限（~2MB），且所有键值对共享。
 *
 * @returns {{ getItem, setItem, removeItem }} 类 Storage 接口
 */
function _getStorageBackend() {
    if (_isSessionStorageAvailable()) {
        return {
            getItem(key) { return sessionStorage.getItem(key); },
            setItem(key, value) { try { sessionStorage.setItem(key, value); } catch (e) {} },
            removeItem(key) { try { sessionStorage.removeItem(key); } catch (e) {} }
        };
    }
    // 回退：window.name 存储 JSON 键值对
    const _wnPrefix = '_ds_storage_';
    return {
        _load() {
            try {
                if (window.name && window.name.startsWith(_wnPrefix)) {
                    return JSON.parse(window.name.slice(_wnPrefix.length));
                }
            } catch (e) {}
            return {};
        },
        _save(data) {
            try {
                window.name = _wnPrefix + JSON.stringify(data);
            } catch (e) {}
        },
        getItem(key) {
            const data = this._load();
            return data[key] !== undefined ? data[key] : null;
        },
        setItem(key, value) {
            const data = this._load();
            data[key] = value;
            // 清理过期条目（超过 24 小时）
            const now = Date.now();
            for (const k of Object.keys(data)) {
                if (k.startsWith('_exp_') && now - parseInt(k.slice(5)) > 24 * 60 * 60 * 1000) {
                    delete data[k];
                }
            }
            this._save(data);
        },
        removeItem(key) {
            const data = this._load();
            delete data[key];
            this._save(data);
        }
    };
}

/**
 * 检测消息容器是否为 AI 助手消息（不依赖 CSS module 类名）
 *
 * WebView 兼容：移动端 DeepSeek 可能使用不同的 CSS module 哈希类名，
 * 因此不依赖 _4f9bf79 / _9663006 等固定类名判断。
 *
 * 检测策略（按优先级）：
 *   1. 查找容器内 .ds-message 元素，若含 d29f3d7d 类则为用户消息
 *   2. 查找容器内 .ds-markdown / .ds-assistant-message-main-content 等 AI 特征元素
 *   3. 回退到 _4f9bf79 类名检查（桌面端兼容）
 *
 * @param {Element} container - 消息容器（[data-virtual-list-item-key]）
 * @returns {boolean} true 表示是 AI 助手消息容器
 */
function _isAIContainer(container) {
    if (!container) return false;
    // 策略0：容器自身就是 .ds-message（WebView 移动端扁平结构）
    if (container.classList.contains('ds-message')) {
        if (container.classList.contains('d29f3d7d')) return false; // 用户消息
        return true; // AI 消息
    }
    // 策略1：检查 .ds-message 子元素（桌面端嵌套结构）
    const dsMsg = container.querySelector('.ds-message');
    if (dsMsg) {
        if (dsMsg.classList.contains('d29f3d7d')) return false; // 用户消息
        return true; // AI 消息
    }
    // 策略2：检查 AI 特征元素
    if (container.querySelector('.ds-markdown, .ds-assistant-message-main-content, [class*="answer"]')) {
        return true;
    }
    // 策略3：回退到已知的 CSS module 类名（桌面端）
    if (container.classList.contains('_4f9bf79')) return true;
    if (container.classList.contains('_9663006')) return false;
    // 策略4：无法判断时，保守处理：视为 AI 消息（允许恢复工具调用 notice）
    return true;
}

/**
 * 消息容器 → 累积工具调用结果的 WeakMap
 *
 * 流式输出过程中，_processMessageForToolCalls 可能被多次触发（每个工具调用 XML 到达时触发一次）。
 * 每次触发只处理当前已解析的 calls，但 textContent 在两次调用间会变化（XML 被清理），
 * 导致 sessionStorage 的 key 不一致，后一次保存会覆盖前一次。
 *
 * WeakMap 用于累积同一消息容器的所有工具调用结果，确保 sessionStorage 保存完整的 results。
 * WeakMap 不阻止 GC，消息容器被回收时自动清理。
 */
const _messageAccumulatedResults = new WeakMap();

/**
 * 计算消息容器的稳定哈希（用于 sessionStorage key）
 *
 * 使用消息文本前 200 字符 + 长度作为哈希，避免：
 *   - 完整文本过长导致 sessionStorage 膨胀
 *   - 不同消息的文本前缀碰撞
 *
 * 关键修复：计算 hash 前先清理所有工具调用 XML（包括未处理的），
 * 确保流式输出过程中多次保存（每次 textContent 不同）使用一致的 key。
 * 这样 WeakMap 累积逻辑才能正确工作（同一 messageContainer 的多次调用合并 results）。
 *
 * 哈希在流式输出后（XML 已清理）和刷新后（history-cleanup 已清理）一致，
 * 因为两者的 textContent 都是清理后的版本。
 *
 * @param {Element} messageContainer - 消息容器
 * @returns {string} 哈希字符串（如 "a1b2c3_150"）
 */
function _computeMessageHash(messageContainer) {
    if (!messageContainer) return '';
    try {
        let text = (messageContainer.textContent || '');
        // 清理所有工具调用 XML（确保 hash 一致性）
        // 流式输出过程中，textContent 可能包含未处理的工具调用 XML，
        // 清理后 hash 与刷新后（history-cleanup 已清理）一致
        const toolNames = _resolveToolNames();
        if (toolNames.length > 0) {
            const escapedNames = toolNames
                .map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
                .sort((a, b) => b.length - a.length);
            const nameAlternation = escapedNames.join('|');
            // 清理完整 XML、孤立开标签、孤立闭标签
            text = text.replace(new RegExp('<(' + nameAlternation + ')>[\\s\\S]*?</\\1>', 'g'), '');
            text = text.replace(new RegExp('<(' + nameAlternation + ')>', 'g'), '');
            text = text.replace(new RegExp('</(' + nameAlternation + ')>', 'g'), '');
        }
        // 清理占位符和空白
        text = text
            .replace(/\u2063/g, '')  // 移除不可见占位符
            .replace(/\u2064/g, '')
            .replace(/\u200b/g, '')
            .replace(/\s+/g, ' ')
            .trim();
        if (!text) return '';
        // 使用前 200 字符 + 长度作为哈希（简单但有效）
        const prefix = text.slice(0, 200);
        // 简单哈希函数：累加字符编码
        let hash = 0;
        for (let i = 0; i < prefix.length; i++) {
            hash = ((hash << 5) - hash + prefix.charCodeAt(i)) | 0;
        }
        return hash.toString(36) + '_' + text.length;
    } catch (e) {
        return '';
    }
}

/**
 * 获取消息容器的回退标识 key
 *
 * 当 AI 消息仅含工具调用 XML 时，textContent 清理后为空，
 * _computeMessageHash 返回 ''，无法用于存储存取。
 * 此函数使用容器的 data-virtual-list-item-key 属性作为回退标识，
 * 确保刷新后能恢复仅含工具调用的 AI 消息的 notice 卡片。
 *
 * WebView 兼容：移动端无 data-virtual-list-item-key，使用 .ds-message 在父元素中的索引。
 *
 * @param {Element} messageContainer - 消息容器
 * @returns {string} 回退 key，获取失败返回空字符串
 */
function _getContainerFallbackKey(messageContainer) {
    if (!messageContainer) return '';
    try {
        // 优先使用 data-virtual-list-item-key（桌面端）
        const itemKey = messageContainer.getAttribute('data-virtual-list-item-key');
        if (itemKey) return 'fb_' + itemKey;
        // WebView 回退1：使用 .ds-message 在父元素中的索引
        const parent = messageContainer.parentElement;
        if (parent) {
            // 尝试通过 data-virtual-list-item-key 属性查找兄弟节点（桌面端）
            const siblings = parent.querySelectorAll('[data-virtual-list-item-key]');
            for (let i = 0; i < siblings.length; i++) {
                if (siblings[i] === messageContainer) return 'fb_idx_' + i;
            }
            // WebView 回退2：通过 .ds-message 类名查找兄弟节点（移动端扁平结构）
            const dsMsgSiblings = parent.querySelectorAll('.ds-message');
            for (let i = 0; i < dsMsgSiblings.length; i++) {
                if (dsMsgSiblings[i] === messageContainer) return 'fb_dsmsg_' + i;
            }
        }
        return '';
    } catch (e) {
        return '';
    }
}

/**
 * 检查 sessionStorage 中是否存有待恢复的工具调用结果
 *
 * 用于 cleanupEmptyMessageContainer 在隐藏容器前做最终检查：
 * 刷新后工具调用 XML 已被 history-cleanup 清除，容器文本为空，
 * 但 sessionStorage 中可能存有之前保存的工具调用结果，
 * _restoreToolCallNoticeFromStorage 会在后续恢复 notice 卡片。
 * 若此时隐藏容器，恢复的卡片将不可见。
 *
 * @param {Element} messageContainer - 消息容器
 * @returns {boolean} true 表示有待恢复的工具结果
 */
function _hasPendingToolResultsInStorage(messageContainer) {
    try {
        const storage = _getStorageBackend();
        const hash = _computeMessageHash(messageContainer);
        // 使用回退 key（处理 AI 消息仅含工具调用 XML 的情况）
        const storageKey = hash || _getContainerFallbackKey(messageContainer);
        if (!storageKey) return false;
        const key = TOOL_RESULTS_STORAGE_PREFIX + storageKey;
        const json = storage.getItem(key);
        if (!json) return false;
        const data = JSON.parse(json);
        if (!data || data.version !== TOOL_RESULTS_STORAGE_VERSION) return false;
        // 过期检查：超过 24 小时不恢复
        if (data.savedAt && Date.now() - data.savedAt > 24 * 60 * 60 * 1000) return false;
        return Array.isArray(data.results) && data.results.length > 0;
    } catch (e) {
        return false;
    }
}

/**
 * 保存工具调用结果到 sessionStorage
 *
 * 在 _processMessageForToolCalls 末尾调用，将工具调用结果持久化，
 * 以便刷新后能从 sessionStorage 恢复 notice 卡片。
 *
 * 累积策略：使用 WeakMap 累积同一消息容器的多次工具调用结果，
 * 避免 流式输出过程中多次触发 _processMessageForToolCalls 时后一次覆盖前一次。
 *
 * 存储格式：{ version, savedAt, results: [{ label, toolName, ok, summary, detail, payload }] }
 * 跳过 todo_write 和 ask_user（这两类工具的卡片依赖运行时上下文，无法恢复）
 *
 * @param {Element} messageContainer - 消息容器
 * @param {Array} results - 本次工具调用结果数组
 */
function _saveToolResultsToStorage(messageContainer, results) {
    if (!messageContainer || !results || results.length === 0) return;
    try {
        // 跳过 todo_write 和 ask_user（卡片依赖运行时上下文）
        const saveable = results.filter(r =>
            r.toolName !== 'todo_write' && r.toolName !== 'ask_user'
        );
        if (saveable.length === 0) return;

        // 从 WeakMap 读取已累积的结果，合并本次 results
        const accumulated = _messageAccumulatedResults.get(messageContainer) || [];
        // 合并：追加本次 saveable（避免重复，按 toolName + summary 去重）
        for (const r of saveable) {
            const exists = accumulated.some(a =>
                a.toolName === r.toolName &&
                (a.result && r.result && a.result.summary === r.result.summary)
            );
            if (!exists) {
                accumulated.push(r);
            }
        }
        _messageAccumulatedResults.set(messageContainer, accumulated);

        const hash = _computeMessageHash(messageContainer);
        // 关键修复：当 AI 消息仅含工具调用 XML 时，textContent 清理后为空，hash 为 ''
        // 使用容器的 data-virtual-list-item-key 作为回退标识，确保刷新后能恢复 notice
        const storageKey = hash || _getContainerFallbackKey(messageContainer);
        if (!storageKey) return;

        const data = {
            version: TOOL_RESULTS_STORAGE_VERSION,
            savedAt: Date.now(),
            results: accumulated.map(r => ({
                label: r.label,
                toolName: r.toolName,
                ok: r.result && r.result.ok,
                summary: r.result && r.result.summary,
                detail: r.result && r.result.detail,
                payload: r.payload || null
            }))
        };
        const json = JSON.stringify(data);
        // 超出长度限制则跳过（避免存储溢出）
        if (json.length > TOOL_RESULTS_STORAGE_MAX_LEN) return;
        const storage = _getStorageBackend();
        storage.setItem(TOOL_RESULTS_STORAGE_PREFIX + storageKey, json);
    } catch (e) {
        // 存储不可用或已满，静默失败
    }
}

/**
 * 从存储中恢复工具调用 notice 卡片（WebView 兼容）
 *
 * 在 scanToolCallElements 入口调用，遍历所有 AI 消息容器，
 * 检查存储中是否有对应的工具调用结果，有则渲染 notice。
 *
 * WebView 兼容：
 *   - 使用 _getStorageBackend() 替代直接访问 sessionStorage
 *   - 使用 [data-virtual-list-item-key] + _isAIContainer 替代 ._4f9bf79 类名选择器
 *   - 恢复 notice 时自动显示被隐藏的容器（修复刷新后容器被 cleanupEmptyMessageContainer 隐藏的问题）
 *
 * 跳过条件：
 *   - 容器已有 notice（不需重复渲染）
 *   - 容器已标记 dsToolProcessed（_processMessageForToolCalls 会处理）
 *   - 容器含工具调用 XML（让 _processMessageForToolCalls 正常处理）
 *   - 存储数据已过期（超过 24 小时）
 *
 * @param {Element} root - 扫描根元素
 */
function _restoreToolCallNoticeFromStorage(root) {
    if (!root) return;
    try {
        const storage = _getStorageBackend();
        // WebView 兼容：先尝试 [data-virtual-list-item-key]（桌面端），
        // 若无结果则回退到 .ds-message（移动端扁平结构）
        let allContainers = root.querySelectorAll('[data-virtual-list-item-key]');
        if (allContainers.length === 0) {
            // WebView 回退：移动端无 data-virtual-list-item-key，直接扫描 .ds-message
            allContainers = root.querySelectorAll('.ds-message');
        }
        for (const container of allContainers) {
            // 只处理 AI 消息容器
            if (!_isAIContainer(container)) continue;
            // 已有 notice 则跳过
            if (container.querySelector('.ds-tool-call-notice')) continue;
            // 已标记处理中则跳过（_processMessageForToolCalls 会处理）
            if (container.dataset.dsToolProcessed === 'true') continue;
            // 含工具调用 XML 则跳过（让 _processMessageForToolCalls 正常处理）
            const fullText = container.textContent || '';
            if (fullText.length >= 10 && _hasToolFragment(fullText)) continue;

            const hash = _computeMessageHash(container);
            // 使用回退 key（处理 AI 消息仅含工具调用 XML 的情况）
            const storageKey = hash || _getContainerFallbackKey(container);
            if (!storageKey) continue;

            const json = storage.getItem(TOOL_RESULTS_STORAGE_PREFIX + storageKey);
            if (!json) continue;

            let data;
            try { data = JSON.parse(json); } catch (e) { continue; }
            if (!data || data.version !== TOOL_RESULTS_STORAGE_VERSION) continue;
            // 过期检查：超过 24 小时的数据不再恢复
            if (data.savedAt && Date.now() - data.savedAt > 24 * 60 * 60 * 1000) continue;
            if (!Array.isArray(data.results) || data.results.length === 0) continue;

            // 标记已处理，防止 _processMessageForToolCalls 重复处理
            container.dataset.dsToolProcessed = 'true';
            container.dataset.dsToolRestored = 'true';  // 标记为恢复的卡片

            // 关键修复：恢复显示被隐藏的容器
            // 刷新后 cleanupEmptyMessageContainer 可能在 _restoreToolCallNoticeFromStorage 之前
            // 将容器隐藏了（因为 textContent 为空且存储不可用），
            // 此时需要恢复显示以确保 notice 卡片可见
            if (container.style.display === 'none') {
                container.style.display = '';
            }

            // 渲染 notice 卡片
            _insertToolCallNoticeFromElement(container, data.results);
        }
    } catch (e) {
        // 静默失败
    }
}

/**
 * 处理文本节点中的工具调用 XML（如 <memory_save>...</memory_save>）
 *
 * 流程：
 *   1. 解析文本中的所有工具调用 XML 块
 *   2. 对每个工具调用执行 executeToolCall
 *   3. 将 XML 文本替换为"🔧 正在使用工具"的提示节点（隐藏原始 XML）
 *   4. 通过 toast 显示执行结果
 *
 * 安全性：
 *   - 直接修改 textContent，不删除节点，避免 React removeChild 错误
 *   - 工具调用只处理一次（通过 data 属性标记已处理）
 *   - 仅在 AI 回复消息容器内处理（避免误处理用户输入）
 *
 * @param {Text} textNode - 待处理的文本节点
 */
function processToolCalls(textNode) {
    const text = textNode.textContent;
    if (!text || text.length < 10) return;
    // 通过 window._dsParseToolCalls 调用 capability-register.js 的解析器（避免循环依赖）
    if (typeof window === 'undefined' || typeof window._dsParseToolCalls !== 'function') return;
    // 快速检测：文本中是否包含任一工具名标签（使用统一工具名来源）
    const toolNames = _resolveToolNames();
    let hasToolTag = false;
    for (const name of toolNames) {
        if (text.includes('<' + name + '>')) { hasToolTag = true; break; }
    }
    if (!hasToolTag) return;

    // 防重复：如果所属消息容器已被 _processMessageForToolCalls 处理（整消息级别），
    // 跳过本 textNode，避免同一工具调用被重复执行（导致续跑重复触发或 agent_finish 误判）
    const parentMsgContainer = _findMessageContainer(textNode);
    if (parentMsgContainer && parentMsgContainer.dataset.dsToolProcessed === 'true') return;

    const calls = window._dsParseToolCalls(text);
    if (!calls || calls.length === 0) return;

    // 分离同步工具与异步工具：
    //   - 同步工具（memory_save/todo_write/ask_user 等）：本函数同步执行 + 渲染卡片
    //   - 异步工具（web_search/web_fetch/python_exec/mcp_* 等）：需要 agent 反馈，
    //     必须由 _processParagraphForToolCalls 处理（它有 await + 续跑逻辑）。
    //     本函数若同步执行会拿到 Promise 而非结果，且无法触发续跑，
    //     还会提前清理 XML 导致 _processParagraphForToolCalls 无法解析。
    //   - agent_finish：控制流工具，必须由 _processMessageForToolCalls 处理
    //     （它有 stopAgent 调用逻辑），本函数不处理，避免重复执行导致
    //     agent_finish 被执行两次但 stopAgent 只调用一次，或反过来。
    const syncCalls = [];
    const asyncCalls = [];
    for (const call of calls) {
        if (requiresAgentFeedback(call.name)) {
            asyncCalls.push(call);
        } else if (isAgentFinishTool(call.name)) {
            // agent_finish 留给 _processMessageForToolCalls 处理（它有 stopAgent 调用逻辑）
            asyncCalls.push(call);
        } else {
            syncCalls.push(call);
        }
    }

    // 没有同步工具可处理时直接返回，异步工具和 agent_finish 留给 _processParagraphForToolCalls
    if (syncCalls.length === 0) return;

    // 执行同步工具调用并收集结果（包含 payload 供 UI 显示详细信息）
    const results = [];
    for (const call of syncCalls) {
        const label = window._dsGetToolLabel ? window._dsGetToolLabel(call.name) : call.name;
        const result = window._dsExecuteToolCall(call.name, call.payload);
        results.push({ label, result, toolName: call.name, payload: call.payload });
    }

    // 只移除同步工具的 XML，保留异步工具的 XML（交给 _processParagraphForToolCalls 处理）
    let cleaned = text;
    for (const call of syncCalls) {
        // 转义正则特殊字符（call.raw 中的内容）
        const escaped = call.raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        cleaned = cleaned.replace(new RegExp(escaped, 'g'), '');
    }
    // 清理多余的空行
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();
    textNode.textContent = cleaned;

    // 在消息容器末尾插入"正在使用工具"的提示卡片（含基础信息如记忆标题）
    _insertToolCallNotice(textNode, results);
}

/**
 * 在消息容器末尾插入工具调用提示卡片
 * 使用 insertBefore + display:none 原节点的方式，避免破坏 React DOM
 * @param {Text} textNode - 触发处理的文本节点
 * @param {Array<{ label: string, result: { ok: boolean, summary: string, detail?: string } }>} results - 工具调用结果
 */
function _insertToolCallNotice(textNode, results) {
    if (!textNode || !results || results.length === 0) return;
    if (!utils.isNodeAttached(textNode)) return;
    try {
        // 找到消息容器（.ds-message 或最近的块级元素）
        const messageEl = textNode.parentElement?.closest('.ds-message, [data-message-id], .markdown-body, [class*="message"]') || textNode.parentElement;
        if (!messageEl) return;
        // 避免重复插入：检查是否已有提示卡片
        if (messageEl.querySelector('.ds-tool-call-notice')) return;

        // 检测 ask_user / todo_write：走特殊卡片渲染，不创建普通 notice
        // 与 _insertToolCallNoticeFromElement 保持一致，避免 ask_user 被当作普通工具渲染 item
        const hasAskUser = results.some(r => r.toolName === 'ask_user');
        const hasTodoWrite = results.some(r => r.toolName === 'todo_write');
        if (hasAskUser) {
            _renderAskUserCard(messageEl, results);
            return;
        }
        if (hasTodoWrite) {
            _renderTodoCard(messageEl, results);
            return;
        }

        const notice = document.createElement('div');
        notice.className = 'ds-tool-call-notice';
        notice.innerHTML = _buildToolCallNoticeHTML(results);
        // 注入样式（仅一次）
        _injectToolCallNoticeStyles();
        // 插入到消息容器末尾
        messageEl.appendChild(notice);
    } catch (e) {}
}

/** 工具调用提示卡片样式是否已注入 */
let _toolCallNoticeStylesInjected = false;

/**
 * 注入工具调用提示卡片的 CSS 样式（仅一次）
 */
function _injectToolCallNoticeStyles() {
    if (_toolCallNoticeStylesInjected) return;
    _toolCallNoticeStylesInjected = true;
    if (typeof document === 'undefined') return;
    const style = document.createElement('style');
    style.id = 'ds-tool-call-notice-styles';
    style.textContent = `
    .ds-tool-call-notice {
        margin: 8px 0; padding: 10px 12px;
        border-radius: 10px;
        background: rgba(99, 102, 241, 0.08);
        border: 1px solid rgba(99, 102, 241, 0.2);
        font-size: 13px; line-height: 1.5;
        animation: dsFadeIn 0.2s ease;
    }
    .ds-tool-call-notice-header {
        display: flex; align-items: center; gap: 6px;
        margin-bottom: 6px; font-weight: 600;
    }
    .ds-tool-call-notice-title { flex: 1; }
    .ds-tool-call-notice-count {
        font-size: 11px; opacity: 0.7;
        background: rgba(99, 102, 241, 0.15);
        padding: 1px 8px; border-radius: 8px;
    }
    .ds-tool-call-notice-body {
        display: flex; flex-direction: column; gap: 4px;
    }
    .ds-tool-call-notice-item {
        display: flex; flex-wrap: wrap; gap: 6px; align-items: center;
        padding: 4px 8px; border-radius: 6px;
        background: rgba(255,255,255,0.04);
        border-left: 3px solid rgba(99, 102, 241, 0.4);
    }
    .ds-tool-call-notice-item-label { font-weight: 600; }
    .ds-tool-call-notice-item-info {
        font-size: 12px; color: var(--ds-section-color, #888);
        background: rgba(255,255,255,0.06); padding: 1px 8px; border-radius: 6px;
    }
    `;
    document.head.appendChild(style);
}

/**
 * 转义 HTML 特殊字符
 * @param {string} str
 * @returns {string}
 */
function _escapeHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * 处理单个文本节点：敏感词替换 → 提示词标记清理 → 角标清理 → 删除线渲染 → 图片渲染
 * 如果删除线产生了新文本节点，则遍历它们逐一渲染图片
 * @param {Text} textNode
 */
export function processTextNode(textNode) {
    if (textNode.nodeType !== 3) return;
    if (!utils.isNodeAttached(textNode)) return;

    replaceSensitiveData(textNode);
    cleanPromptInjection(textNode);
    cleanContinuationPrompt(textNode);
    cleanAIWasteData(textNode);
    processToolCalls(textNode);
    cleanTextCitations(textNode);

    // 工具调用扫描：textNode 所在段落可能包含完整的工具调用 XML
    // 因为 XML 被转义为文本分散在多个 span 中，单个 textNode 无法匹配完整模式
    // 需要在段落级别扫描 textContent（参考 privacy-shield 的段落级处理思路）
    try {
        const paragraph = textNode.parentElement?.closest(
            'p.ds-markdown-paragraph, p, div.ds-markdown-paragraph, div, .ds-markdown'
        );
        if (paragraph) {
            scanToolCallElements(paragraph);
        }
    } catch (e) {}

    let insertedTextNodes = null;
    if (CONFIG.strikethroughEnabled) {
        insertedTextNodes = renderStrikethrough(textNode);
    }

    if (CONFIG.imageRenderEnabled) {
        if (insertedTextNodes) {
            // 删除线渲染后产生了新文本节点，遍历它们渲染图片
            // 逆序处理避免索引偏移
            for (let i = insertedTextNodes.length - 1; i >= 0; i--) {
                renderImages(insertedTextNodes[i]);
            }
        } else {
            renderImages(textNode);
        }
    }
}

// ============================================================
// 扫描函数
// ============================================================

/**
 * 扫描容器中的链接，将图片 URL 链接替换为图片元素
 * @param {Element} root
 */
export function scanLinks(root) {
    if (!CONFIG.imageRenderEnabled) return;
    if (!root || root.nodeType !== 1) return;
    const links = root.querySelectorAll('a[href]:not([data-anime-processed])');
    links.forEach(link => {
        if (!utils.isNodeAttached(link) || link.dataset.animeProcessed === 'true') return;
        const url = link.getAttribute('href');
        if (!url || !utils.isImageUrl(url)) return;
        link.dataset.animeProcessed = 'true';
        replaceNodeWithImage(link, url, link.textContent || '');
    });
}

/**
 * 扫描容器中的所有文本节点并处理（逆序遍历）
 * @param {Element} root
 */
export function scanTextNodes(root) {
    if (!root || root.nodeType !== 1) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) => {
            const parent = node.parentNode;
            if (parent.tagName === 'SCRIPT' || parent.tagName === 'STYLE' || parent.tagName === 'IMG' || parent.tagName === 'A' ||
                parent.classList.contains('anime-image-link') || parent.classList.contains('anime-rendered-image')) {
                return NodeFilter.FILTER_REJECT;
            }
            return NodeFilter.FILTER_ACCEPT;
        }
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    // 逆序处理避免替换后索引偏移
    for (let i = nodes.length - 1; i >= 0; i--) {
        processTextNode(nodes[i]);
    }
}

/**
 * 从节点向上查找消息容器
 *
 * 消息容器选择器（按优先级）：
 *   - .ds-message / [data-message-id]：DeepSeek 标准消息容器
 *   - .ds-markdown：AI 回复的 markdown 渲染容器
 *   - .ds-message__content：消息内容容器
 *   - .markdown-body：通用 markdown body
 *   - [class*="message"]：兜底匹配含 "message" 的容器
 *
 * @param {Node} node - 起始节点（Text 或 Element）
 * @returns {Element|null} 最近的祖先消息容器，找不到时返回 null
 */
function _findMessageContainer(node) {
    if (!node) return null;
    const parentEl = node.nodeType === 1 ? node : node.parentElement;
    if (!parentEl) return null;
    return parentEl.closest(
        '.ds-message, [data-message-id], .ds-markdown, .ds-message__content, .markdown-body, [class*="message"]'
    );
}

/**
 * 遍历 root 下所有 Text 节点，对每个文本节点调用 callback
 *
 * 用 TreeWalker（NodeFilter.SHOW_TEXT）遍历，跳过工具调用卡片内的文本节点
 * （避免清空已渲染的 UI 卡片内容），也跳过 script/style/img/a 等非内容节点。
 *
 * React 兼容（硬约束）：
 *   - callback 中修改 textNode.data（即 textNode.textContent）是安全的，
 *     不会移除元素子节点，与 React 的 fiber 记录保持一致。
 *   - 绝不修改元素节点的 textContent（会清空 React 管理的子节点，触发 removeChild 崩溃）。
 *
 * @param {Node} root - 遍历根节点
 * @param {(textNode: Text) => void} callback - 文本节点处理回调
 */
function _walkTextNodes(root, callback) {
    if (!root) return;
    // 跳过已渲染的工具调用卡片与提示卡片（其内部文本由 React 管理，不可清理）
    const skipSelector = '.ds-tool-call-notice, .ds-tool-call-card, .ds-todo-card, .ds-ask-user-card';
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
            const parent = node.parentNode;
            if (!parent || !parent.closest) return NodeFilter.FILTER_REJECT;
            // 跳过工具调用卡片内的文本节点
            if (parent.closest(skipSelector)) {
                return NodeFilter.FILTER_REJECT;
            }
            // 跳过非内容节点（与 scanTextNodes 一致）
            const tag = parent.tagName;
            if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'IMG' || tag === 'A' ||
                parent.classList.contains('anime-image-link') ||
                parent.classList.contains('anime-rendered-image')) {
                return NodeFilter.FILTER_REJECT;
            }
            return NodeFilter.FILTER_ACCEPT;
        }
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (let i = 0; i < nodes.length; i++) {
        callback(nodes[i]);
    }
}

/**
 * 跨段落清理工具调用 XML 片段（修复 3）
 *
 * 当工具调用 XML 被跨段落拆分时（如 DeepSeek 渲染器把
 * <web_search>\n{"query":...}\n</web_search> 拆到不同 <p> 段落），
 * 单段落扫描无法匹配完整的工具调用。本函数在整消息容器级别遍历所有 Text 节点，
 * 移除每个文本节点中的工具调用相关文本片段（开标签、body 片段、闭标签的任意组合）。
 *
 * 清理策略（对每个 Text 节点独立应用）：
 *   1. 完整工具调用：<name>...JSON...</name>（g 标志，[\s\S]*? 非贪婪）
 *      仅当 stripFullXml=true 时清除（避免 cleanAIWasteData 误删 _processMessageForToolCalls 需要的 XML）
 *   2. 开标签后的 body 片段：<name>\s*\{[^}]*\}（JSON 片段，闭标签在其他节点）
 *   3. 孤立开标签：<name>（闭标签在其他节点）
 *   4. 孤立闭标签：</name>（开标签在其他节点）
 *
 * React 兼容（硬约束）：
 *   - 只修改 Text 节点的 data（textContent），绝不修改元素节点的 textContent。
 *     修改 textNode.data 不会移除元素子节点，与 cleanAIWasteData 的安全模式一致。
 *   - 不再 style.display='none' 隐藏段落（避免与 React 冲突），空文本节点让 React 自行管理。
 *
 * @param {Element} container - 消息容器
 * @param {string[]} toolNames - 工具名列表
 * @param {Object} [options]
 * @param {boolean} [options.stripFullXml=true] - 是否清除完整的 XML（false 时只清孤立片段，供 cleanAIWasteData 使用）
 */
function _stripToolCallFragmentsAcrossParagraphs(container, toolNames, options = {}) {
    if (!container || !toolNames || toolNames.length === 0) return;
    const { stripFullXml = true } = options;

    // 构建工具名正则（长名在前，避免短名前缀匹配；转义特殊字符）
    const escapedNames = toolNames
        .map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .sort((a, b) => b.length - a.length);
    const nameAlternation = escapedNames.join('|');

    // 预编译正则（每个 textNode 都要用，提前编译避免重复创建）
    const fullPattern = stripFullXml
        ? new RegExp('<(' + nameAlternation + ')>[\\s\\S]*?</\\1>', 'g')
        : null;
    const bodyFragmentPattern = new RegExp(
        '<(' + nameAlternation + ')>\\s*\\{[^}]*\\}', 'g'
    );
    const closeTagPattern = new RegExp('</(' + nameAlternation + ')>', 'g');
    const openTagPattern = new RegExp('<(' + nameAlternation + ')>', 'g');

    // 遍历所有 Text 节点（跳过工具调用卡片，由 _walkTextNodes 保证）
    _walkTextNodes(container, (textNode) => {
        let data = textNode.data;
        if (!data) return;

        // 1. 移除完整的工具调用 XML（仅 stripFullXml=true 时清除）
        if (fullPattern) {
            fullPattern.lastIndex = 0;
            data = data.replace(fullPattern, '');
        }

        // 2. 移除开标签后的 body 片段（<name>\s*\{...\}）
        // 必须先于孤立开标签清理，避免开标签被移除后 body 残留
        bodyFragmentPattern.lastIndex = 0;
        data = data.replace(bodyFragmentPattern, '');

        // 3. 移除孤立的闭标签（当开标签在其他节点）
        closeTagPattern.lastIndex = 0;
        data = data.replace(closeTagPattern, '');

        // 4. 移除孤立的开标签（当闭标签在其他节点）
        openTagPattern.lastIndex = 0;
        data = data.replace(openTagPattern, '');

        // 清理多余空白
        data = data.replace(/\n{3,}/g, '\n\n').trim();

        if (data !== textNode.data) {
            // 安全：只修改 Text 节点的 data，不操作元素子节点，与 React 兼容
            textNode.data = data;
        }
        // 不再隐藏段落（避免破坏 React），空文本节点让 React 自行管理
    });

    // ===== 残留 JSON 参数清理（修复 Bug #1：工具调用参数暴露）=====
    // 当 <tool_name> 和 </tool_name> 标签被拆到不同 textNode 时，
    // 标签间的 JSON 参数（如 {"id":"mem-xxx","content":"..."}）会残留在
    // 独立的 textNode 中，用户可见。
    // 检测策略：遍历 textNode，若 data 去除空白后是纯 JSON（{...} 或 [...]），
    // 且能解析为 JSON 对象/数组，且不在 code/pre 中，则清空该 textNode。
    // 安全性：
    //   - JSON 代码块通常渲染为 <pre><code>，普通段落中的纯 JSON 极少是用户内容
    //   - 跳过 code/pre 元素，避免误删 AI 正常输出的代码块
    //   - 只清理能解析为有效 JSON 的纯 JSON 文本，不会误删普通文本
    _walkTextNodes(container, (textNode) => {
        const data = textNode.data;
        if (!data) return;
        const trimmed = data.trim();
        if (trimmed.length < 2) return;
        // 跳过 code/pre 元素中的 JSON（AI 正常输出的代码块）
        const parent = textNode.parentElement;
        if (parent && parent.closest('code, pre')) return;
        // 检测是否是纯 JSON 片段
        const isJsonObject = trimmed.charAt(0) === '{' && trimmed.charAt(trimmed.length - 1) === '}';
        const isJsonArray = trimmed.charAt(0) === '[' && trimmed.charAt(trimmed.length - 1) === ']';
        if (!isJsonObject && !isJsonArray) return;
        // 尝试解析 JSON，只有有效 JSON 才清理（避免误删普通文本）
        try {
            JSON.parse(trimmed);
            // 解析成功，清空该 textNode（工具调用参数残留）
            textNode.data = '';
        } catch (e) {
            // 解析失败，不是有效 JSON，保留
        }
    });
}

/**
 * 扫描容器中的工具调用文本（段落级 textContent 扫描）
 *
 * DeepSeek 的 markdown 渲染器会把 <memory_save>...</memory_save> 转义为 HTML 实体
 * （&lt;memory_save&gt;），并分散在多个 <span>/<br> 节点中。
 * 因此无法通过单个 textNode 或 DOM 元素查询来识别。
 *
 * 本函数采用**段落级 textContent 扫描**策略（参考 privacy-shield 的直接修改策略）：
 *   1. 遍历消息容器中的段落元素（p.ds-markdown-paragraph 或通用块级元素）
 *   2. 获取段落的完整 textContent（自动合并跨 span 的文本，HTML 实体已解码）
 *   3. 用正则匹配 <tool_name>...JSON...</tool_name> 模式
 *   4. 执行工具调用
 *   5. **直接修改段落 textContent** 移除工具调用 XML，保留其他文本
 *      （与 privacy-shield 替换敏感词同样的策略：直接改 textContent，不操作 DOM 结构）
 *   6. 在消息容器插入工具调用提示卡片
 *
 * 流式输出兼容性：
 *   - 流式输出过程中，段落 textContent 会不断变化
 *   - 每次变化都会触发 processTextNode → scanToolCallElements
 *   - 当 `</tool_name>` 出现时，正则匹配成功，工具调用被立即处理和移除
 *   - 处理后段落 textContent 不再包含 XML，后续触发不会重复处理
 *
 * @param {Element} root - 待扫描的根元素
 */
export function scanToolCallElements(root) {
    if (!root || root.nodeType !== 1) return;
    if (typeof window === 'undefined' || typeof window._dsExecuteToolCall !== 'function') return;
    const toolNames = _resolveToolNames();
    if (toolNames.length === 0) return;

    // ===== 工具调用 notice 持久化恢复（修复刷新后卡片丢失）=====
    // 刷新后 history-cleanup.js 清理了工具调用 XML，scanToolCallElements 不会触发
    // _processMessageForToolCalls，notice 卡片不会重新渲染。
    // 此处从 sessionStorage 读取已保存的工具调用结果，重新渲染 notice 卡片。
    try {
        _restoreToolCallNoticeFromStorage(root);
    } catch (e) {}

    // ===== Agent 残留消息清理 =====
    // agent 续跑消息清理后只剩 ds-agent-badge + 占位符，用户要求完全隐藏这类消息。
    // cleanupEmptyMessageContainer 在 textNode 清理时触发，但 agent 消息清理后
    // textNode 是占位符（不含工具碎片），不会触发 cleanAIWasteData，需要主动扫描。
    // 此处在 scanToolCallElements 入口处调用，定期清理含 badge 的空 agent 消息容器。
    try {
        _cleanupAgentResidualMessages(root);
    } catch (e) {}

    // ===== 整消息容器扫描兜底（修复 1：跨段落 XML 识别）=====
    // 当工具调用 XML 被跨段落拆分时（如 DeepSeek 渲染器把
    // <web_search>\n{"query":...}\n</web_search> 拆到不同 <p> 段落），
    // 单段落扫描无法匹配完整的工具调用。此处先在整消息容器级别扫描，
    // 若匹配到工具调用，走 _processMessageForToolCalls 分支；否则回退到单段落扫描。
    //
    // 性能优化：整消息扫描只在 _hasToolFragment(fullText) 为 true 时触发
    // 防重复：dsToolProcessed 标记在消息容器级别设置
    try {
        const messageContainer = _findMessageContainer(root) || root;
        if (messageContainer && messageContainer.dataset.dsToolProcessed !== 'true') {
            const fullText = messageContainer.textContent || '';
            if (fullText && fullText.length >= 10 && _hasToolFragment(fullText)) {
                // 用 window._dsParseToolCalls 在整消息 textContent 上匹配完整工具调用
                // parseToolCalls 使用 catalog 正则（含别名归一化），比单段落正则更完整
                if (typeof window._dsParseToolCalls === 'function') {
                    const fullCalls = window._dsParseToolCalls(fullText);
                    if (fullCalls && fullCalls.length > 0) {
                        // 整消息级别匹配到工具调用，说明跨段落了，走新分支
                        // fire-and-forget：_processMessageForToolCalls 是 async 函数，不 await
                        // 防止 MutationObserver 同步调用栈被阻塞；并发控制由 dsToolProcessed 标记保证
                        _processMessageForToolCalls(messageContainer, toolNames).catch(err => {
                            console.error('[text-process] 整消息工具调用处理失败:', err);
                        });
                        return;
                    }
                }
            }
        }
    } catch (e) {
        // 整消息扫描失败时回退到单段落扫描（保持向后兼容）
    }

    // ===== 原有单段落扫描逻辑（向后兼容）=====
    // 查找所有段落元素：优先 ds-markdown-paragraph，回退到 p/div
    // 注意：不能用 querySelectorAll(root) 限制范围，因为流式输出时新段落会作为子节点加入
    const paragraphs = root.querySelectorAll(
        'p.ds-markdown-paragraph, p, div.ds-markdown-paragraph, div'
    );
    // NodeList 转 Array，并把 root 自身纳入遍历（若 root 也是段落元素）
    // 注意：NodeList 没有 add 方法（原 paragraphs.add(root) 调用无效），必须先 Array.from 再 push
    const paragraphList = Array.from(paragraphs);
    if (root.matches && root.matches('p.ds-markdown-paragraph, p, div.ds-markdown-paragraph, div') &&
        !paragraphList.includes(root)) {
        paragraphList.push(root);
    }
    if (paragraphList.length === 0 && root.nodeType === 1) {
        // 没找到段落元素，直接扫描 root 自身
        // fire-and-forget：_processParagraphForToolCalls 是 async 函数，不 await
        // 防止 MutationObserver 同步调用栈被阻塞；并发控制由 dsToolProcessed 标记保证
        _processParagraphForToolCalls(root, toolNames).catch(err => {
            console.error('[text-process] 工具调用处理失败:', err);
        });
        return;
    }

    // 遍历所有段落
    // 注意：_processParagraphForToolCalls 是 async 函数，此处 fire-and-forget 不 await
    // 原因：scanToolCallElements 被 MutationObserver 同步回调，不能改为 async
    // 并发控制：_processParagraphForToolCalls 入口检查 dsToolProcessed，且在启动异步执行前立即设置标记
    // 单个段落处理失败不影响其他段落（.catch 兜底）
    for (const p of paragraphList) {
        if (!utils.isNodeAttached(p)) continue;
        // 防重复：如果段落所属的消息容器已被 _processMessageForToolCalls 处理（整消息级别），
        // 跳过该段落，避免同一工具调用被两个路径重复执行（导致续跑重复触发或 agent_finish 误判）
        const parentMsgContainer = _findMessageContainer(p);
        if (parentMsgContainer && parentMsgContainer.dataset.dsToolProcessed === 'true') continue;
        _processParagraphForToolCalls(p, toolNames).catch(err => {
            console.error('[text-process] 工具调用处理失败:', err);
        });
    }
}

/**
 * 宽容解析 JSON（回退渲染）
 *
 * 当标准 JSON.parse 失败时，尝试多种修复策略解析 AI 输出的格式错误 JSON：
 *   1. 移除 Markdown 代码块包装（```json ... ``` 或 ``` ... ```）
 *   2. 移除注释（行注释和块注释）
 *   3. 压缩多行为单行（保留字符串内的换行）
 *   4. 修复单引号为双引号
 *   5. 移除尾部逗号
 *
 * @param {string} body - 工具调用标签内的原始文本
 * @returns {Object|null} 解析成功返回对象，失败返回 null
 */
function _lenientParseJSON(body) {
    if (!body || typeof body !== 'string') return null;
    try {
        let cleaned = body;

        // 1. 移除 Markdown 代码块包装
        cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');

        // 2. 移除单行注释（// ...）和块注释（/* ... */）
        // 注意：只在非字符串内容中移除，这里简化处理（字符串内很少有 //）
        cleaned = cleaned.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

        // 3. 压缩多行为单行（移除换行和多余空白，但保留字符串内的换行）
        // 策略：逐字符遍历，字符串内保留换行，字符串外压缩空白
        let compacted = '';
        let inString = false;
        let escapeNext = false;
        for (let i = 0; i < cleaned.length; i++) {
            const ch = cleaned[i];
            if (escapeNext) {
                compacted += ch;
                escapeNext = false;
                continue;
            }
            if (ch === '\\') {
                compacted += ch;
                escapeNext = true;
                continue;
            }
            if (ch === '"') {
                inString = !inString;
                compacted += ch;
                continue;
            }
            if (inString) {
                compacted += ch;
            } else {
                // 字符串外：压缩空白
                if (ch === '\n' || ch === '\r' || ch === '\t') {
                    compacted += ' ';
                } else {
                    compacted += ch;
                }
            }
        }
        cleaned = compacted.replace(/\s+/g, ' ').trim();

        // 4. 修复单引号为双引号（仅在字符串外）
        // 简化处理：直接替换（JSON 中单引号不应出现在字符串外）
        cleaned = cleaned.replace(/'/g, '"');

        // 5. 移除尾部逗号（,} 或 ,]）
        cleaned = cleaned.replace(/,(\s*[}\]])/g, '$1');

        // 6. 自动补全缺失的闭合括号
        // AI 流式输出或格式错误时，可能缺少 } 或 ]
        // 统计字符串外的括号数量，补全缺失的部分
        let braceDepth = 0;   // {} 深度
        let bracketDepth = 0; // [] 深度
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
        // 补全缺失的闭合符号（深度 > 0 表示有未闭合的括号）
        if (braceDepth > 0) cleaned += '}'.repeat(braceDepth);
        if (bracketDepth > 0) cleaned += ']'.repeat(bracketDepth);

        // 尝试解析
        return JSON.parse(cleaned);
    } catch (e) {
        return null;
    }
}

/**
 * 处理单个段落：扫描工具调用 XML，执行并从 textContent 中移除
 *
 * 核心策略（参考 privacy-shield.replaceSensitiveData）：
 *   - 读取段落的完整 textContent（合并所有子节点的文本）
 *   - 用正则匹配工具调用 XML
 *   - 如果匹配到，执行工具调用，然后用 textContent 替换移除 XML 部分
 *   - 直接修改 textContent，不操作 DOM 结构，避免 React 错误
 *
 * 注意：直接修改段落 textContent 会清空所有子节点（span/br），用一个文本节点替换。
 *       这是可接受的，因为：
 *   1. 工具调用 XML 出现在段落末尾时，段落剩余内容（如有）变为纯文本也无关紧要
 *   2. 如果段落只包含工具调用 XML，清空后段落无可见文本，隐藏整个段落
 *   3. React 后续重新渲染时会重建段落结构（流式输出场景）
 *
 * @param {Element} paragraph - 段落元素
 * @param {string[]} toolNames - 工具名列表
 */
async function _processParagraphForToolCalls(paragraph, toolNames) {
    if (!paragraph || paragraph.dataset.dsToolProcessed === 'true') return;

    const text = paragraph.textContent || '';
    if (!text || text.length < 10) return;

    // 快速检测：textContent 中是否包含任一工具标签
    let hit = false;
    for (const name of toolNames) {
        if (text.includes('<' + name + '>')) { hit = true; break; }
    }
    if (!hit) return;

    // 构建工具调用正则：<tool_name>...JSON...</tool_name>
    // textContent 已解码 HTML 实体，&lt; 变成 <
    const toolPattern = new RegExp(
        '<(' + toolNames.join('|') + ')>([\\s\\S]*?)</\\1>',
        'g'
    );

    // 收集所有完整的工具调用（必须有 </tool_name> 闭合标签，流式输出中未闭合的不处理）
    const calls = [];
    let match;
    while ((match = toolPattern.exec(text)) !== null) {
        const name = match[1];
        const body = match[2].trim();
        let payload = null;
        let raw = match[0];
        // 优先使用标准 JSON.parse
        try {
            payload = JSON.parse(body);
        } catch (e) {
            // 回退渲染：宽容解析格式错误的 JSON
            // 处理 AI 可能输出的错误格式：
            //   1. 多行 JSON（带换行和缩进）
            //   2. 带空格的 key/value（如 {"id": "mem-xxx"} → {"id":"mem-xxx"}）
            //   3. 被 Markdown 代码块包装（```json ... ```）
            //   4. 单引号引用（非标准 JSON）
            payload = _lenientParseJSON(body);
            if (payload) {
                console.log('[ToolCall] 标准解析失败，回退渲染成功:', name);
            }
        }
        if (payload && typeof payload === 'object') {
            calls.push({ name, payload, raw });
        }
    }

    if (calls.length === 0) {
        // 容错处理：检测缺少闭标签的工具调用
        // 当 AI 输出 <tool_name>{"key":"value"} 但缺少 </tool_name> 闭标签时
        // 尝试提取开标签后的文本，用回退解析器解析 JSON
        // 如果解析成功，说明这是一个"缺少闭标签"的工具调用，自动处理
        for (const name of toolNames) {
            const openTag = '<' + name + '>';
            const closeTag = '</' + name + '>';
            const openIdx = text.indexOf(openTag);
            if (openIdx === -1) continue;
            // 已有闭标签的情况由上面的正则处理，这里只处理无闭标签的
            if (text.includes(closeTag)) continue;

            // 提取开标签后的文本（到段落末尾）
            const body = text.slice(openIdx + openTag.length).trim();
            if (!body || body.length < 2) continue;

            // 尝试用回退解析器解析（支持自动补全缺失括号）
            const payload = _lenientParseJSON(body);
            if (payload && typeof payload === 'object') {
                // 解析成功，说明 JSON 内容有效但缺少闭标签
                // 构建 raw 文本（开标签 + body 原文，不含闭标签）
                const raw = openTag + body;
                calls.push({ name, payload, raw });
            }
        }

        if (calls.length === 0) {
            // 检测到 <tool_name> 但没有完整的闭合标签（流式输出中）
            // 且 JSON 尚未完整（回退解析也失败），不标记为已处理，等待后续字符到达再扫描
            return;
        }
    }

    // 关键：在启动异步执行前立即标记段落已处理，防止 await 期间被 MutationObserver
    // 重复触发 scanToolCallElements 时再次处理同一段落（异步工具结果丢失防护）
    paragraph.dataset.dsToolProcessed = 'true';

    // 执行所有工具调用（包含 payload 供 UI 显示详细信息）
    // 注意：异步工具（web_search/web_fetch/python_exec/mcp_*）返回 Promise，必须 await
    // 同步工具（memory_save/todo_write 等）返回对象，await 对象是无害的（await obj 等于 obj）
    //
    // 工具执行计数器（window._dsToolExecutionCount）：
    //   维护正在执行的工具调用数，供 capability-agent.js 的 _waitForToolResultsStable 等待。
    //   解决"多工具调用结果未汇总就发送"的 bug：onEnd 后续跑发送前等待所有工具执行完。
    const results = [];
    for (const call of calls) {
        const label = window._dsGetToolLabel ? window._dsGetToolLabel(call.name) : call.name;
        if (typeof window !== 'undefined') {
            window._dsToolExecutionCount = (window._dsToolExecutionCount || 0) + 1;
        }
        let result;
        try {
            // await 异步工具的 Promise，同步工具的对象 await 后原样返回
            result = await window._dsExecuteToolCall(call.name, call.payload);
        } catch (err) {
            // 异步工具执行抛错时构造失败结果，避免 Promise reject 中断后续工具和段落处理
            result = {
                ok: false,
                summary: '工具执行失败',
                detail: (err && err.message) ? err.message : String(err)
            };
        } finally {
            if (typeof window !== 'undefined') {
                window._dsToolExecutionCount = Math.max(0, (window._dsToolExecutionCount || 0) - 1);
            }
        }
        results.push({ label, result, toolName: call.name, payload: call.payload });
    }

    // 从 DOM 中安全地移除工具调用 XML，保留其他文本
    //
    // 关键：不能使用 paragraph.textContent = cleanedText！
    // 原因：textContent 赋值会移除段落的所有 React 管理的子节点（span/br 等），
    //       React 后续渲染时尝试 removeChild 这些已不存在的节点会报错：
    //       "NotFoundError: Failed to execute 'removeChild' on 'Node'"
    //
    // 安全策略：使用 _stripToolCallFragmentsAcrossParagraphs 遍历 Text 节点，
    // 只修改 textNode.data（Text 节点的文本内容），不操作元素子节点，与 React 兼容。
    // 这与 _processMessageForToolCalls 的清理逻辑一致。
    _stripToolCallFragmentsAcrossParagraphs(paragraph, toolNames, { stripFullXml: true });

    // 标记已在启动异步执行前设置（防止 await 期间重复处理），此处无需重复设置

    // 检查清理后段落是否还有可见文本，无文本则隐藏整个段落（避免残留空段落影响布局）
    // 使用 display:none 隐藏，不移除子节点，与 React 兼容
    const cleanedText = (paragraph.textContent || '').trim();
    if (!cleanedText) {
        paragraph.style.display = 'none';
    } else {
        // 恢复显示：流式输出期间 cleanAIWasteData 可能已隐藏此段落（未闭合开标签时），
        // 工具执行完毕并清理 XML 后，若段落仍有可见文本，需恢复 display 让文本可见
        if (paragraph.style.display === 'none') {
            paragraph.style.display = '';
        }
    }

    // 在消息容器末尾插入工具调用提示卡片
    _insertToolCallNoticeFromElement(paragraph, results);

    // 持久化工具调用结果到 sessionStorage（修复刷新后 notice 卡片丢失）
    // 单段落扫描路径（_processParagraphForToolCalls）也需要持久化，
    // 否则单段落工具调用（如 agent_finish）刷新后无法恢复 notice。
    // 通过 paragraph 向上查找所属消息容器，复用 _saveToolResultsToStorage 的累积逻辑。
    try {
        const msgContainer = _findMessageContainer(paragraph) || paragraph.parentElement;
        if (msgContainer) {
            _saveToolResultsToStorage(msgContainer, results);
        }
    } catch (e) {}

    // 触发能力代理（Capability Agent）续跑：将工具调用结果回传给 DeepSeek
    // 仅对"需要返回结果"的工具触发续跑（如 memory_save/memory_review 等）
    // memory_recall 等仅记录型工具不需要 agent 反馈，AI 可直接继续对话
    //
    // 特殊处理：如果 AI 调用了 agent_finish，说明 AI 已声明任务完成，
    // 此时不应触发续跑（即使同一条回复中还有其他工具调用），
    // 而是直接调用 window._dsStopAgent() 终止 Agent 循环。
    try {
        if (typeof window !== 'undefined' && typeof window._dsOnToolCallExecuted === 'function') {
            // 检测是否包含 agent_finish 工具调用
            const hasAgentFinish = results.some(r => isAgentFinishTool(r.toolName));
            if (hasAgentFinish) {
                // AI 声明任务完成，终止 Agent 循环，不发送续跑 prompt
                if (typeof window._dsStopAgent === 'function') {
                    // 从 agent_finish 结果中提取 reason 参数（如果有）
                    const finishResult = results.find(r => isAgentFinishTool(r.toolName));
                    const reason = finishResult?.payload?.reason;
                    window._dsStopAgent(reason);
                }
            } else {
                // 正常流程：过滤需要 agent 反馈的工具，触发续跑
                const agentResults = results
                    .filter(r => requiresAgentFeedback(r.toolName))
                    .map(r => ({
                        name: r.label,
                        toolName: r.toolName,
                        ok: r.result.ok,
                        skipped: r.result.skipped || false,
                        pending: r.result.pending || false,
                        summary: r.result.summary,
                        detail: r.result.detail || '',
                        payload: r.payload || null
                    }));
                if (agentResults.length > 0) {
                    // 获取原始用户任务（由 fetch-hub.js 的 onStreamStart 记录）
                    const originalPrompt = (typeof window._dsGetOriginalTask === 'function')
                        ? (window._dsGetOriginalTask() || '')
                        : '';
                    window._dsOnToolCallExecuted(agentResults, originalPrompt);
                }
            }
        }
    } catch (e) {}
}

/**
 * 处理整消息容器的工具调用（跨段落兜底，修复 1）
 *
 * 当工具调用 XML 被跨段落拆分时（开标签和闭标签在不同段落），
 * 单段落扫描无法匹配完整的工具调用。本函数在整消息容器的 textContent 上匹配，
 * 执行工具调用，并清理跨段落 XML 片段。
 *
 * 流程：
 *   1. 读取消息容器的整体 textContent（跨段落拼接）
 *   2. 用 window._dsParseToolCalls 在整体文本上匹配所有工具调用
 *   3. 对每个匹配：执行工具（window._dsExecuteToolCall），收集结果
 *      - 异步工具（web_search/web_fetch/python_exec/mcp_*）返回 Promise，必须 await
 *      - 同步工具（memory_save/todo_write 等）返回对象，await 对象是无害的
 *   4. 清理跨段落 XML：调 _stripToolCallFragmentsAcrossParagraphs
 *   5. 插入工具结果卡片：调 _insertToolCallNoticeFromElement
 *   6. 设置 messageContainer.dataset.dsToolProcessed = 'true' 防重复
 *   7. 触发 window._dsOnToolCallExecuted 续跑（与原 _processParagraphForToolCalls 一致）
 *
 * 防重复：在启动异步执行前立即标记消息容器已处理，防止 await 期间被
 * MutationObserver 重复触发 scanToolCallElements 时再次处理同一消息容器
 *
 * @param {Element} messageContainer - 消息容器
 * @param {string[]} toolNames - 工具名列表
 */
async function _processMessageForToolCalls(messageContainer, toolNames) {
    if (!messageContainer || messageContainer.dataset.dsToolProcessed === 'true') return;

    const fullText = messageContainer.textContent || '';
    if (!fullText || fullText.length < 10) return;

    // 用 window._dsParseToolCalls 解析整消息 textContent
    // parseToolCalls 使用 catalog 正则（含别名归一化），支持所有注册工具
    if (typeof window === 'undefined' || typeof window._dsParseToolCalls !== 'function') return;
    const calls = window._dsParseToolCalls(fullText);
    if (!calls || calls.length === 0) return;

    // 关键：在启动异步执行前立即标记消息容器已处理，防止 await 期间被
    // MutationObserver 重复触发 scanToolCallElements 时再次处理同一消息容器
    messageContainer.dataset.dsToolProcessed = 'true';

    // 预先清理跨段落 XML 片段（完整 XML + 孤立开/闭标签 + body 片段）
    // 提前清理让用户立即看到去除 XML 后的正文，不必等工具执行完
    _stripToolCallFragmentsAcrossParagraphs(messageContainer, toolNames, { stripFullXml: true });

    // 并行执行所有工具调用 + 单个完成即渲染（异步渲染优化）
    //
    // 原实现用 for...of + await 串行执行，web_search 等异步工具要 5-10 秒，
    // 期间后续工具（如 memory_save）被阻塞，且所有卡片要等全部完成才一次性插入。
    //
    // 新实现：
    //   1. 用 Promise.allSettled 并行启动所有工具调用
    //   2. 每个工具完成时立即渲染它的卡片（append 到 notice 容器）
    //   3. 全部完成后再触发 agent 续跑（保证续跑顺序不变）
    //   4. 同步工具（memory_save 等）Promise.resolve 立即完成，不阻塞异步工具
    const results = [];
    const noticeEl = _ensureToolCallNoticeContainer(messageContainer);

    const promises = calls.map(async (call) => {
        const label = window._dsGetToolLabel ? window._dsGetToolLabel(call.name) : call.name;
        // 工具执行计数器：供 capability-agent.js _waitForToolResultsStable 等待
        if (typeof window !== 'undefined') {
            window._dsToolExecutionCount = (window._dsToolExecutionCount || 0) + 1;
        }
        let result;
        try {
            // await 异步工具的 Promise，同步工具的对象 await 后原样返回
            result = await window._dsExecuteToolCall(call.name, call.payload);
        } catch (err) {
            // 异步工具执行抛错时构造失败结果，避免 Promise reject 中断后续工具处理
            result = {
                ok: false,
                summary: '工具执行失败',
                detail: (err && err.message) ? err.message : String(err)
            };
        } finally {
            if (typeof window !== 'undefined') {
                window._dsToolExecutionCount = Math.max(0, (window._dsToolExecutionCount || 0) - 1);
            }
        }
        const entry = { label, result, toolName: call.name, payload: call.payload };
        results.push(entry);
        // 单个工具完成立即渲染其卡片项（不等其他工具）
        // 注意：todo_write / ask_user 走特殊卡片渲染，不在此处插入 item
        if (call.name !== 'todo_write' && call.name !== 'ask_user') {
            _appendToolCallNoticeItem(noticeEl, entry);
        }
        return entry;
    });

    // 等待所有工具执行完成（保证 agent 续跑时拿到完整 results）
    await Promise.allSettled(promises);

    // 特殊卡片渲染：todo_write / ask_user 需要完整 results 数组，在所有工具完成后渲染
    // 这两类工具的卡片依赖整体上下文（如 todo 状态、ask_user 暂停逻辑），不能增量渲染
    const hasTodoWrite = results.some(r => r.toolName === 'todo_write');
    const hasAskUser = results.some(r => r.toolName === 'ask_user');
    if (hasTodoWrite) {
        _renderTodoCard(messageContainer, results);
    }
    if (hasAskUser) {
        _renderAskUserCard(messageContainer, results);
    }

    // 持久化工具调用结果到 sessionStorage（修复刷新后 notice 卡片丢失）
    // 刷新后 history-cleanup.js 清理了 XML，scanToolCallElements 不会触发本函数，
    // 但 _restoreToolCallNoticeFromStorage 会从 sessionStorage 读取并重新渲染 notice。
    // 使用消息文本哈希作为 key，刷新后哈希一致（因为 textContent 都是清理后的版本）。
    try {
        _saveToolResultsToStorage(messageContainer, results);
    } catch (e) {}

    // 触发能力代理（Capability Agent）续跑：将工具调用结果回传给 DeepSeek
    // 仅对"需要返回结果"的工具触发续跑（如 memory_save/memory_review/web_search 等）
    // memory_recall 等仅记录型工具不需要 agent 反馈，AI 可直接继续对话
    //
    // 特殊处理：如果 AI 调用了 agent_finish，说明 AI 已声明任务完成，
    // 此时不应触发续跑（即使同一条回复中还有其他工具调用），
    // 而是直接调用 window._dsStopAgent() 终止 Agent 循环。
    try {
        if (typeof window !== 'undefined' && typeof window._dsOnToolCallExecuted === 'function') {
            // 检测是否包含 agent_finish 工具调用
            const hasAgentFinish = results.some(r => isAgentFinishTool(r.toolName));
            if (hasAgentFinish) {
                // AI 声明任务完成，终止 Agent 循环，不发送续跑 prompt
                if (typeof window._dsStopAgent === 'function') {
                    // 从 agent_finish 的 payload 中提取 reason 参数（如果有）
                    const finishResult = results.find(r => isAgentFinishTool(r.toolName));
                    const reason = finishResult?.payload?.reason;
                    window._dsStopAgent(reason);
                }
            } else {
                // 正常流程：过滤需要 agent 反馈的工具，触发续跑
                const agentResults = results
                    .filter(r => requiresAgentFeedback(r.toolName))
                    .map(r => ({
                        name: r.label,
                        toolName: r.toolName,
                        ok: r.result.ok,
                        skipped: r.result.skipped || false,
                        pending: r.result.pending || false,
                        summary: r.result.summary,
                        detail: r.result.detail || '',
                        payload: r.payload || null
                    }));
                if (agentResults.length > 0) {
                    // 获取原始用户任务（由 fetch-hub.js 的 onStreamStart 记录）
                    const originalPrompt = (typeof window._dsGetOriginalTask === 'function')
                        ? (window._dsGetOriginalTask() || '')
                        : '';
                    window._dsOnToolCallExecuted(agentResults, originalPrompt);
                }
            }
        }
    } catch (e) {}

    // 历史消息加载场景：agent 续跑被跳过，渲染"执行"按钮供用户手动恢复
    // 当 _dsIsHistoricalMessageLoad 返回 true 时，说明 onToolCallExecuted 已跳过续跑，
    // 工具结果保存在 capability-agent 的 skippedToolResults 队列中。
    // 在 notice 容器中渲染"执行"按钮，用户点击后调用 _dsResumeSkippedContinuation 发起续跑。
    try {
        if (typeof window !== 'undefined' &&
            typeof window._dsIsHistoricalMessageLoad === 'function' &&
            typeof window._dsResumeSkippedContinuation === 'function' &&
            window._dsIsHistoricalMessageLoad()) {
            // 仅当有需要 agent 反馈的工具时才渲染按钮（同步工具如 memory_recall 不需要续跑）
            const hasAgentFeedbackTool = results.some(r => requiresAgentFeedback(r.toolName));
            if (hasAgentFeedbackTool) {
                _renderExecuteButton(messageContainer);
            }
        }
    } catch (e) {}
}

/**
 * 确保消息容器存在工具调用提示卡片容器，返回 body 元素供增量插入
 *
 * 异步渲染优化：工具调用并行执行，每个完成时立即 append item 到 body，
 * 不必等所有工具完成。首次调用时创建 notice 容器（header + body），
 * 后续调用直接返回已有 body。
 *
 * @param {Element} messageContainer - 消息容器
 * @returns {Element|null} notice-body 元素；创建失败返回 null
 */
function _ensureToolCallNoticeContainer(messageContainer) {
    if (!messageContainer) return null;
    try {
        // 已存在则返回 body
        const existing = messageContainer.querySelector('.ds-tool-call-notice > .ds-tool-call-notice-body');
        if (existing) return existing;

        // 创建 notice 容器（header + 空 body）
        _injectToolCallNoticeStyles();
        const notice = document.createElement('div');
        notice.className = 'ds-tool-call-notice';
        notice.innerHTML = `
            <div class="ds-tool-call-notice-header">
                <span class="ds-tool-call-notice-icon">🔧</span>
                <span class="ds-tool-call-notice-title">工具调用</span>
                <span class="ds-tool-call-notice-count">0 次</span>
            </div>
            <div class="ds-tool-call-notice-body"></div>
        `;
        messageContainer.appendChild(notice);
        return notice.querySelector('.ds-tool-call-notice-body');
    } catch (e) {
        return null;
    }
}

/**
 * 向 notice 容器增量插入单个工具调用 item
 *
 * 异步渲染优化：每个工具执行完成时立即调用此函数插入其 item，
 * 用户能实时看到每个工具的执行进度，不必等所有工具完成。
 * 同时更新 header 中的计数。
 *
 * @param {Element} noticeBody - _ensureToolCallNoticeContainer 返回的 body 元素
 * @param {{ label: string, result: Object, toolName?: string, payload?: Object }} entry - 单个工具结果
 */
function _appendToolCallNoticeItem(noticeBody, entry) {
    if (!noticeBody || !entry) return;
    try {
        const info = _formatToolCallInfo(entry);
        const item = document.createElement('div');
        item.className = 'ds-tool-call-notice-item';
        item.innerHTML = `
            <span class="ds-tool-call-notice-item-label">🔧 ${_escapeHtml(entry.label)}</span>
            ${info ? `<span class="ds-tool-call-notice-item-info">${_escapeHtml(info)}</span>` : ''}
        `;
        noticeBody.appendChild(item);
        // 更新计数：当前 body 中的 item 数量
        const notice = noticeBody.closest('.ds-tool-call-notice');
        if (notice) {
            const countEl = notice.querySelector('.ds-tool-call-notice-count');
            const count = noticeBody.querySelectorAll('.ds-tool-call-notice-item').length;
            if (countEl) countEl.textContent = count + ' 次';
        }
    } catch (e) {}
}

/**
 * 在工具调用 notice 容器中渲染"执行"按钮
 *
 * 历史消息加载场景：agent 续跑被跳过（lastUserMessageTime=0），
 * 工具结果保存在 capability-agent 的 skippedToolResults 队列。
 * 此函数在 notice 容器末尾渲染一个"执行"按钮，用户点击后调用
 * _dsResumeSkippedContinuation 手动发起续跑（把工具结果回传给 AI）。
 *
 * 设计要点：
 *   - 按钮插入到 notice 容器内（.ds-tool-call-notice 下）
 *   - 点击后禁用按钮 + 改文案为"执行中..."，防止重复点击
 *   - 续跑启动后按钮淡出移除（由 agent 流程接管）
 *
 * @param {Element} messageContainer - 消息容器
 */
function _renderExecuteButton(messageContainer) {
    if (!messageContainer) return;
    try {
        // 确保 notice 容器存在
        const notice = messageContainer.querySelector('.ds-tool-call-notice');
        if (!notice) return;
        // 避免重复渲染
        if (notice.querySelector('.ds-tool-execute-btn')) return;

        _injectExecuteButtonStyles();
        const btn = document.createElement('button');
        btn.className = 'ds-tool-execute-btn';
        btn.type = 'button';
        btn.textContent = '▶ 执行';
        btn.title = '手动发起续跑，将工具结果回传给 AI 继续';
        btn.addEventListener('click', () => {
            if (btn.disabled) return;
            btn.disabled = true;
            btn.textContent = '执行中...';
            btn.classList.add('ds-tool-execute-btn--loading');
            try {
                if (typeof window._dsResumeSkippedContinuation === 'function') {
                    window._dsResumeSkippedContinuation();
                }
            } catch (e) {}
            // 短暂延迟后移除按钮（续跑已启动，agent 流程接管）
            setTimeout(() => {
                if (btn.parentNode) {
                    btn.style.transition = 'opacity 0.3s';
                    btn.style.opacity = '0';
                    setTimeout(() => btn.remove(), 300);
                }
            }, 800);
        });
        notice.appendChild(btn);
    } catch (e) {}
}

/**
 * 注入"执行"按钮的 CSS 样式
 * 只注入一次，通过 data 属性标记避免重复
 */
function _injectExecuteButtonStyles() {
    if (document.getElementById('ds-tool-execute-btn-styles')) return;
    const style = document.createElement('style');
    style.id = 'ds-tool-execute-btn-styles';
    style.textContent = `
.ds-tool-execute-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    margin-top: 8px;
    padding: 4px 14px;
    font-size: 12px;
    font-weight: 600;
    color: #fff;
    background: linear-gradient(135deg, #4f6ef7 0%, #6c5ce7 100%);
    border: none;
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.2s ease;
    box-shadow: 0 1px 3px rgba(79, 110, 247, 0.3);
}
.ds-tool-execute-btn:hover:not(:disabled) {
    transform: translateY(-1px);
    box-shadow: 0 3px 8px rgba(79, 110, 247, 0.4);
}
.ds-tool-execute-btn:active:not(:disabled) {
    transform: translateY(0);
}
.ds-tool-execute-btn:disabled {
    cursor: default;
    opacity: 0.7;
}
.ds-tool-execute-btn--loading {
    background: linear-gradient(135deg, #a0a0a0 0%, #808080 100%);
    box-shadow: none;
}
    `;
    document.head.appendChild(style);
}

/**
 * 从 DOM 元素向上查找消息容器并插入工具调用提示卡片
 * 只显示调用了什么工具，不显示成功/失败状态
 * @param {Element} el - 工具调用元素
 * @param {Array<{ label: string, result: { ok: boolean, summary: string, detail?: string } }>} results - 工具调用结果
 */
function _insertToolCallNoticeFromElement(el, results) {
    if (!el || !results || results.length === 0) return;
    if (!utils.isNodeAttached(el)) return;

    // 检测 todo_write 调用：渲染特殊 todo 卡片（含进度条和三色状态）
    // 命中后跳过默认工具卡片渲染，其他工具仍走下方默认逻辑
    const hasTodoWrite = results.some(r => r.toolName === 'todo_write');
    if (hasTodoWrite) {
        _renderTodoCard(el, results);
        return;  // 不走默认工具卡片渲染
    }

    // 检测 ask_user 调用：渲染特殊提问卡片
    // 命中后跳过默认工具卡片渲染，由 _renderAskUserCard 接管 UI
    const hasAskUser = results.some(r => r.toolName === 'ask_user');
    if (hasAskUser) {
        _renderAskUserCard(el, results);
        return;  // 不走默认工具卡片渲染
    }

    try {
        const messageEl = el.closest('.ds-message, [data-message-id], .ds-markdown, .markdown-body, [class*="message"]') || el.parentElement;
        if (!messageEl) return;
        // 增量渲染兼容：若已有 notice 容器（来自 _processMessageForToolCalls 的增量渲染），
        // 直接 append 所有 item；否则按原逻辑一次性创建
        const existingBody = messageEl.querySelector('.ds-tool-call-notice > .ds-tool-call-notice-body');
        if (existingBody) {
            for (const entry of results) {
                _appendToolCallNoticeItem(existingBody, entry);
            }
            return;
        }
        if (messageEl.querySelector('.ds-tool-call-notice')) return;

        const notice = document.createElement('div');
        notice.className = 'ds-tool-call-notice';
        notice.innerHTML = _buildToolCallNoticeHTML(results);
        _injectToolCallNoticeStyles();
        messageEl.appendChild(notice);
    } catch (e) {}
}

/**
 * 构建工具调用提示卡片的 HTML
 * 统一显示工具标签 + 基础信息（如记忆标题、类型、标签）
 * @param {Array<{ label: string, result: Object, toolName?: string, payload?: Object }>} results - 工具调用结果数组
 * @returns {string} 卡片 HTML 字符串
 */
function _buildToolCallNoticeHTML(results) {
    const items = results.map(r => {
        const info = _formatToolCallInfo(r);
        return `
            <div class="ds-tool-call-notice-item">
                <span class="ds-tool-call-notice-item-label">🔧 ${_escapeHtml(r.label)}</span>
                ${info ? `<span class="ds-tool-call-notice-item-info">${_escapeHtml(info)}</span>` : ''}
            </div>
        `;
    }).join('');
    return `
        <div class="ds-tool-call-notice-header">
            <span class="ds-tool-call-notice-icon">🔧</span>
            <span class="ds-tool-call-notice-title">工具调用</span>
            <span class="ds-tool-call-notice-count">${results.length} 次</span>
        </div>
        <div class="ds-tool-call-notice-body">${items}</div>
    `;
}

/**
 * 格式化工具调用的基础信息为简短描述
 * 用于在提示卡片中展示记忆标题、类型、标签等关键信息
 * @param {Object} r - { label, result, toolName?, payload? }
 * @returns {string} 简短信息（如 "用户称呼 · preference · #身份"），无信息时返回空字符串
 */
function _formatToolCallInfo(r) {
    if (!r || !r.payload || typeof r.payload !== 'object') return '';
    try {
        const p = r.payload;
        if (r.toolName === 'memory_save' || r.toolName === 'memory_update') {
            const parts = [];
            // 优先使用 name 字段作为主标题（用户可读）
            if (typeof p.name === 'string' && p.name.trim()) {
                parts.push(p.name.trim());
            } else if (typeof p.id === 'string' && p.id.trim()) {
                // fallback：name 缺失时显示 id
                parts.push(p.id.trim());
            }
            if (typeof p.type === 'string' && p.type.trim()) parts.push(p.type);
            if (Array.isArray(p.tags) && p.tags.length > 0) {
                const tagStr = p.tags
                    .filter(t => typeof t === 'string' && t.trim())
                    .map(t => '#' + t.trim())
                    .join(' ');
                if (tagStr) parts.push(tagStr);
            }
            return parts.join(' · ');
        }
        if (r.toolName === 'memory_delete') {
            // 删除记忆：优先显示 name（如果有），否则 fallback 到 id
            if (typeof p.name === 'string' && p.name.trim()) {
                return p.name.trim();
            }
            return typeof p.id === 'string' ? p.id.trim() : '';
        }
        if (r.toolName === 'memory_import_preview') {
            // 预览导入记忆：显示默认类型 + 标签 + content 预览
            const parts = [];
            if (typeof p.defaultType === 'string' && p.defaultType.trim()) {
                parts.push(p.defaultType.trim());
            }
            if (Array.isArray(p.tags) && p.tags.length > 0) {
                const tagStr = p.tags
                    .filter(t => typeof t === 'string' && t.trim())
                    .map(t => '#' + t.trim())
                    .join(' ');
                if (tagStr) parts.push(tagStr);
            }
            if (typeof p.content === 'string' && p.content.trim()) {
                const preview = p.content.trim().slice(0, 50);
                parts.push(preview + (p.content.trim().length > 50 ? '...' : ''));
            }
            return parts.join(' · ');
        }
        if (r.toolName === 'memory_recall') {
            // 报告调用记忆：显示调用了几条记忆 + ID 列表（截断）
            const ids = Array.isArray(p.memoryIds) ? p.memoryIds.filter(id => typeof id === 'string') : [];
            if (ids.length === 0) return '';
            const idStr = ids.slice(0, 3).join(', ');
            const moreHint = ids.length > 3 ? ` 等 ${ids.length} 条` : '';
            return `调用 ${ids.length} 条: ${idStr}${moreHint}`;
        }
        if (r.toolName === 'memory_merge') {
            // 融合记忆：显示融合了几条 + 新标题
            const ids = Array.isArray(p.memoryIds) ? p.memoryIds.filter(id => typeof id === 'string') : [];
            const name = typeof p.name === 'string' && p.name.trim() ? p.name.trim() : '';
            const countPart = ids.length > 0 ? `融合 ${ids.length} 条 → ` : '';
            return countPart + name;
        }
        if (r.toolName === 'memory_review') {
            // 审查记忆：显示审查重点
            const focus = typeof p.focus === 'string' && p.focus.trim() ? p.focus.trim() : '全面审查';
            return `审查重点: ${focus}`;
        }
        return '';
    } catch (e) {
        return '';
    }
}

/**
 * 全量扫描：角标清理 → 链接扫描 → 文本节点扫描 → 工具调用元素扫描 → Mermaid 图表扫描
 * 每个步骤独立 try-catch，防止单步失败导致整体崩溃
 * @param {Element} root
 */
export function fullScan(root) {
    if (!root || root.nodeType !== 1) return;
    // early return：无子节点且非元素时跳过
    if (!root.childNodes || root.childNodes.length === 0) return;
    try { cleanElementCitations(root); } catch (e) {}
    try { scanLinks(root); } catch (e) {}
    try { scanTextNodes(root); } catch (e) {}
    try { scanToolCallElements(root); } catch (e) {}
    try { scanMermaid(root); } catch (e) {}
}

// ============================================================
// Agent 集成接口：暴露扫描和检测函数到 window
// ============================================================

/**
 * 检测 DOM 中是否有未处理的工具调用 XML
 *
 * 扫描所有 AI 消息容器，检查是否有段落包含工具调用 XML 但未标记 dsToolProcessed。
 * 用于 capability-agent.js 的 _waitForToolResultsStable 判断是否还有工具未执行。
 *
 * @returns {boolean} true=有未处理的工具调用，false=全部已处理
 */
function _hasUnprocessedToolCalls() {
    if (typeof window === 'undefined' || typeof window._dsParseToolCalls !== 'function') return false;
    const toolNames = _resolveToolNames();
    if (toolNames.length === 0) return false;
    // 扫描所有 AI 消息容器
    const containers = document.querySelectorAll('.ds-message, [data-message-id], .markdown-body');
    for (const container of containers) {
        // 整消息容器未处理：检查 textContent 是否含工具调用 XML
        if (container.dataset.dsToolProcessed !== 'true') {
            const text = container.textContent || '';
            if (text.length >= 10) {
                for (const name of toolNames) {
                    if (text.includes('<' + name + '>')) return true;
                }
            }
        }
        // 检查子段落：已标记整消息处理但子段落可能未处理（跨段落场景）
        const paragraphs = container.querySelectorAll('p.ds-markdown-paragraph, p, div.ds-markdown-paragraph, div');
        for (const p of paragraphs) {
            if (p.dataset.dsToolProcessed === 'true') continue;
            const pText = p.textContent || '';
            if (pText.length < 10) continue;
            for (const name of toolNames) {
                if (pText.includes('<' + name + '>')) return true;
            }
        }
    }
    return false;
}

/**
 * 暴露扫描和检测函数到 window（供 capability-agent.js 调用）
 *
 * - window._dsScanToolCalls：主动触发 DOM 扫描（不依赖 MutationObserver）
 * - window._dsHasUnprocessedToolCalls：检测是否有未处理的工具调用
 * - window._dsToolExecutionCount：正在执行的工具计数（由 _processMessageForToolCalls 维护）
 */
if (typeof window !== 'undefined') {
    if (typeof window._dsScanToolCalls !== 'function') {
        window._dsScanToolCalls = function(root) {
            try { scanToolCallElements(root || document.body); } catch (e) {}
        };
    }
    if (typeof window._dsHasUnprocessedToolCalls !== 'function') {
        window._dsHasUnprocessedToolCalls = _hasUnprocessedToolCalls;
    }
}

/**
 * 渲染 todo 卡片（特殊 UI，含进度条和三色状态）
 *
 * 当 AI 调用 todo_write 工具时，用特殊卡片展示当前清单状态，
 * 而非默认的紧凑工具调用卡片。卡片样式：
 *   - 头部：📋 任务清单 M/N
 *   - 列表：每项一行，状态图标 + 优先级标签 + id + content
 *   - 进度条：20 格 + 百分比
 *
 * 颜色：
 *   - completed：绿色 #22c55e + 删除线
 *   - in_progress：蓝色 #3b82f6 + 加粗
 *   - pending：灰色 #9ca3af
 *
 * 安全：所有文本节点使用 textContent（防 XSS）
 * 历史快照：在 todo_write 调用时立即渲染并插入 DOM，不监听后续变化
 *
 * @param {Element} paragraph - 段落元素
 * @param {Array<{toolName:string, payload:Object, result:Object}>} results - 工具调用结果
 */
function _renderTodoCard(paragraph, results) {
    if (!paragraph) return;

    // 从 results 中找到 todo_write 的 payload（用于渲染当前快照）
    const todoWriteResult = results.find(r => r.toolName === 'todo_write');
    if (!todoWriteResult || !todoWriteResult.payload || !todoWriteResult.payload.todos) {
        // 没有 payload 或 todos：无法渲染特殊卡片，直接返回（默认渲染已被跳过）
        return;
    }

    const todos = todoWriteResult.payload.todos;
    const total = todos.length;
    const completed = todos.filter(t => t.status === 'completed').length;
    const percent = total > 0 ? Math.round(completed / total * 100) : 0;

    // 注入样式（首次调用时，幂等）
    _injectTodoCardStyles();

    // 构建卡片 DOM
    const card = document.createElement('div');
    card.className = 'ds-todo-card';

    // 头部：图标 + 标题 + 计数器
    const header = document.createElement('div');
    header.className = 'ds-todo-card-header';
    const icon = document.createElement('span');
    icon.textContent = '📋';
    const title = document.createElement('span');
    title.className = 'ds-todo-card-title';
    title.textContent = '任务清单';
    const counter = document.createElement('span');
    counter.className = 'ds-todo-card-counter';
    counter.textContent = `${completed}/${total}`;
    header.appendChild(icon);
    header.appendChild(title);
    header.appendChild(counter);
    card.appendChild(header);

    // 列表：每项一行（状态图标 + 优先级 + id + 内容）
    const list = document.createElement('div');
    list.className = 'ds-todo-card-list';
    for (const todo of todos) {
        const item = document.createElement('div');
        item.className = `ds-todo-item ${todo.status || 'pending'}`;

        // 状态图标：✓ 已完成 / ▶ 进行中 / ○ 待办
        const statusIcon = document.createElement('span');
        statusIcon.className = 'ds-todo-status-icon';
        statusIcon.textContent = todo.status === 'completed' ? '✓' : (todo.status === 'in_progress' ? '▶' : '○');
        item.appendChild(statusIcon);

        // 优先级标签：高/中/低
        const pri = document.createElement('span');
        pri.className = `ds-todo-priority ${todo.priority || 'medium'}`;
        pri.textContent = todo.priority === 'high' ? '高' : (todo.priority === 'low' ? '低' : '中');
        item.appendChild(pri);

        // 任务编号
        const idSpan = document.createElement('span');
        idSpan.className = 'ds-todo-id';
        idSpan.textContent = '#' + (todo.id || '');
        item.appendChild(idSpan);

        // 任务内容
        const contentSpan = document.createElement('span');
        contentSpan.className = 'ds-todo-content';
        contentSpan.textContent = todo.content || '';
        item.appendChild(contentSpan);

        list.appendChild(item);
    }
    card.appendChild(list);

    // 进度条：20 格方块 + 百分比
    const progress = document.createElement('div');
    progress.className = 'ds-todo-progress';
    const filled = Math.round(percent / 100 * 20);
    const bar = document.createElement('div');
    bar.className = 'ds-todo-progress-bar';
    bar.textContent = '█'.repeat(filled) + '░'.repeat(20 - filled);
    const percentLabel = document.createElement('span');
    percentLabel.className = 'ds-todo-progress-percent';
    percentLabel.textContent = `${percent}%`;
    progress.appendChild(bar);
    progress.appendChild(percentLabel);
    card.appendChild(progress);

    // 插入到段落之后（参考 _insertToolCallNoticeFromElement 的插入方式）
    const parent = paragraph.parentNode;
    if (parent) {
        parent.insertBefore(card, paragraph.nextSibling);
    }
}

/**
 * 注入 todo 卡片 CSS 样式（首次渲染 todo 卡片时调用）
 * 幂等：通过 id 检测避免重复注入
 */
function _injectTodoCardStyles() {
    if (document.getElementById('ds-todo-card-styles')) return;
    const style = document.createElement('style');
    style.id = 'ds-todo-card-styles';
    style.textContent = `
.ds-todo-card {
    margin: 8px 0;
    padding: 12px 14px;
    background: linear-gradient(135deg, #f9fafb 0%, #f3f4f6 100%);
    border: 1px solid #e5e7eb;
    border-radius: 10px;
    font-size: 13px;
    line-height: 1.6;
    box-shadow: 0 2px 6px rgba(0,0,0,0.04);
    user-select: none;
}
.ds-todo-card-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding-bottom: 8px;
    margin-bottom: 8px;
    border-bottom: 1px solid #e5e7eb;
    font-weight: 600;
    color: #374151;
}
.ds-todo-card-title {
    flex: 1;
    font-size: 13px;
}
.ds-todo-card-counter {
    font-size: 12px;
    color: #6b7280;
    background: #e5e7eb;
    padding: 2px 8px;
    border-radius: 10px;
}
.ds-todo-card-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 10px;
}
.ds-todo-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 3px 0;
    font-size: 13px;
}
.ds-todo-item.completed {
    color: #22c55e;
    text-decoration: line-through;
    opacity: 0.7;
}
.ds-todo-item.in_progress {
    color: #3b82f6;
    font-weight: 600;
}
.ds-todo-item.pending {
    color: #9ca3af;
}
.ds-todo-status-icon {
    flex-shrink: 0;
    width: 16px;
    text-align: center;
    font-weight: 700;
}
.ds-todo-priority {
    flex-shrink: 0;
    font-size: 11px;
    padding: 1px 6px;
    border-radius: 4px;
    font-weight: 500;
}
.ds-todo-priority.high {
    background: #fee2e2;
    color: #dc2626;
}
.ds-todo-priority.medium {
    background: #fef3c7;
    color: #d97706;
}
.ds-todo-priority.low {
    background: #f3f4f6;
    color: #6b7280;
}
.ds-todo-id {
    flex-shrink: 0;
    color: #9ca3af;
    font-size: 12px;
    font-family: monospace;
}
.ds-todo-content {
    flex: 1;
    min-width: 0;
    word-break: break-word;
}
.ds-todo-progress {
    display: flex;
    align-items: center;
    gap: 8px;
    padding-top: 8px;
    border-top: 1px solid #e5e7eb;
    font-size: 12px;
    color: #6b7280;
}
.ds-todo-progress-bar {
    font-family: monospace;
    letter-spacing: -1px;
    color: #3b82f6;
}
.ds-todo-progress-percent {
    font-weight: 600;
    color: #374151;
}
    `;
    document.head.appendChild(style);
}

/**
 * 渲染 ask_user 提问卡片
 *
 * 当 AI 调用 ask_user 工具时，渲染特殊提问卡片：
 *   - 头部：❓ 请回答以下问题
 *   - 问题列表：每个问题一个块，含 header 标签、question 文本、选项按钮组
 *   - 选项按钮：点击高亮（单选切换、多选切换），支持"其他"按钮显示输入框
 *   - 底部按钮：[取消] [提交]
 *
 * 用户提交时调用 window._dsSubmitAskUserAnswer(answers)
 * 用户取消时调用 window._dsCancelAskUser()
 *
 * 安全：所有文本节点使用 textContent（防 XSS）
 *
 * @param {Element} paragraph - 段落元素
 * @param {Array<{toolName:string, payload:Object, result:Object}>} results - 工具调用结果
 */
function _renderAskUserCard(paragraph, results) {
    if (!paragraph) return;

    // 防重复：已存在 ask_user 卡片则跳过（processToolCalls 和 _processMessageForToolCalls 可能都调用本函数）
    const parentNode = paragraph.parentNode;
    if (parentNode && parentNode.querySelector(':scope > .ds-ask-card')) {
        return;
    }

    // 从 results 中找到 ask_user 的 payload
    const askUserResult = results.find(r => r.toolName === 'ask_user');
    // 调试日志：记录 payload 格式，便于诊断 ask_user 卡片未渲染问题
    console.log('[ask_user] _renderAskUserCard payload:', {
        found: !!askUserResult,
        payloadType: askUserResult?.payload ? typeof askUserResult.payload : 'null',
        payloadKeys: askUserResult?.payload && typeof askUserResult.payload === 'object' ? Object.keys(askUserResult.payload) : null,
        questionsIsArray: askUserResult?.payload ? Array.isArray(askUserResult.payload.questions) : false,
        questionsLength: askUserResult?.payload && Array.isArray(askUserResult.payload.questions) ? askUserResult.payload.questions.length : 0
    });
    if (!askUserResult || !askUserResult.payload || !Array.isArray(askUserResult.payload.questions)) {
        console.warn('[ask_user] _renderAskUserCard 提前返回：payload.questions 不是数组', askUserResult?.payload);
        return;
    }

    const questions = askUserResult.payload.questions;

    // 创建 ask_user Promise 并存储到全局变量，供 capability-agent.js await
    //
    // 关键设计：自己创建 Promise 和 resolver，不依赖 ask-user.js 的 pendingQuestion 全局状态。
    // 原因：resetContinuationState 会清空 pendingQuestion，导致 submitAnswer 找不到 resolver，
    // 用户提交答案失效。自己管理 resolver 后，即使 pendingQuestion 被清空，
    // 提交按钮仍能直接 resolve Promise，让 _waitForAskUserAnswers 收到答案。
    //
    // 同时仍调用 _dsAskUser 保持兼容（设置 pendingQuestion 供 hasPendingAsk 检测）
    let resolveAskPromise = null;
    if (typeof window !== 'undefined') {
        window._dsPendingAskPromise = new Promise(resolve => {
            resolveAskPromise = resolve;
        });
        // 存储 resolver 到全局，供 stopAgent / resetContinuationState 取消
        window._dsPendingAskResolver = resolveAskPromise;
    }
    // 仍调用 _dsAskUser 设置 pendingQuestion（保持兼容）
    if (typeof window !== 'undefined' && typeof window._dsAskUser === 'function') {
        try { window._dsAskUser(questions); } catch (e) {}
    }

    // 注入样式（首次调用时）
    _injectAskUserCardStyles();

    // 构建卡片 DOM
    const card = document.createElement('div');
    card.className = 'ds-ask-card';

    // 头部
    const header = document.createElement('div');
    header.className = 'ds-ask-card-header';
    const icon = document.createElement('span');
    icon.textContent = '❓';
    const title = document.createElement('span');
    title.className = 'ds-ask-card-title';
    title.textContent = '请回答以下问题';
    header.appendChild(icon);
    header.appendChild(title);
    card.appendChild(header);

    // 用于收集每个问题的选中状态
    const questionStates = questions.map(q => ({
        question: q.question,
        selected: [],  // 选中的 label 数组
        customText: '',
        isCustom: false
    }));

    // 渲染每个问题
    questions.forEach((q, qIdx) => {
        const qBlock = document.createElement('div');
        qBlock.className = 'ds-ask-question';

        // header 标签（chip 风格）
        const headerChip = document.createElement('div');
        headerChip.className = 'ds-ask-question-header';
        headerChip.textContent = q.header || ('问题 ' + (qIdx + 1));
        qBlock.appendChild(headerChip);

        // 问题文本
        const qText = document.createElement('div');
        qText.className = 'ds-ask-question-text';
        qText.textContent = q.question;
        qBlock.appendChild(qText);

        // 选项按钮组
        const optionsContainer = document.createElement('div');
        optionsContainer.className = 'ds-ask-options';

        const multiSelect = q.multiSelect === true;

        q.options.forEach(opt => {
            const btn = document.createElement('div');
            btn.className = 'ds-ask-option';
            btn.setAttribute('role', 'button');
            btn.setAttribute('tabindex', '0');

            const label = document.createElement('div');
            label.className = 'ds-ask-option-label';
            label.textContent = opt.label;
            btn.appendChild(label);

            if (opt.description) {
                const desc = document.createElement('div');
                desc.className = 'ds-ask-option-desc';
                desc.textContent = opt.description;
                btn.appendChild(desc);
            }

            // 点击事件：切换选中状态
            btn.addEventListener('click', () => {
                const state = questionStates[qIdx];
                const idx = state.selected.indexOf(opt.label);
                if (multiSelect) {
                    // 多选：切换
                    if (idx >= 0) {
                        state.selected.splice(idx, 1);
                        btn.classList.remove('selected');
                    } else {
                        state.selected.push(opt.label);
                        btn.classList.add('selected');
                    }
                } else {
                    // 单选：清除同组其他选中，设置当前选中
                    optionsContainer.querySelectorAll('.ds-ask-option').forEach(b => b.classList.remove('selected'));
                    btn.classList.add('selected');
                    state.selected = [opt.label];
                    state.isCustom = false;
                }
                // 隐藏自定义输入框（如果有）
                const customInput = qBlock.querySelector('.ds-ask-other-input');
                if (customInput && !multiSelect) {
                    customInput.style.display = 'none';
                }
            });

            optionsContainer.appendChild(btn);
        });

        // "其他"按钮（自定义输入）
        const otherBtn = document.createElement('div');
        otherBtn.className = 'ds-ask-option ds-ask-option-other';
        otherBtn.setAttribute('role', 'button');
        otherBtn.setAttribute('tabindex', '0');
        const otherLabel = document.createElement('div');
        otherLabel.className = 'ds-ask-option-label';
        otherLabel.textContent = '其他';
        otherBtn.appendChild(otherLabel);

        // 自定义输入框（默认隐藏）
        const customInput = document.createElement('input');
        customInput.type = 'text';
        customInput.className = 'ds-ask-other-input';
        customInput.placeholder = '请输入自定义答案...';
        customInput.style.display = 'none';

        otherBtn.addEventListener('click', () => {
            const state = questionStates[qIdx];
            if (multiSelect) {
                // 多选模式下的"其他"：切换输入框显示
                if (customInput.style.display === 'none') {
                    customInput.style.display = 'block';
                    customInput.focus();
                    state.isCustom = true;
                    otherBtn.classList.add('selected');
                } else {
                    customInput.style.display = 'none';
                    state.isCustom = false;
                    state.customText = '';
                    otherBtn.classList.remove('selected');
                }
            } else {
                // 单选模式：清除其他选中，显示输入框
                optionsContainer.querySelectorAll('.ds-ask-option').forEach(b => b.classList.remove('selected'));
                otherBtn.classList.add('selected');
                customInput.style.display = 'block';
                customInput.focus();
                state.selected = [];
                state.isCustom = true;
            }
        });

        customInput.addEventListener('input', () => {
            questionStates[qIdx].customText = customInput.value;
        });

        optionsContainer.appendChild(otherBtn);
        qBlock.appendChild(optionsContainer);
        qBlock.appendChild(customInput);

        card.appendChild(qBlock);
    });

    // 底部按钮
    const actions = document.createElement('div');
    actions.className = 'ds-ask-actions';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'ds-ask-cancel';
    cancelBtn.textContent = '取消';
    cancelBtn.addEventListener('click', () => {
        // 直接通过 resolver 取消 Promise，不依赖 pendingQuestion 全局状态
        // 这样即使 resetContinuationState 清空了 pendingQuestion，取消仍能生效
        if (typeof window !== 'undefined' && window._dsPendingAskResolver) {
            try {
                window._dsPendingAskResolver({ cancelled: true, reason: '用户取消' });
            } catch (e) {}
            window._dsPendingAskResolver = null;
            window._dsPendingAskPromise = null;
        }
        // 同时调用全局取消（保持兼容，更新 ask-user.js 状态）
        if (typeof window !== 'undefined' && typeof window._dsCancelAskUser === 'function') {
            try { window._dsCancelAskUser(); } catch (e) {}
        }
        // 禁用卡片（避免重复提交）
        card.classList.add('ds-ask-card-submitted');
    });

    const submitBtn = document.createElement('button');
    submitBtn.className = 'ds-ask-submit';
    submitBtn.textContent = '提交';
    submitBtn.addEventListener('click', () => {
        // 收集答案
        const answers = questionStates.map(s => {
            if (s.isCustom) {
                return { question: s.question, answer: s.customText, custom: true };
            }
            return { question: s.question, answer: s.selected.length === 1 ? s.selected[0] : s.selected, custom: false };
        });
        // 直接通过 resolver resolve Promise，不依赖 pendingQuestion 全局状态
        // 这样即使 resetContinuationState 清空了 pendingQuestion，提交仍能生效
        if (typeof window !== 'undefined' && window._dsPendingAskResolver) {
            try {
                window._dsPendingAskResolver(answers || []);
            } catch (e) {}
            window._dsPendingAskResolver = null;
            window._dsPendingAskPromise = null;
        }
        // 同时调用全局提交（保持兼容，更新 ask-user.js 状态）
        if (typeof window !== 'undefined' && typeof window._dsSubmitAskUserAnswer === 'function') {
            try { window._dsSubmitAskUserAnswer(answers); } catch (e) {}
        }
        // 禁用卡片（避免重复提交）
        card.classList.add('ds-ask-card-submitted');

        // 若 agent 未在运行（用户停止、agent_finish、或页面刷新后），手动恢复 agent 续跑
        // 将答案作为 tool_result 发送给 AI，继续对话
        if (typeof window !== 'undefined' && typeof window._dsIsAgentRunning === 'function' && typeof window._dsSubmitAskUserAndResume === 'function') {
            if (!window._dsIsAgentRunning()) {
                console.log('[ask_user] agent 未运行，手动恢复 agent 续跑');
                try { window._dsSubmitAskUserAndResume(answers); } catch (e) {
                    console.warn('[ask_user] 恢复 agent 失败:', e);
                }
            }
        }
    });

    actions.appendChild(cancelBtn);
    actions.appendChild(submitBtn);
    card.appendChild(actions);

    // 插入到段落之后
    const parent = paragraph.parentNode;
    if (parent) {
        parent.insertBefore(card, paragraph.nextSibling);
    }
}

/**
 * 注入 ask_user 提问卡片 CSS 样式（首次渲染时调用）
 * 幂等：通过 id 检测避免重复注入
 */
function _injectAskUserCardStyles() {
    if (document.getElementById('ds-ask-card-styles')) return;
    const style = document.createElement('style');
    style.id = 'ds-ask-card-styles';
    style.textContent = `
.ds-ask-card {
    margin: 8px 0;
    padding: 14px 16px;
    background: linear-gradient(135deg, #faf5ff 0%, #f3e8ff 100%);
    border: 1px solid #d8b4fe;
    border-radius: 10px;
    font-size: 13px;
    line-height: 1.6;
    box-shadow: 0 2px 8px rgba(168, 85, 247, 0.1);
    user-select: none;
}
.ds-ask-card-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding-bottom: 10px;
    margin-bottom: 12px;
    border-bottom: 1px solid #d8b4fe;
    font-weight: 600;
    color: #6b21a8;
}
.ds-ask-card-title {
    flex: 1;
    font-size: 14px;
}
.ds-ask-question {
    margin-bottom: 14px;
    padding: 10px 0;
}
.ds-ask-question-header {
    display: inline-block;
    padding: 2px 10px;
    background: #ede9fe;
    color: #6b21a8;
    border-radius: 10px;
    font-size: 11px;
    font-weight: 600;
    margin-bottom: 6px;
}
.ds-ask-question-text {
    font-size: 14px;
    color: #1f2937;
    margin-bottom: 10px;
    font-weight: 500;
}
.ds-ask-options {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
}
.ds-ask-option {
    flex: 1 1 calc(50% - 4px);
    min-width: 120px;
    padding: 8px 12px;
    background: #fff;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.15s ease;
    user-select: none;
}
.ds-ask-option:hover {
    border-color: #a855f7;
    background: #faf5ff;
}
.ds-ask-option.selected {
    border-color: #a855f7;
    background: #f3e8ff;
    box-shadow: 0 0 0 2px rgba(168, 85, 247, 0.2);
}
.ds-ask-option-label {
    font-size: 13px;
    font-weight: 600;
    color: #1f2937;
    margin-bottom: 2px;
}
.ds-ask-option-desc {
    font-size: 11px;
    color: #6b7280;
    line-height: 1.4;
}
.ds-ask-option-other {
    flex: 0 0 auto;
    min-width: 80px;
    background: #f9fafb;
    border-style: dashed;
}
.ds-ask-other-input {
    width: 100%;
    margin-top: 8px;
    padding: 8px 12px;
    border: 1px solid #d8b4fe;
    border-radius: 6px;
    font-size: 13px;
    background: #fff;
    box-sizing: border-box;
}
.ds-ask-other-input:focus {
    outline: none;
    border-color: #a855f7;
    box-shadow: 0 0 0 2px rgba(168, 85, 247, 0.2);
}
.ds-ask-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 12px;
    padding-top: 12px;
    border-top: 1px solid #d8b4fe;
}
.ds-ask-submit, .ds-ask-cancel {
    padding: 6px 16px;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;
    border: none;
}
.ds-ask-submit {
    background: linear-gradient(135deg, #a855f7 0%, #9333ea 100%);
    color: #fff;
}
.ds-ask-submit:hover {
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(168, 85, 247, 0.3);
}
.ds-ask-cancel {
    background: #f3f4f6;
    color: #6b7280;
}
.ds-ask-cancel:hover {
    background: #e5e7eb;
}
.ds-ask-card-submitted {
    opacity: 0.6;
    pointer-events: none;
}
    `;
    document.head.appendChild(style);
}
