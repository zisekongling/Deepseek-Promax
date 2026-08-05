/**
 * 仓库实例与名称归一化模块
 *
 * 创建两个 versionedRepository 仓库单例（userSkillRepository / skillSourceRepository），
 * 并提供 skill 名称归一化与去重工具。
 *
 * 与其他模块的关系：
 *   - 依赖 codec.js（提供 codec）和 persistence/versioned-repository.js
 *   - 被 api.js / import-staging.js / skill-doc-parser.js / github-importer.js / text-importer.js 导入
 *   - 是整个 skill 子系统的持久化中枢与依赖根
 */

import { createVersionedRepository, createLocalStorageSlot } from '../../persistence/versioned-repository.js';
import {
    userSkillCollectionCodec,
    skillSourceCollectionCodec,
    SKILLS_STORAGE_KEY,
    SKILL_SOURCES_STORAGE_KEY
} from './codec.js';

/**
 * 用户 Skill 仓库（custom + remote）
 *
 * 单例，使用 versionedRepository 保证 localStorage 数据的版本兼容与原子替换。
 */
export const userSkillRepository = createVersionedRepository({
    label: 'skills',
    createDefault: () => [],
    codec: userSkillCollectionCodec,
    storage: createLocalStorageSlot(SKILLS_STORAGE_KEY)
});

/** skill 源仓库（GitHub 源 / 文本源） */
export const skillSourceRepository = createVersionedRepository({
    label: 'skillSources',
    createDefault: () => [],
    codec: skillSourceCollectionCodec,
    storage: createLocalStorageSlot(SKILL_SOURCES_STORAGE_KEY)
});

/**
 * 把任意字符串归一化为合法的 kebab-case skill 名
 *
 * - 转小写
 * - 非 [a-z0-9-] 字符替换为 '-'
 * - 合并连续的 '-'
 * - 去除首尾 '-'
 * - 非法字符全部消失后（如纯中文标题）退化为 hash-derived slug，
 *   保证导入永远成功（用户可后续重命名）
 *
 * @param {string} name - 原始名称
 * @returns {string} kebab-case 名称（最长 64 字符）
 */
export function normalizeSkillName(name) {
    const normalized = String(name || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
    if (!normalized) return `skill-${shortHash(name || 'unnamed')}`;
    return normalized.slice(0, 64);
}

/**
 * 在已占用名称集合中为 preferred 生成唯一 skill 名
 *
 * 若 preferred 自身未占用，直接返回；否则追加 -2 / -3 ... 后缀直到找到空位。
 *
 * @param {string} preferred - 期望名（会被 normalizeSkillName 归一化）
 * @param {Set<string>} occupiedNames - 已占用名集合（会被原地修改）
 * @returns {string} 唯一的 kebab-case 名
 */
export function createUniqueSkillName(preferred, occupiedNames) {
    const normalized = normalizeSkillName(preferred);
    if (!occupiedNames.has(normalized)) return normalized;
    for (let suffix = 2; suffix < 1000; suffix += 1) {
        const candidate = `${normalized}-${suffix}`;
        if (!occupiedNames.has(candidate)) return candidate;
    }
    throw new Error(`Unable to generate a unique name for skill: ${preferred}`);
}

/**
 * 计算字符串的短 hash（用于非 ASCII 名称的兜底 slug 生成）
 * @param {string} input
 * @returns {string} 8 字符以内的 base36 hash
 */
export function shortHash(input) {
    let hash = 0;
    for (let i = 0; i < input.length; i += 1) {
        hash = (hash << 5) - hash + input.charCodeAt(i);
        hash |= 0;
    }
    return Math.abs(hash).toString(36).slice(0, 8).padStart(2, '0');
}
