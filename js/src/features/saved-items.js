/**
 * 收藏夹模块（移植自 deepseek-pp/core/saved-items/）
 *
 * 提供消息片段与书签的增删改查能力，数据持久化到 localStorage。
 * 用作第一个验证 persistence 基础设施可用性的业务模块。
 *
 * 数据模型：
 *   SavedItem { id, syncId, kind, title, content, sourceUrl?, tags[], createdAt, updatedAt }
 *   - kind: 'snippet'（代码/文本片段） | 'bookmark'（书签）
 *   - id/syncId: 均为 UUID，id 本地唯一，syncId 用于未来跨设备同步去重
 *
 * 存储：
 *   key: deepseek_pp_saved_items
 *   value: { schemaVersion: 1, items: SavedItem[] }
 *
 * 排序：按 updatedAt 降序（最近修改的在前）
 */

import { createVersionedRepository, createLocalStorageSlot } from '../persistence/versioned-repository.js';

// ============================================================
// 常量与数据模型
// ============================================================

/** 存储版本号 */
export const SAVED_ITEMS_SCHEMA_VERSION = 1;

/** localStorage 键名 */
export const SAVED_ITEMS_STORAGE_KEY = 'deepseek_pp_saved_items';

/**
 * 创建空状态
 * @returns {{schemaVersion: number, items: Array}}
 */
function createEmptyState() {
    return { schemaVersion: SAVED_ITEMS_SCHEMA_VERSION, items: [] };
}

// ============================================================
// 编解码器
// ============================================================

/**
 * 生成 UUID（优先用浏览器原生，回退到时间戳+随机数）
 * @returns {string}
 */
function generateUuid() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    // 回退方案：时间戳 + 随机数，碰撞概率极低
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

/**
 * 校验并解码单个 SavedItem
 * @param {unknown} value - 原始值
 * @param {string} path - 路径（错误日志用）
 * @returns {SavedItem}
 * @throws {Error} 校验失败时抛出
 */
function decodeSavedItem(value, path) {
    if (!value || typeof value !== 'object') {
        throw new Error(`[saved-items] ${path}: expected object, got ${typeof value}`);
    }
    const item = /** @type {any} */ (value);
    if (typeof item.id !== 'string' || !item.id) {
        throw new Error(`[saved-items] ${path}.id: expected non-empty string`);
    }
    if (typeof item.syncId !== 'string' || !item.syncId) {
        throw new Error(`[saved-items] ${path}.syncId: expected non-empty string`);
    }
    if (item.kind !== 'snippet' && item.kind !== 'bookmark') {
        throw new Error(`[saved-items] ${path}.kind: expected 'snippet' or 'bookmark', got ${item.kind}`);
    }
    if (typeof item.title !== 'string') {
        throw new Error(`[saved-items] ${path}.title: expected string`);
    }
    if (typeof item.content !== 'string') {
        throw new Error(`[saved-items] ${path}.content: expected string`);
    }
    if (item.sourceUrl !== undefined && typeof item.sourceUrl !== 'string') {
        throw new Error(`[saved-items] ${path}.sourceUrl: expected string or undefined`);
    }
    if (!Array.isArray(item.tags) || item.tags.some(t => typeof t !== 'string')) {
        throw new Error(`[saved-items] ${path}.tags: expected string[]`);
    }
    if (typeof item.createdAt !== 'number' || !Number.isFinite(item.createdAt)) {
        throw new Error(`[saved-items] ${path}.createdAt: expected finite number`);
    }
    if (typeof item.updatedAt !== 'number' || !Number.isFinite(item.updatedAt)) {
        throw new Error(`[saved-items] ${path}.updatedAt: expected finite number`);
    }
    return {
        id: item.id,
        syncId: item.syncId,
        kind: item.kind,
        title: item.title,
        content: item.content,
        sourceUrl: item.sourceUrl,
        tags: item.tags.slice(),
        createdAt: item.createdAt,
        updatedAt: item.updatedAt
    };
}

/**
 * 校验并解码 SavedItemsState
 * 兼容两种历史形态：纯数组（旧版）或带 schemaVersion 的对象
 * @param {unknown} value
 * @param {string} path
 * @returns {{schemaVersion: number, items: SavedItem[]}}
 */
function decodeSavedItemsState(value, path) {
    // 兼容旧版纯数组形态
    if (Array.isArray(value)) {
        return {
            schemaVersion: SAVED_ITEMS_SCHEMA_VERSION,
            items: value.map((v, i) => decodeSavedItem(v, `${path}.items[${i}]`))
        };
    }
    if (!value || typeof value !== 'object') {
        throw new Error(`[saved-items] ${path}: expected object or array, got ${typeof value}`);
    }
    const state = /** @type {any} */ (value);
    if (state.schemaVersion !== SAVED_ITEMS_SCHEMA_VERSION) {
        throw new Error(`[saved-items] ${path}.schemaVersion: expected ${SAVED_ITEMS_SCHEMA_VERSION}, got ${state.schemaVersion}`);
    }
    if (!Array.isArray(state.items)) {
        throw new Error(`[saved-items] ${path}.items: expected array`);
    }
    return {
        schemaVersion: SAVED_ITEMS_SCHEMA_VERSION,
        items: state.items.map((v, i) => decodeSavedItem(v, `${path}.items[${i}]`))
    };
}

/** 编解码器实例 */
const codec = {
    decode: decodeSavedItemsState,
    encode: (state) => decodeSavedItemsState(state, 'encode')
};

// ============================================================
// 仓库实例
// ============================================================

const repository = createVersionedRepository({
    label: 'saved-items',
    createDefault: createEmptyState,
    codec,
    storage: createLocalStorageSlot(SAVED_ITEMS_STORAGE_KEY)
});

// ============================================================
// 对外 API
// ============================================================

/**
 * 读取全部收藏项（按 updatedAt 降序）
 * @returns {Promise<SavedItem[]>}
 */
export async function getAllSavedItems() {
    const state = await repository.read();
    // 防御性排序：存储时已保证降序，读取时再排一次以防外部修改
    return state.items.slice().sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * 保存收藏项（新增或更新）
 *
 * 行为：
 *   - input.id 已存在 → 更新（updatedAt 刷新为当前时间）
 *   - input.id 不存在或未提供 → 新增（自动生成 id/syncId/createdAt/updatedAt）
 *
 * @param {Object} input - 输入项
 * @param {string} [input.id] - 已有 id（更新时传入）
 * @param {string} input.kind - 'snippet' | 'bookmark'
 * @param {string} input.title - 标题
 * @param {string} input.content - 内容
 * @param {string} [input.sourceUrl] - 来源 URL
 * @param {string[]} [input.tags=[]] - 标签
 * @returns {Promise<SavedItem>} 保存后的项（含完整字段）
 */
export async function saveSavedItem(input) {
    const state = await repository.read();
    const now = Date.now();

    /** @type {SavedItem|null} */
    let existing = null;
    if (input.id) {
        existing = state.items.find(i => i.id === input.id) || null;
    }

    if (existing) {
        // 更新：保留 id/syncId/createdAt，刷新其他字段
        const updated = {
            ...existing,
            kind: input.kind,
            title: input.title,
            content: input.content,
            sourceUrl: input.sourceUrl,
            tags: Array.isArray(input.tags) ? input.tags.slice() : [],
            updatedAt: now
        };
        const idx = state.items.findIndex(i => i.id === existing.id);
        state.items[idx] = updated;
        await repository.replaceAlreadyLocked(state);
        return updated;
    } else {
        // 新增
        const item = {
            id: generateUuid(),
            syncId: generateUuid(),
            kind: input.kind,
            title: input.title,
            content: input.content,
            sourceUrl: input.sourceUrl,
            tags: Array.isArray(input.tags) ? input.tags.slice() : [],
            createdAt: now,
            updatedAt: now
        };
        state.items.push(item);
        // 保持降序
        state.items.sort((a, b) => b.updatedAt - a.updatedAt);
        await repository.replaceAlreadyLocked(state);
        return item;
    }
}

/**
 * 删除收藏项
 * @param {string} id - 要删除的项 id
 * @returns {Promise<void>}
 */
export async function deleteSavedItem(id) {
    const state = await repository.read();
    const idx = state.items.findIndex(i => i.id === id);
    if (idx === -1) return; // 不存在直接返回，幂等
    state.items.splice(idx, 1);
    await repository.replaceAlreadyLocked(state);
}

/**
 * 按关键词搜索收藏项（匹配 title/content/tags）
 * @param {string} keyword - 搜索关键词
 * @returns {Promise<SavedItem[]>}
 */
export async function searchSavedItems(keyword) {
    const items = await getAllSavedItems();
    if (!keyword) return items;
    const kw = keyword.toLowerCase();
    return items.filter(i =>
        i.title.toLowerCase().includes(kw) ||
        i.content.toLowerCase().includes(kw) ||
        i.tags.some(t => t.toLowerCase().includes(kw))
    );
}
