/**
 * @file snapshot.js
 * @module features/sync/snapshot
 *
 * 同步快照模块
 *
 * 定义同步快照的数据结构与代次（generation）机制：
 *   - 每次上传生成新代次（generation number，单调递增），用于版本管理与历史回溯
 *   - 快照包含本地各 store 的数据：memories / skills / presets / projects / savedItems
 *   - checksum：对 items JSON 取 SHA-256（Web Crypto API），用于传输完整性校验
 *
 * 快照结构：
 *   {
 *     generation: number,       // 代次（单调递增）
 *     timestamp: number,        // 创建时间戳（毫秒）
 *     items: {
 *       memories: Array,        // 记忆数组
 *       skills: Array,          // 技能数组（仅 custom 源）
 *       presets: Array,         // 系统提示词预设数组
 *       projects: Array,        // 项目数组（预留，当前为空）
 *       savedItems: Array       // 收藏项数组
 *     },
 *     checksum: string          // 64 位十六进制 SHA-256
 *   }
 *
 * 密码安全：snapshot 仅包含业务数据，绝不包含同步配置（server/username/password）。
 * checksum 校验失败时视为传输损坏，apply-journal 会拒绝应用。
 */

// ============================================================
// SHA-256 工具
// ============================================================

/**
 * 计算字符串的 SHA-256 哈希（返回十六进制字符串）
 * 使用 Web Crypto API 的 crypto.subtle.digest
 * @param {string} content - 原始字符串
 * @returns {Promise<string>} 64 位十六进制哈希字符串
 * @throws {Error} Web Crypto API 不可用时抛出
 */
async function sha256Hex(content) {
    if (typeof crypto === 'undefined' || !crypto.subtle) {
        throw new Error('Web Crypto API 不可用，无法计算 SHA-256');
    }
    const bytes = new TextEncoder().encode(content);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

// ============================================================
// 快照创建与校验
// ============================================================

/**
 * 创建一个同步快照
 *
 * 流程：
 *   1. 规范化 items 字段（缺失字段补空数组）
 *   2. 设置 generation（代次）与 timestamp（时间戳）
 *   3. 对 items JSON 计算 SHA-256 checksum
 *
 * @param {Object} localData - 本地各 store 收集的数据
 * @param {Array} localData.memories - 记忆数组
 * @param {Array} localData.skills - 技能数组（仅 custom 源）
 * @param {Array} localData.presets - 预设数组
 * @param {Array} [localData.projects] - 项目数组（无 store 时为空数组）
 * @param {Array} [localData.savedItems] - 收藏项数组
 * @param {number} generation - 代次号（单调递增，由 coordinator 传入）
 * @returns {Promise<Object>} 快照对象，含 generation/timestamp/items/checksum
 */
export async function createSnapshot(localData, generation) {
    const items = {
        memories: Array.isArray(localData.memories) ? localData.memories : [],
        skills: Array.isArray(localData.skills) ? localData.skills : [],
        presets: Array.isArray(localData.presets) ? localData.presets : [],
        projects: Array.isArray(localData.projects) ? localData.projects : [],
        savedItems: Array.isArray(localData.savedItems) ? localData.savedItems : []
    };
    const snapshot = {
        generation: typeof generation === 'number' ? generation : 0,
        timestamp: Date.now(),
        items
    };
    snapshot.checksum = await sha256Hex(JSON.stringify(items));
    return snapshot;
}

/**
 * 校验快照的 checksum 是否与 items 内容匹配
 * 用于下载后确认传输完整性
 * @param {Object} snapshot - 待校验的快照对象
 * @returns {Promise<boolean>} checksum 匹配返回 true；结构无效或校验失败返回 false
 */
export async function verifySnapshot(snapshot) {
    if (!snapshot || !snapshot.items || typeof snapshot.checksum !== 'string') {
        return false;
    }
    try {
        const actual = await sha256Hex(JSON.stringify(snapshot.items));
        return actual === snapshot.checksum;
    } catch (e) {
        return false;
    }
}

/**
 * 将快照序列化为字符串（用于网络传输与存储）
 * @param {Object} snapshot - 快照对象
 * @returns {string} JSON 字符串
 */
export function serializeSnapshot(snapshot) {
    return JSON.stringify(snapshot);
}

/**
 * 将字符串反序列化为快照对象
 * 仅做 JSON 解析与基本结构校验，不做 checksum 校验
 * （checksum 校验请显式调用 verifySnapshot）
 * @param {string} str - JSON 字符串
 * @returns {Object|null} 快照对象；解析失败或结构无效返回 null
 */
export function deserializeSnapshot(str) {
    try {
        const obj = JSON.parse(str);
        if (!obj || typeof obj !== 'object') return null;
        if (typeof obj.generation !== 'number') return null;
        if (typeof obj.timestamp !== 'number') return null;
        if (!obj.items || typeof obj.items !== 'object') return null;
        if (typeof obj.checksum !== 'string') return null;
        return obj;
    } catch (e) {
        return null;
    }
}
