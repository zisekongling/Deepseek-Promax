/**
 * @file capability-projection.js
 * @module mcp/capability-projection
 *
 * MCP 工具能力投影模块
 *
 * 职责：
 *   - 把 MCP 工具描述符投影到 Agent prompt 文本
 *   - 预算控制：每服务工具数 > 阈值（默认 mcpPromptBudget）时，仅投影前 N 个工具，
 *     其余经 mcp_discover / mcp_describe / mcp_invoke 元工具按需检索
 *   - 输出格式与 capability-register.js 现有工具描述符一致：
 *       [MCP工具]...[/MCP工具] 包裹，每工具一个段落（标题/参数/调用示例）
 *   - 暴露 renderMcpPrompt(intent?) 返回字符串
 *
 * 投影策略（按服务 visible 字段）：
 *   - direct：投影前 budget 个工具（超出的转入按需检索）
 *   - adaptive：投影前 budget 个常用工具（按 intent 相关性排序），其余按需检索
 *   - on-demand：不投影具体工具，仅声明服务存在，全部经元工具检索
 *
 * 工具调用统一格式：
 *   <mcp_invoke>
 *   {"server":"服务名","tool":"工具名","args":{...}}
 *   </mcp_invoke>
 *
 * 参考实现：deepseek-pp/core/mcp/capability-projection.ts
 */

import { listServers } from './store.js';
import { getMcpConfig } from './client.js';

/** 每个工具描述符在 prompt 中的固定开销估算（字节），用于预算估算 */
const PROMPT_DESCRIPTOR_FIXED_OVERHEAD_BYTES = 1024;

/** 按需检索元工具集合（与服务可见性无关，只要有隐藏工具就投影） */
const ON_DEMAND_HANDLES = ['mcp_discover', 'mcp_describe', 'mcp_invoke'];

// ============================================================
// 工具描述符渲染
// ============================================================

/**
 * 估算单个工具描述符投影到 prompt 的字节大小
 * 用于预算控制
 * @param {Object} tool - 工具描述符
 * @returns {number} 估算字节数
 */
export function estimateToolPromptBytes(tool) {
    const descriptorText = [tool.name, tool.title, tool.description].join('\n');
    let schemaBytes = 0;
    try {
        schemaBytes = approxUtf8Bytes(JSON.stringify(tool.inputSchema || {}));
    } catch (e) {
        schemaBytes = 0;
    }
    return approxUtf8Bytes(descriptorText) + schemaBytes * 2 + PROMPT_DESCRIPTOR_FIXED_OVERHEAD_BYTES;
}

/**
 * 把 JSON Schema 渲染为参数说明文本
 * @param {Object} schema - 工具的 inputSchema
 * @returns {string} 参数说明（多行）
 */
function renderSchema(schema) {
    if (!schema || typeof schema !== 'object') return '（无参数）';
    const props = (schema.properties && typeof schema.properties === 'object') ? schema.properties : {};
    const required = Array.isArray(schema.required) ? schema.required : [];
    const propNames = Object.keys(props);
    if (propNames.length === 0) return '（无参数）';
    const lines = [];
    for (const name of propNames) {
        const prop = props[name] && typeof props[name] === 'object' ? props[name] : {};
        const type = typeof prop.type === 'string' ? prop.type : 'any';
        const reqFlag = required.indexOf(name) >= 0 ? '必填' : '可选';
        const desc = typeof prop.description === 'string' ? prop.description : '';
        const enumStr = Array.isArray(prop.enum) ? `，可选值: ${prop.enum.map(v => JSON.stringify(v)).join(' / ')}` : '';
        const def = prop.default !== undefined ? `，默认 ${JSON.stringify(prop.default)}` : '';
        lines.push(`- ${name}（${type}，${reqFlag}）：${desc}${enumStr}${def}`);
    }
    return lines.join('\n');
}

/**
 * 渲染单个工具描述符为 prompt 段落
 * @param {Object} server - 服务配置
 * @param {Object} tool - 工具描述符
 * @returns {string} prompt 段落
 */
function renderToolSection(server, tool) {
    const title = tool.title || tool.name;
    const desc = tool.description || `MCP tool ${tool.name}`;
    const params = renderSchema(tool.inputSchema);
    const exampleArgs = buildExampleArgs(tool.inputSchema);
    const example = `<mcp_invoke>\n{"server":"${escapeJsonString(server.name)}","tool":"${escapeJsonString(tool.name)}","args":${exampleArgs}}\n</mcp_invoke>`;
    return [
        `#### ${tool.name}（${title}）`,
        '',
        desc,
        '',
        '参数（JSON 字段，紧凑单行）：',
        params,
        '',
        '调用示例：',
        example,
        ''
    ].join('\n');
}

/**
 * 根据工具 inputSchema 构建示例参数对象
 * 取必填参数的占位值，便于 AI 理解调用格式
 * @param {Object} schema - 工具 inputSchema
 * @returns {string} 示例参数 JSON 字符串
 */
function buildExampleArgs(schema) {
    if (!schema || typeof schema !== 'object') return '{}';
    const props = (schema.properties && typeof schema.properties === 'object') ? schema.properties : {};
    const required = Array.isArray(schema.required) ? schema.required : [];
    const example = {};
    for (const name of required.slice(0, 3)) {
        const prop = props[name] && typeof props[name] === 'object' ? props[name] : {};
        example[name] = placeholderForType(prop.type, prop.enum);
    }
    try {
        return JSON.stringify(example);
    } catch (e) {
        return '{}';
    }
}

/**
 * 按 JSON Schema 类型生成占位值
 * @param {string} type - JSON Schema 类型
 * @param {Array} [enumValues] - 枚举值
 * @returns {*} 占位值
 */
function placeholderForType(type, enumValues) {
    if (Array.isArray(enumValues) && enumValues.length > 0) return enumValues[0];
    switch (type) {
        case 'string': return '';
        case 'number':
        case 'integer': return 0;
        case 'boolean': return false;
        case 'array': return [];
        case 'object': return {};
        default: return '';
    }
}

// ============================================================
// 按需检索元工具渲染
// ============================================================

/**
 * 渲染按需检索元工具（mcp_discover / mcp_describe / mcp_invoke）说明
 * @param {Array<string>} hiddenServerNames - 有隐藏工具的服务名列表
 * @returns {string} 元工具说明段落
 */
function renderOnDemandHandles(hiddenServerNames) {
    const serverList = hiddenServerNames.length > 0
        ? `（涉及服务：${hiddenServerNames.map(n => `"${n}"`).join('、')}）`
        : '';
    return [
        '## 按需检索工具（当已知工具不足时使用）',
        '',
        '#### mcp_discover（发现服务工具）',
        '',
        `列出指定 MCP 服务的可用工具。当某服务的工具未在上方列出（按需检索或超出预算）时使用${serverList}。`,
        '',
        '参数（JSON 字段，紧凑单行）：',
        '- server（string，必填）：服务名',
        '',
        '调用示例：',
        '<mcp_discover>',
        '{"server":"服务名"}',
        '</mcp_discover>',
        '',
        '#### mcp_describe（查看工具详情）',
        '',
        '查看指定 MCP 服务中某工具的完整描述（含参数 Schema）。',
        '',
        '参数（JSON 字段，紧凑单行）：',
        '- server（string，必填）：服务名',
        '- tool（string，必填）：工具名',
        '',
        '调用示例：',
        '<mcp_describe>',
        '{"server":"服务名","tool":"工具名"}',
        '</mcp_describe>',
        '',
        '#### mcp_invoke（调用工具）',
        '',
        '调用指定 MCP 服务的工具。所有 MCP 工具调用（包括上方已列出的工具）都使用此格式。',
        '',
        '参数（JSON 字段，紧凑单行）：',
        '- server（string，必填）：服务名',
        '- tool（string，必填）：工具名',
        '- args（object，可选）：工具参数（按工具 Schema 提供）',
        '',
        '调用示例：',
        '<mcp_invoke>',
        '{"server":"服务名","tool":"工具名","args":{"key":"value"}}',
        '</mcp_invoke>',
        ''
    ].join('\n');
}

// ============================================================
// 工具排序与选择
// ============================================================

/**
 * 按 intent 相关性对工具排序（评分高的在前）
 * 评分规则：工具名/标题/描述包含 intent 关键词加分
 * @param {Array<Object>} tools - 工具描述符数组
 * @param {string} intent - 用户意图文本
 * @returns {Array<Object>} 排序后的工具数组
 */
export function rankToolsByIntent(tools, intent) {
    const normalizedIntent = normalizeSearchText(intent);
    const terms = tokenize(normalizedIntent);
    return tools
        .map((tool, index) => ({
            tool,
            index,
            score: scoreTool(tool, normalizedIntent, terms)
        }))
        .sort((a, b) => b.score - a.score || a.index - b.index)
        .map(entry => entry.tool);
}

/**
 * 计算单个工具与 intent 的相关性评分
 * @param {Object} tool - 工具描述符
 * @param {string} normalizedIntent - 归一化后的 intent
 * @param {Array<string>} terms - intent 分词
 * @returns {number} 评分
 */
function scoreTool(tool, normalizedIntent, terms) {
    const name = normalizeSearchText(`${tool.name} ${tool.title || ''}`);
    const desc = normalizeSearchText(tool.description || '');
    let score = 0;
    if (normalizedIntent) {
        if (name.includes(normalizedIntent)) score += 1000;
        if (desc.includes(normalizedIntent)) score += 250;
    }
    for (const term of terms) {
        if (name.includes(term)) score += 120;
        if (desc.includes(term)) score += 25;
    }
    return score;
}

/**
 * 按预算选择工具（不超过 maxTools 个）
 * @param {Array<Object>} tools - 候选工具
 * @param {number} maxTools - 最大数量
 * @returns {{ selected: Array<Object>, hidden: Array<Object> }}
 */
function selectByBudget(tools, maxTools) {
    const limit = Math.max(0, Math.floor(maxTools));
    if (tools.length <= limit) {
        return { selected: tools.slice(), hidden: [] };
    }
    return {
        selected: tools.slice(0, limit),
        hidden: tools.slice(limit)
    };
}

// ============================================================
// 主渲染入口
// ============================================================

/**
 * 渲染 MCP 工具能力提示词
 *
 * 流程：
 *   1. 读取所有已启用服务的缓存工具
 *   2. 按服务 visible 策略与预算选择投影工具
 *   3. 渲染已选工具段落
 *   4. 若存在隐藏工具（on-demand 或超出预算），追加 mcp_discover/mcp_describe/mcp_invoke 元工具说明
 *   5. 用 [MCP工具]...[/MCP工具] 包裹返回
 *
 * @param {string} [intent] - 当前对话意图（用于 adaptive 排序）
 * @returns {string} prompt 文本；无可用工具时返回空字符串
 */
export function renderMcpPrompt(intent) {
    const cfg = getMcpConfig();
    const budget = cfg.mcpPromptBudget > 0 ? cfg.mcpPromptBudget : 10;
    const servers = listServers().filter(s => s.enabled && Array.isArray(s.tools) && s.tools.length > 0);

    if (servers.length === 0) return '';

    const sections = [];
    /** @type {Array<string>} 有隐藏工具的服务名（用于元工具说明） */
    const hiddenServerNames = [];
    let hasDirectTools = false;

    for (const server of servers) {
        const allTools = server.tools;
        let visible = server.visible || 'direct';
        if (visible !== 'direct' && visible !== 'adaptive' && visible !== 'on-demand') {
            visible = 'direct';
        }

        // on-demand：完全不投影具体工具
        if (visible === 'on-demand') {
            hiddenServerNames.push(server.name);
            continue;
        }

        // adaptive：按 intent 排序后再按预算选择
        let candidates = allTools;
        if (visible === 'adaptive' && intent) {
            candidates = rankToolsByIntent(allTools, intent);
        }

        const { selected, hidden } = selectByBudget(candidates, budget);
        if (selected.length > 0) {
            hasDirectTools = true;
            sections.push(`### 服务：${server.name}（${server.transport}）`);
            sections.push('');
            for (const tool of selected) {
                sections.push(renderToolSection(server, tool));
            }
        }
        if (hidden.length > 0) {
            hiddenServerNames.push(server.name);
        }
    }

    // 拼接头部
    const parts = [];
    parts.push('[MCP工具]');
    parts.push('你已通过 MCP 协议接入以下外部工具服务。调用方式与记忆工具一致：输出 XML 标签，标签体内为紧凑单行 JSON。');
    parts.push('');
    parts.push('### 工具调用格式（严格遵守）');
    parts.push('');
    parts.push('所有 MCP 工具调用统一使用 `<mcp_invoke>` 标签，JSON 必须包含 server（服务名）、tool（工具名）、args（参数对象）三个字段。');
    parts.push('');
    parts.push('示例：');
    parts.push('<mcp_invoke>');
    parts.push('{"server":"服务名","tool":"工具名","args":{"key":"value"}}');
    parts.push('</mcp_invoke>');
    parts.push('');

    if (hasDirectTools) {
        parts.push('## 已知工具（可直接调用）');
        parts.push('');
        parts.push(sections.join('\n'));
    }

    // 按需检索元工具（仅当有隐藏工具时）
    if (hiddenServerNames.length > 0) {
        if (hasDirectTools) parts.push('');
        parts.push(renderOnDemandHandles(hiddenServerNames));
    }

    parts.push('[/MCP工具]');
    return parts.join('\n');
}

/**
 * 获取所有已启用 MCP 服务的工具总数（用于决定是否需要投影）
 * @returns {number}
 */
export function getTotalToolCount() {
    const servers = listServers().filter(s => s.enabled && Array.isArray(s.tools));
    let count = 0;
    for (const s of servers) {
        count += s.tools.length;
    }
    return count;
}

/**
 * 判断是否需要投影 MCP 工具（有已启用服务且有缓存工具）
 * @returns {boolean}
 */
export function hasMcpToolsToProject() {
    return getTotalToolCount() > 0;
}

// ============================================================
// 文本工具函数
// ============================================================

/**
 * 归一化搜索文本（NFKC + 小写 + trim）
 * @param {string} value
 * @returns {string}
 */
function normalizeSearchText(value) {
    if (!value || typeof value !== 'string') return '';
    try {
        return value.normalize('NFKC').toLowerCase().trim();
    } catch (e) {
        return value.toLowerCase().trim();
    }
}

/**
 * 分词（按字母数字下划线连字符）
 * @param {string} value
 * @returns {Array<string>} 去重后的 token 列表（长度 >= 2）
 */
function tokenize(value) {
    if (!value) return [];
    const matches = value.match(/[\p{L}\p{N}_-]+/gu) || [];
    const set = new Set();
    for (const m of matches) {
        if (m.length >= 2) set.add(m);
    }
    return Array.from(set);
}

/**
 * 转义 JSON 字符串中的特殊字符（用于内联 JSON 示例）
 * @param {string} s
 * @returns {string}
 */
function escapeJsonString(s) {
    if (typeof s !== 'string') return '';
    return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * 估算字符串的 UTF-8 字节长度
 * @param {string} str
 * @returns {number}
 */
function approxUtf8Bytes(str) {
    if (!str) return 0;
    let bytes = 0;
    for (let i = 0; i < str.length; i++) {
        const code = str.charCodeAt(i);
        if (code < 0x80) bytes += 1;
        else if (code < 0x800) bytes += 2;
        else if (code >= 0xD800 && code <= 0xDBFF) { bytes += 4; i++; }
        else bytes += 3;
    }
    return bytes;
}
