/**
 * 工作流自动化模块 (Workflows) v1.0
 *
 * 灵感来源：Ghost in the Loop v8.7.0
 *
 * 功能：
 *   1. 提供 7 种预置工作流（Deep Research / R&D Lab / Shipyard / Debate /
 *      Pre-Mortem / Trollproof / Lens Relay）+ Manual 模式
 *   2. 每个工作流包含多个阶段（stages），AI 完成一阶段后自动推进到下一阶段
 *   3. 支持"自动推进"和"步间暂停"开关
 *   4. 与 loop-engine 集成（注册 window.__dsWorkflowOnProceed / __dsWorkflowOnHalt）
 *
 * 工作流生命周期：
 *   selected = none → 不干预
 *   selected ≠ none → 启动后 stageIndex = 0
 *   每次检测到 PROCEED → 推进 stageIndex，发送下一阶段指令
 *   stageIndex >= stages.length → 发送综合指令，发送 HALT 后清空状态
 */

import { CONFIG, saveConfig } from '../config.js';
import { _internals as Engine } from './loop-engine.js';

/* ═══════════════════════════════════════════════════
   工作流库定义
   ═══════════════════════════════════════════════════ */

/**
 * 预置工作流库（与 _tmp_ghost WORKFLOW_LIBRARY 对齐）
 */
export const WORKFLOW_LIBRARY = {
    none: {
        label: '手动',
        desc: '标准循环 — 不自动注入阶段指令。',
        stages: []
    },
    deep_research: {
        label: '深度研究',
        desc: '研究 → 分支 → 红队 → 综合。',
        stages: [
            'You have completed the initial pass. Now expand the research: identify missing angles, weakly supported assumptions, hidden dependencies, and adjacent questions worth investigating.',
            'Generate 3–7 high-value research branches. Rank by upside, risk reduction, and novelty. Pursue the top branch first.',
            'Red-team everything produced so far. Find what is wrong, brittle, naïve, overfit, ungrounded, or likely to fail in reality.',
            'Synthesize the best final output. Preserve the strongest ideas, remove weak ones, deliver the upgraded result with clear reasoning and tradeoffs.'
        ]
    },
    rd_lab: {
        label: 'R&D 实验室',
        desc: '发明 → 原型 → 评估 → 收敛。',
        stages: [
            'Shift into R&D mode. Generate ambitious but plausible directions beyond the current framing.',
            'Choose the most promising directions and expand into concrete mechanisms. Explain how each one would actually work.',
            'Prototype-review mode: compare candidates, identify fatal flaws, decide which to merge, cut, or reframe.',
            'Deliver the strongest evolved concept as a coherent final design with rationale and open questions.'
        ]
    },
    shipyard: {
        label: '船坞',
        desc: '概念 → 执行计划 → QA → 生产就绪。',
        stages: [
            'Translate the work into an execution plan. Break into milestones, dependencies, and the first shippable version.',
            'Act as QA plus operations. Identify what will fail during implementation, onboarding, edge cases, and scaling.',
            'Rewrite the plan into a production-ready version: streamlined, resilient, and prioritized with rollback thinking.'
        ]
    },
    debate: {
        label: '辩论',
        desc: '多视角挑战与综合。',
        stages: [
            'Run a structured round-table: Researcher, Builder, Red Team, Customer Voice, Executive. Keep viewpoints distinct.',
            'Force disagreement: identify main conflicts, what each persona thinks the others underestimate, which critique matters most.',
            'Resolve the debate and produce the improved answer that best survives all critiques.'
        ]
    },
    pre_mortem: {
        label: '前置复盘',
        desc: '假设失败 → 调查 → 加固。',
        stages: [
            'Assume this fails badly in 6 months. Explain exactly how and why: product, technical, human, messaging, and market reasons.',
            'Identify early warning indicators and the smallest interventions that would have prevented that failure.',
            'Rewrite the strategy so it is explicitly hardened against those failure modes.'
        ]
    },
    trollproof: {
        label: '抗喷子',
        desc: '敌意反馈 → 过滤 → 加固。',
        stages: [
            'Simulate the most damaging negative feedback, mocking reactions, bad-faith interpretations, and hostile public criticism this could attract.',
            'Determine which criticisms are unfair noise and which reveal a real weakness that should be fixed.',
            'Rewrite the output so it is clearer, more resilient, and better prepared for hostile interpretation.'
        ]
    },
    lens_relay: {
        label: '透镜接力',
        desc: '多视角独立评估 → 综合。（单模型站点下退化为单模型多透镜）',
        stages: [
            'New lens turn. Give your OWN independent assessment of all work so far. Do not agree by default — challenge assumptions, surface gaps, add what only your perspective adds. All substantive output in one code block, no fluff.',
            'New lens turn. Focus on what every previous lens underestimated or missed entirely. Independent take, code block, no fluff.',
            'New lens turn. Draft the synthesis candidate: merge the strongest points across all lenses, preserve real disagreements explicitly. Code block, no fluff.',
            'Final lens. Verify the synthesis against every prior critique. Deliver the consensus result — complete, deliverable-grade, in one code block.'
        ]
    }
};

/** 工作流选项数组（用于 UI 渲染） */
export const WORKFLOW_OPTIONS = Object.entries(WORKFLOW_LIBRARY).map(([id, w]) => ({
    id,
    label: w.label,
    desc: w.desc,
    stages: w.stages.length
}));

/* ═══════════════════════════════════════════════════
   工作流运行时状态
   ═══════════════════════════════════════════════════ */

/** 工作流运行时状态 */
const workflow = {
    selected: 'none',     // 当前选中的工作流 ID
    stageIndex: 0,        // 当前阶段索引
    autoAdvance: true,    // 是否自动推进
    pauseBetween: false,  // 是否步间暂停（每阶段完成后暂停等待用户）
    active: false,        // 是否正在运行（true = 引擎已为该工作流发过指令）
    synthSent: false      // 是否已发送综合指令
};

/** 持久化键 */
const STORAGE_KEY = 'ds_workflow_state';

/* ═══════════════════════════════════════════════════
   状态持久化
   ═══════════════════════════════════════════════════ */

/**
 * 保存工作流状态到 localStorage
 */
function persistWorkflow() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
            selected: workflow.selected,
            stageIndex: workflow.stageIndex,
            autoAdvance: workflow.autoAdvance,
            pauseBetween: workflow.pauseBetween,
            active: workflow.active,
            synthSent: workflow.synthSent
        }));
    } catch (_) {}
}

/**
 * 从 localStorage 恢复工作流状态
 */
function restoreWorkflow() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        const data = JSON.parse(raw);
        workflow.selected = data.selected || 'none';
        workflow.stageIndex = data.stageIndex || 0;
        workflow.autoAdvance = data.autoAdvance !== false;
        workflow.pauseBetween = !!data.pauseBetween;
        workflow.active = !!data.active;
        workflow.synthSent = !!data.synthSent;
    } catch (_) {}
}

/**
 * 清除工作流状态
 */
function clearWorkflow() {
    workflow.selected = 'none';
    workflow.stageIndex = 0;
    workflow.active = false;
    workflow.synthSent = false;
    try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
}

/* ═══════════════════════════════════════════════════
   状态访问
   ═══════════════════════════════════════════════════ */

/**
 * 获取当前选中的工作流 ID
 * @returns {string}
 */
export function getSelected() {
    // 优先用运行时状态，其次用 CONFIG（UI 选择但未启动）
    if (workflow.selected && workflow.selected !== 'none') return workflow.selected;
    return CONFIG.workflowSelected || 'none';
}

/**
 * 设置当前选中的工作流 ID（仅修改 CONFIG，未启动）
 * @param {string} id - 工作流 ID
 */
export function setSelected(id) {
    if (!WORKFLOW_LIBRARY[id]) return;
    CONFIG.workflowSelected = id;
    saveConfig(CONFIG);
}

/**
 * 设置"自动推进"开关
 * @param {boolean} v
 */
export function setAutoAdvance(v) {
    workflow.autoAdvance = !!v;
    CONFIG.workflowAutoAdvance = !!v;
    saveConfig(CONFIG);
    persistWorkflow();
}

/**
 * 设置"步间暂停"开关
 * @param {boolean} v
 */
export function setPauseBetween(v) {
    workflow.pauseBetween = !!v;
    CONFIG.workflowPauseBetween = !!v;
    saveConfig(CONFIG);
    persistWorkflow();
}

/**
 * 获取工作流运行时状态（用于 UI 显示）
 * @returns {object}
 */
export function getWorkflowState() {
    const id = getSelected();
    const wf = WORKFLOW_LIBRARY[id] || WORKFLOW_LIBRARY.none;
    return {
        selected: id,
        label: wf.label,
        desc: wf.desc,
        totalStages: wf.stages.length,
        stageIndex: workflow.stageIndex,
        active: workflow.active,
        synthSent: workflow.synthSent,
        autoAdvance: workflow.autoAdvance,
        pauseBetween: workflow.pauseBetween
    };
}

/* ═══════════════════════════════════════════════════
   工作流执行
   ═══════════════════════════════════════════════════ */

/**
 * 启动工作流
 *
 * 将工作流设置为活跃状态，准备接收第一个 PROCEED 信号
 * （首个阶段的指令由调用方在启动循环引擎时一并发送）
 *
 * @param {string} [id] - 工作流 ID，不传则用当前选中
 * @returns {boolean} - 是否成功启动
 */
export function startWorkflow(id) {
    const wfId = id || getSelected();
    const wf = WORKFLOW_LIBRARY[wfId];
    if (!wf || wfId === 'none' || wf.stages.length === 0) return false;

    workflow.selected = wfId;
    workflow.stageIndex = 0;
    workflow.active = true;
    workflow.synthSent = false;
    persistWorkflow();
    return true;
}

/**
 * 发送工作流的下一阶段指令
 */
function sendWorkflowStage() {
    const wf = WORKFLOW_LIBRARY[workflow.selected];
    if (!wf) return;
    const i = workflow.stageIndex;
    const n = wf.stages.length;

    Engine.setPhase('workflow', `⛓ ${wf.label} — 阶段 ${i + 1}/${n}`);

    const prompt = `继续。

[工作流 — ${wf.label} · 阶段 ${i + 1} / 共 ${n} 阶段]
${wf.stages[i]}

请完整、具体地完成这一阶段。只输出交付物，不要废话。
完成后如果还有剩余阶段，请以 [[GITL::PROCEED]] 结尾；
如果整个工作流已全部完成，请以 [[GITL::HALT]] 结尾。`;

    Engine.engineSend(prompt, false).then(ok => {
        if (ok) {
            workflow.stageIndex = i + 1;
            persistWorkflow();
        }
    });
}

/**
 * 发送工作流最终综合指令
 */
function sendWorkflowSynthesis() {
    const wf = WORKFLOW_LIBRARY[workflow.selected];
    if (!wf) return;

    Engine.setPhase('workflow', `⛓ ${wf.label} — 最终综合`);

    const prompt = `继续。

[工作流 — ${wf.label} · 最终综合]
所有阶段已完成。请编译最终交付物：
将每个阶段的输出合并为一个完整、干净、可直接使用的结果。
不要回顾过程，不要废话。以 [[GITL::HALT]] 结尾。`;

    Engine.engineSend(prompt, false).then(ok => {
        workflow.synthSent = !!ok;
        persistWorkflow();
    });
}

/**
 * PROCEED 信号回调 — 工作流模式下推进到下一阶段
 *
 * @param {string} text - AI 回复文本（未使用，保留参数兼容签名）
 * @returns {boolean} - 是否已处理
 */
function onProceed(text) {
    // 仅当工作流处于活跃状态时干预
    if (!workflow.active || workflow.selected === 'none') return false;

    const wf = WORKFLOW_LIBRARY[workflow.selected];
    if (!wf || wf.stages.length === 0) return false;

    // 还有剩余阶段 — 发送下一阶段指令
    if (workflow.stageIndex < wf.stages.length) {
        // 步间暂停模式 — 暂停引擎，等待用户继续
        if (workflow.pauseBetween && workflow.stageIndex > 0) {
            Engine.enginePause(`⛓ 工作流步间暂停 — 已完成阶段 ${workflow.stageIndex}/${wf.stages.length}，点击继续推进下一阶段`);
            return true;
        }
        sendWorkflowStage();
        return true;
    }

    // 所有阶段完成 — 发送综合指令
    if (!workflow.synthSent) {
        sendWorkflowSynthesis();
        return true;
    }

    return false;
}

/**
 * HALT 信号回调 — 工作流模式下处理完成
 *
 * @returns {boolean} - 是否已处理
 */
function onHalt() {
    if (!workflow.active || workflow.selected === 'none') return false;

    const wf = WORKFLOW_LIBRARY[workflow.selected];
    if (!wf) return false;

    // 所有阶段完成且综合已发送 — 真正完成，清理状态
    if (workflow.stageIndex >= wf.stages.length && workflow.synthSent) {
        clearWorkflow();
        return false; // 让引擎执行正常的 HALT
    }

    // 阶段未完成但 AI 发了 HALT — 暂停（可能 AI 误判完成）
    if (workflow.stageIndex < wf.stages.length) {
        Engine.enginePause(`⛓ 工作流在第 ${workflow.stageIndex}/${wf.stages.length} 阶段暂停 — AI 发出了 HALT 信号`);
        return true;
    }

    // 所有阶段完成但综合未发送 — 发送综合
    if (!workflow.synthSent) {
        sendWorkflowSynthesis();
        return true;
    }

    clearWorkflow();
    return false;
}

/**
 * 手动推进到下一阶段（用于步间暂停后恢复）
 */
export function advanceStage() {
    if (!workflow.active) return false;
    if (workflow.stageIndex >= (WORKFLOW_LIBRARY[workflow.selected]?.stages.length || 0)) {
        if (!workflow.synthSent) {
            sendWorkflowSynthesis();
            return true;
        }
        return false;
    }
    sendWorkflowStage();
    return true;
}

/**
 * 重置工作流状态
 */
export function resetWorkflow() {
    clearWorkflow();
}

// 注册回调到全局（loop-engine 在 PROCEED/HALT 时调用）
window.__dsWorkflowOnProceed = onProceed;
window.__dsWorkflowOnHalt = onHalt;
// 暴露启动钩子（供 roadmap.js / loop-engine 启动时同步激活工作流）
window.__dsStartWorkflowIfSelected = function() {
    const id = getSelected();
    if (id && id !== 'none') {
        return startWorkflow(id);
    }
    return false;
};
// 暴露状态查询（供 handoff.js 使用）
window.__dsGetWorkflowState = getWorkflowState;

/* ═══════════════════════════════════════════════════
   初始化
   ═══════════════════════════════════════════════════ */

/**
 * 初始化工作流模块
 * 恢复持久化状态，同步 CONFIG 默认值
 */
export function initWorkflows() {
    restoreWorkflow();

    // 同步 CONFIG 中的开关
    if (CONFIG.workflowAutoAdvance !== undefined) {
        workflow.autoAdvance = !!CONFIG.workflowAutoAdvance;
    } else {
        CONFIG.workflowAutoAdvance = true;
        saveConfig(CONFIG);
    }
    if (CONFIG.workflowPauseBetween !== undefined) {
        workflow.pauseBetween = !!CONFIG.workflowPauseBetween;
    } else {
        CONFIG.workflowPauseBetween = false;
        saveConfig(CONFIG);
    }
    if (!CONFIG.workflowSelected) {
        CONFIG.workflowSelected = 'none';
        saveConfig(CONFIG);
    }

    console.log('[Workflows] 工作流模块已初始化 — 当前:', WORKFLOW_LIBRARY[getSelected()]?.label || '手动');
}
