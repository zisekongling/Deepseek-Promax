/**
 * 全局记忆系统模块（v2 智能选择版 · 聚合入口）
 *
 * P4 重构说明：
 *   原始 memory.js（约 2150 行）已拆分为三个子模块，本文件退化为聚合入口：
 *     - features/memory/schema.js   常量 + 纯函数（分类/触发词/停用词/Token 预算）
 *     - features/memory/selector.js 纯选择器（分词/评分/相似度/综合选择）
 *     - features/memory/store.js    数据层工厂（createMemoryStore，支持项目隔离）
 *   本文件职责：
 *     1. 创建全局 store 实例（globalStore），将所有 CRUD 调用代理到该实例
 *     2. 保留所有现有 export 名与签名，确保 memory-importer / sync / capability-register
 *        等上游模块零改动
 *     3. 保留注入/自动记录/初始化/UI 渲染等带副作用或依赖 DOM/全局状态的逻辑
 *
 * 核心功能（不变）：
 *   1. 自动注入：通过 fetch-hub 在请求发出前将记忆注入到 prompt（由 fetch-hub 调用 window._dsMemoryInjector）
 *      - 智能选择：基于关键词匹配 + 时间衰减 + 访问频率的综合评分
 *      - Token 预算：根据 prompt 长度动态调整注入预算（MEMORY_TOKEN_BUDGET=1500）
 *      - 访问反馈：注入时调用 touchMemories 增加 accessCount，更新 lastAccessedAt
 *   2. 自动记录：通过 fetch-hub 的 onStart 事件检测用户发送的消息中的记忆触发关键词
 *   3. 手动管理：在设置面板的独立记忆 tab 中增删改查所有记忆
 *   4. 归档清理：90 天未访问且 accessCount < 3 且未置顶的记忆自动归档
 */
import { showToast } from '../ui/toast.js';
import { registerCompletionHandler, unregisterCompletionHandler } from '../utils/fetch-hub.js';
import { CONFIG as _CONFIG_SNAPSHOT } from '../config.js';
import { estimateTokens } from '../utils/token-estimator.js';

// 子模块
import {
    CATEGORY_LABELS,
    CATEGORY_COLORS,
    VALID_CATEGORIES,
    SCOPE_LABELS,
    MEMORY_TRIGGERS
} from './memory/schema.js';
import {
    selectMemories as _selectMemories,
    formatMemoryLine,
    getMemoryBudget
} from './memory/selector.js';
import { createMemoryStore } from './memory/store.js';

// ============================================================
// 全局 store 实例
// ============================================================

/**
 * 全局记忆 store 实例
 * storageKey 沿用 'ds_memories'，保持与历史数据兼容
 * scope='global' 表示默认作用域为全局
 */
const globalStore = createMemoryStore({ storageKey: 'ds_memories', scope: 'global' });

/**
 * 安全获取最新的 CONFIG 引用
 * 由于 config.js 的 CONFIG 是 let 导出，直接 import 拿到的是导入时的快照
 * 这里通过 window 全局获取最新引用，回退到快照
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

// ============================================================
// 内部状态（与 store 无关的模块级状态）
// ============================================================

/** 模块是否已安装 */
let installed = false;
let handlerId = 0;

/** 面板事件是否已绑定（事件委托到 document，只需绑定一次） */
let _panelEventsBound = false;

/** 当前编辑中的记忆 ID（null 表示新增模式） */
let _editingId = null;

/** 最近一次 onStreamStart 缓存的 prompt（供 getInjectionText 在 fetch-hub 调用时使用） */
let _lastPromptForSelection = '';

/** 最近处理过的 prompt（避免短时间内重复检测） */
let _lastPromptHash = '';

// ============================================================
// CRUD 接口（代理到 globalStore，保持原 export 签名不变）
// ============================================================

/**
 * 获取所有记忆（按置顶优先 + 更新时间倒序排列）
 * @returns {Array<Object>} 记忆数组（返回副本，外部修改不影响存储）
 */
export function getMemories() {
    return globalStore.getAll();
}

/**
 * 添加一条记忆
 * @param {string} title - 标题
 * @param {string} content - 内容
 * @param {string} [category='preference'] - 分类：preference/context/fact/instruction
 * @param {Object} [opts] - 额外选项（tags/pinned/scope/id）
 * @returns {Object|null} 新增的记忆对象（失败返回 null）
 */
export function addMemory(title, content, category = 'preference', opts = {}) {
    return globalStore.addMemory(title, content, category, opts);
}

/**
 * 更新指定记忆（部分更新）
 * @param {string} id - 记忆 ID
 * @param {Object} updates - 待更新字段
 * @returns {Object|null} 更新后的记忆对象（未找到返回 null）
 */
export function updateMemory(id, updates) {
    return globalStore.updateMemory(id, updates);
}

/**
 * 删除指定记忆
 * @param {string} id - 记忆 ID
 * @returns {boolean} 是否删除成功
 */
export function deleteMemory(id) {
    return globalStore.deleteMemory(id);
}

/**
 * 融合多条有关联的记忆为一条新记忆
 * @param {string[]} memoryIds - 待融合的记忆 ID 数组（至少 2 条）
 * @param {Object} newMemory - 新记忆的内容（name/content/type/tags）
 * @returns {{ ok: boolean, newMemory?: Object, deletedCount?: number, reason?: string }}
 */
export function mergeMemories(memoryIds, newMemory) {
    return globalStore.mergeMemories(memoryIds, newMemory);
}

/**
 * 按 ID 查找记忆
 * @param {string} id - 记忆 ID
 * @returns {Object|null} 找到的记忆对象（未找到返回 null）
 */
export function findMemoryById(id) {
    return globalStore.findMemoryById(id);
}

/**
 * 按 ID 精确读取单条记忆的完整内容（含 history 历史快照）
 * @param {string} id - 记忆 ID
 * @returns {Object|null} 找到的记忆对象（含 history 字段），未找到返回 null
 */
export function getMemoryById(id) {
    return globalStore.getMemoryById(id);
}

/**
 * 切换指定记忆的启用状态
 * @param {string} id - 记忆 ID
 * @returns {boolean|null} 切换后的启用状态（未找到返回 null）
 */
export function toggleMemory(id) {
    return globalStore.toggleMemory(id);
}

/**
 * 切换指定记忆的置顶状态
 * @param {string} id - 记忆 ID
 * @returns {boolean|null} 切换后的置顶状态（未找到返回 null）
 */
export function togglePinMemory(id) {
    return globalStore.togglePinMemory(id);
}

/**
 * 批量更新指定记忆的访问计数与最后访问时间
 * @param {string[]} ids - 待 touch 的记忆 ID 数组
 */
export function touchMemories(ids) {
    return globalStore.touchMemories(ids);
}

/**
 * 归档过期记忆（90 天未访问 + 访问次数 < 3 + 未置顶）
 * @returns {number} 归档（删除）的记忆数量
 */
export function archiveStaleMemories() {
    return globalStore.archiveStaleMemories();
}

/**
 * 按作用域批量清空记忆
 * @param {'global'|'project'|'all'} scope - 作用域范围
 * @param {Object} [opts] - 选项（includePinned/confirm）
 * @returns {{ ok: boolean, deletedCount?: number, retainedPinnedCount?: number, reason?: string }}
 */
export function clearMemoriesByScope(scope, opts = {}) {
    return globalStore.clearMemoriesByScope(scope, opts);
}

/**
 * 覆盖式更新记忆内容
 * @param {string} id - 记忆 ID
 * @param {string} newContent - 新内容字符串（非空）
 * @param {Object} [opts] - 选项（title/tags/reason）
 * @returns {Object|null} 更新后的记忆对象（附加 version 字段）
 */
export function replaceMemory(id, newContent, opts = {}) {
    return globalStore.replaceMemory(id, newContent, opts);
}

/**
 * 导出全部记忆为可序列化的 JSON 字符串
 * @param {Object} [opts] - 导出选项
 * @returns {{ ok: boolean, json?: string, count?: number, bytes?: number }}
 */
export function exportMemories(opts = {}) {
    return globalStore.exportMemories(opts);
}

/**
 * 检查记忆是否曾被用户删除
 * @param {string} id - 记忆 ID（可选）
 * @param {string} title - 记忆标题
 * @param {string} content - 记忆内容
 * @returns {boolean} 是否曾被删除
 */
export function isMemoryDeleted(id, title, content) {
    return globalStore.isMemoryDeleted(id, title, content);
}

/**
 * 查找与指定标题+内容相似度较高的已有记忆
 * 保留旧签名 (title, content, threshold)，内部从 globalStore 读取数据
 * @param {string} title - 待检查的标题
 * @param {string} content - 待检查的内容
 * @param {number} [threshold=0.7] - 相似度阈值（0-1）
 * @returns {{ mem: Object, similarity: number, matchType: 'exact'|'title'|'content'|'similar' } | null}
 */
export function findSimilarMemory(title, content, threshold = 0.7) {
    return globalStore.findSimilarMemory(title, content, threshold);
}

/**
 * 根据 prompt token 数动态计算记忆预算
 * @param {number} promptTokens - prompt 的估算 token 数
 * @returns {number} 记忆 token 预算
 */
export { getMemoryBudget };

// ============================================================
// 记忆导入预览（保留在本文件，依赖 globalStore 读取已有记忆做去重）
// ============================================================

/**
 * 预览导入记忆（不实际保存）
 *
 * 将一段文本（JSON 或纯文本）解析为记忆候选列表，并返回预览结果：
 *   - memories：可导入的新记忆（已去重，最多 100 条）
 *   - duplicates：与已有记忆重复的数量
 *   - rejected：格式无效被拒绝的数量
 *
 * @param {Object} input - 输入参数
 * @param {string} input.content - 待导入的内容（JSON 或纯文本）
 * @param {string} [input.defaultType] - 默认分类
 * @param {string[]} [input.tags] - 附加标签
 * @returns {{ memories: Array<Object>, duplicates: number, rejected: number }} 预览结果
 */
export function previewMemoryImport(input) {
    if (!input || typeof input !== 'object') {
        return { memories: [], duplicates: 0, rejected: 0 };
    }
    const content = typeof input.content === 'string' ? input.content : '';
    if (!content.trim()) {
        return { memories: [], duplicates: 0, rejected: 0 };
    }

    // 默认分类：校验合法性，非法值回退到 'fact'
    const defaultType = VALID_CATEGORIES.includes(input.defaultType)
        ? input.defaultType
        : 'fact';
    const tags = _normalizeImportTags(input.tags);

    // 构建已有记忆的 dedupeKey 集合（用 store 原始缓存，无需排序）
    const existingKeys = new Set(
        globalStore._loadMemories().map(m => _dedupeKey(m.content))
    );
    const seenKeys = new Set();
    let duplicates = 0;
    let rejected = 0;

    // 提取候选记忆
    const { memories: candidates, rejected: rejectedCandidates } =
        _extractMemoryCandidates(content, defaultType, tags);
    rejected += rejectedCandidates;

    // 去重
    const memories = [];
    for (const candidate of candidates) {
        const key = _dedupeKey(candidate.content);
        if (!key) {
            rejected += 1;
            continue;
        }
        if (existingKeys.has(key) || seenKeys.has(key)) {
            duplicates += 1;
            continue;
        }
        seenKeys.add(key);
        memories.push(candidate);
    }

    return {
        memories: memories.slice(0, 100),
        duplicates,
        rejected
    };
}

/**
 * 从内容中提取记忆候选
 * @param {string} content - 原始内容
 * @param {string} defaultType - 默认分类
 * @param {string[]} tags - 附加标签
 * @returns {{ memories: Array<Object>, rejected: number }}
 */
function _extractMemoryCandidates(content, defaultType, tags) {
    const trimmed = content.trim();
    if (!trimmed) return { memories: [], rejected: 0 };

    // 尝试 JSON 解析
    const json = _tryParseJson(trimmed);
    if (json !== null) return _extractJsonMemories(json, defaultType, tags);

    // 纯文本切分：按空行或列表项（- 或 *）分隔
    return {
        memories: trimmed
            .split(/\n{2,}|\n(?=\s*[-*]\s+)/)
            .map(block => block.replace(/^\s*[-*]\s+/, '').trim())
            .filter(Boolean)
            .map(block => _createMemoryFromText(block, defaultType, tags)),
        rejected: 0
    };
}

/**
 * 从 JSON 结构中提取记忆候选
 * @param {unknown} value - 解析后的 JSON 值
 * @param {string} defaultType - 默认分类
 * @param {string[]} tags - 附加标签
 * @returns {{ memories: Array<Object>, rejected: number }}
 */
function _extractJsonMemories(value, defaultType, tags) {
    const items = Array.isArray(value)
        ? value
        : (value && typeof value === 'object' && Array.isArray(value.memories))
            ? value.memories
            : [value];

    const memories = [];
    let rejected = 0;
    for (const item of items) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
            rejected += 1;
            continue;
        }
        try {
            memories.push({
                title: _normalizeImportTitle(
                    _firstString(item.name, item.title, item.key) ||
                    _firstLine(String(item.content ?? item.text ?? item.value ?? ''))
                ),
                content: _requiredImportContent(
                    _firstString(item.content, item.text, item.value) || ''
                ),
                category: _normalizeImportType(item.type || item.category, defaultType),
                tags: _mergeImportTags(tags, _normalizeImportTags(item.tags)),
                description: _firstString(item.description, item.summary) || ''
            });
        } catch (e) {
            rejected += 1;
        }
    }
    return { memories, rejected };
}

/**
 * 从纯文本块创建记忆候选
 * @param {string} text - 文本块
 * @param {string} type - 分类
 * @param {string[]} tags - 标签
 * @returns {{ title: string, content: string, category: string, tags: string[], description: string }}
 */
function _createMemoryFromText(text, type, tags) {
    return {
        title: _normalizeImportTitle(_firstLine(text)),
        content: _requiredImportContent(text),
        category: type,
        tags,
        description: ''
    };
}

/**
 * 尝试解析 JSON，失败返回 null
 * @param {string} text - 待解析文本
 * @returns {unknown|null}
 */
function _tryParseJson(text) {
    try {
        return JSON.parse(text);
    } catch (e) {
        return null;
    }
}

/**
 * 规范化记忆分类，非法值回退到 fallback
 * @param {unknown} value - 待校验的分类值
 * @param {string} fallback - 回退分类
 * @returns {string}
 */
function _normalizeImportType(value, fallback) {
    return VALID_CATEGORIES.includes(value) ? value : fallback;
}

/**
 * 规范化标签数组（去重、去空白、过滤非字符串）
 * @param {unknown} value - 待规范化的标签
 * @returns {string[]}
 */
function _normalizeImportTags(value) {
    if (!Array.isArray(value)) return [];
    return [...new Set(
        value
            .filter(tag => typeof tag === 'string')
            .map(tag => tag.trim())
            .filter(Boolean)
    )];
}

/**
 * 合并两个标签数组（去重）
 * @param {string[]} a - 标签数组 a
 * @param {string[]} b - 标签数组 b
 * @returns {string[]}
 */
function _mergeImportTags(a, b) {
    return [...new Set([...a, ...b])];
}

/**
 * 返回第一个非空字符串（trim 后非空）
 * @param {...unknown} values - 候选值
 * @returns {string|null}
 */
function _firstString(...values) {
    for (const value of values) {
        if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return null;
}

/**
 * 取文本的第一行非空内容
 * @param {string} text - 原始文本
 * @returns {string}
 */
function _firstLine(text) {
    return text.split(/\r?\n/).find(line => line.trim())?.trim() || '导入的记忆';
}

/**
 * 规范化标题（移除 Markdown 标题符号、压缩空白、限制长度）
 * @param {string} value - 原始标题
 * @returns {string}
 */
function _normalizeImportTitle(value) {
    const title = value.replace(/^#+\s*/, '').replace(/\s+/g, ' ').trim();
    return (title || '导入的记忆').slice(0, 80);
}

/**
 * 校验并截断内容（非空、最长 8000 字符）
 * @param {string} value - 原始内容
 * @returns {string}
 * @throws {Error} 内容为空时抛出异常
 */
function _requiredImportContent(value) {
    const content = value.trim();
    if (!content) throw new Error('记忆内容不能为空');
    return content.slice(0, 8000);
}

/**
 * 生成去重键（小写 + 压缩空白）
 * @param {string} content - 记忆内容
 * @returns {string}
 */
function _dedupeKey(content) {
    return (content || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// ============================================================
// 智能选择器（适配器：保留旧签名，内部调用 selector 子模块）
// ============================================================

/**
 * 智能选择记忆（保留旧签名 selectMemories(prompt, allMemories, options)）
 * 内部调用 selector 子模块的新签名 selectMemories(memories, options)
 *
 * @param {string} prompt - 用户 prompt
 * @param {Array<Object>} allMemories - 全部已启用记忆
 * @param {Object} [options] - 选项
 * @param {number} [options.budget] - token 预算
 * @returns {Array<Object>} 选中的记忆数组
 */
export function selectMemories(prompt, allMemories, options = {}) {
    return _selectMemories(allMemories, {
        prompt,
        budget: options.budget,
        segmentCache: globalStore.segmentCache
    });
}

// ============================================================
// 记忆注入
// ============================================================

/**
 * 获取用于注入的完整包裹文本（供 fetch-hub 调用）
 *
 * 智能选择流程：
 *   1. 读取所有已启用记忆
 *   2. 根据传入的 prompt 做智能选择（关键词 + 衰减 + 预算）
 *   3. touchMemories 增加被选中记忆的访问计数
 *   4. 格式化为 [系统记忆] 包裹文本
 *
 * @param {string} [prompt] - 用户 prompt（可选，未提供时使用最近缓存的 prompt）
 * @returns {string} 包裹后的注入文本（无记忆时返回空字符串）
 */
export function getInjectionText(prompt) {
    const allMemories = globalStore._loadMemories().filter(m => m.enabled !== false);
    if (allMemories.length === 0) return '';

    // prompt 未提供时使用最近一次 onStreamStart 缓存的 prompt
    const effectivePrompt = (typeof prompt === 'string' && prompt.length > 0)
        ? prompt
        : (_lastPromptForSelection || '');

    const promptTokens = estimateTokens(effectivePrompt);
    const budget = getMemoryBudget(promptTokens);
    const selected = _selectMemories(allMemories, {
        prompt: effectivePrompt,
        budget,
        segmentCache: globalStore.segmentCache
    });

    if (selected.length === 0) return '';

    // 反馈：增加被选中记忆的访问计数（异步，不阻塞注入）
    try {
        globalStore.touchMemories(selected.map(m => m.id));
    } catch (e) {}

    const block = selected.map(formatMemoryLine).join('\n');
    return '[系统记忆]\n以下是用户的长期记忆和偏好，请在回复中遵循：\n' + block + '\n[/系统记忆]\n\n';
}

// ============================================================
// 自动记录（通过 fetch-hub 的 onStart 事件检测用户 prompt）
// ============================================================

/**
 * 检测用户发送的消息是否包含记忆触发关键词
 * 若命中则自动提取相关内容保存为记忆
 * @param {string} prompt - 用户发送的原始 prompt
 */
function checkAndAutoRecord(prompt) {
    if (!prompt || typeof prompt !== 'string' || prompt.length < 4) return;

    // 去重：同一 prompt 短时间内不重复检测
    const hash = prompt.slice(0, 200);
    if (hash === _lastPromptHash) return;
    _lastPromptHash = hash;

    const lower = prompt.toLowerCase();
    const hit = MEMORY_TRIGGERS.some(kw =>
        prompt.includes(kw) || lower.includes(kw.toLowerCase())
    );
    if (!hit) return;

    // 提取触发关键词后的内容作为记忆
    let triggerIdx = -1;
    let triggerKw = '';
    for (const kw of MEMORY_TRIGGERS) {
        const idx = lower.indexOf(kw.toLowerCase());
        if (idx >= 0 && (triggerIdx === -1 || idx < triggerIdx)) {
            triggerIdx = idx;
            triggerKw = kw;
        }
    }
    if (triggerIdx === -1) return;

    // 从触发关键词开始取内容，到句号/换行/分号为止
    let content = prompt.slice(triggerIdx);
    const endMatch = content.match(/[。！；\n.!?;]/);
    if (endMatch && endMatch.index > triggerKw.length + 2) {
        content = content.slice(0, endMatch.index + 1);
    }
    content = content.trim();
    if (content.length < 4) return;

    // 避免重复添加：检查是否已存在相似内容
    const existing = globalStore._loadMemories();
    const isDuplicate = existing.some(m =>
        m.content === content || m.content.includes(content) || content.includes(m.content)
    );
    if (isDuplicate) return;

    // 自动添加记忆
    const title = triggerKw.length > 6 ? triggerKw : content.slice(0, 20);
    const mem = globalStore.addMemory(title, content, 'preference');
    if (mem) {
        showToast(`🧠 已自动记录：${title}`, { tone: 'success', duration: 4000 });
    }
}

/**
 * 处理 fetch-hub 的 start 事件：缓存 prompt 供注入使用 + 检测记忆触发关键词
 * 仅在记忆系统启用时执行自动记录
 * @param {Object} payload - { startTime, model, prompt }
 */
function onStreamStart(payload) {
    const { CONFIG } = _getConfigSafe();
    // 缓存最近一次 prompt，供 getInjectionText 在 fetch-hub 调用时使用
    if (payload && typeof payload.prompt === 'string') {
        _lastPromptForSelection = payload.prompt;
    }
    if (!CONFIG || !CONFIG.agentMemoryEnabled) return;
    if (payload && payload.prompt) {
        checkAndAutoRecord(payload.prompt);
    }
}

// ============================================================
// 初始化
// ============================================================

/**
 * 初始化记忆系统
 *
 * 执行四件事：
 *   1. 注册 window._dsMemoryInjector 回调，供 fetch-hub 在请求拦截时调用
 *   2. 初始化记忆管理面板的事件监听（事件委托，仅绑定一次）
 *   3. 向 fetch-hub 注册 onStart 处理器，用于自动记录 + 缓存 prompt
 *   4. 启动时归档过期记忆（如果配置允许）
 */
export function initMemory() {
    if (installed) return;
    installed = true;

    // 1. 注册记忆注入回调（供 fetch-hub 的 injectPromptAndMemory 与 anti-recall.js 的 XHR send hook 调用）
    if (typeof window !== 'undefined' && typeof window._dsMemoryInjector !== 'function') {
        window._dsMemoryInjector = function(prompt) {
            try {
                const { CONFIG } = _getConfigSafe();
                // 记忆注入在 agentSystemEnabled（总开关）且 agentMemoryEnabled 启用时生效
                if (!CONFIG) return '';
                if (!CONFIG.agentSystemEnabled) return '';
                if (!CONFIG.agentMemoryEnabled) return '';
                return getInjectionText(prompt);
            } catch (e) {
                return '';
            }
        };
    }

    // 2. 绑定面板事件（事件委托，幂等）
    _bindPanelEvents();

    // 3. 预热缓存
    globalStore._loadMemories();

    // 4. 启动时归档过期记忆（如果配置允许）
    try {
        const { CONFIG } = _getConfigSafe();
        if (CONFIG && CONFIG.memoryAutoArchive !== false) {
            const archived = globalStore.archiveStaleMemories();
            if (archived > 0) {
                console.log(`[DS Memory] 已自动归档 ${archived} 条过期记忆`);
            }
        }
    } catch (e) {}

    // 5. 向 fetch-hub 注册 onStart 处理器（用于自动记录记忆 + 缓存 prompt 供注入使用）
    handlerId = registerCompletionHandler({
        onStart: onStreamStart
    });
}

/**
 * 清理记忆系统（对外暴露的可选接口）
 */
export function destroyMemory() {
    if (!installed) return;
    installed = false;
    if (handlerId) unregisterCompletionHandler(handlerId);
    handlerId = 0;
    // flush 待写入数据
    globalStore.flush();
}

// ============================================================
// 面板事件绑定（事件委托）
// ============================================================

/**
 * 转义 HTML 特殊字符
 * @param {string} str
 * @returns {string}
 */
function _escapeHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * 绑定记忆面板的所有事件（事件委托到 document，仅绑定一次）
 * 处理：开关切换、编辑、删除、搜索、筛选、提交、置顶、范围切换
 */
function _bindPanelEvents() {
    if (_panelEventsBound) return;
    _panelEventsBound = true;

    // 事件委托：处理记忆卡片上的各种操作
    document.addEventListener('click', (e) => {
        const target = e.target;
        if (!target) return;

        // 只处理记忆面板内的事件
        const panel = document.getElementById('ds-memory-tab-panel');
        if (!panel || !panel.contains(target)) return;

        const action = target.dataset.action;
        const id = target.dataset.id;

        // 开关切换
        if (action === 'mem-toggle' && target.tagName === 'INPUT') {
            const newState = toggleMemory(id);
            if (newState !== null) {
                const card = target.closest('.ds-mem-card');
                if (card) card.classList.toggle('ds-mem-disabled', !newState);
            }
            return;
        }

        // 置顶切换
        if (action === 'mem-pin') {
            const newState = togglePinMemory(id);
            if (newState !== null) {
                const btn = target;
                btn.classList.toggle('ds-mem-pinned', newState);
                btn.textContent = newState ? '📌 已置顶' : '📌 置顶';
                _refreshMemoryList();
            }
            return;
        }

        // 编辑
        if (action === 'mem-edit') {
            _enterEditMode(id);
            return;
        }

        // 删除
        if (action === 'mem-delete') {
            if (id && confirm('确定删除这条记忆吗？')) {
                if (deleteMemory(id)) {
                    showToast('记忆已删除', { tone: 'success' });
                    if (_editingId === id) _exitEditMode();
                    _refreshMemoryList();
                }
            }
            return;
        }

        // 提交（添加 / 更新）
        if (action === 'mem-submit') {
            const titleInput = panel.querySelector('#ds-mem-input-title');
            const contentInput = panel.querySelector('#ds-mem-input-content');
            const categoryInput = panel.querySelector('#ds-mem-input-category');
            const scopeInput = panel.querySelector('#ds-mem-input-scope');
            const tagsInput = panel.querySelector('#ds-mem-input-tags');
            const title = (titleInput ? titleInput.value : '').trim();
            const content = (contentInput ? contentInput.value : '').trim();
            const category = categoryInput ? categoryInput.value : 'preference';
            const scope = scopeInput ? scopeInput.value : 'global';
            const tags = (tagsInput ? tagsInput.value : '')
                .split(/[,，\s]+/)
                .map(s => s.trim())
                .filter(Boolean);

            if (!title || !content) {
                showToast('标题和内容不能为空', { tone: 'warning' });
                return;
            }

            if (_editingId) {
                const updated = updateMemory(_editingId, { title, content, category, scope, tags });
                if (updated) {
                    showToast('记忆已更新', { tone: 'success' });
                } else {
                    showToast('更新失败，记忆可能已被删除', { tone: 'error' });
                }
                _exitEditMode();
            } else {
                const mem = addMemory(title, content, category, { scope, tags });
                if (mem) {
                    showToast('记忆已添加', { tone: 'success' });
                } else {
                    showToast('添加失败', { tone: 'error' });
                }
            }
            _refreshMemoryList();
            return;
        }

        // 范围切换（toolbar 中的全局/项目过滤）
        if (action === 'mem-scope-filter') {
            panel.querySelectorAll('[data-action="mem-scope-filter"]').forEach(btn => {
                btn.classList.remove('active');
            });
            target.classList.add('active');
            _refreshMemoryList();
            return;
        }

        // 归档过期记忆
        if (action === 'mem-archive') {
            const archived = archiveStaleMemories();
            if (archived > 0) {
                showToast(`已归档 ${archived} 条过期记忆`, { tone: 'success' });
                _refreshMemoryList();
            } else {
                showToast('没有需要归档的过期记忆', { tone: 'info' });
            }
            return;
        }
    });

    // 搜索与分类筛选
    document.addEventListener('input', (e) => {
        const target = e.target;
        if (!target) return;
        const panel = document.getElementById('ds-memory-tab-panel');
        if (!panel || !panel.contains(target)) return;
        const action = target.dataset.action;
        if (action === 'mem-search' || action === 'mem-filter') {
            _refreshMemoryList();
        }
    });
}

/**
 * 截取内容预览
 * @param {string} content
 * @param {number} [max=80]
 * @returns {string}
 */
function _previewContent(content, max = 80) {
    const s = String(content || '');
    if (s.length <= max) return s;
    return s.slice(0, max) + '...';
}

/**
 * 格式化相对时间（如 "3 天前"、"刚刚"）
 * @param {number} ts - 时间戳
 * @returns {string}
 */
function _formatRelativeTime(ts) {
    if (!ts) return '';
    const diff = Date.now() - ts;
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前';
    if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前';
    const days = Math.floor(diff / 86400000);
    if (days < 30) return days + ' 天前';
    if (days < 365) return Math.floor(days / 30) + ' 个月前';
    return Math.floor(days / 365) + ' 年前';
}

/**
 * 获取当前选中的范围过滤
 * @param {HTMLElement} panel
 * @returns {string} 'global' | 'project' | ''
 */
function _getCurrentScopeFilter(panel) {
    const active = panel.querySelector('[data-action="mem-scope-filter"].active');
    return active ? (active.dataset.scope || '') : '';
}

/**
 * 渲染记忆列表 HTML（支持搜索、分类过滤、范围过滤）
 * @param {string} [filterText='']
 * @param {string} [filterCategory='']
 * @param {string} [filterScope='']
 * @returns {string}
 */
function _renderListHTML(filterText = '', filterCategory = '', filterScope = '') {
    let list = getMemories();
    const kw = filterText.trim().toLowerCase();
    if (kw) {
        list = list.filter(m =>
            (m.title || '').toLowerCase().includes(kw) ||
            (m.content || '').toLowerCase().includes(kw) ||
            (Array.isArray(m.tags) && m.tags.some(t => String(t).toLowerCase().includes(kw)))
        );
    }
    if (filterCategory) {
        list = list.filter(m => m.category === filterCategory);
    }
    if (filterScope) {
        list = list.filter(m => m.scope === filterScope);
    }

    if (list.length === 0) {
        return '<div class="ds-mem-empty">暂无记忆，在下方添加一条吧</div>';
    }

    return list.map(m => {
        const label = CATEGORY_LABELS[m.category] || '偏好';
        const checked = m.enabled ? 'checked' : '';
        const time = new Date(m.lastAccessedAt || m.updatedAt || m.createdAt || Date.now());
        const timeStr = isNaN(time.getTime()) ? '' : time.toLocaleString('zh-CN');
        const relTime = _formatRelativeTime(m.lastAccessedAt || m.updatedAt || m.createdAt);
        const accessCount = m.accessCount || 0;
        const pinned = m.pinned;
        const tagsHtml = (Array.isArray(m.tags) && m.tags.length > 0)
            ? m.tags.map(t => `<span class="ds-mem-tag-item">#${_escapeHtml(t)}</span>`).join('')
            : '';
        return `
            <div class="ds-mem-card${m.enabled ? '' : ' ds-mem-disabled'}${pinned ? ' ds-mem-pinned-card' : ''}" data-id="${_escapeHtml(m.id)}">
                <div class="ds-mem-card-head">
                    ${pinned ? '<span class="ds-mem-pin-icon">📌</span>' : ''}
                    <span class="ds-mem-title">${_escapeHtml(m.title)}</span>
                    <span class="ds-mem-tag ds-mem-tag-${_escapeHtml(m.category)}">${_escapeHtml(label)}</span>
                    <span class="ds-mem-scope-badge ds-mem-scope-${_escapeHtml(m.scope || 'global')}">${_escapeHtml(SCOPE_LABELS[m.scope] || '全局')}</span>
                    <label class="ds-mem-toggle">
                        <input type="checkbox" data-action="mem-toggle" data-id="${_escapeHtml(m.id)}" ${checked}>
                        <span class="ds-mem-slider"></span>
                    </label>
                </div>
                <div class="ds-mem-preview">${_escapeHtml(_previewContent(m.content))}</div>
                ${tagsHtml ? `<div class="ds-mem-tags">${tagsHtml}</div>` : ''}
                <div class="ds-mem-meta">
                    <span class="ds-mem-time" title="${_escapeHtml(timeStr)}">访问 ${accessCount} 次 · ${relTime}</span>
                </div>
                <div class="ds-mem-actions">
                    <button class="ds-mem-btn ds-mem-btn-pin${pinned ? ' ds-mem-pinned' : ''}" data-action="mem-pin" data-id="${_escapeHtml(m.id)}">${pinned ? '📌 已置顶' : '📌 置顶'}</button>
                    <button class="ds-mem-btn ds-mem-btn-edit" data-action="mem-edit" data-id="${_escapeHtml(m.id)}">编辑</button>
                    <button class="ds-mem-btn ds-mem-btn-delete" data-action="mem-delete" data-id="${_escapeHtml(m.id)}">删除</button>
                </div>
            </div>
        `;
    }).join('');
}

/**
 * 刷新记忆列表区域（读取最新数据并按当前筛选条件渲染）
 */
function _refreshMemoryList() {
    const panel = document.getElementById('ds-memory-tab-panel');
    if (!panel) return;
    const searchEl = panel.querySelector('#ds-mem-search');
    const filterEl = panel.querySelector('#ds-mem-filter');
    const kw = searchEl ? searchEl.value : '';
    const cat = filterEl ? filterEl.value : '';
    const scope = _getCurrentScopeFilter(panel);
    const listEl = panel.querySelector('#ds-mem-list');
    if (listEl) listEl.innerHTML = _renderListHTML(kw, cat, scope);
    const countEl = panel.querySelector('#ds-mem-count');
    if (countEl) countEl.textContent = getMemories().length + ' 条';
}

/**
 * 进入编辑模式
 * @param {string} id
 */
function _enterEditMode(id) {
    const mem = globalStore.findMemoryById(id);
    if (!mem) return;
    _editingId = id;

    const panel = document.getElementById('ds-memory-tab-panel');
    if (!panel) return;
    const titleInput = panel.querySelector('#ds-mem-input-title');
    const contentInput = panel.querySelector('#ds-mem-input-content');
    const categoryInput = panel.querySelector('#ds-mem-input-category');
    const scopeInput = panel.querySelector('#ds-mem-input-scope');
    const tagsInput = panel.querySelector('#ds-mem-input-tags');
    const submitBtn = panel.querySelector('#ds-mem-submit-btn');
    const formTitle = panel.querySelector('#ds-mem-form-title');

    if (titleInput) titleInput.value = mem.title;
    if (contentInput) contentInput.value = mem.content;
    if (categoryInput) categoryInput.value = mem.category;
    if (scopeInput) scopeInput.value = mem.scope || 'global';
    if (tagsInput) tagsInput.value = (Array.isArray(mem.tags) ? mem.tags : []).join(', ');
    if (submitBtn) {
        submitBtn.textContent = '保存修改';
        submitBtn.classList.add('ds-mem-editing');
    }
    if (formTitle) formTitle.textContent = '编辑记忆';
    if (titleInput) titleInput.focus();
}

/**
 * 退出编辑模式
 */
function _exitEditMode() {
    _editingId = null;
    const panel = document.getElementById('ds-memory-tab-panel');
    if (!panel) return;
    const titleInput = panel.querySelector('#ds-mem-input-title');
    const contentInput = panel.querySelector('#ds-mem-input-content');
    const categoryInput = panel.querySelector('#ds-mem-input-category');
    const scopeInput = panel.querySelector('#ds-mem-input-scope');
    const tagsInput = panel.querySelector('#ds-mem-input-tags');
    const submitBtn = panel.querySelector('#ds-mem-submit-btn');
    const formTitle = panel.querySelector('#ds-mem-form-title');

    if (titleInput) titleInput.value = '';
    if (contentInput) contentInput.value = '';
    if (categoryInput) categoryInput.value = 'preference';
    if (scopeInput) scopeInput.value = 'global';
    if (tagsInput) tagsInput.value = '';
    if (submitBtn) {
        submitBtn.textContent = '添加记忆';
        submitBtn.classList.remove('ds-mem-editing');
    }
    if (formTitle) formTitle.textContent = '添加新记忆';
}

/**
 * 渲染记忆管理面板的 CSS 样式文本
 * @returns {string}
 */
export function getMemoryPanelCSS() {
    return `
    .ds-mem-panel {
        color: var(--ds-panel-text, #1a1a2e);
        font-family: -apple-system, 'Segoe UI', system-ui, 'PingFang SC', 'Microsoft YaHei', sans-serif;
        font-size: 14px;
    }
    .ds-mem-header {
        display: flex; align-items: center; justify-content: space-between;
        margin-bottom: 12px;
    }
    .ds-mem-header h3 {
        margin: 0; font-size: 16px; font-weight: 700;
        color: var(--ds-panel-text);
    }
    .ds-mem-count {
        font-size: 12px; color: var(--ds-section-color);
        background: var(--ds-card-bg); padding: 2px 10px; border-radius: 10px;
    }
    .ds-mem-toolbar {
        display: flex; gap: 8px; margin-bottom: 8px; flex-wrap: wrap;
    }
    .ds-mem-toolbar input,
    .ds-mem-toolbar select { flex: 1; min-width: 100px; }
    .ds-mem-scope-tabs {
        display: inline-flex; gap: 2px;
        border: 1px solid var(--ds-panel-border); border-radius: 8px; overflow: hidden;
        margin-bottom: 12px;
    }
    .ds-mem-scope-tabs button {
        border: none; background: transparent; padding: 4px 12px;
        font-size: 12px; cursor: pointer; color: inherit; opacity: 0.6;
        transition: background 0.2s, opacity 0.2s;
    }
    .ds-mem-scope-tabs button.active {
        background: var(--ds-primary); color: #fff; opacity: 1;
    }
    .ds-mem-list { margin-bottom: 12px; max-height: 340px; overflow-y: auto; }
    .ds-mem-card {
        border: 1px solid var(--ds-panel-border);
        border-radius: 10px; padding: 10px 12px; margin-bottom: 6px;
        background: var(--ds-card-bg);
        transition: background 0.2s, border-color 0.2s;
    }
    .ds-mem-card:hover { background: var(--ds-hover-bg); }
    .ds-mem-card.ds-mem-disabled { opacity: 0.55; }
    .ds-mem-card.ds-mem-pinned-card {
        border-color: var(--ds-primary);
        box-shadow: 0 0 0 1px var(--ds-primary) inset;
    }
    .ds-mem-card-head {
        display: flex; align-items: center; gap: 8px; margin-bottom: 4px;
    }
    .ds-mem-pin-icon { flex-shrink: 0; }
    .ds-mem-title {
        flex: 1; font-weight: 600; font-size: 14px;
        color: var(--ds-panel-text);
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .ds-mem-tag {
        font-size: 11px; padding: 2px 8px; border-radius: 8px;
        color: #fff; font-weight: 600; flex-shrink: 0;
    }
    .ds-mem-tag-preference { background: ${CATEGORY_COLORS.preference}; }
    .ds-mem-tag-context { background: ${CATEGORY_COLORS.context}; }
    .ds-mem-tag-fact { background: ${CATEGORY_COLORS.fact}; }
    .ds-mem-tag-instruction { background: ${CATEGORY_COLORS.instruction}; }
    .ds-mem-scope-badge {
        font-size: 10px; padding: 2px 6px; border-radius: 6px;
        font-weight: 600; flex-shrink: 0;
        border: 1px solid var(--ds-panel-border);
        color: var(--ds-section-color); background: transparent;
    }
    .ds-mem-scope-project {
        color: ${CATEGORY_COLORS.instruction};
        border-color: ${CATEGORY_COLORS.instruction};
    }
    .ds-mem-preview {
        font-size: 13px; color: var(--ds-section-color);
        line-height: 1.5; margin-bottom: 4px;
        word-break: break-word;
    }
    .ds-mem-tags {
        display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 4px;
    }
    .ds-mem-tag-item {
        font-size: 11px; color: var(--ds-primary);
        background: var(--ds-card-bg); padding: 1px 6px; border-radius: 4px;
    }
    .ds-mem-meta {
        font-size: 11px; color: var(--ds-section-color); opacity: 0.8;
        margin-bottom: 6px;
    }
    .ds-mem-time { }
    .ds-mem-actions { display: flex; gap: 6px; flex-wrap: wrap; }
    .ds-mem-btn {
        padding: 4px 10px; border-radius: 6px; border: none;
        font-size: 12px; cursor: pointer; font-weight: 600;
        transition: opacity 0.2s, background 0.2s;
    }
    .ds-mem-btn:hover { opacity: 0.85; }
    .ds-mem-btn-pin {
        background: var(--ds-card-bg); color: var(--ds-panel-text);
        border: 1px solid var(--ds-panel-border);
    }
    .ds-mem-btn-pin.ds-mem-pinned {
        background: rgba(245,158,11,0.15); color: #f59e0b;
        border-color: rgba(245,158,11,0.4);
    }
    .ds-mem-btn-edit {
        background: var(--ds-card-bg); color: var(--ds-panel-text);
        border: 1px solid var(--ds-panel-border);
    }
    .ds-mem-btn-edit:hover { background: var(--ds-hover-bg); }
    .ds-mem-btn-delete {
        background: rgba(239,68,68,0.12); color: #ef4444;
    }
    .ds-mem-btn-delete:hover { background: rgba(239,68,68,0.25); }
    .ds-mem-toggle {
        position: relative; display: inline-block;
        width: 36px; height: 20px; flex-shrink: 0; cursor: pointer;
    }
    .ds-mem-toggle input { opacity: 0; width: 0; height: 0; }
    .ds-mem-slider {
        position: absolute; top: 0; left: 0; right: 0; bottom: 0;
        background: var(--ds-input-border);
        border-radius: 20px; transition: background 0.2s;
    }
    .ds-mem-slider::before {
        content: ""; position: absolute;
        width: 14px; height: 14px; left: 3px; bottom: 3px;
        background: #fff; border-radius: 50%;
        transition: transform 0.2s;
        box-shadow: 0 2px 4px rgba(0,0,0,0.2);
    }
    .ds-mem-toggle input:checked + .ds-mem-slider { background: var(--ds-primary); }
    .ds-mem-toggle input:checked + .ds-mem-slider::before { transform: translateX(16px); }
    .ds-mem-form {
        border-top: 1px solid var(--ds-panel-border);
        padding-top: 12px;
        display: flex; flex-direction: column; gap: 8px;
    }
    .ds-mem-form-title {
        font-size: 13px; font-weight: 600; color: var(--ds-section-color);
        text-transform: uppercase; letter-spacing: 0.5px;
    }
    .ds-mem-form-row {
        display: flex; gap: 8px; flex-wrap: wrap;
    }
    .ds-mem-form-row select { flex: 1; min-width: 100px; }
    .ds-mem-add-btn {
        align-self: flex-start;
        padding: 8px 20px; border-radius: 10px; border: none;
        background: var(--ds-primary); color: #fff;
        font-size: 13px; font-weight: 600; cursor: pointer;
        transition: opacity 0.2s, transform 0.2s;
    }
    .ds-mem-add-btn:hover { opacity: 0.88; transform: translateY(-1px); }
    .ds-mem-add-btn.ds-mem-editing { background: ${CATEGORY_COLORS.instruction}; }
    .ds-mem-archive-btn {
        padding: 4px 10px; border-radius: 6px;
        border: 1px solid var(--ds-panel-border);
        background: transparent; color: var(--ds-section-color);
        font-size: 12px; cursor: pointer; transition: background 0.2s;
    }
    .ds-mem-archive-btn:hover { background: var(--ds-hover-bg); }
    .ds-mem-empty {
        color: var(--ds-section-color); font-size: 13px;
        padding: 20px; text-align: center;
        border: 1px dashed var(--ds-panel-border); border-radius: 12px;
    }
    `;
}

/**
 * 渲染记忆管理面板的完整 HTML（用于嵌入设置面板的记忆 tab）
 * @returns {string}
 */
export function renderMemoryPanel() {
    const list = getMemories();
    const count = list.length;
    const categoryOptions = VALID_CATEGORIES.map(c =>
        `<option value="${c}">${CATEGORY_LABELS[c]}</option>`
    ).join('');

    return `
    <div class="ds-mem-panel" id="ds-memory-tab-panel">
        <div class="ds-mem-header">
            <h3>🧠 全局记忆</h3>
            <span class="ds-mem-count" id="ds-mem-count">${count} 条</span>
        </div>
        <div class="ds-info-card" style="margin-bottom:12px;">
            记忆会在每次对话时<b>智能选择</b>注入到系统提示词中（基于关键词匹配 + 访问频率 + 时间衰减）。当消息包含"请记住""我喜欢"等关键词时，会<b>自动记录</b>为新记忆。90 天未访问且访问次数 < 3 的记忆会被自动归档。
        </div>
        <div class="ds-mem-toolbar">
            <input type="text" id="ds-mem-search" class="ds-input" placeholder="搜索标题/内容/标签..." data-action="mem-search">
            <select id="ds-mem-filter" class="ds-input" data-action="mem-filter">
                <option value="">全部分类</option>
                ${categoryOptions}
            </select>
            <button class="ds-mem-archive-btn" data-action="mem-archive" title="清理 90 天未访问且访问次数 < 3 的记忆">🧹 归档</button>
        </div>
        <div class="ds-mem-scope-tabs">
            <button data-action="mem-scope-filter" data-scope="" class="active">全部</button>
            <button data-action="mem-scope-filter" data-scope="global">全局</button>
            <button data-action="mem-scope-filter" data-scope="project">项目</button>
        </div>
        <div class="ds-mem-list" id="ds-mem-list">
            ${_renderListHTML()}
        </div>
        <div class="ds-mem-form">
            <div class="ds-mem-form-title" id="ds-mem-form-title">添加新记忆</div>
            <input type="text" id="ds-mem-input-title" class="ds-input" placeholder="标题（如：用户偏好简洁回复）">
            <textarea id="ds-mem-input-content" class="ds-input" rows="3" placeholder="记忆内容（将注入到系统提示词中）..."></textarea>
            <input type="text" id="ds-mem-input-tags" class="ds-input" placeholder="标签（逗号分隔，如：编程,偏好,Python）">
            <div class="ds-mem-form-row">
                <select id="ds-mem-input-category" class="ds-input">
                    ${categoryOptions}
                </select>
                <select id="ds-mem-input-scope" class="ds-input">
                    <option value="global">全局</option>
                    <option value="project">项目</option>
                </select>
            </div>
            <button class="ds-mem-add-btn" id="ds-mem-submit-btn" data-action="mem-submit">添加记忆</button>
        </div>
    </div>
    `;
}

/**
 * 刷新记忆面板（外部调用，用于设置面板切换到记忆 tab 时）
 */
export function refreshMemoryPanel() {
    _refreshMemoryList();
}
