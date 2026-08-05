/**
 * 项目上下文注入模块（Project Injector）
 *
 * 职责：
 *   - 解析当前会话的 sessionId（参考 features/data-store.js 的 getSidFromUrl）
 *   - 查找包含当前 sessionId 的项目
 *   - 在新会话首条消息前注入项目指令与相关项目记忆
 *
 * 注入格式：
 *   <project_context>
 *   项目: {项目名}
 *   指令:
 *   {项目指令}
 *   </project_context>
 *
 *   <project_memories>
 *   - [置顶] {标题}: {内容}
 *   - {标题}: {内容}
 *   </project_memories>
 *
 * 注入方式（参考 features/memory.js）：
 *   注册 window._dsProjectInjector(sessionId, prompt) 回调，供 fetch-hub /
 *   prompt-augmentation 在请求拦截时调用（Phase 6 统一集成接线）。
 *   本模块不修改 fetch-hub.js / prompt-augmentation.js，仅暴露回调与公开 API。
 *
 * 记忆筛选策略（按 pinned + 关键词匹配）：
 *   1. pinned 记忆始终注入
 *   2. 非 pinned 记忆按关键词匹配分排序，取前 N 条
 *   3. 无 prompt 时退化为：pinned 全部 + 其余按更新时间倒序取前 N 条
 */

import { getSidFromUrl } from '../data-store.js';
import {
    isProjectEnabled,
    getProjectForSession,
    listProjectMemories
} from './store.js';

// ============================================================
// 常量定义
// ============================================================

/** 注入的项目记忆条数上限（避免上下文爆炸） */
const PROJECT_MEMORIES_LIMIT = 10;

/** 中文停用词集合（参考 features/memory.js 的 STOP_WORDS，精简版） */
const STOP_WORDS = new Set([
    '的', '了', '在', '是', '我', '有', '和', '就', '不', '都', '一', '上', '也',
    '到', '说', '要', '去', '你', '会', '着', '看', '好', '这', '他', '她', '它',
    '们', '那', '与', '而', '为', '以', '及', '被', '把', '让', '给', '从', '对',
    '但', '如果', '因为', '所以', '可以', '能', '想', '知道', '没', '什么', '怎么',
    'the', 'be', 'to', 'of', 'and', 'a', 'in', 'that', 'have', 'i', 'it', 'for',
    'not', 'on', 'with', 'as', 'you', 'do', 'at', 'this', 'but', 'his', 'by', 'is'
]);

/** Intl.Segmenter 实例（如果可用，用于中文分词） */
const segmenter = (typeof Intl !== 'undefined' && Intl.Segmenter)
    ? new Intl.Segmenter('zh-Hans', { granularity: 'word' })
    : null;

// ============================================================
// 内部状态
// ============================================================

/** 注入器是否已安装（幂等保护） */
let installed = false;

// ============================================================
// 分词（参考 features/memory.js 的 segmentText，精简版）
// ============================================================

/**
 * 将文本分词为小写词语数组
 * 优先使用 Intl.Segmenter（中文分词更准确），回退到正则切分
 * 过滤停用词与长度<=1的词
 * @param {string} text - 待分词的文本
 * @returns {string[]} 词语数组
 */
function _segmentText(text) {
    if (!text) return [];
    const lower = String(text).toLowerCase();
    if (segmenter) {
        const words = [];
        for (const s of segmenter.segment(lower)) {
            if (!s.isWordLike) continue;
            const w = s.segment;
            if (w.length > 1 && !STOP_WORDS.has(w)) words.push(w);
        }
        return words;
    }
    return lower
        .split(/[\s,，。！？；：、\-_/]+/)
        .filter(w => w.length > 1 && !STOP_WORDS.has(w));
}

// ============================================================
// 记忆筛选（按 pinned + 关键词匹配）
// ============================================================

/**
 * 计算单条记忆与 prompt 关键词的匹配分数
 * 综合标签、标题、内容三处的命中情况（参考 memory.js 的 keywordScore）
 * @param {Set<string>} promptWordSet - prompt 分词集合
 * @param {string[]} promptWords - prompt 分词数组
 * @param {Object} memory - 项目记忆对象
 * @returns {number} 关键词分数
 */
function _keywordScore(promptWordSet, promptWords, memory) {
    let score = 0;
    // 标签命中：完整匹配 +20，包含匹配 +10
    const tags = Array.isArray(memory.tags) ? memory.tags : [];
    for (const tag of tags) {
        const tagLower = String(tag).toLowerCase();
        if (tagLower.length > 1 && promptWordSet.has(tagLower)) {
            score += 20;
            continue;
        }
        for (const pw of promptWords) {
            if (pw.length > 2 && tagLower.includes(pw) && tagLower !== pw) {
                score += 10;
            }
        }
    }
    // 标题命中 +15
    for (const w of _segmentText(memory.title || '')) {
        if (promptWordSet.has(w)) score += 15;
    }
    // 内容命中 +5
    for (const w of _segmentText(memory.content || '')) {
        if (promptWordSet.has(w)) score += 5;
    }
    return score;
}

/**
 * 选择要注入的项目记忆（pinned 全选 + 非 pinned 按关键词分排序）
 * @param {Array<Object>} memories - 项目全部记忆
 * @param {string} [prompt] - 用户 prompt（用于关键词匹配，可选）
 * @param {number} [limit] - 非 pinned 记忆条数上限
 * @returns {Array<Object>} 选中的记忆数组（pinned 在前）
 */
function _selectMemories(memories, prompt, limit = PROJECT_MEMORIES_LIMIT) {
    if (!memories || memories.length === 0) return [];
    const pinned = memories.filter(m => m.pinned);
    const nonPinned = memories.filter(m => !m.pinned);

    // 有 prompt 时按关键词分排序；无 prompt 时按更新时间倒序
    let ranked;
    if (prompt && prompt.trim()) {
        const promptWords = _segmentText(prompt);
        const promptWordSet = new Set(promptWords);
        ranked = nonPinned
            .map(m => ({ m, score: _keywordScore(promptWordSet, promptWords, m) }))
            .sort((a, b) => b.score - a.score);
    } else {
        ranked = nonPinned
            .map(m => ({ m, score: 0 }))
            .sort((a, b) => (b.m.updatedAt || 0) - (a.m.updatedAt || 0));
    }

    // 非 pinned 中：有 prompt 时优先取分数>0 的；不足时补 0 分的
    const picked = [];
    for (const item of ranked) {
        if (picked.length >= limit) break;
        // 无 prompt 时直接取；有 prompt 时优先取 score>0，若已无可命中的则不再补
        if (!prompt || !prompt.trim() || item.score > 0) {
            picked.push(item.m);
        }
    }
    // 若 pinned + 命中的不足 limit，且有 prompt 时也可补 0 分的记忆（保持上下文完整）
    if (prompt && prompt.trim() && (pinned.length + picked.length) < limit) {
        for (const item of ranked) {
            if (picked.length >= limit) break;
            if (item.score === 0 && !picked.includes(item.m)) {
                picked.push(item.m);
            }
        }
    }

    return [...pinned, ...picked];
}

// ============================================================
// 注入文本构建
// ============================================================

/**
 * 净化文本中的分隔符，避免破坏注入格式
 * @param {string} s
 * @returns {string}
 */
function _sanitize(s) {
    return String(s || '').replace(/\r?\n/g, ' ').trim();
}

/**
 * 构建 <project_context> 块（项目名 + 指令）
 * @param {Object} project - 项目对象
 * @returns {string} 注入文本（无指令时返回空串）
 */
function _buildContextBlock(project) {
    const instructions = (project.instructions || '').trim();
    if (!instructions) return '';
    return [
        '<project_context>',
        '项目: ' + _sanitize(project.name),
        '指令:',
        instructions,
        '</project_context>'
    ].join('\n');
}

/**
 * 构建 <project_memories> 块（相关项目记忆）
 * @param {Array<Object>} memories - 选中的记忆数组
 * @returns {string} 注入文本（无记忆时返回空串）
 */
function _buildMemoriesBlock(memories) {
    if (!memories || memories.length === 0) return '';
    const lines = memories.map(m => {
        const prefix = m.pinned ? '[置顶] ' : '';
        return '- ' + prefix + _sanitize(m.title) + ': ' + _sanitize(m.content);
    });
    return [
        '<project_memories>',
        ...lines,
        '</project_memories>'
    ].join('\n');
}

// ============================================================
// 公开 API
// ============================================================

/**
 * 获取指定会话的项目上下文注入文本
 *
 * 流程：
 *   1. 若未传 sessionId，从当前 URL 解析（参考 data-store.js 的 getSidFromUrl）
 *   2. 查找包含该 sessionId 的项目
 *   3. 构建项目指令块 + 相关项目记忆块
 *
 * @param {string} [sessionId] - 会话 ID（未传时从 URL 解析）
 * @param {string} [prompt] - 用户 prompt（用于记忆关键词匹配，可选）
 * @returns {string} 注入文本（无项目或无指令时返回空串）
 */
export function getProjectContextForSession(sessionId, prompt) {
    try {
        if (!isProjectEnabled()) return '';
        const sid = sessionId || getSidFromUrl();
        if (!sid) return '';
        const project = getProjectForSession(sid);
        if (!project) return '';

        const contextBlock = _buildContextBlock(project);
        const selected = _selectMemories(
            listProjectMemories(project.id),
            prompt
        );
        const memoriesBlock = _buildMemoriesBlock(selected);

        const parts = [contextBlock, memoriesBlock].filter(Boolean);
        if (parts.length === 0) return '';
        return parts.join('\n\n') + '\n\n';
    } catch (e) {
        // 注入失败不应影响主流程
        return '';
    }
}

/**
 * 安装项目注入器（幂等）
 *
 * 注册 window._dsProjectInjector(sessionId, prompt) 回调，
 * 供 fetch-hub / prompt-augmentation 在请求拦截时调用（Phase 6 接线）。
 *
 * 注意：不覆写 window._dsMemoryInjector / window._dsCapabilityInjector，
 * 不破坏现有 Agent 闭环。
 */
export function installProjectInjector() {
    if (installed) return;
    installed = true;
    if (typeof window !== 'undefined' && typeof window._dsProjectInjector !== 'function') {
        /**
         * 项目上下文注入回调
         * @param {string} [sessionId] - 会话 ID（未传时从 URL 解析）
         * @param {string} [prompt] - 用户 prompt（用于记忆关键词匹配）
         * @returns {string} 注入文本
         */
        window._dsProjectInjector = function (sessionId, prompt) {
            try {
                if (!isProjectEnabled()) return '';
                return getProjectContextForSession(sessionId, prompt);
            } catch (e) {
                return '';
            }
        };
    }
}

/**
 * 卸载项目注入器（对外暴露的可选接口）
 */
export function uninstallProjectInjector() {
    if (!installed) return;
    installed = false;
    if (typeof window !== 'undefined' && typeof window._dsProjectInjector === 'function') {
        // 仅在仍为本模块注册的回调时移除（避免误删他人覆写）
        // 由于无法精确判定，这里保留回调但置为空函数以禁用注入
        window._dsProjectInjector = function () { return ''; };
    }
}
