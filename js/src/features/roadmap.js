/**
 * 路线图自动驾驶 + 提示词队列模块
 *
 * 灵感来源：Ghost in the Loop
 *
 * 功能：
 *   1. Roadmap Autopilot — AI 先生成路线图，脚本逐步执行每个步骤
 *   2. Think First — AI 先创建计划再执行
 *   3. Prompt Queue — 粘贴任务列表，依次自动执行
 *
 * 路线图协议：
 *   - AI 在回复中输出 [[GITL::ROADMAP]] 标记
 *   - 标记后跟编号列表（1. 2. 3. ...）
 *   - 脚本解析列表并逐步执行
 *   - 每步完成后 AI 输出 [[GITL::PROCEED]]
 *   - 全部完成后发送综合指令，AI 输出 [[GITL::HALT]]
 */

import { CONFIG } from '../config.js';
import { _internals as Engine } from './loop-engine.js';

/* ═══════════════════════════════════════════════════
   路线图状态
   ═══════════════════════════════════════════════════ */

/** 路线图状态对象 */
const roadmap = {
    steps: [],           // 步骤列表
    index: 0,            // 当前步骤索引
    captured: false,     // 是否已捕获路线图
    synthSent: false,    // 是否已发送综合指令
    _reask: false        // 是否已重新请求格式
};

/** 持久化键 */
const STORAGE_KEY = 'ds_roadmap_state';

/* ═══════════════════════════════════════════════════
   状态持久化
   ═══════════════════════════════════════════════════ */

/**
 * 保存路线图状态到 localStorage
 */
function persistRoadmap() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
            steps: roadmap.steps,
            index: roadmap.index,
            captured: roadmap.captured,
            synthSent: roadmap.synthSent
        }));
    } catch (_) {}
}

/**
 * 从 localStorage 恢复路线图状态
 */
function restoreRoadmap() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        const data = JSON.parse(raw);
        roadmap.steps = data.steps || [];
        roadmap.index = data.index || 0;
        roadmap.captured = data.captured || false;
        roadmap.synthSent = data.synthSent || false;
    } catch (_) {}
}

/**
 * 清除路线图状态
 */
function clearRoadmap() {
    roadmap.steps = [];
    roadmap.index = 0;
    roadmap.captured = false;
    roadmap.synthSent = false;
    roadmap._reask = false;
    try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
}

/* ═══════════════════════════════════════════════════
   路线图解析
   ═══════════════════════════════════════════════════ */

/**
 * 从 AI 回复文本中解析路线图
 *
 * 查找 [[GITL::ROADMAP]] 标记，解析后续的编号列表
 *
 * @param {string} fullText - AI 的完整回复文本
 * @returns {boolean} - 是否成功解析路线图
 */
function parseRoadmap(fullText) {
    const at = fullText.lastIndexOf(Engine.SIGIL_ROADMAP);
    if (at < 0) return false;

    const after = fullText.slice(at + Engine.SIGIL_ROADMAP.length);
    const steps = [];

    for (const line of after.split('\n')) {
        // 遇到信号标记则停止
        if (line.includes(Engine.SIGIL_PROCEED) || line.includes(Engine.SIGIL_HALT)) break;

        // 匹配编号列表项：1. xxx / 1) xxx / - xxx / * xxx
        const m = line.match(/^\s*(?:\d+[.)]\s+|[-*]\s+)(.+)$/);
        if (m && m[1].trim().length > 3) {
            steps.push(m[1].trim());
        }

        // 最多 30 步
        if (steps.length >= 30) break;
    }

    if (steps.length < 2) return false;

    roadmap.steps = steps;
    roadmap.index = 0;
    roadmap.captured = true;
    roadmap.synthSent = false;
    persistRoadmap();
    return true;
}

/* ═══════════════════════════════════════════════════
   路线图执行
   ═══════════════════════════════════════════════════ */

/**
 * 发送路线图中的下一个步骤
 *
 * 向 AI 发送格式化的步骤指令：
 *   "Continue.
 *
 *    [Ghost roadmap — step X of N]
 *    步骤内容
 *
 *    Complete this step fully and concretely.
 *    End with [[GITL::PROCEED]] when done,
 *    or [[GITL::HALT]] if the entire roadmap is finished."
 *
 * 如果开启了"每步注入人格"（personaPerTask），会附加人格指令。
 */
function sendRoadmapStep() {
    const R = roadmap;
    const i = R.index;
    const n = R.steps.length;

    Engine.setPhase('roadmap', `🗺 步骤 ${i + 1}/${n}`);

    // 附加人格指令（如果开启每步注入）
    const personaClause = window.__dsPersonaPerTask?.()
        ? (window.__dsResolvePersonaInject?.() || '')
        : '';

    let prompt = `继续。

[路线图 — 第 ${i + 1} 步，共 ${n} 步]
${R.steps[i]}

请完整、具体地完成这一步。只输出交付物，不要废话。
完成后如果还有剩余步骤，请以 [[GITL::PROCEED]] 结尾；
如果整个路线图已全部完成，请以 [[GITL::HALT]] 结尾。`;

    if (personaClause) {
        prompt += `\n\n[激活委员会 — 保持所有指定视角]\n${personaClause}`;
    }

    Engine.engineSend(prompt, false).then(ok => {
        if (ok) {
            R.index = i + 1;
            persistRoadmap();
        }
    });
}

/**
 * 发送路线图最终综合指令
 *
 * 所有步骤完成后，让 AI 汇总所有步骤的输出
 */
function sendRoadmapSynthesis() {
    Engine.setPhase('synthesis', '🗺 最终综合');

    const prompt = `继续。

[路线图 — 最终综合]
所有路线图步骤已完成。请编译最终交付物：
将每一步的输出合并为一个完整、干净、可直接使用的结果。
不要回顾过程，不要废话。以 [[GITL::HALT]] 结尾。`;

    Engine.engineSend(prompt, false).then(ok => {
        roadmap.synthSent = !!ok;
        persistRoadmap();
    });
}

/**
 * 重新请求路线图格式
 *
 * 当 AI 回复了 PROCEED 但没有 [[GITL::ROADMAP]] 标记时，
 * 请求 AI 只输出路线图块
 */
function reaskRoadmap() {
    roadmap._reask = true;
    Engine.setPhase('roadmap', '🗺 未检测到路线图块 — 重新请求格式…');

    const prompt = `在上一条回复中未检测到 [[GITL::ROADMAP]] 标记。
请不要重新研究或执行任何内容。只输出路线图，格式如下：

[[GITL::ROADMAP]]
1. 第一个具体步骤
2. 第二个具体步骤
3. ...

（3-12 步，每步自包含）以 [[GITL::PROCEED]] 结尾。`;

    Engine.engineSend(prompt, false);
}

/* ═══════════════════════════════════════════════════
   信号回调 — 供 loop-engine 调用
   ═══════════════════════════════════════════════════ */

/**
 * PROCEED 信号回调 — 路线图模式下处理下一步
 *
 * @param {string} text - AI 回复文本
 * @returns {boolean} - 是否已处理
 */
function onProceed(text) {
    if (Engine.engine.payloadMode !== 'roadmap') return false;

    const R = roadmap;
    if (!R.captured) {
        // 尝试解析路线图
        if (parseRoadmap(text)) {
            Engine.setPhase('roadmap', `🗺 路线图已捕获：${R.steps.length} 步`);
            sendRoadmapStep();
            return true;
        }
        // 未检测到路线图块 — 重新请求一次
        if (!R._reask) {
            reaskRoadmap();
            return true;
        }
        // 重新请求后仍未检测到 — 回退到普通循环
        return false;
    }

    // 路线图已捕获 — 检查是否还有剩余步骤
    if (R.index < R.steps.length) {
        sendRoadmapStep();
        return true;
    }

    // 所有步骤已完成 — 发送综合指令
    if (!R.synthSent) {
        sendRoadmapSynthesis();
        return true;
    }

    return false;
}

/**
 * HALT 信号回调 — 路线图模式下处理完成
 *
 * @returns {boolean} - 是否已处理
 */
function onHalt() {
    if (Engine.engine.payloadMode !== 'roadmap') return false;

    const R = roadmap;
    if (!R.captured) return false;

    // 所有步骤已完成且综合已发送 — 真正完成
    if (R.index >= R.steps.length && R.synthSent) {
        clearRoadmap();
        return false; // 让引擎执行正常的 HALT
    }

    // 步骤未完成但 AI 发了 HALT — 停止
    if (R.index < R.steps.length) {
        Engine.enginePause(`路线图在第 ${R.index}/${R.steps.length} 步暂停 — AI 发出了 HALT 信号`);
        return true;
    }

    // 所有步骤完成但综合未发送 — 发送综合
    if (!R.synthSent) {
        sendRoadmapSynthesis();
        return true;
    }

    clearRoadmap();
    return false;
}

// 注册回调到全局
window.__dsRoadmapOnProceed = onProceed;
window.__dsRoadmapOnHalt = onHalt;
// 暴露路线图状态查询（供 handoff.js 备份交接使用）
window.__dsGetRoadmapState = getRoadmapState;

/* ═══════════════════════════════════════════════════
   公共 API
   ═══════════════════════════════════════════════════ */

/**
 * 启动路线图自动驾驶
 *
 * 向 AI 发送任务，要求 AI 先生成路线图再执行
 * 如果当前选中了工作流，会同时启动工作流（路线图步骤完成后由工作流接管推进）
 *
 * @param {string} task - 任务描述
 */
export function startRoadmap(task) {
    if (!task || !task.trim()) return;

    clearRoadmap();
    Engine.engine.payloadMode = 'roadmap';
    Engine.engine.originalTask = task.trim();

    // 如果选中了工作流，启动它（路线图步骤完成后由工作流推进）
    // 通过全局钩子调用，避免 ESM 循环依赖
    try { window.__dsStartWorkflowIfSelected?.(); } catch (_) {}

    const prompt = `${task.trim()}

[路线图自动驾驶协议]
在执行任务之前，先创建一个路线图。路线图是一个编号列表，包含 3-12 个具体、自包含的步骤。

输出格式：
[[GITL::ROADMAP]]
1. 第一个具体步骤
2. 第二个具体步骤
3. ...

然后以 [[GITL::PROCEED]] 结尾。

之后我会逐步指示你执行每个步骤。每步完成后以 [[GITL::PROCEED]] 结尾，全部完成后以 [[GITL::HALT]] 结尾。`;

    // 启动引擎
    import('./loop-engine.js').then(({ startLoop }) => {
        startLoop(prompt);
    });
}

/**
 * 启动 Think First 模式
 *
 * AI 先创建计划，然后执行
 *
 * @param {string} task - 任务描述
 */
export function startThinkFirst(task) {
    if (!task || !task.trim()) return;

    clearRoadmap();
    Engine.engine.payloadMode = 'roadmap';

    const prompt = `${task.trim()}

[Think First 协议]
在执行之前，先制定计划：
1. 分析任务目标和约束
2. 列出关键步骤
3. 识别潜在风险

输出格式：
[[GITL::ROADMAP]]
1. 第一个步骤
2. 第二个步骤
3. ...

然后以 [[GITL::PROCEED]] 结尾。之后我会逐步指示你执行。`;

    import('./loop-engine.js').then(({ startLoop }) => {
        startLoop(prompt);
    });
}

/**
 * 启动提示词队列
 *
 * 将用户粘贴的多行文本解析为步骤列表，依次执行
 *
 * @param {string} rawLines - 多行文本（每行一个任务）
 */
export function startQueue(rawLines) {
    if (!rawLines || !rawLines.trim()) return;

    // 解析步骤：去除编号前缀，过滤空行
    const steps = rawLines
        .split('\n')
        .map(s => s.replace(/^\s*(?:\d+[.)]\s+|[-*]\s+)?/, '').trim())
        .filter(s => s.length > 2)
        .slice(0, 30);

    if (!steps.length) return;

    // 设置路线图状态（复用路线图执行机制）
    roadmap.steps = steps;
    roadmap.index = 0;
    roadmap.captured = true;
    roadmap.synthSent = false;
    persistRoadmap();

    // 启动引擎
    Engine.engine.payloadMode = 'roadmap';
    Engine.engine.originalTask = steps[0];

    import('./loop-engine.js').then(({ startLoop }) => {
        // 先发送第一个步骤
        startLoop(`继续。

[提示词队列 — 第 1 步，共 ${steps.length} 步]
${steps[0]}

请完整、具体地完成这一步。
完成后如果还有剩余步骤，请以 [[GITL::PROCEED]] 结尾；
如果整个队列已全部完成，请以 [[GITL::HALT]] 结尾。`);
    });

    // 直接发送第一个步骤（绕过路线图解析）
    roadmap.index = 1; // 已经发送了第 0 步
    persistRoadmap();
}

/**
 * 获取路线图状态
 * @returns {object}
 */
export function getRoadmapState() {
    return {
        steps: roadmap.steps,
        index: roadmap.index,
        captured: roadmap.captured,
        synthSent: roadmap.synthSent,
        total: roadmap.steps.length
    };
}

/**
 * 重置路线图
 */
export function resetRoadmap() {
    clearRoadmap();
}

/**
 * 初始化路线图模块 — 恢复持久化状态
 */
export function initRoadmap() {
    restoreRoadmap();
    console.log('[Roadmap] 路线图模块已初始化');
}
