/**
 * 同步策略模块
 *
 * 标识哪些 skill / skill 源是 local-only（仅本地，不参与同步），
 * 哪些是 syncable（可同步到远端）。
 *
 * 规则：
 *   - provider='text'（用户粘贴文本导入）视为 local-only
 *   - provider='github'（GitHub 导入）视为 syncable
 *
 * 与其他模块的关系：
 *   被 sync 模块（WebDAV 同步）调用，决定哪些数据纳入同步范围。
 */

/**
 * 判断 skill 是否为 local-only（仅本地，不参与同步）
 *
 * js 项目中 provider='text' 的 skill 视为 local-only（用户粘贴的临时内容，
 * 不应同步到远端）。provider='github' 的 skill 可同步。
 *
 * @param {Skill} skill
 * @returns {boolean} true 表示是 local-only skill
 */
export function isLocalOnlySkill(skill) {
    return skill && skill.source === 'remote' && skill.remote && skill.remote.provider === 'text';
}

/**
 * 判断 skill 源是否为 local-only
 * @param {SkillImportSource} source
 * @returns {boolean}
 */
export function isLocalOnlySkillSource(source) {
    return source && source.provider === 'text';
}

/**
 * 判断 skill 是否可同步（非 local-only）
 * @param {Skill} skill
 * @returns {boolean}
 */
export function isSyncableSkill(skill) {
    return !isLocalOnlySkill(skill);
}

/**
 * 判断 skill 源是否可同步
 * @param {SkillImportSource} source
 * @returns {boolean}
 */
export function isSyncableSkillSource(source) {
    return !isLocalOnlySkillSource(source);
}
