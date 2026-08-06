/**
 * 感知工具集（Perception 类）
 *
 * 职责：
 *   - 信息获取：web_search（联网搜索）/ web_fetch（网页抓取）
 *   - MCP 工具发现：mcp_discover / mcp_describe / mcp_invoke（渐进式披露）
 *   - MCP 投影工具：mcp__{server}__{tool}（动态注册的命名空间工具）
 *
 * 设计原则（参考《AI Agent 实战》指南）：
 *   - 感知工具只读，天然支持并行调用（无副作用）
 *   - MCP 协议标准化工具互操作，支持渐进式发现
 *   - 工具描述必须包含边界条件：做不到什么、不接受什么输入
 *   - 参数描述用具体例子代替抽象规范
 *   - 按 CONFIG 开关控制工具可见性（描述符始终注册以支持 XML 识别）
 *   - 感知工具结果可缓存（相同查询直接复用）
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
// 工具描述符
// ============================================================

/** @type {import('../core/tool-registry.js').ToolDescriptor[]} */
export const PERCEPTION_TOOL_DESCRIPTORS = [
    {
        name: 'web_search',
        description: '联网搜索引擎查询（Bing），返回结构化结果（标题/URL/摘要）。当需要获取实时信息、最新资讯、或查找未知事实时使用。用自然语言完整问句作为查询。',
        category: 'perception',
        riskLevel: 'low',
        isReadOnly: true,
        inputSchema: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: '搜索查询（完整问句）。请用自然语言描述你想查找的信息，例如"2026年8月最新热点新闻有哪些"。不要只填关键词堆砌。'
                },
                topK: {
                    type: 'integer',
                    description: '期望返回的结果条数（1-30，默认 10）。超过 10 时会自动翻页合并多页结果。仅在需要更多搜索结果时设置。',
                    minimum: 1,
                    maximum: 30,
                    default: 10
                }
            },
            required: ['query']
        },
        boundaryNote: '结果最多 30 条。如需深入阅读某条结果，用 web_fetch 抓取完整内容。'
    },
    {
        name: 'web_fetch',
        description: '抓取目标 URL 的可见正文文本。当需要阅读网页具体内容时使用。',
        category: 'perception',
        riskLevel: 'low',
        isReadOnly: true,
        inputSchema: {
            type: 'object',
            properties: {
                url: {
                    type: 'string',
                    description: '目标 URL（http/https），例如 https://example.com/article'
                },
                maxLength: {
                    type: 'integer',
                    description: '文本截断长度（默认 8000）',
                    default: 8000
                }
            },
            required: ['url']
        },
        boundaryNote: '只能抓取公开网页。部分站点可能拒绝抓取。默认允许所有站点，可在设置页配置白名单限制。'
    },
    {
        name: 'mcp_discover',
        description: '列出指定 MCP 服务的可用工具列表。用于渐进式发现：先浏览工具有哪些，再按需查看详情。',
        category: 'perception',
        riskLevel: 'low',
        isReadOnly: true,
        inputSchema: {
            type: 'object',
            properties: {
                server: { type: 'string', description: 'MCP 服务名，例如 "filesystem"' }
            },
            required: ['server']
        },
        boundaryNote: '仅列出已启用服务的工具。发现后工具会自动注册为 mcp__{server}__{tool} 格式。'
    },
    {
        name: 'mcp_describe',
        description: '查看指定 MCP 服务中某个工具的完整描述（含参数 Schema）。用于渐进式披露：按需加载工具详情。',
        category: 'perception',
        riskLevel: 'low',
        isReadOnly: true,
        inputSchema: {
            type: 'object',
            properties: {
                server: { type: 'string', description: 'MCP 服务名' },
                tool: { type: 'string', description: '工具名' }
            },
            required: ['server', 'tool']
        },
        boundaryNote: '与 mcp_discover 配合使用：先 discover 列出工具，再 describe 查看具体参数。'
    },
    {
        name: 'mcp_invoke',
        description: '调用指定 MCP 服务的工具。参数按工具 Schema 提供。',
        category: 'perception',
        riskLevel: 'medium',
        isReadOnly: true,
        inputSchema: {
            type: 'object',
            properties: {
                server: { type: 'string', description: 'MCP 服务名' },
                tool: { type: 'string', description: '工具名' },
                args: { type: 'object', description: '工具参数（按工具 Schema 提供）' }
            },
            required: ['server', 'tool']
        },
        boundaryNote: 'MCP 调用有超时限制（默认 60 秒）。结果大小上限 100KB。需要先 mcp_discover 确认服务可用。'
    }
];

// ============================================================
// 执行器工厂
// ============================================================

/**
 * 创建感知工具执行器映射
 * @returns {Object<string, Function>}
 */
export function createPerceptionToolExecutors() {
    return {
        web_search: _executeWebSearch,
        web_fetch: _executeWebFetch,
        mcp_discover: _executeMcpDiscover,
        mcp_describe: _executeMcpDescribe,
        mcp_invoke: _executeMcpInvoke
    };
}

// ============================================================
// 执行器实现 — Web 工具
// ============================================================

/**
 * 执行 web_search — 联网搜索
 * @param {Object} payload - { query: string, topK?: number }
 * @returns {Promise<import('../core/tool-registry.js').ToolResult>}
 */
async function _executeWebSearch(payload) {
    const config = _getConfig();
    if (config && config.webToolsEnabled === false) {
        return { ok: false, summary: 'web_search 未启用', detail: '请在设置面板开启 Web 工具（webToolsEnabled）开关' };
    }
    const query = typeof payload.query === 'string' ? payload.query.trim() : '';
    if (!query) {
        return { ok: false, summary: '参数错误', detail: 'query 不能为空' };
    }
    const fn = typeof window !== 'undefined' ? window._dsExecuteWebSearch : null;
    if (typeof fn !== 'function') {
        return { ok: false, summary: 'web_search 未启用', detail: 'window._dsExecuteWebSearch 不存在' };
    }
    try {
        const topK = (typeof payload.topK === 'number' && Number.isFinite(payload.topK))
            ? Math.min(Math.max(1, Math.floor(payload.topK)), 30)
            : 10;
        const result = await fn(query, { topK });
        if (result.ok && Array.isArray(result.results)) {
            const list = result.results.map((r, i) =>
                `${i + 1}. ${r.title}\n   URL: ${r.url}\n   摘要: ${r.snippet || ''}`
            ).join('\n');
            return {
                ok: true,
                summary: `找到 ${result.results.length} 条结果`,
                detail: list || '无搜索结果'
            };
        }
        return { ok: false, summary: '搜索失败', detail: result.error || '未知错误' };
    } catch (e) {
        return { ok: false, summary: '搜索失败', detail: (e && e.message) || String(e) };
    }
}

/**
 * 执行 web_fetch — 网页抓取
 * @param {Object} payload - { url: string, maxLength?: number }
 * @returns {Promise<import('../core/tool-registry.js').ToolResult>}
 */
async function _executeWebFetch(payload) {
    const config = _getConfig();
    if (config && config.webToolsEnabled === false) {
        return { ok: false, summary: 'web_fetch 未启用', detail: '请在设置面板开启 Web 工具（webToolsEnabled）开关' };
    }
    const url = typeof payload.url === 'string' ? payload.url.trim() : '';
    if (!url) {
        return { ok: false, summary: '参数错误', detail: 'url 不能为空' };
    }
    const fn = typeof window !== 'undefined' ? window._dsExecuteWebFetch : null;
    if (typeof fn !== 'function') {
        return { ok: false, summary: 'web_fetch 未启用', detail: 'window._dsExecuteWebFetch 不存在' };
    }
    try {
        const result = await fn(url, { maxLength: payload.maxLength });
        if (result.ok) {
            return {
                ok: true,
                summary: result.title ? `已抓取：${result.title}` : '已抓取',
                detail: result.content || ''
            };
        }
        return { ok: false, summary: '抓取失败', detail: result.error || '未知错误' };
    } catch (e) {
        return { ok: false, summary: '抓取失败', detail: (e && e.message) || String(e) };
    }
}

// ============================================================
// 执行器实现 — MCP 工具
// ============================================================

/**
 * 执行 mcp_discover — 列出 MCP 服务工具
 *
 * 发现后自动把工具注册到 registry（渐进式发现：Step 3 投影集成），
 * 使后续可直接按 mcp__{server}__{tool} 名调用。
 *
 * @param {Object} payload - { server: string }
 * @param {Object} [registry] - 工具注册中心（用于动态注册投影工具）
 * @returns {Promise<import('../core/tool-registry.js').ToolResult>}
 */
async function _executeMcpDiscover(payload, registry) {
    const config = _getConfig();
    if (config && config.mcpEnabled === false) {
        return { ok: false, summary: 'mcp_discover 未启用', detail: '请在设置面板开启 MCP（mcpEnabled）开关' };
    }
    const serverName = typeof payload.server === 'string' ? payload.server.trim() : '';
    if (!serverName) {
        return { ok: false, summary: '参数错误', detail: 'server 不能为空' };
    }
    const mcp = typeof window !== 'undefined' ? window._dsMcp : null;
    if (!mcp) {
        return { ok: false, summary: 'MCP 未初始化', detail: 'window._dsMcp 不存在' };
    }
    const servers = mcp.listServers();
    const server = servers.find(s => s.name === serverName && s.enabled);
    if (!server) {
        return { ok: false, summary: '服务未找到', detail: `未找到名为 "${serverName}" 的已启用 MCP 服务` };
    }
    try {
        const result = await mcp.discoverServer(server.id);
        const tools = result.tools || [];
        // 把发现的工具动态注册到 registry（渐进式披露）
        if (registry && typeof registry.register === 'function') {
            _registerMcpServerTools(server, tools, registry);
        }
        const toolList = tools.map(t =>
            `- ${t.name}: ${t.description || t.title || ''}`
        ).join('\n');
        return {
            ok: true,
            summary: `发现 ${tools.length} 个工具`,
            detail: `服务 "${serverName}" 共 ${tools.length} 个工具：\n${toolList}`
        };
    } catch (e) {
        return { ok: false, summary: '发现失败', detail: (e && e.message) || String(e) };
    }
}

/**
 * 执行 mcp_describe — 查看 MCP 工具详情
 * @param {Object} payload - { server: string, tool: string }
 * @returns {Promise<import('../core/tool-registry.js').ToolResult>}
 */
async function _executeMcpDescribe(payload) {
    const config = _getConfig();
    if (config && config.mcpEnabled === false) {
        return { ok: false, summary: 'mcp_describe 未启用', detail: '请在设置面板开启 MCP（mcpEnabled）开关' };
    }
    const serverName = typeof payload.server === 'string' ? payload.server.trim() : '';
    const toolName = typeof payload.tool === 'string' ? payload.tool.trim() : '';
    if (!serverName || !toolName) {
        return { ok: false, summary: '参数错误', detail: 'server 和 tool 不能为空' };
    }
    const mcp = typeof window !== 'undefined' ? window._dsMcp : null;
    if (!mcp) return { ok: false, summary: 'MCP 未初始化' };
    const servers = mcp.listServers();
    const server = servers.find(s => s.name === serverName && s.enabled);
    if (!server) {
        return { ok: false, summary: '服务未找到', detail: `未找到名为 "${serverName}" 的已启用服务` };
    }
    const tools = Array.isArray(server.tools) ? server.tools : [];
    const tool = tools.find(t => t.name === toolName);
    if (!tool) {
        return { ok: false, summary: '工具未找到', detail: `服务 "${serverName}" 中未找到工具 "${toolName}"` };
    }
    const schemaStr = tool.inputSchema ? JSON.stringify(tool.inputSchema, null, 2) : '（无）';
    return {
        ok: true,
        summary: `工具详情：${toolName}`,
        detail: `名称：${tool.name}\n标题：${tool.title || ''}\n描述：${tool.description || ''}\n参数 Schema：\n${schemaStr}`
    };
}

/**
 * 执行 mcp_invoke — 调用 MCP 工具
 * @param {Object} payload - { server: string, tool: string, args?: object }
 * @returns {Promise<import('../core/tool-registry.js').ToolResult>}
 */
async function _executeMcpInvoke(payload) {
    const config = _getConfig();
    if (config && config.mcpEnabled === false) {
        return { ok: false, summary: 'mcp_invoke 未启用', detail: '请在设置面板开启 MCP（mcpEnabled）开关' };
    }
    const serverName = typeof payload.server === 'string' ? payload.server.trim() : '';
    const toolName = typeof payload.tool === 'string' ? payload.tool.trim() : '';
    const args = payload.args || {};
    if (!serverName || !toolName) {
        return { ok: false, summary: '参数错误', detail: 'server 和 tool 不能为空' };
    }
    const mcp = typeof window !== 'undefined' ? window._dsMcp : null;
    if (!mcp) return { ok: false, summary: 'MCP 未初始化' };
    const servers = mcp.listServers();
    const server = servers.find(s => s.name === serverName && s.enabled);
    if (!server) {
        return { ok: false, summary: '服务未找到', detail: `未找到名为 "${serverName}" 的已启用服务` };
    }
    try {
        return await mcp.callTool(server.id, toolName, args);
    } catch (e) {
        return { ok: false, summary: '调用失败', detail: (e && e.message) || String(e) };
    }
}

// ============================================================
// MCP 工具投影注册（渐进式发现）
// ============================================================

/**
 * 把单个 MCP 服务的工具注册到 registry
 *
 * 工具名采用命名空间格式 mcp__{serverName}__{toolName}，避免与内置工具冲突。
 * executor 闭包捕获 serverId + toolName，调 mcp.callTool。
 *
 * @param {Object} server - MCP 服务配置（含 id/name）
 * @param {Array} tools - discoverServer 返回的工具列表
 * @param {Object} registry - 工具注册中心
 */
function _registerMcpServerTools(server, tools, registry) {
    if (!server || !Array.isArray(tools)) return;
    const mcp = typeof window !== 'undefined' ? window._dsMcp : null;
    if (!mcp) return;
    const serverName = server.name;
    const serverId = server.id;
    for (const tool of tools) {
        if (!tool || !tool.name) continue;
        const namespacedName = `mcp__${serverName}__${tool.name}`;
        const descriptor = {
            name: namespacedName,
            description: `[MCP:${serverName}] ${tool.description || tool.title || tool.name}`,
            category: 'perception',
            inputSchema: tool.inputSchema || { type: 'object', properties: {} }
        };
        const toolName = tool.name;
        const executor = function(args) {
            const config = _getConfig();
            if (config && config.mcpEnabled === false) {
                return { ok: false, summary: 'MCP 未启用', detail: '请在设置面板开启 MCP（mcpEnabled）开关' };
            }
            return mcp.callTool(serverId, toolName, args || {});
        };
        registry.register(descriptor, executor, {
            requireAgentFeedback: true,
            category: 'perception'
        });
    }
}

/**
 * 注册所有已启用 MCP 服务的缓存工具到 registry
 *
 * 在模块初始化时调用（mcpEnabled=true 时）。
 * 仅注册已缓存的工具（store 中的 server.tools），未发现的服务需 AI 调 mcp_discover 触发。
 *
 * @param {Object} registry - 工具注册中心
 */
export function registerCachedMcpTools(registry) {
    if (!registry) return;
    const mcp = typeof window !== 'undefined' ? window._dsMcp : null;
    if (!mcp) return;
    try {
        const servers = mcp.listServers();
        for (const server of servers) {
            if (!server.enabled) continue;
            const tools = Array.isArray(server.tools) ? server.tools : [];
            if (tools.length > 0) {
                _registerMcpServerTools(server, tools, registry);
            }
        }
    } catch (e) {
        console.warn('[PerceptionTools] registerCachedMcpTools failed:', e);
    }
}