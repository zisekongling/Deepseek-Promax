/**
 * @file store.js
 * @module mcp/store
 *
 * MCP 服务配置持久化层
 *
 * 职责：
 *   - 在 localStorage（key: ds_mcp_servers）中存储 MCP 服务配置列表
 *   - 提供 CRUD：listServers / getServer / saveServer / deleteServer
 *   - 提供健康状态更新：updateServerHealth
 *   - 提供工具缓存：cacheTools（持久化最近一次发现的工具列表）
 *
 * 服务配置结构：
 *   {
 *     id: string,                  // 唯一标识（UUID）
 *     name: string,                // 显示名称
 *     transport: 'http'|'sse'|'streamable', // 传输类型
 *     url: string,                 // 服务端点 URL
 *     headers: Array<{name, value}>, // 自定义请求头
 *     token: string,               // Bearer token（明文存储，油猴环境无加密沙箱）
 *     enabled: boolean,            // 是否启用
 *     visible: 'direct'|'adaptive'|'on-demand', // 工具投影模式
 *     lastDiscovered: number|null, // 最近一次发现时间戳
 *     tools: Array,                // 缓存的工具描述符
 *     health: 'unknown'|'ok'|'error', // 健康状态
 *     lastError: string|null,      // 最近错误消息
 *     createdAt: number,           // 创建时间
 *     updatedAt: number            // 更新时间
 *   }
 *
 * 参考实现：deepseek-pp/core/mcp/store.ts（同步策略改为 localStorage，无 chrome.storage）
 */

/** localStorage 键名 */
const STORAGE_KEY = 'ds_mcp_servers';

/** 有效的传输类型 */
const VALID_TRANSPORTS = ['http', 'sse', 'streamable'];

/** 有效的投影模式 */
const VALID_VISIBILITIES = ['direct', 'adaptive', 'on-demand'];

/** 有效的健康状态 */
const VALID_HEALTH = ['unknown', 'ok', 'error'];

/**
 * 从 localStorage 读取原始状态
 * @returns {{ servers: Array }} 持久化状态对象
 */
function readState() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return { servers: [] };
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.servers)) {
            return { servers: [] };
        }
        return { servers: parsed.servers };
    } catch (e) {
        return { servers: [] };
    }
}

/**
 * 将状态写入 localStorage
 * @param {{ servers: Array }} state - 待写入状态
 */
function writeState(state) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
        // 写入失败（如配额超限）静默忽略，避免阻断主流程
    }
}

/**
 * 生成唯一 ID（UUID v4 降级方案）
 * @returns {string}
 */
function generateId() {
    try {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
            return crypto.randomUUID();
        }
    } catch (e) {}
    // 降级：基于时间戳 + 随机数
    return 'mcp-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

/**
 * 归一化服务配置（校验字段、补齐默认值）
 * @param {Object} raw - 原始配置
 * @param {boolean} [isNew] - 是否为新创建（决定是否生成 id/createdAt）
 * @returns {Object} 归一化后的配置
 */
function normalizeServer(raw, isNew) {
    const value = (raw && typeof raw === 'object') ? raw : {};
    const now = Date.now();
    const transport = VALID_TRANSPORTS.indexOf(value.transport) >= 0 ? value.transport : 'streamable';
    const visible = VALID_VISIBILITIES.indexOf(value.visible) >= 0 ? value.visible : 'direct';
    const health = VALID_HEALTH.indexOf(value.health) >= 0 ? value.health : 'unknown';
    return {
        id: typeof value.id === 'string' && value.id ? value.id : (isNew ? generateId() : generateId()),
        name: typeof value.name === 'string' ? value.name.trim() : '',
        transport,
        url: typeof value.url === 'string' ? value.url.trim() : '',
        headers: Array.isArray(value.headers) ? value.headers.filter(h => h && typeof h.name === 'string').map(h => ({
            name: String(h.name),
            value: String(h.value || '')
        })) : [],
        token: typeof value.token === 'string' ? value.token : '',
        enabled: value.enabled !== false,
        visible,
        lastDiscovered: typeof value.lastDiscovered === 'number' ? value.lastDiscovered : null,
        tools: Array.isArray(value.tools) ? value.tools : [],
        health,
        lastError: typeof value.lastError === 'string' ? value.lastError : null,
        createdAt: typeof value.createdAt === 'number' ? value.createdAt : now,
        updatedAt: now
    };
}

// ============================================================
// 对外 API
// ============================================================

/**
 * 列出所有 MCP 服务配置（按更新时间倒序）
 * @returns {Array<Object>} 服务配置数组（浅拷贝）
 */
export function listServers() {
    const state = readState();
    return state.servers
        .slice()
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
        .map(s => Object.assign({}, s));
}

/**
 * 按 ID 获取单个服务配置
 * @param {string} id - 服务 ID
 * @returns {Object|null} 配置对象（浅拷贝）；未找到返回 null
 */
export function getServer(id) {
    if (!id) return null;
    const state = readState();
    const server = state.servers.find(s => s.id === id);
    return server ? Object.assign({}, server) : null;
}

/**
 * 保存（创建或更新）服务配置
 * @param {Object} config - 服务配置（含 id 则更新，无 id 则创建）
 * @returns {Object} 保存后的配置
 */
export function saveServer(config) {
    const state = readState();
    const now = Date.now();
    const normalized = normalizeServer(config || {}, false);
    // 若 config 带 id 且存在，则更新；否则视为新建（normalize 已确保有 id）
    const existingIdx = state.servers.findIndex(s => s.id === normalized.id);
    if (existingIdx >= 0) {
        // 更新：保留 createdAt
        normalized.createdAt = state.servers[existingIdx].createdAt || now;
        normalized.updatedAt = now;
        state.servers[existingIdx] = normalized;
    } else {
        // 新建：若调用方未提供 id，normalize 已生成；确保 createdAt
        if (!config || !config.id) {
            normalized.createdAt = now;
        }
        normalized.updatedAt = now;
        state.servers.push(normalized);
    }
    writeState(state);
    return Object.assign({}, normalized);
}

/**
 * 删除服务配置
 * @param {string} id - 服务 ID
 * @returns {boolean} 是否删除成功
 */
export function deleteServer(id) {
    if (!id) return false;
    const state = readState();
    const before = state.servers.length;
    state.servers = state.servers.filter(s => s.id !== id);
    if (state.servers.length === before) return false;
    writeState(state);
    return true;
}

/**
 * 更新服务健康状态
 * @param {string} id - 服务 ID
 * @param {'unknown'|'ok'|'error'} health - 健康状态
 * @param {string} [error] - 错误消息（health=error 时记录）
 * @returns {Object|null} 更新后的配置
 */
export function updateServerHealth(id, health, error) {
    if (!id) return null;
    const validHealth = VALID_HEALTH.indexOf(health) >= 0 ? health : 'unknown';
    const state = readState();
    let updated = null;
    state.servers = state.servers.map(s => {
        if (s.id !== id) return s;
        updated = Object.assign({}, s, {
            health: validHealth,
            lastError: validHealth === 'error' ? (error || s.lastError || null) : null,
            updatedAt: Date.now()
        });
        return updated;
    });
    if (!updated) return null;
    writeState(state);
    return Object.assign({}, updated);
}

/**
 * 缓存服务发现的工具列表
 * @param {string} id - 服务 ID
 * @param {Array} tools - 工具描述符数组
 * @returns {Object|null} 更新后的配置
 */
export function cacheTools(id, tools) {
    if (!id) return null;
    const state = readState();
    let updated = null;
    state.servers = state.servers.map(s => {
        if (s.id !== id) return s;
        updated = Object.assign({}, s, {
            tools: Array.isArray(tools) ? tools : [],
            lastDiscovered: Date.now(),
            updatedAt: Date.now()
        });
        return updated;
    });
    if (!updated) return null;
    writeState(state);
    return Object.assign({}, updated);
}

/**
 * 清空所有 MCP 服务配置（重置）
 * 主要用于测试或用户主动重置；调用方应明确确认
 * @returns {boolean} 是否成功
 */
export function clearAllServers() {
    try {
        localStorage.removeItem(STORAGE_KEY);
        return true;
    } catch (e) {
        return false;
    }
}

/**
 * 导出归一化辅助函数（供 client.js 复用）
 * @param {Object} raw - 原始配置
 * @returns {Object} 归一化后的配置
 */
export function normalizeServerConfig(raw) {
    return normalizeServer(raw, false);
}

/**
 * 生成新 ID（供 client.js 在创建服务时使用）
 * @returns {string}
 */
export function newServerId() {
    return generateId();
}

/**
 * 校验传输类型是否合法
 * @param {string} transport
 * @returns {boolean}
 */
export function isValidTransport(transport) {
    return VALID_TRANSPORTS.indexOf(transport) >= 0;
}
