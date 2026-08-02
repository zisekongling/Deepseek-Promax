/**
 * 任务模式 Payload 模块 (Payloads) v1.0
 *
 * 灵感来源：Ghost in the Loop v8.7.0
 *
 * 功能：
 *   1. 提供 Loop / Think / Roadmap 三种任务模式
 *   2. 每种模式对应一段 inject 文本，描述 AI 应如何分步与输出信号
 *   3. 与 loop-engine 集成（注册 window.__dsGetPayload）
 *
 * 模式说明：
 *   - loop：经典分步执行，每条回复一个步骤
 *   - think：AI 先规划分批，然后逐批执行
 *   - roadmap：AI 先研究 → 输出路线图 → 引擎逐步发送步骤
 */

/* ═══════════════════════════════════════════════════
   模式定义
   ═══════════════════════════════════════════════════ */

/** 脚本版本（用于 inject 文本） */
const SCRIPT_VER = '3.9.0';

/**
 * 三种任务模式定义
 * inject 文本会被追加到任务提示词末尾
 */
export const PAYLOADS = {
    loop: {
        label: '▶ 循环',
        hint: '分步执行 — 你设定任务，AI 逐步完成。',
        inject: `\n\n---\n[DeepSeek Promax v${SCRIPT_VER} — Loop Mode]
Execute this task step by step. One focused section per response.

At the end of every response, print:
████░░░░ [Step X of Y] — one line describing what was completed

Then on a new line:
- More steps remain → [[GITL::PROCEED]]
- Fully complete → [[GITL::HALT]]

Do not skip the progress line. Make reasonable assumptions.
---`
    },
    think: {
        label: '🧠 先思考',
        hint: 'AI 先规划分批（约 80% 容量），再逐批执行。',
        inject: `\n\n---\n[DeepSeek Promax v${SCRIPT_VER} — Think First Mode]
Before doing any work, read this task and plan how to complete it in focused batches.

Keep each batch to ~80% of your comfortable response length.

Your FIRST response: plan only — list batches briefly, end with [[GITL::PROCEED]]

Each subsequent response: complete one batch, end with:
████░░░░ [Batch X of Y] — what this batch covered
Then: [[GITL::PROCEED]] or [[GITL::HALT]]

The script sends "Continue" automatically.
---`
    },
    roadmap: {
        label: '🗺 路线图',
        hint: 'AI 研究 → 输出路线图 → 引擎自动逐步执行。可无人值守。',
        inject: `\n\n---\n[DeepSeek Promax v${SCRIPT_VER} — Roadmap Autopilot]
Phase 1 (this response): RESEARCH ONLY. Analyze this task deeply — context, constraints, unknowns, best approach. Do no execution work yet.
Then output a machine-readable roadmap in EXACTLY this format:

[[GITL::ROADMAP]]
1. first concrete step
2. second concrete step
3. ...

(3–12 steps, each one self-contained and executable in a single response)
End with [[GITL::PROCEED]]

Phase 2: The script will then send you each step as its own prompt. Complete each step fully, end each with [[GITL::PROCEED]]. A final synthesis prompt will close the run.
---`
    }
};

/** 模式选项数组（用于 UI 渲染） */
export const PAYLOAD_OPTIONS = Object.entries(PAYLOADS).map(([id, p]) => ({
    id,
    label: p.label,
    hint: p.hint
}));

/**
 * 恢复提示文本（用于崩溃恢复或中途续跑）
 */
export const RESUME_TEXT = `Continue.\n\n[Ghost reminder: end each response with ████░░░░ [Step X of Y] then [[GITL::PROCEED]] if more remain, or [[GITL::HALT]] when fully done.]`;

/* ═══════════════════════════════════════════════════
   Payload 访问
   ═══════════════════════════════════════════════════ */

/**
 * 获取指定模式的 payload 对象
 * @param {string} mode - 模式 ID: loop | think | roadmap
 * @returns {object|null}
 */
export function getPayload(mode) {
    return PAYLOADS[mode] || null;
}

/**
 * 获取指定模式的 inject 文本
 * @param {string} mode - 模式 ID
 * @returns {string}
 */
export function getPayloadInject(mode) {
    return PAYLOADS[mode]?.inject || '';
}

/**
 * 获取模式标签
 * @param {string} mode - 模式 ID
 * @returns {string}
 */
export function getPayloadLabel(mode) {
    return PAYLOADS[mode]?.label || '▶ 循环';
}

/* ═══════════════════════════════════════════════════
   初始化 — 注册到 window 供 loop-engine 调用
   ═══════════════════════════════════════════════════ */

/**
 * 初始化 Payload 模块
 * 注册全局钩子，让 loop-engine 在构建提示词时调用
 */
export function initPayloads() {
    // 提供"指定模式的 payload 对象"（loop-engine.js 的 buildFullPrompt 会读取 .inject）
    window.__dsGetPayload = getPayload;

    console.log('[Payloads] 模式 Payload 模块已初始化');
}
