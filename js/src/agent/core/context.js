/**
 * 上下文管理（Context Engineering）
 *
 * 职责：
 *   1. 管理系统提示词注入（核心规则 + 工具说明 + 行为约束）
 *   2. 提供 [能力] 提示词的统一入口
 *   3. 支持渐进式披露：按需加载工具 Schema
 *   4. 工具 Schema 缓存：避免每次请求重新渲染
 *
 * 设计原则：
 *   - 上下文 = 静态前缀（系统提示词 + 工具定义）+ 动态轨迹（消息历史）
 *   - KV Cache 友好：静态前缀缓存不变，动态轨迹追加
 *   - Token 高效：精简冗余，合并相似规则，紧凑格式
 *   - 渐进式披露：默认用紧凑模式，按需展开完整 Schema
 *
 * 提示词结构（优化后，3 段紧凑格式）：
 *   1. 工具调用格式 + 身份 + 约束（合并原六层结构）
 *   2. 决策速查表（紧凑行格式替代原 Markdown 表格）
 *   3. 工具 Schema（动态渲染，带缓存）
 */

import { CONFIG as _CONFIG_SNAPSHOT } from '../../config.js';

// ============================================================
// 工具函数
// ============================================================

/**
 * 安全获取最新 CONFIG
 * @returns {Object}
 */
function _getConfig() {
    try {
        if (typeof window !== 'undefined' && window.__dsConfig) {
            return window.__dsConfig;
        }
    } catch (e) {}
    return _CONFIG_SNAPSHOT;
}

// ============================================================
// 缓存
// ============================================================

/** 核心规则缓存（静态，永不失效） */
let _cachedCoreRules = null;
/** 工具 Schema 缓存（按工具数量+名称哈希校验有效性） */
let _cachedToolSchemas = null;
let _cachedToolSchemasKey = '';

// ============================================================
// 第 1 段：核心规则 + 行为约束（合并原六层结构）
// ============================================================

/**
 * 构建核心规则提示词（合并版）
 *
 * 将原来的六层结构合并为紧凑的 3 段：
 *   1. 工具调用格式 + 身份 + ID 规则
 *   2. 决策速查 + 行为约束
 *   3. 记忆/审查/Todo/提问规则（合并）
 *
 * @returns {string}
 */
export function getCoreRulesPrompt() {
    if (_cachedCoreRules) return _cachedCoreRules;

    _cachedCoreRules = `你是用户的私人 AI 助手，通过浏览器扩展获得跨对话长期记忆能力。你有丰富的工具集可用——主动调用工具是你的默认行为模式，遇到需要信息、需要执行、需要记录的场景，第一反应是"有没有对应的工具？"。

## 工具调用格式
XML 标签，标签体内是紧凑单行 JSON：<tool_name>{"key":"value"}</tool_name>
禁止：<invoke>标签、Markdown 代码块包装、多行 JSON、标签内注释、省略闭合标签、放在思考区域

## 记忆 ID 规则
- memory_save 不传 id（系统自动生成 mem-时间戳）
- memory_update/delete/merge/pin/get 的 id 必须来自 [系统记忆] 中显示的实际 id
- 禁止编造 id

## 主动调用原则
- 工具优先于纯文本：能用工具获取信息/执行操作/保存记忆时，调用工具而非仅文本回复
- 主动记忆：用户透露任何偏好/身份/技术栈/事实时，立即 memory_save，不等用户要求
- 主动搜索：需要最新信息或不确定的事实时，先 web_search 再回答，不凭猜测
- 主动规划：复杂任务（≥3 步）先 todo_write 拆解，再逐步执行
- 一条回复可组合多个工具（如：先 search 查资料，再 save 保存结论）
- 主动使用 start_agent 启动 Agent 循环，而非等待工具调用被动触发

## 决策速查（默认调用工具，仅以下例外跳过）
全新偏好/事实/身份 → 立即 memory_save | 修正已有记忆 → memory_update
旧内容失效 → memory_replace | 过时/错误/冗余 → memory_delete
同主题多条 → memory_merge | 查看记忆库 → memory_list/search
需最新资讯 → 先 web_search 再回答 | 需网页内容 → web_fetch
需求模糊/关键决策 → ask_user | 任务 ≥3 步 → 先 todo_write 再执行
跳过工具：仅闲聊问候、纯意见观点、已明确拒绝的请求

## 行为约束
- 禁止保存到记忆：密钥/密码/Token、身份证号/手机号、一次性问答、临时指令
- 保存记忆时先检查 [系统记忆] 中是否已存在，避免重复保存
- 不确定时宁可调用工具确认，而非猜测后给出错误答案

## 记忆审查
每 10 轮对话或 [系统记忆] 超 15 条时主动 memory_review；优先处理相似度 ≥0.8 的融合，单次处理 ≤8 条；仅同主题/重叠/互补可融合，完全无关禁止融合

## 循环终止
收到 <tool_results> 后：分析结果 → 如需更多信息则调用下一工具 → 结果足够则输出结论 → 末尾调用 agent_finish。多工具可一条回复同时调用。有 pending/in_progress todo 或 pending ask_user 时禁止 agent_finish

## 工具结果处理
- ok:true, skipped:false → 确认继续
- ok:true, skipped:true → 已存在，跳过
- ok:false → 根据 detail 修正重试或告知用户

## Todo 规则
任务 ≥3 步时创建，一次拆解完；同时仅 1 个 in_progress；每次传完整列表；content 写成可验证完成条件；全部 completed 后仍需显式 agent_finish

## 用户提问
需求模糊/关键决策时用 ask_user 工具（非文本提问）；每次 ≤4 问题，每问题 2-4 选项；有 pending 提问时禁止 agent_finish；ask_user 放回复末尾`;

    return _cachedCoreRules;
}

// ============================================================
// 第 2 段：工具说明（动态 + 缓存）
// ============================================================

/**
 * 构建工具说明提示词（带缓存）
 *
 * 工具 Schema 按工具数量+名称计算缓存键，注册中心不变时复用缓存。
 * 按 CONFIG 开关过滤可见工具。
 *
 * @param {Object} registry - 工具注册中心
 * @returns {string}
 */
export function getToolSchemasPrompt(registry) {
    if (!registry) return '';

    const config = _getConfig();
    const allDescriptors = registry.getAllDescriptors();

    // 按 CONFIG 开关过滤
    const visibleDescriptors = allDescriptors.filter(d => {
        if (!config) return true;
        if (d.name === 'web_search' || d.name === 'web_fetch') {
            return config.webToolsEnabled !== false;
        }
        if (d.name === 'python_exec') {
            return config.pythonSandboxEnabled !== false;
        }
        if (d.name.startsWith('mcp__') || d.name.startsWith('mcp_')) {
            return config.mcpEnabled !== false;
        }
        return true;
    });

    if (visibleDescriptors.length === 0) return '';

    // 缓存键：工具数量 + 所有工具名排序后拼接
    const cacheKey = visibleDescriptors.length + '|' +
        visibleDescriptors.map(d => d.name).sort().join(',');

    if (_cachedToolSchemas && _cachedToolSchemasKey === cacheKey) {
        return _cachedToolSchemas;
    }

    _cachedToolSchemas = _renderToolSchemasCompact(visibleDescriptors);
    _cachedToolSchemasKey = cacheKey;
    return _cachedToolSchemas;
}

/**
 * 紧凑格式渲染工具 Schema
 *
 * 每个工具一行：名称 + 风险标记 + 描述 + 必填参数
 * 比原 renderSchemas 节省约 40% token
 *
 * @param {Array} descriptors - 工具描述符数组
 * @returns {string}
 */
function _renderToolSchemasCompact(descriptors) {
    if (descriptors.length === 0) return '';

    const lines = ['## 可用工具'];
    for (const desc of descriptors) {
        const risk = desc.riskLevel === 'high' ? '⚠' : '';
        const ro = desc.isReadOnly ? '[R]' : '';
        let line = `- \`${desc.name}\`${risk}${ro}: ${desc.description || ''}`;

        // 仅列出必填参数
        if (desc.inputSchema && desc.inputSchema.required && desc.inputSchema.required.length > 0) {
            const reqs = desc.inputSchema.required.map(k => {
                const prop = desc.inputSchema.properties?.[k];
                return `${k}(${prop?.type || 'string'})`;
            }).join(', ');
            line += ` | 必填: ${reqs}`;
        }

        // 边界条件
        if (desc.boundaryNote) {
            line += ` | ${desc.boundaryNote}`;
        }

        lines.push(line);
    }

    return lines.join('\n');
}

// ============================================================
// 提示词构建
// ============================================================

/**
 * 构建完整 [能力] 提示词（标准模式）
 *
 * 结构：核心规则 → 工具 Schema
 * 用 [能力]...[/能力] 包裹，由 fetch-hub / anti-recall 注入。
 *
 * @param {Object} registry - 工具注册中心
 * @returns {string}
 */
export function buildCapabilityPrompt(registry) {
    const parts = ['[能力]', ''];

    // 核心规则
    const core = getCoreRulesPrompt();
    if (core) parts.push(core);

    // 工具 Schema（带缓存）
    const schemas = getToolSchemasPrompt(registry);
    if (schemas) parts.push('', schemas);

    parts.push('', '[/能力]');
    return parts.join('\n');
}

/**
 * 构建紧凑模式提示词（仅核心规则 + 工具索引）
 *
 * 适用于 context 预算紧张的场景，工具部分仅输出名称列表。
 * 相比标准模式节省约 60% token。
 *
 * @param {Object} registry - 工具注册中心
 * @returns {string}
 */
export function buildCompactPrompt(registry) {
    const parts = ['[能力]', ''];

    // 核心规则
    const core = getCoreRulesPrompt();
    if (core) parts.push(core);

    // 工具索引（仅名称+一句话描述，不展开 Schema）
    if (registry) {
        const index = registry.renderIndex();
        if (index) {
            parts.push('', '## 可用工具', index);
        }
    }

    parts.push('', '[/能力]');
    return parts.join('\n');
}

/**
 * 构建工具索引提示词（渐进式披露，仅名称+一句话描述）
 * @param {Object} registry - 工具注册中心
 * @returns {string}
 */
export function buildToolIndexPrompt(registry) {
    if (!registry) return '';
    const index = registry.renderIndex();
    if (!index) return '';
    return `[能力]
## 可用工具索引

使用 mcp_describe 工具查看具体工具的完整参数说明。

${index}

[/能力]`;
}

/**
 * 估算提示词 token 数（粗略：中文字符 ≈ 1.5 token，英文 ≈ 0.25 token）
 * @param {string} text - 提示词文本
 * @returns {number} 估算 token 数
 */
export function estimateTokens(text) {
    if (!text) return 0;
    let chineseChars = 0;
    let otherChars = 0;
    for (const ch of text) {
        if (/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(ch)) {
            chineseChars++;
        } else {
            otherChars++;
        }
    }
    return Math.ceil(chineseChars * 1.5 + otherChars * 0.25);
}

// ============================================================
// 缓存管理
// ============================================================

/**
 * 清除工具 Schema 缓存（注册中心变更后调用）
 */
export function invalidateToolSchemaCache() {
    _cachedToolSchemas = null;
    _cachedToolSchemasKey = '';
}

/**
 * 清除所有缓存（配置变更后调用）
 */
export function invalidateAllCache() {
    _cachedCoreRules = null;
    _cachedToolSchemas = null;
    _cachedToolSchemasKey = '';
}

// ============================================================
// 初始化
// ============================================================

let _initialized = false;

/**
 * 初始化上下文管理模块
 *
 * 挂载 window._dsCapabilityInjector 回调，
 * 供 fetch-hub / anti-recall 调用。
 *
 * @param {Object} registry - 工具注册中心
 */
export function initContextModule(registry) {
    if (_initialized) return;
    _initialized = true;

    if (typeof window !== 'undefined' && typeof window._dsCapabilityInjector !== 'function') {
        window._dsCapabilityInjector = function() {
            try {
                const config = _getConfig();
                if (!config || !config.agentSystemEnabled || !config.agentToolsEnabled) {
                    return '';
                }
                return buildCapabilityPrompt(registry);
            } catch (e) {
                return '';
            }
        };
    }

    console.log('[ContextModule] 已初始化');
}