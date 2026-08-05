/**
 * @module multimodal/analyzer
 * @description 图片分析执行器（OpenAI / Gemini）
 *
 * 职责：
 *   - analyzeImages(images, prompt?)：调用配置的 provider 分析图片，返回结构化结果
 *   - 跨环境请求降级：GM_xmlhttpRequest（油猴）→ Platform.http()（WebView）→ fetch（Web 兜底）
 *   - 超时控制：默认 60s，多图按数量扩展（每图 +15s）
 *   - 错误处理：401 Key 无效、429 限流、5xx 服务端错误、网络错误、超时
 *
 * 返回结构：
 *   { ok: boolean, analysis?: string, error?: string, raw?: string }
 *
 * 安全约定：
 *   - API Key 仅从 settings 读取后放入请求头/URL，绝不 console.log
 *   - 错误信息中不回显 Key
 *
 * 请求协议：
 *   - OpenAI：POST {baseUrl}/chat/completions
 *     body: { model, messages: [{ role:'user', content: [{type:'text',text:prompt}, {type:'image_url', image_url:{url:dataUrl}}] }] }
 *     headers: Authorization: Bearer {apiKey}
 *   - Gemini：POST {baseUrl}/models/{model}:generateContent?key={apiKey}
 *     body: { contents: [{ parts: [{text:prompt}, {inline_data:{mime_type, data:base64}}] }] }
 *
 * 参考实现：deepseek-pp/core/multimodal（settings.ts / media.ts / policy.ts）
 */

import { Platform } from '../../platform/bridge.js';
import { getMultimodalConfig, isProviderConfigured } from './settings.js';

// ============================================================
// 常量
// ============================================================

/** 默认分析 prompt（用户未提供时使用） */
const DEFAULT_PROMPT = '请详细描述并分析这张图片的内容。';
/** 每张图片额外增加的超时时间（毫秒） */
const PER_IMAGE_TIMEOUT_MS = 15000;
/** 默认分析 prompt 的最大长度（截断） */
const MAX_PROMPT_LENGTH = 4000;

// ============================================================
// 配置获取
// ============================================================

/**
 * 安全读取多模态配置
 *
 * @returns {Object} 多模态配置对象
 */
function getConfig() {
    return getMultimodalConfig();
}

// ============================================================
// 超时计算
// ============================================================

/**
 * 根据图片数量计算请求超时时间
 *
 * 基础超时（来自配置，默认 60s）+ 每图 +15s。
 * 参考 deepseek-pp policy.ts:calculateMultimodalRequestAugmentationTimeoutMs
 *
 * @param {number} imageCount - 图片数量
 * @returns {number} 超时毫秒数
 */
function calculateTimeout(imageCount) {
    const cfg = getConfig();
    const base = typeof cfg.timeout === 'number' ? cfg.timeout : 60000;
    const count = Math.max(1, imageCount | 0);
    return base + (count - 1) * PER_IMAGE_TIMEOUT_MS;
}

// ============================================================
// 对外 API
// ============================================================

/**
 * 分析图片：调用配置的 provider（OpenAI / Gemini）对一组图片进行理解
 *
 * @param {Array<Object>} images - 图片对象数组（来自 media.js，含 dataUrl / base64Data / mimeType / name）
 * @param {string} [prompt] - 分析指令（可选，默认描述图片内容）
 * @returns {Promise<{ok:boolean, analysis?:string, error?:string, raw?:string}>}
 */
export async function analyzeImages(images, prompt) {
    // 1. 参数校验
    if (!Array.isArray(images) || images.length === 0) {
        return { ok: false, error: '没有可分析的图片' };
    }
    const cfg = getConfig();
    if (cfg.maxImages && images.length > cfg.maxImages) {
        return { ok: false, error: '图片数量超过上限（' + cfg.maxImages + ' 张）' };
    }

    // 2. 校验 provider 是否已配置
    if (!isProviderConfigured()) {
        return { ok: false, error: '当前 provider 的 apiKey 未配置，请先在多模态设置中填写 API Key' };
    }

    // 3. 规范化 prompt
    const userPrompt = normalizePrompt(prompt);

    // 4. 按 provider 分发
    try {
        if (cfg.provider === 'gemini') {
            return await analyzeWithGemini(images, userPrompt, cfg);
        }
        return await analyzeWithOpenAI(images, userPrompt, cfg);
    } catch (e) {
        return {
            ok: false,
            error: '分析请求失败：' + (e && e.message || String(e))
        };
    }
}

/**
 * 规范化分析 prompt
 *
 * @param {string} prompt - 原始 prompt
 * @returns {string}
 */
function normalizePrompt(prompt) {
    if (typeof prompt !== 'string') return DEFAULT_PROMPT;
    const t = prompt.trim();
    if (t.length === 0) return DEFAULT_PROMPT;
    if (t.length > MAX_PROMPT_LENGTH) {
        return t.slice(0, MAX_PROMPT_LENGTH);
    }
    return t;
}

// ============================================================
// OpenAI 调用
// ============================================================

/**
 * 通过 OpenAI Chat Completions 分析图片
 *
 * POST {baseUrl}/chat/completions
 * body.messages[0].content = [{type:'text',text:prompt}, {type:'image_url',image_url:{url:dataUrl}}]
 *
 * @param {Array<Object>} images - 图片数组
 * @param {string} prompt - 分析 prompt
 * @param {Object} cfg - 多模态配置
 * @returns {Promise<{ok:boolean, analysis?:string, error?:string, raw?:string}>}
 */
async function analyzeWithOpenAI(images, prompt, cfg) {
    const baseUrl = cfg.openai.baseUrl;
    const url = baseUrl + '/chat/completions';
    const body = {
        model: cfg.openai.model,
        messages: [{
            role: 'user',
            content: [
                { type: 'text', text: prompt },
                ...images.map(img => ({
                    type: 'image_url',
                    image_url: { url: img.dataUrl }
                }))
            ]
        }]
    };
    const headers = {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + cfg.openai.apiKey
    };
    const timeout = calculateTimeout(images.length);

    const res = await _requestJson('POST', url, headers, body, timeout);
    if (!res.ok) {
        return { ok: false, error: res.error, raw: res.raw };
    }
    const json = res.json;
    // 提取文本：choices[0].message.content
    const content = extractOpenAIContent(json);
    if (content == null) {
        return {
            ok: false,
            error: 'OpenAI 响应缺少 choices[0].message.content',
            raw: res.raw
        };
    }
    return { ok: true, analysis: content, raw: res.raw };
}

/**
 * 从 OpenAI 响应中提取文本内容
 *
 * 兼容 content 为字符串或数组（多模态返回有时是数组）的情况。
 *
 * @param {Object} json - 响应 JSON
 * @returns {string|null} 文本内容，无法提取返回 null
 */
function extractOpenAIContent(json) {
    if (!json || !Array.isArray(json.choices) || json.choices.length === 0) return null;
    const msg = json.choices[0].message || {};
    if (typeof msg.content === 'string') return msg.content;
    if (Array.isArray(msg.content)) {
        // 多模态返回的 content 可能是 [{type:'text',text:'...'}]
        return msg.content
            .filter(p => p && (p.type === 'text' || typeof p.text === 'string'))
            .map(p => p.text || '')
            .join('');
    }
    return null;
}

// ============================================================
// Gemini 调用
// ============================================================

/**
 * 通过 Gemini generateContent 分析图片
 *
 * POST {baseUrl}/models/{model}:generateContent?key={apiKey}
 * body.contents[0].parts = [{text:prompt}, {inline_data:{mime_type, data:base64}}]
 *
 * @param {Array<Object>} images - 图片数组
 * @param {string} prompt - 分析 prompt
 * @param {Object} cfg - 多模态配置
 * @returns {Promise<{ok:boolean, analysis?:string, error?:string, raw?:string}>}
 */
async function analyzeWithGemini(images, prompt, cfg) {
    const baseUrl = cfg.gemini.baseUrl;
    const url = baseUrl + '/models/' + encodeURIComponent(cfg.gemini.model) + ':generateContent?key=' + encodeURIComponent(cfg.gemini.apiKey);
    const body = {
        contents: [{
            parts: [
                { text: prompt },
                ...images.map(img => ({
                    inline_data: {
                        mime_type: img.mimeType || 'image/jpeg',
                        data: img.base64Data || ''
                    }
                }))
            ]
        }]
    };
    const headers = {
        'Content-Type': 'application/json'
    };
    const timeout = calculateTimeout(images.length);

    const res = await _requestJson('POST', url, headers, body, timeout);
    if (!res.ok) {
        return { ok: false, error: res.error, raw: res.raw };
    }
    const json = res.json;
    // 提取文本：candidates[0].content.parts[].text
    const content = extractGeminiContent(json);
    if (content == null) {
        return {
            ok: false,
            error: 'Gemini 响应缺少 candidates[0].content.parts[].text',
            raw: res.raw
        };
    }
    return { ok: true, analysis: content, raw: res.raw };
}

/**
 * 从 Gemini 响应中提取文本内容
 *
 * @param {Object} json - 响应 JSON
 * @returns {string|null} 文本内容，无法提取返回 null
 */
function extractGeminiContent(json) {
    if (!json || !Array.isArray(json.candidates) || json.candidates.length === 0) return null;
    const cand = json.candidates[0];
    const content = cand.content || {};
    const parts = content.parts;
    if (!Array.isArray(parts)) return null;
    const text = parts
        .filter(p => p && typeof p.text === 'string')
        .map(p => p.text)
        .join('');
    return text.length > 0 ? text : null;
}

// ============================================================
// 跨环境 JSON 请求（POST）
// ============================================================

/**
 * 发起 JSON 请求并返回解析后的结果（三环境降级）
 *
 * 优先级：
 *   1. 油猴环境：GM_xmlhttpRequest（可跨域，无 CORS）
 *   2. WebView 环境：Platform.http()（调原生网络栈绕过 CORS）
 *   3. Web 环境：fetch（可能 CORS 失败）
 *
 * 错误分类：
 *   - 401：Key 无效或过期
 *   - 429：限流，需稍后重试
 *   - 5xx：服务端错误
 *   - 网络错误 / 超时
 *
 * @param {string} method - HTTP 方法（POST / GET）
 * @param {string} url - 请求地址
 * @param {Object} headers - 请求头
 * @param {Object} [bodyObj] - 请求体对象（将被 JSON.stringify）
 * @param {number} [timeout=60000] - 超时毫秒
 * @returns {Promise<{ok:boolean, json?:Object, raw?:string, error?:string}>}
 */
async function _requestJson(method, url, headers, bodyObj, timeout = 60000) {
    const bodyStr = bodyObj ? JSON.stringify(bodyObj) : '';

    let raw = '';
    let status = 0;

    // 1. 油猴环境：GM_xmlhttpRequest
    if (typeof GM_xmlhttpRequest !== 'undefined') {
        try {
            const r = await _gmRequest(method, url, headers, bodyStr, timeout);
            status = r.status;
            raw = r.body;
        } catch (e) {
            return { ok: false, error: e && e.message || String(e) };
        }
    } else if (Platform && Platform.isWebView && Platform.bridgeAvailable) {
        // 2. WebView 环境：Platform.http()
        try {
            const r = await Platform.http(method, url, headers, bodyStr);
            status = r.status || 200;
            raw = typeof r.body === 'string' ? r.body : (r.body == null ? '' : String(r.body));
        } catch (e) {
            return { ok: false, error: 'Platform.http 失败：' + (e && e.message || String(e)) };
        }
    } else {
        // 3. Web 环境：fetch（可能 CORS 失败）
        try {
            const r = await _webFetch(method, url, headers, bodyStr, timeout);
            status = r.status;
            raw = r.body;
        } catch (e) {
            return { ok: false, error: e && e.message || String(e) };
        }
    }

    // 状态码错误分类
    if (status < 200 || status >= 300) {
        return { ok: false, error: classifyHttpError(status, raw), raw: raw.slice(0, 1000) };
    }

    // 解析 JSON
    let json = null;
    try {
        json = JSON.parse(raw);
    } catch (e) {
        return { ok: false, error: '响应非合法 JSON：' + (e && e.message || String(e)), raw: raw.slice(0, 1000) };
    }
    return { ok: true, json, raw };
}

/**
 * 油猴环境通过 GM_xmlhttpRequest 发起请求
 *
 * @param {string} method - HTTP 方法
 * @param {string} url - 请求地址
 * @param {Object} headers - 请求头
 * @param {string} body - 请求体字符串
 * @param {number} timeout - 超时毫秒
 * @returns {Promise<{status:number, body:string}>}
 */
function _gmRequest(method, url, headers, body, timeout) {
    return new Promise((resolve, reject) => {
        const opts = {
            method,
            url,
            headers,
            timeout,
            onload(res) {
                resolve({ status: res.status || 200, body: res.responseText || '' });
            },
            onerror(err) {
                reject(new Error('网络错误：' + (err && err.error ? err.error : 'request failed')));
            },
            ontimeout() {
                reject(new Error('请求超时（' + timeout + 'ms）'));
            }
        };
        if (method.toUpperCase() !== 'GET' && body) {
            opts.data = body;
        }
        try {
            GM_xmlhttpRequest(opts);
        } catch (e) {
            reject(new Error('GM_xmlhttpRequest 调用失败：' + (e && e.message || String(e))));
        }
    });
}

/**
 * Web 环境通过 fetch 发起请求（可能 CORS 失败）
 *
 * @param {string} method - HTTP 方法
 * @param {string} url - 请求地址
 * @param {Object} headers - 请求头
 * @param {string} body - 请求体字符串
 * @param {number} timeout - 超时毫秒
 * @returns {Promise<{status:number, body:string}>}
 */
async function _webFetch(method, url, headers, body, timeout) {
    const controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeout) : null;
    try {
        const fetchOpts = {
            method,
            headers,
            credentials: 'omit',
            mode: 'cors'
        };
        if (method.toUpperCase() !== 'GET' && body) {
            fetchOpts.body = body;
        }
        const res = await fetch(url, fetchOpts);
        const text = await res.text();
        return { status: res.status, body: text };
    } catch (e) {
        const msg = (e && e.name === 'AbortError')
            ? '请求超时（' + timeout + 'ms）'
            : 'fetch 失败（可能是 CORS）：' + (e && e.message || String(e));
        throw new Error(msg);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

/**
 * 根据 HTTP 状态码分类错误信息
 *
 * @param {number} status - HTTP 状态码
 * @param {string} raw - 原始响应体（用于提取服务端错误消息）
 * @returns {string} 错误描述
 */
function classifyHttpError(status, raw) {
    if (status === 401 || status === 403) {
        return 'API Key 无效或已过期（HTTP ' + status + '），请检查多模态设置中的 Key';
    }
    if (status === 429) {
        return '请求被限流（HTTP 429），请稍后重试或降低请求频率';
    }
    if (status >= 500) {
        return '服务端错误（HTTP ' + status + '），请稍后重试';
    }
    if (status === 404) {
        return '接口或模型不存在（HTTP 404），请检查 baseUrl / model 配置';
    }
    // 尝试从响应体提取错误消息
    let detail = '';
    try {
        const j = JSON.parse(raw);
        if (j && j.error && j.error.message) detail = j.error.message;
        else if (j && j.message) detail = j.message;
    } catch (e) {}
    return '请求失败（HTTP ' + status + '）' + (detail ? '：' + detail : '');
}
