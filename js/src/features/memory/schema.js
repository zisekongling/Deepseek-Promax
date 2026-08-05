/**
 * @module features/memory/schema
 *
 * 记忆系统的 schema 定义：常量 + 纯函数。
 * 纯数据 + 纯函数，无副作用，不依赖任何 store 实例或运行时状态。
 *
 * 抽出目的（P4 重构）：
 *   - 将记忆分类/触发词/停用词/Token 预算等常量集中管理
 *   - 提供分类校验与归一化的纯函数
 *   - 供 selector.js / store.js / memory.js（聚合入口）共享
 */

/** 记忆分类中文标签映射（兼容旧版 category 字段，等价于 deepseek-pp 的 MemoryType） */
export const CATEGORY_LABELS = {
    preference: '偏好',
    context: '上下文',
    fact: '事实',
    instruction: '指令'
};

/** 记忆分类标签颜色映射 */
export const CATEGORY_COLORS = {
    preference: '#3b82f6',   // 蓝色
    context: '#22c55e',      // 绿色
    fact: '#f59e0b',         // 橙色
    instruction: '#8b5cf6'   // 紫色
};

/** 合法的分类值列表 */
export const VALID_CATEGORIES = Object.keys(CATEGORY_LABELS);

/** 记忆范围标签映射 */
export const SCOPE_LABELS = {
    global: '全局',
    project: '项目'
};

/** 自动提取记忆的关键词列表（命中任一即自动保存） */
export const MEMORY_TRIGGERS = [
    '请记住', '记住这个', '以后都', '我的偏好是', '我喜欢', '我不喜欢',
    '我的习惯是', '对我来说', '对我而言', '你需要知道',
    'remember that', 'note that', 'my preference', 'i prefer', 'i like', 'i don\'t like'
];

/** 中文停用词集合（参考 deepseek-pp/constants.ts:105-119 的 STOP_WORDS） */
export const STOP_WORDS = new Set([
    '的', '了', '在', '是', '我', '有', '和', '就', '不', '人', '都', '一', '一个',
    '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有', '看', '好',
    '自己', '这', '他', '她', '它', '们', '那', '里', '之', '中', '与', '而', '为',
    '以', '及', '等', '被', '把', '让', '给', '从', '向', '对', '但', '如果', '因为',
    '所以', '虽然', '可以', '能', '想', '知道', '时候', '没', '什么', '怎么', '这个',
    '那个', '还', '过', '吗', '呢', '吧', '啊', '嗯', '哦', '呀', '啦', '使用',
    'the', 'be', 'to', 'of', 'and', 'a', 'in', 'that', 'have', 'i', 'it', 'for',
    'not', 'on', 'with', 'he', 'as', 'you', 'do', 'at', 'this', 'but', 'his',
    'by', 'from', 'they', 'we', 'she', 'or', 'an', 'will', 'my', 'one', 'all',
    'would', 'there', 'their', 'what', 'so', 'up', 'out', 'if', 'about', 'who',
    'get', 'which', 'go', 'me', 'when', 'make', 'can', 'like', 'no', 'just',
    'him', 'know', 'take', 'into', 'your', 'some', 'could', 'them', 'than',
    'other', 'been', 'has', 'its', 'use', 'two', 'how', 'our', 'way'
]);

/** 记忆 Token 预算（参考 deepseek-pp/constants.ts:3 的 MEMORY_TOKEN_BUDGET） */
export const MEMORY_TOKEN_BUDGET = 1500;

/**
 * 判断分类值是否合法
 * @param {string} cat - 待校验的分类值
 * @returns {boolean} 是否为合法分类
 */
export function isValidCategory(cat) {
    return VALID_CATEGORIES.includes(cat);
}

/**
 * 规范化分类值，非法值回退到 'preference'
 * @param {string} cat - 待归一化的分类值
 * @returns {string} 合法分类值（preference/context/fact/instruction）
 */
export function normalizeCategory(cat) {
    return isValidCategory(cat) ? cat : 'preference';
}
