/**
 * 工具注册中心（Tool Registry）
 *
 * 职责：
 *   1. 管理所有工具的注册/注销生命周期
 *   2. 提供工具描述符的单一数据源（Single Source of Truth）
 *   3. 按分类组织工具，支持动态发现（不一次性暴露全部工具定义）
 *   4. 统一工具执行分派（同步/异步执行器透明处理）
 *
 * 设计原则（参考《AI Agent 实战》指南）：
 *   - 工具按五类组织：感知(perception) / 执行(execution) / 协作(collaboration) / 控制(control) / 事件(event)
 *   - 支持渐进式披露：先暴露工具索引（名称+一句话描述），按需加载完整 Schema
 *   - 工具描述包含：边界条件说明、调用示例、参数约束
 *   - 感知工具天然支持并行调用（无副作用），执行工具需顺序控制
 *
 * 与其他模块的关系：
 *   - prompts/builder.js 从此处获取工具描述符构建提示词
 *   - core/engine.js 通过 execute() 执行工具调用
 *   - guards/tool-guard.js 在工具执行前后进行安全检查
 *   - 替换原 capability-register.js 中的 registry 相关逻辑
 */

import { createXmlToolCallRegex, getPreferredToolInvocationName } from '../../features/tool-descriptors.js';

// ============================================================
// 类型定义
// ============================================================

/**
 * @typedef {Object} ToolDescriptor - 工具描述符
 * @property {string} name - 工具名（snake_case，唯一标识）
 * @property {string} description - 一句话描述（给 AI 看，说明"什么时候用"）
 * @property {string} category - 分类：perception/execution/collaboration/control/event
 * @property {Object} inputSchema - 参数 JSON Schema
 * @property {string[]} [aliases] - 别名列表（如 mem_save → memory_save）
 * @property {string} [riskLevel] - 风险等级：low/medium/high
 * @property {boolean} [isReadOnly] - 是否只读（只读工具可并行调用）
 * @property {string} [boundaryNote] - 边界说明（工具做不到什么）
 * @property {string[]} [examples] - 调用示例
 */

/**
 * @typedef {Object} ToolRegistration - 工具注册项
 * @property {ToolDescriptor} descriptor - 工具描述符
 * @property {Function} executor - 执行器函数
 * @property {Object} options - 注册选项
 * @property {boolean} options.requireAgentFeedback - 是否触发 Agent 续跑
 * @property {string} options.category - 工具分类
 * @property {string} [options.riskLevel] - 风险等级
 */

/**
 * @typedef {Object} ToolResult - 工具执行结果
 * @property {boolean} ok - 成功/失败
 * @property {string} summary - 一句话摘要（给 AI 看的续跑 prompt 用）
 * @property {string} [detail] - 详细信息
 * @property {boolean} [skipped] - 跳过（如去重命中），skipped 而非 failure
 * @property {boolean} [pending] - 等待中（如 ask_user），Agent 循环会等待 Promise
 */

// ============================================================
// 工具注册中心
// ============================================================

/**
 * 创建工具注册中心实例
 *
 * 设计为工厂函数（而非单例），支持测试和未来多实例场景。
 * 实际使用中通过 getDefaultRegistry() 获取全局单例。
 *
 * @returns {Object} 注册中心 API
 */
export function createToolRegistry() {
    /** @type {Map<string, ToolRegistration>} 工具名 → 注册项 */
    const _tools = new Map();
    /** @type {Map<string, string>} 别名 → 主名 */
    const _aliases = new Map();
    /** @type {Set<string>} 不需要 Agent 续跑反馈的工具名集合 */
    const _noFeedbackSet = new Set();
    /** @type {Set<string>} 只读工具名集合（可并行调用） */
    const _readOnlySet = new Set();

    // ============================================================
    // 注册与注销
    // ============================================================

    /**
     * 注册工具
     *
     * @param {ToolDescriptor} descriptor - 工具描述符
     * @param {Function} executor - 执行器函数 (payload) => ToolResult | Promise<ToolResult>
     * @param {Object} [options] - 注册选项
     * @param {boolean} [options.requireAgentFeedback=true] - 是否触发 Agent 续跑
     * @param {string} [options.category] - 覆盖描述符中的分类
     * @param {string} [options.riskLevel] - 风险等级
     * @param {boolean} [options.isReadOnly] - 是否只读
     */
    function register(descriptor, executor, options = {}) {
        if (!descriptor || !descriptor.name) {
            console.warn('[ToolRegistry] register: descriptor.name is required');
            return;
        }
        const name = descriptor.name;
        const category = options.category || descriptor.category || 'execution';
        const requireFeedback = options.requireAgentFeedback !== false;
        const isReadOnly = options.isReadOnly || descriptor.isReadOnly || false;
        const riskLevel = options.riskLevel || descriptor.riskLevel || 'medium';

        _tools.set(name, {
            descriptor: { ...descriptor, category, riskLevel, isReadOnly },
            executor,
            options: { requireAgentFeedback: requireFeedback, category, riskLevel, isReadOnly }
        });

        // 注册别名
        if (Array.isArray(descriptor.aliases)) {
            for (const alias of descriptor.aliases) {
                _aliases.set(alias, name);
            }
        }

        // 记录不需要反馈的工具
        if (!requireFeedback) {
            _noFeedbackSet.add(name);
        }

        // 记录只读工具
        if (isReadOnly) {
            _readOnlySet.add(name);
        }
    }

    /**
     * 注销工具
     * @param {string} name - 工具名
     * @returns {boolean} 是否成功注销
     */
    function unregister(name) {
        if (!_tools.has(name)) return false;
        _tools.delete(name);
        _noFeedbackSet.delete(name);
        _readOnlySet.delete(name);
        // 清理别名
        for (const [alias, target] of _aliases.entries()) {
            if (target === name) _aliases.delete(alias);
        }
        return true;
    }

    /**
     * 按分类批量注销工具
     * @param {string} category - 分类名
     * @returns {string[]} 被移除的工具名列表
     */
    function unregisterByCategory(category) {
        const removed = [];
        for (const [name, reg] of _tools.entries()) {
            if (reg.options.category === category) {
                _tools.delete(name);
                _noFeedbackSet.delete(name);
                _readOnlySet.delete(name);
                removed.push(name);
            }
        }
        // 清理别名
        for (const [alias, target] of _aliases.entries()) {
            if (removed.includes(target)) _aliases.delete(alias);
        }
        return removed;
    }

    // ============================================================
    // 查询
    // ============================================================

    /**
     * 获取工具描述符
     * @param {string} name - 工具名
     * @returns {ToolDescriptor|undefined}
     */
    function getDescriptor(name) {
        return _tools.get(name)?.descriptor;
    }

    /**
     * 获取所有工具描述符
     * @param {string} [category] - 按分类筛选
     * @returns {ToolDescriptor[]}
     */
    function getAllDescriptors(category) {
        const results = [];
        for (const reg of _tools.values()) {
            if (!category || reg.options.category === category) {
                results.push(reg.descriptor);
            }
        }
        return results;
    }

    /**
     * 获取所有工具名
     * @returns {string[]}
     */
    function getInvocationNames() {
        return Array.from(_tools.keys());
    }

    /**
     * 解析别名为主名
     * @param {string} nameOrAlias - 工具名或别名
     * @returns {string} 主名
     */
    function resolveName(nameOrAlias) {
        return _aliases.get(nameOrAlias) || nameOrAlias;
    }

    /**
     * 判断是否需要 Agent 续跑反馈
     * @param {string} name - 工具名
     * @returns {boolean}
     */
    function isRequireAgentFeedback(name) {
        return !_noFeedbackSet.has(name);
    }

    /**
     * 判断工具是否只读（可并行调用）
     * @param {string} name - 工具名
     * @returns {boolean}
     */
    function isReadOnly(name) {
        return _readOnlySet.has(name);
    }

    /**
     * 获取工具数量
     * @returns {number}
     */
    function getCount() {
        return _tools.size;
    }

    // ============================================================
    // 执行
    // ============================================================

    /**
     * 执行工具调用
     *
     * 委托给注册的执行器，透明处理同步/异步执行器。
     *
     * @param {string} name - 工具名
     * @param {Object} payload - 调用参数
     * @returns {ToolResult | Promise<ToolResult>}
     */
    function execute(name, payload) {
        const reg = _tools.get(name);
        if (!reg) {
            return { ok: false, summary: '工具不存在', detail: `未找到工具 "${name}"` };
        }
        try {
            return reg.executor(payload);
        } catch (e) {
            return { ok: false, summary: '执行异常', detail: e?.message || String(e) };
        }
    }

    // ============================================================
    // 工具 Schema 渲染（供提示词构建）
    // ============================================================

    /**
     * 渲染工具 Schema 为提示词文本
     *
     * 按分类分组渲染，每个工具包含：名称、一句话描述、参数说明、边界条件。
     *
     * @param {ToolDescriptor[]} [descriptors] - 要渲染的工具描述符（默认全部）
     * @returns {string} 提示词文本
     */
    function renderSchemas(descriptors) {
        const descs = descriptors || getAllDescriptors();
        if (descs.length === 0) return '';

        // 按分类分组
        const groups = {
            perception: { label: '感知工具（获取信息）', tools: [] },
            execution: { label: '执行工具（改变世界）', tools: [] },
            collaboration: { label: '协作工具（与用户/Agent 交互）', tools: [] },
            control: { label: '控制流工具', tools: [] },
            event: { label: '事件工具', tools: [] },
            other: { label: '其他工具', tools: [] }
        };
        for (const desc of descs) {
            const cat = desc.category || 'other';
            const group = groups[cat] || groups.other;
            group.tools.push(desc);
        }

        const lines = [];
        for (const [catKey, group] of Object.entries(groups)) {
            if (group.tools.length === 0) continue;
            lines.push(`### ${group.label}`);
            for (const desc of group.tools) {
                const riskBadge = desc.riskLevel === 'high' ? ' [高风险]' : '';
                lines.push(`#### ${desc.name}${riskBadge}`);
                lines.push(desc.description || '');
                if (desc.boundaryNote) {
                    lines.push(`注意：${desc.boundaryNote}`);
                }
                if (desc.inputSchema && desc.inputSchema.properties) {
                    lines.push('参数：');
                    for (const [key, prop] of Object.entries(desc.inputSchema.properties)) {
                        const required = desc.inputSchema.required?.includes(key) ? '（必填）' : '';
                        lines.push(`  - ${key}${required}: ${prop.description || prop.type || ''}`);
                    }
                }
                if (Array.isArray(desc.examples) && desc.examples.length > 0) {
                    lines.push('示例：');
                    for (const ex of desc.examples.slice(0, 2)) {
                        lines.push(`  <${desc.name}>${ex}</${desc.name}>`);
                    }
                }
            }
            lines.push('');
        }
        return lines.join('\n');
    }

    /**
     * 渲染工具索引（仅名称+一句话描述，用于渐进式披露）
     * @returns {string}
     */
    function renderIndex() {
        const descs = getAllDescriptors();
        if (descs.length === 0) return '（无可用工具）';
        const lines = descs.map(d => `- \`${d.name}\`: ${d.description || ''}`);
        return lines.join('\n');
    }

    // ============================================================
    // 返回 API
    // ============================================================

    return {
        register,
        unregister,
        unregisterByCategory,
        getDescriptor,
        getAllDescriptors,
        getInvocationNames,
        resolveName,
        isRequireAgentFeedback,
        isReadOnly,
        getCount,
        execute,
        renderSchemas,
        renderIndex
    };
}

// ============================================================
// 全局单例
// ============================================================

/** @type {ReturnType<typeof createToolRegistry>|null} */
let _defaultRegistry = null;

/**
 * 获取默认工具注册中心单例
 * @returns {ReturnType<typeof createToolRegistry>}
 */
export function getDefaultRegistry() {
    if (!_defaultRegistry) {
        _defaultRegistry = createToolRegistry();
    }
    return _defaultRegistry;
}