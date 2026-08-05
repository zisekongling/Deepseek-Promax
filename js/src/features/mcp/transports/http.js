/**
 * @file http.js
 * @module mcp/transports/http
 *
 * MCP HTTP 传输层（直接 HTTP，无 session）
 *
 * 协议流程：
 *   1. initialize → 协商协议版本，声明客户端能力
 *   2. notifications/initialized → 通知服务端初始化完成（POST 一次，忽略响应）
 *   3. tools/list → 分页发现工具（处理 nextCursor）
 *   4. tools/call → 调用工具，归一化结果
 *
 * 跨域：经 GM_xmlhttpRequest（油猴）或 Platform.http()（WebView）发起，绕过浏览器 CORS
 * 鉴权：支持 Bearer token（server.token）与自定义 header（server.headers 数组）
 *
 * 参考实现：deepseek-pp/core/mcp/transports/http.ts（createMcpHttpTransport）
 */

import {
    CLIENT_NAME,
    MCP_PROTOCOL_VERSION,
    MCP_SUPPORTED_PROTOCOL_VERSIONS,
    McpBaseTransport,
    McpTransportError,
    getClientVersion,
    createMcpRequest,
    createMcpNotification,
    httpRequest,
    normalizeJsonRpcResponse,
    normalizeToolDescriptor,
    normalizeToolResult
} from './common.js';

/** 默认连接超时（毫秒） */
const DEFAULT_CONNECT_TIMEOUT_MS = 10000;
/** 默认发现超时（毫秒） */
const DEFAULT_DISCOVERY_TIMEOUT_MS = 20000;
/** 默认请求超时（毫秒） */
const DEFAULT_REQUEST_TIMEOUT_MS = 60000;
/** 单服务工具数上限 */
const DEFAULT_MAX_TOOL_COUNT = 128;

/**
 * MCP HTTP 传输层
 *
 * 每次 RPC 请求独立 POST，无 session 状态；
 * initialize 协商的协议版本在实例上缓存，后续请求带 MCP-Protocol-Version 头
 */
export class HttpTransport extends McpBaseTransport {
    /**
     * 构造 HTTP 传输
     */
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
     * 发送单条 JSON-RPC 请求并解析响应
     * @param {Object} server - 服务配置
     * @param {Object} request - createMcpRequest 构建的请求对象
     * @param {Object} [options] - { timeoutMs?, maxBytes? }
     * @returns {Promise<Object>} 已规范化的 JSON-RPC 响应
     * @protected
     */
    async _sendJsonRpc(server, request, options) {
        const timeoutMs = (options && options.timeoutMs) || DEFAULT_REQUEST_TIMEOUT_MS;
        const maxBytes = options && options.maxBytes;
        const headers = this._buildRequestHeaders(server);
        // 协商后的协议版本附带在请求头
        if (this._protocolVersion) {
            headers['MCP-Protocol-Version'] = this._protocolVersion;
        }
        const body = JSON.stringify(request);
        const resp = await httpRequest({
            method: 'POST',
            url: server.url,
            headers,
            body,
            timeoutMs,
            maxBytes
        });
        if (resp.status === 0 || resp.status < 200 || resp.status >= 300) {
            throw new McpTransportError(
                'mcp_http_error',
                `MCP server returned HTTP ${resp.status}.`,
                { retryable: resp.status >= 500 }
            );
        }
        const contentType = (resp.headers['content-type'] || '').toLowerCase();
        // 响应可能是 JSON 或 SSE 流（HTTP 传输下退化处理：若 content-type 为 SSE，按 SSE 解析）
        if (contentType.indexOf('text/event-stream') >= 0) {
            return this._readSseBody(resp.body, request);
        }
        const raw = resp.body;
        if (!raw || !raw.trim()) {
            throw new McpTransportError('mcp_response_invalid', 'MCP response body was empty.', { retryable: false });
        }
        let parsed;
        try {
            parsed = JSON.parse(raw);
        } catch (e) {
            throw new McpTransportError('mcp_response_invalid', 'MCP response body was not valid JSON.', { retryable: false });
        }
        return normalizeJsonRpcResponse(parsed, request);
    }

    /**
     * 从 SSE 响应体中提取首个匹配的 JSON-RPC 响应
     * （HTTP 传输收到 SSE 响应时的退化处理）
     * @param {string} body - 完整响应体
     * @param {Object} request - 关联请求
     * @returns {Object} 响应
     * @private
     */
    _readSseBody(body, request) {
        // 复用 common 的 drainSseEvents
        // 为避免循环引用，此处内联最小实现
        const events = [];
        const blocks = body.split(/\r?\n\r?\n/);
        for (const block of blocks) {
            const lines = block.split(/\r?\n/);
            let data = [];
            for (const line of lines) {
                if (line.indexOf('data:') === 0) {
                    const raw = line.slice(5);
                    data.push(raw.startsWith(' ') ? raw.slice(1) : raw);
                }
            }
            if (data.length > 0) events.push(data.join('\n'));
        }
        for (const evtData of events) {
            let parsed;
            try { parsed = JSON.parse(evtData); } catch (e) { continue; }
            if (parsed && typeof parsed === 'object' && Object.prototype.hasOwnProperty.call(parsed, 'method')) {
                continue; // 服务端通知
            }
            return normalizeJsonRpcResponse(parsed, request);
        }
        throw new McpTransportError('mcp_sse_response_missing', 'MCP SSE stream ended without a matching response.', { retryable: false });
    }

    /**
     * 发送 notifications/initialized 通知（忽略响应）
     * @param {Object} server - 服务配置
     * @param {Object} [options] - { timeoutMs? }
     * @returns {Promise<void>}
     * @protected
     */
    async _sendInitializedNotification(server, options) {
        const timeoutMs = (options && options.timeoutMs) || DEFAULT_REQUEST_TIMEOUT_MS;
        const headers = this._buildRequestHeaders(server);
        if (this._protocolVersion) {
            headers['MCP-Protocol-Version'] = this._protocolVersion;
        }
        const notification = createMcpNotification('notifications/initialized');
        try {
            await httpRequest({
                method: 'POST',
                url: server.url,
                headers,
                body: JSON.stringify(notification),
                timeoutMs
            });
        } catch (e) {
            // 通知失败不阻断流程（参考实现也是尽力发送）
        }
    }

    /**
     * 执行 initialize 握手
     * @param {Object} server - 服务配置
     * @param {Object} [options] - { timeoutMs?, maxBytes? }
     * @returns {Promise<{ protocolVersion: string, serverInfo?: Object, instructions?: string }>}
     * @protected
     */
    async _initialize(server, options) {
        const timeoutMs = (options && options.timeoutMs) || DEFAULT_CONNECT_TIMEOUT_MS;
        const request = createMcpRequest('initialize', {
            protocolVersion: MCP_PROTOCOL_VERSION,
            capabilities: { tools: {} },
            clientInfo: {
                name: CLIENT_NAME,
                version: getClientVersion()
            }
        });
        const response = await this._sendJsonRpc(server, request, { timeoutMs, maxBytes: options && options.maxBytes });
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
        // 发送 initialized 通知
        await this._sendInitializedNotification(server, { timeoutMs });
        return {
            protocolVersion: advertised,
            serverInfo: this._serverInfo || undefined,
            instructions: this._instructions || undefined
        };
    }

    /**
     * 发现服务工具：initialize → tools/list（分页）
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
     * 分页拉取工具列表
     * @param {Object} server - 服务配置
     * @param {Object} [options] - { timeoutMs?, maxBytes? }
     * @returns {Promise<Array>} 工具描述符数组
     * @protected
     */
    async _listTools(server, options) {
        const timeoutMs = (options && options.timeoutMs) || DEFAULT_DISCOVERY_TIMEOUT_MS;
        const maxBytes = options && options.maxBytes;
        const maxToolCount = (server.limits && server.limits.maxToolCount) || DEFAULT_MAX_TOOL_COUNT;
        const tools = [];
        let cursor;
        do {
            const request = createMcpRequest('tools/list', cursor ? { cursor } : undefined);
            const response = await this._sendJsonRpc(server, request, { timeoutMs, maxBytes });
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
     * 调用工具
     * @param {Object} server - 服务配置
     * @param {string} name - 工具名（MCP 原始名）
     * @param {Object} args - 工具参数
     * @param {Object} [options] - { timeoutMs?, maxBytes? }
     * @returns {Promise<{ ok: boolean, summary: string, detail?: string, output?: *, isError?: boolean, truncated?: boolean }>}
     */
    async callTool(server, name, args, options) {
        const startedAt = Date.now();
        const timeoutMs = (options && options.timeoutMs) || DEFAULT_REQUEST_TIMEOUT_MS;
        const maxBytes = options && options.maxBytes;
        try {
            // 若未握手则先 initialize（单次调用场景）
            if (!this._protocolVersion) {
                await this._initialize(server, { timeoutMs: DEFAULT_CONNECT_TIMEOUT_MS, maxBytes });
            }
            const request = createMcpRequest('tools/call', {
                name,
                arguments: args || {}
            });
            const response = await this._sendJsonRpc(server, request, { timeoutMs, maxBytes });
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
     * HTTP 传输无状态连接，无需清理
     */
    async cleanup() {
        this._protocolVersion = null;
        this._serverInfo = null;
        this._instructions = null;
    }
}

/**
 * 工厂函数：创建 HTTP 传输实例
 * @returns {HttpTransport}
 */
export function createHttpTransport() {
    return new HttpTransport();
}
