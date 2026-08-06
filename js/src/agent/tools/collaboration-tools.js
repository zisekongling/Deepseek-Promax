/**
 * 协作工具集（Collaboration 类）
 *
 * 职责：
 *   - 用户交互：ask_user（Agent 主动向用户提问收集决策）
 *   - 子 Agent 委托（未来扩展）：spawn_subagent / send_message / cancel_subagent
 *
 * 设计原则（参考《AI Agent 实战》指南）：
 *   - ask_user 是 Agent 与用户的双向沟通通道
 *   - 返回 pending 标记，Agent 循环会等待 Promise 解析
 *   - 参数严格校验：1-4 个问题，每问题 2-4 个选项
 *   - 当 Agent 需要用户澄清模糊需求或关键决策点时使用
 */

// ============================================================
// 工具描述符
// ============================================================

/** @type {import('../core/tool-registry.js').ToolDescriptor[]} */
export const COLLABORATION_TOOL_DESCRIPTORS = [
    {
        name: 'ask_user',
        description: '向用户提问，收集决策信息。当需求模糊、涉及关键决策点、或需要用户输入个性化信息时调用。',
        category: 'collaboration',
        riskLevel: 'low',
        inputSchema: {
            type: 'object',
            properties: {
                questions: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            question: { type: 'string', description: '完整的问题文本' },
                            header: { type: 'string', description: '简短标签（最多 12 个字符）' },
                            options: {
                                type: 'array',
                                items: {
                                    type: 'object',
                                    properties: {
                                        label: { type: 'string', description: '选项显示文本' },
                                        description: { type: 'string', description: '选项说明' }
                                    },
                                    required: ['label']
                                },
                                description: '2-4 个选项'
                            },
                            multiSelect: { type: 'boolean', description: '是否允许多选（默认 false）' }
                        },
                        required: ['question', 'header', 'options']
                    },
                    description: '1-4 个问题'
                }
            },
            required: ['questions']
        },
        boundaryNote: 'ask_user 必须放在回复末尾，有 pending 提问时禁止调用 agent_finish。每次最多 4 个问题，每问题 2-4 个选项。'
    }
];

// ============================================================
// 执行器工厂
// ============================================================

/**
 * 创建协作工具执行器映射
 * @returns {Object<string, Function>}
 */
export function createCollaborationToolExecutors() {
    return {
        ask_user: _executeAskUser
    };
}

// ============================================================
// 执行器实现
// ============================================================

/**
 * 执行 ask_user — 向用户提问
 *
 * 校验 questions 参数（1-4 个问题，每问题 2-4 个选项），
 * 返回 pending 标记。实际异步等待由 engine.js 处理。
 *
 * @param {Object} payload - { questions: Array<{question, header, options, multiSelect}> }
 * @returns {import('../core/tool-registry.js').ToolResult}
 */
function _executeAskUser(payload) {
    if (!payload || !Array.isArray(payload.questions) || payload.questions.length < 1) {
        return { ok: false, summary: '参数错误', detail: 'questions 必须是 1-4 个问题的数组' };
    }
    if (payload.questions.length > 4) {
        return { ok: false, summary: '问题过多', detail: `每次最多 4 个问题，当前 ${payload.questions.length} 个` };
    }

    // 校验每个问题
    for (let i = 0; i < payload.questions.length; i++) {
        const q = payload.questions[i];
        if (!q || typeof q.question !== 'string' || q.question.trim() === '') {
            return { ok: false, summary: '问题缺失', detail: `第 ${i + 1} 个问题的 question 不能为空` };
        }
        if (!q.header || typeof q.header !== 'string' || q.header.trim() === '') {
            return { ok: false, summary: '标签缺失', detail: `第 ${i + 1} 个问题的 header 不能为空` };
        }
        if (q.header.length > 12) {
            return { ok: false, summary: '标签过长', detail: `第 ${i + 1} 个问题的 header 最多 12 字符` };
        }
        if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 4) {
            return { ok: false, summary: '选项数量错误', detail: `第 ${i + 1} 个问题的 options 必须是 2-4 个` };
        }
        for (let j = 0; j < q.options.length; j++) {
            const opt = q.options[j];
            if (!opt || typeof opt.label !== 'string' || opt.label.trim() === '') {
                return { ok: false, summary: '选项缺失', detail: `第 ${i + 1} 个问题第 ${j + 1} 个选项的 label 不能为空` };
            }
        }
    }

    // 返回 pending 标记（engine.js 会 await window._dsAskUser）
    const questionCount = payload.questions.length;
    return {
        ok: true,
        pending: true,
        summary: '等待用户回答',
        detail: `已展示 ${questionCount} 个问题给用户，等待回答`
    };
}