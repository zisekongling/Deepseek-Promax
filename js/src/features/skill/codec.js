/**
 * 编解码器模块（含 metadata / remote / schemaVersion 校验）
 *
 * 提供对 Skill / SkillImportSource / RemoteSkillMetadata 等数据结构的校验与解码。
 * 所有 decode* 函数遵循"严格校验 + 抛出 Error"的契约，遇到非法字段会抛出包含 path 的错误信息。
 *
 * 与其他模块的关系：
 *   - 被 repository.js 导入（提供 codec 给 versionedRepository）
 *   - 被 api.js 导入（decodeUserSkill / decodeSkillImportSource 用于 saveSkill / replaceAll*）
 *   - 被 import-staging.js 导入（decodeSkillImportSource / decodeUserSkill 用于暂存校验）
 *   - 被 api.js 导入（decodeGitHubSkillSource 用于 updateGitHubSkillSourceLastCheckedAt）
 */

/** localStorage 键名 */
export const SKILLS_STORAGE_KEY = 'deepseek_pp_skills';
export const SKILL_SOURCES_STORAGE_KEY = 'deepseek_pp_skill_sources';

/** Skill 记录的 schema 版本（用于未来迁移） */
export const SKILL_RECORD_SCHEMA_VERSION = 1;
/** Skill 源记录的 schema 版本 */
export const SKILL_SOURCE_RECORD_SCHEMA_VERSION = 1;

/** Skill.source 允许的取值 */
const SKILL_SOURCES = new Set(['builtin', 'custom', 'remote']);
/** 用户可保存的 Skill.source（仅 custom 与 remote 进仓库） */
const USER_SKILL_SOURCES = new Set(['custom', 'remote']);
/** SkillImportSource.provider 允许的取值 */
const IMPORTED_SKILL_PROVIDERS = new Set(['github', 'text']);

/**
 * 校验并解码单个 Skill（任意 source）
 * @param {unknown} value
 * @param {string} [path='skill']
 * @returns {Skill}
 */
export function decodeSkill(value, path = 'skill') {
    const object = recordValue(value, path);
    assertOptionalSchemaVersion(object.schemaVersion, SKILL_RECORD_SCHEMA_VERSION, path);
    const source = enumValue(object.source, SKILL_SOURCES, `${path}.source`);
    return {
        ...object,
        name: requiredString(object.name, `${path}.name`),
        description: stringValue(object.description, `${path}.description`),
        instructions: requiredString(object.instructions, `${path}.instructions`),
        source,
        memoryEnabled: booleanValue(object.memoryEnabled, `${path}.memoryEnabled`),
        enabled: object.enabled === undefined
            ? true
            : booleanValue(object.enabled, `${path}.enabled`),
        ...(object.metadata === undefined
            ? {}
            : { metadata: stringRecord(object.metadata, `${path}.metadata`) }),
        ...(object.remote === undefined
            ? {}
            : { remote: decodeRemoteSkillMetadata(object.remote, `${path}.remote`) })
    };
}

/**
 * 校验并解码用户 Skill（source 必须是 custom 或 remote）
 * @param {unknown} value
 * @param {string} [path='skill']
 * @returns {Skill}
 */
export function decodeUserSkill(value, path = 'skill') {
    const skill = decodeSkill(value, path);
    if (!USER_SKILL_SOURCES.has(skill.source)) {
        throw new Error(`${path}.source must be custom or remote`);
    }
    return skill;
}

/**
 * 校验并解码 Skill 集合（用户仓库用）
 * @param {unknown} value
 * @param {string} [path='skills']
 * @returns {Skill[]}
 */
export function decodeUserSkillCollection(value, path = 'skills') {
    return releasedArray(value, path)
        .map((item, index) => decodeUserSkill(item, `${path}[${index}]`));
}

/**
 * 校验并解码 SkillImportSource（github 或 text）
 * @param {unknown} value
 * @param {string} [path='skillSource']
 * @returns {SkillImportSource}
 */
export function decodeSkillImportSource(value, path = 'skillSource') {
    const object = recordValue(value, path);
    if (object.provider === 'github') return decodeGitHubSkillSource(object, path);
    if (object.provider === 'text') return decodeTextSkillSource(object, path);
    throw new Error(`${path}.provider must be github or text`);
}

/**
 * 校验并解码 GitHub Skill 源
 * @param {unknown} value
 * @param {string} [path='skillSource']
 * @returns {GitHubSkillSource}
 */
export function decodeGitHubSkillSource(value, path = 'skillSource') {
    const object = recordValue(value, path);
    assertOptionalSchemaVersion(object.schemaVersion, SKILL_SOURCE_RECORD_SCHEMA_VERSION, path);
    if (object.provider !== 'github') throw new Error(`${path}.provider must be github`);
    return {
        ...object,
        id: requiredString(object.id, `${path}.id`),
        provider: 'github',
        url: requiredString(object.url, `${path}.url`),
        owner: requiredString(object.owner, `${path}.owner`),
        repo: requiredString(object.repo, `${path}.repo`),
        repository: requiredString(object.repository, `${path}.repository`),
        ref: requiredString(object.ref, `${path}.ref`),
        rootPath: stringValue(object.rootPath, `${path}.rootPath`),
        commitSha: requiredString(object.commitSha, `${path}.commitSha`),
        defaultBranch: requiredString(object.defaultBranch, `${path}.defaultBranch`),
        repoUrl: requiredString(object.repoUrl, `${path}.repoUrl`),
        skillPaths: stringArray(object.skillPaths, `${path}.skillPaths`),
        importedSkillNames: stringArray(object.importedSkillNames, `${path}.importedSkillNames`),
        importedAt: finiteNumber(object.importedAt, `${path}.importedAt`),
        updatedAt: finiteNumber(object.updatedAt, `${path}.updatedAt`),
        ...(object.lastCheckedAt === undefined ? {} : { lastCheckedAt: finiteNumber(object.lastCheckedAt, `${path}.lastCheckedAt`) }),
        ...(object.licenseName === undefined ? {} : { licenseName: stringValue(object.licenseName, `${path}.licenseName`) }),
        ...(object.licenseSpdxId === undefined ? {} : { licenseSpdxId: stringValue(object.licenseSpdxId, `${path}.licenseSpdxId`) }),
        ...(object.packageVersion === undefined ? {} : { packageVersion: stringValue(object.packageVersion, `${path}.packageVersion`) }),
        ...(object.description === undefined ? {} : { description: stringValue(object.description, `${path}.description`) })
    };
}

/**
 * 校验并解码文本 Skill 源（js 项目独有：替代 deepseek-pp 的 local-importer）
 * @param {unknown} value
 * @param {string} [path='skillSource']
 * @returns {TextSkillSource}
 */
export function decodeTextSkillSource(value, path = 'skillSource') {
    const object = recordValue(value, path);
    assertOptionalSchemaVersion(object.schemaVersion, SKILL_SOURCE_RECORD_SCHEMA_VERSION, path);
    if (object.provider !== 'text') throw new Error(`${path}.provider must be text`);
    return {
        ...object,
        id: requiredString(object.id, `${path}.id`),
        provider: 'text',
        displayName: requiredString(object.displayName, `${path}.displayName`),
        skillPaths: stringArray(object.skillPaths, `${path}.skillPaths`),
        importedSkillNames: stringArray(object.importedSkillNames, `${path}.importedSkillNames`),
        importedAt: finiteNumber(object.importedAt, `${path}.importedAt`),
        updatedAt: finiteNumber(object.updatedAt, `${path}.updatedAt`),
        ...(object.lastCheckedAt === undefined ? {} : { lastCheckedAt: finiteNumber(object.lastCheckedAt, `${path}.lastCheckedAt`) }),
        ...(object.description === undefined ? {} : { description: stringValue(object.description, `${path}.description`) })
    };
}

/**
 * 校验并解码远程 Skill 的元信息（remote 字段）
 * @param {unknown} value
 * @param {string} path
 * @returns {RemoteSkillMetadata}
 */
export function decodeRemoteSkillMetadata(value, path) {
    const object = recordValue(value, path);
    const provider = enumValue(object.provider, IMPORTED_SKILL_PROVIDERS, `${path}.provider`);
    return {
        ...object,
        provider,
        sourceId: requiredString(object.sourceId, `${path}.sourceId`),
        path: requiredString(object.path, `${path}.path`),
        originalName: requiredString(object.originalName, `${path}.originalName`),
        importedAt: finiteNumber(object.importedAt, `${path}.importedAt`),
        updatedAt: finiteNumber(object.updatedAt, `${path}.updatedAt`),
        includedFiles: fileArray(object.includedFiles, `${path}.includedFiles`),
        omittedFiles: fileArray(object.omittedFiles, `${path}.omittedFiles`),
        warnings: stringArray(object.warnings, `${path}.warnings`),
        ...(object.sourceUrl === undefined ? {} : { sourceUrl: stringValue(object.sourceUrl, `${path}.sourceUrl`) }),
        ...(object.repository === undefined ? {} : { repository: stringValue(object.repository, `${path}.repository`) }),
        ...(object.ref === undefined ? {} : { ref: stringValue(object.ref, `${path}.ref`) }),
        ...(object.commitSha === undefined ? {} : { commitSha: stringValue(object.commitSha, `${path}.commitSha`) }),
        ...(object.lastCheckedAt === undefined ? {} : { lastCheckedAt: finiteNumber(object.lastCheckedAt, `${path}.lastCheckedAt`) }),
        ...(object.upstreamVersion === undefined ? {} : { upstreamVersion: stringValue(object.upstreamVersion, `${path}.upstreamVersion`) }),
        ...(object.upstreamUpdatedAt === undefined ? {} : { upstreamUpdatedAt: stringValue(object.upstreamUpdatedAt, `${path}.upstreamUpdatedAt`) })
    };
}

/**
 * 校验并解码 SkillImportSource 集合
 * @param {unknown} value
 * @param {string} [path='skillSources']
 * @returns {SkillImportSource[]}
 */
export function decodeSkillSourceCollection(value, path = 'skillSources') {
    return releasedArray(value, path)
        .map((item, index) => decodeSkillImportSource(item, `${path}[${index}]`));
}

/** 文件数组元素解码（path + bytes） */
function fileArray(value, path) {
    return arrayValue(value, path).map((item, index) => {
        const object = recordValue(item, `${path}[${index}]`);
        const bytes = finiteNumber(object.bytes, `${path}[${index}].bytes`);
        if (bytes < 0) throw new Error(`${path}[${index}].bytes must be non-negative`);
        return {
            ...object,
            path: requiredString(object.path, `${path}[${index}].path`),
            bytes
        };
    });
}

/** 校验输入是数组（或抛出"必须用 released array schema"错误） */
function releasedArray(value, path) {
    if (Array.isArray(value)) return value;
    if (value && typeof value === 'object' && 'schemaVersion' in value) {
        throw new Error(`${path}.schemaVersion is not supported`);
    }
    throw new Error(`${path} must use the released array schema`);
}

/** 校验输入是非空对象 */
function recordValue(value, path) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`${path} must be an object`);
    }
    return value;
}

/** 校验输入是数组 */
function arrayValue(value, path) {
    if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
    return value;
}

/** 校验输入是非空字符串 */
function requiredString(value, path) {
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new Error(`${path} must be a non-empty string`);
    }
    return value;
}

/** 校验输入是字符串 */
function stringValue(value, path) {
    if (typeof value !== 'string') throw new Error(`${path} must be a string`);
    return value;
}

/** 校验输入是布尔 */
function booleanValue(value, path) {
    if (typeof value !== 'boolean') throw new Error(`${path} must be a boolean`);
    return value;
}

/** 校验输入是有限数字 */
function finiteNumber(value, path) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error(`${path} must be a finite number`);
    }
    return value;
}

/** 校验输入是字符串数组 */
function stringArray(value, path) {
    return arrayValue(value, path).map((item, index) => stringValue(item, `${path}[${index}]`));
}

/** 校验输入是字符串键值对 */
function stringRecord(value, path) {
    const object = recordValue(value, path);
    for (const [key, item] of Object.entries(object)) {
        if (typeof item !== 'string') throw new Error(`${path}.${key} must be a string`);
    }
    return { ...object };
}

/** 校验输入是允许的枚举值 */
function enumValue(value, allowed, path) {
    if (typeof value !== 'string' || !allowed.has(value)) {
        throw new Error(`${path} is not supported`);
    }
    return value;
}

/** schemaVersion 可选字段校验（不在或等于当前版本即通过） */
function assertOptionalSchemaVersion(value, currentVersion, path) {
    if (value !== undefined && value !== currentVersion) {
        throw new Error(`${path}.schemaVersion is not supported`);
    }
}

/** Skill 集合 codec（供 versionedRepository 使用） */
export const userSkillCollectionCodec = {
    decode: decodeUserSkillCollection,
    encode(value) { return decodeUserSkillCollection(value, 'skills'); }
};

/** Skill 源集合 codec */
export const skillSourceCollectionCodec = {
    decode: decodeSkillSourceCollection,
    encode(value) { return decodeSkillSourceCollection(value, 'skillSources'); }
};
