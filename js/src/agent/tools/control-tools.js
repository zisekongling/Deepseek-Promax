/**
 * 控制流工具集（Control 类）
 *
 * 职责：
 *   - Agent 循环生命周期控制：start_agent / agent_finish
 *   - 任务拆解与跟踪：todo_write / todo_read / todo_clear
 *
 * 设计原则（参考《AI Agent 实战》指南）：
 *   - agent_finish 是特殊的控制流终止信号，不触发 Agent 续跑
 *   - start_agent 用于 AI 显式声明进入 Agent 模式
 *   - todo 工具与 Agent 循环深度集成：有 pending todo 时放宽最大轮次
 *   - 控制流工具应保持简单，不做复杂业务逻辑
 */

// ============================================================
// 工具描述符
// ============================================================

/** @type {import('../core/tool-registry.js').ToolDescriptor[]} */
export const CONTROL_TOOL_DESCRIPTORS = [
    {
        name: 'start_agent',
        description: '显式启动 Agent 循环。当 AI 分析完任务后主动声明进入 Agent 模式时调用。',
        category: 'control',
        riskLevel: 'low',
        inputSchema: {
            type: 'object',
            properties: {
                task: { type: 'string', description: '任务描述（可选）' },
                reason: { type: 'string', description: '启动原因（可选）' }
            }
        },
        boundaryNote: '与隐式触发（工具调用后自动续跑）的区别：start_agent 用于任务开始时 AI 先分析再启动。'
    },
    {
        name: 'agent_finish',
        description: '显式结束 Agent 循环。当 AI 完成所有任务并输出最终结论后调用。调用后 Agent 循环终止，输入框解锁。',
        category: 'control',
        riskLevel: 'low',
        inputSchema: {
            type: 'object',
            properties: {
                reason: { type: 'string', description: '完成原因（可选）' }
            }
        },
        boundaryNote: '必须在回复末尾调用。有 pending 的 todo 或 ask_user 时禁止调用。此工具不触发 Agent 续跑。'
    },
    {
        name: 'todo_write',
        description: '全量替换 todo 清单。用于创建/更新任务规划，每次调用传入完整的 todo 列表。任务包含 3+ 独立步骤时必须调用。',
        category: 'control',
        riskLevel: 'low',
        inputSchema: {
            type: 'object',
            properties: {
                todos: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            id: { type: 'string', description: '唯一标识符' },
                            content: { type: 'string', description: '任务描述（可验证的完成条件）' },
                            status: { type: 'string', enum: ['pending', 'in_progress', 'completed'], description: '任务状态' },
                            priority: { type: 'string', enum: ['high', 'medium', 'low'], description: '优先级' }
                        },
                        required: ['id', 'content', 'status', 'priority']
                    },
                    description: '完整的 todo 列表'
                },
                merge: { type: 'boolean', description: '是否合并到现有列表（默认 false，全量替换）' }
            },
            required: ['todos']
        },
        boundaryNote: '同一时间只能有一个 in_progress。每次调用必须传入完整列表（非增量）。content 要写成可验证的完成条件。'
    },
    {
        name: 'todo_read',
        description: '读取当前 todo 清单。用于查看任务进度，不修改任何状态。',
        category: 'control',
        riskLevel: 'low',
        isReadOnly: true,
        inputSchema: {
            type: 'object',
            properties: {}
        }
    },
    {
        name: 'todo_clear',
        description: '清空 todo 清单。任务取消或全部完成后的清理操作。',
        category: 'control',
        riskLevel: 'medium',
        inputSchema: {
            type: 'object',
            properties: {}
        },
        boundaryNote: '清空不可逆。建议在 agent_finish 前调用。'
    }
];

// ============================================================
// 执行器工厂
// ============================================================

/**
 * 创建控制流工具执行器映射
 * @returns {Object<string, Function>}
 */
export function createControlToolExecutors() {
    return {
        start_agent: _executeStartAgent,
        agent_finish: _executeAgentFinish,
        todo_write: _executeTodoWrite,
        todo_read: _executeTodoRead,
        todo_clear: _executeTodoClear
    };
}

// ============================================================
// 执行器实现
// ============================================================

/**
 * 执行 start_agent — 显式启动 Agent 循环
 * @param {Object} payload
 * @returns {import('../core/tool-registry.js').ToolResult}
 */
function _executeStartAgent(payload) {
    const task = typeof payload?.task === 'string' ? payload.task.trim() : '';
    const reason = typeof payload?.reason === 'string' ? payload.reason.trim() : '';
    return {
        ok: true,
        summary: 'Agent 已启动',
        detail: task
            ? `任务：${task}${reason ? `（理由：${reason}）` : ''}`
            : (reason || 'AI 主动启动 Agent 循环'),
        agentStarted: true
    };
}

/**
 * 执行 agent_finish — 显式终止 Agent 循环
 * @param {Object} payload
 * @returns {import('../core/tool-registry.js').ToolResult}
 */
function _executeAgentFinish(payload) {
    const reason = typeof payload?.reason === 'string' ? payload.reason.trim() : '';
    return {
        ok: true,
        summary: 'Agent 已结束',
        detail: reason
            ? `AI 声明任务完成，理由：${reason}。Agent 循环已终止，用户可继续输入。`
            : 'AI 声明任务完成。Agent 循环已终止，用户可继续输入。'
    };
}

/**
 * 执行 todo_write — 全量替换 todo 清单
 * @param {Object} payload
 * @returns {import('../core/tool-registry.js').ToolResult}
 */
function _executeTodoWrite(payload) {
    if (typeof window === 'undefined' || typeof window._dsTodoWrite !== 'function') {
        return { ok: false, summary: 'Todo 模块未初始化', detail: 'window._dsTodoWrite 不存在' };
    }
    try {
        return window._dsTodoWrite(payload || {});
    } catch (e) {
        return { ok: false, summary: '执行失败', detail: String(e && e.message || e) };
    }
}

/**
 * 执行 todo_read — 读取当前 todo 清单
 * @param {Object} payload
 * @returns {import('../core/tool-registry.js').ToolResult}
 */
function _executeTodoRead(payload) {
    if (typeof window === 'undefined' || typeof window._dsTodoRead !== 'function') {
        return { ok: false, summary: 'Todo 模块未初始化', detail: 'window._dsTodoRead 不存在' };
    }
    try {
        return window._dsTodoRead();
    } catch (e) {
        return { ok: false, summary: '执行失败', detail: String(e && e.message || e) };
    }
}

/**
 * 执行 todo_clear — 清空 todo 清单
 * @param {Object} payload
 * @returns {import('../core/tool-registry.js').ToolResult}
 */
function _executeTodoClear(payload) {
    if (typeof window === 'undefined' || typeof window._dsTodoClear !== 'function') {
        return { ok: false, summary: 'Todo 模块未初始化', detail: 'window._dsTodoClear 不存在' };
    }
    try {
        return window._dsTodoClear();
    } catch (e) {
        return { ok: false, summary: '执行失败', detail: String(e && e.message || e) };
    }
}