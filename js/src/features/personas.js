/**
 * 人格系统模块 (Personas) v1.0
 *
 * 灵感来源：Ghost in the Loop v8.7.0
 *
 * 功能：
 *   1. 提供 8 种预置人格 + Round Table 委员会模式
 *   2. 支持多选组合委员会（每条指令携带多个视角）
 *   3. 提供"每步注入"开关（每条循环命令都附带人格）
 *   4. 与 loop-engine 集成（注册 window.__dsResolvePersonaInject / __dsPersonaPerTask）
 *
 * 人格列表：
 *   none / researcher / builder / redteam / devil / tester / customer / executive / roundtable
 */

import { CONFIG, saveConfig } from '../config.js';

/* ═══════════════════════════════════════════════════
   人格库定义
   ═══════════════════════════════════════════════════ */

/** 预置人格库（与 _tmp_ghost PERSONA_LIBRARY 对齐） */
export const PERSONA_LIBRARY = {
    none:       { label: '无', inject: '' },
    researcher: {
        label: '研究员',
        inject: 'Adopt the persona of a rigorous senior researcher: clarify assumptions, gather evidence, compare alternatives, and explicitly note uncertainty when evidence is weak.'
    },
    builder: {
        label: '建造者',
        inject: 'Adopt the persona of a senior builder/operator: prefer implementation detail, sequence, dependencies, tradeoffs, and concrete execution steps over vague theory.'
    },
    redteam: {
        label: '红队',
        inject: 'Adopt the persona of a hostile but fair red-team reviewer: attack weak assumptions, find failure modes, identify exploit paths, and surface how this could go wrong in reality.'
    },
    devil: {
        label: '魔鬼代言人',
        inject: "Adopt the persona of a devil's advocate: challenge the dominant framing, propose contrarian interpretations, and test whether the current direction is overconfident or incomplete."
    },
    tester: {
        label: '测试工程师',
        inject: 'Adopt the persona of a destructive QA and reliability tester: search for breakage, edge cases, race conditions, user-error paths, and ambiguous states.'
    },
    customer: {
        label: '客户声音',
        inject: 'Adopt the persona of a skeptical end user/customer: surface confusion, friction, mistrust, negative feedback, missing explanations, and why adoption might fail.'
    },
    executive: {
        label: '执行官',
        inject: 'Adopt the persona of an executive operator: prioritize leverage, decision quality, clarity, speed, downside risk, and what matters most if time is limited.'
    },
    roundtable: {
        label: '圆桌会议',
        inject: 'Simulate a compact round-table: Researcher, Builder, Red Team, Customer Voice, and Executive. Let each contribute distinct viewpoints, then synthesize a stronger consensus with disagreements preserved.'
    }
};

/** 人格选项数组（用于 UI 渲染） */
export const PERSONA_OPTIONS = Object.entries(PERSONA_LIBRARY).map(([id, p]) => ({
    id,
    label: p.label
}));

/* ═══════════════════════════════════════════════════
   状态访问
   ═══════════════════════════════════════════════════ */

/**
 * 获取当前选中的人格 ID 列表
 * @returns {string[]}
 */
function getSelected() {
    let sel = CONFIG.personaSelected;
    if (typeof sel === 'string') return sel ? [sel] : ['none'];
    if (Array.isArray(sel)) return sel.length ? sel : ['none'];
    return ['none'];
}

/**
 * 设置当前选中的人格 ID 列表
 * @param {string[]} ids - 人格 ID 列表
 */
export function setPersonas(ids) {
    const list = Array.isArray(ids) ? ids.filter(id => PERSONA_LIBRARY[id]) : [];
    CONFIG.personaSelected = list.length ? list : ['none'];
    saveConfig(CONFIG);
}

/**
 * 获取"每步注入"开关
 * @returns {boolean}
 */
function perTaskEnabled() {
    return !!CONFIG.personaPerTask;
}

/**
 * 设置"每步注入"开关
 * @param {boolean} v
 */
export function setPersonaPerTask(v) {
    CONFIG.personaPerTask = !!v;
    saveConfig(CONFIG);
}

/* ═══════════════════════════════════════════════════
   人格指令解析
   ═══════════════════════════════════════════════════ */

/**
 * 解析当前选中人格并生成可注入的指令文本
 *
 * 规则：
 *   - 单个人格：直接返回其 inject 文本
 *   - 多个人格（委员会）：拼接每个视角，附加框架指令
 *   - roundtable 特殊：返回内置的圆桌会议指令
 *   - none / 空：返回空字符串
 *
 * @returns {string} - 可注入到提示词中的人格指令（已 trim），空则不注入
 */
export function resolvePersonaInject() {
    const sel = getSelected();
    const active = sel.filter(s => s && s !== 'none');
    if (!active.length) return '';

    // roundtable 单独走圆桌指令
    if (active.length === 1 && active[0] === 'roundtable') {
        return PERSONA_LIBRARY.roundtable.inject;
    }

    // 单个人格 — 经典行为
    if (active.length === 1) {
        return PERSONA_LIBRARY[active[0]]?.inject || '';
    }

    // 多个人格 — 委员会模式
    const personas = active.map(s => PERSONA_LIBRARY[s]).filter(Boolean);
    if (!personas.length) return '';
    const names = personas.map(p => p.label).join(', ');
    const injects = personas.map(p => `• ${p.label}: ${p.inject}`).join('\n');
    return `You are operating as a committee of ${active.length} expert perspectives: ${names}.\nFor each task or decision point, give each perspective's independent assessment, then synthesize a stronger consensus with disagreements preserved.\n\nThe perspectives:\n${injects}`;
}

/**
 * 获取人格标签（用于显示）
 * @returns {string}
 */
export function getPersonaLabel() {
    const sel = getSelected().filter(s => s && s !== 'none');
    if (!sel.length) return '无';
    return sel.map(s => PERSONA_LIBRARY[s]?.label || s).join(' + ');
}

/* ═══════════════════════════════════════════════════
   初始化 — 注册到 window 供 loop-engine 调用
   ═══════════════════════════════════════════════════ */

/**
 * 初始化人格模块
 * 注册全局钩子，让 loop-engine 在构建提示词时调用
 */
export function initPersonas() {
    // 提供"当前选中人格的注入文本"
    window.__dsResolvePersonaInject = resolvePersonaInject;

    // 提供"每步注入开关"
    window.__dsPersonaPerTask = perTaskEnabled;

    // 同步 CONFIG 默认值
    if (!CONFIG.personaSelected) {
        CONFIG.personaSelected = ['none'];
        saveConfig(CONFIG);
    }

    console.log('[Personas] 人格模块已初始化 — 当前:', getPersonaLabel());
}
