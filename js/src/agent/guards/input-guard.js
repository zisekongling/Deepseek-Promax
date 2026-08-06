/**
 * 输入护栏（Input Guard）
 *
 * 职责：
 *   - 用户输入校验：长度限制、格式检查、敏感内容检测
 *   - 提示注入防护：检测常见注入模式
 *   - 上下文约束：确保输入在 Agent 系统的处理能力范围内
 *
 * 设计原则（参考《AI Agent 实战》指南）：
 *   - 输入隔离：安全检查只看结构化数据，不依赖模型自由文本
 *   - 防御性设计：假设所有用户输入都是不可信的
 *   - 故障安全：不确定时宁可拒绝
 */

// ============================================================
// 常量
// ============================================================

/** 输入最大字符数（防止超长输入耗尽上下文） */
const MAX_INPUT_LENGTH = 100000;
/** 注入检测关键词模式 */
const INJECTION_PATTERNS = [
    /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions?|prompts?)/i,
    /disregard\s+(all\s+)?(previous|prior|above)\s+(instructions?|prompts?)/i,
    /forget\s+(all\s+)?(previous|prior|above)\s+(instructions?|prompts?)/i,
    /you\s+are\s+now\s+(a\s+)?DAN/i,
    /pretend\s+you\s+are/i,
    /system\s*:\s*override/i,
    /new\s+system\s+prompt:/i,
    /\[system\]\s*\(/i,
    /<\|im_start\|>/i,
    /<\|im_end\|>/i
];

// ============================================================
// 输入校验
// ============================================================

/**
 * 校验用户输入
 *
 * 检查：空值、类型、长度限制。
 *
 * @param {string} text - 用户输入文本
 * @returns {{ allowed: boolean, reason?: string }}
 */
export function validateInput(text) {
    if (!text || typeof text !== 'string') {
        return { allowed: false, reason: '输入为空' };
    }

    if (text.length > MAX_INPUT_LENGTH) {
        return { allowed: false, reason: `输入过长（超过 ${MAX_INPUT_LENGTH} 字符）` };
    }

    return { allowed: true };
}

/**
 * 检测提示注入
 *
 * 使用正则匹配常见注入模式。
 * 这是一个轻量级检测，生产环境建议使用专用模型。
 *
 * @param {string} text - 用户输入文本
 * @returns {{ detected: boolean, matches?: string[] }}
 */
export function detectPromptInjection(text) {
    if (!text || typeof text !== 'string') return { detected: false };

    const matches = [];
    for (const pattern of INJECTION_PATTERNS) {
        const match = text.match(pattern);
        if (match) {
            matches.push(match[0]);
        }
    }

    return {
        detected: matches.length > 0,
        matches: matches.length > 0 ? matches : undefined
    };
}

/**
 * 检测 Agent 续跑边界标记注入
 *
 * 防止用户输入中包含 __DS_AGENT_V2_START__ 等内部标记，
 * 这些标记被用于 Agent 续跑 prompt 的边界识别。
 *
 * @param {string} text - 用户输入文本
 * @returns {{ detected: boolean }}
 */
export function detectAgentBoundaryInjection(text) {
    if (!text || typeof text !== 'string') return { detected: false };

    const boundaryMarkers = [
        '__DS_AGENT_V2_START__',
        '__DS_AGENT_V2_END__',
        '<original_task>',
        '<tool_results>',
        '<user_answers>',
        '<todo_status>',
        '<reminder>'
    ];

    for (const marker of boundaryMarkers) {
        if (text.includes(marker)) {
            return { detected: true };
        }
    }

    return { detected: false };
}

/**
 * 完整输入护栏检查
 *
 * 组合校验、注入检测、边界标记检测。
 *
 * @param {string} text - 用户输入文本
 * @returns {{ allowed: boolean, reason?: string, warnings?: string[] }}
 */
export function fullInputGuard(text) {
    const warnings = [];

    // 基本校验
    const validation = validateInput(text);
    if (!validation.allowed) {
        return { allowed: false, reason: validation.reason };
    }

    // 注入检测
    const injection = detectPromptInjection(text);
    if (injection.detected) {
        warnings.push('检测到可能的提示注入模式');
    }

    // 边界标记检测
    const boundary = detectAgentBoundaryInjection(text);
    if (boundary.detected) {
        warnings.push('检测到 Agent 内部边界标记');
    }

    return {
        allowed: true,
        warnings: warnings.length > 0 ? warnings : undefined
    };
}