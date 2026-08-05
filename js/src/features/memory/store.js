/**
 * @module features/memory/store
 *
 * 记忆数据层（工厂模式）。
 *
 * 抽出目的（P4 重构）：
 *   - 将原 memory.js 的存储/缓存/防重删逻辑改为工厂函数 createMemoryStore
 *   - 支持项目隔离：不同 storageKey / scope 创建独立 store，互不污染
 *   - segmentCache 改为 store 实例属性（非模块级），避免多 store 互相污染
 *   - 防重删机制（DELETED_IDS / SIGS）按 store 隔离，每个 store 维护自己的已删除集合
 *
 * 对外 API：
 *   createMemoryStore(options) 返回 store 实例，包含以下方法：
 *     - getAll() / addMemory(...) / updateMemory(...) / deleteMemory(...) /
 *       mergeMemories(...) / replaceMemory(...) / clearMemoriesByScope(...) /
 *       archiveStaleMemories(...) / findMemoryById(...) / getMemoryById(...) /
 *       isMemoryDeleted(...) / touchMemories(...) /
 *       toggleMemory(...) / togglePinMemory(...) / exportMemories(...) /
 *       findSimilarMemory(...) / flush()
 *   实例属性：
 *     - segmentCache：分词缓存 Map（供 selector 复用，实例隔离）
 *     - storageKey / scope：只读配置
 */

import { VALID_CATEGORIES } from './schema.js';
import { findSimilarMemory as _selectorFindSimilar } from './selector.js';

/** 默认 localStorage 存储键名 */
const DEFAULT_STORAGE_KEY = 'ds_memories';

/** 默认作用域 */
const DEFAULT_SCOPE = 'global';

/** 已删除记忆 ID 集合的存储键名后缀（用于防止历史消息重新加载时被重新保存） */
const DELETED_IDS_SUFFIX = '_deleted_ids';

/** 已删除记忆内容签名的存储键名后缀（用于无 ID 场景的去重） */
const DELETED_SIGS_SUFFIX = '_deleted_sigs';

/** 防抖写入间隔（毫秒） */
const WRITE_DEBOUNCE_MS = 300;

/** 已删除集合最大容量（防止无限增长，LRU 淘汰） */
const DELETED_SET_LIMIT = 1000;

/** 归档阈值：90 天未访问 */
const STALE_THRESHOLD_DAYS = 90;
/** 归档阈值：访问次数低于此值 */
const MIN_ACCESS_FOR_RETENTION = 3;

/**
 * 创建记忆存储实例
 *
 * @param {Object} [options] - 创建选项
 * @param {string} [options.storageKey='ds_memories'] - localStorage 存储键名
 * @param {string} [options.scope='global'] - 默认作用域（global/project）
 * @returns {Object} store 实例
 */
export function createMemoryStore(options = {}) {
    const storageKey = options.storageKey || DEFAULT_STORAGE_KEY;
    const scope = options.scope || DEFAULT_SCOPE;
    const deletedIdsStorageKey = storageKey + DELETED_IDS_SUFFIX;
    const deletedSigsStorageKey = storageKey + DELETED_SIGS_SUFFIX;

    /** 分词缓存（LRU）：text -> words[]，实例隔离避免多 store 互相污染 */
    const segmentCache = new Map();

    // ============================================================
    // 内存缓存状态
    // ============================================================

    /** 记忆列表内存缓存 + 防抖写入 */
    let _cacheMemories = null;
    let _cacheDirty = true;
    let _writeTimer = null;

    /** 已删除 ID 集合（内存缓存）+ 防抖写入 */
    let _cacheDeletedIds = null;
    let _cacheDeletedSigs = null;
    let _deletedWriteTimer = null;

    // ============================================================
    // 内部工具函数
    // ============================================================

    /**
     * 迁移单条记忆记录：补充 v2 新增字段（tags/pinned/accessCount/lastAccessedAt/scope）
     * 兼容旧版只有 category 字段的记录
     * @param {Object} m - 原始记忆对象
     * @returns {Object|null} 迁移后的记忆对象
     */
    function _migrateMemory(m) {
        if (!m || typeof m !== 'object') return null;
        const now = Date.now();
        return {
            id: m.id || ('mem-' + now),
            title: m.title || '',
            content: m.content || '',
            category: VALID_CATEGORIES.includes(m.category) ? m.category : 'preference',
            tags: Array.isArray(m.tags) ? m.tags : [],
            pinned: !!m.pinned,
            enabled: m.enabled !== false,
            scope: m.scope === 'project' ? 'project' : 'global',
            createdAt: m.createdAt || now,
            updatedAt: m.updatedAt || now,
            accessCount: typeof m.accessCount === 'number' ? m.accessCount : 0,
            lastAccessedAt: m.lastAccessedAt || m.updatedAt || m.createdAt || now,
            history: Array.isArray(m.history) ? m.history : []
        };
    }

    /**
     * 从 localStorage 读取全部记忆（带内存缓存）
     * 同时做向后兼容迁移
     * @returns {Array<Object>} 记忆数组
     */
    function _loadMemories() {
        if (!_cacheDirty && _cacheMemories) return _cacheMemories;
        try {
            const raw = localStorage.getItem(storageKey);
            if (!raw) {
                _cacheMemories = [];
            } else {
                const arr = JSON.parse(raw);
                _cacheMemories = Array.isArray(arr) ? arr.map(_migrateMemory).filter(Boolean) : [];
            }
        } catch (e) {
            _cacheMemories = [];
        }
        _cacheDirty = false;
        return _cacheMemories;
    }

    /**
     * 防抖异步写入：将内存中的记忆刷新到 localStorage
     */
    function _scheduleSave() {
        if (_writeTimer) return;
        _writeTimer = setTimeout(() => {
            _writeTimer = null;
            try {
                localStorage.setItem(storageKey, JSON.stringify(_cacheMemories || []));
            } catch (e) {}
        }, WRITE_DEBOUNCE_MS);
    }

    /**
     * 将记忆数组写入内存缓存并触发防抖写入
     * @param {Array<Object>} memories - 记忆数组
     */
    function _saveMemories(memories) {
        _cacheMemories = memories;
        _cacheDirty = false;
        _scheduleSave();
    }

    /**
     * 计算记忆内容签名（标题+内容归一化）
     * 用于无 ID 场景下的已删除记忆识别
     * @param {string} title - 记忆标题
     * @param {string} content - 记忆内容
     * @returns {string} 内容签名字符串
     */
    function _contentSignature(title, content) {
        return (title || '').trim().toLowerCase() + '|' + (content || '').trim().toLowerCase();
    }

    /**
     * 加载已删除 ID 集合（带内存缓存）
     * @returns {Set<string>} 已删除 ID 集合
     */
    function _loadDeletedIds() {
        if (_cacheDeletedIds) return _cacheDeletedIds;
        try {
            const raw = localStorage.getItem(deletedIdsStorageKey);
            const arr = raw ? JSON.parse(raw) : [];
            _cacheDeletedIds = new Set(Array.isArray(arr) ? arr : []);
        } catch (e) {
            _cacheDeletedIds = new Set();
        }
        return _cacheDeletedIds;
    }

    /**
     * 加载已删除内容签名集合（带内存缓存）
     * @returns {Set<string>} 已删除签名集合
     */
    function _loadDeletedSigs() {
        if (_cacheDeletedSigs) return _cacheDeletedSigs;
        try {
            const raw = localStorage.getItem(deletedSigsStorageKey);
            const arr = raw ? JSON.parse(raw) : [];
            _cacheDeletedSigs = new Set(Array.isArray(arr) ? arr : []);
        } catch (e) {
            _cacheDeletedSigs = new Set();
        }
        return _cacheDeletedSigs;
    }

    /**
     * 防抖写入已删除集合到 localStorage
     * 同时执行 LRU 淘汰，防止集合无限增长
     */
    function _scheduleSaveDeleted() {
        if (_deletedWriteTimer) return;
        _deletedWriteTimer = setTimeout(() => {
            _deletedWriteTimer = null;
            try {
                const ids = _loadDeletedIds();
                const sigs = _loadDeletedSigs();
                // LRU 淘汰：超过上限时移除最早加入的项
                if (ids.size > DELETED_SET_LIMIT) {
                    const toRemove = ids.size - DELETED_SET_LIMIT;
                    let i = 0;
                    for (const id of ids) {
                        if (i++ >= toRemove) break;
                        ids.delete(id);
                    }
                }
                if (sigs.size > DELETED_SET_LIMIT) {
                    const toRemove = sigs.size - DELETED_SET_LIMIT;
                    let i = 0;
                    for (const sig of sigs) {
                        if (i++ >= toRemove) break;
                        sigs.delete(sig);
                    }
                }
                localStorage.setItem(deletedIdsStorageKey, JSON.stringify([...ids]));
                localStorage.setItem(deletedSigsStorageKey, JSON.stringify([...sigs]));
            } catch (e) {}
        }, WRITE_DEBOUNCE_MS);
    }

    /**
     * 生成记忆唯一 ID
     * @returns {string} 形如 mem-1722580800000
     */
    function _genId() {
        return 'mem-' + Date.now();
    }

    // ============================================================
    // 公共 API
    // ============================================================

    /**
     * 获取所有记忆（按置顶优先 + 更新时间倒序排列）
     * @returns {Array<Object>} 记忆数组（返回副本，外部修改不影响存储）
     */
    function getAll() {
        const list = _loadMemories();
        return list.slice().sort((a, b) => {
            // pinned 优先
            if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
            // 其次按 lastAccessedAt 倒序
            return (b.lastAccessedAt || b.updatedAt || 0) - (a.lastAccessedAt || a.updatedAt || 0);
        });
    }

    /**
     * 添加一条记忆
     * @param {string} title - 标题
     * @param {string} content - 内容
     * @param {string} [category='preference'] - 分类
     * @param {Object} [opts] - 额外选项（tags/pinned/scope/id）
     * @returns {Object|null} 新增的记忆对象（失败返回 null）
     */
    function addMemory(title, content, category = 'preference', opts = {}) {
        const t = (title || '').trim();
        const c = (content || '').trim();
        if (!t || !c) return null;
        if (!VALID_CATEGORIES.includes(category)) category = 'preference';

        // 去重检查：相似度 ≥ 0.85 时视为重复，返回已有记忆
        const dup = _selectorFindSimilar(_loadMemories(), t, c, 0.85);
        if (dup) {
            // 返回已有记忆（不新增），调用方可根据 matchType 决定是否更新
            return dup.mem;
        }

        // ID 处理：优先使用调用方提供的 id，否则自动生成
        let memId = _genId();
        if (typeof opts.id === 'string' && opts.id.trim()) {
            const customId = opts.id.trim();
            if (!findMemoryById(customId)) {
                memId = customId;
            }
        }

        const now = Date.now();
        const mem = {
            id: memId,
            title: t,
            content: c,
            category: category,
            tags: Array.isArray(opts.tags) ? opts.tags : [],
            pinned: !!opts.pinned,
            enabled: true,
            scope: opts.scope === 'project' ? 'project' : 'global',
            createdAt: now,
            updatedAt: now,
            accessCount: 0,
            lastAccessedAt: now,
            history: []
        };
        const list = _loadMemories().slice();
        list.push(mem);
        _saveMemories(list);
        return mem;
    }

    /**
     * 更新指定记忆（部分更新）
     * @param {string} id - 记忆 ID
     * @param {Object} updates - 待更新字段
     * @returns {Object|null} 更新后的记忆对象（未找到返回 null）
     */
    function updateMemory(id, updates) {
        if (!id || !updates) return null;
        const list = _loadMemories().slice();
        const idx = list.findIndex(m => m.id === id);
        if (idx === -1) return null;

        if (typeof updates.title === 'string') {
            const t = updates.title.trim();
            if (!t) return null;
            list[idx].title = t;
        }
        if (typeof updates.content === 'string') {
            const c = updates.content.trim();
            if (!c) return null;
            list[idx].content = c;
        }
        if (typeof updates.category === 'string' && VALID_CATEGORIES.includes(updates.category)) {
            list[idx].category = updates.category;
        }
        if (Array.isArray(updates.tags)) {
            list[idx].tags = updates.tags;
        }
        if (typeof updates.pinned === 'boolean') {
            list[idx].pinned = updates.pinned;
        }
        if (typeof updates.enabled === 'boolean') {
            list[idx].enabled = updates.enabled;
        }
        if (typeof updates.scope === 'string' && (updates.scope === 'global' || updates.scope === 'project')) {
            list[idx].scope = updates.scope;
        }
        list[idx].updatedAt = Date.now();
        _saveMemories(list);
        return list[idx];
    }

    /**
     * 删除指定记忆
     * @param {string} id - 记忆 ID
     * @returns {boolean} 是否删除成功
     */
    function deleteMemory(id) {
        if (!id) return false;
        const list = _loadMemories();
        const target = list.find(m => m.id === id);
        if (!target) return false;
        const next = list.filter(m => m.id !== id);
        _saveMemories(next);
        // 记录已删除标记（ID + 内容签名），防止历史消息重新加载时 AI 工具调用重新保存
        _loadDeletedIds().add(id);
        _loadDeletedSigs().add(_contentSignature(target.title, target.content));
        _scheduleSaveDeleted();
        return true;
    }

    /**
     * 融合多条有关联的记忆为一条新记忆
     * @param {string[]} memoryIds - 待融合的记忆 ID 数组（至少 2 条）
     * @param {Object} newMemory - 新记忆的内容（name/content/type/tags）
     * @returns {{ ok: boolean, newMemory?: Object, deletedCount?: number, reason?: string }}
     */
    function mergeMemories(memoryIds, newMemory) {
        // 参数校验
        if (!Array.isArray(memoryIds) || memoryIds.length < 2) {
            return { ok: false, reason: '至少需要 2 条记忆才能融合' };
        }
        if (!newMemory || typeof newMemory !== 'object') {
            return { ok: false, reason: '新记忆参数无效' };
        }
        const name = typeof newMemory.name === 'string' ? newMemory.name.trim() : '';
        if (!name) {
            return { ok: false, reason: '新记忆 name 不能为空' };
        }
        const content = typeof newMemory.content === 'string' ? newMemory.content.trim() : '';
        if (!content) {
            return { ok: false, reason: '新记忆 content 不能为空' };
        }
        const type = VALID_CATEGORIES.includes(newMemory.type) ? newMemory.type : 'fact';

        const list = _loadMemories();
        const targets = [];
        const missingIds = [];
        for (const id of memoryIds) {
            const mem = list.find(m => m.id === id);
            if (mem) {
                targets.push(mem);
            } else {
                missingIds.push(id);
            }
        }
        if (missingIds.length > 0) {
            return { ok: false, reason: `未找到记忆: ${missingIds.join(', ')}` };
        }
        if (targets.length < 2) {
            return { ok: false, reason: '至少需要 2 条记忆才能融合' };
        }

        // 合并原记忆的所有 tags
        const mergedTags = new Set();
        for (const mem of targets) {
            if (Array.isArray(mem.tags)) {
                for (const t of mem.tags) {
                    if (typeof t === 'string' && t.trim()) mergedTags.add(t.trim());
                }
            }
        }
        // 加入调用方提供的 tags
        if (Array.isArray(newMemory.tags)) {
            for (const t of newMemory.tags) {
                if (typeof t === 'string' && t.trim()) mergedTags.add(t.trim());
            }
        }

        // 继承原记忆的统计信息
        const totalAccessCount = targets.reduce((sum, m) => sum + (m.accessCount || 0), 0);
        const earliestCreatedAt = Math.min(...targets.map(m => m.createdAt || Date.now()));
        const latestAccessedAt = Math.max(...targets.map(m => m.lastAccessedAt || 0));

        // 删除所有原记忆（含已删除标记记录）
        const targetIdSet = new Set(memoryIds);
        const remaining = list.filter(m => !targetIdSet.has(m.id));
        for (const mem of targets) {
            _loadDeletedIds().add(mem.id);
            _loadDeletedSigs().add(_contentSignature(mem.title, mem.content));
        }
        _scheduleSaveDeleted();

        // 合并原记忆的 history 数组
        const mergedHistoryMap = new Map();
        for (const mem of targets) {
            if (Array.isArray(mem.history)) {
                for (const h of mem.history) {
                    if (h && typeof h.timestamp === 'number' && !mergedHistoryMap.has(h.timestamp)) {
                        mergedHistoryMap.set(h.timestamp, h);
                    }
                }
            }
        }
        const mergedHistory = [...mergedHistoryMap.values()]
            .sort((a, b) => b.timestamp - a.timestamp)
            .slice(0, 5);

        // 创建新记忆
        const now = Date.now();
        const newMem = {
            id: _genId(),
            title: name,
            content: content,
            category: type,
            tags: [...mergedTags],
            pinned: false,
            enabled: true,
            scope: 'global',
            createdAt: earliestCreatedAt,
            updatedAt: now,
            accessCount: totalAccessCount,
            lastAccessedAt: latestAccessedAt || now,
            history: mergedHistory
        };
        remaining.push(newMem);
        _saveMemories(remaining);

        return { ok: true, newMemory: newMem, deletedCount: targets.length };
    }

    /**
     * 按 ID 查找记忆
     * @param {string} id - 记忆 ID
     * @returns {Object|null} 找到的记忆对象（未找到返回 null）
     */
    function findMemoryById(id) {
        if (!id) return null;
        const list = _loadMemories();
        return list.find(m => m.id === id) || null;
    }

    /**
     * 按 ID 精确读取单条记忆的完整内容（含 history 历史快照）
     * @param {string} id - 记忆 ID
     * @returns {Object|null} 找到的记忆对象（含 history 字段），未找到返回 null
     */
    function getMemoryById(id) {
        return findMemoryById(id);
    }

    /**
     * 切换指定记忆的启用状态
     * @param {string} id - 记忆 ID
     * @returns {boolean|null} 切换后的启用状态（未找到返回 null）
     */
    function toggleMemory(id) {
        if (!id) return null;
        const list = _loadMemories().slice();
        const idx = list.findIndex(m => m.id === id);
        if (idx === -1) return null;
        list[idx].enabled = !list[idx].enabled;
        list[idx].updatedAt = Date.now();
        _saveMemories(list);
        return list[idx].enabled;
    }

    /**
     * 切换指定记忆的置顶状态
     * @param {string} id - 记忆 ID
     * @returns {boolean|null} 切换后的置顶状态（未找到返回 null）
     */
    function togglePinMemory(id) {
        if (!id) return null;
        const list = _loadMemories().slice();
        const idx = list.findIndex(m => m.id === id);
        if (idx === -1) return null;
        list[idx].pinned = !list[idx].pinned;
        list[idx].updatedAt = Date.now();
        _saveMemories(list);
        return list[idx].pinned;
    }

    /**
     * 批量更新指定记忆的访问计数与最后访问时间
     * @param {string[]} ids - 待 touch 的记忆 ID 数组
     */
    function touchMemories(ids) {
        if (!Array.isArray(ids) || ids.length === 0) return;
        const list = _loadMemories().slice();
        const targetIds = new Set(ids);
        const now = Date.now();
        let changed = false;
        for (let i = 0; i < list.length; i++) {
            if (targetIds.has(list[i].id)) {
                list[i].accessCount = (list[i].accessCount || 0) + 1;
                list[i].lastAccessedAt = now;
                changed = true;
            }
        }
        if (changed) _saveMemories(list);
    }

    /**
     * 归档过期记忆
     * 删除满足以下全部条件的记忆：
     *   - lastAccessedAt 超过 STALE_THRESHOLD_DAYS 天
     *   - accessCount < MIN_ACCESS_FOR_RETENTION
     *   - 未置顶
     * @returns {number} 归档（删除）的记忆数量
     */
    function archiveStaleMemories() {
        const list = _loadMemories();
        if (list.length === 0) return 0;
        const threshold = Date.now() - STALE_THRESHOLD_DAYS * 86400000;
        const next = list.filter(m => !(
            m.lastAccessedAt < threshold &&
            !m.pinned &&
            (m.accessCount || 0) < MIN_ACCESS_FOR_RETENTION
        ));
        const archived = list.length - next.length;
        if (archived > 0) {
            _saveMemories(next);
        }
        return archived;
    }

    /**
     * 按作用域批量清空记忆
     * @param {'global'|'project'|'all'} scopeArg - 作用域范围
     * @param {Object} [opts] - 选项
     * @param {boolean} [opts.includePinned=false] - 是否包含置顶记忆
     * @param {boolean} [opts.confirm=false] - 确认执行（必须为 true 才会删除）
     * @returns {{ ok: boolean, deletedCount?: number, retainedPinnedCount?: number, reason?: string }}
     */
    function clearMemoriesByScope(scopeArg, opts = {}) {
        // 安全确认
        if (opts.confirm !== true) {
            return { ok: false, reason: '需要确认参数' };
        }

        const includePinned = opts.includePinned === true;
        const list = _loadMemories();
        if (list.length === 0) {
            return { ok: true, deletedCount: 0, retainedPinnedCount: 0 };
        }

        const remaining = [];
        let deletedCount = 0;
        let retainedPinnedCount = 0;

        for (const mem of list) {
            // 作用域筛选
            let inScope = false;
            if (scopeArg === 'all') {
                inScope = true;
            } else if (scopeArg === 'global' && mem.scope === 'global') {
                inScope = true;
            } else if (scopeArg === 'project' && mem.scope === 'project') {
                inScope = true;
            }

            if (!inScope) {
                remaining.push(mem);
                continue;
            }

            // 置顶记忆默认保留
            if (mem.pinned && !includePinned) {
                remaining.push(mem);
                retainedPinnedCount++;
                continue;
            }

            // 执行删除：记录已删除标记
            _loadDeletedIds().add(mem.id);
            _loadDeletedSigs().add(_contentSignature(mem.title, mem.content));
            deletedCount++;
        }

        if (deletedCount > 0) {
            _saveMemories(remaining);
            _scheduleSaveDeleted();
        }

        return { ok: true, deletedCount, retainedPinnedCount };
    }

    /**
     * 覆盖式更新记忆内容
     * @param {string} id - 记忆 ID
     * @param {string} newContent - 新内容字符串（非空）
     * @param {Object} [opts] - 选项（title/tags/reason）
     * @returns {Object|null} 更新后的记忆对象（附加 version 字段）
     */
    function replaceMemory(id, newContent, opts = {}) {
        if (!id || typeof newContent !== 'string' || !newContent.trim()) return null;

        const list = _loadMemories().slice();
        const idx = list.findIndex(m => m.id === id);
        if (idx === -1) return null;

        const mem = list[idx];

        // 保存当前快照到 history 数组
        const history = Array.isArray(mem.history) ? mem.history.slice() : [];
        history.push({
            timestamp: Date.now(),
            title: mem.title,
            content: mem.content,
            tags: Array.isArray(mem.tags) ? mem.tags.slice() : [],
            reason: opts.reason || ''
        });
        // history 数组上限 5 条
        while (history.length > 5) {
            history.shift();
        }
        mem.history = history;

        // 用新 content 覆盖原 content
        mem.content = newContent.trim();

        // 可选字段更新
        if (typeof opts.title === 'string' && opts.title.trim()) {
            mem.title = opts.title.trim();
        }
        if (Array.isArray(opts.tags)) {
            mem.tags = opts.tags;
        }

        mem.updatedAt = Date.now();

        list[idx] = mem;
        _saveMemories(list);

        return { ...mem, version: history.length + 1 };
    }

    /**
     * 导出全部记忆为可序列化的 JSON 字符串
     * @param {Object} [opts] - 导出选项
     * @returns {{ ok: boolean, json?: string, count?: number, bytes?: number }}
     */
    function exportMemories(opts = {}) {
        const list = _loadMemories();
        let filtered = list.slice();
        if (opts.includePinnedOnly) {
            filtered = filtered.filter(m => m.pinned);
        }
        if (typeof opts.category === 'string' && VALID_CATEGORIES.includes(opts.category)) {
            filtered = filtered.filter(m => (m.category || 'preference') === opts.category);
        }
        if (opts.includeDisabled === false) {
            filtered = filtered.filter(m => m.enabled !== false);
        }
        const payload = {
            version: 1,
            exportedAt: Date.now(),
            count: filtered.length,
            memories: filtered
        };
        let json;
        try {
            json = JSON.stringify(payload, null, 2);
        } catch (e) {
            return { ok: false };
        }
        return { ok: true, json, count: filtered.length, bytes: json.length };
    }

    /**
     * 检查记忆是否曾被用户删除（按 store 隔离）
     * @param {string} id - 记忆 ID（可选）
     * @param {string} title - 记忆标题
     * @param {string} content - 记忆内容
     * @returns {boolean} 是否曾被删除
     */
    function isMemoryDeleted(id, title, content) {
        if (id && _loadDeletedIds().has(id)) return true;
        if (_loadDeletedSigs().has(_contentSignature(title, content))) return true;
        return false;
    }

    /**
     * 查找与指定标题+内容相似度较高的已有记忆（本 store 范围内）
     * 适配旧签名 (title, content, threshold)，内部调用 selector 的纯函数
     * @param {string} title - 待检查的标题
     * @param {string} content - 待检查的内容
     * @param {number} [threshold=0.7] - 相似度阈值
     * @returns {{ mem: Object, similarity: number, matchType: string } | null}
     */
    function findSimilarMemory(title, content, threshold = 0.7) {
        return _selectorFindSimilar(_loadMemories(), title, content, threshold);
    }

    /**
     * 立即刷新待写入数据到 localStorage（供 destroyMemory 调用）
     */
    function flush() {
        if (_writeTimer) {
            clearTimeout(_writeTimer);
            _writeTimer = null;
            try {
                localStorage.setItem(storageKey, JSON.stringify(_cacheMemories || []));
            } catch (e) {}
        }
        if (_deletedWriteTimer) {
            clearTimeout(_deletedWriteTimer);
            _deletedWriteTimer = null;
            try {
                localStorage.setItem(deletedIdsStorageKey, JSON.stringify([..._loadDeletedIds()]));
                localStorage.setItem(deletedSigsStorageKey, JSON.stringify([..._loadDeletedSigs()]));
            } catch (e) {}
        }
    }

    // 返回 store 实例
    return {
        // 配置（只读）
        storageKey,
        scope,
        // 分词缓存（实例属性，供 selector 复用以避免重复分词）
        segmentCache,
        // 数据读写
        getAll,
        addMemory,
        updateMemory,
        deleteMemory,
        mergeMemories,
        replaceMemory,
        clearMemoriesByScope,
        archiveStaleMemories,
        findMemoryById,
        getMemoryById,
        isMemoryDeleted,
        touchMemories,
        toggleMemory,
        togglePinMemory,
        exportMemories,
        findSimilarMemory,
        flush,
        // 暴露内部加载函数供聚合入口的 previewMemoryImport 等使用（返回未排序的原始缓存）
        _loadMemories
    };
}
