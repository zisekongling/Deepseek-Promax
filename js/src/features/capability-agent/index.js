/**
 * Capability Agent 聚合入口 — 工具调用结果回传给 DeepSeek
 *
 * 参考 deepseek-pp/core/inline-agent/loop.ts 和 prompt.ts 的实现：
 *   1. 监听 AI 回复完成（流式输出结束）
 *   2. 检测回复中是否包含工具调用 XML（<memory_save> 等）
 *   3. 执行工具调用，收集结果
 *   4. 构建"续跑 prompt"（包含 <original_task> + <tool_results>）
 *   5. 将续跑 prompt 作为新的用户消息发送给 DeepSeek
 *   6. AI 看到工具结果后继续对话，形成 Agent 循环
 *
 * 防循环保护：
 *   - 安全上限：50 次（避免无限循环，正常情况下由 AI 调用 agent_finish 结束）
 *   - 续跑 prompt 中明确告知 AI"任务完成后调用 agent_finish 结束循环"
 *   - AI 调用 agent_finish 工具时立即终止续跑
 *
 * 触发机制：
 *   - text-process.js 的 scanToolCallElements 执行工具调用后，
 *     通过 window._dsOnToolCallExecuted 回调通知本模块
 *   - 本模块等待 AI 回复完成（停止按钮消失），然后发送续跑 prompt
 *
 * 模块分区（已拆分到 ./capability-agent/ 子目录）：
 *   1. 状态存储与持久化  - state / sessionStorage / 常量 / sleep → state-store.js
 *   2. MCP 结果归一化    - normalizeToolResult → result-normalizer.js
 *   3. 续跑 Prompt 构建  - buildContinuationPrompt / clampText → prompt-builder.js
 *   4. 输入框 DOM 操作   - injectText / getSendBtn / getStopBtn → input-dom.js
 *   5. Agent UI 组件     - lockInput / showStopButton / 徽章样式 → agent-ui.js
 *   6. ask_user 协调     - _waitForAskUserAnswers / _formatAskUserAnswers → ask-user-coordinator.js
 *   7. 主流程与初始化     - onToolCallExecuted / _flushPendingToolResults / initCapabilityAgent → index.js（本文件）
 */

import { registerCompletionHandler } from '../../utils/fetch-hub.js';

import {
    state,
    _getConfigSafe,
    getMaxRounds,
    _saveStateToSessionStorage,
    _restoreStateFromSessionStorage,
    _clearSessionStorage,
    sleep,
    CONTINUATION_DELAY_MS,
    RECENT_MESSAGE_THRESHOLD_MS
} from './state-store.js';
import { normalizeToolResult } from './result-normalizer.js';
import { buildContinuationPrompt } from './prompt-builder.js';
import {
    getInput,
    getSendBtn,
    isMobileDevice,
    isGenerating,
    injectText,
    clickSendButton,
    sendViaEnterKey
} from './input-dom.js';
import {
    lockInput,
    unlockInput,
    hideStopButton,
    _injectAgentBadgeStyles
} from './agent-ui.js';
import {
    _hasTodoWrite,
    _waitForAskUserAnswers,
    _formatAskUserAnswers
} from './ask-user-coordinator.js';

// ============================================================
// 续跑发送逻辑
// ============================================================

/**
 * 等待 AI 回复完成（流式输出结束）
 *
 * 三层判定逻辑（按优先级）：
 *   1. 优先方案：等待 fetch-hub 的 onEnd 事件（promise 仍存在时）
 *   2. onEnd 已触发判定：promise 已被消费置 null，但 replyCompletedAt > 0
 *   3. 降级方案：DOM 停止按钮检测（fetch-hub 完全未触发时）
 *
 * @param {number} timeoutMs - 超时时间（毫秒）
 * @returns {Promise<boolean>} 是否已完成
 */
async function waitForReplyComplete(timeoutMs = 120000) {
    const startTime = Date.now();

    // 优先方案：等待 fetch-hub 的 onEnd 事件（流式响应完成的精确信号）
    if (state.replyCompletePromise) {
        try {
            await Promise.race([
                state.replyCompletePromise,
                new Promise((_, reject) => setTimeout(() => reject(new Error('stream-timeout')), timeoutMs))
            ]);
            console.log('[CapabilityAgent] 收到 fetch-hub onEnd 信号，AI 回复已完成');
            await sleep(500);
            return true;
        } catch (e) {
            console.warn('[CapabilityAgent] 等待流式完成信号超时，降级到 DOM 检测');
        }
    }

    // 第二层：onEnd 已触发但 promise 已被消费（时序竞态防护）
    if (state.replyCompletedAt > 0) {
        console.log('[CapabilityAgent] onEnd 已触发（promise 已消费），AI 回复已完成');
        await sleep(500);
        return true;
    }

    // 第二层半：续跑循环中的时序竞态防护
    if (state.isSendingContinuation && !state.replyCompletePromise && state.replyCompletedAt === 0) {
        console.log('[CapabilityAgent] 续跑循环中，等待新回复的 onStart 创建 promise...');
        for (let i = 0; i < 10; i++) {
            if (state.userStopRequested) return false;
            if (state.replyCompletePromise || state.replyCompletedAt > 0) break;
            await sleep(200);
        }
        if (state.replyCompletePromise) {
            try {
                await Promise.race([
                    state.replyCompletePromise,
                    new Promise((_, reject) => setTimeout(() => reject(new Error('stream-timeout')), timeoutMs))
                ]);
                console.log('[CapabilityAgent] 收到新回复的 onEnd 信号，AI 回复已完成');
                await sleep(500);
                return true;
            } catch (e) {
                console.warn('[CapabilityAgent] 等待新回复流式完成信号超时，降级到 DOM 检测');
            }
        }
        if (state.replyCompletedAt > 0) {
            console.log('[CapabilityAgent] 新回复 onEnd 已触发，AI 回复已完成');
            await sleep(500);
            return true;
        }
    }

    // 第三层：降级方案 — DOM 停止按钮检测（fetch-hub 未触发时的 fallback）
    if (!isGenerating()) {
        return true;
    }

    console.log('[CapabilityAgent] (fallback) AI 正在生成，等待回复完成（DOM 检测）...');
    while (Date.now() - startTime < timeoutMs) {
        if (state.userStopRequested) {
            console.log('[CapabilityAgent] (fallback) 用户请求停止，退出等待');
            return false;
        }
        if (state.replyCompletedAt > 0) {
            console.log('[CapabilityAgent] (fallback) 收到 onEnd 信号，AI 回复已完成');
            await sleep(500);
            return true;
        }
        if (!isGenerating()) {
            await sleep(800);
            if (!isGenerating()) {
                console.log('[CapabilityAgent] (fallback) AI 回复已完成');
                return true;
            }
        }
        await sleep(500);
    }
    console.warn('[CapabilityAgent] 等待 AI 回复完成超时');
    return false;
}

/**
 * 发送续跑 prompt 给 DeepSeek
 *
 * @param {string} prompt - 续跑 prompt 文本
 * @returns {Promise<boolean>} 是否发送成功
 */
async function sendContinuationPrompt(prompt) {
    console.log('[CapabilityAgent] 开始发送续跑 prompt');

    await sleep(CONTINUATION_DELAY_MS);

    if (state.continuationRound >= getMaxRounds()) {
        console.warn('[CapabilityAgent] 已达最大续跑次数（' + getMaxRounds() + '），停止');
        return false;
    }

    const input = getInput();
    if (!input) {
        console.warn('[CapabilityAgent] 未找到输入框');
        return false;
    }
    const wasReadonly = input.hasAttribute('readonly');
    if (wasReadonly) input.removeAttribute('readonly');
    state.isScriptInjecting = true;
    try {
        if (!injectText(input, prompt)) {
            console.warn('[CapabilityAgent] 文本注入失败');
            return false;
        }
    } finally {
        state.isScriptInjecting = false;
        if (wasReadonly) input.setAttribute('readonly', 'readonly');
    }
    console.log('[CapabilityAgent] 续跑 prompt 已注入输入框');

    if (isMobileDevice()) {
        await sleep(200);
    } else {
        await sleep(600);
    }

    state.isScriptInjecting = true;
    if (wasReadonly) input.removeAttribute('readonly');
    try {
        const btnClicked = clickSendButton();
        if (btnClicked) {
            console.log('[CapabilityAgent] 发送按钮已点击');
        } else {
            console.warn('[CapabilityAgent] 发送按钮点击失败，尝试 Enter 键发送');
            await sleep(200);
            sendViaEnterKey(input);
            console.log('[CapabilityAgent] Enter 键已发送');
        }
    } finally {
        state.isScriptInjecting = false;
        if (wasReadonly) input.setAttribute('readonly', 'readonly');
    }

    // 等待并验证发送是否成功（输入框是否清空）
    await sleep(1000);
    const inputText = (input.value || input.textContent || '').trim();
    if (!inputText || inputText.length < 10) {
        state.continuationRound++;
        console.log(`[CapabilityAgent] 续跑 prompt 发送成功（第 ${state.continuationRound} 轮）`);
        return true;
    }

    console.warn('[CapabilityAgent] 输入框未清空，再次尝试 Enter 键发送');
    state.isScriptInjecting = true;
    if (wasReadonly) input.removeAttribute('readonly');
    try {
        sendViaEnterKey(input);
    } finally {
        state.isScriptInjecting = false;
        if (wasReadonly) input.setAttribute('readonly', 'readonly');
    }
    await sleep(1000);
    const inputText2 = (input.value || input.textContent || '').trim();
    if (!inputText2 || inputText2.length < 10) {
        state.continuationRound++;
        console.log(`[CapabilityAgent] 续跑 prompt 发送成功（第 ${state.continuationRound} 轮，Enter 键）`);
        return true;
    }

    console.error('[CapabilityAgent] 续跑 prompt 发送失败 — 输入框未清空');
    return false;
}

/**
 * 工具调用执行完成后的回调
 *
 * 由 text-process.js 的 scanToolCallElements 在执行工具调用后触发。
 *
 * @param {Array<{ name: string, ok: boolean, summary: string, detail?: string }>} toolResults - 工具调用结果
 * @param {string} originalPrompt - 触发工具调用的原始用户消息
 */
async function onToolCallExecuted(toolResults, originalPrompt) {
    const { CONFIG } = _getConfigSafe();
    if (!CONFIG || !CONFIG.agentSystemEnabled || !CONFIG.agentLoopEnabled) {
        console.log('[CapabilityAgent] agentSystem/agentLoop 未开启，跳过续跑');
        return;
    }
    if (!toolResults || toolResults.length === 0) return;

    // 工具执行期间刷新时间戳（避免长耗时工具执行后门控过期）
    if (state.isSendingContinuation) {
        state.lastUserMessageTime = Date.now();
        _saveStateToSessionStorage();
    }

    // 历史消息加载防护
    if (!state.lastUserMessageTime) {
        console.log('[CapabilityAgent] lastUserMessageTime 为 0（页面刚加载/刷新），视为历史消息加载，跳过续跑');
        _saveSkippedToolResults(toolResults, originalPrompt);
        return;
    }
    if (Date.now() - state.lastUserMessageTime > RECENT_MESSAGE_THRESHOLD_MS) {
        console.log('[CapabilityAgent] 距上次用户消息过久，视为历史消息加载，跳过续跑');
        _saveSkippedToolResults(toolResults, originalPrompt);
        return;
    }

    console.log(`[CapabilityAgent] 收到 ${toolResults.length} 个工具结果，原始任务:`, (originalPrompt || '').slice(0, 80));

    if (!state.originalTask && originalPrompt) {
        state.originalTask = originalPrompt;
    }

    // 合并到待发送队列（支持并行多工具调用）
    const normalizedResults = toolResults.map(r => normalizeToolResult(r.toolName || r.name, r));
    state.pendingToolResults.push(...normalizedResults);
    console.log(`[CapabilityAgent] 待发送工具结果共 ${state.pendingToolResults.length} 个`);

    // 检测到 todo_write 调用时重置未更新计数器
    if (_hasTodoWrite(toolResults)) {
        state.roundsSinceTodo = 0;
        console.log('[CapabilityAgent] 检测到 todo_write 调用，重置 roundsSinceTodo');
    }

    // 首次触发时启动 flush 流程
    if (state.isSendingContinuation) {
        console.log('[CapabilityAgent] 续跑流程已在运行，工具结果已加入队列等待合并发送');
        return;
    }
    state.isSendingContinuation = true;
    lockInput();
    console.log('[CapabilityAgent] Agent 模式已启动（工具调用触发），已锁定输入框');
    setTimeout(() => {
        _flushPendingToolResults().catch(e => {
            console.warn('[CapabilityAgent] flush 失败:', e);
            state.isSendingContinuation = false;
        });
    }, 0);
}

/**
 * 保存被跳过续跑的工具调用结果
 *
 * @param {Array} toolResults - 工具调用结果数组
 * @param {string} originalPrompt - 原始用户任务
 */
function _saveSkippedToolResults(toolResults, originalPrompt) {
    if (!toolResults || toolResults.length === 0) return;
    try {
        const normalizedResults = toolResults.map(r => normalizeToolResult(r.toolName || r.name, r));
        state.skippedToolResults.push(...normalizedResults);
        if (!state.originalTask && originalPrompt) {
            state.originalTask = originalPrompt;
        }
        console.log(`[CapabilityAgent] 已保存 ${normalizedResults.length} 个被跳过的工具结果，等待用户手动执行`);
        if (typeof window !== 'undefined' && typeof window._dsOnToolCallSkipped === 'function') {
            window._dsOnToolCallSkipped(normalizedResults.length);
        }
    } catch (e) {
        console.warn('[CapabilityAgent] 保存被跳过的工具结果失败:', e);
    }
}

/**
 * 用户手动恢复被跳过的续跑
 *
 * 由 text-process.js 的"执行"按钮点击触发。
 */
function resumeSkippedContinuation() {
    if (state.skippedToolResults.length === 0) {
        console.log('[CapabilityAgent] 没有被跳过的工具结果，无需恢复');
        return;
    }
    if (state.isSendingContinuation) {
        console.log('[CapabilityAgent] 续跑流程已在运行，无法恢复被跳过的结果');
        return;
    }
    const { CONFIG } = _getConfigSafe();
    if (!CONFIG || !CONFIG.agentSystemEnabled || !CONFIG.agentLoopEnabled) {
        console.log('[CapabilityAgent] agentSystem/agentLoop 未开启，无法恢复');
        return;
    }

    console.log(`[CapabilityAgent] 用户手动恢复 ${state.skippedToolResults.length} 个被跳过的工具结果`);

    state.pendingToolResults.push(...state.skippedToolResults);
    state.skippedToolResults = [];

    state.lastUserMessageTime = Date.now();
    _saveStateToSessionStorage();

    state.isSendingContinuation = true;
    setTimeout(() => {
        _flushPendingToolResults().catch(e => {
            console.warn('[CapabilityAgent] flush 失败:', e);
            state.isSendingContinuation = false;
        });
    }, 0);
}

/**
 * 用户提交 ask_user 答案并恢复 agent（当 agent 未运行时）
 *
 * @param {Array} answers - 用户提交的答案数组
 */
function submitAskUserAndResume(answers) {
    if (state.isSendingContinuation) {
        console.log('[CapabilityAgent] agent 正在运行，跳过手动恢复');
        return;
    }

    const { CONFIG } = _getConfigSafe();
    if (!CONFIG || !CONFIG.agentSystemEnabled || !CONFIG.agentLoopEnabled) {
        console.log('[CapabilityAgent] agentSystem/agentLoop 未开启，无法恢复');
        return;
    }

    console.log('[CapabilityAgent] 用户提交 ask_user 答案，手动恢复 agent 续跑');

    state.pendingToolResults.push({
        name: 'ask_user',
        toolName: 'ask_user',
        ok: true,
        summary: '用户已回答',
        detail: _formatAskUserAnswers(answers),
        userAnswers: answers
    });

    state.lastUserMessageTime = Date.now();
    _saveStateToSessionStorage();

    state.isSendingContinuation = true;
    lockInput();
    setTimeout(() => {
        _flushPendingToolResults().catch(e => {
            console.warn('[CapabilityAgent] flush 失败:', e);
            state.isSendingContinuation = false;
            unlockInput();
        });
    }, 0);
}

/**
 * 合并发送所有待处理的工具调用结果
 *
 * @returns {Promise<void>}
 */
async function _flushPendingToolResults() {
    lockInput();
    try {
        while (state.pendingToolResults.length > 0) {
            if (state.userStopRequested) {
                console.log('[CapabilityAgent] 用户请求停止，终止续跑循环');
                state.pendingToolResults = [];
                break;
            }

            // 步骤1：等待 AI 完成当前回复
            await waitForReplyComplete();

            // 步骤1.5：等待工具执行稳定
            await _waitForToolResultsStable();

            if (state.userStopRequested) {
                console.log('[CapabilityAgent] 等待 AI 回复期间用户请求停止，终止');
                state.pendingToolResults = [];
                break;
            }

            if (state.pendingToolResults.length === 0) break;

            // 步骤2：检查续跑次数
            if (state.continuationRound >= getMaxRounds()) {
                console.warn('[CapabilityAgent] 已达最大续跑次数（' + getMaxRounds() + '），停止');
                state.pendingToolResults = [];
                break;
            }

            // 步骤3：取出所有待发送结果，合并为一次续跑
            const allResults = state.pendingToolResults.splice(0);
            console.log(`[CapabilityAgent] 合并 ${allResults.length} 个工具结果，发送续跑（第 ${state.continuationRound + 1} 轮）`);

            // 步骤3.5：如果包含 ask_user 调用，暂停续跑等待用户回答
            await _waitForAskUserAnswers(allResults);

            if (state.userStopRequested) {
                console.log('[CapabilityAgent] 等待用户回答期间用户请求停止，终止');
                state.pendingToolResults = [];
                break;
            }

            const continuationPrompt = buildContinuationPrompt(
                state.originalTask || '(无原始任务)',
                allResults,
                { roundsSinceTodo: state.roundsSinceTodo }
            );

            // 步骤4：发送续跑 prompt
            const sent = await sendContinuationPrompt(continuationPrompt);
            if (!sent) {
                console.warn('[CapabilityAgent] 续跑发送失败，终止当前循环');
                break;
            }

            // 步骤5：续跑成功后递增未更新 todo 的轮数
            state.roundsSinceTodo += 1;
        }
    } finally {
        state.isSendingContinuation = false;
        state.userStopRequested = false;
        unlockInput();
    }
}

/**
 * 等待工具结果队列稳定（onEnd 后确保所有工具结果已收集完）
 *
 * 三重检测，全部满足才发送：
 *   1. DOM 无未处理工具调用
 *   2. 工具执行计数归零
 *   3. 队列稳定：连续 2 次（共 1 秒）pendingToolResults 长度无变化
 *
 * @returns {Promise<void>}
 */
async function _waitForToolResultsStable() {
    const POLL_INTERVAL_MS = 500;
    const STABLE_THRESHOLD = 2;
    const MAX_WAIT_MS = 30000;
    const startTime = Date.now();
    let lastLen = state.pendingToolResults.length;
    let stableCount = 0;
    let scanCount = 0;

    while (Date.now() - startTime < MAX_WAIT_MS) {
        if (state.userStopRequested) return;

        if (typeof window !== 'undefined' && typeof window._dsScanToolCalls === 'function') {
            if (scanCount < 3 || scanCount % 2 === 0) {
                window._dsScanToolCalls();
            }
            scanCount++;
        }

        await sleep(POLL_INTERVAL_MS);

        const currentLen = state.pendingToolResults.length;
        const executing = (typeof window !== 'undefined' && typeof window._dsToolExecutionCount === 'number')
            ? window._dsToolExecutionCount
            : 0;
        const hasUnprocessed = (typeof window !== 'undefined' && typeof window._dsHasUnprocessedToolCalls === 'function')
            ? window._dsHasUnprocessedToolCalls()
            : false;

        if (!hasUnprocessed && executing === 0 && currentLen === lastLen) {
            stableCount++;
            if (stableCount >= STABLE_THRESHOLD) {
                if (currentLen > 0) {
                    console.log(`[CapabilityAgent] 工具结果已稳定（${currentLen} 个结果，执行计数=${executing}，未处理=${hasUnprocessed}），准备发送续跑`);
                }
                return;
            }
        } else {
            if (stableCount > 0) {
                console.log(`[CapabilityAgent] 工具结果仍在变化（队列=${currentLen}，执行中=${executing}，未处理=${hasUnprocessed}），继续等待...`);
            }
            stableCount = 0;
            lastLen = currentLen;
        }
    }
    console.warn(`[CapabilityAgent] 等待工具结果稳定超时（30s），当前队列 ${state.pendingToolResults.length} 个，执行计数 ${window._dsToolExecutionCount || 0}`);
}

/**
 * 停止 Agent 循环（由 AI 调用 agent_finish 工具触发）
 *
 * @param {string} [reason] - 结束理由
 */
function stopAgent(reason) {
    console.log('[CapabilityAgent] AI 调用 agent_finish，停止 Agent 循环' + (reason ? `，理由：${reason}` : ''));
    state.userStopRequested = true;
    state.pendingToolResults = [];
    if (state.replyCompleteResolver) {
        state.replyCompleteResolver();
        state.replyCompleteResolver = null;
        state.replyCompletePromise = null;
    }
    if (typeof window !== 'undefined') {
        if (window._dsPendingAskResolver) {
            try {
                window._dsPendingAskResolver({ cancelled: true, reason: 'agent_finish' });
            } catch (e) {}
            window._dsPendingAskResolver = null;
        }
        if (typeof window._dsCancelAskUser === 'function') {
            try { window._dsCancelAskUser(); } catch (e) {}
        }
        if (window._dsPendingAskPromise) {
            window._dsPendingAskPromise = null;
        }
    }
    unlockInput();
}

/**
 * 重置续跑状态（新对话时调用）
 */
function resetContinuationState() {
    state.continuationRound = 0;
    state.originalTask = '';
    state.lastUserMessageTime = 0;
    state.pendingToolResults = [];
    state.skippedToolResults = [];
    state.isSendingContinuation = false;
    state.replyCompleteResolver = null;
    state.replyCompletePromise = null;
    state.replyCompletedAt = 0;
    state.userStopRequested = false;
    state.roundsSinceTodo = 0;
    if (typeof window !== 'undefined' && typeof window._dsTodoReset === 'function') {
        window._dsTodoReset();
    }
    if (typeof window !== 'undefined') {
        if (window._dsPendingAskResolver) {
            try {
                window._dsPendingAskResolver({ cancelled: true, reason: '新对话重置' });
            } catch (e) {}
            window._dsPendingAskResolver = null;
        }
        if (typeof window._dsResetAskUser === 'function') {
            try { window._dsResetAskUser(); } catch (e) {}
        }
        if (window._dsPendingAskPromise) {
            window._dsPendingAskPromise = null;
        }
    }
    _clearSessionStorage();
    hideStopButton();
}

/**
 * 记录原始用户任务（供 buildContinuationPrompt 使用）
 *
 * @param {string} prompt - 用户发送的原始消息
 */
function recordOriginalTask(prompt) {
    if (!prompt) return;
    if (state.continuationRound === 0) {
        state.originalTask = prompt;
        state.lastUserMessageTime = Date.now();
        _saveStateToSessionStorage();
    }
}

/**
 * 仅刷新 lastUserMessageTime 时间戳（不覆盖 originalTask）
 */
function touchUserMessageTime() {
    state.lastUserMessageTime = Date.now();
    _saveStateToSessionStorage();
}

/**
 * 创建新的"AI 回复完成" Promise
 *
 * 每次 DeepSeek 发送 completion 请求时（fetch-hub onStart）调用，
 * 创建一个新的 Promise，由 fetch-hub onEnd 事件 resolve。
 */
function _createNewReplyPromise() {
    state.replyCompletePromise = new Promise((resolve) => {
        state.replyCompleteResolver = resolve;
    });
    state.replyCompletedAt = 0;
}

// ============================================================
// 初始化
// ============================================================

/**
 * 初始化能力代理模块
 *
 * 注册 window._dsOnToolCallExecuted 回调（供 text-process.js 调用）
 * 注册 window._dsRecordOriginalTask 回调（供 fetch-hub.js 调用）
 * 注册 fetch-hub 生命周期处理器（onStart/onEnd）精确感知 AI 回复完成
 */
export function initCapabilityAgent() {
    if (state.installed) return;
    state.installed = true;

    // 从 sessionStorage 恢复 agent 状态
    _restoreStateFromSessionStorage();

    // 注入 Agent 徽章 CSS 样式
    _injectAgentBadgeStyles();

    // 注册工具调用执行完成回调（供 text-process.js 调用）
    if (typeof window !== 'undefined') {
        window._dsOnToolCallExecuted = onToolCallExecuted;
        window._dsRecordOriginalTask = recordOriginalTask;
        window._dsTouchUserMessageTime = touchUserMessageTime;
        window._dsResetContinuationState = resetContinuationState;
        window._dsGetOriginalTask = () => state.originalTask || '';
        window._dsStopAgent = stopAgent;
        window._dsIsHistoricalMessageLoad = () => {
            if (!state.lastUserMessageTime) return true;
            return Date.now() - state.lastUserMessageTime > RECENT_MESSAGE_THRESHOLD_MS;
        };
        window._dsResumeSkippedContinuation = resumeSkippedContinuation;
        window._dsGetSkippedToolCount = () => state.skippedToolResults.length;
        window._dsIsAgentRunning = () => state.isSendingContinuation;
        window._dsSubmitAskUserAndResume = submitAskUserAndResume;
    }

    // 注册 fetch-hub 生命周期处理器
    try {
        state.fetchHandlerId = registerCompletionHandler({
            onStart() {
                _createNewReplyPromise();
            },
            onEnd() {
                state.replyCompletedAt = Date.now();
                if (state.replyCompleteResolver) {
                    state.replyCompleteResolver();
                    state.replyCompleteResolver = null;
                    state.replyCompletePromise = null;
                }
            }
        });
    } catch (e) {
        console.warn('[CapabilityAgent] 注册 fetch-hub 处理器失败，将降级到 DOM 检测:', e);
    }

    // 监听 URL 变化（新对话时重置状态）
    let lastPath = location.pathname;
    setInterval(() => {
        if (location.pathname !== lastPath) {
            lastPath = location.pathname;
            resetContinuationState();
        }
    }, 2000);
}
