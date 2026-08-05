/**
 * Prompt 增强统一入口（抽取自 fetch-hub.js + anti-recall.js）
 *
 * 原先 prompt 拼装逻辑重复在两处：
 *   - utils/fetch-hub.js 的 injectPromptAndMemory（fetch 请求拦截）
 *   - features/anti-recall.js 的 XHR send 拦截
 * 两套代码几乎完全相同（系统指令 + 记忆 + 能力注册），维护时易脱节。
 *
 * 本模块抽取统一的 buildPromptPrefix 函数，两处调用统一入口。
 *
 * 注入策略（区分用户消息和 agent 续跑消息）：
 *   - 用户消息：注入完整提示词（系统指令 + 系统记忆 + 能力注册）
 *   - agent 续跑消息：只注入能力注册提示词（续跑 prompt 已含原始任务和工具结果）
 *
 * 依赖的 window 全局钩子（由各模块注册）：
 *   - window._dsCapabilityInjector(): string  能力注册提示词（由 capability-register.js 注册）
 *   - window._dsMemoryInjector(prompt): string  系统记忆文本（由 memory.js 注册）
 *   - window.__dsConfig  最新配置对象（由 config.js 注册，避免 import 快照过期）
 */

import { isAgentContinuationPrompt } from './agent-marker.js';
import { CONFIG, IS_ELECTRON } from '../config.js';
import { parseSkillCommand, getSkillByName, renderSkillInstructions } from '../features/skill.js';
import { getActivePresetContent } from '../features/preset.js';
import { markVisibleUserPrompt, markVisibleUserPromptMetadata } from './prompt-visibility.js';

// ============================================================
// 配置获取
// ============================================================

/**
 * 获取最新配置（优先 window.__dsConfig，回退到 import 的 CONFIG 快照）
 * @returns {Object}
 */
function getConfig() {
    return (typeof window !== 'undefined' && window.__dsConfig) ? window.__dsConfig : CONFIG;
}

// ============================================================
// 注入器调用（带容错）
// ============================================================

/**
 * 安全调用能力注入器
 * @returns {string} 能力提示词文本，失败返回空串
 */
function callCapabilityInjector() {
    if (typeof window === 'undefined' || typeof window._dsCapabilityInjector !== 'function') return '';
    try {
        return window._dsCapabilityInjector() || '';
    } catch (e) {
        console.warn('[prompt-augmentation] capabilityInjector failed:', e);
        return '';
    }
}

/**
 * 安全调用记忆注入器
 * @param {string} originalPrompt - 原始 prompt（供记忆选择器做关键词匹配）
 * @returns {string} 记忆提示词文本，失败返回空串
 */
function callMemoryInjector(originalPrompt) {
    if (typeof window === 'undefined' || typeof window._dsMemoryInjector !== 'function') return '';
    try {
        return window._dsMemoryInjector(originalPrompt) || '';
    } catch (e) {
        console.warn('[prompt-augmentation] memoryInjector failed:', e);
        return '';
    }
}

// ============================================================
// Skill 注入
// ============================================================

/**
 * 检测并处理 skill /命令
 *
 * 如果 originalPrompt 是 /命令（如 /ultra-think 帮我设计登录页），
 * 查找对应 skill 并渲染 instructions，返回增强后的 prompt。
 * 非 /命令返回 null（调用方按普通消息处理）。
 *
 * 注意：skill 注入是同步检测 + 异步查询，这里用同步缓存优化：
 * 在请求发出前无法做异步查询，因此对 builtin skill 做同步查找；
 * custom skill 的 /命令在第一轮无法命中（需异步预加载），后续轮次可命中缓存。
 *
 * @param {string} originalPrompt - 原始用户输入
 * @returns {string|null} 命中时返回增强后的 prompt（替换为 skill instructions）；未命中返回 null
 */
function tryInjectSkill(originalPrompt) {
    const cfg = getConfig();
    // skill 系统未启用时跳过（配置项默认关闭，避免影响未开启的用户）
    if (!cfg.skillEnabled) return null;

    const parsed = parseSkillCommand(originalPrompt);
    if (!parsed) return null;

    // 同步查找 builtin skill（BUILTIN_SKILLS 已在模块加载时初始化）
    // custom skill 需异步读取 localStorage，这里无法等待，留给后续优化
    // 通过模块级缓存避免重复查找
    if (skillCache.has(parsed.skillName)) {
        const skill = skillCache.get(parsed.skillName);
        if (skill && skill.enabled !== false) {
            return renderSkillInstructions(skill, parsed.args);
        }
    }
    return null;
}

/** builtin skill 同步缓存（模块加载时填充） */
const skillCache = new Map();
// 预填充 builtin skills 到缓存（同步可用）
BUILTIN_SKILLS.forEach(s => skillCache.set(s.name, s));

// ============================================================
// Preset 预加载与缓存
// ============================================================

/** 当前激活的 preset 内容缓存（避免每次请求都查 localStorage） */
let cachedPresetContent = null;
/** preset 缓存是否已初始化 */
let presetCacheInitialized = false;

/**
 * 异步预加载激活的 preset 内容到缓存
 * 调用方在请求前调用此函数刷新缓存，buildPromptPrefix 时同步读取
 * @returns {Promise<void>}
 */
export async function refreshPresetCache() {
    try {
        // 激活预设自动注入，无需总开关控制
        cachedPresetContent = await getActivePresetContent();
        presetCacheInitialized = true;
    } catch (e) {
        console.warn('[prompt-augmentation] refreshPresetCache failed:', e);
        cachedPresetContent = null;
        presetCacheInitialized = true;
    }
}

// 模块加载时预加载一次
refreshPresetCache();

// 挂到 window 供 settings-panel 切换激活预设后刷新缓存
if (typeof window !== 'undefined') {
    window.refreshPresetCache = refreshPresetCache;
}

// 异步预加载 custom skills 到缓存（不阻塞主流程）
(async () => {
    try {
        const { getAllSkills } = await import('../features/skill.js');
        const all = await getAllSkills();
        all.forEach(s => skillCache.set(s.name, s));
    } catch (e) {
        // 预加载失败不影响主流程，skill 命中率降低但不报错
        console.warn('[prompt-augmentation] skill preload failed:', e);
    }
})();

// 需要 import BUILTIN_SKILLS 用于同步缓存
import { BUILTIN_SKILLS } from '../features/skill.js';

// ============================================================
// 时间注入
// ============================================================

/**
 * 格式化当前日期时间为中文格式（精确到秒）
 * @returns {string} 如 "2026年8月5日 星期三 14:30:25"
 */
function formatCurrentTime() {
    const now = new Date();
    const weekDays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
    const y = now.getFullYear();
    const M = now.getMonth() + 1;
    const d = now.getDate();
    const w = weekDays[now.getDay()];
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    const s = String(now.getSeconds()).padStart(2, '0');
    return `${y}年${M}月${d}日 ${w} ${h}:${m}:${s}`;
}

/**
 * 获取时间注入前缀（如果配置启用）
 * @returns {string} 时间标签文本，未启用返回空串
 */
function getTimeInjection() {
    const cfg = getConfig();
    if (!cfg.timeInjectEnabled) return '';
    return '[当前时间]\n' + formatCurrentTime() + '\n[/当前时间]\n\n';
}

// ============================================================
// 核心：构建 prompt prefix
// ============================================================

/**
 * 构建 prompt 前缀（注入的系统指令/记忆/能力/skill）
 *
 * 这是 fetch-hub 和 anti-recall 共用的统一入口。
 * 调用方拿到 prefix 后，把 prefix 拼到 bodyJson.prompt 前面即可。
 *
 * @param {string} originalPrompt - 用户发送的原始 prompt（注入前）
 * @returns {string} prompt 前缀（可能为空串）
 */
export function buildPromptPrefix(originalPrompt) {
    if (typeof originalPrompt !== 'string' || !originalPrompt) return '';

    // Electron 桌面端：DeepSeek++ 扩展负责提示词注入，JS 脚本跳过以避免重复
    if (IS_ELECTRON) return '';

    const cfg = getConfig();
    const isAgentMessage = isAgentContinuationPrompt(originalPrompt);
    let prefix = '';

    if (isAgentMessage) {
        // agent 续跑消息：只注入能力注册提示词
        // 续跑 prompt 已包含原始任务（含用户消息的已注入提示词）和工具结果
        // 重复注入系统指令和记忆会造成上下文冗余，浪费 token
        prefix += callCapabilityInjector();
    } else {
        // 0. Preset 预设内容注入（最前缀，与 deepseek-pp 一致用 --- 分隔）
        //    preset 是用户主动激活的"角色/场景"系统提示词，优先级最高
        if (cachedPresetContent) {
            prefix += cachedPresetContent + '\n\n---\n\n';
        }

        // 1. Skill /命令注入（优先级最高，命中后替换整个 prompt 语义）
        const skillPrompt = tryInjectSkill(originalPrompt);
        const effectivePrompt = skillPrompt || originalPrompt;

        // 2. 系统提示词注入（[系统指令]...[/系统指令]）
        if (cfg.promptInjectEnabled && cfg.promptText) {
            prefix += '[系统指令]\n' + cfg.promptText + '\n[/系统指令]\n\n';
        }

        // 2.5 时间注入（[当前时间]...[/当前时间]）：让 AI 感知当前日期时间
        prefix += getTimeInjection();

        // 3. 记忆系统注入：传入 effectivePrompt 供智能选择器做关键词匹配
        //    若 skill 命中，用 skill 的 instructions 匹配记忆更精准
        prefix += callMemoryInjector(effectivePrompt);

        // 4. 能力注册注入：教会 DeepSeek 如何调用工具
        prefix += callCapabilityInjector();

        // 5. 若 skill 命中，把 skill instructions 作为额外前缀注入
        //    （不替换 originalPrompt，而是 prepend，保留用户原始输入作为上下文）
        if (skillPrompt) {
            prefix += '[技能指令]\n' + skillPrompt + '\n[/技能指令]\n\n';
        }
    }

    return prefix;
}

/**
 * 应用 prompt 增强到请求 body（原地修改 bodyJson.prompt）
 *
 * 供 fetch-hub 和 anti-recall 调用的便捷封装：
 *   1. 解析 body JSON
 *   2. 调用 buildPromptPrefix 构建 prefix
 *   3. 把 prefix 拼到 prompt 前面
 *   4. 序列化回 body 字符串
 *
 * @param {string} bodyString - 请求 body 的 JSON 字符串
 * @returns {{originalPrompt: string|null, newBody: string|null}}
 *   originalPrompt: 用户原始 prompt（注入前），用于记忆触发检测
 *   newBody: 注入后的 body 字符串；无需修改时返回 null
 */
export function applyPromptAugmentation(bodyString) {
    if (typeof bodyString !== 'string' || !bodyString) {
        return { originalPrompt: null, newBody: null };
    }

    // Electron 桌面端：DeepSeek++ 扩展负责提示词注入，JS 脚本跳过以避免重复
    if (IS_ELECTRON) {
        return { originalPrompt: null, newBody: null };
    }

    try {
        const bodyJson = JSON.parse(bodyString);
        if (!bodyJson.prompt) {
            return { originalPrompt: null, newBody: null };
        }

        const originalPrompt = bodyJson.prompt;
        const isAgentMessage = isAgentContinuationPrompt(originalPrompt);
        const prefix = buildPromptPrefix(originalPrompt);

        // 用户消息：用 visiblePrompt 标记包裹原始 prompt，便于后续提取
        // agent 续跑消息：不包裹（续跑 prompt 已含结构化标签，无需额外标记）
        let finalPrompt = originalPrompt;
        let prefixParts = prefix;

        if (!isAgentMessage) {
            // metadata 行放在 prefix 末尾、prompt 前
            const metadata = markVisibleUserPromptMetadata(originalPrompt);
            prefixParts = prefix + metadata + '\n';
            finalPrompt = markVisibleUserPrompt(originalPrompt);
        }

        if (prefixParts) {
            bodyJson.prompt = prefixParts + finalPrompt;
            return {
                originalPrompt,
                newBody: JSON.stringify(bodyJson)
            };
        }
        return { originalPrompt, newBody: null };
    } catch (e) {
        console.warn('[prompt-augmentation] applyPromptAugmentation failed:', e);
        return { originalPrompt: null, newBody: null };
    }
}
