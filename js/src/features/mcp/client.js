/**
 * @file client.js
 * @module mcp/client
 *
 * MCP 客户端协调层
 *
 * 职责：
 *   - 声明 CONFIG 新增键的默认值常量（实际 config.js 集成在 Phase 6）
 *   - 根据服务配置选择传输层（http / sse / streamable）
 *   - discoverServer(id) → 调传输 discover，缓存工具到 store，更新健康状态
 *   - callTool(serverId, toolName, args) → 调传输 callTool，应用超时与结果大小限制
 *   - testConnection(id) → 轻量健康检查（initialize 握手）
 *   - initMcp() 幂等初始化
 *
 * CONFIG 新增键（默认值声明在此，Phase 6 由 config.js 集成覆盖）：
 *   - mcpEnabled        (boolean, 默认 false)
 *   - mcpPromptBudget   (number,  默认 10)
 *   - mcpCallTimeout    (number,  默认 60000)   工具调用超时（毫秒）
 *   - mcpResultMaxBytes (number,  默认 102400)  结果大小上限（100KB）
 *
 * 参考实现：deepseek-pp/core/mcp/client.ts + discovery.ts
 */

import { CONFIG as _CONFIG_SNAPSHOT } from '../../config.js';
import {
    getServer,
    saveServer,
    deleteServer,
    listServers,
    updateServerHealth,
    cacheTools
} from './store.js';
import { createHttpTransport } from './transports/http.js';
import { createSseTransport } from './transports/sse.js';
import { createStreamableHttpTransport } from './transports/streamable.js';
import { McpTransportError } from './transports/common.js';

// ============================================================
// CONFIG 新增键默认值（Phase 6 集成到 config.js）
// ============================================================

/** MCP 总开关 */
export const MCP_DEFAULTS = Object.freeze({
    /** MCP 总开关（默认关闭，需用户显式启用） */
    mcpEnabled: false,
    /** 每服务投影到 prompt 的工具数预算 */
    mcpPromptBudget: 10,
    /** 工具调用超时（毫秒） */
    mcpCallTimeout: 60000,
    /** 工具结果大小上限（字节，100KB） */
    mcpResultMaxBytes: 102400
});

/**
 * 安全获取最新 CONFIG 引用
 * 优先 window.__dsConfig（动态），回退到模块导入快照
 * @returns {Object}
 */
function _getConfigSafe() {
    try {
        if (typeof window !== 'undefined' && window.__dsConfig) {
            return window.__dsConfig;
        }
    } catch (e) {}
    return _CONFIG_SNAPSHOT;
}

/**
 * 获取 MCP 相关配置（合并 CONFIG 与默认值）
 * @returns {{ mcpEnabled: boolean, mcpPromptBudget: number, mcpCallTimeout: number, mcpResultMaxBytes: number }}
 */
export function getMcpConfig() {
    const cfg = _getConfigSafe() || {};
    return {
        mcpEnabled: typeof cfg.mcpEnabled === 'boolean' ? cfg.mcpEnabled : MCP_DEFAULTS.mcpEnabled,
        mcpPromptBudget: typeof cfg.mcpPromptBudget === 'number' && cfg.mcpPromptBudget > 0 ? cfg.mcpPromptBudget : MCP_DEFAULTS.mcpPromptBudget,
        mcpCallTimeout: typeof cfg.mcpCallTimeout === 'number' && cfg.mcpCallTimeout > 0 ? cfg.mcpCallTimeout : MCP_DEFAULTS.mcpCallTimeout,
        mcpResultMaxBytes: typeof cfg.mcpResultMaxBytes === 'number' && cfg.mcpResultMaxBytes > 0 ? cfg.mcpResultMaxBytes : MCP_DEFAULTS.mcpResultMaxBytes
    };
}

// ============================================================
// 传输实例缓存
// ============================================================

/** @type {Map<string, { transport: Object, serverId: string, updatedAt: number }>} */
const _transportCache = new Map();

/**
 * 根据服务配置选择并创建传输层实例
 * 按 server.transport 创建对应类型；缓存实例以复用握手状态
 *
 * @param {Object} server - 服务配置
 * @returns {Object} 传输层实例
 */
export function createTransport(server) {
    if (!server || !server.id) {
        throw new McpTransportError('mcp_server_invalid', 'MCP server config is missing id.', { retryable: false });
    }
    const cached = _transportCache.get(server.id);
    // 配置未变更时复用缓存实例（避免重复 initialize）
    if (cached && cached.updatedAt === server.updatedAt) {
        return cached.transport;
    }
    let transport;
    switch (server.transport) {
        case 'http':
            transport = createHttpTransport();
            break;
        case 'sse':
            transport = createSseTransport();
            break;
        case 'streamable':
            transport = createStreamableHttpTransport();
            break;
        default:
            throw new McpTransportError(
                'mcp_transport_unsupported',
                `Unsupported MCP transport: ${server.transport}`,
                { retryable: false }
            );
    }
    _transportCache.set(server.id, { transport, serverId: server.id, updatedAt: server.updatedAt });
    return transport;
}

/**
 * 使传输实例缓存失效（服务配置变更后调用）
 * @param {string} serverId - 服务 ID
 */
export function invalidateTransport(serverId) {
    if (!serverId) return;
    const cached = _transportCache.get(serverId);
    if (cached && typeof cached.transport.cleanup === 'function') {
        try { cached.transport.cleanup(); } catch (e) {}
    }
    _transportCache.delete(serverId);
}

/**
 * 内部：检查 MCP 是否启用，未启用时抛错
 * @throws {Error} mcpEnabled 为 false 时抛错
 */
function _ensureEnabled() {
    const cfg = getMcpConfig();
    if (!cfg.mcpEnabled) {
        throw new McpTransportError('mcp_disabled', 'MCP is not enabled. Enable mcpEnabled in config.', { retryable: false });
    }
}

/**
 * 内部：加载并校验服务配置
 * @param {string} serverId - 服务 ID
 * @param {boolean} [requireEnabled=true] - 是否要求服务已启用
 * @returns {Object} 服务配置
 * @throws {McpTransportError} 服务不存在或未启用
 */
function _loadServer(serverId, requireEnabled) {
    const server = getServer(serverId);
    if (!server) {
        throw new McpTransportError('mcp_server_not_found', `MCP server not found: ${serverId}`, { retryable: false });
    }
    if (requireEnabled !== false && !server.enabled) {
        throw new McpTransportError('mcp_server_disabled', `MCP server is disabled: ${serverId}`, { retryable: false });
    }
    return server;
}

// ============================================================
// 核心操作
// ============================================================

/**
 * 发现服务工具：调传输 discover，缓存工具到 store，更新健康状态
 * @param {string} serverId - 服务 ID
 * @param {Object} [options] - { forceRefresh?, timeoutMs?, maxBytes? }
 * @returns {Promise<{ tools: Array, protocolVersion: string, serverInfo?: Object }>}
 */
export async function discoverServer(serverId, options) {
    _ensureEnabled();
    const server = _loadServer(serverId);
    const cfg = getMcpConfig();
    const timeoutMs = (options && options.timeoutMs) || cfg.mcpCallTimeout;
    const maxBytes = (options && options.maxBytes) || cfg.mcpResultMaxBytes;

    // 未强制刷新且缓存有效（最近 5 分钟发现过）时直接返回缓存
    if (!options || !options.forceRefresh) {
        const cacheAge = server.lastDiscovered ? (Date.now() - server.lastDiscovered) : Infinity;
        if (cacheAge < 5 * 60 * 1000 && Array.isArray(server.tools) && server.tools.length >= 0 && server.health === 'ok') {
            return {
                tools: server.tools,
                protocolVersion: '',
                serverInfo: undefined
            };
        }
    }

    const transport = createTransport(server);
    const startedAt = Date.now();
    try {
        const result = await transport.discover(server, { timeoutMs, maxBytes });
        cacheTools(serverId, result.tools || []);
        updateServerHealth(serverId, 'ok');
        return {
            tools: result.tools || [],
            protocolVersion: result.protocolVersion,
            serverInfo: result.serverInfo
        };
    } catch (err) {
        updateServerHealth(serverId, 'error', (err && err.message) || String(err));
        // 缓存失效，丢弃传输实例（下次重新握手）
        invalidateTransport(serverId);
        throw err;
    }
}

/**
 * 调用工具：调传输 callTool，应用超时与结果大小限制
 * @param {string} serverId - 服务 ID
 * @param {string} toolName - 工具名（MCP 原始名）
 * @param {Object} args - 工具参数
 * @param {Object} [options] - { timeoutMs?, maxBytes? }
 * @returns {Promise<{ ok: boolean, summary: string, detail?: string, output?: *, isError?: boolean, truncated?: boolean }>}
 */
export async function callTool(serverId, toolName, args, options) {
    _ensureEnabled();
    const server = _loadServer(serverId);
    const cfg = getMcpConfig();
    const timeoutMs = (options && options.timeoutMs) || cfg.mcpCallTimeout;
    const maxBytes = (options && options.maxBytes) || cfg.mcpResultMaxBytes;

    if (!toolName || typeof toolName !== 'string') {
        return {
            ok: false,
            summary: '工具调用参数错误',
            detail: 'toolName 必须是非空字符串',
            isError: true,
            truncated: false
        };
    }

    const transport = createTransport(server);
    try {
        const result = await transport.callTool(server, toolName, args || {}, { timeoutMs, maxBytes });
        // 工具调用失败时更新健康状态为 error（仅对传输层错误，非工具 isError）
        if (!result.ok && result.error && result.error.code && result.error.code.indexOf('mcp_') === 0) {
            updateServerHealth(serverId, 'error', result.error.message);
            invalidateTransport(serverId);
        }
        return result;
    } catch (err) {
        // 传输层异常：更新健康状态并丢弃传输实例
        updateServerHealth(serverId, 'error', (err && err.message) || String(err));
        invalidateTransport(serverId);
        return {
            ok: false,
            summary: 'MCP 工具调用失败',
            detail: (err && err.message) || String(err),
            isError: true,
            truncated: false,
            error: {
                code: (err && err.code) || 'mcp_tool_call_failed',
                message: (err && err.message) || String(err),
                retryable: err && err.retryable !== undefined ? err.retryable : true
            }
        };
    }
}

/**
 * 测试连接：轻量 initialize 握手，更新健康状态
 * @param {string} serverId - 服务 ID
 * @param {Object} [options] - { timeoutMs? }
 * @returns {Promise<{ ok: boolean, health: string, latencyMs: number, serverInfo?: Object, error?: string }>}
 */
export async function testConnection(serverId, options) {
    const server = _loadServer(serverId, false);
    const cfg = getMcpConfig();
    const timeoutMs = (options && options.timeoutMs) || Math.min(cfg.mcpCallTimeout, 15000); // 健康检查超时上限 15s
    const startedAt = Date.now();

    // 总是新建传输实例（测试连接不依赖缓存）
    invalidateTransport(serverId);
    const transport = createTransport(server);
    try {
        // 用 discover（initialize + tools/list）作为连通性 + 能力验证
        const result = await transport.discover(server, { timeoutMs, maxBytes: cfg.mcpResultMaxBytes });
        const latencyMs = Date.now() - startedAt;
        cacheTools(serverId, result.tools || []);
        updateServerHealth(serverId, 'ok');
        return {
            ok: true,
            health: 'ok',
            latencyMs,
            serverInfo: result.serverInfo,
            toolCount: (result.tools || []).length
        };
    } catch (err) {
        const latencyMs = Date.now() - startedAt;
        const msg = (err && err.message) || String(err);
        updateServerHealth(serverId, 'error', msg);
        invalidateTransport(serverId);
        return {
            ok: false,
            health: 'error',
            latencyMs,
            error: msg,
            code: (err && err.code) || 'mcp_test_failed'
        };
    }
}

/**
 * 列出所有已启用服务的工具描述符（合并所有服务缓存）
 * @param {Object} [options] - { includeDisabled? }
 * @returns {Array<{ server: Object, tool: Object }>} 服务-工具对数组
 */
export function listAllTools(options) {
    const includeDisabled = options && options.includeDisabled;
    const servers = listServers();
    const result = [];
    for (const server of servers) {
        if (!includeDisabled && !server.enabled) continue;
        if (!Array.isArray(server.tools)) continue;
        for (const tool of server.tools) {
            result.push({ server, tool });
        }
    }
    return result;
}

// ============================================================
// 服务管理（透传 store，便于配置变更后失效传输缓存）
// ============================================================

/**
 * 保存服务配置（透传 store.saveServer，并在配置变更时失效传输缓存）
 * @param {Object} config - 服务配置
 * @returns {Object} 保存后的配置
 */
export function saveMcpServer(config) {
    const saved = saveServer(config);
    // 配置变更（含新建）后失效传输缓存，确保下次用最新配置握手
    invalidateTransport(saved.id);
    return saved;
}

/**
 * 删除服务配置（透传 store.deleteServer，并清理传输缓存）
 * @param {string} id - 服务 ID
 * @returns {boolean} 是否删除成功
 */
export function deleteMcpServer(id) {
    invalidateTransport(id);
    return deleteServer(id);
}

// ============================================================
// 初始化
// ============================================================

/** 模块是否已初始化 */
let _initialized = false;

/**
 * 初始化 MCP 模块（幂等）
 *
 * 执行：
 *   1. 标记已初始化（幂等保护）
 *   2. 暴露 MCP 接口到 window（供其他模块跨 ESM 边界调用）
 *
 * 不在此处自动发现工具（避免未配置服务时产生网络请求）；
 * 工具发现由 capability-projection 或用户操作显式触发
 *
 * @returns {boolean} 是否首次初始化
 */
export function initMcp() {
    if (_initialized) return false;
    _initialized = true;

    if (typeof window !== 'undefined') {
        // 暴露 MCP 接口（与 capability-register.js 的 window._ds* 模式一致）
        window._dsMcp = {
            discoverServer,
            callTool,
            testConnection,
            listAllTools,
            listServers,
            getServer,
            saveServer: saveMcpServer,
            deleteServer: deleteMcpServer,
            getMcpConfig,
            createTransport,
            invalidateTransport
        };
    }
    return true;
}

/**
 * 重置模块初始化状态（仅用于测试）
 */
export function _resetInit() {
    _initialized = false;
}
