/**
 * Handoff 摘要模块
 *
 * 灵感来源：Ghost in the Loop
 *
 * 功能：
 *   1. 一键交接 (Handoff) — 让 AI 生成结构化交接报告，可直接粘贴到其他 AI
 *   2. 备份交接 — 从 DOM 提取最近消息，生成轻量级交接摘要（含项目元数据 YAML 头）
 *   3. 跨标签页交接 — 通过 BroadcastChannel 传递交接内容
 *
 * 交接报告格式：
 *   # 交接报告
 *   ## 使命 — 我们在做什么以及为什么
 *   ## 已尝试的所有方法 — 每种方法/版本，什么有效，什么失败以及为什么
 *   ## 当前状态 — 现在的准确状态
 *   ## 关键决策与理由
 *   ## 待办事项 — 未解决的问题、风险、未知
 *   ## 下一步 — 具体、有序
 *   ## 给新 AI 的指南 — 如何零基础知识接手
 *
 * 备份交接 YAML 元数据：
 *   project / platform / exported / mode / persona / workflow / rounds / last_signal
 */

import { CONFIG } from '../config.js';
import { _internals as Engine } from './loop-engine.js';
import { getPersonaLabel } from './personas.js';
import { getWorkflowState } from './workflows.js';
import { getPostureLabel } from './postures.js';
import { getPayloadLabel } from './payloads.js';

/* ═══════════════════════════════════════════════════
   常量
   ═══════════════════════════════════════════════════ */

/** 让 AI 生成交接报告的指令 */
const HANDOFF_IN_CHAT = `请暂停所有其他工作。为整个对话生成一份完整的交接报告，在一个 markdown 代码块中，结构如下：

# 交接报告
## 使命 — 我们在做什么以及为什么
## 已尝试的所有方法 — 每种方法/版本，什么有效，什么失败以及为什么
## 当前状态 — 现在的准确状态
## 关键决策与理由
## 待办事项 — 未解决的问题、风险、未知
## 下一步 — 具体、有序
## 给新 AI 的指南 — 如何零基础知识接手

请尽可能详尽 — 这份报告是新 AI 唯一的记忆。代码块外不要有任何废话。
以 [[GITL::HALT]] 结尾。`;

/* ═══════════════════════════════════════════════════
   交接报告生成
   ═══════════════════════════════════════════════════ */

/**
 * 一键交接 — 让 AI 生成结构化交接报告
 *
 * 向当前对话发送指令，要求 AI 生成一份完整的交接报告。
 * 报告生成后，用户可复制并粘贴到其他 AI 模型。
 */
export function handoffInChat() {
    if (Engine.engine.state === 'RUNNING') {
        console.warn('[Handoff] 请先暂停循环引擎');
        return false;
    }

    Engine.setPhase('handoff', '🤝 正在生成交接报告…');
    Engine.engineSend(HANDOFF_IN_CHAT, false);
    return true;
}

/**
 * 备份交接 — 从 DOM 提取最近消息，生成轻量级交接摘要
 *
 * 当对话卡死或无法继续时，从页面 DOM 提取最近的消息，
 * 生成一个 Markdown 文件供用户下载。
 *
 * 包含 YAML 元数据头：project / platform / exported / mode / persona / workflow / rounds / last_signal
 * 让接手的 AI 能立即知道当前任务的状态和模式。
 *
 * @returns {string} Markdown 格式的交接摘要
 */
export function generateBackupHandoff() {
    const messages = extractMessagesFromDOM();
    if (!messages.length) {
        return '';
    }

    // 收集运行时状态元数据
    const engineState = Engine.getEngineState?.() || {};
    const wfState = safeGetWorkflowState();
    const projectName = CONFIG.projectName || document.title.replace(/\s*-\s*DeepSeek.*/i, '') || 'Untitled';
    const platform = location.hostname || 'unknown';
    const exported = new Date().toISOString();
    const mode = engineState.payloadMode || CONFIG.loopPayloadMode || 'loop';
    const modeLabel = safePayloadLabel(mode);
    const persona = safePersonaLabel();
    const posture = safePostureLabel();
    const workflow = wfState?.label || '手动';
    const stage = wfState?.stageIndex || 0;
    const rounds = engineState.round || 0;
    const lastSignal = engineState.lastSignal || 'none';

    const lines = [
        '# 🧷 DeepSeek Promax 备份交接',
        '',
        '*当对话卡死、满了或无法继续时使用。将其粘贴到新对话中继续工作。*',
        '*(如果对话还能回复，使用 🤝 生成交接 按钮 — AI 自己写的报告更详尽。)*',
        '',
        '```yaml',
        `project: ${projectName}`,
        `platform: ${platform}`,
        `exported: ${exported}`,
        `mode: ${mode} (${modeLabel})`,
        `posture: ${posture}`,
        `persona: ${persona}`,
        `workflow: ${workflow} (stage ${stage})`,
        `rounds: ${rounds}`,
        `last_signal: ${lastSignal}`,
        '```',
        '',
        '## 任务概述（首条提示词）',
        '',
        extractTaskOverview(messages),
        '',
        '## 路线图状态',
        '',
        formatRoadmapState(),
        '',
        '## 给接手 AI 的恢复指令',
        '',
        '之前的对话已经无法继续。你将接手这项工作。',
        '1. 阅读任务概述和下面的逐字尾部 — 这是最新的可用状态。',
        '2. 如果存在路线图，从当前位置（▶）继续，而不是从头开始。',
        '3. 只输出交付物，不要废话。',
        '4. 每条回复以 [[GITL::PROCEED]]（还有剩余工作）或 [[GITL::HALT]]（确实全部完成）结尾。',
        '',
        '## 最近 10 条消息 — 逐字记录（最新在后）',
        ''
    ];

    // 只取最近 10 条消息
    const recent = messages.slice(-10);
    for (const msg of recent) {
        lines.push(`### ${msg.role === 'user' ? '👤 用户' : '🤖 AI'}`);
        lines.push('');
        lines.push(msg.text.slice(0, 2000)); // 每条消息最多 2000 字符
        lines.push('');
    }

    lines.push('---');
    lines.push('*备份交接 — 由 DeepSeek Promax 生成。轻量级版本：状态 + 最近 10 条消息，足够在其他地方恢复。*');

    return lines.join('\n');
}

/**
 * 安全获取工作流状态（模块未初始化时返回 null）
 * @returns {object|null}
 */
function safeGetWorkflowState() {
    try { return getWorkflowState(); } catch (_) { return null; }
}

/**
 * 安全获取模式标签（模块未初始化时返回 mode 本身）
 * @param {string} mode - 模式 ID
 * @returns {string}
 */
function safePayloadLabel(mode) {
    try { return getPayloadLabel(mode); } catch (_) { return mode; }
}

/**
 * 安全获取人格标签（模块未初始化时返回 'None'）
 * @returns {string}
 */
function safePersonaLabel() {
    try { return getPersonaLabel() || '无'; } catch (_) { return '无'; }
}

/**
 * 安全获取姿态标签（模块未初始化时返回 'Standard'）
 * @returns {string}
 */
function safePostureLabel() {
    try { return getPostureLabel() || '锁定'; } catch (_) { return '锁定'; }
}

/**
 * 格式化路线图状态（如果存在）
 * @returns {string}
 */
function formatRoadmapState() {
    try {
        // 通过动态 import 获取路线图状态（避免循环依赖）
        const rmState = window.__dsGetRoadmapState?.();
        if (!rmState || !rmState.steps || !rmState.steps.length) return '(无)';
        return rmState.steps.map((s, i) => {
            const mark = i < rmState.index ? '✓' : (i === rmState.index ? '▶' : '·');
            return `${mark} ${i + 1}. ${s}`;
        }).join('\n');
    } catch (_) {
        return '(无)';
    }
}

/**
 * 从 DOM 提取消息记录
 *
 * @returns {Array<{role:string,text:string}>}
 */
function extractMessagesFromDOM() {
    const messages = [];

    // DeepSeek 消息容器选择器
    const msgContainers = document.querySelectorAll('div[class*="ds-message"]');

    for (const container of msgContainers) {
        const isUser = container.querySelector('div[class*="user-message"]') ||
                       container.className.includes('user');

        // 获取文本内容
        const markdown = container.querySelector('div[class*="ds-markdown"], div[class*="markdown"]');
        const text = markdown
            ? (markdown.innerText || markdown.textContent || '').trim()
            : (container.innerText || container.textContent || '').trim();

        if (text.length > 10) {
            messages.push({
                role: isUser ? 'user' : 'assistant',
                text
            });
        }
    }

    return messages;
}

/**
 * 从消息列表中提取任务概述
 *
 * @param {Array} messages - 消息列表
 * @returns {string}
 */
function extractTaskOverview(messages) {
    // 尝试从第一条用户消息中提取任务概述
    const firstUserMsg = messages.find(m => m.role === 'user');
    if (firstUserMsg) {
        const text = firstUserMsg.text.slice(0, 500);
        return text;
    }
    return '（无法提取任务概述）';
}

/**
 * 下载交接报告为 Markdown 文件
 *
 * @param {string} content - Markdown 内容
 * @param {string} [filename] - 文件名
 */
export function downloadHandoff(content, filename) {
    if (!content) return;

    const name = filename || `handoff-${new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-')}.md`;
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ═══════════════════════════════════════════════════
   跨标签页交接
   ═══════════════════════════════════════════════════ */

/** BroadcastChannel 实例 */
let handoffChannel = null;

/**
 * 初始化跨标签页交接通道
 */
export function initHandoffChannel() {
    try {
        handoffChannel = new BroadcastChannel('ds_promax_handoff');
        handoffChannel.onmessage = (e) => {
            if (e.data?.type === 'handoff') {
                // 存储接收到的交接内容 — 不自动注入
                try {
                    localStorage.setItem('ds_pending_handoff', JSON.stringify({
                        text: e.data.text,
                        from: e.data.from,
                        url: e.data.url,
                        timestamp: Date.now()
                    }));
                } catch (_) {}
            }
        };
    } catch (e) {
        console.warn('[Handoff] BroadcastChannel 不可用:', e);
    }
}

/**
 * 通过 BroadcastChannel 发送交接内容到其他标签页
 *
 * @param {string} text - 交接内容
 */
export function sendHandoffToTabs(text) {
    if (!handoffChannel) return;
    try {
        handoffChannel.postMessage({
            type: 'handoff',
            text,
            from: 'DeepSeek',
            url: location.href
        });
    } catch (_) {}
}

/**
 * 获取待处理的跨标签页交接内容
 *
 * @returns {object|null}
 */
export function getPendingHandoff() {
    try {
        const raw = localStorage.getItem('ds_pending_handoff');
        if (!raw) return null;
        const data = JSON.parse(raw);
        // 5 分钟内有效
        if (Date.now() - data.timestamp > 300000) {
            localStorage.removeItem('ds_pending_handoff');
            return null;
        }
        return data;
    } catch (_) {
        return null;
    }
}

/**
 * 清除待处理的交接内容
 */
export function clearPendingHandoff() {
    try { localStorage.removeItem('ds_pending_handoff'); } catch (_) {}
}

/* ═══════════════════════════════════════════════════
   初始化
   ═══════════════════════════════════════════════════ */

/**
 * 初始化 Handoff 模块
 */
export function initHandoff() {
    initHandoffChannel();
    console.log('[Handoff] 交接模块已初始化');
}
