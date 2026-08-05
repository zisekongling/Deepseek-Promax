/**
 * 工具结果归一化（P5：MCP 结果适配器）
 *
 * MCP 工具结果可能含 content blocks（text/image/resource）、base64 图片、
 * 错误对象等非标准结构，直接进入 buildContinuationPrompt 会破坏 <tool_results>
 * 渲染或爆 prompt。本模块在入队前统一适配为标准形状。
 *
 * 适配规则：
 *   - 内置工具（memory/todo/ask_user/web_search/web_fetch/python_exec 等）：
 *     结果已是标准形状（含 pending/userAnswers/agentStarted 等特殊字段），原样返回
 *   - MCP 工具（mcp__* 前缀）：调 _normalizeMcpResult 归一化
 *
 * 本模块零外部依赖，所有函数均为纯函数，便于测试和复用。
 */

/**
 * 单个工具结果 detail 的最大字节数（10KB）
 *
 * 超过此阈值的 MCP 结果 detail 会被截断并标注 [结果已截断]，
 * 避免超大 MCP 响应（如长文本、base64 图片）撑爆续跑 prompt。
 */
const MAX_TOOL_RESULT_DETAIL_BYTES = 10 * 1024;

/**
 * 归一化工具调用结果为标准形状
 *
 * @param {string} toolName - 工具名（英文，如 memory_save / mcp__server__tool）
 * @param {Object} rawResult - 原始工具结果
 * @returns {{ name: string, toolName: string, ok: boolean, summary: string, detail: string }}
 */
export function normalizeToolResult(toolName, rawResult) {
    // 防御性 Promise 检测：正常路径不应触发（text-process.js 已 await 异步工具）
    // 若触发说明上游未正确 await，构造明确的失败结果避免后续访问 Promise 的 undefined 字段
    if (rawResult && typeof rawResult.then === 'function') {
        console.warn('[CapabilityAgent] 工具结果为 Promise（未 await）:', toolName);
        return {
            name: toolName,
            toolName,
            ok: false,
            summary: '工具结果未就绪（Promise 未 await）',
            detail: 'text-process.js 未正确 await 异步工具执行'
        };
    }

    // 防御：rawResult 非对象时构造失败结果，避免后续访问属性崩溃
    if (!rawResult || typeof rawResult !== 'object') {
        return {
            name: toolName,
            toolName,
            ok: false,
            summary: '工具结果无效',
            detail: String(rawResult || '')
        };
    }

    // MCP 工具（mcp__* 前缀）需要归一化 content blocks / 图片 / 错误对象
    if (typeof toolName === 'string' && toolName.indexOf('mcp__') === 0) {
        return _normalizeMcpResult(toolName, rawResult);
    }

    // 内置工具结果已是标准形状（含 pending/userAnswers/agentStarted 等特殊字段），原样返回
    return rawResult;
}

/**
 * 归一化 MCP 工具结果
 *
 * MCP 工具结果（来自 mcp.callTool / transport.normalizeToolResult）形状：
 *   成功：{ ok: true, summary, detail, output: content数组|structuredContent, isError: false, truncated }
 *   失败：{ ok: false, summary, detail, error: { code, message, retryable }, isError: true }
 *
 * 其中 output 可能是 content blocks 数组，每项为：
 *   - { type: 'text', text: '...' }
 *   - { type: 'image', data: 'base64...', mimeType: '...' }（base64 会爆 prompt）
 *   - { type: 'resource', resource: { ... } }
 *
 * @param {string} toolName - MCP 工具名（mcp__server__tool）
 * @param {Object} rawResult - 原始结果（来自 mcp.callTool）
 * @returns {{ name: string, toolName: string, ok: boolean, summary: string, detail: string }}
 */
function _normalizeMcpResult(toolName, rawResult) {
    const baseSummary = typeof rawResult.summary === 'string' ? rawResult.summary : '';
    const baseDetail = typeof rawResult.detail === 'string' ? rawResult.detail : '';

    // 失败结果：ok=false 或 isError=true
    if (rawResult.ok === false || rawResult.isError === true) {
        const err = rawResult.error;
        if (err && typeof err === 'object') {
            const errMsg = typeof err.message === 'string' && err.message
                ? err.message
                : (typeof err.code === 'string' ? err.code : 'MCP 工具调用失败');
            return {
                name: toolName,
                toolName,
                ok: false,
                summary: baseSummary || errMsg,
                detail: _truncateDetail(_safeStringify({ error: err, summary: baseSummary, detail: baseDetail }))
            };
        }
        return {
            name: toolName,
            toolName,
            ok: false,
            summary: baseSummary || 'MCP 工具调用失败',
            detail: _truncateDetail(baseDetail || '')
        };
    }

    // 成功结果：解析 output 中的 content blocks
    const output = rawResult.output;

    // 无 output 字段：用 summary/detail（已是标准形状），空结果兜底
    if (!output || (typeof output !== 'object' && typeof output !== 'string')) {
        // 尝试从 detail 解析 content blocks
        if (baseDetail) {
            const parsedBlocks = _tryParseContentBlocks(baseDetail);
            if (parsedBlocks) {
                return _normalizeMcpContentBlocks(toolName, parsedBlocks, baseSummary, baseDetail);
            }
        }
        // 无法解析为 content blocks：按普通文本处理（截断防爆 prompt）
        if (!baseSummary && !baseDetail) {
            return {
                name: toolName,
                toolName,
                ok: true,
                summary: '(空结果)',
                detail: ''
            };
        }
        return {
            name: toolName,
            toolName,
            ok: true,
            summary: baseSummary || '(MCP 结果)',
            detail: _truncateDetail(baseDetail)
        };
    }

    // output 是字符串：直接作为 detail
    if (typeof output === 'string') {
        return {
            name: toolName,
            toolName,
            ok: true,
            summary: baseSummary || output.slice(0, 200) || '(MCP 结果)',
            detail: _truncateDetail(output)
        };
    }

    // output 是数组：content blocks 形式（来自 normalizeOutput 的 content.map）
    if (Array.isArray(output)) {
        return _normalizeMcpContentBlocks(toolName, output, baseSummary, baseDetail);
    }

    // output 是对象：structuredContent 形式，序列化为 JSON
    return {
        name: toolName,
        toolName,
        ok: true,
        summary: baseSummary || '(MCP 结构化结果)',
        detail: _truncateDetail(_safeStringify(output))
    };
}

/**
 * 尝试从 detail 字符串解析回 MCP content blocks 数组
 *
 * 识别规则：JSON 解析成功 + 是数组 + 元素均为含 type 字段的对象
 *
 * @param {string} detail - 待解析的字符串（可能是 content blocks JSON 或纯文本）
 * @returns {Array|null} content blocks 数组；无法解析时返回 null
 */
function _tryParseContentBlocks(detail) {
    if (typeof detail !== 'string' || !detail) return null;
    const trimmed = detail.trim();
    if (!trimmed || trimmed[0] !== '[' || trimmed[trimmed.length - 1] !== ']') return null;
    try {
        const parsed = JSON.parse(trimmed);
        if (!Array.isArray(parsed) || parsed.length === 0) return null;
        for (const b of parsed) {
            if (!b || typeof b !== 'object' || typeof b.type !== 'string') return null;
        }
        return parsed;
    } catch (e) {
        return null;
    }
}

/**
 * 归一化 MCP content blocks 数组为标准结果
 *
 * 遍历 content blocks 分离 text/image/other，按任务规范处理：
 *   - 纯图片：summary='[图片结果]'，detail='[图片内容已省略]'（避免 base64 爆 prompt）
 *   - 含 text：summary 取前 200 字，detail 为完整 text（图片标注省略）
 *
 * @param {string} toolName - MCP 工具名
 * @param {Array} contentBlocks - content block 数组（每项含 type 字段）
 * @param {string} baseSummary - 原始 summary（作为回退）
 * @param {string} baseDetail - 原始 detail（作为回退）
 * @returns {{ name: string, toolName: string, ok: boolean, summary: string, detail: string }}
 */
function _normalizeMcpContentBlocks(toolName, contentBlocks, baseSummary, baseDetail) {
    if (!contentBlocks || contentBlocks.length === 0) {
        return {
            name: toolName,
            toolName,
            ok: true,
            summary: baseSummary || '(空结果)',
            detail: _truncateDetail(baseDetail)
        };
    }

    const textParts = [];
    const otherParts = [];
    let hasImage = false;

    for (const block of contentBlocks) {
        if (!block || typeof block !== 'object') continue;
        const blockType = typeof block.type === 'string' ? block.type : 'unknown';
        if (blockType === 'text' && typeof block.text === 'string') {
            textParts.push(block.text);
        } else if (blockType === 'image') {
            hasImage = true;
        } else {
            otherParts.push(_safeStringify(block));
        }
    }

    // 纯图片结果：避免 base64 爆 prompt
    if (hasImage && textParts.length === 0 && otherParts.length === 0) {
        return {
            name: toolName,
            toolName,
            ok: true,
            summary: '[图片结果]',
            detail: '[图片内容已省略]'
        };
    }

    // 混合结果：text 为主，标注图片省略
    const fullText = textParts.join('\n');
    const detailParts = [];
    if (fullText) detailParts.push(fullText);
    if (hasImage) detailParts.push('[图片内容已省略]');
    if (otherParts.length > 0) detailParts.push(...otherParts);

    const detailStr = detailParts.join('\n');
    const summary = fullText
        ? fullText.slice(0, 200)
        : (baseSummary || (hasImage ? '[图片结果]' : '(MCP 结果)'));

    return {
        name: toolName,
        toolName,
        ok: true,
        summary,
        detail: _truncateDetail(detailStr)
    };
}

/**
 * 截断工具结果 detail（超过 10KB 时截断并标注）
 *
 * 按 UTF-8 字节估算（中文 3 字节，ASCII 1 字节），超过 MAX_TOOL_RESULT_DETAIL_BYTES
 * 时按比例截断字符数并追加 [结果已截断] 标注。
 *
 * @param {string} text - 原始文本
 * @returns {string} 截断后的文本（未超限则原样返回）
 */
function _truncateDetail(text) {
    if (typeof text !== 'string' || text.length === 0) return text || '';
    let byteLen = 0;
    for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        if (code < 0x80) byteLen += 1;
        else if (code < 0x800) byteLen += 2;
        else byteLen += 3;
    }
    if (byteLen <= MAX_TOOL_RESULT_DETAIL_BYTES) return text;
    const ratio = MAX_TOOL_RESULT_DETAIL_BYTES / byteLen;
    const cutChars = Math.floor(text.length * ratio * 0.9);
    return text.slice(0, cutChars) + '\n...[结果已截断]';
}

/**
 * 安全 JSON 序列化（避免循环引用崩溃）
 * @param {*} obj - 待序列化的值
 * @returns {string} JSON 字符串；序列化失败时返回 String(obj) 或占位文本
 */
function _safeStringify(obj) {
    try {
        return JSON.stringify(obj, null, 2);
    } catch (e) {
        try {
            return String(obj);
        } catch (e2) {
            return '(无法序列化)';
        }
    }
}
