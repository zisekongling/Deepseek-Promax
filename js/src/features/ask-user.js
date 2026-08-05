/**
 * AskUserManager 提问功能模块
 *
 * 对标 TRAE IDE 的 AskUserQuestion 工具，让 AI 在 Agent 循环中能主动向用户提问，
 * 等待用户回答后继续执行任务。
 *
 * 工作流程：
 *   1. AI 调用 ask(questions) 发起提问（返回 Promise，挂起等待）
 *   2. text-process.js 渲染提问卡片，用户填写答案
 *   3. 用户点击提交 → submitAnswer(answers) 触发 resolver，Promise resolve
 *   4. 或用户点击取消 / resetContinuationState → cancelAsk() 触发 resolver 返回 cancelled
 *
 * 设计约束：
 *   - 仅内存态，不使用 localStorage 持久化
 *   - 独立运行，不导入其他模块
 *   - 同一时刻只允许一个 pending 提问（新提问会先取消旧的）
 *
 * window 接口（供 capability-register.js 和 text-process.js 调用）：
 *   - window._dsAskUser(questions)              发起提问
 *   - window._dsSubmitAskUserAnswer(answers)    提交答案
 *   - window._dsCancelAskUser()                 取消提问
 *   - window._dsHasPendingAsk()                 检测 pending
 *   - window._dsResetAskUser()                  重置状态
 */

/* ═══════════════════════════════════════════════════
   状态
   ═══════════════════════════════════════════════════ */

/**
 * 提问模块状态
 * @type {{ pendingQuestion: { questions: Array, resolver: Function|null } | null }}
 */
const state = {
    pendingQuestion: null
};

/* ═══════════════════════════════════════════════════
   核心函数
   ═══════════════════════════════════════════════════ */

/**
 * 异步向用户提问，等待用户回答
 * @param {Array<{question: string, header: string, options: Array, multiSelect: boolean}>} questions - 问题数组（1-4 个）
 * @returns {Promise<Object>} resolve 时得到 answers 数组或 { cancelled: true, reason: string }
 */
function ask(questions) {
    // 校验：questions 必须是数组，length 1-4
    if (!Array.isArray(questions) || questions.length < 1 || questions.length > 4) {
        return Promise.resolve({ cancelled: true, reason: 'questions 必须是 1-4 个问题的数组' });
    }

    // 如果已有 pending 提问，先取消旧的（避免冲突）
    if (state.pendingQuestion) {
        cancelAsk();
    }

    // 设置 pending 状态
    state.pendingQuestion = { questions, resolver: null };

    // 返回 Promise，resolver 由 submitAnswer/cancelAsk 调用
    return new Promise(resolve => {
        if (state.pendingQuestion) {
            state.pendingQuestion.resolver = resolve;
        }
    });
}

/**
 * 提交用户答案（由 text-process.js 的提问卡片提交按钮调用）
 * @param {Array<{question: string, answer: string, custom: string}>} answers - 用户答案数组
 */
function submitAnswer(answers) {
    if (!state.pendingQuestion || !state.pendingQuestion.resolver) {
        console.warn('[AskUser] 没有 pending 提问，忽略提交');
        return;
    }
    const resolver = state.pendingQuestion.resolver;
    state.pendingQuestion = null;
    resolver(answers || []);
}

/**
 * 取消提问（由 text-process.js 的取消按钮或 resetContinuationState 调用）
 */
function cancelAsk() {
    if (!state.pendingQuestion || !state.pendingQuestion.resolver) {
        // 没有 pending 提问，直接清空（可能在 reset 时调用）
        state.pendingQuestion = null;
        return;
    }
    const resolver = state.pendingQuestion.resolver;
    state.pendingQuestion = null;
    resolver({ cancelled: true, reason: '用户取消' });
}

/* ═══════════════════════════════════════════════════
   辅助函数
   ═══════════════════════════════════════════════════ */

/**
 * 检测是否有 pending 提问
 * @returns {boolean}
 */
function hasPendingAsk() {
    return state.pendingQuestion !== null;
}

/**
 * 重置提问状态（新对话时调用）
 * 注意：不调用 resolver，避免悬挂 Promise；新对话时直接清空
 */
function reset() {
    state.pendingQuestion = null;
}

/* ═══════════════════════════════════════════════════
   初始化导出
   ═══════════════════════════════════════════════════ */

/**
 * 初始化 AskUserManager 模块
 * 在 window 上注册接口供 capability-register.js 和 text-process.js 调用
 */
export function initAskUserManager() {
    if (typeof window === 'undefined') return;
    window._dsAskUser = ask;
    window._dsSubmitAskUserAnswer = submitAnswer;
    window._dsCancelAskUser = cancelAsk;
    window._dsHasPendingAsk = hasPendingAsk;
    window._dsResetAskUser = reset;
}
