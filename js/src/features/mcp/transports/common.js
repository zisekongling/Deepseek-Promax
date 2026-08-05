/**
 * @file common.js
 * @module mcp/transports/common
 *
 * MCP 传输层公共基类与工具集
 *
 * 职责：
 *   - 定义抽象传输基类 McpBaseTransport，声明 discover() / callTool(name, args) / cleanup() 接口
 *   - 提供跨环境 HTTP 请求封装（油猴 GM_xmlhttpRequest 优先，WebView Platform.http() 回退）
 *   - 统一 JSON-RPC 2.0 请求/响应构建与校验
 *   - 统一 SSE 事件解析（data: 行、endpoint 事件）
 *   - 统一超时与错误处理（McpTransportError）
 *   - 统一结果大小限制（按 UTF-8 字节截断）
 *
 * 跨域策略：
 *   - 篡改猴环境：GM_xmlhttpRequest 可跨域（需在油猴脚本头声明 @connect）
 *   - Android WebView 环境：经 Platform.http() 由原生发起请求，绕过 CORS
 *   - 未知环境：回退到 fetch（受 CORS 限制，仅同域可用）
 *
 * 参考实现：deepseek-pp/core/mcp/transports/common.ts
 */

// ============================================================
// 协议常量
// ============================================================

/** MCP 协议版本（最新） */
export const MCP_PROTOCOL_VERSION = '2025-06-18';

/** 客户端支持协商的协议版本列表（按时间倒序） */
export const MCP_SUPPORTED_PROTOCOL_VERSIONS = [
    '2025-06-18',
    '2025-03-26',
    '2024-11-05'
];

/** 客户端名称（与 deepseek-pp 保持一致） */
export const CLIENT_NAME = 'DeepSeek-Userscript';

/**
 * 获取客户端版本号
 * 优先用油猴脚本版本，其次 window.__dsVersion，最后硬编码
 * @returns {string}
 */
export function getClientVersion() {
    try {
        if (typeof GM_info !== 'undefined' && GM_info && GM_info.version) {
            return String(GM_info.version);
        }
    } catch (e) {}
    try {
        if (typeof window !== 'undefined' && window.__dsVersion) {
            return String(window.__dsVersion);
        }
    } catch (e) {}
    return '1.0.0';
}

// ============================================================
// 错误类型
// ============================================================

/**
 * MCP 传输层错误
 * 携带错误码与可重试标记，便于上层决策
 */
export class McpTransportError extends Error {
    /**
     * @param {string} code - 错误码（如 mcp_transport_timeout）
     * @param {string} message - 错误消息
     * @param {{ retryable?: boolean }} [options] - 是否可重试（默认 true）
     */
    constructor(code, message, options) {
        super(message);
        this.name = 'McpTransportError';
        this.code = code;
        this.retryable = options && options.retryable !== undefined ? options.retryable : true;
    }
}

// ============================================================
// 跨环境请求基础设施
// ============================================================

/**
 * 安全获取 GM_xmlhttpRequest 引用
 * 在非油猴环境返回 null
 * @returns {Function|null}
 */
function getGmXhr() {
    try {
        if (typeof GM_xmlhttpRequest !== 'undefined') return GM_xmlhttpRequest;
    } catch (e) {}
    try {
        if (typeof unsafeWindow !== 'undefined' && unsafeWindow.GM_xmlhttpRequest) {
            return unsafeWindow.GM_xmlhttpRequest;
        }
    } catch (e) {}
    try {
        if (typeof window !== 'undefined' && window.GM_xmlhttpRequest) {
            return window.GM_xmlhttpRequest;
        }
    } catch (e) {}
    return null;
}

/**
 * 安全获取 Platform 桥接对象
 * 延迟导入避免循环依赖；Platform.http() 由 platform/bridge.js 提供
 * @returns {Object|null}
 */
function getPlatform() {
    try {
        if (typeof window !== 'undefined' && window.__dsPlatform) {
            return window.__dsPlatform;
        }
    } catch (e) {}
    return null;
}

/**
 * 统一的 HTTP 请求封装（一次性读取完整响应，适用于 JSON-RPC 请求/响应）
 *
 * 环境优先级：
 *   1. 油猴 GM_xmlhttpRequest（可跨域）
 *   2. Platform.http()（WebView 原生，可跨域）
 *   3. fetch（同域可用）
 *
 * @param {Object} opts - 请求参数
 * @param {string} opts.method - HTTP 方法（GET/POST）
 * @param {string} opts.url - 请求地址
 * @param {Object} [opts.headers] - 请求头
 * @param {string} [opts.body] - 请求体
 * @param {number} [opts.timeoutMs] - 超时毫秒
 * @param {number} [opts.maxBytes] - 响应体最大字节（超出抛 mcp_response_too_large）
 * @returns {Promise<{ status: number, headers: Object, body: string }>} 响应
 */
export async function httpRequest(opts) {
    const method = (opts.method || 'GET').toUpperCase();
    const url = opts.url;
    const headers = opts.headers || {};
    const body = opts.body || '';
    const timeoutMs = opts.timeoutMs || 60000;
    const maxBytes = opts.maxBytes;

    if (!url) {
        throw new McpTransportError('mcp_endpoint_missing', 'MCP server URL is missing.', { retryable: false });
    }

    const gmXhr = getGmXhr();
    if (gmXhr) {
        return gmJsonRequest(gmXhr, { method, url, headers, body, timeoutMs, maxBytes });
    }

    const platform = getPlatform();
    if (platform && typeof platform.http === 'function') {
        const resp = await withTimeout(platform.http(method, url, headers, body), timeoutMs, 'Platform.http');
        const limitedBody = enforceByteLimit(resp.body || '', maxBytes);
        return {
            status: resp.status || 0,
            headers: resp.headers || {},
            body: limitedBody
        };
    }

    // 回退到 fetch（同域）
    if (typeof fetch === 'function') {
        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
        try {
            const fetchResp = await fetch(url, {
                method,
                headers,
                body: body || undefined,
                credentials: 'omit',
                signal: controller ? controller.signal : undefined
            });
            const text = await fetchResp.text();
            const limitedBody2 = enforceByteLimit(text, maxBytes);
            return {
                status: fetchResp.status,
                headers: headersToObject(fetchResp.headers),
                body: limitedBody2
            };
        } catch (err) {
            if (controller && controller.signal.aborted) {
                throw new McpTransportError('mcp_transport_timeout', `MCP request exceeded ${timeoutMs} ms.`);
            }
            throw new McpTransportError('mcp_network_error', `Cannot reach MCP server at ${url}: ${err && err.message || err}`);
        } finally {
            if (timer) clearTimeout(timer);
        }
    }

    throw new McpTransportError('mcp_transport_unavailable', 'No HTTP transport available in this environment.', { retryable: false });
}

/**
 * 经 GM_xmlhttpRequest 发送请求并读取完整响应
 * @param {Function} gmXhr - GM_xmlhttpRequest 函数
 * @param {Object} params - { method, url, headers, body, timeoutMs, maxBytes }
 * @returns {Promise<{ status: number, headers: Object, body: string }>}
 */
function gmJsonRequest(gmXhr, params) {
    return new Promise((resolve, reject) => {
        let settled = false;
        const req = {
            method: params.method,
            url: params.url,
            headers: params.headers,
            data: params.body,
            timeout: params.timeoutMs,
            onload: (resp) => {
                if (settled) return;
                settled = true;
                try {
                    const limited = enforceByteLimit(resp.responseText || '', params.maxBytes);
                    resolve({
                        status: resp.status,
                        headers: parseResponseHeaders(resp.responseHeaders || ''),
                        body: limited
                    });
                } catch (e) {
                    reject(e);
                }
            },
            onerror: (resp) => {
                if (settled) return;
                settled = true;
                const msg = resp && resp.error ? String(resp.error) : `GM_xmlhttpRequest error for ${params.url}`;
                reject(new McpTransportError('mcp_network_error', msg));
            },
            ontimeout: () => {
                if (settled) return;
                settled = true;
                reject(new McpTransportError('mcp_transport_timeout', `MCP request exceeded ${params.timeoutMs} ms.`));
            },
            onabort: () => {
                if (settled) return;
                settled = true;
                reject(new McpTransportError('mcp_transport_aborted', 'MCP request was aborted.'));
            }
        };
        try {
            gmXhr(req);
        } catch (e) {
            if (!settled) {
                settled = true;
                reject(new McpTransportError('mcp_network_error', `GM_xmlhttpRequest invoke failed: ${e && e.message || e}`));
            }
        }
    });
}

/**
 * 发起流式 HTTP 请求（用于 SSE），通过 onprogress 回调推送增量数据
 * 仅 GM_xmlhttpRequest 环境支持真正的流式；其他环境回退为一次性读取完整 body
 *
 * @param {Object} opts - { method, url, headers, body, timeoutMs, maxBytes }
 * @param {Function} onProgress - (chunkText, fullText) => void，每次收到增量调用
 * @returns {Promise<{ status: number, headers: Object, fullText: string }>} 流结束后的完整响应
 */
export async function httpStreamRequest(opts, onProgress) {
    const method = (opts.method || 'GET').toUpperCase();
    const url = opts.url;
    const headers = Object.assign({ accept: 'text/event-stream' }, opts.headers || {});
    const body = opts.body || '';
    const timeoutMs = opts.timeoutMs || 60000;
    const maxBytes = opts.maxBytes;

    const gmXhr = getGmXhr();
    if (gmXhr) {
        return gmStreamRequest(gmXhr, { method, url, headers, body, timeoutMs, maxBytes }, onProgress);
    }

    // Platform / fetch 不支持流式增量：一次性读取，模拟一次 onProgress
    const resp = await httpRequest({ method, url, headers, body, timeoutMs, maxBytes });
    if (typeof onProgress === 'function') {
        try { onProgress(resp.body, resp.body); } catch (e) {}
    }
    return { status: resp.status, headers: resp.headers, fullText: resp.body };
}

/**
 * GM_xmlhttpRequest 流式请求（onprogress 推送增量）
 * @param {Function} gmXhr - GM_xmlhttpRequest 函数
 * @param {Object} params - 请求参数
 * @param {Function} onProgress - (chunk, full) => void
 * @returns {Promise<{ status: number, headers: Object, fullText: string }>}
 */
function gmStreamRequest(gmXhr, params, onProgress) {
    return new Promise((resolve, reject) => {
        let settled = false;
        let lastLen = 0;
        let totalBytes = 0;
        const req = {
            method: params.method,
            url: params.url,
            headers: params.headers,
            data: params.body,
            timeout: params.timeoutMs,
            onprogress: (resp) => {
                if (settled) return;
                try {
                    const full = resp.responseText || '';
                    const len = full.length;
                    // 字节限制（粗略，按 UTF-8 字符串长度估算）
                    if (params.maxBytes) {
                        totalBytes = approxUtf8Bytes(full);
                        if (totalBytes > params.maxBytes) {
                            settled = true;
                            reject(new McpTransportError('mcp_response_too_large', `MCP response exceeded ${params.maxBytes} bytes.`, { retryable: false }));
                            return;
                        }
                    }
                    if (len > lastLen && typeof onProgress === 'function') {
                        const chunk = full.slice(lastLen);
                        lastLen = len;
                        try { onProgress(chunk, full); } catch (e) {}
                    }
                } catch (e) {}
            },
            onload: (resp) => {
                if (settled) return;
                settled = true;
                const full = resp.responseText || '';
                resolve({
                    status: resp.status,
                    headers: parseResponseHeaders(resp.responseHeaders || ''),
                    fullText: full
                });
            },
            onerror: (resp) => {
                if (settled) return;
                settled = true;
                reject(new McpTransportError('mcp_network_error', (resp && resp.error) ? String(resp.error) : `GM stream error for ${params.url}`));
            },
            ontimeout: () => {
                if (settled) return;
                settled = true;
                reject(new McpTransportError('mcp_transport_timeout', `MCP stream exceeded ${params.timeoutMs} ms.`));
            },
            onabort: () => {
                if (settled) return;
                settled = true;
                reject(new McpTransportError('mcp_transport_aborted', 'MCP stream was aborted.'));
            }
        };
        try {
            gmXhr(req);
        } catch (e) {
            if (!settled) {
                settled = true;
                reject(new McpTransportError('mcp_network_error', `GM_xmlhttpRequest(stream) invoke failed: ${e && e.message || e}`));
            }
        }
    });
}

/**
 * 将 Promise 包裹在超时保护中
 * @param {Promise} promise - 待包裹的 Promise
 * @param {number} timeoutMs - 超时毫秒
 * @param {string} [label] - 超时标签（用于错误消息）
 * @returns {Promise}
 */
function withTimeout(promise, timeoutMs, label) {
    if (!timeoutMs || timeoutMs <= 0) return promise;
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new McpTransportError('mcp_transport_timeout', `${label || 'MCP request'} exceeded ${timeoutMs} ms.`));
        }, timeoutMs);
        promise.then(
            (v) => { clearTimeout(timer); resolve(v); },
            (e) => { clearTimeout(timer); reject(e); }
        );
    });
}

/**
 * 按字节限制截断响应文本，超限抛错
 * @param {string} text - 响应文本
 * @param {number} [maxBytes] - 最大字节
 * @returns {string} 通过限制的文本
 */
function enforceByteLimit(text, maxBytes) {
    if (!maxBytes || maxBytes <= 0) return text;
    const bytes = approxUtf8Bytes(text);
    if (bytes <= maxBytes) return text;
    throw new McpTransportError('mcp_response_too_large', `MCP response exceeded ${maxBytes} bytes.`, { retryable: false });
}

/**
 * 估算字符串的 UTF-8 字节长度（避免每个字符都 encode 的开销）
 * @param {string} str - 输入字符串
 * @returns {number} 字节长度
 */
function approxUtf8Bytes(str) {
    if (!str) return 0;
    let bytes = 0;
    for (let i = 0; i < str.length; i++) {
        const code = str.charCodeAt(i);
        if (code < 0x80) bytes += 1;
        else if (code < 0x800) bytes += 2;
        else if (code >= 0xD800 && code <= 0xDBFF) { bytes += 4; i++; } // 代理对
        else bytes += 3;
    }
    return bytes;
}

/**
 * 精确按 UTF-8 字节上限截断字符串（保留完整字符边界）
 * @param {string} value - 输入字符串
 * @param {number} maxBytes - 最大字节
 * @returns {{ value: string, truncated: boolean }}
 */
export function truncateUtf8ToByteLimit(value, maxBytes) {
    const limit = Number.isFinite(maxBytes) ? Math.max(0, Math.floor(maxBytes)) : 0;
    if (limit <= 0) return { value, truncated: false };
    const bytes = approxUtf8Bytes(value);
    if (bytes <= limit) return { value, truncated: false };
    // 按字符逐步回退，直到字节长度 <= limit
    let boundary = value.length;
    while (boundary > 0 && approxUtf8Bytes(value.slice(0, boundary)) > limit) {
        boundary -= 1;
    }
    return { value: value.slice(0, boundary), truncated: true };
}

/**
 * 解析响应头字符串为对象
 * @param {string} headerString - 原始响应头字符串
 * @returns {Object} 头名到值的映射（键小写）
 */
function parseResponseHeaders(headerString) {
    const headers = {};
    if (!headerString) return headers;
    const lines = headerString.split(/\r?\n/);
    for (const line of lines) {
        const idx = line.indexOf(':');
        if (idx <= 0) continue;
        const name = line.slice(0, idx).trim().toLowerCase();
        const val = line.slice(idx + 1).trim();
        if (name) headers[name] = val;
    }
    return headers;
}

/**
 * 将 Headers 对象转为普通对象
 * @param {Headers} headers - fetch Headers
 * @returns {Object}
 */
function headersToObject(headers) {
    const obj = {};
    if (!headers) return obj;
    try {
        headers.forEach((value, key) => { obj[key.toLowerCase()] = value; });
    } catch (e) {}
    return obj;
}

// ============================================================
// JSON-RPC 2.0 消息构建与校验
// ============================================================

let _nextRequestId = 1;

/**
 * 生成 JSON-RPC 请求 ID（递增数字转字符串，便于跨环境对齐）
 * @returns {string}
 */
function generateRequestId() {
    const id = _NextRequestId();
    return id;
}

/**
 * 内部自增 ID 生成器
 * @returns {string}
 */
function _NextRequestId() {
    const id = _nextRequestId++;
    return String(id);
}

/**
 * 构建 JSON-RPC 2.0 请求对象
 * @param {string} method - 方法名（如 initialize / tools/list / tools/call）
 * @param {Object} [params] - 参数对象
 * @returns {{ jsonrpc: '2.0', id: string, method: string, params?: Object }}
 */
export function createMcpRequest(method, params) {
    const req = { jsonrpc: '2.0', id: generateRequestId(), method };
    if (params !== undefined) req.params = params;
    return req;
}

/**
 * 构建 JSON-RPC 2.0 通知对象（无 id）
 * @param {string} method - 方法名（如 notifications/initialized）
 * @param {Object} [params] - 参数对象
 * @returns {{ jsonrpc: '2.0', method: string, params?: Object }}
 */
export function createMcpNotification(method, params) {
    const req = { jsonrpc: '2.0', method };
    if (params !== undefined) req.params = params;
    return req;
}

/**
 * 规范化校验 JSON-RPC 2.0 响应
 * @param {*} raw - 原始解析对象
 * @param {{ id?: string }} [expectedRequest] - 关联的请求对象（校验 id 一致性）
 * @returns {{ jsonrpc: '2.0', id: string|null, result?: *, error?: { code: number, message: string, data?: * } }}
 * @throws {McpTransportError} 响应不合法时抛出
 */
export function normalizeJsonRpcResponse(raw, expectedRequest) {
    if (!isPlainRecord(raw)) {
        throw invalidResponse('MCP response was not a plain JSON object.');
    }
    if (raw.jsonrpc !== '2.0') {
        throw invalidResponse('MCP response jsonrpc must be exactly "2.0".');
    }
    if (!isResponseId(raw.id)) {
        throw invalidResponse('MCP response id must be a string, finite number, or null.');
    }
    if (expectedRequest && raw.id !== expectedRequest.id) {
        throw invalidResponse('MCP response id did not match the active request.');
    }
    const hasResult = Object.prototype.hasOwnProperty.call(raw, 'result');
    const hasError = Object.prototype.hasOwnProperty.call(raw, 'error');
    if (hasResult === hasError) {
        throw invalidResponse('MCP response must contain exactly one of result or error.');
    }
    if (hasResult) {
        return { jsonrpc: '2.0', id: raw.id, result: raw.result };
    }
    if (!isJsonRpcError(raw.error)) {
        throw invalidResponse('MCP response error must contain an integer numeric code and string message.');
    }
    return { jsonrpc: '2.0', id: raw.id, error: raw.error };
}

/**
 * 解析 SSE 事件 data 字段为 JSON-RPC 响应
 * 若是服务端通知（含 method 字段）返回 null
 * @param {string} data - SSE 事件 data 内容
 * @param {{ id?: string }} [expectedRequest] - 关联请求
 * @returns {Object|null} 响应对象；服务端通知返回 null
 */
export function parseJsonRpcSseMessage(data, expectedRequest) {
    let parsed;
    try {
        parsed = JSON.parse(data);
    } catch (e) {
        throw invalidResponse('MCP SSE event data was not valid JSON.');
    }
    if (!isPlainRecord(parsed)) {
        throw invalidResponse('MCP SSE message was not a plain JSON object.');
    }
    // 服务端请求/通知：含 method 字段，忽略（本实现不处理服务端主动消息）
    if (Object.prototype.hasOwnProperty.call(parsed, 'method')) {
        return null;
    }
    return normalizeJsonRpcResponse(parsed, expectedRequest);
}

/**
 * 构造非法响应错误
 * @param {string} message - 错误消息
 * @returns {McpTransportError}
 */
function invalidResponse(message) {
    return new McpTransportError('mcp_response_invalid', message, { retryable: false });
}

/**
 * 判断值是否为普通对象（非数组、非 null，原型为 Object.prototype 或 null）
 * @param {*} value
 * @returns {boolean}
 */
function isPlainRecord(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}

/**
 * 判断值是否为合法的 JSON-RPC 响应 id
 * @param {*} value
 * @returns {boolean}
 */
function isResponseId(value) {
    return value === null || typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value));
}

/**
 * 判断值是否为合法的 JSON-RPC error 对象
 * @param {*} value
 * @returns {boolean}
 */
function isJsonRpcError(value) {
    return isPlainRecord(value) &&
        typeof value.code === 'number' &&
        Number.isInteger(value.code) &&
        typeof value.message === 'string';
}

// ============================================================
// SSE 事件解析
// ============================================================

/**
 * @typedef {Object} SseEvent
 * @property {string} event - 事件类型（默认 'message'）
 * @property {string} data - 事件数据（多行 data: 已合并）
 */

/**
 * 从缓冲区中抽干所有完整 SSE 事件块
 * SSE 事件块以两个换行分隔；返回剩余未完成的部分
 * @param {string} buffer - 累积的 SSE 文本
 * @returns {{ events: SseEvent[], remainder: string }}
 */
export function drainSseEvents(buffer) {
    const events = [];
    // 匹配两个及以上换行（兼容 \r\n / \r / \n）
    const boundaryPattern = /(?:\r\n|\r(?!\n)|\n)(?:\r\n|\r(?!\n)|\n)/g;
    let blockStart = 0;
    let boundary;
    while ((boundary = boundaryPattern.exec(buffer)) !== null) {
        const evt = parseSseEvent(buffer.slice(blockStart, boundary.index));
        if (evt) events.push(evt);
        blockStart = boundary.index + boundary[0].length;
    }
    return { events, remainder: buffer.slice(blockStart) };
}

/**
 * 解析单个 SSE 事件块
 * @param {string} block - 事件块文本
 * @returns {SseEvent|null} 无 data 行返回 null
 */
export function parseSseEvent(block) {
    const lines = block.split(/\r\n|\r|\n/);
    let event = 'message';
    const dataParts = [];
    for (const line of lines) {
        if (line.indexOf('event:') === 0) {
            event = line.slice(6).trim();
        } else if (line.indexOf('data:') === 0) {
            // data: 后允许一个前导空格，按 SSE 规范去掉
            const raw = line.slice(5);
            dataParts.push(raw.startsWith(' ') ? raw.slice(1) : raw);
        }
    }
    if (dataParts.length === 0) return null;
    return { event, data: dataParts.join('\n') };
}

// ============================================================
// 抽象传输基类
// ============================================================

/**
 * MCP 传输层抽象基类
 *
 * 子类必须实现：
 *   - discover(server, options) → { tools: ToolDescriptor[], protocolVersion, serverInfo }
 *   - callTool(server, name, args, options) → { ok, summary, detail, output, isError, truncated }
 *   - cleanup() → void
 *
 * 基类提供：
 *   - _buildRequestHeaders(server) 构建鉴权头
 *   - _unwrapResult(response, errorCode) 解包 JSON-RPC result
 *   - 共享的超时与大小限制默认值
 */
export class McpBaseTransport {
    /**
     * 构建鉴权与自定义请求头
     * @param {Object} server - 服务配置（含 headers 数组与可选 Bearer token）
     * @returns {Object} 头名到值的映射
     */
    _buildRequestHeaders(server) {
        const headers = {
            'accept': 'application/json, text/event-stream',
            'content-type': 'application/json'
        };
        // 自定义 header 数组
        if (Array.isArray(server.headers)) {
            for (const h of server.headers) {
                if (h && typeof h.name === 'string' && h.name.trim()) {
                    headers[h.name.trim()] = String(h.value || '');
                }
            }
        }
        // Bearer token：headers 中若有 Authorization 直接用；否则取 server.token
        if (server.token && !headers['Authorization'] && !headers['authorization']) {
            headers['Authorization'] = `Bearer ${server.token}`;
        }
        return headers;
    }

    /**
     * 解包 JSON-RPC 响应的 result；若为 error 抛 McpTransportError
     * @param {{ result?: *, error?: { code: number, message: string } }} response - 已规范化的响应
     * @param {string} errorCode - 错误时使用的错误码
     * @returns {*} result 字段
     */
    _unwrapResult(response, errorCode) {
        if (response.error) {
            throw new McpTransportError(errorCode, response.error.message, {
                retryable: response.error.code === -32000 || response.error.code === -32603
            });
        }
        if (!('result' in response)) {
            throw new McpTransportError(errorCode, 'MCP response did not include a result.', { retryable: true });
        }
        return response.result;
    }

    /**
     * 发现服务工具（子类实现）
     * @param {Object} server - 服务配置
     * @param {Object} [options] - { timeoutMs?, maxBytes? }
     * @returns {Promise<{ tools: Array, protocolVersion: string, serverInfo?: Object, instructions?: string }>}
     */
    async discover(server, options) {
        throw new McpTransportError('mcp_transport_unsupported', 'discover() not implemented.', { retryable: false });
    }

    /**
     * 调用工具（子类实现）
     * @param {Object} server - 服务配置
     * @param {string} name - 工具名
     * @param {Object} args - 工具参数
     * @param {Object} [options] - { timeoutMs?, maxBytes? }
     * @returns {Promise<{ ok: boolean, summary: string, detail?: string, output?: *, isError?: boolean, truncated?: boolean }>}
     */
    async callTool(server, name, args, options) {
        throw new McpTransportError('mcp_transport_unsupported', 'callTool() not implemented.', { retryable: false });
    }

    /**
     * 清理传输层资源（如长连接）；子类按需覆盖
     */
    async cleanup() {
        // 默认无操作
    }
}

// ============================================================
// 工具描述符与结果归一化（供各传输共享）
// ============================================================

/**
 * 将 MCP 工具定义归一化为内部工具描述符
 * @param {Object} server - 服务配置
 * @param {Object} tool - MCP 工具定义（name/title/description/inputSchema/annotations）
 * @returns {Object} 归一化后的工具描述符
 */
export function normalizeToolDescriptor(server, tool) {
    const rawName = typeof tool.name === 'string' ? tool.name : '';
    return {
        name: rawName,
        title: stringOr(tool.title, '') || rawName,
        description: stringOr(tool.description, '') || `MCP tool ${rawName}`,
        inputSchema: normalizeSchema(tool.inputSchema),
        outputSchema: normalizeSchema(tool.outputSchema),
        annotations: Object.assign({}, plainAnnotations(tool.annotations), {
            mcpServerId: server.id,
            mcpServerName: server.name,
            mcpToolName: rawName
        })
    };
}

/**
 * 归一化 JSON Schema（确保为对象且 type 为 object）
 * @param {*} value
 * @returns {Object}
 */
function normalizeSchema(value) {
    const schema = (value && typeof value === 'object' && !Array.isArray(value)) ? value : {};
    return Object.assign({}, schema, {
        type: 'object',
        properties: (schema.properties && typeof schema.properties === 'object') ? schema.properties : {}
    });
}

/**
 * 提取注解中的字符串字段（非字符串 JSON 序列化）
 * @param {*} value
 * @returns {Object}
 */
function plainAnnotations(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const out = {};
    for (const [k, v] of Object.entries(value)) {
        if (v === undefined || v === null) continue;
        out[k] = typeof v === 'string' ? v : JSON.stringify(v);
    }
    return out;
}

/**
 * 归一化 MCP tools/call 结果为内部结果对象
 * @param {Object} result - MCP 返回（content/structuredContent/isError）
 * @param {number} startedAt - 开始时间戳
 * @param {number} [maxBytes] - detail 字节上限
 * @returns {{ ok: boolean, summary: string, detail: string, output: *, isError: boolean, truncated: boolean, startedAt: number, completedAt: number, durationMs: number }}
 */
export function normalizeToolResult(result, startedAt, maxBytes) {
    const completedAt = Date.now();
    const isError = result && result.isError === true;
    const output = normalizeOutput(result);
    const rendered = stringifyOutput(output);
    const detailSource = isError ? extractErrorMessage(result, rendered) : rendered;
    const projection = maxBytes ? truncateUtf8ToByteLimit(detailSource, maxBytes) : { value: detailSource, truncated: false };
    return {
        ok: !isError,
        summary: isError ? 'MCP 工具返回错误' : 'MCP 工具已执行',
        detail: projection.value,
        output,
        isError,
        truncated: projection.truncated,
        startedAt,
        completedAt,
        durationMs: completedAt - startedAt
    };
}

/**
 * 归一化工具输出为可序列化值
 * @param {Object} result - MCP 返回
 * @returns {*} structuredContent 优先，否则 content 数组
 */
function normalizeOutput(result) {
    if (!result) return null;
    if (result.structuredContent !== undefined) return result.structuredContent;
    if (Array.isArray(result.content)) {
        return result.content.map(normalizeContentBlock);
    }
    return null;
}

/**
 * 归一化单个 content block
 * @param {Object} block
 * @returns {Object}
 */
function normalizeContentBlock(block) {
    const out = { type: stringOr(block && block.type, '') || 'unknown' };
    if (!block || typeof block !== 'object') return out;
    for (const [k, v] of Object.entries(block)) {
        if (v !== undefined) out[k] = v;
    }
    return out;
}

/**
 * 从错误结果中提取错误消息
 * @param {Object} result
 * @param {string} fallback
 * @returns {string}
 */
function extractErrorMessage(result, fallback) {
    if (Array.isArray(result.content)) {
        const texts = result.content
            .filter(b => b && b.type === 'text' && typeof b.text === 'string')
            .map(b => b.text);
        if (texts.length > 0) return texts.join('\n');
    }
    if (result.structuredContent && typeof result.structuredContent === 'object') {
        const sc = result.structuredContent;
        if (typeof sc.message === 'string') return sc.message;
        if (typeof sc.error === 'string') return sc.error;
        if (sc.error && typeof sc.error === 'object' && typeof sc.error.message === 'string') {
            return sc.error.message;
        }
    }
    return fallback;
}

/**
 * 将输出值序列化为字符串
 * @param {*} value
 * @returns {string}
 */
function stringifyOutput(value) {
    if (typeof value === 'string') return value;
    try {
        return JSON.stringify(value, null, 2);
    } catch (e) {
        return String(value);
    }
}

/**
 * 取字符串值，非字符串时返回默认值
 * @param {*} value
 * @param {string} fallback
 * @returns {string}
 */
function stringOr(value, fallback) {
    return typeof value === 'string' ? value : fallback;
}
