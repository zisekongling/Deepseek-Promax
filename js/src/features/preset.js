/**
 * 系统提示词预设模块（移植自 deepseek-pp/core/preset/）
 *
 * 提供多个系统提示词预设的 CRUD 与激活切换能力。
 * 用户可创建多个预设（如"翻译助手"/"代码审查"/"写作教练"），
 * 一次只激活一个，激活后预设内容会注入到 prompt 前缀。
 *
 * 数据模型：
 *   SystemPromptPreset { id, name, content, createdAt, updatedAt }
 *
 * 存储（双槽设计，与 deepseek-pp 一致）：
 *   - 预设列表：key=deepseek_pp_presets, value=SystemPromptPreset[]
 *   - 激活 id：key=deepseek_pp_active_preset_id, value=string（id 或 null）
 *
 * 双槽设计原因：
 *   - 列表与激活状态分离，删除预设时不影响激活状态判定
 *   - setActivePresetId 会校验 id 必须存在于列表中
 *   - getActivePreset 返回激活预设对象（找不到则 null）
 */

import { createVersionedRepository, createLocalStorageSlot } from '../persistence/versioned-repository.js';

// ============================================================
// 常量
// ============================================================

/** 预设记录版本号 */
export const PRESET_RECORD_SCHEMA_VERSION = 1;

/** 预设列表存储键 */
export const PRESETS_STORAGE_KEY = 'deepseek_pp_presets';

/** 激活预设 id 存储键 */
export const ACTIVE_PRESET_STORAGE_KEY = 'deepseek_pp_active_preset_id';

// ============================================================
// 编解码器
// ============================================================

/**
 * 生成 UUID
 * @returns {string}
 */
function generateUuid() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

/**
 * 校验并解码单个预设
 * @param {unknown} value
 * @param {string} path
 * @returns {SystemPromptPreset}
 */
function decodePreset(value, path) {
    if (!value || typeof value !== 'object') {
        throw new Error(`[preset] ${path}: expected object`);
    }
    const p = /** @type {any} */ (value);
    if (typeof p.id !== 'string' || !p.id) {
        throw new Error(`[preset] ${path}.id: expected non-empty string`);
    }
    if (typeof p.name !== 'string') {
        throw new Error(`[preset] ${path}.name: expected string`);
    }
    if (typeof p.content !== 'string') {
        throw new Error(`[preset] ${path}.content: expected string`);
    }
    if (typeof p.createdAt !== 'number' || !Number.isFinite(p.createdAt)) {
        throw new Error(`[preset] ${path}.createdAt: expected finite number`);
    }
    if (typeof p.updatedAt !== 'number' || !Number.isFinite(p.updatedAt)) {
        throw new Error(`[preset] ${path}.updatedAt: expected finite number`);
    }
    return {
        id: p.id,
        name: p.name,
        content: p.content,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt
    };
}

/**
 * 校验并解码预设集合（纯数组形态，拒绝带 schemaVersion 的对象）
 * @param {unknown} value
 * @param {string} path
 * @returns {SystemPromptPreset[]}
 */
function decodePresetCollection(value, path) {
    if (!Array.isArray(value)) {
        throw new Error(`[preset] ${path}: expected array`);
    }
    return value.map((v, i) => decodePreset(v, `${path}[${i}]`));
}

/** 预设列表编解码器 */
const presetCollectionCodec = {
    decode: decodePresetCollection,
    encode: (presets) => decodePresetCollection(presets, 'encode')
};

/**
 * 解码激活预设 id（纯字符串，拒绝对象形态）
 * @param {unknown} value
 * @param {string} path
 * @returns {string|null}
 */
function decodeActivePresetId(value, path) {
    if (value === null || value === undefined) return null;
    if (typeof value !== 'string') {
        throw new Error(`[preset] ${path}: expected string or null, got ${typeof value}`);
    }
    return value;
}

// ============================================================
// 仓库实例
// ============================================================

/** 预设列表仓库 */
const presetsRepository = createVersionedRepository({
    label: 'presets',
    createDefault: () => [],
    codec: presetCollectionCodec,
    storage: createLocalStorageSlot(PRESETS_STORAGE_KEY)
});

/** 激活 id 仓库（单值存储，用 RawStorageSlot 直接读写） */
const activePresetStorage = createLocalStorageSlot(ACTIVE_PRESET_STORAGE_KEY);

// ============================================================
// 对外 API
// ============================================================

/**
 * 获取全部预设（按 updatedAt 降序）
 * @returns {Promise<SystemPromptPreset[]>}
 */
export async function getAllPresets() {
    const presets = await presetsRepository.read();
    return presets.slice().sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * 保存预设（新增或更新）
 *
 * 行为：
 *   - input.id 已存在 → 更新（updatedAt 刷新）
 *   - input.id 不存在或未提供 → 新增（自动生成 id/createdAt/updatedAt）
 *
 * @param {Object} input - 预设输入
 * @param {string} [input.id] - 已有 id（更新时传入）
 * @param {string} input.name - 预设名称
 * @param {string} input.content - 预设内容
 * @returns {Promise<SystemPromptPreset>} 保存后的预设
 */
export async function savePreset(input) {
    const presets = await presetsRepository.read();
    const now = Date.now();

    if (input.id) {
        const idx = presets.findIndex(p => p.id === input.id);
        if (idx >= 0) {
            const updated = {
                ...presets[idx],
                name: input.name,
                content: input.content,
                updatedAt: now
            };
            presets[idx] = updated;
            await presetsRepository.replaceAlreadyLocked(presets);
            return updated;
        }
    }

    // 新增
    const preset = {
        id: generateUuid(),
        name: input.name,
        content: input.content,
        createdAt: now,
        updatedAt: now
    };
    presets.push(preset);
    await presetsRepository.replaceAlreadyLocked(presets);
    return preset;
}

/**
 * 删除预设
 * 若删除的是当前激活预设，会同时清除激活状态
 * @param {string} id - 预设 id
 * @returns {Promise<void>}
 */
export async function deletePreset(id) {
    const presets = await presetsRepository.read();
    const idx = presets.findIndex(p => p.id === id);
    if (idx === -1) return;
    presets.splice(idx, 1);
    await presetsRepository.replaceAlreadyLocked(presets);

    // 若删除的是激活预设，清除激活状态
    const activeId = await getActivePresetId();
    if (activeId === id) {
        await setActivePresetId(null);
    }
}

/**
 * 获取当前激活预设 id
 * @returns {Promise<string|null>}
 */
export async function getActivePresetId() {
    const slot = await activePresetStorage.read();
    if (!slot.present) return null;
    return decodeActivePresetId(slot.value, 'activePresetId');
}

/**
 * 设置当前激活预设 id
 *
 * @param {string|null} id - 预设 id；传 null 清除激活；id 必须存在于预设列表
 * @returns {Promise<void>}
 * @throws {Error} id 不存在于预设列表时抛出
 */
export async function setActivePresetId(id) {
    if (id === null) {
        await activePresetStorage.remove();
        return;
    }
    // 校验 id 必须存在
    const presets = await presetsRepository.read();
    if (!presets.some(p => p.id === id)) {
        throw new Error(`[preset] setActivePresetId: id "${id}" 不存在于预设列表`);
    }
    await activePresetStorage.write(id);
}

/**
 * 获取当前激活的预设对象
 * @returns {Promise<SystemPromptPreset|null>} 找不到则返回 null
 */
export async function getActivePreset() {
    const activeId = await getActivePresetId();
    if (!activeId) return null;
    const presets = await presetsRepository.read();
    return presets.find(p => p.id === activeId) || null;
}

/**
 * 获取当前激活预设的内容（便捷方法，供 prompt-augmentation 调用）
 * @returns {Promise<string|null>}
 */
export async function getActivePresetContent() {
    const preset = await getActivePreset();
    return preset ? preset.content : null;
}
