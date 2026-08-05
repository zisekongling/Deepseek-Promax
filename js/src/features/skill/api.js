/**
 * 对外 CRUD API 模块
 *
 * 提供 skill / skill source 的查询、保存、删除、启用切换、同步替换等接口。
 * 这是 skill 子系统对外暴露的"业务 API 层"，所有写操作都经过 codec 校验后
 * 才写入 versionedRepository。
 *
 * 与其他模块的关系：
 *   - 依赖 repository.js（两个仓库单例）和 builtin-skills.js（BUILTIN_SKILLS）
 *   - 依赖 codec.js（decodeUserSkill / decodeUserSkillCollection /
 *     decodeGitHubSkillSource / decodeSkillSourceCollection）
 *   - 被 settings-panel.js / prompt-augmentation.js / sync 模块 / import-staging.js 调用
 */

import {
    userSkillRepository,
    skillSourceRepository
} from './repository.js';
import { BUILTIN_SKILLS, getLocalizedBuiltinSkills } from './builtin-skills.js';
import {
    decodeUserSkill,
    decodeUserSkillCollection,
    decodeGitHubSkillSource,
    decodeSkillSourceCollection
} from './codec.js';

/**
 * 获取全部技能（builtin + custom + remote，按 enabled 过滤）
 * @param {Object} [options]
 * @param {boolean} [options.includeDisabled=false] - 是否包含 disabled 的 skill
 * @param {('zh-CN'|'en')} [options.locale='zh-CN'] - 内置技能的目标语言
 * @returns {Promise<Skill[]>}
 */
export async function getAllSkills(options = {}) {
    const { includeDisabled = false, locale = 'zh-CN' } = options;
    const userSkills = await userSkillRepository.read();
    const all = [...getLocalizedBuiltinSkills(locale), ...userSkills];
    return includeDisabled ? all : all.filter(s => s.enabled !== false);
}

/**
 * 按 name 查找技能
 * @param {string} name - 技能名（kebab-case）
 * @returns {Promise<Skill | null>}
 */
export async function getSkillByName(name) {
    const all = await getAllSkills({ includeDisabled: true });
    return all.find(s => s.name === name) || null;
}

/**
 * 保存自定义技能（新增或更新）
 *
 * 注意：
 *   - builtin 技能不可覆盖
 *   - 同名 custom/remote 技能会被更新（按 name 匹配）
 *   - 若传入 previousName，则按 previousName 查找并替换为新 name（重命名）
 *
 * @param {Skill} skill - 技能定义（source 必须为 'custom' 或 'remote'）
 * @param {string} [previousName] - 重命名场景下的旧 name
 * @returns {Promise<void>}
 */
export async function saveSkill(skill, previousName) {
    if (skill.source !== 'custom' && skill.source !== 'remote') {
        throw new Error(`[skill] saveSkill 仅支持 source='custom'|'remote'，收到 ${skill.source}`);
    }
    // 禁止覆盖 builtin
    if (BUILTIN_SKILLS.some(b => b.name === skill.name)) {
        throw new Error(`[skill] 不能覆盖内置技能: ${skill.name}`);
    }
    if (previousName !== undefined) {
        requireNonEmptyString(previousName, 'Previous Skill name');
    }
    const userSkills = await userSkillRepository.read();
    const namesToReplace = new Set([skill.name]);
    if (previousName) namesToReplace.add(previousName);
    const matchingIndexes = userSkills
        .map((item, index) => namesToReplace.has(item.name) ? index : -1)
        .filter(index => index >= 0);
    if (matchingIndexes.length > 1) {
        throw new Error('Skill edit is ambiguous because multiple custom/remote Skills use the same name');
    }
    const insertIndex = matchingIndexes[0] ?? -1;
    const existingSkill = insertIndex >= 0 ? userSkills[insertIndex] : undefined;
    const savedSkill = decodeUserSkill({
        ...existingSkill,
        ...skill,
        enabled: skill.enabled === undefined ? true : skill.enabled
    }, 'skill');
    const next = userSkills.filter(s => !namesToReplace.has(s.name));
    if (insertIndex >= 0) {
        next.splice(Math.min(insertIndex, next.length), 0, savedSkill);
    } else {
        next.push(savedSkill);
    }
    await userSkillRepository.replaceAlreadyLocked(next);
}

/**
 * 删除用户技能
 *
 * 若该技能是 remote 源，会同时从对应的 skill source 中移除其路径。
 *
 * @param {string} name - 技能名
 * @returns {Promise<void>}
 */
export async function deleteSkill(name) {
    requireNonEmptyString(name, 'Skill name');
    const [userSkills, sources] = await Promise.all([
        userSkillRepository.read(),
        skillSourceRepository.read()
    ]);
    const removedSkills = userSkills.filter(s => s.name === name);
    const nextSkills = userSkills.filter(s => s.name !== name);
    let nextSources = sources;
    for (const skill of removedSkills) {
        if (skill.source === 'remote' && skill.remote) {
            nextSources = removeSkillFromSources(
                nextSources,
                skill.remote.sourceId,
                skill.remote.path,
                skill.name
            );
        }
    }
    if (nextSkills.length !== userSkills.length) {
        await userSkillRepository.replaceAlreadyLocked(nextSkills);
    }
    if (nextSources !== sources) {
        await skillSourceRepository.replaceAlreadyLocked(nextSources);
    }
}

/**
 * 切换技能启用状态（仅对 custom/remote 生效；builtin 始终启用）
 * @param {string} name - 技能名
 * @param {boolean} enabled - 是否启用
 * @returns {Promise<void>}
 */
export async function setSkillEnabled(name, enabled) {
    await setSkillsEnabled([{ name, enabled }]);
}

/**
 * 批量切换多个技能的启用状态（单次 IO 完成全部更新）
 * @param {Array<{name: string, enabled: boolean}>} updates
 * @returns {Promise<void>}
 */
export async function setSkillsEnabled(updates) {
    if (!Array.isArray(updates) || updates.length === 0) return;
    for (const update of updates) {
        requireNonEmptyString(update.name, 'Skill name');
        if (typeof update.enabled !== 'boolean') {
            throw new Error('Skill enabled must be a boolean');
        }
    }
    const updateByName = new Map(updates.map(u => [u.name, u.enabled]));
    const userSkills = await userSkillRepository.read();
    let changed = false;
    const next = userSkills.map(skill => {
        if (!updateByName.has(skill.name)) return skill;
        const enabled = updateByName.get(skill.name) ?? true;
        changed = true;
        return { ...skill, enabled };
    });
    if (!changed) return;
    await userSkillRepository.replaceAlreadyLocked(next);
}

/**
 * 渲染技能指令（把 {args} 占位符替换为实际参数）
 * @param {Skill} skill - 技能定义
 * @param {string} args - 用户传入的参数
 * @returns {string} 渲染后的指令文本
 */
export function renderSkillInstructions(skill, args) {
    return skill.instructions.replace(/\{args\}/g, args || '');
}

/**
 * 获取全部 skill 源（github / text）
 * @returns {Promise<SkillImportSource[]>}
 */
export async function getAllSkillSources() {
    return skillSourceRepository.read();
}

/**
 * 按 id 查找 skill 源
 * @param {string} sourceId
 * @returns {Promise<SkillImportSource | null>}
 */
export async function getSkillSourceById(sourceId) {
    requireNonEmptyString(sourceId, 'Skill source id');
    const sources = await getAllSkillSources();
    return findUniqueSourceById(sources, sourceId);
}

/**
 * 按 id 查找 GitHub skill 源
 * @param {string} sourceId
 * @returns {Promise<GitHubSkillSource | null>}
 */
export async function getGitHubSkillSourceById(sourceId) {
    const source = await getSkillSourceById(sourceId);
    return source && source.provider === 'github' ? source : null;
}

/**
 * 更新 GitHub skill 源的 lastCheckedAt（用于检查更新时间记录）
 * @param {string} sourceId
 * @param {number} lastCheckedAt
 * @returns {Promise<GitHubSkillSource>}
 */
export async function updateGitHubSkillSourceLastCheckedAt(sourceId, lastCheckedAt) {
    requireNonEmptyString(sourceId, 'Skill source id');
    if (!Number.isFinite(lastCheckedAt)) throw new Error('Skill source lastCheckedAt must be finite');
    const sources = await skillSourceRepository.read();
    const source = findUniqueSourceById(sources, sourceId);
    if (!source || source.provider !== 'github') {
        throw new Error('GitHub Skill source was not found');
    }
    const index = sources.indexOf(source);
    const updated = decodeGitHubSkillSource({ ...source, lastCheckedAt }, 'skillSource');
    const next = [...sources];
    next[index] = updated;
    await skillSourceRepository.replaceAlreadyLocked(next);
    return updated;
}

/**
 * 删除 skill 源（同时删除该源下的所有 remote skill）
 * @param {string} sourceId
 * @returns {Promise<void>}
 */
export async function deleteSkillSource(sourceId) {
    requireNonEmptyString(sourceId, 'Skill source id');
    const [userSkills, sources] = await Promise.all([
        userSkillRepository.read(),
        skillSourceRepository.read()
    ]);
    const nextSkills = userSkills.filter(s => !(s.source === 'remote' && s.remote && s.remote.sourceId === sourceId));
    const nextSources = sources.filter(s => s.id !== sourceId);
    await userSkillRepository.replaceAlreadyLocked(nextSkills);
    await skillSourceRepository.replaceAlreadyLocked(nextSources);
}

/**
 * 替换全部 custom 源 skill（同步模块用）
 * @param {Skill[]} skills
 * @returns {Promise<void>}
 */
export async function replaceAllCustomSkills(skills) {
    const decoded = decodeUserSkillCollection(skills, 'skills');
    // 仅保留 remote 源，custom 源用传入值替换
    const current = await userSkillRepository.read();
    const remote = current.filter(s => s.source === 'remote');
    await userSkillRepository.replaceAlreadyLocked([...decoded, ...remote]);
}

/**
 * 替换全部 skill 源（同步模块用）
 * @param {SkillImportSource[]} sources
 * @returns {Promise<void>}
 */
export async function replaceAllSkillSources(sources) {
    const decoded = decodeSkillSourceCollection(sources, 'skillSources');
    await skillSourceRepository.replaceAlreadyLocked(decoded);
}

/**
 * 获取全部 skill 名称（用于碰撞检测）
 * @returns {Promise<Array<{name: string, source: string, enabled: boolean, remote?: any}>>}
 */
export async function getSkillCollisionCandidates() {
    const userSkills = await userSkillRepository.read();
    return [
        ...BUILTIN_SKILLS.map(({ name, source }) => ({ name, source })),
        ...userSkills.map(({ name, source, enabled, remote }) => ({ name, source, enabled, remote }))
    ];
}

/** 内部工具：要求非空字符串 */
export function requireNonEmptyString(value, label) {
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new Error(`${label} is required`);
    }
}

/** 内部工具：按 id 查找唯一 source（重复 id 视为冲突） */
export function findUniqueSourceById(sources, sourceId) {
    const matches = sources.filter(s => s.id === sourceId);
    if (matches.length > 1) {
        throw new Error(`Skill source mutation is ambiguous because the id is duplicated: ${sourceId}`);
    }
    return matches[0] ?? null;
}

/** 内部工具：从 source 的 skillPaths/importedSkillNames 中移除指定 skill */
export function removeSkillFromSources(sources, sourceId, path, name) {
    return sources
        .map(source => {
            if (source.id !== sourceId) return source;
            return {
                ...source,
                skillPaths: source.skillPaths.filter(item => item !== path),
                importedSkillNames: source.importedSkillNames.filter(item => item !== name),
                updatedAt: Date.now()
            };
        })
        .filter(source => source.skillPaths.length > 0);
}
