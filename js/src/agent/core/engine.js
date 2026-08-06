/**
 * ReAct 循环引擎（Agent Engine）
 *
 * 职责：
 *   1. 实现 ReAct 循环：Reasoning → Acting → Observation
 *   2. 统一替代 capability-agent.js 和 loop-engine.js
 *   3. 集成 Harness 框架进行约束、验证、纠正
 *   4. 实现 Proposer-Reviewer 模式防止过早终止
 *
 * 设计原则（参考《AI Agent 实战》指南）：
 *   - Agent = LLM + Context + Tools（核心公式）
 *   - Harness = Context + Tools + Constraints + Verification + Correction（工程公式）
 *   - 保持简单：从最简单的方案开始，只在确实必要时才增加复杂度
 *   - 保持透明：明确显示规划步骤、执行日志和决策轨迹
 *   - 设计好 ACI（Agent-Computer Interface）：工具命名直观、参数有例子
 *
 * 循环流程：
 *   ```
 *   用户消息 → [能力] 提示词注入 → DeepSeek 回复
 *   → 工具调用解析 → 约束检查 → 工具执行 → 结果验证
 *   → [纠正?] → 构建续跑 prompt → 下一轮循环
 *   → agent_finish 或 达到上限 → 循环终止
 *   ```
 *
 * 与现有模块的关系：
 *   - 替换 capability-agent.js 的 _flushPendingToolResults / buildContinuationPrompt
 *   - 替换 loop-engine.js 的 Tab Lock / 防重发 / 漂移防护
 *   - 集成 harness.js 进行安全检查
 *   - 通过 window._dsOnToolCallExecuted 被 text-process.js 调用
 */

import { constrainToolCall, verifyToolResult, verifyLoopState } from './harness.js';
import { getInput, injectText, clickSendButton, sendViaEnterKey, isMobileDevice } from '../../features/capability-agent/input-dom.js';

// ============================================================
// 常量
// ============================================================

/** 默认最大续跑轮次 */
const DEFAULT_MAX_ROUNDS = 3;
/** 有 pending todo 时最大续跑轮次 */
const MAX_ROUNDS_WITH_TODO = 8;
/** 连续 N 轮未更新 todo 时注入 reminder */
const NAG_AFTER_ROUNDS = 3;
/** 续跑 prompt 中的 originalTask 最大长度 */
const MAX_ORIGINAL_TASK_LENGTH = 8000;
/** 防重发确认窗口（毫秒） */
const SEND_CONFIRMATION_WINDOW = 9000;

// ============================================================
// 循环状态
// ============================================================

/**
 * 创建循环状态对象
 * @returns {Object}
 */
function createLoopState() {
    return {
        /** @type {number} 当前轮次 */
        round: 0,
        /** @type {number} 最大轮次 */
        maxRounds: DEFAULT_MAX_ROUNDS,
        /** @type {string|null} 原始任务文本 */
        originalTask: null,
        /** @type {Array} 工具调用历史 */
        toolCallHistory: [],
        /** @type {Array} 工具执行结果队列 */
        pendingResults: [],
        /** @type {boolean} 用户是否已停止 */
        userStopRequested: false,
        /** @type {boolean} 是否正在发送续跑 */
        isSendingContinuation: false,
        /** @type {boolean} 是否已安装 Agent 标记 */
        agentMarkInstalled: false,
        /** @type {number} 上次用户消息时间戳 */
        lastUserMessageTime: 0,
        /** @type {number} 自上次 todo 更新以来的轮次 */
        roundsSinceLastTodo: 0,
        /** @type {boolean} 是否有 pending ask_user */
        hasPendingAskUser: false,
        /** @type {number} 连续失败次数 */
        consecutiveFailures: 0
    };
}

/** @type {ReturnType<typeof createLoopState>} */
let _loopState = null;

/**
 * 获取当前循环状态
 * @returns {Object}
 */
function getLoopState() {
    if (!_loopState) {
        _loopState = createLoopState();
    }
    return _loopState;
}

/**
 * 重置循环状态
 */
function resetLoopState() {
    _loopState = createLoopState();
}

// ============================================================
// 续跑 Prompt 构建
// ============================================================

/**
 * 截断文本到指定长度
 * @param {string} text - 原始文本
 * @param {number} maxLen - 最大长度
 * @returns {string}
 */
function clampText(text, maxLen) {
    if (!text || text.length <= maxLen) return text || '';
    return text.slice(0, maxLen) + '...[truncated]';
}

/**
 * 构建续跑 prompt（v2 边界标记格式）
 *
 * 续跑 prompt 是 Agent 循环的核心数据载体：
 *   包含原始任务、工具结果、用户答案、todo 状态
 *   用 __DS_AGENT_V2_START__ / __DS_AGENT_V2_END__ 边界标记包裹
 *
 * @param {Object} opts - 构建选项
 * @param {string} opts.originalTask - 原始任务文本
 * @param {Array} opts.toolResults - 工具执行结果数组
 * @param {Object} [opts.todoState] - 当前 todo 状态
 * @param {Array} [opts.userAnswers] - 用户答案（如有）
 * @param {boolean} [opts.isNagReminder] - 是否是 nag 提醒
 * @returns {string} 续跑 prompt
 */
export function buildContinuationPrompt(opts) {
    const { originalTask, toolResults, todoState, userAnswers, isNagReminder } = opts;
    const lines = [
        '__DS_AGENT_V2_START__',
        '根据工具执行结果，继续完成任务。如果任务已完成，请输出最终结论并调用 agent_finish。',
        ''
    ];

    if (originalTask) {
        lines.push('<original_task>');
        lines.push(clampText(originalTask, MAX_ORIGINAL_TASK_LENGTH));
        lines.push('</original_task>');
        lines.push('');
    }

    if (toolResults && toolResults.length > 0) {
        lines.push('<tool_results>');
        lines.push(JSON.stringify(toolResults, null, 2));
        lines.push('</tool_results>');
        lines.push('');
    }

    if (userAnswers && userAnswers.length > 0) {
        lines.push('<user_answers>');
        lines.push(JSON.stringify(userAnswers, null, 2));
        lines.push('</user_answers>');
        lines.push('');
    }

    if (todoState) {
        lines.push('<todo_status>');
        lines.push(JSON.stringify(todoState, null, 2));
        lines.push('</todo_status>');
        lines.push('');
    }

    if (isNagReminder) {
        lines.push('<reminder>');
        lines.push('你已经连续多轮未更新 todo 清单。请回顾当前进度，调用 todo_write 更新任务状态。');
        lines.push('</reminder>');
        lines.push('');
    }

    lines.push('__DS_AGENT_V2_END__');
    return lines.join('\n');
}

/**
 * 构建"Agent 已启动"的续跑 prompt（start_agent 触发）
 * @param {string} task - 任务描述
 * @returns {string}
 */
export function buildStartAgentPrompt(task) {
    const lines = [
        '__DS_AGENT_V2_START__',
        'Agent 模式已启动。请开始执行以下任务，按需调用工具。',
        '如果任务需要多步执行，请先调用 todo_write 规划步骤。',
        '任务完成后，请输出最终结论并调用 agent_finish。',
        '',
        '<original_task>',
        clampText(task, MAX_ORIGINAL_TASK_LENGTH),
        '</original_task>',
        '',
        '__DS_AGENT_V2_END__'
    ];
    return lines.join('\n');
}

// ============================================================
// Agent 循环主流程
// ============================================================

/**
 * 处理工具调用执行结果（text-process.js 回调入口）
 *
 * 这是 Agent 循环的主入口：
 *   1. text-process.js 扫描 AI 回复中的工具调用 XML
 *   2. 执行工具调用后，通过此函数通知引擎
 *   3. 引擎收集结果，等待流式输出完成后发送续跑 prompt
 *
 * @param {Array} agentResults - 工具执行结果数组 [{ tool, ok, summary, detail, pending?, ... }]
 * @param {string} originalPrompt - 原始用户消息
 * @param {Object} [registry] - 工具注册中心（用于约束检查）
 */
export async function onToolCallExecuted(agentResults, originalPrompt, registry) {
    const state = getLoopState();

    // 记录原始任务
    if (originalPrompt && !state.originalTask) {
        state.originalTask = originalPrompt;
    }

    // 收集结果（text-process.js 已通过 requiresAgentFeedback 过滤，此处仅做验证和记录）
    const feedbackResults = [];
    for (const r of agentResults) {
        // 检查 agent_finish（终止循环）
        // text-process.js 已提前过滤 agent_finish，此处为冗余安全检查
        const toolName = r.tool || r.toolName || r.name;
        if (toolName === 'agent_finish') {
            stopAgent('AI 调用 agent_finish');
            return;
        }

        // 工具结果验证
        if (registry) {
            const verification = verifyToolResult(r.tool || r.toolName, r, state.toolCallHistory);
            if (!verification.valid) {
                console.warn('[AgentEngine] 工具结果验证失败:', verification.issue);
            }
        }

        feedbackResults.push(r);

        // 记录到历史
        state.toolCallHistory.push({
            name: r.tool || r.toolName,
            ok: r.ok,
            skipped: r.skipped,
            pending: r.pending,
            timestamp: Date.now()
        });
    }

    // 收集结果到队列
    state.pendingResults.push(...feedbackResults);

    // 如果有 pending 结果，等待流式输出完成后发送续跑
    if (state.pendingResults.length > 0) {
        await flushPendingResults(registry);
    }
}

/**
 * 等待流式输出完成后发送续跑 prompt
 * @param {Object} [registry] - 工具注册中心
 */
async function flushPendingResults(registry) {
    const state = getLoopState();

    if (state.isSendingContinuation) return;
    if (state.pendingResults.length === 0) return;

    state.isSendingContinuation = true;

    try {
        // 等待 AI 回复完成（停止按钮消失）
        await waitForReplyComplete();

        // 检查是否应该继续
        if (state.userStopRequested) {
            state.pendingResults = [];
            return;
        }

        // 步骤 1.5：检测 ask_user 调用，暂停续跑等待用户回答
        // 此时 text-process.js 已渲染完卡片，_dsPendingAskPromise 已就绪
        const hasAskUser = state.pendingResults.some(r =>
            (r.tool === 'ask_user' || r.toolName === 'ask_user' || r.name === 'ask_user') && r.pending
        );
        if (hasAskUser) {
            console.log('[AgentEngine] 检测到 ask_user 调用，暂停续跑等待用户回答...');
            const userResponse = await waitForAskUserAnswer();
            if (userResponse && userResponse.cancelled) {
                console.log('[AgentEngine] 用户取消了提问');
                state.pendingResults.push({
                    tool: 'ask_user', toolName: 'ask_user',
                    ok: true, skipped: true,
                    summary: '用户取消了提问',
                    detail: '用户点击了取消按钮，未提供答案。可基于现有信息继续推进或再次提问。'
                });
            } else if (userResponse) {
                console.log('[AgentEngine] 用户已回答提问');
                state.userAnswers = state.userAnswers || [];
                state.userAnswers.push(userResponse);
                state.pendingResults.push({
                    tool: 'ask_user', toolName: 'ask_user',
                    ok: true,
                    summary: '用户已回答',
                    detail: JSON.stringify(userResponse),
                    userAnswers: userResponse
                });
            }
        }

        if (state.userStopRequested) {
            state.pendingResults = [];
            return;
        }

        // 更新轮次
        state.round++;

        // 更新 todo 计数
        const hasTodo = state.pendingResults.some(r => r.tool === 'todo_write' || r.toolName === 'todo_write' || r.name === 'todo_write');
        if (hasTodo) {
            state.roundsSinceLastTodo = 0;
        } else {
            state.roundsSinceLastTodo++;
        }

        // 调整最大轮次（有 todo 时放宽）
        const hasIncompleteTodos = checkIncompleteTodos();
        state.maxRounds = hasIncompleteTodos ? MAX_ROUNDS_WITH_TODO : DEFAULT_MAX_ROUNDS;

        // Harness：循环状态验证
        const loopCheck = verifyLoopState({
            round: state.round,
            maxRounds: state.maxRounds,
            toolCallHistory: state.toolCallHistory,
            userStopRequested: state.userStopRequested
        });
        if (!loopCheck.shouldContinue) {
            stopAgent(loopCheck.stopReason);
            return;
        }

        // 构建续跑 prompt
        const results = [...state.pendingResults];
        state.pendingResults = [];

        const nagReminder = state.roundsSinceLastTodo >= NAG_AFTER_ROUNDS;

        const todoState = getCurrentTodoState();
        const prompt = buildContinuationPrompt({
            originalTask: state.originalTask,
            toolResults: results,
            todoState: todoState && todoState.todos ? todoState : undefined,
            userAnswers: state.userAnswers,
            isNagReminder: nagReminder
        });

        if (nagReminder) {
            state.roundsSinceLastTodo = 0;
        }

        // 发送续跑 prompt（注入到输入框并点击发送）
        await sendContinuationPrompt(prompt);

    } finally {
        state.isSendingContinuation = false;
    }
}

/**
 * 停止 Agent 循环
 * @param {string} reason - 停止原因
 */
export function stopAgent(reason) {
    const state = getLoopState();
    state.userStopRequested = true;
    state.pendingResults = [];
    state.isSendingContinuation = false;

    console.log('[AgentEngine] Agent 循环已终止:', reason);

    // 取消 pending 的 ask_user Promise
    if (typeof window !== 'undefined') {
        if (window._dsPendingAskResolver) {
            try {
                window._dsPendingAskResolver({ cancelled: true, reason: reason || 'agent_finish' });
            } catch (e) {}
            window._dsPendingAskResolver = null;
        }
        if (typeof window._dsCancelAskUser === 'function') {
            try { window._dsCancelAskUser(); } catch (e) {}
        }
        window._dsPendingAskPromise = null;
    }

    // 解锁输入框
    if (typeof window !== 'undefined' && typeof window._dsUnlockInput === 'function') {
        try { window._dsUnlockInput(); } catch (e) {}
    }
}

/**
 * 记录原始任务
 * @param {string} task - 原始任务文本
 */
export function recordOriginalTask(task) {
    const state = getLoopState();
    state.originalTask = task;
    state.lastUserMessageTime = Date.now();
}

/**
 * 用户提交 ask_user 答案并恢复 agent（当 agent 未运行时）
 *
 * text-process.js 在用户点击提交答案时，如果检测到 agent 未在运行
 * （如 agent_finish 已终止、页面刷新后、或用户停止），会调用此函数手动恢复续跑。
 *
 * 参考：capability-agent/index.js 的 submitAskUserAndResume
 *
 * @param {Array} answers - 用户提交的答案数组
 */
function submitAskUserAndResume(answers) {
    const state = getLoopState();
    if (state.isSendingContinuation) {
        console.log('[AgentEngine] agent 正在运行，跳过手动恢复');
        return;
    }

    console.log('[AgentEngine] 用户提交 ask_user 答案，手动恢复 agent 续跑');

    state.pendingResults.push({
        tool: 'ask_user', toolName: 'ask_user',
        ok: true,
        summary: '用户已回答',
        detail: JSON.stringify(answers || []),
        userAnswers: answers || []
    });

    state.userAnswers = state.userAnswers || [];
    state.userAnswers.push(answers || []);
    state.lastUserMessageTime = Date.now();
    state.userStopRequested = false;

    state.isSendingContinuation = true;
    setTimeout(() => {
        flushPendingResults().catch(e => {
            console.warn('[AgentEngine] 手动恢复 flush 失败:', e);
            state.isSendingContinuation = false;
        });
    }, 0);
}

// ============================================================
// 辅助函数
// ============================================================

/**
 * 等待 AI 回复完成（停止按钮消失）
 * @returns {Promise<void>}
 */
function waitForReplyComplete() {
    return new Promise((resolve) => {
        const state = getLoopState();
        if (state.userStopRequested) { resolve(); return; }

        const check = () => {
            if (state.userStopRequested) { resolve(); return; }
            // 检查停止按钮是否还在
            const stopBtn = typeof window !== 'undefined' ? window._dsGetStopBtn?.() : null;
            if (!stopBtn || stopBtn.style.display === 'none') {
                // 再等 500ms 确保稳定
                setTimeout(resolve, 500);
            } else {
                setTimeout(check, 200);
            }
        };
        check();
    });
}

/**
 * 等待 ask_user 回答
 *
 * 关键设计：不创建自己的 Promise，而是轮询等待 text-process.js 在渲染卡片时创建的
 * window._dsPendingAskPromise（真正的 Promise）。text-process.js 在用户点击提交时
 * 通过 window._dsPendingAskResolver 来 resolve 这个 Promise。
 *
 * 参考：capability-agent/ask-user-coordinator.js 的 _waitForAskUserAnswers
 *
 * @returns {Promise<Object|null>} 返回用户答案数组，或 { cancelled: true } 表示取消，或 null 表示超时
 */
function waitForAskUserAnswer() {
    return new Promise(async (resolve) => {
        const state = getLoopState();

        // 超时保护（5 分钟）
        const timeout = setTimeout(() => {
            console.warn('[AgentEngine] 等待 ask_user 回答超时（5分钟）');
            resolve(null);
        }, 300000);

        try {
            // 轮询等待 text-process.js 创建 _dsPendingAskPromise
            // text-process.js 在 _dsOnToolCallExecuted 之后渲染卡片时创建
            let promise = null;
            for (let i = 0; i < 50; i++) {
                if (state.userStopRequested) {
                    clearTimeout(timeout);
                    resolve(null);
                    return;
                }
                if (typeof window !== 'undefined' && window._dsPendingAskPromise) {
                    promise = window._dsPendingAskPromise;
                    break;
                }
                await sleep(100);
            }

            if (!promise) {
                console.warn('[AgentEngine] ask_user 调用但未找到 Promise，跳过等待');
                clearTimeout(timeout);
                resolve(null);
                return;
            }

            // 等待用户回答（text-process.js 的 submit 按钮会 resolve 这个 Promise）
            let userResponse = null;
            try {
                userResponse = await promise;
            } catch (e) {
                console.warn('[AgentEngine] 等待用户回答异常:', e);
                userResponse = { cancelled: true, reason: '等待异常: ' + (e && e.message || e) };
            }

            // 清理全局状态
            if (typeof window !== 'undefined') {
                window._dsPendingAskPromise = null;
                window._dsPendingAskResolver = null;
            }

            clearTimeout(timeout);
            resolve(userResponse);
        } catch (e) {
            clearTimeout(timeout);
            resolve(null);
        }
    });
}

/**
 * 检查是否有未完成的 todo
 * @returns {boolean}
 */
function checkIncompleteTodos() {
    try {
        if (typeof window !== 'undefined' && typeof window._dsTodoRead === 'function') {
            const result = window._dsTodoRead();
            if (result && result.ok && Array.isArray(result.todos)) {
                return result.todos.some(t => t.status !== 'completed');
            }
        }
    } catch (e) {}
    return false;
}

/**
 * 获取当前 todo 状态
 * @returns {Object|null}
 */
function getCurrentTodoState() {
    try {
        if (typeof window !== 'undefined' && typeof window._dsTodoRead === 'function') {
            return window._dsTodoRead();
        }
    } catch (e) {}
    return null;
}

/**
 * 发送续跑 prompt 到输入框
 *
 * 使用 input-dom.js 的 DOM 操作函数（与旧版 capability-agent 一致），
 * 包含桌面端/手机端自适应、React 输入框注入、Enter 键兜底等完整策略。
 *
 * @param {string} prompt - 续跑 prompt
 * @returns {Promise<boolean>} 是否发送成功
 */
async function sendContinuationPrompt(prompt) {
    const state = getLoopState();
    if (state.userStopRequested) return false;

    console.log('[AgentEngine] 开始发送续跑 prompt');

    const CONT_DELAY = 200;
    await sleep(CONT_DELAY);

    if (state.userStopRequested) return false;

    const input = getInput();
    if (!input) {
        console.warn('[AgentEngine] 未找到输入框');
        return false;
    }

    // 注入文本到输入框（input-dom.js 的 injectText 支持桌面端/手机端多策略）
    const wasReadonly = input.hasAttribute('readonly');
    if (wasReadonly) input.removeAttribute('readonly');
    try {
        if (!injectText(input, prompt)) {
            console.warn('[AgentEngine] 文本注入失败');
            return false;
        }
    } finally {
        if (wasReadonly) input.setAttribute('readonly', 'readonly');
    }
    console.log('[AgentEngine] 续跑 prompt 已注入输入框');

    // 延迟后点击发送按钮
    if (isMobileDevice()) {
        await sleep(200);
    } else {
        await sleep(600);
    }

    if (state.userStopRequested) return false;

    if (wasReadonly) input.removeAttribute('readonly');
    try {
        const btnClicked = clickSendButton();
        if (btnClicked) {
            console.log('[AgentEngine] 发送按钮已点击');
        } else {
            console.warn('[AgentEngine] 发送按钮点击失败，尝试 Enter 键发送');
            await sleep(200);
            sendViaEnterKey(input);
            console.log('[AgentEngine] Enter 键已发送');
        }
    } finally {
        if (wasReadonly) input.setAttribute('readonly', 'readonly');
    }

    // 等待并验证发送是否成功（输入框是否清空）
    await sleep(1000);
    const inputText = (input.value || input.textContent || '').trim();
    if (!inputText || inputText.length < 10) {
        console.log(`[AgentEngine] 续跑 prompt 发送成功`);
        return true;
    }

    // 二次尝试 Enter 键发送
    console.warn('[AgentEngine] 输入框未清空，再次尝试 Enter 键发送');
    if (wasReadonly) input.removeAttribute('readonly');
    try {
        sendViaEnterKey(input);
    } finally {
        if (wasReadonly) input.setAttribute('readonly', 'readonly');
    }
    await sleep(1000);
    const inputText2 = (input.value || input.textContent || '').trim();
    if (!inputText2 || inputText2.length < 10) {
        console.log('[AgentEngine] 续跑 prompt 发送成功（Enter 键）');
        return true;
    }

    console.error('[AgentEngine] 续跑 prompt 发送失败 — 输入框未清空');
    return false;
}

/**
 * 异步延迟
 * @param {number} ms - 毫秒
 * @returns {Promise<void>}
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================
// 初始化
// ============================================================

let _initialized = false;

/**
 * 初始化 Agent 循环引擎
 *
 * 挂载 window 全局接口供 text-process.js 等模块调用。
 */
export function initAgentEngine() {
    if (_initialized) return;
    _initialized = true;

    if (typeof window !== 'undefined') {
        // 工具调用结果回调（text-process.js → engine）
        window._dsOnToolCallExecuted = onToolCallExecuted;
        // 停止 Agent 循环
        window._dsStopAgent = stopAgent;
        // 记录原始任务
        window._dsRecordOriginalTask = recordOriginalTask;
        // 获取原始任务
        window._dsGetOriginalTask = () => getLoopState().originalTask || '';
        // 获取循环状态（调试用）
        window._dsGetLoopState = getLoopState;
        // Agent 是否正在运行（供 text-process.js 判断是否需要手动恢复）
        window._dsIsAgentRunning = () => getLoopState().isSendingContinuation;
        // 用户提交 ask_user 答案并恢复 agent（agent 未运行时）
        window._dsSubmitAskUserAndResume = submitAskUserAndResume;
        // 重置循环状态（新对话时调用）
        window._dsResetContinuationState = resetLoopState;
    }

    console.log('[AgentEngine] 已初始化');
}