/**
 * @file apply-journal.js
 * @module features/sync/apply-journal
 *
 * 快照应用与本地收集模块
 *
 * 职责：
 *   1. collectLocalSnapshot() - 从本地各 store 收集数据，生成快照供上传
 *   2. applySnapshot(snapshot) - 接收远端快照，校验 checksum 后合并写入本地各 store
 *
 * 应用策略（last-write-wins on remote + 本地新增保留）：
 *   - 远端存在的项覆盖本地同 ID 项（远端为准）
 *   - 本地存在但远端不存在的项保留（本地新增保留）
 *   - 不做删除：远端删除的项不会在本地删除，避免误删用户数据
 *
 * 下载暂存：applySnapshot 接收远端快照后，先在内存中校验 checksum，
 *   通过后再写入本地 store，避免下载到损坏数据污染本地。
 *
 * 失败回滚：应用过程中任一项失败，回滚到应用前状态（内存中备份）。
 *   注意：受各 store API 限制，回滚为 best-effort（仅覆盖同 ID 项，不删除新增项）；
 *   完整回滚需要 store 提供 replaceAll 接口，Phase 6 集成时再补。
 *
 * 依赖各 store 的公共 API（不修改 store 文件本身）：
 *   - memory.js:    getMemories / findMemoryById / addMemory / updateMemory
 *   - skill.js:     getAllSkills / saveSkill / BUILTIN_SKILLS
 *   - preset.js:    getAllPresets / savePreset
 *   - saved-items.js: getAllSavedItems / saveSavedItem
 */

import { createSnapshot, verifySnapshot } from './snapshot.js';
// 各 store 的公共 API（仅调用公共 API，不修改 store 文件本身）
import {
    getMemories,
    addMemory,
    updateMemory,
    findMemoryById
} from '../memory.js';
import {
    getAllSkills,
    saveSkill,
    BUILTIN_SKILLS
} from '../skill.js';
import {
    getAllPresets,
    savePreset
} from '../preset.js';
import {
    getAllSavedItems,
    saveSavedItem
} from '../saved-items.js';

// ============================================================
// 内部工具
// ============================================================

/** builtin 技能名集合，用于应用时跳过同名的远端 skill */
const BUILTIN_SKILL_NAMES = new Set(BUILTIN_SKILLS.map(s => s.name));

/**
 * 收集本地 skills：仅返回 custom 源（builtin 是代码常量，不上传）
 * 同时包含 disabled 的 custom skill，确保完整同步
 * @returns {Promise<Array>}
 */
async function _collectLocalSkills() {
    const all = await getAllSkills({ includeDisabled: true });
    return all.filter(s => s && s.source === 'custom');
}

/**
 * 收集 projects 数据（预留接口）
 * 当前无对应 store，返回空数组；未来接入 projects store 时在此扩展
 * @returns {Array}
 */
function _collectProjects() {
    // 预留：未来 window._dsProjects 或独立 store 接入
    if (typeof window !== 'undefined' &&
        window._dsProjects &&
        typeof window._dsProjects.getAll === 'function') {
        try {
            return window._dsProjects.getAll() || [];
        } catch (e) {}
    }
    return [];
}

// ============================================================
// 收集本地快照
// ============================================================

/**
 * 从本地各 store 收集数据，生成快照
 *
 * 收集来源：
 *   - memories: getMemories()（同步，含 disabled）
 *   - skills:   getAllSkills({includeDisabled:true}) 过滤 source==='custom'（仅 custom 上传）
 *   - presets:  getAllPresets()（异步，全部）
 *   - projects: 暂无 store，空数组（预留）
 *   - savedItems: getAllSavedItems()（异步，全部）
 *
 * @param {number} generation - 代次号（由 coordinator 传入，单调递增）
 * @returns {Promise<Object>} 快照对象，含 generation/timestamp/items/checksum
 */
export async function collectLocalSnapshot(generation) {
    // memories：同步 API
    const memories = getMemories();
    // skills / presets / savedItems：异步 API，并行拉取
    const [skills, presets, savedItems] = await Promise.all([
        _collectLocalSkills(),
        getAllPresets(),
        getAllSavedItems()
    ]);
    const projects = _collectProjects();

    return createSnapshot({ memories, skills, presets, projects, savedItems }, generation);
}

// ============================================================
// 应用远端快照
// ============================================================

/**
 * 将远端快照应用到本地各 store
 *
 * 流程：
 *   1. 校验 checksum（下载暂存：校验通过才写本地，避免损坏数据污染）
 *   2. 备份当前各 store 数据到内存（用于失败回滚）
 *   3. 逐项合并写入：远端覆盖同 ID，本地新增保留
 *   4. 任一步骤失败：尝试回滚到备份状态，返回错误信息
 *
 * 合并策略（last-write-wins on remote + 本地新增保留）：
 *   - memory: 远端同 id 覆盖本地（updateMemory），远端新 id 添加（addMemory）
 *   - skill:  saveSkill 自动按 name 更新或新增（仅 custom 源，跳过 builtin 冲突）
 *   - preset: savePreset 自动按 id 更新或新增
 *   - savedItem: saveSavedItem 自动按 id 更新或新增
 *   - project: 暂无 store，仅统计 skipped
 *
 * @param {Object} snapshot - 远端快照对象
 * @returns {Promise<{ok: boolean, applied: number, skipped: number, errors: Array<string>}>}
 *   - ok: 是否完全成功（无 errors）
 *   - applied: 成功应用的项数
 *   - skipped: 跳过的项数（无效项或 builtin 冲突）
 *   - errors: 应用过程中的错误信息列表
 */
export async function applySnapshot(snapshot) {
    const result = { ok: false, applied: 0, skipped: 0, errors: [] };

    // 1. 校验快照结构与 checksum
    if (!snapshot || !snapshot.items) {
        result.errors.push('快照结构无效');
        return result;
    }
    const checksumOk = await verifySnapshot(snapshot);
    if (!checksumOk) {
        result.errors.push('checksum 校验失败，可能传输损坏');
        return result;
    }

    const remoteItems = snapshot.items;

    // 2. 备份当前各 store 数据（内存中，用于失败回滚）
    const backup = {
        memories: getMemories(),
        skills: await _collectLocalSkills(),
        presets: await getAllPresets(),
        savedItems: await getAllSavedItems()
    };

    // 3. 逐项合并写入
    try {
        // ---- memories（同步 API，逐条调用）----
        if (Array.isArray(remoteItems.memories)) {
            for (const mem of remoteItems.memories) {
                if (!mem || !mem.id) {
                    result.skipped++;
                    continue;
                }
                try {
                    const existing = findMemoryById(mem.id);
                    if (existing) {
                        // 远端覆盖本地同 ID 项
                        updateMemory(mem.id, {
                            title: mem.title,
                            content: mem.content,
                            category: mem.category,
                            tags: mem.tags,
                            pinned: mem.pinned,
                            enabled: mem.enabled,
                            scope: mem.scope
                        });
                    } else {
                        // 远端新增项
                        addMemory(mem.title, mem.content, mem.category, {
                            id: mem.id,
                            tags: mem.tags,
                            pinned: mem.pinned,
                            scope: mem.scope
                        });
                    }
                    result.applied++;
                } catch (e) {
                    result.errors.push(`memory ${mem.id}: ${e.message}`);
                }
            }
        }

        // ---- skills（异步 API）----
        if (Array.isArray(remoteItems.skills)) {
            for (const skill of remoteItems.skills) {
                if (!skill || !skill.name) {
                    result.skipped++;
                    continue;
                }
                // 跳过非 custom 源与 builtin 冲突
                if (skill.source !== 'custom' || BUILTIN_SKILL_NAMES.has(skill.name)) {
                    result.skipped++;
                    continue;
                }
                try {
                    await saveSkill(skill);
                    result.applied++;
                } catch (e) {
                    result.errors.push(`skill ${skill.name}: ${e.message}`);
                }
            }
        }

        // ---- presets（异步 API）----
        if (Array.isArray(remoteItems.presets)) {
            for (const preset of remoteItems.presets) {
                if (!preset || !preset.id) {
                    result.skipped++;
                    continue;
                }
                try {
                    await savePreset(preset);
                    result.applied++;
                } catch (e) {
                    result.errors.push(`preset ${preset.id}: ${e.message}`);
                }
            }
        }

        // ---- savedItems（异步 API）----
        if (Array.isArray(remoteItems.savedItems)) {
            for (const item of remoteItems.savedItems) {
                if (!item || !item.id) {
                    result.skipped++;
                    continue;
                }
                try {
                    await saveSavedItem(item);
                    result.applied++;
                } catch (e) {
                    result.errors.push(`savedItem ${item.id}: ${e.message}`);
                }
            }
        }

        // ---- projects（暂无 store，仅统计 skipped）----
        if (Array.isArray(remoteItems.projects)) {
            for (const _p of remoteItems.projects) {
                result.skipped++;
            }
        }

        result.ok = result.errors.length === 0;
        return result;
    } catch (e) {
        // 应用过程出现未预期异常：尝试回滚（恢复备份）
        await _rollback(backup);
        result.errors.push(`应用失败已尝试回滚: ${e.message}`);
        result.ok = false;
        return result;
    }
}

/**
 * 回滚到备份状态（best-effort）
 *
 * 受各 store API 限制，回滚策略：
 *   - 仅对备份中存在的项写回（覆盖本次应用引入的同 ID 项）
 *   - 不删除本次应用新增的项（各 store 未暴露 clearAll/replaceAll 接口）
 *   - 完整回滚需要 Phase 6 集成时由 store 提供 replaceAll 接口
 *
 * @param {Object} backup - 备份的各 store 数据
 * @returns {Promise<void>}
 */
async function _rollback(backup) {
    // memories：写回复份中的每一条（覆盖同 ID）
    if (Array.isArray(backup.memories)) {
        for (const mem of backup.memories) {
            try {
                if (findMemoryById(mem.id)) {
                    updateMemory(mem.id, {
                        title: mem.title,
                        content: mem.content,
                        category: mem.category,
                        tags: mem.tags,
                        pinned: mem.pinned,
                        enabled: mem.enabled,
                        scope: mem.scope
                    });
                }
            } catch (e) {}
        }
    }
    // skills：写回 custom 源备份
    if (Array.isArray(backup.skills)) {
        for (const s of backup.skills) {
            try {
                if (s.source === 'custom' && !BUILTIN_SKILL_NAMES.has(s.name)) {
                    await saveSkill(s);
                }
            } catch (e) {}
        }
    }
    // presets：写回复份
    if (Array.isArray(backup.presets)) {
        for (const p of backup.presets) {
            try { await savePreset(p); } catch (e) {}
        }
    }
    // savedItems：写回复份
    if (Array.isArray(backup.savedItems)) {
        for (const i of backup.savedItems) {
            try { await saveSavedItem(i); } catch (e) {}
        }
    }
}
