/**
 * ask_user 等待协调
 *
 * 处理 Agent 循环中 ask_user 工具调用的等待逻辑：
 *   1. 检测工具调用结果中是否包含 ask_user
 *   2. 等待 text-process.js 在渲染卡片时创建的 Promise
 *   3. 用户提交答案后将答案追加到工具结果队列
 *
 * 安全策略：
 *   - Promise 不存在时跳过（可能是旧版或渲染失败）
 *   - 用户取消时仍发送续跑（告知 AI 用户取消了提问）
 */

import { sleep } from './state-store.js';

/**
 * 检测工具调用结果中是否包含 todo_write 调用
 * @param {Array<{name:string, toolName?:string}>} toolResults - 工具调用结果数组
 * @returns {boolean}
 */
export function _hasTodoWrite(toolResults) {
    if (!toolResults || toolResults.length === 0) return false;
    return toolResults.some(r => r.toolName === 'todo_write' || r.name === 'todo_write');
}

/**
 * 检测工具调用结果中是否包含 ask_user 调用
 * @param {Array<{name:string, toolName?:string}>} toolResults - 工具调用结果数组
 * @returns {boolean}
 */
export function _hasAskUser(toolResults) {
    if (!toolResults || toolResults.length === 0) return false;
    return toolResults.some(r => r.toolName === 'ask_user' || r.name === 'ask_user');
}

/**
 * 等待用户回答 ask_user 提问
 *
 * 流程：
 *   1. 检测 allResults 中是否包含 ask_user 调用
 *   2. 等待 text-process.js 在渲染卡片时创建的 Promise（window._dsPendingAskPromise）
 *   3. 用户提交答案后 Promise resolve，得到 answers 或 { cancelled: true }
 *   4. 将答案作为额外 tool_result 加入 allResults，供 buildContinuationPrompt 构建 <user_answers> 块
 *
 * @param {Array} allResults - 当前批次的工具调用结果（会被原地修改，追加 user_answers 结果）
 * @returns {Promise<void>}
 */
export async function _waitForAskUserAnswers(allResults) {
    if (!_hasAskUser(allResults)) return;

    // 等待 text-process.js 创建 Promise（渲染卡片时立即创建，但可能有微秒级时差）
    let promise = null;
    for (let i = 0; i < 20; i++) {
        if (typeof window !== 'undefined' && window._dsPendingAskPromise) {
            promise = window._dsPendingAskPromise;
            break;
        }
        await sleep(100);
    }

    if (!promise) {
        console.warn('[CapabilityAgent] ask_user 调用但未找到 Promise，跳过等待');
        return;
    }

    console.log('[CapabilityAgent] 检测到 ask_user 调用，暂停续跑等待用户回答...');

    let userResponse = null;
    try {
        userResponse = await promise;
    } catch (e) {
        console.warn('[CapabilityAgent] 等待用户回答异常:', e);
        userResponse = { cancelled: true, reason: '等待异常: ' + (e && e.message || e) };
    }

    // 清理全局 Promise 引用
    window._dsPendingAskPromise = null;

    // 将用户答案追加到 allResults，供 buildContinuationPrompt 处理
    if (userResponse && userResponse.cancelled) {
        console.log('[CapabilityAgent] 用户取消了提问');
        allResults.push({
            name: 'ask_user',
            toolName: 'ask_user',
            ok: true,
            skipped: true,
            summary: '用户取消了提问',
            detail: '用户点击了取消按钮，未提供答案。可基于现有信息继续推进或再次提问。'
        });
    } else {
        console.log('[CapabilityAgent] 用户已回答提问');
        allResults.push({
            name: 'ask_user',
            toolName: 'ask_user',
            ok: true,
            summary: '用户已回答',
            detail: JSON.stringify(userResponse || []),
            userAnswers: userResponse || []
        });
    }
}

/**
 * 格式化 ask_user 答案为 detail 文本（供 buildContinuationPrompt 使用）
 *
 * @param {Array} answers - 答案数组 [{ question, answer, custom }]
 * @returns {string} 格式化的答案文本
 */
export function _formatAskUserAnswers(answers) {
    if (!Array.isArray(answers) || answers.length === 0) return '用户未提供答案';
    return answers.map((a, i) =>
        `问题${i + 1}: ${a.question}\n回答: ${Array.isArray(a.answer) ? a.answer.join(', ') : a.answer}`
    ).join('\n');
}
