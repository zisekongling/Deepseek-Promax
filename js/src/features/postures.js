/**
 * 思考姿态模块 (Postures) v1.0
 *
 * 灵感来源：Ghost in the Loop v8.7.0
 *
 * 功能：
 *   1. 提供 Standard / Adaptive / Audit 三种思考姿态
 *   2. 每种姿态对应不同的扩展规则（clause 文本注入到提示词）
 *   3. Adaptive / Audit 在 clause 末尾附加漂移防护 ceiling
 *   4. 与 loop-engine 集成（注册 window.__dsGetPostureClause）
 *
 * 姿态说明：
 *   - standard (Locked)：锁定计划，不允许任何扩展
 *   - evolving (Adaptive)：执行中可加步骤，但需说明理由
 *   - extended (Audit)：执行完成后做一次覆盖审计，仅补材料性缺口
 */

import { CONFIG, saveConfig } from '../config.js';

/* ═══════════════════════════════════════════════════
   姿态定义
   ═══════════════════════════════════════════════════ */

/**
 * 三种思考姿态定义
 * clause 文本会被追加到任务提示词末尾
 */
export const POSTURES = {
    standard: {
        label: '锁定',
        short: '严格按计划',
        desc: '锁定到声明的计划，不允许添加、删除、合并或重排步骤。最可预测。',
        clause: `\n\n[Posture: STANDARD — locked plan]
Complete exactly the steps you declared. Do not add, remove, merge, or reorder steps.
If you discover the plan is wrong, finish what you can and report it at the end rather than expanding.
Keep your declared Y fixed for the whole run.`
    },
    evolving: {
        label: '自适应',
        short: '可中途扩展',
        desc: '计划可以在执行中扩展 — 当出现真实阻碍或缺口时，AI 可加步骤并说明理由。',
        clause: `\n\n[Posture: EVOLVING — adaptive mid-run replanning]
Execute your declared steps one at a time. You MAY add a step during the run ONLY IF a concrete blocker, a missing prerequisite, or a material gap is visible from the work already done and continuing without it would likely fail the original goal.
Before adding a step, print on their own lines:
  Why needed: <one sentence>
  Why existing steps are insufficient: <one sentence>
If that justification is weak, do NOT add the step. Prefer tightening or replacing a future step over adding to the total. Any added step must stay strictly within the ORIGINAL goal — do not expand scope into adjacent topics. Update Y when you legitimately add a step, and keep printing ████░░░░ [Step X of Y].`
    },
    extended: {
        label: '审计',
        short: '计划 + 最终缺口审计',
        desc: '锁定执行计划，完成后做一次覆盖审计，仅补材料性缺口。',
        clause: `\n\n[Posture: EXTENDED — bounded end-of-run review]
Execute your declared steps exactly, with no mid-run additions. AFTER the last declared step, perform ONE coverage check against the original goal, its constraints, and the promised deliverable. List only material gaps, errors, or unanswered sub-questions — for each: the gap, why it matters, and the smallest step that closes it. Then complete only those high-value follow-ups. If no material gaps remain, print "No material gaps found" and HALT. Do not invent "nice to have" extras.`
    }
};

/**
 * 漂移防护 ceiling（仅追加到 evolving / extended 之后）
 */
export const POSTURE_CEILING = `\nHard ceiling: never exceed the drift-guard limit. If you reach it, STOP and report the single highest-value unresolved gap instead of compressing in more work.`;

/** 姿态选项数组（用于 UI 渲染） */
export const POSTURE_OPTIONS = Object.entries(POSTURES).map(([id, p]) => ({
    id,
    label: p.label,
    short: p.short,
    desc: p.desc
}));

/* ═══════════════════════════════════════════════════
   状态访问
   ═══════════════════════════════════════════════════ */

/**
 * 获取当前选中的姿态 ID
 * @returns {string}
 */
export function getPosture() {
    const p = CONFIG.loopPosture || 'standard';
    return POSTURES[p] ? p : 'standard';
}

/**
 * 设置当前选中的姿态 ID
 * @param {string} id - 姿态 ID
 */
export function setPosture(id) {
    if (!POSTURES[id]) return;
    CONFIG.loopPosture = id;
    saveConfig(CONFIG);
}

/**
 * 获取姿态对应的 clause 文本（含 ceiling）
 * @param {string} [postureId] - 姿态 ID，不传则用当前选中
 * @returns {string}
 */
export function getPostureClause(postureId) {
    const id = postureId || getPosture();
    const p = POSTURES[id] || POSTURES.standard;
    let out = p.clause;
    if (id !== 'standard') out += POSTURE_CEILING;
    return out;
}

/**
 * 获取姿态标签（用于显示）
 * @returns {string}
 */
export function getPostureLabel() {
    return POSTURES[getPosture()]?.label || '锁定';
}

/* ═══════════════════════════════════════════════════
   初始化 — 注册到 window 供 loop-engine 调用
   ═══════════════════════════════════════════════════ */

/**
 * 初始化姿态模块
 * 注册全局钩子，让 loop-engine 在构建提示词时调用
 */
export function initPostures() {
    // 提供"当前姿态的 clause 文本"
    window.__dsGetPostureClause = getPostureClause;

    // 同步 CONFIG 默认值
    if (!CONFIG.loopPosture || !POSTURES[CONFIG.loopPosture]) {
        CONFIG.loopPosture = 'standard';
        saveConfig(CONFIG);
    }

    console.log('[Postures] 姿态模块已初始化 — 当前:', getPostureLabel());
}
