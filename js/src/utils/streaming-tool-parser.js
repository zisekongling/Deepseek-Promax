/**
 * @module streaming-tool-parser
 * @description DeepSeek 流式工具调用片段解析器
 *
 * 在 DeepSeek 流式输出（SSE chunk）过程中，增量识别 <tool_name>...</tool_name>
 * 完整片段，一旦完整立即触发执行，不等整条回复结束。
 *
 * 项目实际的工具调用 XML 格式为 <tool_name>紧凑JSON</tool_name>，
 * 其中 tool_name 是 capability-register.js 中 TOOL_NAMES 列出的具体工具名
 * （如 memory_save / memory_update / todo_write 等），并非字面 <tool_call> 包装。
 * 本模块即基于该工具名集合进行识别，与 text-process.js 的 hasToolFragment、
 * history-cleanup.js 的 TOOL_CALL_XML_RE 保持命名一致。
 *
 * 设计参考：
 *   - deepseek-pp/core/interceptor/streaming-tool-call-parser.ts（状态机与缓冲区）
 *   - deepseek-pp/core/interceptor/streaming-tool-text.ts（SUPPRESSING 抑制状态）
 *   - js/src/features/text-process.js 的 hasToolFragment / _lenientParseJSON
 *   - js/src/features/capability-register.js 的 TOOL_NAMES（单一数据源）
 *   - js/src/features/history-cleanup.js 的 TOOL_CALL_XML_RE
 *
 * 状态机三态：
 *   IDLE         — 等待 <tool_name> 开始，普通文本走 onText
 *   ACCUMULATING — 已看到 <tool_name> 起始，累积 body 直到 </tool_name>，期间不输出
 *   SUPPRESSING  — 工具调用已触发执行后的瞬态，下一轮 feed 自动转 IDLE；
 *                  用于在事件循环中标记"刚结束一次调用"，便于观测与连续调用衔接
 *
 * 性能策略：
 *   - 用 indexOf 定位标签边界，避免每次 feed 都用大正则匹配整个缓冲
 *   - 跨 chunk 标签分割通过末尾前缀保留（pendingNormal / pendingSuppressed）
 *
 * Phase 6 接入点：
 *   在 fetch-hub.js 的 observeStream / observeXhrStream 的 onChunk 回调中，
 *   将 chunk 喂入 createStreamingParser() 返回的 feed(chunk)；
 *   onText 收到的可见文本用于页面渲染，onToolCall 收到的完整 XML 用于触发执行；
 *   onEnd 中调用 flush() 处理残余缓冲。
 */

import { TOOL_NAMES } from '../features/capability-register.js';

// ============================================================
// 状态枚举
// ============================================================

/** 状态机三态常量 */
const STATE = {
    IDLE: 'IDLE',
    ACCUMULATING: 'ACCUMULATING',
    SUPPRESSING: 'SUPPRESSING'
};

// ============================================================
// 工具名解析
// ============================================================

/**
 * 解析生效的工具名集合
 *
 * 优先级：显式传入 > window._dsToolNames（运行时由 capability-register 挂载）> 默认 TOOL_NAMES
 * 这样既支持单一数据源（导入的 TOOL_NAMES），又允许运行时动态工具集覆盖，
 * 同时调用方可传入自定义集合（如仅监听部分工具）。
 *
 * @param {string[]|undefined} toolNames - 调用方显式传入的工具名列表
 * @returns {string[]} 生效的工具名数组
 */
function resolveToolNames(toolNames) {
    if (Array.isArray(toolNames) && toolNames.length > 0) {
        return toolNames;
    }
    if (typeof window !== 'undefined' &&
        Array.isArray(window._dsToolNames) &&
        window._dsToolNames.length > 0) {
        return window._dsToolNames;
    }
    return TOOL_NAMES;
}

// ============================================================
// 标签定位（indexOf 实现，避免大正则）
// ============================================================

/**
 * 在文本中查找第一个完整的开标签 <name>
 *
 * 从左到右用 indexOf 顺序定位 '<'，对每个 '<' 检查是否紧跟某个工具名 + '>'
 * 不匹配的 '<'（如普通 HTML 标签 <br>）会被跳过，作为普通文本处理
 *
 * @param {string} text - 待搜索文本
 * @param {string[]} toolNames - 工具名集合
 * @returns {{name:string, index:number, endIndex:number}|null}
 *   匹配返回 {name, index, endIndex}（endIndex 为闭区间之后的位置），无匹配返回 null
 */
function findOpenTag(text, toolNames) {
    if (!text) return null;
    let searchFrom = 0;
    while (searchFrom < text.length) {
        const lt = text.indexOf('<', searchFrom);
        if (lt === -1) return null;
        // 检查 lt 位置是否是某个工具名的开标签 <name>
        for (let i = 0; i < toolNames.length; i++) {
            const tag = '<' + toolNames[i] + '>';
            if (text.startsWith(tag, lt)) {
                return { name: toolNames[i], index: lt, endIndex: lt + tag.length };
            }
        }
        searchFrom = lt + 1;
    }
    return null;
}

/**
 * 在文本中查找指定工具名的完整闭标签 </name>
 *
 * @param {string} text - 待搜索文本
 * @param {string} name - 当前累积的工具名
 * @returns {{index:number, endIndex:number}|null}
 *   匹配返回 {index, endIndex}，无匹配返回 null
 */
function findCloseTag(text, name) {
    if (!text || !name) return null;
    const tag = '</' + name + '>';
    const idx = text.indexOf(tag);
    if (idx === -1) return null;
    return { index: idx, endIndex: idx + tag.length };
}

/**
 * 检测文本末尾是否是某个开标签 <name 的不完整前缀（跨 chunk 保留）
 *
 * 例如 text 末尾为 "<mem" 或 "<memory_save"（无 '>'）时，可能是 <memory_save> 的跨 chunk 残片，
 * 需保留到下次 feed 拼接后再判断。
 *
 * 实现策略：定位最后一个 '<'，取其后到末尾的 tail；若 tail 已含 '>' 则交 findOpenTag 处理；
 * 否则检查 tail 是否是某个 <name 的前缀。
 *
 * @param {string} text - 当前文本
 * @param {string[]} toolNames - 工具名集合
 * @returns {number} 末尾前缀长度（0 表示无前缀，可全部输出）
 */
function getOpenTagPrefixLength(text, toolNames) {
    if (!text || toolNames.length === 0) return 0;
    const lastLt = text.lastIndexOf('<');
    if (lastLt === -1) return 0;
    const tail = text.slice(lastLt);
    // tail 已含 '>'，说明 '<' 后已有完整 '>'，findOpenTag 会处理，无需保留
    if (tail.indexOf('>') !== -1) return 0;
    for (let i = 0; i < toolNames.length; i++) {
        const prefix = '<' + toolNames[i];
        // tail 长度不超过 prefix，且 tail 是 prefix 的前缀
        if (prefix.length >= tail.length && prefix.startsWith(tail)) {
            return tail.length;
        }
    }
    return 0;
}

/**
 * 检测文本末尾是否是闭标签 </name 的不完整前缀（跨 chunk 保留）
 *
 * 例如当前 currentName='memory_save'，text 末尾为 "</mem" 时需保留。
 *
 * @param {string} text - 当前文本
 * @param {string} name - 当前累积的工具名
 * @returns {number} 末尾前缀长度（0 表示无前缀）
 */
function getCloseTagPrefixLength(text, name) {
    if (!text || !name) return 0;
    const prefix = '</' + name + '>';
    const lastLt = text.lastIndexOf('</');
    if (lastLt === -1) return 0;
    const tail = text.slice(lastLt);
    // tail 已含 '>'，findCloseTag 会处理
    if (tail.indexOf('>') !== -1) return 0;
    if (prefix.startsWith(tail)) return tail.length;
    return 0;
}

// ============================================================
// 容错 JSON 解析（参考 text-process.js 的 _lenientParseJSON，简化版）
// ============================================================

/**
 * 压缩 JSON 字符串外的空白（字符串内保留原样）
 *
 * 逐字符遍历，跟踪字符串边界与转义状态；字符串外的换行/制表符压缩为单空格，
 * 最终将连续空白合并为单空格并 trim。
 *
 * @param {string} text - 原始 JSON 文本
 * @returns {string} 压缩后的 JSON 文本
 */
function compactJsonWhitespace(text) {
    let out = '';
    let inString = false;
    let escape = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (escape) { out += ch; escape = false; continue; }
        if (ch === '\\') { out += ch; escape = true; continue; }
        if (ch === '"') { inString = !inString; out += ch; continue; }
        if (inString) {
            out += ch;
        } else if (ch === '\n' || ch === '\r' || ch === '\t') {
            out += ' ';
        } else {
            out += ch;
        }
    }
    return out.replace(/\s+/g, ' ').trim();
}

/**
 * 容错解析工具调用 body 为 JSON 对象
 *
 * 处理：markdown 代码块包装、字符串外多行空白压缩、尾逗号移除。
 * 仅当解析结果为普通对象（非数组、非原始值）时返回，否则返回 null。
 *
 * @param {string} body - 工具调用标签内的原始文本
 * @returns {Object|null} 解析成功返回对象，失败或非对象返回 null
 */
function parseToolCallBody(body) {
    if (!body) return null;
    let cleaned = body.trim();
    if (!cleaned) return null;
    // 1. 移除 markdown 代码块包装
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');
    // 2. 压缩字符串外空白
    cleaned = compactJsonWhitespace(cleaned);
    // 3. 移除尾逗号（,} 或 ,]）
    cleaned = cleaned.replace(/,(\s*[}\]])/g, '$1');
    try {
        const parsed = JSON.parse(cleaned);
        return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : null;
    } catch (e) {
        return null;
    }
}

// ============================================================
// 公开 API
// ============================================================

/**
 * 创建流式工具调用解析器
 *
 * 工厂函数，返回 { feed, flush, reset }。调用方在 SSE chunk 回调中调用 feed(chunk)，
 * 解析器通过 onToolCall / onText 回调实时分发结果。
 *
 * @param {Object} [options={}]
 * @param {function(string):void} [options.onToolCall] - 完整 <tool_name>...</tool_name> 识别时的回调，参数为完整 XML 字符串
 * @param {function(string):void} [options.onText] - 非工具调用的可见文本回调（用于页面渲染）
 * @param {string[]} [options.toolNames] - 自定义工具名集合（默认用 TOOL_NAMES / window._dsToolNames）
 * @returns {{feed:function(string):void, flush:function():void, reset:function():void}}
 *   feed(chunk) 喂入流式 chunk；flush() 流结束处理残余；reset() 重置状态机
 */
export function createStreamingParser(options = {}) {
    const { onToolCall, onText, toolNames } = options;
    const names = resolveToolNames(toolNames);

    let state = STATE.IDLE;
    let pendingNormal = '';      // IDLE 末尾可能的开标签前缀（跨 chunk 保留）
    let pendingSuppressed = '';  // ACCUMULATING 末尾可能的闭标签前缀（跨 chunk 保留）
    let currentName = null;      // 当前累积的工具名
    let bodyParts = [];          // 当前累积的 body 片段（数组避免反复拼接字符串）

    /**
     * 安全触发可见文本回调
     * @param {string} text - 可见文本
     */
    function emitText(text) {
        if (text && typeof onText === 'function') {
            try { onText(text); } catch (e) { /* 回调异常不影响状态机 */ }
        }
    }

    /**
     * 安全触发工具调用回调
     * @param {string} xml - 完整工具调用 XML
     */
    function emitToolCall(xml) {
        if (typeof onToolCall === 'function') {
            try { onToolCall(xml); } catch (e) { /* 回调异常不影响状态机 */ }
        }
    }

    /**
     * 消费 IDLE 状态文本：输出普通文本，检测开标签
     * 找到开标签则输出前缀文本并转入 ACCUMULATING；未找到则保留末尾前缀，输出其余
     *
     * @param {string} input - 本次待消费文本
     * @returns {string} 剩余未消费文本（可能为空字符串）
     */
    function consumeIdle(input) {
        const text = pendingNormal + input;
        pendingNormal = '';
        const found = findOpenTag(text, names);
        if (!found) {
            const tailLen = getOpenTagPrefixLength(text, names);
            const emitLen = text.length - tailLen;
            if (emitLen > 0) emitText(text.slice(0, emitLen));
            pendingNormal = tailLen > 0 ? text.slice(text.length - tailLen) : '';
            return '';
        }
        // 输出开标签之前的普通文本
        if (found.index > 0) emitText(text.slice(0, found.index));
        // 进入累积状态
        state = STATE.ACCUMULATING;
        currentName = found.name;
        bodyParts = [];
        pendingSuppressed = '';
        return text.slice(found.endIndex);
    }

    /**
     * 消费 ACCUMULATING 状态文本：累积 body，检测闭标签
     * 找到闭标签则触发 onToolCall 并转入 SUPPRESSING；未找到则保留末尾前缀，累积其余
     *
     * @param {string} input - 本次待消费文本
     * @returns {string} 剩余未消费文本（可能为空字符串）
     */
    function consumeAccumulating(input) {
        const text = pendingSuppressed + input;
        pendingSuppressed = '';
        const close = findCloseTag(text, currentName);
        if (!close) {
            const tailLen = getCloseTagPrefixLength(text, currentName);
            const consumeLen = text.length - tailLen;
            if (consumeLen > 0) bodyParts.push(text.slice(0, consumeLen));
            pendingSuppressed = tailLen > 0 ? text.slice(text.length - tailLen) : '';
            return '';
        }
        // 累积闭标签之前的 body
        if (close.index > 0) bodyParts.push(text.slice(0, close.index));
        const body = bodyParts.join('');
        const fullXml = '<' + currentName + '>' + body + '</' + currentName + '>';
        emitToolCall(fullXml);
        // 收尾：清空当前调用上下文，进入 SUPPRESSING 瞬态
        bodyParts = [];
        currentName = null;
        state = STATE.SUPPRESSING;
        return text.slice(close.endIndex);
    }

    /**
     * 喂入流式 chunk 字符串
     *
     * 内部循环消费 chunk，直到全部处理完毕或进入需等待下一 chunk 的累积状态。
     * SUPPRESSING 状态遇新文本先转 IDLE，再交 consumeIdle 处理（支持连续工具调用）。
     *
     * @param {string} chunk - SSE 流式 chunk 字符串
     * @returns {void}
     */
    function feed(chunk) {
        if (typeof chunk !== 'string' || !chunk) return;
        let remaining = chunk;
        while (remaining.length > 0) {
            if (state === STATE.ACCUMULATING) {
                remaining = consumeAccumulating(remaining);
            } else {
                // IDLE 或 SUPPRESSING：SUPPRESSING 遇新文本先转 IDLE
                if (state === STATE.SUPPRESSING) state = STATE.IDLE;
                remaining = consumeIdle(remaining);
            }
        }
    }

    /**
     * 流结束时调用，处理残余缓冲
     *
     * - IDLE：输出 pendingNormal 残留的普通文本
     * - ACCUMULATING：不完整 tool_call（缺闭标签），输出原始残缺 XML 文本交上层清理逻辑处理
     *   （与 text-process.js 的未闭合开标签清理策略协同，不触发 onToolCall 以避免执行半截调用）
     * - SUPPRESSING：无残留，直接转 IDLE
     *
     * @returns {void}
     */
    function flush() {
        if (state === STATE.IDLE) {
            if (pendingNormal) {
                emitText(pendingNormal);
                pendingNormal = '';
            }
        } else if (state === STATE.ACCUMULATING) {
            // 不完整 tool_call：输出原始残缺 XML 文本，交上层清理逻辑处理
            const body = bodyParts.join('') + pendingSuppressed;
            emitText('<' + currentName + '>' + body);
            bodyParts = [];
            pendingSuppressed = '';
            currentName = null;
        }
        // SUPPRESSING 无残留
        state = STATE.IDLE;
        pendingNormal = '';
        pendingSuppressed = '';
    }

    /**
     * 重置状态机到初始 IDLE 态，清空所有缓冲
     *
     * 供调用方在会话切换或重新开始流时复用解析器实例
     *
     * @returns {void}
     */
    function reset() {
        state = STATE.IDLE;
        pendingNormal = '';
        pendingSuppressed = '';
        currentName = null;
        bodyParts = [];
    }

    return { feed, flush, reset };
}

/**
 * 从 <tool_name>JSON</tool_name> XML 中提取工具名与参数
 *
 * 通用提取函数，不限于特定工具名集合：只要 XML 形如 <合法标识符>body</同标识符>
 * 即可提取。body 为空时 args 为 null；body 非空时用容错解析得到对象，解析失败 args 为 null。
 *
 * @param {string} xml - 完整的工具调用 XML 字符串
 * @returns {{name:string, args:Object|null, rawBody:string}|null}
 *   成功返回 { name, args, rawBody }；xml 非合法 XML 结构返回 null。
 *   args 为 JSON 解析后的对象，body 为空或解析失败时为 null；rawBody 为去空白后的原始 body
 */
export function extractToolCall(xml) {
    if (typeof xml !== 'string' || !xml) return null;
    const m = xml.match(/^<([a-zA-Z_][\w]*)>([\s\S]*?)<\/\1>$/);
    if (!m) return null;
    const name = m[1];
    const rawBody = m[2].trim();
    const args = rawBody ? parseToolCallBody(rawBody) : null;
    return { name, args, rawBody };
}

/**
 * 快速判断 chunk 是否包含 <tool_name 起始（供调用方决定是否进入解析）
 *
 * 用于在 fetch-hub 的 onChunk 回调中做轻量预判：仅当 chunk 可能包含工具调用起始时
 * 才进入解析器，避免对纯文本 chunk 的无谓处理。
 *
 * 检测两种情况（宁误报不漏报，误报仅多走一遍解析器，无副作用）：
 *   1. chunk 中含完整的 <tool_name 起始（< + 完整工具名）
 *   2. chunk 末尾是某个 <tool_name 的不完整前缀（跨 chunk 残片，如 "<memory_sav"）
 *
 * 注意：此为快速预判，调用方进入解析后由状态机精确判定。
 *
 * @param {string} chunk - 流式 chunk 字符串
 * @param {string[]} [toolNames] - 自定义工具名集合（默认用 TOOL_NAMES / window._dsToolNames）
 * @returns {boolean} true 表示 chunk 可能包含工具调用起始
 */
export function isToolCallStarting(chunk, toolNames) {
    if (typeof chunk !== 'string' || !chunk) return false;
    const names = resolveToolNames(toolNames);
    // 1. 检测完整 <tool_name 起始
    for (let i = 0; i < names.length; i++) {
        if (chunk.indexOf('<' + names[i]) !== -1) return true;
    }
    // 2. 检测末尾不完整前缀（跨 chunk 残片）
    const lastLt = chunk.lastIndexOf('<');
    if (lastLt !== -1) {
        const tail = chunk.slice(lastLt);
        // tail 已含 '>' 则是完整标签，要么已被第 1 步命中，要么不是工具标签
        if (tail.indexOf('>') === -1) {
            for (let i = 0; i < names.length; i++) {
                const prefix = '<' + names[i];
                if (prefix.startsWith(tail)) return true;
            }
        }
    }
    return false;
}
