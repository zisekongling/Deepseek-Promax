/**
 * @module features/memory/selector
 *
 * 记忆选择器：纯函数集合，不依赖任何 store 实例。
 *
 * 抽出目的（P4 重构）：
 *   - 将分词、关键词评分、时间衰减、综合选择、相似度检测等纯逻辑从 memory.js 抽出
 *   - 支持传入外部 segmentCache，避免多 store 实例间分词缓存互相污染
 *   - 供 store.js / memory.js（聚合入口）复用
 *
 * 函数签名说明：
 *   - findSimilarMemory / selectMemories 采用"数据传入"签名（memories 作为首参），
 *     不再隐式读取 store，方便测试与多 store 复用
 *   - memory.js 聚合入口对外仍保留旧签名（title/content/threshold、prompt/allMemories/options），
 *     内部通过适配器调用本模块
 */

import { estimateTokens } from '../../utils/token-estimator.js';
import { STOP_WORDS, MEMORY_TOKEN_BUDGET } from './schema.js';

// 重新导出 estimateTokens，方便 memory.js 聚合入口统一 re-export
export { estimateTokens };

/** 分词缓存上限（LRU 淘汰） */
const SEGMENT_CACHE_LIMIT = 1000;

/** Intl.Segmenter 实例（如果可用） */
const segmenter = (typeof Intl !== 'undefined' && Intl.Segmenter)
    ? new Intl.Segmenter('zh-Hans', { granularity: 'word' })
    : null;

/**
 * 将文本分词为小写词语数组（带 LRU 缓存）
 * 优先使用 Intl.Segmenter（更准确的中文分词），回退到正则切分
 * 过滤停用词与长度<=1的词
 * @param {string} text - 待分词的文本
 * @param {Map<string, string[]>} [segmentCache] - 可选的分词缓存（实例隔离时传入）
 * @returns {string[]} 词语数组
 */
export function segmentText(text, segmentCache) {
    if (!text) return [];
    if (segmentCache) {
        const cached = segmentCache.get(text);
        if (cached) return cached;
    }

    const words = segmenter
        ? [...segmenter.segment(text)]
            .filter(s => s.isWordLike)
            .map(s => s.segment.toLowerCase())
            .filter(w => w.length > 1 && !STOP_WORDS.has(w))
        : text.toLowerCase()
            .split(/[\s,，。！？；：、\-_/]+/)
            .filter(w => w.length > 1 && !STOP_WORDS.has(w));

    // LRU 淘汰（仅在传入缓存时写入）
    if (segmentCache) {
        if (segmentCache.size >= SEGMENT_CACHE_LIMIT) {
            const firstKey = segmentCache.keys().next().value;
            if (firstKey !== undefined) segmentCache.delete(firstKey);
        }
        segmentCache.set(text, words);
    }
    return words;
}

/**
 * 计算两个字符串的 Jaccard 相似度（基于字符 bigram）
 * 用于记忆去重时的模糊匹配
 * @param {string} a - 字符串 a
 * @param {string} b - 字符串 b
 * @returns {number} 相似度 0-1
 */
function _similarity(a, b) {
    if (!a || !b) return 0;
    if (a === b) return 1;
    const bigrams = (s) => {
        const set = new Set();
        for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
        return set;
    };
    const sa = bigrams(a), sb = bigrams(b);
    if (sa.size === 0 || sb.size === 0) return 0;
    let intersect = 0;
    for (const g of sa) if (sb.has(g)) intersect++;
    return intersect / (sa.size + sb.size - intersect);
}

/**
 * 查找与指定标题+内容相似度较高的已有记忆
 * 用于工具调用 memory_save 的智能去重
 *
 * @param {Array<Object>} memories - 全部记忆数组（由调用方传入，避免隐式依赖 store）
 * @param {string} title - 待检查的标题
 * @param {string} content - 待检查的内容
 * @param {number} [threshold=0.7] - 相似度阈值（0-1）
 * @returns {{ mem: Object, similarity: number, matchType: 'exact'|'title'|'content'|'similar' } | null}
 */
export function findSimilarMemory(memories, title, content, threshold = 0.7) {
    if (!memories || memories.length === 0) return null;
    const t = (title || '').trim();
    const c = (content || '').trim();
    let best = null;
    for (const mem of memories) {
        // 精确匹配（标题+内容完全相同）
        if (mem.title === t && mem.content === c) {
            return { mem, similarity: 1, matchType: 'exact' };
        }
        // 标题相似度
        const titleSim = _similarity(mem.title, t);
        // 内容相似度
        const contentSim = _similarity(mem.content, c);
        // 综合相似度（标题权重 0.3，内容权重 0.7）
        const combined = titleSim * 0.3 + contentSim * 0.7;
        if (combined >= threshold && (!best || combined > best.similarity)) {
            const matchType = titleSim >= 0.9 ? 'title' : (contentSim >= 0.9 ? 'content' : 'similar');
            best = { mem, similarity: combined, matchType };
        }
    }
    return best;
}

/**
 * 计算关键词匹配分数（参考 deepseek-pp/memory/selector.ts:38-63 的 keywordScore）
 * 综合标签、名称、内容三处的关键词命中情况
 *
 * @param {Object} memory - 记忆对象
 * @param {string[]} promptSegments - 用户 prompt 的分词结果
 * @param {string[]} [querySegments] - 额外查询词的分词结果（保留参数，当前并入 prompt 计算）
 * @param {Map<string, string[]>} [segmentCache] - 分词缓存（避免对 memory.title/content 重复分词）
 * @returns {number} 关键词分数
 */
export function keywordScore(memory, promptSegments, querySegments, segmentCache) {
    const promptWords = promptSegments || [];
    const promptSet = new Set(promptWords);

    // 标签命中：完整匹配 +1，包含匹配 +0.5
    let tagHits = 0;
    const tags = Array.isArray(memory.tags) ? memory.tags : [];
    for (const tag of tags) {
        const tagLower = String(tag).toLowerCase();
        if (tagLower.length > 1 && promptSet.has(tagLower)) tagHits++;
        for (const pw of promptWords) {
            if (pw.length > 2 && tagLower.includes(pw) && tagLower !== pw) tagHits += 0.5;
        }
    }

    // 名称命中
    const nameWords = segmentText(memory.title || '', segmentCache);
    let nameHits = 0;
    for (const w of nameWords) {
        if (promptSet.has(w)) nameHits++;
    }

    // 内容命中
    const contentWords = segmentText(memory.content || '', segmentCache);
    let contentHits = 0;
    for (const w of contentWords) {
        if (promptSet.has(w)) contentHits++;
    }

    return tagHits * 20 + nameHits * 15 + contentHits * 5;
}

/**
 * 计算时间衰减分数（参考 deepseek-pp/memory/selector.ts:65-69 的 decayScore）
 * 越近期访问 + 访问次数越多，分数越高
 * @param {Object} memory - 记忆对象
 * @param {number} [now] - 当前时间戳（默认 Date.now()）
 * @returns {number} 衰减分数
 */
export function decayScore(memory, now) {
    const ts = typeof now === 'number' ? now : Date.now();
    const daysSinceAccess = (ts - (memory.lastAccessedAt || memory.updatedAt || 0)) / 86400000;
    const freshness = Math.max(0, 10 - daysSinceAccess * 0.1);
    return Math.min(memory.accessCount || 0, 20) + freshness;
}

/**
 * 根据 prompt token 数动态计算记忆预算（参考 deepseek-pp/memory/selector.ts:76-81 的 getMemoryBudget）
 * prompt 越长，记忆预算越小（避免上下文爆炸）
 * @param {number} promptTokens - prompt 的估算 token 数
 * @returns {number} 记忆 token 预算
 */
export function getMemoryBudget(promptTokens) {
    if (promptTokens > 3000) {
        return Math.max(800, MEMORY_TOKEN_BUDGET - Math.floor((promptTokens - 3000) * 0.2));
    }
    return MEMORY_TOKEN_BUDGET;
}

/**
 * 格式化单条记忆为注入行（参考 deepseek-pp/memory/selector.ts:128-132 的 formatMemoryLine）
 * @param {Object} m - 记忆对象
 * @returns {string} 格式化后的行
 */
export function formatMemoryLine(m) {
    const scopePrefix = m.scope === 'project' ? 'project ' : '';
    const cat = m.category || 'preference';
    // 净化内容中的分隔符，避免破坏格式
    const sanitize = s => String(s || '').replace(/｜/g, '|');
    // 包含记忆 ID，让 AI 在调用 memory_merge/memory_update/memory_delete/memory_recall 时能引用正确的 ID
    return `- [${scopePrefix}${cat}] (id:${sanitize(m.id)}) ${sanitize(m.title)}: ${sanitize(m.content)}`;
}

/**
 * 智能选择记忆（参考 deepseek-pp/memory/selector.ts:83-122 的 selectMemories）
 * 综合评分排序 + token 预算控制
 *
 * 新签名：selectMemories(memories, options)
 *   - memories 作为首参，由调用方传入（不隐式读取 store）
 *   - options.prompt / options.query / options.budget / options.now / options.segmentCache
 *
 * @param {Array<Object>} memories - 全部记忆数组
 * @param {Object} [options] - 选项
 * @param {string} [options.prompt=''] - 用户 prompt（主关键词来源）
 * @param {string} [options.query=''] - 额外查询词（保留参数，当前并入 prompt 计算）
 * @param {number} [options.budget=MEMORY_TOKEN_BUDGET] - token 预算
 * @param {number} [options.now] - 当前时间戳（默认 Date.now()）
 * @param {Map<string, string[]>} [options.segmentCache] - 分词缓存（实例隔离）
 * @returns {Array<Object>} 选中的记忆数组
 */
export function selectMemories(memories, options = {}) {
    if (!memories || memories.length === 0) return [];
    const {
        prompt = '',
        query = '',
        budget = MEMORY_TOKEN_BUDGET,
        now,
        segmentCache
    } = options;
    const nowTs = typeof now === 'number' ? now : Date.now();

    // 仅在已启用的记忆中筛选
    const candidates = memories.filter(m => m.enabled !== false);
    if (candidates.length === 0) return [];

    const promptSegments = segmentText(prompt, segmentCache);
    const querySegments = segmentText(query, segmentCache);

    // 综合评分：置顶 +1000，关键词分数 + 衰减分数 + 一小时内访问加成
    const scored = candidates.map(m => ({
        memory: m,
        score: (m.pinned ? 1000 : 0) +
               keywordScore(m, promptSegments, querySegments, segmentCache) +
               decayScore(m, nowTs) +
               (nowTs - (m.lastAccessedAt || 0) < 3600000 ? 5 : 0)
    }));

    scored.sort((a, b) => b.score - a.score);

    // 按预算依次纳入
    const selected = [];
    let remaining = budget;
    for (const { memory } of scored) {
        const cost = estimateTokens(formatMemoryLine(memory));
        if (remaining - cost < 0 && selected.length > 0) break;
        selected.push(memory);
        remaining -= cost;
    }

    return selected;
}
