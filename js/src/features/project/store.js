/**
 * 项目上下文存储模块（Project Store）
 *
 * 职责：
 *   - 项目的增删改查（CRUD）
 *   - 项目与会话的关联管理（加入/移除会话）
 *   - 项目级记忆的增删改查（schema 与全局记忆一致，参考 features/memory.js）
 *
 * 数据结构：
 *   Project = {
 *     id: string,                 // 项目唯一 ID（proj-<timestamp>-<rand>）
 *     name: string,               // 项目名称（必填）
 *     slug: string,               // URL 友好的短标识（自动由 name 生成，保证唯一）
 *     instructions: string,       // 项目指令（注入到会话首条消息前）
 *     memories: ProjectMemory[],  // 项目级记忆列表
 *     sessionIds: string[],       // 关联的会话 ID 列表（来自 URL 的 UUID）
 *     createdAt: number,
 *     updatedAt: number
 *   }
 *   ProjectMemory = {
 *     id: string,
 *     title: string,
 *     content: string,
 *     tags: string[],
 *     pinned: boolean,
 *     createdAt: number,
 *     updatedAt: number
 *   }
 *
 * 存储：localStorage key = 'ds_projects'（数组形式）
 *
 * 性能优化（参考 features/memory.js）：
 *   - 内存缓存 + 防抖异步写入（WRITE_DEBOUNCE_MS=300）
 *   - 读取带向后兼容迁移（补充缺失字段）
 *
 * CONFIG 键声明（Phase 6 统一集成到 config.js 的 DEFAULTS）：
 *   - projectEnabled: boolean (默认 false) —— 项目模块总开关
 *   本模块读取 CONFIG.projectEnabled 时做防御性处理（undefined 视为 false），
 *   以便在 config.js 未声明该键时不报错。
 */

import { CONFIG as _CONFIG_SNAPSHOT } from '../../config.js';

// ============================================================
// 常量定义
// ============================================================

/** localStorage 存储键名 */
const STORAGE_KEY = 'ds_projects';

/** 防抖写入间隔（毫秒） */
const WRITE_DEBOUNCE_MS = 300;

/** 项目名称最大长度 */
const PROJECT_NAME_MAX = 80;

/** 项目指令最大长度 */
const PROJECT_INSTRUCTIONS_MAX = 8000;

/** 项目记忆内容最大长度 */
const MEMORY_CONTENT_MAX = 8000;

// ============================================================
// 内部状态（内存缓存 + 防抖写入）
// ============================================================

/** 内存缓存的项目数组 */
let _cacheProjects = null;
/** 缓存是否脏（需从 localStorage 重新读取） */
let _cacheDirty = true;
/** 防抖写入定时器 */
let _writeTimer = null;

/**
 * 安全获取最新的 CONFIG 引用
 * config.js 的 CONFIG 是 let 导出，import 拿到的是快照，
 * 这里通过 window.__dsConfig 取最新引用，回退到快照（参考 memory.js 的 _getConfigSafe）
 * @returns {{ CONFIG: Object }}
 */
function _getConfigSafe() {
    try {
        if (typeof window !== 'undefined' && window.__dsConfig) {
            return { CONFIG: window.__dsConfig };
        }
    } catch (e) {}
    return { CONFIG: _CONFIG_SNAPSHOT };
}

/**
 * 判断项目模块是否启用（防御性读取，未声明时返回 false）
 * @returns {boolean}
 */
export function isProjectEnabled() {
    const { CONFIG } = _getConfigSafe();
    return !!(CONFIG && CONFIG.projectEnabled === true);
}

// ============================================================
// 存储层
// ============================================================

/**
 * 生成唯一 ID
 * @param {string} [prefix='proj'] - ID 前缀
 * @returns {string}
 */
function _genId(prefix = 'proj') {
    return prefix + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
}

/**
 * 迁移单条项目记录：补充缺失字段，保证结构完整
 * @param {Object} p - 原始项目对象
 * @returns {Object|null} 迁移后的项目对象（无效输入返回 null）
 */
function _migrateProject(p) {
    if (!p || typeof p !== 'object') return null;
    const now = Date.now();
    const name = typeof p.name === 'string' ? p.name.trim() : '';
    if (!name) return null;
    return {
        id: p.id || _genId('proj'),
        name: name,
        slug: typeof p.slug === 'string' && p.slug.trim() ? p.slug.trim() : _slugify(name),
        instructions: typeof p.instructions === 'string' ? p.instructions : '',
        memories: Array.isArray(p.memories) ? p.memories.map(_migrateMemory).filter(Boolean) : [],
        sessionIds: Array.isArray(p.sessionIds) ? p.sessionIds.filter(s => typeof s === 'string' && s) : [],
        createdAt: p.createdAt || now,
        updatedAt: p.updatedAt || now
    };
}

/**
 * 迁移单条项目记忆：补充缺失字段，schema 与全局记忆核心字段一致
 * @param {Object} m - 原始记忆对象
 * @returns {Object|null} 迁移后的记忆对象（无效输入返回 null）
 */
function _migrateMemory(m) {
    if (!m || typeof m !== 'object') return null;
    const now = Date.now();
    return {
        id: m.id || _genId('pmem'),
        title: typeof m.title === 'string' ? m.title : '',
        content: typeof m.content === 'string' ? m.content : '',
        tags: Array.isArray(m.tags) ? m.tags : [],
        pinned: !!m.pinned,
        createdAt: m.createdAt || now,
        updatedAt: m.updatedAt || now
    };
}

/**
 * 从 localStorage 读取全部项目（带内存缓存）
 * @returns {Array<Object>}
 */
function _loadProjects() {
    if (!_cacheDirty && _cacheProjects) return _cacheProjects;
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) {
            _cacheProjects = [];
        } else {
            const arr = JSON.parse(raw);
            _cacheProjects = Array.isArray(arr)
                ? arr.map(_migrateProject).filter(Boolean)
                : [];
        }
    } catch (e) {
        _cacheProjects = [];
    }
    _cacheDirty = false;
    return _cacheProjects;
}

/**
 * 防抖异步写入：将内存中的项目数组刷新到 localStorage
 */
function _scheduleSave() {
    if (_writeTimer) return;
    _writeTimer = setTimeout(() => {
        _writeTimer = null;
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(_cacheProjects || []));
        } catch (e) {}
    }, WRITE_DEBOUNCE_MS);
}

/**
 * 将项目数组写入内存缓存并触发防抖写入
 * @param {Array<Object>} projects
 */
function _saveProjects(projects) {
    _cacheProjects = projects;
    _cacheDirty = false;
    _scheduleSave();
}

/**
 * 立即 flush 待写入数据到 localStorage（页面卸载前调用）
 */
export function flushProjects() {
    if (_writeTimer) {
        clearTimeout(_writeTimer);
        _writeTimer = null;
    }
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(_cacheProjects || []));
    } catch (e) {}
}

// ============================================================
// 工具函数
// ============================================================

/**
 * 将项目名称转换为 URL 友好的 slug
 * @param {string} name - 项目名称
 * @returns {string}
 */
function _slugify(name) {
    return String(name || '')
        .trim()
        .toLowerCase()
        .replace(/[\s_\-]+/g, '-')
        .replace(/[^a-z0-9\u4e00-\u9fa5\-]/g, '')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40) || 'project';
}

/**
 * 确保 slug 在所有项目中唯一（冲突时追加数字后缀）
 * @param {string} slug - 候选 slug
 * @param {string} [excludeId] - 排除的项目 ID（更新时排除自身）
 * @returns {string}
 */
function _ensureUniqueSlug(slug, excludeId) {
    const list = _loadProjects();
    const used = new Set(
        list.filter(p => p.id !== excludeId).map(p => p.slug)
    );
    if (!used.has(slug)) return slug;
    let i = 2;
    while (used.has(slug + '-' + i)) i++;
    return slug + '-' + i;
}

/**
 * 浅拷贝项目对象（避免外部修改影响存储缓存）
 * @param {Object} p
 * @returns {Object}
 */
function _cloneProject(p) {
    return {
        ...p,
        memories: Array.isArray(p.memories) ? p.memories.map(m => ({ ...m, tags: [...(m.tags || [])] })) : [],
        sessionIds: Array.isArray(p.sessionIds) ? [...p.sessionIds] : []
    };
}

// ============================================================
// 项目 CRUD
// ============================================================

/**
 * 列出全部项目（按更新时间倒序）
 * @returns {Array<Object>} 项目数组（返回副本）
 */
export function listProjects() {
    return _loadProjects()
        .slice()
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
        .map(_cloneProject);
}

/**
 * 按 ID 获取单个项目
 * @param {string} id - 项目 ID
 * @returns {Object|null} 项目对象（未找到返回 null）
 */
export function getProject(id) {
    if (!id) return null;
    const p = _loadProjects().find(x => x.id === id);
    return p ? _cloneProject(p) : null;
}

/**
 * 按 slug 获取单个项目
 * @param {string} slug - 项目 slug
 * @returns {Object|null}
 */
export function getProjectBySlug(slug) {
    if (!slug) return null;
    const p = _loadProjects().find(x => x.slug === slug);
    return p ? _cloneProject(p) : null;
}

/**
 * 创建新项目
 * @param {Object} data - 创建参数
 * @param {string} data.name - 项目名称（必填）
 * @param {string} [data.slug] - 项目 slug（可选，默认由 name 生成）
 * @param {string} [data.instructions=''] - 项目指令
 * @returns {Object|null} 新建的项目对象（失败返回 null）
 */
export function createProject(data) {
    if (!data || typeof data !== 'object') return null;
    const name = typeof data.name === 'string' ? data.name.trim() : '';
    if (!name) return null;
    const now = Date.now();
    const baseSlug = (typeof data.slug === 'string' && data.slug.trim())
        ? _slugify(data.slug)
        : _slugify(name);
    const project = {
        id: _genId('proj'),
        name: name.slice(0, PROJECT_NAME_MAX),
        slug: _ensureUniqueSlug(baseSlug, null),
        instructions: typeof data.instructions === 'string'
            ? data.instructions.slice(0, PROJECT_INSTRUCTIONS_MAX)
            : '',
        memories: [],
        sessionIds: [],
        createdAt: now,
        updatedAt: now
    };
    const list = _loadProjects().slice();
    list.push(project);
    _saveProjects(list);
    return _cloneProject(project);
}

/**
 * 更新项目（部分更新）
 * @param {string} id - 项目 ID
 * @param {Object} patch - 待更新字段（name / slug / instructions）
 * @returns {Object|null} 更新后的项目对象（未找到或名称为空返回 null）
 */
export function updateProject(id, patch) {
    if (!id || !patch) return null;
    const list = _loadProjects().slice();
    const idx = list.findIndex(p => p.id === id);
    if (idx === -1) return null;

    if (typeof patch.name === 'string') {
        const name = patch.name.trim();
        if (!name) return null;
        list[idx].name = name.slice(0, PROJECT_NAME_MAX);
    }
    if (typeof patch.slug === 'string' && patch.slug.trim()) {
        list[idx].slug = _ensureUniqueSlug(_slugify(patch.slug), id);
    }
    if (typeof patch.instructions === 'string') {
        list[idx].instructions = patch.instructions.slice(0, PROJECT_INSTRUCTIONS_MAX);
    }
    list[idx].updatedAt = Date.now();
    _saveProjects(list);
    return _cloneProject(list[idx]);
}

/**
 * 删除项目
 * @param {string} id - 项目 ID
 * @returns {boolean} 是否删除成功
 */
export function deleteProject(id) {
    if (!id) return false;
    const list = _loadProjects();
    const target = list.find(p => p.id === id);
    if (!target) return false;
    _saveProjects(list.filter(p => p.id !== id));
    return true;
}

// ============================================================
// 项目-会话关联管理
// ============================================================

/**
 * 将会话加入项目（已存在则跳过）
 * @param {string} projectId - 项目 ID
 * @param {string} sessionId - 会话 ID（来自 URL 的 UUID）
 * @returns {Object|null} 更新后的项目对象（项目未找到返回 null）
 */
export function addSessionToProject(projectId, sessionId) {
    if (!projectId || !sessionId) return null;
    const list = _loadProjects().slice();
    const idx = list.findIndex(p => p.id === projectId);
    if (idx === -1) return null;
    if (!list[idx].sessionIds.includes(sessionId)) {
        list[idx].sessionIds.push(sessionId);
        list[idx].updatedAt = Date.now();
        _saveProjects(list);
    }
    return _cloneProject(list[idx]);
}

/**
 * 从项目中移除会话
 * @param {string} projectId - 项目 ID
 * @param {string} sessionId - 会话 ID
 * @returns {Object|null} 更新后的项目对象（项目未找到返回 null）
 */
export function removeSessionFromProject(projectId, sessionId) {
    if (!projectId || !sessionId) return null;
    const list = _loadProjects().slice();
    const idx = list.findIndex(p => p.id === projectId);
    if (idx === -1) return null;
    const before = list[idx].sessionIds.length;
    list[idx].sessionIds = list[idx].sessionIds.filter(s => s !== sessionId);
    if (list[idx].sessionIds.length !== before) {
        list[idx].updatedAt = Date.now();
        _saveProjects(list);
    }
    return _cloneProject(list[idx]);
}

/**
 * 查找包含指定会话的项目（供 injector 使用）
 * @param {string} sessionId - 会话 ID
 * @returns {Object|null} 项目对象（未找到返回 null）
 */
export function getProjectForSession(sessionId) {
    if (!sessionId) return null;
    const p = _loadProjects().find(x => Array.isArray(x.sessionIds) && x.sessionIds.includes(sessionId));
    return p ? _cloneProject(p) : null;
}

// ============================================================
// 项目记忆 CRUD
// ============================================================

/**
 * 列出项目的全部记忆（按 pinned 优先 + 更新时间倒序）
 * @param {string} projectId - 项目 ID
 * @returns {Array<Object>} 记忆数组（项目未找到返回空数组）
 */
export function listProjectMemories(projectId) {
    const p = getProject(projectId);
    if (!p) return [];
    return (p.memories || [])
        .slice()
        .sort((a, b) => {
            if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
            return (b.updatedAt || 0) - (a.updatedAt || 0);
        });
}

/**
 * 向项目添加记忆
 * @param {string} projectId - 项目 ID
 * @param {Object} mem - 记忆对象（至少包含 title 和 content）
 * @returns {Object|null} 新增的记忆对象（项目未找到或内容为空返回 null）
 */
export function addProjectMemory(projectId, mem) {
    if (!projectId || !mem || typeof mem !== 'object') return null;
    const title = typeof mem.title === 'string' ? mem.title.trim() : '';
    const content = typeof mem.content === 'string' ? mem.content.trim() : '';
    if (!title || !content) return null;

    const list = _loadProjects().slice();
    const idx = list.findIndex(p => p.id === projectId);
    if (idx === -1) return null;

    const now = Date.now();
    const memory = {
        id: (typeof mem.id === 'string' && mem.id.trim()) ? mem.id : _genId('pmem'),
        title: title,
        content: content.slice(0, MEMORY_CONTENT_MAX),
        tags: Array.isArray(mem.tags) ? mem.tags.filter(t => typeof t === 'string' && t.trim()).map(t => t.trim()) : [],
        pinned: !!mem.pinned,
        createdAt: now,
        updatedAt: now
    };
    list[idx].memories = Array.isArray(list[idx].memories) ? list[idx].memories.slice() : [];
    list[idx].memories.push(memory);
    list[idx].updatedAt = now;
    _saveProjects(list);
    return { ...memory, tags: [...memory.tags] };
}

/**
 * 更新项目记忆（部分更新）
 * @param {string} projectId - 项目 ID
 * @param {string} memId - 记忆 ID
 * @param {Object} patch - 待更新字段（title / content / tags / pinned）
 * @returns {Object|null} 更新后的记忆对象（未找到返回 null）
 */
export function updateProjectMemory(projectId, memId, patch) {
    if (!projectId || !memId || !patch) return null;
    const list = _loadProjects().slice();
    const pi = list.findIndex(p => p.id === projectId);
    if (pi === -1) return null;
    const memories = Array.isArray(list[pi].memories) ? list[pi].memories : [];
    const mi = memories.findIndex(m => m.id === memId);
    if (mi === -1) return null;

    if (typeof patch.title === 'string') {
        const t = patch.title.trim();
        if (!t) return null;
        memories[mi].title = t;
    }
    if (typeof patch.content === 'string') {
        const c = patch.content.trim();
        if (!c) return null;
        memories[mi].content = c.slice(0, MEMORY_CONTENT_MAX);
    }
    if (Array.isArray(patch.tags)) {
        memories[mi].tags = patch.tags.filter(t => typeof t === 'string' && t.trim()).map(t => t.trim());
    }
    if (typeof patch.pinned === 'boolean') {
        memories[mi].pinned = patch.pinned;
    }
    memories[mi].updatedAt = Date.now();
    list[pi].memories = memories;
    list[pi].updatedAt = Date.now();
    _saveProjects(list);
    return { ...memories[mi], tags: [...memories[mi].tags] };
}

/**
 * 删除项目记忆
 * @param {string} projectId - 项目 ID
 * @param {string} memId - 记忆 ID
 * @returns {boolean} 是否删除成功
 */
export function deleteProjectMemory(projectId, memId) {
    if (!projectId || !memId) return false;
    const list = _loadProjects().slice();
    const pi = list.findIndex(p => p.id === projectId);
    if (pi === -1) return false;
    const memories = Array.isArray(list[pi].memories) ? list[pi].memories : [];
    const before = memories.length;
    list[pi].memories = memories.filter(m => m.id !== memId);
    if (list[pi].memories.length !== before) {
        list[pi].updatedAt = Date.now();
        _saveProjects(list);
        return true;
    }
    return false;
}
