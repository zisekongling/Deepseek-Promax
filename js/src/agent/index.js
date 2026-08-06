/**
 * Agent 系统统一入口
 *
 * 职责：
 *   1. 整合所有 agent 子模块（core / tools / guards）
 *   2. 提供统一的 initAgentSystem() 初始化入口
 *   3. 保持与旧版 window._ds* 接口的向后兼容
 *   4. 支持按 CONFIG 开关分层初始化（memory-only / tools-only / full）
 *
 * 架构层次：
 *   ```
 *   agent/index.js（统一入口）
 *   ├── core/                 核心引擎
 *   │   ├── tool-registry.js  工具注册中心（单一数据源）
 *   │   ├── harness.js        约束/验证/纠正框架
 *   │   ├── context.js        上下文管理（提示词构建）
 *   │   └── engine.js         ReAct 循环引擎
 *   ├── tools/                工具集（五类）
 *   │   ├── memory-tools.js   记忆操作（Execution）
 *   │   ├── control-tools.js  控制流（Control）
 *   │   ├── collaboration-tools.js  协作（Collaboration）
 *   │   ├── perception-tools.js     感知（Perception）
 *   │   └── execution-tools.js      执行（Execution）
 *   └── guards/               护栏层
 *       ├── tool-guard.js     工具护栏
 *       ├── input-guard.js    输入护栏
 *       └── output-guard.js   输出护栏
 *   ```
 *
 * 初始化流程：
 *   1. 创建/获取工具注册中心单例
 *   2. 注册所有内置工具（memory/control/collaboration/perception/execution）
 *   3. 初始化上下文模块（挂载 _dsCapabilityInjector）
 *   4. 初始化循环引擎（挂载 _dsOnToolCallExecuted / _dsStopAgent 等）
 *   5. 挂载向后兼容的 window._ds* 接口
 *
 * 与旧版模块的关系：
 *   - 替换 capability-register.js 的 initCapabilityRegister()
 *   - 替换 capability-agent.js 的 initCapabilityAgent()
 *   - 保留 window._ds* 接口签名，内部委托给新架构
 *
 * 设计原则（参考《AI Agent 实战》指南）：
 *   - 单一入口：所有 Agent 初始化逻辑集中于此
 *   - 分层隔离：core / tools / guards 各自独立，通过 registry 通信
 *   - 故障安全：任何子模块初始化失败不影响其他模块
 *   - 向后兼容：保持 window._ds* 接口不变
 */

import { getDefaultRegistry } from './core/tool-registry.js';
import { initAgentEngine, stopAgent, recordOriginalTask, buildContinuationPrompt, buildStartAgentPrompt } from './core/engine.js';
import { initContextModule, buildCapabilityPrompt, buildCompactPrompt, estimateTokens, invalidateToolSchemaCache, invalidateAllCache } from './core/context.js';
import { createCircuitBreaker } from './core/harness.js';

// 工具模块
import { MEMORY_TOOL_DESCRIPTORS, createMemoryToolExecutors } from './tools/memory-tools.js';
import { CONTROL_TOOL_DESCRIPTORS, createControlToolExecutors } from './tools/control-tools.js';
import { COLLABORATION_TOOL_DESCRIPTORS, createCollaborationToolExecutors } from './tools/collaboration-tools.js';
import { PERCEPTION_TOOL_DESCRIPTORS, createPerceptionToolExecutors } from './tools/perception-tools.js';
import { EXECUTION_TOOL_DESCRIPTORS, createExecutionToolExecutors } from './tools/execution-tools.js';

// 护栏模块
import { preToolCallGuard, postToolCallGuard, correctToolCall, checkParallelizability } from './guards/tool-guard.js';
import { fullInputGuard } from './guards/input-guard.js';
import { validateReplyContent, validateToolResult, reviewTaskCompletion, detectRepetitiveLoop, assessLoopHealth } from './guards/output-guard.js';

// 旧版依赖（向后兼容）
import { createXmlToolCallRegex, getPreferredToolInvocationName } from '../features/tool-descriptors.js';

// ============================================================
// 工具解析（向后兼容 capability-register.js 的 parseToolCalls）
// ============================================================

/**
 * 宽松 JSON 解析回退（处理换行/单引号/尾部逗号等格式问题）
 * @param {string} body - JSON 文本
 * @returns {Object|null}
 */
function _lenientParseJsonBody(body) {
    if (!body) return null;
    try {
        // 尝试修复常见格式问题
        let fixed = body
            .replace(/\n/g, '\\n')
            .replace(/\r/g, '\\r')
            .replace(/,\s*}/g, '}')
            .replace(/,\s*]/g, ']');
        return JSON.parse(fixed);
    } catch (e) {
        return null;
    }
}

/**
 * 解析 AI 回复中的工具调用 XML 标签
 *
 * 向后兼容 capability-register.js 的 parseToolCalls 接口。
 * 内部使用 tool-descriptors.js 的 catalog 正则。
 *
 * @param {string} text - AI 回复文本
 * @returns {Array<{name: string, payload: Object, raw: string, index: number, endIndex: number}>}
 */
export function parseToolCalls(text) {
    if (!text || typeof text !== 'string') return [];
    const results = [];
    const toolPattern = createXmlToolCallRegex();
    let match;
    while ((match = toolPattern.exec(text)) !== null) {
        const rawName = match[1];
        const name = getPreferredToolInvocationName(rawName);
        const body = match[2].trim();
        const raw = match[0];
        const index = match.index;
        const endIndex = index + raw.length;

        let payload = null;
        try {
            payload = JSON.parse(body);
        } catch (e) {
            payload = _lenientParseJsonBody(body);
        }
        if (!payload) continue;
        if (payload && typeof payload === 'object') {
            results.push({ name, payload, raw, index, endIndex });
        }
    }
    return results;
}

/**
 * 获取工具的中文标签（供 UI 使用）
 * @param {string} toolName - 工具名
 * @returns {string}
 */
export function getToolLabel(toolName) {
    const registry = getDefaultRegistry();
    const desc = registry.getDescriptor(toolName);
    return (desc && desc.description) || toolName;
}

// ============================================================
// 工具执行（集成护栏层）
// ============================================================

/**
 * 执行工具调用（集成护栏检查）
 *
 * 向后兼容 capability-register.js 的 executeToolCall 接口。
 * 执行流程：pre-guard → execute → post-guard → correct(if needed)
 *
 * @param {string} name - 工具名
 * @param {Object} payload - 调用参数
 * @returns {{ ok: boolean, summary: string, detail?: string, skipped?: boolean, pending?: boolean }}
 */
export function executeToolCall(name, payload) {
    const registry = getDefaultRegistry();

    if (!name || !payload) {
        return { ok: false, summary: '无效的工具调用', detail: '工具名或参数为空' };
    }

    // 解析别名
    const resolvedName = registry.resolveName(name);

    // 1. 执行前护栏检查
    const preGuard = preToolCallGuard(resolvedName, payload, registry);
    if (!preGuard.allowed) {
        return { ok: false, summary: '工具调用被拒绝', detail: preGuard.reason };
    }

    // 2. 执行工具
    let result = registry.execute(resolvedName, payload);

    // 处理 Promise 结果
    if (result && typeof result.then === 'function') {
        // 同步调用不支持异步，由 engine 的 onToolCallExecuted 处理
        return { ok: true, summary: '工具已提交', pending: true };
    }

    // 3. 执行后护栏检查
    const postGuard = postToolCallGuard(resolvedName, result, registry);
    if (!postGuard.valid) {
        // 尝试纠正
        const correction = correctToolCall(resolvedName, result, 0);
        if (correction.action === 'retry') {
            // 重试一次
            result = registry.execute(resolvedName, payload);
        }
    }

    return result || { ok: false, summary: '工具执行未返回结果' };
}

// ============================================================
// 工具注册（批量注册所有内置工具）
// ============================================================

/**
 * 注册所有内置工具到注册中心
 *
 * 按五类分组注册：memory / control / collaboration / perception / execution。
 * 每类工具独立 try-catch，一个分类失败不影响其他分类。
 *
 * @param {Object} registry - 工具注册中心
 * @returns {{ count: number, categories: string[] }}
 */
function _registerAllBuiltinTools(registry) {
    const registered = { count: 0, categories: [] };

    // 不需要 Agent 续跑反馈的工具（与旧版 capability-register.js 保持一致）
    // memory_recall: 纯记录型工具，不触发续跑
    // agent_finish: 控制流终止工具，由 text-process.js 和 engine.js 单独处理
    const NO_FEEDBACK = new Set(['memory_recall', 'agent_finish']);

    // 工具分类注册表：[描述符数组, 执行器工厂, 分类名, 默认是否需要Agent反馈]
    const toolGroups = [
        { descs: MEMORY_TOOL_DESCRIPTORS, factory: createMemoryToolExecutors, category: 'execution', feedback: true },
        { descs: CONTROL_TOOL_DESCRIPTORS, factory: createControlToolExecutors, category: 'control', feedback: true },
        { descs: COLLABORATION_TOOL_DESCRIPTORS, factory: createCollaborationToolExecutors, category: 'collaboration', feedback: true },
        { descs: PERCEPTION_TOOL_DESCRIPTORS, factory: createPerceptionToolExecutors, category: 'perception', feedback: true },
        { descs: EXECUTION_TOOL_DESCRIPTORS, factory: createExecutionToolExecutors, category: 'execution', feedback: true },
    ];

    for (const group of toolGroups) {
        try {
            const executors = group.factory();
            for (const desc of group.descs) {
                const executor = executors[desc.name];
                if (!executor) {
                    console.warn(`[AgentSystem] 工具 "${desc.name}" 缺少执行器，跳过注册`);
                    continue;
                }
                // 组级 feedback 为默认值，NO_FEEDBACK 集合中的工具强制关闭反馈
                const requireFeedback = group.feedback && !NO_FEEDBACK.has(desc.name);
                registry.register(desc, executor, {
                    requireAgentFeedback: requireFeedback,
                    category: desc.category || group.category,
                    riskLevel: desc.riskLevel || 'medium',
                    isReadOnly: desc.isReadOnly || false
                });
                registered.count++;
            }
            registered.categories.push(group.category);
        } catch (e) {
            console.warn(`[AgentSystem] 注册 ${group.category} 类工具失败:`, e);
        }
    }

    return registered;
}

// ============================================================
// MCP 工具集成（向后兼容）
// ============================================================

/**
 * 注册 MCP 服务端工具（向后兼容 capability-register 接口）
 * @param {string} serverName - MCP 服务名
 * @param {Array} tools - 工具描述符数组
 */
function _registerMcpServerTools(serverName, tools) {
    if (!Array.isArray(tools) || tools.length === 0) return;
    const registry = getDefaultRegistry();
    for (const tool of tools) {
        const name = `mcp__${serverName}__${tool.name}`;
        const desc = {
            name,
            description: tool.description || `MCP 工具: ${serverName}/${tool.name}`,
            category: 'perception',
            riskLevel: 'medium',
            isReadOnly: true,
            inputSchema: tool.inputSchema || { type: 'object', properties: {} },
            boundaryNote: 'MCP 工具，结果可能受服务端限制'
        };
        registry.register(desc, (payload) => {
            // 委托给 MCP 客户端执行
            const mcp = typeof window !== 'undefined' ? window._dsMcp : null;
            if (!mcp) {
                return { ok: false, summary: 'MCP 未初始化', detail: 'window._dsMcp 不存在' };
            }
            return mcp.invoke(serverName, tool.name, payload);
        }, {
            requireAgentFeedback: true,
            category: 'perception',
            riskLevel: 'medium',
            isReadOnly: true
        });
    }
    // MCP 工具变更后清除 Schema 缓存
    invalidateToolSchemaCache();
}

/**
 * 注销 MCP 服务端工具
 * @param {string} serverName - MCP 服务名
 */
function _unregisterMcpServerTools(serverName) {
    const registry = getDefaultRegistry();
    const allTools = registry.getInvocationNames();
    const prefix = `mcp__${serverName}__`;
    let removed = false;
    for (const name of allTools) {
        if (name.startsWith(prefix)) {
            registry.unregister(name);
            removed = true;
        }
    }
    if (removed) invalidateToolSchemaCache();
}

/**
 * 注销所有 MCP 工具
 */
function _unregisterAllMcpTools() {
    const registry = getDefaultRegistry();
    const allTools = registry.getInvocationNames();
    let removed = false;
    for (const name of allTools) {
        if (name.startsWith('mcp__')) {
            registry.unregister(name);
            removed = true;
        }
    }
    if (removed) invalidateToolSchemaCache();
}

// ============================================================
// 初始化
// ============================================================

/** 是否已初始化 */
let _initialized = false;

/**
 * 初始化 Agent 系统
 *
 * 按 CONFIG 开关分层初始化：
 *   - agentSystemEnabled + agentToolsEnabled → 完整初始化（注册工具 + 上下文 + 引擎）
 *   - agentSystemEnabled + agentMemoryEnabled（仅记忆）→ 仅初始化上下文注入
 *   - 其他 → 跳过
 *
 * 初始化顺序：
 *   1. 创建/获取工具注册中心
 *   2. 注册所有内置工具
 *   3. 初始化上下文模块（挂载 _dsCapabilityInjector）
 *   4. 初始化循环引擎（挂载 _dsOnToolCallExecuted 等）
 *   5. 挂载向后兼容的 window._ds* 接口
 *
 * @returns {{ ok: boolean, toolCount?: number, scope?: string }}
 */
export function initAgentSystem() {
    if (_initialized) {
        return { ok: true, scope: 'already-initialized' };
    }
    _initialized = true;

    // 安全获取 CONFIG
    const config = _getConfig();

    // 总开关检查
    if (!config || !config.agentSystemEnabled) {
        console.log('[AgentSystem] Agent 系统总开关未启用，跳过初始化');
        return { ok: true, scope: 'disabled' };
    }

    // 1. 获取注册中心单例
    const registry = getDefaultRegistry();

    // 2. 注册所有内置工具
    let toolCount = 0;
    if (config.agentToolsEnabled !== false) {
        const registered = _registerAllBuiltinTools(registry);
        toolCount = registered.count;
        // 工具注册后清除 Schema 缓存，确保下次构建提示词时使用最新工具列表
        invalidateToolSchemaCache();
        console.log(`[AgentSystem] 已注册 ${toolCount} 个内置工具，分类: ${registered.categories.join(', ')}`);
    }

    // 3. 初始化上下文模块（能力提示词注入）
    //    即使 tools 未启用，memory 也可能需要注入记忆文本
    try {
        initContextModule(registry);
    } catch (e) {
        console.warn('[AgentSystem] 上下文模块初始化失败:', e);
    }

    // 4. 初始化循环引擎
    if (config.agentLoopEnabled !== false && config.agentToolsEnabled !== false) {
        try {
            initAgentEngine();
        } catch (e) {
            console.warn('[AgentSystem] 循环引擎初始化失败:', e);
        }
    }

    // 5. 挂载向后兼容的 window._ds* 接口
    _mountWindowApi(registry);

    // 6. 标记就绪
    if (typeof window !== 'undefined') {
        window._dsAgentSystemReady = true;
    }

    console.log(`[AgentSystem] 初始化完成（工具: ${toolCount}, 范围: ${config.agentToolsEnabled ? 'full' : 'memory-only'}）`);
    return { ok: true, toolCount, scope: config.agentToolsEnabled ? 'full' : 'memory-only' };
}

/**
 * 挂载向后兼容的 window._ds* 接口
 *
 * 保持与 capability-register.js / capability-agent.js 相同的接口签名，
 * 内部委托给新架构模块。
 *
 * @param {Object} registry - 工具注册中心
 */
function _mountWindowApi(registry) {
    if (typeof window === 'undefined') return;

    // --- 能力注入回调（供 fetch-hub / anti-recall 调用） ---
    if (typeof window._dsCapabilityInjector !== 'function') {
        window._dsCapabilityInjector = function() {
            try {
                const config = _getConfig();
                if (!config || !config.agentSystemEnabled || !config.agentToolsEnabled) {
                    return '';
                }
                return buildCapabilityPrompt(registry);
            } catch (e) {
                return '';
            }
        };
    }

    // --- 工具调用接口（供 text-process.js 调用） ---
    window._dsParseToolCalls = parseToolCalls;
    window._dsExecuteToolCall = executeToolCall;
    window._dsGetToolLabel = getToolLabel;
    window._dsToolNames = registry.getInvocationNames();

    // --- MCP 工具注册/注销接口（供 mcp/client.js 集成调用） ---
    window._dsRegisterMcpServerTools = _registerMcpServerTools;
    window._dsUnregisterMcpServerTools = _unregisterMcpServerTools;
    window._dsUnregisterAllMcpTools = _unregisterAllMcpTools;

    // --- Agent 循环接口（供 engine.js 内部使用，同时暴露给外部调试） ---
    // 确保 _dsOnToolCallExecuted 使用 engine 的回调
    if (typeof window._dsOnToolCallExecuted !== 'function') {
        // engine.js 的 initAgentEngine() 会挂载这些，此处为兜底
        console.log('[AgentSystem] window._dsOnToolCallExecuted 将由 engine 模块挂载');
    }
}

/**
 * 安全获取最新 CONFIG
 * @returns {Object|null}
 */
function _getConfig() {
    try {
        if (typeof window !== 'undefined' && window.__dsConfig) {
            return window.__dsConfig;
        }
    } catch (e) {}
    // 回退：尝试从 config 模块导入
    try {
        const { CONFIG } = require('../config.js');
        return CONFIG;
    } catch (e) {}
    return null;
}

// ============================================================
// 导出（供外部模块引用）
// ============================================================

// 核心模块再导出
export { getDefaultRegistry, createToolRegistry } from './core/tool-registry.js';
export { initAgentEngine, stopAgent, recordOriginalTask, buildContinuationPrompt, buildStartAgentPrompt } from './core/engine.js';
export { initContextModule, buildCapabilityPrompt, buildCompactPrompt, buildToolIndexPrompt, estimateTokens, invalidateToolSchemaCache, invalidateAllCache } from './core/context.js';
export { createCircuitBreaker } from './core/harness.js';

// 护栏模块再导出
export { preToolCallGuard, postToolCallGuard, correctToolCall, checkParallelizability } from './guards/tool-guard.js';
export { fullInputGuard, validateInput, detectPromptInjection, detectAgentBoundaryInjection } from './guards/input-guard.js';
export { validateReplyContent, validateToolResult, reviewTaskCompletion, detectRepetitiveLoop, assessLoopHealth } from './guards/output-guard.js';

// 工具描述符再导出
export { MEMORY_TOOL_DESCRIPTORS } from './tools/memory-tools.js';
export { CONTROL_TOOL_DESCRIPTORS } from './tools/control-tools.js';
export { COLLABORATION_TOOL_DESCRIPTORS } from './tools/collaboration-tools.js';
export { PERCEPTION_TOOL_DESCRIPTORS } from './tools/perception-tools.js';
export { EXECUTION_TOOL_DESCRIPTORS } from './tools/execution-tools.js';