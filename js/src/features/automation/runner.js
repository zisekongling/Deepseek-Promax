/**
 * @file runner.js
 * @description 自动化任务执行器
 *
 * 职责：
 *   - runTask(taskId)：执行单个任务，向指定 DeepSeek 会话发送 prompt，等待流式回复完成
 *   - runTaskNow(id)：立即运行（忽略 schedule）
 *   - 并发控制：同时最多 1 个任务运行（避免 DeepSeek 限流）
 *   - 记录运行历史（ok / duration / error / resultSummary）
 *
 * 会话发送策略：
 *   DeepSeek 网页实际通过 XHR 发送 /api/v0/chat/completion（见 anti-recall.js 的 XHR hook）。
 *   本模块直接用 fetch 调用同一端点（同源 + credentials:include 复用 cookie 认证），
 *   构造与网页一致的 body（chat_session_id / prompt / model / parent_message_id 等）。
 *   fetch-hub.js 的 window.fetch 钩子会观察流式响应（不修改请求体逻辑由 prompt-augmentation 处理），
 *   对自动化任务可接受。等待 response.body 流式 read 直到 done 即视为回复完成。
 *
 * 会话不存在处理：
 *   若 API 返回 404/400/422，认为会话已删除，抛出错误提示用户重新指定。
 *
 * 参考：deepseek-pp/core/automation/runner.ts（仅借鉴流程骨架，实现大幅简化）。
 */

import { getTask, recordRun } from './store.js';

/** 当前正在运行的任务 ID（并发=1 互斥锁） */
let _runningTaskId = null;

/**
 * 是否有任务正在运行
 * @returns {boolean}
 */
export function isRunning() {
    return _runningTaskId !== null;
}

/**
 * 获取正在运行的任务 ID
 * @returns {string|null}
 */
export function getRunningTaskId() {
    return _runningTaskId;
}

/**
 * 从 SSE 文本中提取回复内容并生成摘要
 * 兼容 DeepSeek 的 data: {...} JSON 行格式与 patch 协议 { p, v }
 * @param {string} sseText - 累积的 SSE 文本
 * @returns {string} 摘要（前 200 字符）
 */
function extractSummary(sseText) {
    if (!sseText) return '';
    let content = '';
    for (const line of sseText.split('\n')) {
        const t = line.trim();
        if (!t.startsWith('data:')) continue;
        const jsonStr = t.slice(5).trim();
        if (!jsonStr || jsonStr === '[DONE]') continue;
        try {
            const obj = JSON.parse(jsonStr);
            if (typeof obj.content === 'string') content += obj.content;
            // DeepSeek patch 协议：{ p: 'response/content', v: '...' }
            if (typeof obj.p === 'string' && typeof obj.v === 'string') {
                if (/content|thinking|reasoning/i.test(obj.p)) content += obj.v;
            }
        } catch {
            // JSON 解析失败，跳过该行
        }
    }
    return content.slice(0, 200);
}

/**
 * 向指定 DeepSeek 会话发送 prompt 并等待流式回复完成
 * @param {string} conversationId - DeepSeek chat_session_id
 * @param {string} prompt - 用户 prompt
 * @returns {Promise<{ summary: string, messageId: string|null }>}
 * @throws {Error} 网络错误 / 会话不存在 / HTTP 错误
 */
async function sendPromptToSession(conversationId, prompt) {
    const body = {
        chat_session_id: conversationId,
        prompt,
        model: 'deepseek-chat',
        parent_message_id: null,
        thinking_enabled: false,
        search_enabled: false
    };
    let resp;
    try {
        resp = await fetch('/api/v0/chat/completion', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(body)
        });
    } catch (e) {
        throw new Error('网络请求失败：' + (e && e.message ? e.message : String(e)));
    }
    if (!resp.ok) {
        // 404/400/422 通常表示会话不存在或已删除
        if (resp.status === 404 || resp.status === 400 || resp.status === 422) {
            throw new Error('会话不存在或已删除，请编辑任务重新指定会话');
        }
        throw new Error(`请求失败（HTTP ${resp.status}）`);
    }
    if (!resp.body || !resp.body.getReader) {
        throw new Error('响应不支持流式读取');
    }
    const reader = resp.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let fullText = '';
    let lastMessageId = null;
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        fullText += chunk;
        // 增量提取 message_id（服务端统计字段）
        const m = chunk.match(/"message_id"\s*:\s*(\d+)/);
        if (m) lastMessageId = m[1];
    }
    return { summary: extractSummary(fullText), messageId: lastMessageId };
}

/**
 * 执行单个任务（受并发锁约束）
 * @param {string} taskId - 任务 ID
 * @returns {Promise<{ ok: boolean, error?: string, summary?: string }>}
 */
export async function runTask(taskId) {
    // 并发控制：同时最多 1 个任务运行
    if (_runningTaskId !== null) {
        return { ok: false, error: '另一个任务正在运行，请稍后再试' };
    }
    const task = getTask(taskId);
    if (!task) return { ok: false, error: '任务不存在' };
    if (!task.conversationId) {
        return { ok: false, error: '未指定会话，请编辑任务重新指定会话' };
    }
    _runningTaskId = taskId;
    const startTime = Date.now();
    try {
        const { summary } = await sendPromptToSession(task.conversationId, task.prompt);
        const durationMs = Date.now() - startTime;
        recordRun(taskId, { ok: true, durationMs, resultSummary: summary });
        return { ok: true, summary };
    } catch (err) {
        const durationMs = Date.now() - startTime;
        const errMsg = (err && err.message) ? err.message : String(err);
        recordRun(taskId, { ok: false, durationMs, error: errMsg });
        return { ok: false, error: errMsg };
    } finally {
        _runningTaskId = null;
    }
}

/**
 * 立即运行任务（忽略 schedule，直接执行）
 * @param {string} id - 任务 ID
 * @returns {Promise<{ ok: boolean, error?: string, summary?: string }>}
 */
export async function runTaskNow(id) {
    return runTask(id);
}
