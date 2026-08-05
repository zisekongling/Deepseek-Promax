/**
 * 工具描述符与调用目录（移植自 deepseek-pp/core/tool/）
 *
 * 提供结构化的工具描述抽象层：
 *   - ToolDescriptor：工具元数据（name/aliases/description/inputSchema）
 *   - ToolInvocationCatalog：调用目录（name→descriptor 索引 + 别名解析 + 正则缓存）
 *   - createXmlToolCallRegex：根据 catalog 生成 XML 标签正则（WeakMap 缓存）
 *   - renderToolSchemas：把 inputSchema 渲染为中文工具说明文本（名称+描述+参数表+required 标注）
 *   - ToolRegistry：工具注册中心，支持动态注册/注销/统一分派（MCP 工具发现后注入）
 *   - getDefaultRegistry：默认 registry 单例（懒加载，预填 DEFAULT_TOOL_DESCRIPTORS）
 *
 * 与现有 capability-register.js 的协作策略（策略 C1 + Phase 1.4 动态注册）：
 *   - TOOL_NAMES 数组保留（向后兼容，capability-register.js 维护同名数组并 splice 同步）
 *   - getCapabilityPrompt 拆分为 getCoreRulesPrompt / getToolSchemasPrompt / getAdvancedUsagePrompt
 *     其中 getToolSchemasPrompt 调 registry.renderAllSchemas() 动态渲染
 *   - parseToolCalls 改用 createXmlToolCallRegex(catalog) 构建正则（WeakMap 缓存提升性能）
 *   - executeToolCall 改为 registry.execute(name, payload) 查表分派
 *   - register/unregister 时自动清空 cachedCatalog 和 regexCache，确保动态工具可解析
 */

// ============================================================
// 类型定义（JSDoc）
// ============================================================

/**
 * @typedef {Object} ToolDescriptor
 * @property {string} name - 主工具名（如 'memory_save'）
 * @property {string[]} [aliases] - 别名列表（如 ['mem_save']，可为空）
 * @property {string} description - 简短描述（中文）
 * @property {Object} [inputSchema] - JSON Schema 参数定义（仅用于结构化索引，不渲染到 prompt）
 * @property {string} [category] - 工具分类（memory/todo/agent/system）
 */

/**
 * @typedef {Object} ToolInvocationCatalog
 * @property {Map<string, ToolDescriptor>} descriptorByName - 按主名索引（含别名）
 * @property {string[]} invocationNames - 全部可调用名（主名 + 别名，去重）
 * @property {ToolDescriptor[]} descriptors - 全部描述符
 */

// ============================================================
// 内置工具描述符
// ============================================================

/**
 * 全部内置工具描述符
 *
 * 注意：inputSchema 仅用于结构化索引和未来扩展，当前不渲染到 prompt。
 * prompt 中的工具说明仍由 capability-register.js 的 getCapabilityPrompt 硬编码。
 *
 * @type {ToolDescriptor[]}
 */
export const DEFAULT_TOOL_DESCRIPTORS = [
    // ===== 记忆工具（16 个） =====
    {
        name: 'memory_save',
        aliases: ['mem_save'],
        description: '保存一条新的长期记忆',
        category: 'memory',
        inputSchema: { type: 'object', properties: { type: { type: 'string' }, name: { type: 'string' }, content: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } } }, required: ['type', 'name', 'content'] }
    },
    {
        name: 'memory_update',
        description: '更新已有记忆的内容或标签',
        category: 'memory',
        inputSchema: { type: 'object', properties: { id: { type: 'string' }, content: { type: 'string' }, tags: { type: 'array' } }, required: ['id'] }
    },
    {
        name: 'memory_delete',
        description: '删除指定记忆',
        category: 'memory',
        inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }
    },
    {
        name: 'memory_import_preview',
        description: '预览导入记忆内容',
        category: 'memory',
        inputSchema: { type: 'object', properties: { content: { type: 'string' } }, required: ['content'] }
    },
    {
        name: 'memory_recall',
        description: '报告本次调用了哪些记忆',
        category: 'memory',
        inputSchema: { type: 'object', properties: { ids: { type: 'array' } }, required: ['ids'] }
    },
    {
        name: 'memory_merge',
        description: '融合多条记忆为一条',
        category: 'memory',
        inputSchema: { type: 'object', properties: { sourceIds: { type: 'array' }, targetId: { type: 'string' } }, required: ['sourceIds', 'targetId'] }
    },
    {
        name: 'memory_review',
        description: '审查记忆质量并给出改进建议',
        category: 'memory',
        inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }
    },
    {
        name: 'memory_search',
        description: '按关键词搜索记忆',
        category: 'memory',
        inputSchema: { type: 'object', properties: { keyword: { type: 'string' }, limit: { type: 'number' } }, required: ['keyword'] }
    },
    {
        name: 'memory_list',
        description: '列出全部记忆',
        category: 'memory',
        inputSchema: { type: 'object', properties: {} }
    },
    {
        name: 'memory_pin',
        description: '置顶或取消置顶记忆',
        category: 'memory',
        inputSchema: { type: 'object', properties: { id: { type: 'string' }, pinned: { type: 'boolean' } }, required: ['id', 'pinned'] }
    },
    {
        name: 'memory_stats',
        description: '统计记忆系统状态',
        category: 'memory',
        inputSchema: { type: 'object', properties: {} }
    },
    {
        name: 'memory_export',
        description: '导出记忆为 JSON',
        category: 'memory',
        inputSchema: { type: 'object', properties: {} }
    },
    {
        name: 'memory_archive',
        description: '归档指定记忆',
        category: 'memory',
        inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }
    },
    {
        name: 'memory_get',
        description: '按 ID 读取记忆完整字段（含历史版本）',
        category: 'memory',
        inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }
    },
    {
        name: 'memory_clear',
        description: '按作用域批量清空记忆',
        category: 'memory',
        inputSchema: { type: 'object', properties: { scope: { type: 'string' }, confirm: { type: 'boolean' } }, required: ['scope', 'confirm'] }
    },
    {
        name: 'memory_replace',
        description: '覆盖更新记忆（旧内容存入历史快照）',
        category: 'memory',
        inputSchema: { type: 'object', properties: { id: { type: 'string' }, content: { type: 'string' } }, required: ['id', 'content'] }
    },
    // ===== Todo 工具（3 个） =====
    {
        name: 'todo_write',
        description: '全量替换待办清单',
        category: 'todo',
        inputSchema: { type: 'object', properties: { todos: { type: 'array' } }, required: ['todos'] }
    },
    {
        name: 'todo_read',
        description: '读取当前待办清单',
        category: 'todo',
        inputSchema: { type: 'object', properties: {} }
    },
    {
        name: 'todo_clear',
        description: '清空待办清单',
        category: 'todo',
        inputSchema: { type: 'object', properties: {} }
    },
    // ===== Agent 工具（2 个） =====
    {
        name: 'start_agent',
        description: '启动 Agent 模式自主循环',
        category: 'agent',
        inputSchema: { type: 'object', properties: { task: { type: 'string' } }, required: ['task'] }
    },
    {
        name: 'agent_finish',
        description: '声明任务完成并终止 Agent 循环',
        category: 'agent',
        inputSchema: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'] }
    },
    // ===== 交互工具（1 个） =====
    {
        name: 'ask_user',
        description: '主动向用户提问',
        category: 'system',
        inputSchema: { type: 'object', properties: { questions: { type: 'array' } }, required: ['questions'] }
    },
    // ===== Skill 工具（1 个） =====
    {
        name: 'skill_draft_create',
        aliases: ['skill_create'],
        description: '创建一个 AI Skill 草稿。AI 根据用户描述生成 name/description/instructions/memoryEnabled，用户可在设置面板中查看并保存。',
        category: 'system',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: '技能名（kebab-case，将自动归一化，最长 64 字符）' },
                description: { type: 'string', description: '简短描述（最长 500 字符）' },
                instructions: { type: 'string', description: '指令正文（Markdown，至少 40 字符，最长 16000 字符，可用 {args} 占位符）' },
                memoryEnabled: { type: 'boolean', description: '是否启用记忆（默认 false）' }
            },
            required: ['name', 'description', 'instructions']
        }
    }
];

// ============================================================
// Catalog 创建
// ============================================================

/** catalog 实例缓存（单例，避免重复构建） */
let cachedCatalog = null;

/**
 * 创建工具调用目录
 *
 * @param {ToolDescriptor[]} [descriptors=DEFAULT_TOOL_DESCRIPTORS] - 工具描述符列表
 * @returns {ToolInvocationCatalog}
 */
export function createToolInvocationCatalog(descriptors = DEFAULT_TOOL_DESCRIPTORS) {
    /** @type {Map<string, ToolDescriptor>} */
    const descriptorByName = new Map();
    /** @type {string[]} */
    const invocationNames = [];

    for (const desc of descriptors) {
        // 主名
        if (!descriptorByName.has(desc.name)) {
            descriptorByName.set(desc.name, desc);
            invocationNames.push(desc.name);
        }
        // 别名
        if (desc.aliases) {
            for (const alias of desc.aliases) {
                if (!descriptorByName.has(alias)) {
                    descriptorByName.set(alias, desc);
                    invocationNames.push(alias);
                }
            }
        }
    }

    return {
        descriptorByName,
        invocationNames,
        descriptors: descriptors.slice()
    };
}

/**
 * 获取默认 catalog 单例（懒加载 + 缓存）
 *
 * catalog 从 getDefaultRegistry().getAllDescriptors() 派生，因此包含
 * 动态注册的工具（web/python/MCP）。register/unregister 时 _invalidateCaches
 * 会清空 cachedCatalog，下次调用重建。
 *
 * @returns {ToolInvocationCatalog}
 */
export function getDefaultCatalog() {
    if (!cachedCatalog) {
        const descriptors = getDefaultRegistry().getAllDescriptors();
        cachedCatalog = createToolInvocationCatalog(descriptors);
    }
    return cachedCatalog;
}

/**
 * 使 catalog 与正则缓存失效（在工具注册/注销后由 ToolRegistry 调用）
 *
 * 实现：
 *   - cachedCatalog 置 null，下次 getDefaultCatalog 重建
 *   - regexCache 换新 WeakMap 实例，丢弃旧 catalog 对应的正则
 */
function _invalidateCaches() {
    cachedCatalog = null;
    regexCache = new WeakMap();
}

/**
 * 按名称查找工具描述符
 * @param {string} name - 工具名或别名
 * @param {ToolInvocationCatalog} [catalog] - 默认用 getDefaultCatalog()
 * @returns {ToolDescriptor|null}
 */
export function getToolDescriptor(name, catalog) {
    const cat = catalog || getDefaultCatalog();
    return cat.descriptorByName.get(name) || null;
}

/**
 * 获取工具的优先调用名（主名）
 * @param {string} name - 工具名或别名
 * @param {ToolInvocationCatalog} [catalog]
 * @returns {string} 主名（找不到时返回原输入）
 */
export function getPreferredToolInvocationName(name, catalog) {
    const desc = getToolDescriptor(name, catalog);
    return desc ? desc.name : name;
}

/**
 * 获取工具的全部可调用名（主名 + 别名）
 * @param {string} name - 工具名或别名
 * @param {ToolInvocationCatalog} [catalog]
 * @returns {string[]}
 */
export function getToolInvocationNames(name, catalog) {
    const desc = getToolDescriptor(name, catalog);
    if (!desc) return [name];
    const names = [desc.name];
    if (desc.aliases) names.push(...desc.aliases);
    return names;
}

// ============================================================
// XML 标签正则生成（WeakMap 缓存）
// ============================================================

/**
 * catalog → 正则的 WeakMap 缓存（避免重复构建正则）
 *
 * 用 let 而非 const：register/unregister 时通过 _invalidateCaches 重新赋值，
 * 丢弃旧 catalog 对应的正则缓存（WeakMap 无法遍历清除，直接换新实例最简洁）。
 */
let regexCache = new WeakMap();

/**
 * 根据 catalog 生成 XML 工具调用正则
 *
 * 生成的正则匹配：<tool_name>...JSON...</tool_name>
 * tool_name 是 catalog 中全部可调用名（主名 + 别名），用 | 分隔
 *
 * @param {ToolInvocationCatalog} [catalog] - 默认用 getDefaultCatalog()
 * @param {Object} [options]
 * @param {boolean} [options.global=true] - 是否全局匹配
 * @returns {RegExp}
 */
export function createXmlToolCallRegex(catalog, options = {}) {
    const cat = catalog || getDefaultCatalog();
    const { global: isGlobal = true } = options;

    // 检查缓存
    const cached = regexCache.get(cat);
    if (cached && cached[isGlobal ? 'g' : 'ng']) {
        return cached[isGlobal ? 'g' : 'ng'];
    }

    // 转义工具名中的特殊字符（工具名通常只有字母数字下划线，但仍防御性处理）
    const escapedNames = cat.invocationNames
        .map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .sort((a, b) => b.length - a.length); // 长名在前，避免短名前缀匹配

    const flags = isGlobal ? 'g' : '';
    const regex = new RegExp(
        '<(' + escapedNames.join('|') + ')>([\\s\\S]*?)</\\1>',
        flags
    );

    // 写入缓存
    if (!regexCache.has(cat)) {
        regexCache.set(cat, {});
    }
    regexCache.get(cat)[isGlobal ? 'g' : 'ng'] = regex;

    return regex;
}

// ============================================================
// 工具 Schema 渲染（renderToolSchemas）
// ============================================================

/**
 * 把单个工具描述符的 inputSchema 渲染为参数说明文本
 *
 * 参考 deepseek-pp/core/tool/ 与 mcp/capability-projection.js 的 renderSchema 风格：
 * 每行一个参数，标注类型与必填/可选，附带描述、枚举值、默认值。
 *
 * @param {Object} schema - 工具的 inputSchema（JSON Schema）
 * @returns {string} 参数说明（多行），无参数时返回 '（无参数）'
 */
function _renderSchemaParams(schema) {
    if (!schema || typeof schema !== 'object') return '（无参数）';
    const props = (schema.properties && typeof schema.properties === 'object') ? schema.properties : {};
    const required = Array.isArray(schema.required) ? schema.required : [];
    const propNames = Object.keys(props);
    if (propNames.length === 0) return '（无参数）';
    const lines = [];
    for (const name of propNames) {
        const prop = props[name] && typeof props[name] === 'object' ? props[name] : {};
        const type = typeof prop.type === 'string' ? prop.type : 'any';
        const reqFlag = required.indexOf(name) >= 0 ? '必填' : '可选';
        const desc = typeof prop.description === 'string' ? prop.description : '';
        const enumStr = Array.isArray(prop.enum) ? `，可选值: ${prop.enum.map(v => JSON.stringify(v)).join(' / ')}` : '';
        const def = prop.default !== undefined ? `，默认 ${JSON.stringify(prop.default)}` : '';
        lines.push(`- ${name}（${type}，${reqFlag}）：${desc}${enumStr}${def}`);
    }
    return lines.join('\n');
}

/**
 * 渲染单个工具描述符为 prompt 段落
 *
 * @param {ToolDescriptor} desc - 工具描述符
 * @returns {string} prompt 段落（名称 + 描述 + 参数表）
 */
function _renderSingleToolSchema(desc) {
    const name = desc.name;
    const description = desc.description || '';
    const params = _renderSchemaParams(desc.inputSchema);
    return [
        `#### ${name}`,
        '',
        description,
        '',
        '参数（JSON 字段，紧凑单行）：',
        params,
        ''
    ].join('\n');
}

/**
 * 把工具描述符列表渲染为中文工具说明文本
 *
 * 输出按 category 分组，每组含若干工具段落。格式参考
 * deepseek-pp/core/tool/ 的 schema 渲染风格与现有 getCapabilityPrompt 第二层。
 *
 * @param {ToolDescriptor[]} descriptors - 工具描述符列表
 * @returns {string} 渲染后的工具说明文本；无工具时返回空字符串
 */
export function renderToolSchemas(descriptors) {
    if (!Array.isArray(descriptors) || descriptors.length === 0) return '';
    // 按 category 分组（保持插入顺序）
    /** @type {Map<string, ToolDescriptor[]>} */
    const groups = new Map();
    for (const desc of descriptors) {
        const cat = desc.category || 'other';
        if (!groups.has(cat)) groups.set(cat, []);
        groups.get(cat).push(desc);
    }
    const sections = [];
    for (const [cat, descs] of groups) {
        sections.push(`## ${cat}`);
        sections.push('');
        for (const desc of descs) {
            sections.push(_renderSingleToolSchema(desc));
        }
    }
    return sections.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// ============================================================
// ToolRegistry — 工具注册中心（支持动态注册/注销/分派）
// ============================================================

/**
 * 工具注册中心
 *
 * 统一管理工具的描述符、执行器与元选项，支持运行时动态注册/注销
 * （MCP 工具发现后注入、断连后移除）。register/unregister 会自动
 * 使 catalog 与正则缓存失效，确保后续 parseToolCalls 能识别新工具。
 *
 * 用法：
 *   const registry = getDefaultRegistry();
 *   registry.register(descriptor, executor, { requireAgentFeedback: true, category: 'memory' });
 *   const result = await registry.execute('memory_save', payload);
 *   registry.unregister('some_dynamic_tool');
 */
class ToolRegistry {
    /**
     * @param {ToolDescriptor[]} [seedDescriptors] - 初始描述符（仅预填，不挂执行器）
     */
    constructor(seedDescriptors) {
        /** @type {Map<string, { descriptor: ToolDescriptor, executor: Function|null, options: Object }>} 主名 → 条目 */
        this._entries = new Map();
        /** @type {Map<string, string>} 别名 → 主名 */
        this._aliasToCanonical = new Map();
        if (Array.isArray(seedDescriptors)) {
            for (const desc of seedDescriptors) {
                this._seedDescriptor(desc);
            }
        }
    }

    /**
     * 内部：仅注入描述符（不挂执行器），用于构造时预填
     * @param {ToolDescriptor} desc - 工具描述符
     * @private
     */
    _seedDescriptor(desc) {
        if (!desc || !desc.name) return;
        this._entries.set(desc.name, {
            descriptor: desc,
            executor: null,
            options: { category: desc.category || 'other' }
        });
        if (Array.isArray(desc.aliases)) {
            for (const a of desc.aliases) this._aliasToCanonical.set(a, desc.name);
        }
    }

    /**
     * 注册工具（若同名已存在则覆盖：更新描述符/执行器/选项）
     *
     * @param {ToolDescriptor} descriptor - 工具描述符
     * @param {Function} executor - 执行器 (payload) => result | Promise<result>
     * @param {Object} [options] - 元选项
     * @param {boolean} [options.requireAgentFeedback=false] - 是否需要 Agent 续跑反馈
     * @param {string} [options.category] - 工具分类（缺省取 descriptor.category）
     */
    register(descriptor, executor, options = {}) {
        if (!descriptor || !descriptor.name) return;
        const name = descriptor.name;
        // 覆盖时先清理旧别名映射，避免残留
        const existing = this._entries.get(name);
        if (existing && Array.isArray(existing.descriptor.aliases)) {
            for (const a of existing.descriptor.aliases) this._aliasToCanonical.delete(a);
        }
        const opts = {
            requireAgentFeedback: options.requireAgentFeedback === true,
            category: options.category || descriptor.category || 'other'
        };
        this._entries.set(name, {
            descriptor,
            executor: typeof executor === 'function' ? executor : null,
            options: opts
        });
        if (Array.isArray(descriptor.aliases)) {
            for (const a of descriptor.aliases) this._aliasToCanonical.set(a, name);
        }
        _invalidateCaches();
    }

    /**
     * 注销工具
     * @param {string} name - 工具主名
     * @returns {boolean} 是否成功移除
     */
    unregister(name) {
        if (!name) return false;
        const entry = this._entries.get(name);
        if (!entry) return false;
        if (Array.isArray(entry.descriptor.aliases)) {
            for (const a of entry.descriptor.aliases) this._aliasToCanonical.delete(a);
        }
        this._entries.delete(name);
        _invalidateCaches();
        return true;
    }

    /**
     * 按分类批量注销（用于 MCP 断连时批量移除某服务的工具）
     * @param {string} category - 工具分类
     * @returns {string[]} 被移除的工具主名列表
     */
    unregisterByCategory(category) {
        const removed = [];
        for (const [name, entry] of this._entries) {
            if (entry.options && entry.options.category === category) {
                if (Array.isArray(entry.descriptor.aliases)) {
                    for (const a of entry.descriptor.aliases) this._aliasToCanonical.delete(a);
                }
                removed.push(name);
            }
        }
        for (const name of removed) this._entries.delete(name);
        if (removed.length > 0) _invalidateCaches();
        return removed;
    }

    /**
     * 统一分派执行工具
     *
     * 直接调用执行器并返回其结果。同步执行器返回 result 对象，
     * 异步执行器返回 Promise<result>。调用方按需处理。
     *
     * 不用 async/await 包装：避免把同步执行器也转成 Promise，
     * 保持与 text-process.js 的同步调用语义兼容。
     *
     * @param {string} name - 工具名或别名
     * @param {Object} payload - 调用参数
     * @returns {{ok:boolean, summary:string, detail?:string}|Promise<{ok:boolean, summary:string, detail?:string}>}
     */
    execute(name, payload) {
        if (!name) {
            return { ok: false, summary: '无效的工具调用', detail: '工具名为空' };
        }
        const canonical = this._aliasToCanonical.get(name) || name;
        const entry = this._entries.get(canonical);
        if (!entry) {
            return { ok: false, summary: `未知工具：${name}` };
        }
        if (typeof entry.executor !== 'function') {
            return { ok: false, summary: `工具 ${canonical} 未挂载执行器`, detail: '该工具仅注册了描述符，未绑定执行函数' };
        }
        try {
            return entry.executor(payload);
        } catch (e) {
            return { ok: false, summary: '工具执行失败', detail: (e && e.message) || String(e) };
        }
    }

    /**
     * 获取全部可调用名（主名 + 别名），替代静态 TOOL_NAMES
     * @returns {string[]}
     */
    getInvocationNames() {
        const names = [];
        for (const [name, entry] of this._entries) {
            names.push(name);
            if (Array.isArray(entry.descriptor.aliases)) {
                for (const a of entry.descriptor.aliases) names.push(a);
            }
        }
        return names;
    }

    /**
     * 获取工具主名列表（仅主名，不含别名）
     * @returns {string[]}
     */
    getCanonicalNames() {
        return Array.from(this._entries.keys());
    }

    /**
     * 按名称获取描述符（支持别名解析）
     * @param {string} name - 工具名或别名
     * @returns {ToolDescriptor|null}
     */
    getDescriptor(name) {
        const canonical = this._aliasToCanonical.get(name) || name;
        const entry = this._entries.get(canonical);
        return entry ? entry.descriptor : null;
    }

    /**
     * 获取全部描述符（含动态注册的工具）
     * @returns {ToolDescriptor[]}
     */
    getAllDescriptors() {
        const result = [];
        for (const entry of this._entries.values()) {
            result.push(entry.descriptor);
        }
        return result;
    }

    /**
     * 渲染全部工具说明（含 MCP 动态工具）
     * @returns {string}
     */
    renderAllSchemas() {
        return renderToolSchemas(this.getAllDescriptors());
    }

    /**
     * 查询工具是否需要 Agent 续跑反馈
     * @param {string} name - 工具名或别名
     * @returns {boolean}
     */
    isRequireAgentFeedback(name) {
        const canonical = this._aliasToCanonical.get(name) || name;
        const entry = this._entries.get(canonical);
        return !!(entry && entry.options && entry.options.requireAgentFeedback);
    }
}

/** 默认 registry 单例（懒加载） */
let _defaultRegistry = null;

/**
 * 获取默认 ToolRegistry 单例（懒加载）
 *
 * 首次调用时创建实例并预填 DEFAULT_TOOL_DESCRIPTORS（仅描述符，执行器由
 * capability-register.js 在初始化时通过 register() 挂载）。
 *
 * @returns {ToolRegistry}
 */
export function getDefaultRegistry() {
    if (!_defaultRegistry) {
        _defaultRegistry = new ToolRegistry(DEFAULT_TOOL_DESCRIPTORS);
    }
    return _defaultRegistry;
}

// ============================================================
// 默认工具名列表（向后兼容 capability-register.js 的 TOOL_NAMES）
// ============================================================

/**
 * 默认工具主名列表（静态快照，仅含内置 22 个工具）
 *
 * 注意：这是 DEFAULT_TOOL_DESCRIPTORS 的静态快照，不反映运行时动态注册
 * 的工具（web/python/MCP）。运行动态工具名请用 getDefaultRegistry().getInvocationNames()。
 * capability-register.js 维护自己的 TOOL_NAMES 数组并通过 splice 与 registry 同步。
 *
 * @type {string[]}
 */
export const TOOL_NAMES = DEFAULT_TOOL_DESCRIPTORS.map(d => d.name);
