/**
 * Skill 导入通用暂存模块
 *
 * github / text 两种导入路径共用的"upsert skill 源"逻辑：
 *   - 校验 source 与 incoming skills 的合法性
 *   - 解析现有同名 source，按 path 替换；新增 source 时追加
 *   - 处理名称冲突（已有同名 skill 时复用其 name，否则生成唯一 name）
 *
 * 与其他模块的关系：
 *   - 依赖 repository.js（两个仓库）、codec.js（decode*）、builtin-skills.js（BUILTIN_SKILLS）
 *   - 依赖 api.js（getSkillCollisionCandidates / getAllSkillSources）
 *   - 被 github-importer.js / text-importer.js 调用
 */

import {
    userSkillRepository,
    skillSourceRepository,
    createUniqueSkillName
} from './repository.js';
import { BUILTIN_SKILLS } from './builtin-skills.js';
import {
    decodeSkillImportSource,
    decodeUserSkill
} from './codec.js';
import {
    getSkillCollisionCandidates,
    getAllSkillSources,
    findUniqueSourceById
} from './api.js';

/**
 * 内部：暂存 upsert 一个 skill 源（github 或 text）
 *
 * - 校验 source 与 incoming skills 的合法性
 * - 解析现有同名 source，按 path 替换；新增 source 时追加
 * - 处理名称冲突（已有同名 skill 时复用其 name，否则生成唯一 name）
 *
 * @param {SkillImportSource} source
 * @param {Skill[]} incomingSkills
 * @returns {Promise<{imported: Skill[], replaced: number, renamed: number}>}
 */
export async function stageUpsertImportedSkillSource(source, incomingSkills) {
    const decodedSource = decodeSkillImportSource(source, 'skillSource');
    const decodedIncoming = incomingSkills.map((s, i) => decodeUserSkill(s, `skills[${i}]`));
    for (let i = 0; i < decodedIncoming.length; i++) {
        const skill = decodedIncoming[i];
        if (skill.source !== 'remote' || !skill.remote) {
            throw new Error(`skills[${i}] must be a remote Skill`);
        }
        if (skill.remote.sourceId !== decodedSource.id || skill.remote.provider !== decodedSource.provider) {
            throw new Error(`skills[${i}].remote does not match its Skill source`);
        }
    }
    const [existingUserSkills, existingSources] = await Promise.all([
        userSkillRepository.read(),
        skillSourceRepository.read()
    ]);
    const existingSource = findUniqueSourceById(existingSources, decodedSource.id);

    const sourceSkills = existingUserSkills.filter(
        s => s.source === 'remote' && s.remote && s.remote.sourceId === decodedSource.id
    );
    const sourceSkillByPath = new Map(sourceSkills.map(s => [s.remote.path, s]));
    const incomingPaths = new Set(decodedIncoming.map(s => s.remote && s.remote.path).filter(Boolean));
    const replaced = sourceSkills.filter(s => incomingPaths.has(s.remote && s.remote.path)).length;

    const occupiedNames = new Set([
        ...BUILTIN_SKILLS.map(s => s.name),
        ...existingUserSkills
            .filter(s => !(s.source === 'remote' && s.remote && s.remote.sourceId === decodedSource.id))
            .map(s => s.name)
    ]);
    let renamed = 0;
    const imported = decodedIncoming.map(skill => {
        const existing = skill.remote ? sourceSkillByPath.get(skill.remote.path) : undefined;
        const preferredName = existing?.name ?? skill.name;
        const name = existing ? preferredName : createUniqueSkillName(preferredName, occupiedNames);
        if (!existing && name !== preferredName) renamed += 1;
        occupiedNames.add(name);
        return {
            ...existing,
            ...skill,
            name,
            source: 'remote',
            enabled: existing?.enabled ?? skill.enabled ?? true,
            ...(skill.remote ? { remote: { ...existing?.remote, ...skill.remote } } : {})
        };
    });

    const nextUserSkills = [
        ...existingUserSkills.filter(s => !(s.source === 'remote' && s.remote && s.remote.sourceId === decodedSource.id)),
        ...imported
    ];
    const nextSource = {
        ...existingSource,
        ...decodedSource,
        skillPaths: imported.map(s => s.remote && s.remote.path).filter(Boolean),
        importedSkillNames: imported.map(s => s.name)
    };
    const nextSources = [
        ...existingSources.filter(s => s.id !== decodedSource.id),
        nextSource
    ];
    await userSkillRepository.replaceAlreadyLocked(nextUserSkills);
    await skillSourceRepository.replaceAlreadyLocked(nextSources);
    return { imported, replaced, renamed };
}

/**
 * 内部：构建已存在 skill 的上下文（用于碰撞检测）
 * @param {string} sourceId - 即将导入的 source id（也算作合法 source）
 * @returns {Promise<{occupiedNames: Set<string>, byName: Map<string, Skill>, bySourcePath: Map<string, Skill>}>}
 */
export async function createExistingSkillContext(sourceId) {
    const [skills, sources] = await Promise.all([
        getSkillCollisionCandidates(),
        getAllSkillSources()
    ]);
    const validSourceIds = new Set(sources.map(s => s.id));
    validSourceIds.add(sourceId);
    const byName = new Map(skills.map(s => [s.name, s]));
    const bySourcePath = new Map();
    for (const skill of skills) {
        if (skill.source === 'remote' && skill.remote && validSourceIds.has(skill.remote.sourceId)) {
            bySourcePath.set(`${skill.remote.sourceId}:${skill.remote.path}`, skill);
        }
    }
    return {
        occupiedNames: new Set(skills.map(s => s.name)),
        byName,
        bySourcePath
    };
}
