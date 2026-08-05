/**
 * SKILL.md 解析模块
 *
 * 解析 SKILL.md 文本（YAML frontmatter + Markdown 正文），输出结构化的 skill 元信息。
 * YAML 解析使用内置的简化版（不引入第三方库），仅支持简单标量、块级字符串和嵌套对象。
 *
 * 与其他模块的关系：
 *   - 依赖 repository.js（normalizeSkillName）
 *   - 被 github-importer.js 导入（解析远端 SKILL.md）
 *   - 被 text-importer.js 导入（解析用户粘贴的 SKILL.md）
 */

import { normalizeSkillName } from './repository.js';

/**
 * 解析 SKILL.md 文本
 *
 * 格式：
 *   ---
 *   name: my-skill
 *   description: 描述
 *   metadata:
 *     version: 1.0.0
 *     last_updated: 2026-08-04
 *   ---
 *   正文（Markdown）
 *
 * name 缺失时退化到 H1 标题 / 父目录名 / 文件名。
 * description 缺失时退化到正文第一段。
 *
 * @param {string} raw - SKILL.md 原始文本
 * @param {string} [path='SKILL.md'] - 文件路径（用于 fallback name 推断）
 * @returns {{name: string, description: string, body: string, version?: string, lastUpdated?: string}}
 */
export function parseSkillDoc(raw, path = 'SKILL.md') {
    // 剥离 UTF-8/UTF-16 BOM（Windows 上 Notepad/VS Code 常带 BOM，会导致 frontmatter 正则失配）
    const bomStripped = String(raw).replace(/^\uFEFF/, '');
    const frontmatter = bomStripped.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
    const meta = frontmatter ? parseYamlSubset(frontmatter[1]) : {};
    const body = frontmatter ? bomStripped.slice(frontmatter[0].length).trim() : bomStripped.trim();
    const name = normalizeSkillName(
        readString(meta, 'name')
        ?? extractH1Title(body)
        ?? parentDirectory(path).split(/[\\/]/).pop()
        ?? path.replace(/\/?SKILL\.md$/i, '')
    );
    const description = readString(meta, 'description') ?? firstParagraph(body) ?? `Imported Skill from ${path}`;
    const metadata = readObject(meta, 'metadata');
    const version = readString(metadata, 'version') ?? readString(meta, 'version');
    const lastUpdated = readString(metadata, 'last_updated') ?? readString(metadata, 'lastUpdated') ?? readString(meta, 'last_updated');
    return { name, description, body, version, lastUpdated };
}

/** 从正文提取第一个 H1 标题作为 fallback name */
function extractH1Title(body) {
    const match = body.match(/^\s*#\s+(.+?)\s*$/m);
    return match ? match[1] : undefined;
}

/**
 * 解析 YAML 子集（不引入完整 yaml 库）
 *
 * 支持：
 *   - 简单标量 key: value
 *   - 块级字符串 key: | 或 key: > （折叠/不折叠）
 *   - 嵌套对象 key:\n  sub: value
 *
 * @param {string} raw
 * @returns {Record<string, unknown>}
 */
function parseYamlSubset(raw) {
    const lines = raw.replace(/\r\n/g, '\n').split('\n');
    const result = {};
    for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        const match = line.match(/^([A-Za-z0-9_-]+):(?:\s*(.*))?$/);
        if (!match) continue;
        const key = match[1];
        const value = match[2] ?? '';
        if (value === '|' || value === '|-' || value === '>' || value === '>-') {
            const block = [];
            while (i + 1 < lines.length && /^(\s+|$)/.test(lines[i + 1])) {
                i += 1;
                block.push(lines[i].replace(/^\s{2,}/, ''));
            }
            result[key] = value.startsWith('>')
                ? block.join(' ').replace(/\s+/g, ' ').trim()
                : block.join('\n').trim();
            continue;
        }
        if (value === '') {
            const nested = {};
            while (i + 1 < lines.length && /^\s+/.test(lines[i + 1])) {
                i += 1;
                const nestedMatch = lines[i].match(/^\s+([A-Za-z0-9_-]+):\s*(.*)$/);
                if (nestedMatch) nested[nestedMatch[1]] = cleanYamlScalar(nestedMatch[2]);
            }
            result[key] = nested;
            continue;
        }
        result[key] = cleanYamlScalar(value);
    }
    return result;
}

/** 剥离 YAML 标量两侧的引号 */
function cleanYamlScalar(value) {
    const trimmed = value.trim();
    if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
        (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
        return trimmed.slice(1, -1);
    }
    return trimmed;
}

/** 从 YAML record 读字符串（空字符串视为缺失） */
function readString(record, key) {
    const value = record ? record[key] : undefined;
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/** 从 YAML record 读嵌套对象 */
function readObject(record, key) {
    const value = record ? record[key] : undefined;
    return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
}

/** 取正文的第一个非空非代码段落作为 fallback description */
function firstParagraph(body) {
    const paragraph = body
        .replace(/^# .+$/m, '')
        .split(/\n\s*\n/)
        .map(part => part.replace(/\s+/g, ' ').trim())
        .find(part => part.length > 0 && !part.startsWith('```'));
    return paragraph ? paragraph.slice(0, 240) : undefined;
}

/** 取路径的父目录（同时兼容 / 与 \） */
export function parentDirectory(path) {
    const normalized = String(path).replace(/\\/g, '/');
    const parts = normalized.split('/');
    parts.pop();
    return parts.join('/');
}
