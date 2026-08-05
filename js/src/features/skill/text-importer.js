/**
 * 文本导入器模块（js 项目独有，替代 deepseek-pp 的 local-importer）
 *
 * 从用户粘贴的 SKILL.md 文本导入单个 skill。
 * 与 GitHub 导入不同：
 *   - 不依赖 shell MCP / 本地文件系统
 *   - 用户直接把 SKILL.md 内容粘贴到 UI 文本框
 *   - 创建一个 provider='text' 的 SkillImportSource 记录来源
 *
 * 与其他模块的关系：
 *   - 依赖 skill-doc-parser.js（parseSkillDoc）
 *   - 依赖 repository.js（normalizeSkillName / createUniqueSkillName / shortHash）
 *   - 依赖 import-staging.js（stageUpsertImportedSkillSource / createExistingSkillContext）
 *   - 依赖 github-importer.js（MAX_SKILL_BYTES 复用上限）
 *   - 被 settings-panel.js 调用
 */

import { parseSkillDoc } from './skill-doc-parser.js';
import {
    normalizeSkillName,
    createUniqueSkillName,
    shortHash
} from './repository.js';
import {
    stageUpsertImportedSkillSource,
    createExistingSkillContext
} from './import-staging.js';
import { MAX_SKILL_BYTES } from './github-importer.js';

/**
 * 从粘贴的 SKILL.md 文本导入单个 skill
 *
 * 与 GitHub 导入不同：
 *   - 不依赖 shell MCP / 本地文件系统
 *   - 用户直接把 SKILL.md 内容粘贴到 UI 文本框
 *   - 创建一个 provider='text' 的 SkillImportSource 记录来源
 *
 * @param {Object} input
 * @param {string} input.content - SKILL.md 原始文本
 * @param {string} [input.displayName] - 用户可读的源名称（如 "粘贴的 SKILL.md"）
 * @param {string} [input.skillName] - 用户指定的导入名（缺失时用 SKILL.md 中的 name）
 * @returns {Promise<{ok: boolean, source?: TextSkillSource, imported?: Skill[], error?: string}>}
 */
export async function importSkillFromText(input) {
    if (!input || typeof input.content !== 'string' || !input.content.trim()) {
        return { ok: false, error: 'SKILL.md 内容不能为空' };
    }
    if (input.content.length > MAX_SKILL_BYTES) {
        return { ok: false, error: `SKILL.md 过大（${input.content.length} bytes，上限 ${MAX_SKILL_BYTES}）` };
    }
    const parsed = parseSkillDoc(input.content, 'SKILL.md');
    const displayName = (input.displayName && String(input.displayName).trim()) || `Text: ${parsed.name}`;
    const now = Date.now();
    const sourceId = `text:${shortHash(displayName + parsed.name)}:${now}`;
    const existingContext = await createExistingSkillContext(sourceId);
    const baseImportName = input.skillName && String(input.skillName).trim()
        ? normalizeSkillName(input.skillName)
        : parsed.name;
    const importName = createUniqueSkillName(baseImportName, existingContext.occupiedNames);
    existingContext.occupiedNames.add(importName);

    const remote = {
        provider: 'text',
        sourceId,
        path: 'SKILL.md',
        originalName: parsed.name,
        importedAt: now,
        updatedAt: now,
        lastCheckedAt: now,
        includedFiles: [{ path: 'SKILL.md', bytes: input.content.length }],
        omittedFiles: [],
        warnings: [],
        upstreamVersion: parsed.version,
        upstreamUpdatedAt: parsed.lastUpdated
    };
    const skill = {
        name: importName,
        description: parsed.description,
        instructions: buildTextImportedInstructions({ displayName, parsed, content: input.content }),
        source: 'remote',
        memoryEnabled: false,
        enabled: true,
        metadata: {
            provider: 'text',
            sourceId,
            originalName: parsed.name,
            upstreamVersion: parsed.version ?? ''
        },
        remote
    };
    const source = {
        id: sourceId,
        provider: 'text',
        displayName,
        skillPaths: ['SKILL.md'],
        importedSkillNames: [importName],
        importedAt: now,
        updatedAt: now,
        lastCheckedAt: now,
        description: parsed.description
    };
    const result = await stageUpsertImportedSkillSource(source, [skill]);
    return {
        ok: true,
        source: { ...source, importedSkillNames: result.imported.map(s => s.name) },
        imported: result.imported
    };
}

/**
 * 内部：把粘贴的 SKILL.md 内容渲染为最终 instructions（附带导入元信息）
 * @param {{displayName: string, parsed: Object, content: string}} input
 * @returns {string}
 */
function buildTextImportedInstructions(input) {
    const { displayName, parsed, content } = input;
    const header = [
        `# Text Skill: ${parsed.name}`,
        '',
        '## DeepSeek++ Import Metadata',
        '',
        `- Source: ${displayName}`,
        `- Imported at: ${new Date().toISOString()}`,
        `- Body bytes: ${content.length}`,
        parsed.version ? `- Upstream version: ${parsed.version}` : '',
        parsed.lastUpdated ? `- Upstream updated: ${parsed.lastUpdated}` : ''
    ].filter(Boolean).join('\n');
    const body = ['## Upstream SKILL.md', '', parsed.body.trim()].join('\n');
    return [header, body].filter(Boolean).join('\n\n---\n\n');
}
