/**
 * Capability Agent 状态存储与持久化
 *
 * 集中管理 Agent 模块的状态对象、常量定义和 sessionStorage 持久化逻辑。
 * 其他子模块通过 import { state, ... } 引用共享状态，避免循环依赖。
 *
 * 持久化策略：
 *   - 只持久化 lastUserMessageTime、originalTask、continuationRound
 *   - 不持久化 isSendingContinuation 等运行时锁（避免刷新后卡在"发送中"状态）
 */

import { CONFIG as _CONFIG_SNAPSHOT } from '../../config.js';

/** 最大续跑次数（安全上限，防止无限循环）
 *  Agent 不再限制为 3 次，由 AI 通过 agent_finish 工具自行决定是否结束。
 *  此值仅作为安全网，避免 AI 永不调用 agent_finish 时无限消耗资源。 */
export const MAX_CONTINUATION_ROUNDS = 50;

/**
 * Agent 续跑 prompt 的 v2 边界标记（脚本专用，用户不会输入）
 *
 * 用于解决刷新后用户消息与续跑消息识别混乱的问题：
 *   - v1 标记 __ds_agent_continuation__ 仅在 prompt 末尾，可能被截断
 *   - v2 标记使用 START + END 包裹整个 prompt，更稳健
 *   - isAgentContinuationPrompt 优先检查 v2 标记，回退到 v1
 *
 * 格式：__DS_AGENT_V2_START__\n<续跑内容>\n__DS_AGENT_V2_END__
 */
export const AGENT_V2_START_MARKER = '__DS_AGENT_V2_START__';
export const AGENT_V2_END_MARKER = '__DS_AGENT_V2_END__';

/** sessionStorage 键名（持久化 agent 状态，刷新后恢复） */
export const SESSION_STORAGE_KEY = '_ds_agent_state';

/** 续跑延迟（毫秒）— 等待 AI 回复完成后发送
 *  从 1500 减少到 500，让用户更快看到 agent 续跑结果 */
export const CONTINUATION_DELAY_MS = 500;

/**
 * 历史消息加载防护：距上次用户消息超过此时间（毫秒）不触发续跑
 *
 * 60 秒过短：AI 流式输出 + 工具执行（web_search/python_exec 等）经常超过 60 秒，
 * 导致 agent 续跑在第一轮工具调用完成后就被门控跳过。
 * 提升到 300 秒（5 分钟），覆盖大多数工具执行 + 续跑场景。
 */
export const RECENT_MESSAGE_THRESHOLD_MS = 300000;

/** 模块状态 */
export const state = {
    installed: false,
    /** 当前会话的续跑轮次（每次新对话重置） */
    continuationRound: 0,
    /** 原始用户任务（第一条消息，用于构建续跑 prompt） */
    originalTask: '',
    /** 最近一次用户发送消息的时间戳（用于历史消息加载防护） */
    lastUserMessageTime: 0,
    /** 待发送的工具调用结果队列（支持并行多工具合并发送） */
    pendingToolResults: [],
    /** 被跳过续跑的工具调用结果（历史消息加载时保存，供用户手动恢复）
     *  当 lastUserMessageTime=0 跳过续跑时，工具结果存入此队列，
     *  text-process.js 渲染"执行"按钮，用户点击后 resumeSkippedContinuation 取出发起续跑 */
    skippedToolResults: [],
    /** 是否正在发送续跑（并发锁，防止多次 flush 冲突） */
    isSendingContinuation: false,
    /** fetch-hub 处理器 ID（用于注销） */
    fetchHandlerId: null,
    /** 当前 AI 回复完成的 Promise resolver（由 fetch-hub onEnd 事件 resolve） */
    replyCompleteResolver: null,
    /** 当前 AI 回复完成的 Promise（由 waitForReplyComplete 等待） */
    replyCompletePromise: null,
    /** onEnd 触发的时间戳（0 表示未触发）
     *  解决时序竞态：当 onEnd 在 _flushPendingToolResults 启动前触发时，
     *  promise 会被置 null，waitForReplyComplete 通过此字段判断 onEnd 已发生，
     *  避免误入 fallback DOM 检测循环 */
    replyCompletedAt: 0,
    /** 用户是否请求停止 agent（点击停止按钮时置 true，终止续跑循环） */
    userStopRequested: false,
    /** 输入锁定遮罩元素（agent 运行期间覆盖输入框和发送按钮） */
    inputLockOverlay: null,
    /** 连续未调用 todo_write 的续跑轮数（≥3 时注入 reminder） */
    roundsSinceTodo: 0,
    /** 脚本正在注入文本到输入框的标志（true 时 _blockInputEvent 不拦截 input 事件）
     *  解决 lockInput 与 injectText 冲突：lockInput 注册的捕获阶段事件监听器
     *  会 stopPropagation 阻止 React 收到 input 事件，导致续跑 prompt 发送空内容 */
    isScriptInjecting: false,
};

/**
 * 安全获取最新的 CONFIG 引用
 * @returns {{ CONFIG: Object }}
 */
export function _getConfigSafe() {
    try {
        if (typeof window !== 'undefined' && window.__dsConfig) {
            return { CONFIG: window.__dsConfig };
        }
    } catch (e) {}
    return { CONFIG: _CONFIG_SNAPSHOT };
}

/**
 * 获取当前最大续跑轮数
 * 统一返回安全上限 MAX_CONTINUATION_ROUNDS（50），
 * 由 AI 通过 agent_finish 工具自行决定是否结束 Agent 循环。
 * @returns {number}
 */
export function getMaxRounds() {
    return MAX_CONTINUATION_ROUNDS;
}

/**
 * 将 agent 关键状态持久化到 sessionStorage
 * 刷新后通过 _restoreStateFromSessionStorage 恢复，解决刷新后状态丢失问题
 * 注意：只持久化 lastUserMessageTime、originalTask、continuationRound，
 * 不持久化 isSendingContinuation 等运行时锁（避免刷新后卡在"发送中"状态）
 */
export function _saveStateToSessionStorage() {
    try {
        if (typeof sessionStorage === 'undefined') return;
        const data = {
            lastUserMessageTime: state.lastUserMessageTime,
            originalTask: state.originalTask,
            continuationRound: state.continuationRound
        };
        sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(data));
    } catch (e) {}
}

/**
 * 从 sessionStorage 恢复 agent 状态（刷新后调用）
 * 恢复后 agent 能在用户发新消息时继续工作，不会因状态丢失而混乱
 */
export function _restoreStateFromSessionStorage() {
    try {
        if (typeof sessionStorage === 'undefined') return;
        const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
        if (!raw) return;
        const data = JSON.parse(raw);
        if (typeof data.lastUserMessageTime === 'number' && data.lastUserMessageTime > 0) {
            // 只有距上次用户消息不超过阈值时才恢复（避免恢复过期状态）
            if (Date.now() - data.lastUserMessageTime < RECENT_MESSAGE_THRESHOLD_MS) {
                state.lastUserMessageTime = data.lastUserMessageTime;
                state.originalTask = data.originalTask || '';
                state.continuationRound = data.continuationRound || 0;
                console.log('[CapabilityAgent] 从 sessionStorage 恢复 agent 状态:', {
                    lastUserMessageTime: state.lastUserMessageTime,
                    continuationRound: state.continuationRound,
                    originalTask: (state.originalTask || '').slice(0, 50)
                });
            } else {
                // 过期状态，清理
                sessionStorage.removeItem(SESSION_STORAGE_KEY);
            }
        }
    } catch (e) {}
}

/**
 * 清理 sessionStorage 中的 agent 状态（新对话/重置时调用）
 */
export function _clearSessionStorage() {
    try {
        if (typeof sessionStorage !== 'undefined') {
            sessionStorage.removeItem(SESSION_STORAGE_KEY);
        }
    } catch (e) {}
}

/**
 * 延时工具
 * @param {number} ms - 毫秒
 * @returns {Promise<void>}
 */
export function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
