/**
 * 执行工具集（Execution 类）
 *
 * 职责：
 *   - 代码执行：python_exec（Python 沙箱）
 *   - 技能创建：skill_draft_create（技能草稿）
 *
 * 设计原则（参考《AI Agent 实战》指南）：
 *   - 执行工具改变世界，安全约束是核心
 *   - 通用执行器（如 Python 沙箱）优于专用工具
 *   - 代码必须在隔离沙盒中运行，默认不能访问网络
 *   - 高风险操作需额外的确认和权限控制
 *   - 执行工具不能并行调用（有副作用）
 */

import { CONFIG as _CONFIG_SNAPSHOT } from '../../config.js';

/**
 * 安全获取最新 CONFIG
 * @returns {Object}
 */
function _getConfig() {
    try {
        if (typeof window !== 'undefined' && window.__dsConfig) {
            return window.__dsConfig;
        }
    } catch (e) {}
    return _CONFIG_SNAPSHOT;
}

// ============================================================
// 工具描述符
// ============================================================

/** @type {import('../core/tool-registry.js').ToolDescriptor[]} */
export const EXECUTION_TOOL_DESCRIPTORS = [
    {
        name: 'python_exec',
        description: '在浏览器内置 Python 沙箱（Pyodide）中执行 Python 代码。适用于数学计算、数据处理、文件操作等需要编程能力的场景。',
        category: 'execution',
        riskLevel: 'medium',
        inputSchema: {
            type: 'object',
            properties: {
                code: { type: 'string', description: '要执行的 Python 代码' },
                timeoutMs: { type: 'integer', description: '超时毫秒数（默认 10000）', default: 10000 },
                reset: { type: 'boolean', description: '是否清理全局命名空间（默认 false）', default: false }
            },
            required: ['code']
        },
        boundaryNote: '沙箱环境隔离，不能访问网络或本地文件系统。代码执行有时间限制，超时会自动终止。'
    },
    {
        name: 'skill_draft_create',
        description: '创建新的技能草稿（Skill Draft）。用于将可复用的操作流程封装为技能。',
        category: 'execution',
        riskLevel: 'low',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: '技能名称（snake_case）' },
                description: { type: 'string', description: '技能描述' },
                content: { type: 'string', description: '技能内容（Markdown 格式）' }
            },
            required: ['name', 'description', 'content']
        },
        boundaryNote: '仅创建草稿，需用户审核后才会正式启用。'
    }
];

// ============================================================
// 执行器工厂
// ============================================================

/**
 * 创建执行工具执行器映射
 * @returns {Object<string, Function>}
 */
export function createExecutionToolExecutors() {
    return {
        python_exec: _executePythonExec,
        skill_draft_create: _executeSkillDraftCreate
    };
}

// ============================================================
// 执行器实现
// ============================================================

/**
 * 执行 python_exec — Python 沙箱
 *
 * 委托 window._dsExecutePythonExec（由 sandbox/index.js initSandbox 挂载）。
 * 描述符优先用 window._dsPythonExecDescriptor（含完整 Schema）。
 *
 * @param {Object} payload - { code: string, timeoutMs?: number, reset?: boolean }
 * @returns {Promise<import('../core/tool-registry.js').ToolResult>}
 */
async function _executePythonExec(payload) {
    const config = _getConfig();
    if (config && config.pythonSandboxEnabled === false) {
        return { ok: false, summary: 'python_exec 未启用', detail: '请在设置面板开启 Python 沙箱（pythonSandboxEnabled）开关' };
    }
    const fn = typeof window !== 'undefined' ? window._dsExecutePythonExec : null;
    if (typeof fn !== 'function') {
        return { ok: false, summary: 'python_exec 未启用', detail: 'window._dsExecutePythonExec 不存在' };
    }
    return fn(payload);
}

/**
 * 执行 skill_draft_create — 技能草稿创建
 *
 * 委托 executeSkillCreatorToolCall（由 skill/skill-creator-tool.js 导出）。
 * 通过 window._dsExecuteSkillCreator 或在导入时直接调用。
 *
 * @param {Object} payload - { name: string, description: string, content: string }
 * @returns {Promise<import('../core/tool-registry.js').ToolResult>}
 */
async function _executeSkillDraftCreate(payload) {
    try {
        // 动态导入避免循环依赖
        const { executeSkillCreatorToolCall } = await import('../../features/skill/skill-creator-tool.js');
        return executeSkillCreatorToolCall(payload);
    } catch (e) {
        return { ok: false, summary: '技能创建失败', detail: (e && e.message) || String(e) };
    }
}