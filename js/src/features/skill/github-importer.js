/**
 * GitHub 导入器模块（浏览器/WebView 直接 fetch GitHub API）
 *
 * 实现 GitHub URL 解析、仓库元信息拉取、SKILL.md 内容获取、资源文件合并、
 * 碰撞检测与最终写入的完整流程。
 *
 * 与其他模块的关系：
 *   - 依赖 skill-doc-parser.js（parseSkillDoc / parentDirectory）
 *   - 依赖 repository.js（createUniqueSkillName）
 *   - 依赖 import-staging.js（stageUpsertImportedSkillSource / createExistingSkillContext）
 *   - 依赖 api.js（getGitHubSkillSourceById / updateGitHubSkillSourceLastCheckedAt）
 *   - 被 text-importer.js 导入（复用 MAX_SKILL_BYTES）
 *   - 被 settings-panel.js 调用
 */

import { parseSkillDoc, parentDirectory } from './skill-doc-parser.js';
import { createUniqueSkillName } from './repository.js';
import {
    stageUpsertImportedSkillSource,
    createExistingSkillContext
} from './import-staging.js';
import {
    getGitHubSkillSourceById,
    updateGitHubSkillSourceLastCheckedAt
} from './api.js';

const GITHUB_API_BASE = 'https://api.github.com';
const GITHUB_RAW_BASE = 'https://raw.githubusercontent.com';
const MAX_SKILLS_PER_SOURCE = 80;
/** 单个 SKILL.md 文件最大字节数（也被 text-importer 复用） */
export const MAX_SKILL_BYTES = 120_000;
const MAX_RESOURCE_FILES_PER_SKILL = 16;
const MAX_RESOURCE_BYTES_PER_SKILL = 100_000;
const MAX_RESOURCE_FILE_BYTES = 40_000;
const GITHUB_REQUEST_TIMEOUT_MS = 20_000;

/** 视为文本资源的扩展名（其他二进制文件不合并进 prompt） */
const TEXT_RESOURCE_EXTENSIONS = new Set(['.md', '.txt', '.yaml', '.yml', '.json', '.tex']);

/**
 * 解析 GitHub URL
 *
 * 支持三种模式：
 *   - repo:  https://github.com/owner/repo
 *   - tree:  https://github.com/owner/repo/tree/branch/path
 *   - blob:  https://github.com/owner/repo/blob/branch/path/SKILL.md
 *   - raw:   https://raw.githubusercontent.com/owner/repo/branch/path/SKILL.md
 *   - shorthand: owner/repo
 *
 * @param {string} input
 * @returns {{owner: string, repo: string, mode: 'repo'|'tree'|'blob', ref?: string, path: string, refPathParts?: string[], url: string}}
 */
function parseGitHubUrl(input) {
    const trimmed = String(input || '').trim();
    if (!trimmed) throw new Error('GitHub 链接不能为空');

    // shorthand: owner/repo
    const shorthand = trimmed.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)(?:\.git)?$/);
    if (shorthand) {
        const repoName = stripGitSuffix(shorthand[2]);
        return {
            owner: shorthand[1],
            repo: repoName,
            mode: 'repo',
            path: '',
            url: `https://github.com/${shorthand[1]}/${repoName}`
        };
    }

    let url;
    try {
        url = new URL(trimmed);
    } catch {
        throw new Error('请输入 GitHub 仓库、目录或 SKILL.md 链接');
    }

    // raw.githubusercontent.com
    if (url.hostname === 'raw.githubusercontent.com') {
        const [owner, repo, ...refPathParts] = url.pathname.split('/').filter(Boolean);
        if (!owner || !repo || refPathParts.length < 2) {
            throw new Error('raw GitHub 链接缺少仓库或路径');
        }
        const [ref, ...pathParts] = refPathParts;
        const path = pathParts.join('/');
        return {
            owner,
            repo: stripGitSuffix(repo),
            mode: path.endsWith('SKILL.md') ? 'blob' : 'tree',
            ref,
            path,
            refPathParts,
            url: trimmed
        };
    }

    if (url.hostname !== 'github.com') {
        throw new Error('目前只支持 github.com 或 raw.githubusercontent.com 链接');
    }

    const [owner, rawRepo, action, ...rest] = url.pathname.split('/').filter(Boolean);
    if (!owner || !rawRepo) throw new Error('GitHub 链接缺少 owner/repo');
    const repo = stripGitSuffix(rawRepo);

    if (action === 'tree' || action === 'blob') {
        if (rest.length === 0) throw new Error('GitHub tree/blob 链接缺少分支');
        return {
            owner,
            repo,
            mode: action,
            ref: rest[0],
            path: rest.slice(1).join('/'),
            refPathParts: rest,
            url: trimmed
        };
    }

    return { owner, repo, mode: 'repo', path: '', url: trimmed };
}

/**
 * 预览 GitHub 源（不写入仓库，仅返回找到的 SKILL.md 列表）
 * @param {string} url - GitHub URL
 * @returns {Promise<GitHubSkillPreview>}
 */
export async function previewGitHubSkillSource(url) {
    const loaded = await loadGitHubSkillSource(url);
    return loaded.preview;
}

/**
 * 导入 GitHub 源（写入仓库）
 *
 * @param {Object} request
 * @param {string} request.url - GitHub URL
 * @param {string[]} request.selectedPaths - 选中的 SKILL.md 路径列表
 * @returns {Promise<GitHubSkillImportResult>}
 */
export async function importGitHubSkillSource(request) {
    if (!request || !Array.isArray(request.selectedPaths) || request.selectedPaths.length === 0) {
        throw new Error('至少选择一个 Skill 后再导入');
    }
    const loaded = await loadGitHubSkillSource(request.url, new Set(request.selectedPaths));
    const selected = loaded.skills.filter(s => request.selectedPaths.includes(s.item.path));
    const importedPaths = new Set(selected.map(s => s.item.path));
    const missingPaths = request.selectedPaths.filter(p => !importedPaths.has(p));
    if (missingPaths.length > 0) {
        throw new Error(`选中的 Skill 路径在 GitHub 源中不存在: ${missingPaths.join(', ')}`);
    }
    if (selected.length === 0) {
        throw new Error('选中的 Skill 路径在 GitHub 源中不存在');
    }

    const now = Date.now();
    const source = {
        ...loaded.preview.source,
        skillPaths: selected.map(s => s.item.path),
        importedSkillNames: selected.map(s => s.skill.name),
        updatedAt: now,
        lastCheckedAt: now
    };
    const incomingSkills = selected.map(loadedSkill => ({
        ...loadedSkill.skill,
        remote: loadedSkill.skill.remote ? {
            ...loadedSkill.skill.remote,
            importedAt: loadedSkill.skill.remote.importedAt || now,
            updatedAt: now,
            lastCheckedAt: now
        } : undefined
    }));

    const result = await stageUpsertImportedSkillSource(source, incomingSkills);
    return {
        ok: true,
        source: {
            ...source,
            importedSkillNames: result.imported.map(s => s.name)
        },
        imported: result.imported,
        replaced: result.replaced,
        renamed: result.renamed,
        warnings: loaded.preview.warnings
    };
}

/**
 * 检查 GitHub 源是否有更新（仅查询，不写入）
 * @param {string} sourceId
 * @returns {Promise<GitHubSkillUpdatePreview>}
 */
export async function checkGitHubSkillSourceUpdates(sourceId) {
    const source = await getGitHubSkillSourceById(sourceId);
    if (!source) throw new Error('找不到 GitHub Skill 源');
    const loaded = await loadGitHubSkillSource(source.url);
    const latestPaths = new Set(loaded.preview.skills.map(s => s.path));
    const currentPaths = new Set(source.skillPaths);
    const missingPaths = source.skillPaths.filter(p => !latestPaths.has(p));
    const newPaths = loaded.preview.skills.map(s => s.path).filter(p => !currentPaths.has(p));
    const existingPaths = source.skillPaths.filter(p => latestPaths.has(p));
    const hasCommitUpdates = loaded.preview.source.commitSha !== source.commitSha;
    const latestVersion = loaded.preview.source.packageVersion;
    const checkedAt = Date.now();
    const checkedSource = await updateGitHubSkillSourceLastCheckedAt(source.id, checkedAt);
    return {
        source: checkedSource,
        latestCommitSha: loaded.preview.source.commitSha,
        latestVersion,
        hasUpdates: hasCommitUpdates || missingPaths.length > 0 || newPaths.length > 0 || latestVersion !== source.packageVersion,
        changedPaths: hasCommitUpdates ? existingPaths : [],
        missingPaths,
        newPaths,
        warnings: loaded.preview.warnings,
        checkedAt
    };
}

/**
 * 更新 GitHub 源（重新拉取并写入）
 * @param {string} sourceId
 * @returns {Promise<GitHubSkillImportResult>}
 */
export async function updateGitHubSkillSource(sourceId) {
    const source = await getGitHubSkillSourceById(sourceId);
    if (!source) throw new Error('找不到 GitHub Skill 源');
    const loaded = await loadGitHubSkillSource(source.url);
    const latestPaths = new Set(loaded.preview.skills.map(s => s.path));
    const selectedPaths = source.skillPaths.filter(p => latestPaths.has(p));
    if (selectedPaths.length === 0) {
        throw new Error('上游已不包含这个源当前导入的 Skill，已停止更新以避免清空本地内容');
    }
    return importGitHubSkillSource({ url: source.url, selectedPaths });
}

/**
 * 内部：加载 GitHub 源（fetch repo metadata + tree + 各 SKILL.md 内容 + 资源文件）
 * @param {string} url
 * @param {Set<string>} [selectedPaths]
 * @returns {Promise<{preview: GitHubSkillPreview, skills: Array<{item: GitHubSkillPreviewItem, skill: Skill}>}>}
 */
async function loadGitHubSkillSource(url, selectedPaths) {
    const parsedUrl = parseGitHubUrl(url);
    const repo = await fetchGitHubJson(`/repos/${parsedUrl.owner}/${parsedUrl.repo}`);
    const resolved = await resolveSourceLocation(parsedUrl, repo.default_branch);
    const [tree, packageInfo] = await Promise.all([
        fetchGitHubJson(`/repos/${parsedUrl.owner}/${parsedUrl.repo}/git/trees/${encodeURIComponent(resolved.ref)}?recursive=1`),
        fetchPackageInfo(parsedUrl.owner, parsedUrl.repo, resolved.commit.sha)
    ]);
    const sourceId = createGitHubSourceId(parsedUrl.owner, parsedUrl.repo, resolved.ref, resolved.rootPath);
    const skillPaths = findSkillPaths(tree, resolved.rootPath, parsedUrl.mode);
    const warnings = [];
    if (tree.truncated) warnings.push('GitHub 返回的仓库树已截断，可能遗漏部分 Skill 文件');
    if (skillPaths.length === 0) throw new Error('没有在这个 GitHub 链接下找到 SKILL.md');
    if (skillPaths.length > MAX_SKILLS_PER_SOURCE) {
        warnings.push(`找到 ${skillPaths.length} 个 Skill，仅预览前 ${MAX_SKILLS_PER_SOURCE} 个`);
    }
    const limitedPaths = skillPaths.slice(0, MAX_SKILLS_PER_SOURCE);
    const now = Date.now();
    const source = {
        id: sourceId,
        provider: 'github',
        url: normalizeSourceUrl(parsedUrl.url),
        owner: parsedUrl.owner,
        repo: parsedUrl.repo,
        repository: repo.full_name,
        ref: resolved.ref,
        rootPath: resolved.rootPath,
        commitSha: resolved.commit.sha,
        defaultBranch: repo.default_branch,
        repoUrl: repo.html_url,
        licenseName: repo.license?.name ?? undefined,
        licenseSpdxId: repo.license?.spdx_id ?? repo.license?.key ?? undefined,
        packageVersion: packageInfo.version,
        description: packageInfo.description ?? repo.description ?? undefined,
        skillPaths: limitedPaths,
        importedSkillNames: [],
        importedAt: now,
        updatedAt: now,
        lastCheckedAt: now
    };

    const existingContext = await createExistingSkillContext(sourceId);
    const loadedSkills = [];
    for (const skillPath of limitedPaths) {
        if (selectedPaths && !selectedPaths.has(skillPath)) continue;
        loadedSkills.push(await loadGitHubSkill(parsedUrl.owner, parsedUrl.repo, source.commitSha, source, tree, skillPath, existingContext));
    }

    const previewSkills = selectedPaths
        ? limitedPaths.map(p => loadedSkills.find(s => s.item.path === p)?.item).filter(Boolean)
        : loadedSkills.map(s => s.item);

    return {
        preview: {
            source: {
                ...source,
                skillPaths: previewSkills.map(s => s.path),
                importedSkillNames: previewSkills.map(s => s.importName)
            },
            skills: previewSkills,
            warnings,
            truncated: tree.truncated || skillPaths.length > MAX_SKILLS_PER_SOURCE
        },
        skills: loadedSkills
    };
}

/**
 * 内部：加载单个 GitHub Skill（fetch 内容 + 资源文件 + 构建 instructions）
 */
async function loadGitHubSkill(owner, repo, ref, source, tree, skillPath, existingContext) {
    const warnings = [];
    const content = await fetchGitHubContent(owner, repo, ref, skillPath);
    if (content.length > MAX_SKILL_BYTES) {
        throw new Error(`${skillPath} 过大，已停止导入 (${content.length} bytes)`);
    }
    const parsed = parseSkillDoc(content, skillPath);
    const resourceBundle = await fetchResourceBundle(owner, repo, ref, tree, skillPath, parsed.body);
    warnings.push(...resourceBundle.warnings);

    const existingRemoteSkill = existingContext.bySourcePath.get(`${source.id}:${skillPath}`);
    const baseImportName = existingRemoteSkill?.name ?? parsed.name;
    const importName = existingRemoteSkill?.name ?? createUniqueSkillName(baseImportName, existingContext.occupiedNames);
    existingContext.occupiedNames.add(importName);

    const now = Date.now();
    const instructions = buildGitHubImportedInstructions({ source, skillPath, parsed, resources: resourceBundle });
    const remote = {
        provider: 'github',
        sourceId: source.id,
        sourceUrl: source.url,
        repository: source.repository,
        ref: source.ref,
        commitSha: source.commitSha,
        path: skillPath,
        originalName: parsed.name,
        importedAt: existingRemoteSkill?.remote?.importedAt ?? now,
        updatedAt: now,
        lastCheckedAt: now,
        licenseName: source.licenseName,
        licenseSpdxId: source.licenseSpdxId,
        upstreamVersion: parsed.version,
        upstreamUpdatedAt: parsed.lastUpdated,
        includedFiles: resourceBundle.included.map(({ content: _c, ...file }) => file),
        omittedFiles: resourceBundle.omitted,
        warnings
    };
    const skill = {
        name: importName,
        description: parsed.description,
        instructions,
        source: 'remote',
        memoryEnabled: false,
        enabled: existingRemoteSkill?.enabled ?? true,
        metadata: {
            provider: 'github',
            sourceId: source.id,
            repository: source.repository,
            ref: source.ref,
            path: skillPath,
            commitSha: source.commitSha,
            originalName: parsed.name,
            license: source.licenseSpdxId ?? source.licenseName ?? '',
            upstreamVersion: parsed.version ?? ''
        },
        remote
    };

    const conflictingSkill = existingContext.byName.get(parsed.name);
    const item = {
        path: skillPath,
        name: parsed.name,
        importName,
        description: parsed.description,
        version: parsed.version,
        lastUpdated: parsed.lastUpdated,
        bytes: content.length + remote.includedFiles.reduce((sum, f) => sum + f.bytes, 0),
        bodyBytes: content.length,
        includedFiles: remote.includedFiles,
        omittedFiles: remote.omittedFiles,
        warnings,
        nameChanged: importName !== parsed.name,
        existingSkillName: existingRemoteSkill?.name ?? conflictingSkill?.name,
        existingSourceId: existingRemoteSkill?.remote?.sourceId ?? conflictingSkill?.remote?.sourceId
    };
    return { item, skill };
}

/**
 * 内部：把 GitHub SKILL.md 内容 + 资源文件渲染为最终 instructions
 */
function buildGitHubImportedInstructions(input) {
    const { source, skillPath, parsed, resources } = input;
    const header = [
        `# GitHub Skill: ${parsed.name}`,
        '',
        '## DeepSeek++ Import Metadata',
        '',
        `- Source: ${source.repository}`,
        `- Path: ${skillPath}`,
        `- Ref: ${source.ref}`,
        `- Commit: ${source.commitSha}`,
        `- License: ${source.licenseSpdxId ?? source.licenseName ?? 'Unknown'}`,
        parsed.version ? `- Upstream version: ${parsed.version}` : '',
        parsed.lastUpdated ? `- Upstream updated: ${parsed.lastUpdated}` : '',
        `- Bundled supporting files: ${resources.included.length}`,
        resources.omitted.length > 0 ? `- Omitted supporting files: ${resources.omitted.length}` : ''
    ].filter(Boolean).join('\n');
    const body = ['## Upstream SKILL.md', '', parsed.body.trim()].join('\n');
    const resourceDocs = resources.included.length === 0 ? '' : [
        '## Bundled Supporting Files',
        '',
        '这些文件来自同一个上游 Skill 目录，用于补齐原始 SKILL.md 中引用的 agents、references、templates 或 examples。',
        '',
        ...resources.included.map(r => [`### ${r.path}`, '', r.content.trim()].join('\n'))
    ].join('\n\n');
    const omitted = resources.omitted.length === 0 ? '' : [
        '## Omitted Supporting Files',
        '',
        '以下文件因为数量或大小限制没有合并进 prompt；需要时请参考上游仓库。',
        '',
        ...resources.omitted.map(f => `- ${f.path} (${f.bytes} bytes)`)
    ].join('\n');
    return [header, body, resourceDocs, omitted].filter(Boolean).join('\n\n---\n\n');
}

/**
 * 内部：拉取 Skill 同目录下的资源文件（references/agents/templates/examples）
 */
async function fetchResourceBundle(owner, repo, ref, tree, skillPath, skillBody) {
    const directory = parentDirectory(skillPath);
    const prefix = directory ? `${directory}/` : '';
    const candidates = tree.tree
        .filter(entry => entry.type === 'blob')
        .filter(entry => entry.path.startsWith(prefix))
        .filter(entry => entry.path !== skillPath)
        .filter(entry => isTextResource(entry.path))
        .sort((a, b) => rankResource(a.path, skillBody) - rankResource(b.path, skillBody) || a.path.localeCompare(b.path));

    const included = [];
    const omitted = [];
    const warnings = [];
    let totalBytes = 0;

    for (const candidate of candidates) {
        const size = candidate.size ?? 0;
        if (included.length >= MAX_RESOURCE_FILES_PER_SKILL) {
            omitted.push({ path: candidate.path, bytes: size });
            continue;
        }
        if (size > MAX_RESOURCE_FILE_BYTES) {
            omitted.push({ path: candidate.path, bytes: size });
            warnings.push(`${candidate.path} 超过单文件资源上限，未合并`);
            continue;
        }
        if (totalBytes + size > MAX_RESOURCE_BYTES_PER_SKILL) {
            omitted.push({ path: candidate.path, bytes: size });
            continue;
        }
        const content = await fetchGitHubContent(owner, repo, ref, candidate.path);
        totalBytes += content.length;
        included.push({ path: candidate.path, bytes: content.length, content });
    }
    if (omitted.length > 0) {
        warnings.push(`有 ${omitted.length} 个同目录资源未合并，可在上游仓库中查看`);
    }
    return { included, omitted, warnings };
}

/** 判断文件扩展名是否为文本资源 */
function isTextResource(path) {
    return TEXT_RESOURCE_EXTENSIONS.has(pathExtension(path));
}

/** 按与 SKILL.md 正文的关联度给资源文件排序（被引用的优先） */
function rankResource(path, skillBody) {
    const relativeName = path.split('/').slice(-2).join('/');
    if (skillBody.includes(path) || skillBody.includes(relativeName)) return 0;
    if (path.includes('/agents/')) return 1;
    if (path.includes('/references/')) return 2;
    if (path.includes('/templates/')) return 3;
    if (path.includes('/examples/')) return 4;
    return 5;
}

/** 取文件扩展名（含 .，小写） */
function pathExtension(path) {
    const name = path.split('/').pop() ?? '';
    const index = name.lastIndexOf('.');
    return index >= 0 ? name.slice(index).toLowerCase() : '';
}

/** 内部：解析 GitHub URL 的源位置（ref + rootPath） */
async function resolveSourceLocation(parsed, defaultBranch) {
    const candidates = createSourceLocationCandidates(parsed, defaultBranch);
    for (const candidate of candidates) {
        const commit = await fetchOptionalGitHubJson(`/repos/${parsed.owner}/${parsed.repo}/commits/${encodeURIComponent(candidate.ref)}`);
        if (commit) return { ...candidate, commit };
    }
    throw new Error('GitHub 链接中的分支、标签或提交不存在');
}

/** 内部：根据 URL 模式生成候选的 (ref, rootPath) 组合 */
function createSourceLocationCandidates(parsed, defaultBranch) {
    if (parsed.mode === 'repo') {
        return [{ ref: parsed.ref ?? defaultBranch, rootPath: trimSlashes(parsed.path) }];
    }
    const parts = parsed.refPathParts?.filter(Boolean) ?? [];
    if (parts.length === 0) {
        return [{ ref: defaultBranch, rootPath: trimSlashes(parsed.path) }];
    }
    const candidates = [];
    const defaultBranchParts = defaultBranch.split('/').filter(Boolean);
    if (startsWithSegments(parts, defaultBranchParts)) {
        candidates.push({
            ref: defaultBranch,
            rootPath: parts.slice(defaultBranchParts.length).join('/')
        });
    }
    for (let refLength = parts.length; refLength >= 1; refLength -= 1) {
        candidates.push({
            ref: parts.slice(0, refLength).join('/'),
            rootPath: parts.slice(refLength).join('/')
        });
    }
    return dedupeSourceLocationCandidates(candidates);
}

/** 内部：判断 parts 是否以 prefix 开头 */
function startsWithSegments(parts, prefix) {
    return prefix.length > 0 && prefix.every((p, i) => parts[i] === p);
}

/** 内部：去重 (ref, rootPath) 候选 */
function dedupeSourceLocationCandidates(candidates) {
    const seen = new Set();
    return candidates.filter(c => {
        const key = `${c.ref}\n${c.rootPath}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

/** 内部：从 GitHub tree 中找到所有 SKILL.md 路径 */
function findSkillPaths(tree, rootPath, mode) {
    const normalizedRoot = trimSlashes(rootPath);
    if (mode === 'blob') {
        if (!normalizedRoot.endsWith('SKILL.md')) {
            throw new Error('单文件导入只支持 SKILL.md');
        }
        const exists = tree.tree.some(e => e.type === 'blob' && e.path === normalizedRoot);
        if (!exists) throw new Error(`GitHub 源中不存在 ${normalizedRoot}`);
        return [normalizedRoot];
    }
    const prefix = normalizedRoot ? `${normalizedRoot}/` : '';
    return tree.tree
        .filter(e => e.type === 'blob')
        .map(e => e.path)
        .filter(p => p === `${prefix}SKILL.md` || (p.startsWith(prefix) && p.endsWith('/SKILL.md')))
        .sort((a, b) => a.localeCompare(b));
}

/** 内部：从 GitHub 仓库读取 package.json / plugin.json，提取 version/description */
async function fetchPackageInfo(owner, repo, ref) {
    for (const path of ['.codex-plugin/plugin.json', '.claude-plugin/plugin.json', 'package.json']) {
        const raw = await fetchOptionalGitHubContent(owner, repo, ref, path);
        if (raw === null) continue;
        let parsed;
        try {
            parsed = JSON.parse(raw);
        } catch {
            throw new Error(`${path} 不是有效 JSON，已停止导入`);
        }
        return {
            version: typeof parsed.version === 'string' ? parsed.version : undefined,
            description: typeof parsed.description === 'string' ? parsed.description : undefined
        };
    }
    return {};
}

/** 内部：可选地获取 GitHub raw 内容（404 视为不存在，其他错误抛出） */
async function fetchOptionalGitHubContent(owner, repo, ref, path) {
    try {
        return await fetchGitHubContent(owner, repo, ref, path);
    } catch (error) {
        if (isGitHubHttpStatus(error, 404)) return null;
        throw error;
    }
}

/** 内部：可选地获取 GitHub API JSON（404 视为不存在） */
async function fetchOptionalGitHubJson(path) {
    try {
        return await fetchGitHubJson(path);
    } catch (error) {
        if (isGitHubHttpStatus(error, 404)) return null;
        throw error;
    }
}

/** 内部：获取 GitHub raw 文本内容（带超时） */
async function fetchGitHubContent(owner, repo, ref, path) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), GITHUB_REQUEST_TIMEOUT_MS);
    try {
        const response = await fetch(createGitHubRawUrl(owner, repo, ref, path), {
            signal: controller.signal,
            headers: { accept: 'text/plain, application/octet-stream' }
        });
        if (!response.ok) {
            const detail = await response.text().catch(() => '');
            throw new Error(`GitHub raw content request failed (HTTP ${response.status})${detail ? `: ${detail.slice(0, 180)}` : ''}`);
        }
        return await response.text();
    } catch (error) {
        if (error && error.name === 'AbortError') {
            throw new Error('GitHub raw content request timed out');
        }
        if (error instanceof TypeError) {
            throw new Error('Unable to access GitHub raw content. Grant raw.githubusercontent.com access and confirm the network is available.');
        }
        throw error;
    } finally {
        clearTimeout(timeout);
    }
}

/** 内部：获取 GitHub API JSON（带超时与限流提示） */
async function fetchGitHubJson(path) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), GITHUB_REQUEST_TIMEOUT_MS);
    try {
        const response = await fetch(`${GITHUB_API_BASE}${path}`, {
            signal: controller.signal,
            headers: {
                accept: 'application/vnd.github+json',
                'x-github-api-version': '2022-11-28'
            }
        });
        if (!response.ok) {
            const detail = await response.text().catch(() => '');
            if ((response.status === 403 || response.status === 429) && /rate limit/i.test(detail)) {
                throw new Error('GitHub API rate limit exceeded while reading repository metadata. Wait for the GitHub rate-limit window to reset, then retry.');
            }
            throw new Error(`GitHub 请求失败 (HTTP ${response.status})${detail ? `: ${detail.slice(0, 180)}` : ''}`);
        }
        return await response.json();
    } catch (error) {
        if (error && error.name === 'AbortError') {
            throw new Error('GitHub 请求超时');
        }
        if (error instanceof TypeError) {
            throw new Error('无法访问 GitHub API，请先授予 GitHub 访问权限并确认网络可用');
        }
        throw error;
    } finally {
        clearTimeout(timeout);
    }
}

/** 内部：判断错误是否为指定 HTTP 状态 */
function isGitHubHttpStatus(error, status) {
    const message = error instanceof Error ? error.message : String(error);
    return message.includes(`HTTP ${status}`);
}

/** 内部：拼接 raw.githubusercontent.com URL */
function createGitHubRawUrl(owner, repo, ref, path) {
    return [
        GITHUB_RAW_BASE,
        encodeURIComponent(owner),
        encodeURIComponent(repo),
        encodeURIComponent(ref),
        ...path.split('/').map(encodeURIComponent)
    ].join('/');
}

/** 内部：拼接 sourceId */
function createGitHubSourceId(owner, repo, ref, rootPath) {
    return `github:${owner}/${repo}:${ref}:${rootPath || '.'}`;
}

/** 内部：归一化 source URL（去尾斜杠） */
function normalizeSourceUrl(url) {
    return url.replace(/\/+$/, '');
}

/** 内部：剥离 .git 后缀 */
function stripGitSuffix(value) {
    return value.replace(/\.git$/, '');
}

/** 内部：去除首尾斜杠 */
function trimSlashes(value) {
    return String(value).replace(/^\/+|\/+$/g, '');
}
