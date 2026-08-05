/**
 * @file sse.js
 * @module mcp/transports/sse
 *
 * MCP SSE 传输层（旧版 HTTP+SSE 协议，2024-11-05 之前主流）
 *
 * 协议流程：
 *   1. GET {url} 建立 SSE 长连接，Accept: text/event-stream
 *   2. 服务端推送 `endpoint` 事件，data 为工具调用的 POST 回传端点（相对/绝对 URL）
 *   3. 客户端将 JSON-RPC 请求 POST 到回传端点
 *   4. 服务端通过 SSE 流推送 `message` 事件，data 为 JSON-RPC 响应
 *   5. 按 request.id 匹配响应
 *
 * 油猴环境：GM_xmlhttpRequest onprogress 流式解析 SSE 事件
 * WebView 环境：Platform.http() 不支持流式，退化为 GET 获取完整 body 后一次性解析
 *   （endpoint 事件通常在流开头，message 事件在流后部，整流获取后可解析）
 *
 * 参考实现：deepseek-pp/core/mcp/transports/sse.ts（createMcpSseTransport）
 */

import {
    CLIENT_NAME,
    MCP_PROTOCOL_VERSION,
    MCP_SUPPORTED_PROTOCOL_VERSIONS,
    McpBaseTransport,
    McpTransportError,
    getClientVersion,
    createMcpRequest,
    httpRequest,
    httpStreamRequest,
    drainSseEvents,
    parseJsonRpcSseMessage,
    normalizeToolDescriptor,
    normalizeToolResult
} from './common.js';

/** 默认连接超时（建立 SSE + 等待 endpoint 事件） */
const DEFAULT_CONNECT_TIMEOUT_MS = 10000;
/** 默认发现超时 */
const DEFAULT_DISCOVERY_TIMEOUT_MS = 20000;
/** 默认请求超时（含 SSE 响应等待） */
const DEFAULT_REQUEST_TIMEOUT_MS = 60000;
/** 单服务工具数上限 */
const DEFAULT_MAX_TOOL_COUNT = 128;

/**
 * MCP SSE 传输层
 *
 * 设计：每次 RPC 请求都重新建立 SSE 连接（GET），等待 endpoint 事件，
 * 再 POST 请求到回传端点，最后从 SSE 流读取响应。
 * 这与 deepseek-pp 参考实现一致，简化了连接复用状态机。
 */
export class SseTransport extends McpBaseTransport {
    constructor() {
        super();
        /** @type {string|null} 协商后的协议版本 */
        this._protocolVersion = null;
        /** @type {Object|null} 服务端信息 */
        this._serverInfo = null;
        /** @type {string|null} 服务端说明 */
        this._instructions = null;
    }

    /**
     * 将 JSON-RPC 请求经 SSE 传输发送并等待响应
     *
     * 流程：
     *   1. GET 建立 SSE 流，onprogress 持续解析事件
     *   2. 收到 endpoint 事件 → 记录回传 URL，POST 请求
     *   3. 收到 message 事件 → 解析为 JSON-RPC 响应，匹配 request.id 后 resolve
     *   4. 流结束仍未收到响应 → reject
     *
     * @param {Object} server - 服务配置
     * @param {Object} request - createMcpRequest 构建的请求对象
     * @param {Object} [options] - { timeoutMs?, maxBytes? }
     * @returns {Promise<Object>} 已规范化的 JSON-RPC 响应
     * @private
     */
    _sendViaSse(server, request, options) {
        const timeoutMs = (options && options.timeoutMs) || DEFAULT_REQUEST_TIMEOUT_MS;
        const maxBytes = options && options.maxBytes;
        const headers = this._buildRequestHeaders(server);
        headers['accept'] = 'text/event-stream';
        delete headers['content-type'];

        return new Promise((resolve, reject) => {
            let resolved = false;
            let postUrl = null;
            let posted = false;
            let buffer = '';

            /**
             * 内部：安全终结 Promise
             * @param {Function} fn - resolve 或 reject
             * @param {*} value - 终结值
             */
            const finalize = (fn, value) => {
                if (resolved) return;
                resolved = true;
                try { fn(value); } catch (e) { reject(e); }
            };

            /**
             * 内部：处理累积的 SSE 文本，抽干事件
             * @param {string} fullText - 当前累积的完整文本
             */
            const handleEvents = (fullText) => {
                if (resolved) return;
                buffer = fullText;
                const drained = drainSseEvents(buffer);
                buffer = drained.remainder;
                for (const evt of drained.events) {
                    if (resolved) return;
                    if (evt.event === 'endpoint' && !postUrl) {
                        postUrl = resolveUrl(evt.data, server.url);
                        if (postUrl && !posted) {
                            posted = true;
                            this._postRequest(server, postUrl, request, timeoutMs, maxBytes)
                                .catch(err => finalize(reject, err));
                        }
                    } else if (evt.event === 'message') {
                        let parsed;
                        try {
                            parsed = parseJsonRpcSseMessage(evt.data, request);
                        } catch (e) {
                            finalize(reject, e);
                            return;
                        }
                        if (parsed) {
                            finalize(resolve, parsed);
                        }
                    }
                }
            };

            // 启动 SSE 流
            httpStreamRequest({
                method: 'GET',
                url: server.url,
                headers,
                timeoutMs,
                maxBytes
            }, (chunk, full) => handleEvents(full))
                .then(() => {
                    // 流结束前最后抽干一次剩余缓冲
                    if (!resolved && buffer) {
                        const drained = drainSseEvents(buffer);
                        for (const evt of drained.events) {
                            if (resolved) return;
                            if (evt.event === 'message') {
                                let parsed;
                                try {
                                    parsed = parseJsonRpcSseMessage(evt.data, request);
                                } catch (e) {
                                    finalize(reject, e);
                                    return;
                                }
                                if (parsed) {
                                    finalize(resolve, parsed);
                                    return;
                                }
                            }
                        }
                    }
                    // 仍未 resolve：响应缺失
                    finalize(reject, new McpTransportError(
                        'mcp_sse_response_missing',
                        'MCP SSE stream ended without a matching response.',
                        { retryable: false }
                    ));
                })
                .catch(err => finalize(reject, err));
        });
    }

    /**
     * POST JSON-RPC 请求到 SSE 回传端点
     * @param {Object} server - 服务配置
     * @param {string} postUrl - 回传端点 URL
     * @param {Object} request - 请求对象
     * @param {number} timeoutMs - 超时
     * @param {number} [maxBytes] - 响应字节上限
     * @returns {Promise<void>}
     * @private
     */
    async _postRequest(server, postUrl, request, timeoutMs, maxBytes) {
        const headers = this._buildRequestHeaders(server);
        delete headers['accept'];
        await httpRequest({
            method: 'POST',
            url: postUrl,
            headers,
            body: JSON.stringify(request),
            timeoutMs,
            maxBytes
        });
    }

    /**
     * 执行 initialize 握手
     * @param {Object} server - 服务配置
     * @param {Object} [options] - { timeoutMs?, maxBytes? }
     * @returns {Promise<{ protocolVersion: string, serverInfo?: Object, instructions?: string }>}
     * @private
     */
    async _initialize(server, options) {
        const timeoutMs = (options && options.timeoutMs) || DEFAULT_CONNECT_TIMEOUT_MS;
        const request = createMcpRequest('initialize', {
            protocolVersion: MCP_PROTOCOL_VERSION,
            capabilities: { tools: {} },
            clientInfo: { name: CLIENT_NAME, version: getClientVersion() }
        });
        const response = await this._sendViaSse(server, request, { timeoutMs, maxBytes: options && options.maxBytes });
        const result = this._unwrapResult(response, 'mcp_initialize_failed');
        const rawResult = result && typeof result === 'object' ? result : {};
        const hasVersion = Object.prototype.hasOwnProperty.call(rawResult, 'protocolVersion');
        const advertised = hasVersion ? rawResult.protocolVersion : MCP_PROTOCOL_VERSION;
        if (typeof advertised !== 'string' || MCP_SUPPORTED_PROTOCOL_VERSIONS.indexOf(advertised) < 0) {
            throw new McpTransportError(
                'mcp_protocol_version_unsupported',
                'Unsupported MCP protocol version.',
                { retryable: false }
            );
        }
        this._protocolVersion = advertised;
        this._serverInfo = rawResult.serverInfo && typeof rawResult.serverInfo === 'object' ? rawResult.serverInfo : null;
        this._instructions = typeof rawResult.instructions === 'string' ? rawResult.instructions : null;
        // notifications/initialized 通知：SSE 传输下也需 POST 到回传端点，但通知无响应；
        // 参考实现中通知也经 SSE POST 发送且不读响应，此处省略以避免复杂化
        return {
            protocolVersion: advertised,
            serverInfo: this._serverInfo || undefined,
            instructions: this._instructions || undefined
        };
    }

    /**
     * 分页拉取工具列表
     * @param {Object} server - 服务配置
     * @param {Object} [options] - { timeoutMs?, maxBytes? }
     * @returns {Promise<Array>}
     * @private
     */
    async _listTools(server, options) {
        const timeoutMs = (options && options.timeoutMs) || DEFAULT_DISCOVERY_TIMEOUT_MS;
        const maxBytes = options && options.maxBytes;
        const maxToolCount = (server.limits && server.limits.maxToolCount) || DEFAULT_MAX_TOOL_COUNT;
        const tools = [];
        let cursor;
        do {
            const request = createMcpRequest('tools/list', cursor ? { cursor } : undefined);
            const response = await this._sendViaSse(server, request, { timeoutMs, maxBytes });
            const result = this._unwrapResult(response, 'mcp_tools_list_failed');
            const listResult = result && typeof result === 'object' ? result : {};
            const nextTools = Array.isArray(listResult.tools) ? listResult.tools : [];
            const remaining = maxToolCount - tools.length;
            for (const tool of nextTools.slice(0, Math.max(0, remaining))) {
                tools.push(normalizeToolDescriptor(server, tool));
            }
            cursor = typeof listResult.nextCursor === 'string' && listResult.nextCursor ? listResult.nextCursor : null;
        } while (cursor && tools.length < maxToolCount);
        return tools;
    }

    /**
     * 发现服务工具：initialize → tools/list
     * @param {Object} server - 服务配置
     * @param {Object} [options] - { timeoutMs?, maxBytes? }
     * @returns {Promise<{ tools: Array, protocolVersion: string, serverInfo?: Object, instructions?: string }>}
     */
    async discover(server, options) {
        const initResult = await this._initialize(server, options);
        const tools = await this._listTools(server, options);
        return {
            tools,
            protocolVersion: initResult.protocolVersion,
            serverInfo: initResult.serverInfo,
            instructions: initResult.instructions
        };
    }

    /**
     * 调用工具
     * @param {Object} server - 服务配置
     * @param {string} name - 工具名
     * @param {Object} args - 工具参数
     * @param {Object} [options] - { timeoutMs?, maxBytes? }
     * @returns {Promise<{ ok: boolean, summary: string, detail?: string, output?: *, isError?: boolean, truncated?: boolean }>}
     */
    async callTool(server, name, args, options) {
        const startedAt = Date.now();
        const timeoutMs = (options && options.timeoutMs) || DEFAULT_REQUEST_TIMEOUT_MS;
        const maxBytes = options && options.maxBytes;
        try {
            if (!this._protocolVersion) {
                await this._initialize(server, { timeoutMs: DEFAULT_CONNECT_TIMEOUT_MS, maxBytes });
            }
            const request = createMcpRequest('tools/call', { name, arguments: args || {} });
            const response = await this._sendViaSse(server, request, { timeoutMs, maxBytes });
            const result = this._unwrapResult(response, 'mcp_tool_call_failed');
            return normalizeToolResult(result, startedAt, maxBytes);
        } catch (err) {
            return {
                ok: false,
                summary: 'MCP 工具调用失败',
                detail: (err && err.message) || String(err),
                isError: true,
                truncated: false,
                startedAt,
                completedAt: Date.now(),
                error: {
                    code: (err && err.code) || 'mcp_tool_call_failed',
                    message: (err && err.message) || String(err),
                    retryable: err && err.retryable !== undefined ? err.retryable : true
                }
            };
        }
    }

    /**
     * 清理传输层资源
     * SSE 传输每次请求独立建连，无需显式关闭长连接
     */
    async cleanup() {
        this._protocolVersion = null;
        this._serverInfo = null;
        this._instructions = null;
    }
}

/**
 * 将相对 URL 解析为绝对 URL（基于服务端 base URL）
 * @param {string} maybeUrl - 待解析的 URL（可能相对/绝对）
 * @param {string} baseUrl - 服务端 base URL
 * @returns {string|null} 绝对 URL；解析失败返回 null
 */
function resolveUrl(maybeUrl, baseUrl) {
    if (!maybeUrl) return null;
    try {
        if (typeof URL === 'undefined') {
            // 老环境降级：若已是绝对 URL 直接返回
            if (/^https?:\/\//i.test(maybeUrl)) return maybeUrl;
            const base = baseUrl.replace(/\/[^/]*$/, '/');
            return base + maybeUrl.replace(/^\//, '');
        }
        return new URL(maybeUrl, baseUrl).toString();
    } catch (e) {
        return null;
    }
}

/**
 * 工厂函数：创建 SSE 传输实例
 * @returns {SseTransport}
 */
export function createSseTransport() {
    return new SseTransport();
}
