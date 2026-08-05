/**
 * 场景模板模块（移植自 deepseek-pp/core/scenario/）
 *
 * 提供选中文本 → 套用模板 → 插入聊天框的能力。
 * 内置 3 个场景（总结/解释/翻译），支持自定义场景。
 *
 * 数据模型：
 *   ScenarioConfig { id, label, template, builtIn, enabled }
 *   - template 含 {text} 占位符，激活时替换为选中文本
 *
 * 存储：
 *   key: deepseek_pp_scenarios
 *   value: ScenarioConfig[]（纯数组，仅存用户对内置的修改 + 自定义场景）
 *
 * 合并逻辑：
 *   - 内置场景始终在前（不可删除）
 *   - 用户对内置场景的 enabled/template 修改会被保留（按 id 匹配）
 *   - 自定义场景追加在后
 */

import { createVersionedRepository, createLocalStorageSlot } from '../persistence/versioned-repository.js';

// ============================================================
// 内置场景
// ============================================================

/**
 * 内置场景清单
 * @type {ScenarioConfig[]}
 */
export const BUILTIN_SCENARIOS = [
    {
        id: 'summarize',
        label: '总结',
        template: '请用简洁的语言总结以下内容：\n\n{text}',
        builtIn: true,
        enabled: true
    },
    {
        id: 'explain',
        label: '解释',
        template: '请解释以下内容：\n\n{text}',
        builtIn: true,
        enabled: true
    },
    {
        id: 'translate',
        label: '翻译',
        template: '请将以下内容翻译成中文：\n\n{text}',
        builtIn: true,
        enabled: true
    },
    {
        id: 'rewrite',
        label: '润色',
        template: '请润色以下内容，使其更流畅专业：\n\n{text}',
        builtIn: true,
        enabled: true
    },
    {
        id: 'expand',
        label: '扩写',
        template: '请将以下内容扩写为更详细的版本：\n\n{text}',
        builtIn: true,
        enabled: true
    }
];

// ============================================================
// 常量
// ============================================================

/** 场景存储键 */
export const SCENARIO_STORAGE_KEY = 'deepseek_pp_scenarios';

// ============================================================
// 编解码器
// ============================================================

/**
 * 校验并解码单个场景
 * @param {unknown} value
 * @param {string} path
 * @returns {ScenarioConfig}
 */
function decodeScenario(value, path) {
    if (!value || typeof value !== 'object') {
        throw new Error(`[scenario] ${path}: expected object`);
    }
    const s = /** @type {any} */ (value);
    if (typeof s.id !== 'string' || !s.id) {
        throw new Error(`[scenario] ${path}.id: expected non-empty string`);
    }
    if (typeof s.label !== 'string') {
        throw new Error(`[scenario] ${path}.label: expected string`);
    }
    if (typeof s.template !== 'string' || !s.template) {
        throw new Error(`[scenario] ${path}.template: expected non-empty string`);
    }
    if (typeof s.builtIn !== 'boolean') {
        throw new Error(`[scenario] ${path}.builtIn: expected boolean`);
    }
    if (typeof s.enabled !== 'boolean') {
        throw new Error(`[scenario] ${path}.enabled: expected boolean`);
    }
    return {
        id: s.id,
        label: s.label,
        template: s.template,
        builtIn: s.builtIn,
        enabled: s.enabled
    };
}

/**
 * 校验并解码场景集合
 * @param {unknown} value
 * @param {string} path
 * @returns {ScenarioConfig[]}
 */
function decodeScenarioCollection(value, path) {
    if (!Array.isArray(value)) {
        throw new Error(`[scenario] ${path}: expected array`);
    }
    return value.map((v, i) => decodeScenario(v, `${path}[${i}]`));
}

const codec = {
    decode: decodeScenarioCollection,
    encode: (scenarios) => decodeScenarioCollection(scenarios, 'encode')
};

// ============================================================
// 仓库实例
// ============================================================

const repository = createVersionedRepository({
    label: 'scenarios',
    createDefault: () => [],
    codec,
    storage: createLocalStorageSlot(SCENARIO_STORAGE_KEY)
});

// ============================================================
// 合并逻辑
// ============================================================

/**
 * 合并内置场景与用户存储的场景
 *
 * 合并规则：
 *   1. 内置场景始终在前（按 BUILTIN_SCENARIOS 顺序）
 *   2. 用户对内置场景的 enabled/template 修改会被保留（按 id 匹配，覆盖这两个字段）
 *   3. 自定义场景追加在后（按存储顺序）
 *
 * @param {ScenarioConfig[]} savedScenarios - 用户存储的场景（含对内置的修改 + 自定义）
 * @returns {ScenarioConfig[]} 合并后的完整场景列表
 */
function mergeScenarios(savedScenarios) {
    // 用户存储的按 id 索引
    const savedMap = new Map(savedScenarios.map(s => [s.id, s]));

    // 内置场景：用 saved 覆盖 enabled/template，其他字段用内置兜底
    const merged = BUILTIN_SCENARIOS.map(builtin => {
        const saved = savedMap.get(builtin.id);
        if (saved) {
            return {
                ...builtin,
                enabled: saved.enabled,
                template: saved.template
            };
        }
        return { ...builtin };
    });

    // 自定义场景（saved 中 builtIn=false 的）追加在后
    for (const saved of savedScenarios) {
        if (!saved.builtIn) {
            merged.push(saved);
        }
    }

    return merged;
}

// ============================================================
// 对外 API
// ============================================================

/**
 * 获取全部场景（内置 + 自定义，按 enabled 过滤）
 * @param {Object} [options]
 * @param {boolean} [options.includeDisabled=false] - 是否包含 disabled 的场景
 * @returns {Promise<ScenarioConfig[]>}
 */
export async function getAllScenarios(options = {}) {
    const { includeDisabled = false } = options;
    const saved = await repository.read();
    const merged = mergeScenarios(saved);
    return includeDisabled ? merged : merged.filter(s => s.enabled);
}

/**
 * 保存场景（新增或更新）
 *
 * 注意：
 *   - 内置场景：仅保存用户对 enabled/template 的修改（builtIn 字段保持 true）
 *   - 自定义场景：完整存储（builtIn=false）
 *
 * @param {ScenarioConfig} config - 场景配置
 * @returns {Promise<void>}
 */
export async function saveScenario(config) {
    const saved = await repository.read();
    const idx = saved.findIndex(s => s.id === config.id);

    if (idx >= 0) {
        saved[idx] = config;
    } else {
        // 新增：判断是否是对内置场景的修改
        const isBuiltin = BUILTIN_SCENARIOS.some(b => b.id === config.id);
        saved.push({
            ...config,
            builtIn: isBuiltin ? true : false
        });
    }
    await repository.replaceAlreadyLocked(saved);
}

/**
 * 删除场景
 *
 * 注意：内置场景不可删除（直接 return）；仅可删除自定义场景
 * @param {string} id - 场景 id
 * @returns {Promise<void>}
 */
export async function deleteScenario(id) {
    // 内置场景不可删除
    if (BUILTIN_SCENARIOS.some(b => b.id === id)) return;

    const saved = await repository.read();
    const idx = saved.findIndex(s => s.id === id);
    if (idx === -1) return;
    saved.splice(idx, 1);
    await repository.replaceAlreadyLocked(saved);
}

/**
 * 添加自定义场景
 * @param {string} label - 场景标签
 * @param {string} template - 场景模板（含 {text} 占位符）
 * @returns {Promise<ScenarioConfig>} 新增的场景
 */
export async function addCustomScenario(label, template) {
    const id = 'custom-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
    const scenario = {
        id,
        label,
        template,
        builtIn: false,
        enabled: true
    };
    const saved = await repository.read();
    saved.push(scenario);
    await repository.replaceAlreadyLocked(saved);
    return scenario;
}

/**
 * 应用场景模板（把 {text} 占位符替换为选中文本）
 *
 * 只替换第一处 {text}（与 deepseek-pp 行为一致）
 *
 * @param {string} template - 场景模板
 * @param {string} selectedText - 选中文本
 * @returns {string} 渲染后的文本
 */
export function applyScenarioTemplate(template, selectedText) {
    return template.replace('{text}', selectedText);
}

/**
 * 构建右键菜单标签文本（供 context-menu.js 使用）
 * @param {ScenarioConfig} scenario
 * @returns {string}
 */
export function buildContextMenuLabel(scenario) {
    return scenario.label;
}
