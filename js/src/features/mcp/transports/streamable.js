/**
 * @file streamable.js
 * @module mcp/transports/streamable
 *
 * MCP Streamable HTTP 传输层（2025-03-26 及之后的主流协议）
 *
 * 协议特点：
 *   - 单端点 POST，所有请求都发到 server.url
 *   - 响应可能是 application/json（单条 JSON-RPC 响应）或 text/event-stream（SSE 流）
 *   - 支持 session id：服务端在 initialize 响应头返回 Mcp-Session-Id，
 *     客户端在后续请求头携带 Mcp-Session-Id 维持会话
 *   - 服务端可在 SSE 流中推送多条消息（请求/通知/响应），客户端按 id 匹配响应
 *
 * 与 HTTP 传输的区别：
 *   - HTTP 传输无 session（每次请求独立）
 *   - Streamable HTTP 在 initialize 后获得 session id，后续请求复用
 *
 * 参考实现：deepseek-pp/core/mcp/transports/http.ts（createMcpStreamableHttpTransport）
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
    drainSseEvents,
    parseJsonRpcSseMessage,
    normalizeJsonRpcResponse,
    normalizeToolDescriptor,
    normalizeToolResult
} from './common.js';

/** 默认连接超时 */
const DEFAULT_CONNECT_TIMEOUT_MS = 10000;
/** 默认发现超时 */
const DEFAULT_DISCOVERY_TIMEOUT_MS = 20000;
/** 默认请求超时 */
const DEFAULT_REQUEST_TIMEOUT_MS = 60000;
/** 单服务工具数上限 */
const DEFAULT_MAX_TOOL_COUNT = 128;

/**
 * MCP Streamable HTTP 传输层
 *
 * 维护 session id 状态：initialize 响应头中的 Mcp-Session-Id 缓存到实例，
 * 后续请求头携带 Mcp-Session-Id 与 MCP-Protocol-Version
 */
export class StreamableHttpTransport extends McpBaseTransport {
    constructor() {
        super();
        /** @type {string|null} 协商后的协议版本 */
        this._protocolVersion = null;
        /** @type {string|null} 会话 ID（来自 initialize 响应头 Mcp-Session-Id） */
        this._sessionId = null;
        /** @type {Object|null} 服务端信息 */
        this._serverInfo = null;
        /** @type {string|null} 服务端说明 */
        this._instructions = null;
    }

    /**
     * 构建请求头（含 session id 与协议版本）
     * @param {Object} server - 服务配置
     * @returns {Object} 头映射
     * @override
     */
    _buildRequestHeaders(server) {
        const headers = super._buildRequestHeaders(server);
        if (this._protocolVersion) {
            headers['MCP-Protocol-Version'] = this._protocolVersion;
        }
        if (this._sessionId) {
            headers['Mcp-Session-Id'] = this._sessionId;
        }
        return headers;
    }

    /**
     * 发送单条 JSON-RPC 请求并解析响应
     * 响应可能是 JSON 或 SSE 流；若是 SSE 流，从流中提取匹配 id 的响应
     *
     * @param {Object} server - 服务配置
     * @param {Object} request - 请求对象
     * @param {Object} [options] - { timeoutMs?, maxBytes?, captureSession? }
     * @param {boolean} [options.captureSession=false] - 是否从响应头捕获 session id（仅 initialize）
     * @returns {Promise<Object>} 已规范化的 JSON-RPC 响应
     * @private
     */
    async _sendJsonRpc(server, request, options) {
        const timeoutMs = (options && options.timeoutMs) || DEFAULT_REQUEST_TIMEOUT_MS;
        const maxBytes = options && options.maxBytes;
        const captureSession = options && options.captureSession;

        const headers = this._buildRequestHeaders(server);
        const body = JSON.stringify(request);
        const resp = await httpRequest({
            method: 'POST',
            url: server.url,
            headers,
            body,
            timeoutMs,
            maxBytes
        });

        // 捕获 session id（initialize 响应）
        if (captureSession && !this._sessionId) {
            const sid = resp.headers['mcp-session-id'];
            if (typeof sid === 'string' && sid.trim()) {
                this._sessionId = sid.trim();
            }
        }

        if (resp.status === 0 || resp.status < 200 || resp.status >= 300) {
            throw new McpTransportError(
                'mcp_http_error',
                `MCP server returned HTTP ${resp.status}.`,
                { retryable: resp.status >= 500 }
            );
        }

        const contentType = (resp.headers['content-type'] || '').toLowerCase();
        if (contentType.indexOf('text/event-stream') >= 0) {
            // SSE 流响应：从完整 body 中解析事件，匹配 id
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
     * @param {string} body - 完整 SSE 响应体
     * @param {Object} request - 关联请求
     * @returns {Object} 响应
     * @private
     */
    _readSseBody(body, request) {
        const drained = drainSseEvents(body);
        for (const evt of drained.events) {
            if (evt.event !== 'message') continue;
            let parsed;
            try {
                parsed = parseJsonRpcSseMessage(evt.data, request);
            } catch (e) {
                throw e;
            }
            if (parsed) return parsed;
        }
        // 检查剩余缓冲（不完整事件块）
        if (drained.remainder) {
            const drained2 = drainSseEvents(drained.remainder + '\n\n');
            for (const evt of drained2.events) {
                if (evt.event !== 'message') continue;
                let parsed;
                try {
                    parsed = parseJsonRpcSseMessage(evt.data, request);
                } catch (e) {
                    throw e;
                }
                if (parsed) return parsed;
            }
        }
        throw new McpTransportError(
            'mcp_sse_response_missing',
            'MCP SSE stream ended without a matching response.',
            { retryable: false }
        );
    }

    /**
     * 发送 notifications/initialized 通知（忽略响应）
     * @param {Object} server - 服务配置
     * @param {Object} [options] - { timeoutMs? }
     * @returns {Promise<void>}
     * @private
     */
    async _sendInitializedNotification(server, options) {
        const timeoutMs = (options && options.timeoutMs) || DEFAULT_REQUEST_TIMEOUT_MS;
        const headers = this._buildRequestHeaders(server);
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
            // 通知失败不阻断流程
        }
    }

    /**
     * 执行 initialize 握手（捕获 session id）
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
        const response = await this._sendJsonRpc(server, request, {
            timeoutMs,
            maxBytes: options && options.maxBytes,
            captureSession: true
        });
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
        await this._sendInitializedNotification(server, { timeoutMs });
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
     * 清理传输层资源：丢弃 session
     */
    async cleanup() {
        this._protocolVersion = null;
        this._sessionId = null;
        this._serverInfo = null;
        this._instructions = null;
    }
}

/**
 * 工厂函数：创建 Streamable HTTP 传输实例
 * @returns {StreamableHttpTransport}
 */
export function createStreamableHttpTransport() {
    return new StreamableHttpTransport();
}
