/**
 * Web 工具模块（web_search / web_fetch）
 *
 * 模块职责：
 *   1. 提供 web_search 工具：经跨域请求抓取 DuckDuckGo / Bing HTML 搜索结果，
 *      用 DOMParser 解析为结构化数据（标题/URL/摘要），返回前 5-10 条
 *   2. 提供 web_fetch 工具：经跨域请求抓取目标 URL，提取可见正文文本，
 *      按站点白名单授权，截断到可配置长度
 *   3. 暴露 initWebTools() 幂等初始化，合并本模块的 CONFIG 默认值
 *   4. 暴露 executeWebSearch / executeWebFetch 供 capability-register 调用
 *
 * 跨环境请求策略（按优先级）：
 *   - 篡改猴环境：使用 GM_xmlhttpRequest（可跨域，无 CORS 限制）
 *   - WebView / Tauri 环境：使用 Platform.http() 调用原生网络栈（绕过 CORS）
 *   - Web 环境（兜底）：使用 fetch（很可能 CORS 失败，需 try-catch）
 *
 * 与 capability-register 的协作：
 *   - 本模块仅实现工具执行器，不在 capability-register 中注册（Phase 1.4 统一注册）
 *   - 返回结构化对象 { ok, results?, error?, raw? }，由集成层决定序列化方式
 *
 * CONFIG 默认值（Phase 6 会统一集成到 config.js）：
 *   - webToolsEnabled (bool, 默认 false)：总开关
 *   - webSearchEnabled (bool, 默认 true)：搜索开关
 *   - webFetchEnabled (bool, 默认 true)：抓取开关
 *   - webFetchAllowedSites (string[], 默认 [])：web_fetch 站点白名单
 *   - webFetchMaxLength (number, 默认 8000)：web_fetch 文本截断长度
 */
import { CONFIG as _CONFIG_SNAPSHOT } from '../config.js';
import { Platform } from '../platform/bridge.js';

// ============================================================
// CONFIG 默认值声明
// ============================================================

/**
 * 本模块新增的 CONFIG 默认值
 *
 * 不直接修改 config.js 的 DEFAULTS，而是在 initWebTools() 中合并到运行时 CONFIG 对象。
 * Phase 6 统一集成时会迁移到 config.js 的 DEFAULTS 中。
 *
 * @type {Object}
 */
const WEB_TOOLS_DEFAULTS = {
    webToolsEnabled: true,
    webSearchEnabled: true,
    webFetchEnabled: true,
    webFetchAllowedSites: [],
    webFetchMaxLength: 8000
};

/** 模块是否已初始化（幂等保护） */
let installed = false;

// ============================================================
// CONFIG 安全读取
// ============================================================

/**
 * 安全获取最新的 CONFIG 引用，并合并本模块的默认值
 *
 * 优先读 window.__dsConfig（saveConfig 时会同步更新），
 * 回退到静态导入的 _CONFIG_SNAPSHOT。
 *
 * @returns {Object} 合并了 WEB_TOOLS_DEFAULTS 的配置对象
 */
function _getConfigSafe() {
    let cfg;
    try {
        if (typeof window !== 'undefined' && window.__dsConfig) {
            cfg = window.__dsConfig;
        } else {
            cfg = _CONFIG_SNAPSHOT;
        }
    } catch (e) {
        cfg = _CONFIG_SNAPSHOT;
    }
    if (!cfg || typeof cfg !== 'object') cfg = {};
    // 合并本模块默认值（不覆盖用户已设置的值）
    const merged = { ...WEB_TOOLS_DEFAULTS, ...cfg };
    return merged;
}

// ============================================================
// 跨域请求封装
// ============================================================

/**
 * 跨域 HTTP GET 请求（按环境选择最优通道）
 *
 * 优先级：
 *   1. 油猴环境：GM_xmlhttpRequest（可跨域）
 *   2. WebView 环境：Platform.http()（调原生网络栈）
 *   3. Web 环境：fetch（可能 CORS 失败）
 *
 * GM_xmlhttpRequest 检测采用三层策略（参考 mcp/transports/common.js 的 getGmXhr）：
 *   - 裸标识符 GM_xmlhttpRequest（标准油猴沙箱注入）
 *   - unsafeWindow.GM_xmlhttpRequest（部分手机油猴注入到 unsafeWindow）
 *   - window.GM_xmlhttpRequest（IIFE 重定向后 window 已绑定 unsafeWindow）
 * 手机端某些油猴实现（Userscripts iOS / XBrowser / 部分 Violentmonkey）
 * 将 GM API 注入到 unsafeWindow 而非沙箱全局，单层裸标识符检测会漏检，
 * 导致误走 fetch 通道触发 CORS 失败。
 *
 * @param {string} url - 请求地址
 * @param {Object} [opts] - 请求选项
 * @param {Object} [opts.headers] - 自定义请求头
 * @param {number} [opts.timeout=15000] - 超时毫秒数
 * @param {string} [opts.responseType='text'] - 响应类型（text | json）
 * @returns {Promise<{status: number, body: string, headers: Object}>} 响应对象
 * @throws {Error} 请求失败时抛出
 */
function _requestUrl(url, opts = {}) {
    const headers = opts.headers || {};
    const timeout = typeof opts.timeout === 'number' ? opts.timeout : 15000;
    const responseType = opts.responseType || 'text';

    // 日志输出完整 URL 和长度（之前的 slice(0, 80) 会截断 URL 导致调试困难）
    console.log('[web-tools] _requestUrl:', { url, urlLength: url.length, channel: '' });

    // 1. 油猴环境：GM_xmlhttpRequest（可跨域）— 三层检测
    const gmXhr = _getGmXhr();
    if (gmXhr) {
        console.log('[web-tools] 使用 GM_xmlhttpRequest 通道（完整 URL 见上）');
        return _gmFetch(gmXhr, url, headers, timeout, responseType);
    }
    // 2. WebView 或 Electron 环境：使用原生网络通道绕过 CORS
    if (Platform && (Platform.isWebView || Platform.isElectron) && typeof Platform.http === 'function') {
        console.log('[web-tools] 使用 Platform.http 通道（完整 URL 见上）');
        return Platform.http('GET', url, headers, '').then(r => ({
            status: r.status || 200,
            body: typeof r.body === 'string' ? r.body : (r.body == null ? '' : String(r.body)),
            headers: r.headers || {}
        }));
    }
    // 3. Web 环境：fetch（很可能 CORS 失败）
    console.warn('[web-tools] GM_xmlhttpRequest 不可用，降级到 fetch（可能 CORS 失败）');
    return _webFetch(url, headers, timeout);
}

/**
 * 安全获取 GM_xmlhttpRequest 函数引用（三层检测）
 *
 * 检测顺序（参考 mcp/transports/common.js 的 getGmXhr）：
 *   1. 裸标识符 GM_xmlhttpRequest（标准油猴沙箱注入，typeof 检测）
 *   2. unsafeWindow.GM_xmlhttpRequest（部分手机油猴注入到 unsafeWindow）
 *   3. window.GM_xmlhttpRequest（IIFE 重定向后 window 已绑定 unsafeWindow）
 *
 * 手机端某些油猴实现将 GM API 注入到 unsafeWindow 而非沙箱全局，
 * 单层裸标识符检测会漏检，导致误走 fetch 通道触发 CORS 失败。
 *
 * @returns {Function|null} GM_xmlhttpRequest 函数引用；不可用时返回 null
 */
function _getGmXhr() {
    // 1. 裸标识符检测（标准油猴沙箱注入）
    try {
        if (typeof GM_xmlhttpRequest !== 'undefined' && typeof GM_xmlhttpRequest === 'function') {
            return GM_xmlhttpRequest;
        }
    } catch (e) {}
    // 2. unsafeWindow 检测（部分手机油猴注入到 unsafeWindow）
    try {
        if (typeof unsafeWindow !== 'undefined' && unsafeWindow.GM_xmlhttpRequest) {
            return unsafeWindow.GM_xmlhttpRequest;
        }
    } catch (e) {}
    // 3. window 检测（IIFE 重定向后 window 已绑定 unsafeWindow，兜底）
    try {
        if (typeof window !== 'undefined' && window.GM_xmlhttpRequest) {
            return window.GM_xmlhttpRequest;
        }
    } catch (e) {}
    return null;
}

/**
 * 油猴环境通过 GM_xmlhttpRequest 发起请求
 *
 * @param {Function} gmXhr - GM_xmlhttpRequest 函数引用（由 _getGmXhr 获取）
 * @param {string} url - 请求地址
 * @param {Object} headers - 请求头
 * @param {number} timeout - 超时毫秒
 * @param {string} responseType - 响应类型
 * @returns {Promise<{status: number, body: string, headers: Object}>}
 */
function _gmFetch(gmXhr, url, headers, timeout, responseType) {
    return new Promise((resolve, reject) => {
        // 调试日志：输出传给 GM_xmlhttpRequest 的完整 URL 和长度
        console.log('[web-tools] _gmFetch 传入 URL:', { url, length: url.length });
        const reqOpts = {
            method: 'GET',
            url,
            headers,
            timeout,
            onload(res) {
                // 调试日志：输出 GM_xmlhttpRequest 实际请求的最终 URL（可能被重定向）
                console.log('[web-tools] _gmFetch 响应:', {
                    status: res.status || 200,
                    finalUrl: res.finalUrl || '(无 finalUrl)',
                    responseTextLength: (res.responseText || '').length
                });
                resolve({
                    status: res.status || 200,
                    body: res.responseText || '',
                    headers: _parseResponseHeaders(res.responseHeaders)
                });
            },
            onerror(err) {
                reject(new Error('GM_xmlhttpRequest error: ' + (err && err.error ? err.error : 'network error')));
            },
            ontimeout() {
                reject(new Error('GM_xmlhttpRequest timeout after ' + timeout + 'ms'));
            }
        };
        try {
            gmXhr(reqOpts);
        } catch (e) {
            reject(new Error('GM_xmlhttpRequest call failed: ' + (e && e.message || String(e))));
        }
    });
}

/**
 * Web 环境通过 fetch 发起请求（可能 CORS 失败）
 *
 * 降级策略：
 *   1. 优先 cors 模式（可获取完整响应，但需要目标站点配合 CORS 头）
 *   2. cors 失败时降级到 no-cors 模式（响应不可读，但可用于检测站点可达性）
 *   3. no-cors 仍失败时抛出明确错误，提示用户在油猴环境使用或配置代理
 *
 * @param {string} url - 请求地址
 * @param {Object} headers - 请求头
 * @param {number} timeout - 超时毫秒
 * @returns {Promise<{status: number, body: string, headers: Object}>}
 */
async function _webFetch(url, headers, timeout) {
    const controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeout) : null;
    try {
        // 1. 优先 cors 模式
        const res = await fetch(url, {
            method: 'GET',
            headers,
            signal: controller ? controller.signal : undefined,
            credentials: 'omit',
            mode: 'cors'
        });
        const body = await res.text();
        const respHeaders = {};
        res.headers.forEach((v, k) => { respHeaders[k] = v; });
        return { status: res.status, body, headers: respHeaders };
    } catch (corsErr) {
        // 2. cors 失败：如果是 AbortError（超时），直接抛出
        if (corsErr && corsErr.name === 'AbortError') {
            throw new Error('fetch timeout after ' + timeout + 'ms');
        }
        // 3. 降级到 no-cors 模式（仅用于检测可达性，无法读取响应体）
        console.warn('[web-tools] cors 模式失败，降级到 no-cors（无法读取响应体）:', corsErr && corsErr.message);
        try {
            const noCorsRes = await fetch(url, {
                method: 'GET',
                mode: 'no-cors',
                credentials: 'omit',
                signal: controller ? controller.signal : undefined
            });
            // no-cors 模式下 response.type === 'opaque'，无法读取 body 和 status
            // 返回提示信息让 AI 知道站点可达但内容不可读
            return {
                status: 200,
                body: '[站点 ' + new URL(url).hostname + ' 可达但启用了 CORS 限制，无法读取响应内容。建议：1) 在油猴环境使用 web_fetch（GM_xmlhttpRequest 可绕过 CORS）；2) 通过 web_search 获取该站点信息；3) 提示用户配置代理或在设置中允许该站点]',
                headers: { 'content-type': 'text/plain' }
            };
        } catch (noCorsErr) {
            if (noCorsErr && noCorsErr.name === 'AbortError') {
                throw new Error('fetch timeout after ' + timeout + 'ms');
            }
            // 4. 两种模式都失败，抛出明确错误
            throw new Error('fetch failed (CORS and no-cors both failed): ' +
                (noCorsErr && noCorsErr.message || String(noCorsErr)) +
                '。建议在油猴环境使用 web_fetch（GM_xmlhttpRequest 可绕过 CORS），或提示用户配置代理');
        }
    } finally {
        if (timer) clearTimeout(timer);
    }
}

/**
 * 解析 GM_xmlhttpRequest 的 responseHeaders 字符串为对象
 *
 * @param {string} headerStr - 原始响应头字符串（\r\n 分隔）
 * @returns {Object} 头字段对象（key 小写）
 */
function _parseResponseHeaders(headerStr) {
    const out = {};
    if (!headerStr || typeof headerStr !== 'string') return out;
    const lines = headerStr.split(/\r?\n/);
    for (const line of lines) {
        const idx = line.indexOf(':');
        if (idx <= 0) continue;
        const key = line.slice(0, idx).trim().toLowerCase();
        const val = line.slice(idx + 1).trim();
        if (key) out[key] = val;
    }
    return out;
}

// ============================================================
// DOMParser 安全访问
// ============================================================

/**
 * 获取 DOMParser 实例（容错：浏览器环境一定存在，WebView 也支持）
 *
 * @returns {DOMParser|null}
 */
function _getDOMParser() {
    if (typeof DOMParser === 'undefined') return null;
    try {
        return new DOMParser();
    } catch (e) {
        return null;
    }
}

// ============================================================
// web_search 工具实现
// ============================================================

/**
 * 执行 web 搜索（Bing HTML）
 *
 * 调用流程：
 *   1. 校验 query 非空
 *   2. 检查 CONFIG.webSearchEnabled 开关
 *   3. 主源：Bing HTML（cn.bing.com 优先，www.bing.com 备用，双域名 fallback）
 *   4. 返回结构化结果数组（标题/URL/摘要），条数由 topK 决定
 *
 * topK 突破 10 条的翻页策略：
 *   - Bing 单页最多返回 10 条结果，超过 10 条时通过 first 参数翻页
 *   - first=1（第 1 页，1-10 条）、first=11（第 2 页，11-20 条）、first=21（第 3 页，21-30 条）
 *   - first 是 Bing 标准翻页参数（指定从第几条结果开始），不影响查询词编码，
 *     不会触发 count 参数导致的查询词截断 bug
 *   - 翻页时顺序请求每页，合并结果后按 topK 截取
 *   - 某一页失败时返回已收集的结果（部分结果优于完全失败）
 *
 * 注意：本函数不再接受 limit 参数（limit 会被拼入 count 参数触发截断 bug）。
 *       topK 仅用于控制最终返回条数，通过翻页实现，不会拼入 count 参数。
 *
 * @param {string} query - 搜索关键词
 * @param {Object} [options] - 可选参数
 * @param {number} [options.topK=10] - 期望返回的结果条数（1-30，超过 10 会翻页）
 * @returns {Promise<{ok: boolean, results?: Array<{title:string,url:string,snippet:string}>, error?: string, raw?: string}>}
 */
export async function executeWebSearch(query, options = {}) {
    // 1. 参数校验
    if (typeof query !== 'string' || !query.trim()) {
        return { ok: false, error: 'query 不能为空' };
    }
    const q = query.trim();
    const cfg = _getConfigSafe();

    // 2. 开关检查（webToolsEnabled 是总开关；webSearchEnabled 是子开关）
    if (!cfg.webToolsEnabled) {
        return { ok: false, error: 'Web 工具未启用，请前往设置页开启 webToolsEnabled' };
    }
    if (!cfg.webSearchEnabled) {
        return { ok: false, error: 'web_search 工具未启用（webSearchEnabled=false）' };
    }

    // 3. 计算 topK（1-30，默认 10）
    const topK = (typeof options.topK === 'number' && Number.isFinite(options.topK))
        ? Math.min(Math.max(1, Math.floor(options.topK)), 30)
        : 10;

    // 4. 主源：Bing HTML（双域名 fallback + 翻页合并）
    const bingDomains = ['cn.bing.com', 'www.bing.com'];
    let lastBingError = null;
    for (let i = 0; i < bingDomains.length; i++) {
        try {
            const bingResult = await _searchBingPaginated(q, bingDomains[i], topK);
            if (bingResult && bingResult.ok && bingResult.results && bingResult.results.length > 0) {
                return bingResult;
            }
            lastBingError = bingResult ? bingResult.error : 'no result';
        } catch (e) {
            lastBingError = e && e.message || String(e);
        }
    }

    // 5. 全部失败
    return {
        ok: false,
        error: 'Bing 搜索失败：' + lastBingError
    };
}

/**
 * Bing 搜索翻页聚合器（支持 topK > 10 时多页请求合并）
 *
 * 翻页策略：
 *   - topK <= 10：单次请求（first=1 不写入 URL，保持 URL 最简）
 *   - topK > 10：按页请求，每页 10 条，first=1/11/21/...
 *   - 某一页返回 0 条结果时停止翻页（避免无效请求）
 *   - 某一页失败时返回已收集的结果（部分结果优于完全失败）
 *
 * @param {string} query - 已 trim 的搜索关键词
 * @param {string} domain - Bing 搜索域名
 * @param {number} topK - 期望返回的结果条数（1-30）
 * @returns {Promise<{ok: boolean, results: Array, raw?: string, error?: string}>}
 */
async function _searchBingPaginated(query, domain, topK) {
    // topK <= 10 时单次请求，不写入 first 参数（保持 URL 最简，符合原约束）
    if (topK <= 10) {
        return _searchBing(query, domain, topK);
    }

    // topK > 10 时翻页合并
    const allResults = [];
    let allRaw = '';
    const totalPages = Math.ceil(topK / 10);
    let first = 1;

    for (let page = 0; page < totalPages; page++) {
        try {
            const pageResult = await _searchBing(query, domain, 10, first);
            if (pageResult.ok && pageResult.results && pageResult.results.length > 0) {
                allResults.push(...pageResult.results);
                if (pageResult.raw) allRaw += pageResult.raw;
                // 本页结果不足 10 条，说明已是最后一页，停止翻页
                if (pageResult.results.length < 10) break;
            } else {
                // 本页失败：若已收集到结果则返回部分结果，否则继续下一页
                if (allResults.length > 0) break;
            }
        } catch (e) {
            // 异常：若已收集到结果则返回部分结果，否则抛出
            if (allResults.length > 0) break;
            throw e;
        }
        first += 10;
    }

    if (allResults.length === 0) {
        return { ok: false, error: 'Bing(' + domain + ') 未解析到结果', raw: allRaw };
    }

    // 按 topK 截取，去重（翻页时偶尔会重复）
    const seen = new Set();
    const deduped = [];
    for (const r of allResults) {
        if (deduped.length >= topK) break;
        if (seen.has(r.url)) continue;
        seen.add(r.url);
        deduped.push(r);
    }

    console.log('[web-tools] web_search 翻页合并：共请求 ' + Math.ceil(topK / 10) + ' 页，收集 ' + allResults.length + ' 条，去重后 ' + deduped.length + ' 条');
    return { ok: true, results: deduped, raw: allRaw };
}

/**
 * 通过 Bing HTML 接口搜索（主源，支持双域名 fallback 和翻页）
 *
 * 请求 https://<domain>/search?q=<encoded>&first=<first>，
 * 解析 .b_algo 节点提取标题、URL、摘要。
 *
 * 域名策略：
 *   - cn.bing.com：国内必应，国内访问稳定且返回中文结果
 *   - www.bing.com：国际必应，作为 cn 失败时的备用
 *
 * 翻页策略（first 参数）：
 *   - first 是 Bing 标准翻页参数，指定从第几条结果开始返回
 *   - first=1（默认，第 1 页，1-10 条）、first=11（第 2 页，11-20 条）
 *   - first 不会触发 count 参数的查询词截断 bug（first 是独立的偏移参数）
 *   - first=1 时不写入 URL，保持 URL 最简（与原约束一致）
 *
 * URL 参数约束（严格）：
 *   - 只允许 q 和 first 两个参数
 *   - 禁止添加 count、setlang 等任何其他参数（会触发查询词截断 bug）
 *
 * @param {string} query - 已 trim 的搜索关键词
 * @param {string} [domain='cn.bing.com'] - Bing 搜索域名
 * @param {number} [topK=10] - 本页期望返回的结果条数（1-10）
 * @param {number} [first=1] - 翻页偏移量（1=第 1 页，11=第 2 页，21=第 3 页）
 * @returns {Promise<{ok: boolean, results: Array, raw?: string, error?: string}>}
 */
async function _searchBing(query, domain = 'cn.bing.com', topK = 10, first = 1) {
    // 本页截取条数（Bing 单页最多 10 条）
    const MAX_RESULTS = Math.min(topK, 10);

    // 使用 URL API 构建 URL
    //
    // 重要：只允许 q 和 first 两个参数！
    //   - count 参数会触发 Bing 查询词截断 bug（长查询词被截断，返回错误结果）
    //   - setlang 等参数也可能影响查询词的编码处理
    //   - first 是翻页偏移量，不会影响查询词编码
    //
    // first=1（默认）时不写入 URL，保持 URL 最简（与原约束一致）
    const urlObj = new URL('https://' + domain + '/search');
    urlObj.searchParams.set('q', query);
    if (first && first > 1) {
        urlObj.searchParams.set('first', String(first));
    }
    const url = urlObj.toString();
    console.log('[web-tools] web_search 请求:', { domain, query, url, urlLength: url.length, first });
    const res = await _requestUrl(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
        },
        timeout: 8000
    });

    console.log('[web-tools] web_search 响应:', {
        domain,
        status: res ? res.status : 'null',
        bodyLength: res && res.body ? res.body.length : 0,
        first
    });

    if (!res || !res.body) {
        return { ok: false, error: 'Bing(' + domain + ') 响应为空', raw: '' };
    }
    // 反爬检测：响应过短通常是拦截页
    if (res.body.length < 200) {
        console.warn('[web-tools] Bing(' + domain + ') 响应过短，可能被拦截，前 200 字符:', res.body.slice(0, 200));
        return { ok: false, error: 'Bing(' + domain + ') 响应过短（' + res.body.length + ' 字节），可能被拦截', raw: res.body };
    }

    const parser = _getDOMParser();
    if (!parser) {
        return { ok: false, error: 'DOMParser 不可用', raw: res.body };
    }

    const doc = parser.parseFromString(res.body, 'text/html');
    const results = [];

    // Bing 搜索结果节点：.b_algo
    const nodes = doc.querySelectorAll('.b_algo');
    nodes.forEach(node => {
        if (results.length >= MAX_RESULTS) return;
        // 标题：h2 > a（Bing 标准结构）；兼容多种 a 选择器
        const titleEl = node.querySelector('h2 a, h2 a.tilk, a.tilk, h2 a');
        // 摘要：.b_caption 内的 p / .b_lineclamp* / .b_paractl
        const snippetEl = node.querySelector('.b_caption p, p.b_lineclamp2, p.b_lineclamp3, p.b_lineclamp4, .b_caption .b_paractl, .b_caption p');
        if (!titleEl) return;
        const title = (titleEl.textContent || '').trim();
        let href = titleEl.getAttribute('href') || '';
        // 协议相对 URL 补全
        if (href.startsWith('//')) href = 'https:' + href;
        if (!title || !href) return;
        const snippet = (snippetEl ? (snippetEl.textContent || '') : '').trim();
        results.push({ title, url: href, snippet });
    });

    if (results.length === 0) {
        console.warn('[web-tools] Bing(' + domain + ') 未解析到结果，响应前 500 字符:', res.body.slice(0, 500));
        return { ok: false, error: 'Bing(' + domain + ') 未解析到结果', raw: res.body };
    }
    console.log('[web-tools] web_search 解析到 ' + results.length + ' 条结果（first=' + first + '）:', results.map(r => r.title).join(' | '));
    return { ok: true, results, raw: res.body };
}

// ============================================================
// web_fetch 工具实现
// ============================================================

/**
 * 执行 web 抓取（提取目标 URL 的可见正文文本）
 *
 * 调用流程：
 *   1. 校验 url 合法且为 http(s)
 *   2. 检查 CONFIG.webFetchEnabled 开关
 *   3. 站点授权：从 CONFIG.webFetchAllowedSites 读域名白名单，
 *      未授权时返回提示让 Agent 告知用户去设置页授权
 *   4. 跨域请求抓取目标 URL
 *   5. 用 DOMParser 解析，去除 script/style/nav/footer/header 等噪声节点
 *   6. 提取可见文本，截断到 CONFIG.webFetchMaxLength
 *
 * @param {string} url - 目标 URL
 * @param {Object} [options] - 可选参数
 * @param {number} [options.maxLength] - 文本截断长度（覆盖 CONFIG.webFetchMaxLength）
 * @returns {Promise<{ok: boolean, content?: string, title?: string, url?: string, error?: string, raw?: string}>}
 */
export async function executeWebFetch(url, options = {}) {
    // 1. 参数校验
    if (typeof url !== 'string' || !url.trim()) {
        return { ok: false, error: 'url 不能为空' };
    }
    let target;
    try {
        target = new URL(url.trim());
    } catch (e) {
        return { ok: false, error: 'url 格式无效：' + (e && e.message || String(e)) };
    }
    if (target.protocol !== 'http:' && target.protocol !== 'https:') {
        return { ok: false, error: '仅支持 http/https 协议' };
    }

    const cfg = _getConfigSafe();

    // 2. 开关检查
    if (!cfg.webToolsEnabled) {
        return { ok: false, error: 'Web 工具未启用，请前往设置页开启 webToolsEnabled' };
    }
    if (!cfg.webFetchEnabled) {
        return { ok: false, error: 'web_fetch 工具未启用（webFetchEnabled=false）' };
    }

    // 3. 站点授权检查
    // 策略：白名单为空时默认允许所有站点（开箱即用），用户主动添加规则时才限制
    const host = target.hostname.replace(/^www\./, '');
    const allowed = Array.isArray(cfg.webFetchAllowedSites) ? cfg.webFetchAllowedSites : [];
    if (allowed.length > 0) {
        const matched = allowed.some(rule => _matchSiteRule(host, rule));
        if (!matched) {
            return {
                ok: false,
                error: '站点 ' + host + ' 未在授权白名单中。请告知用户前往设置页"web_fetch 允许的站点"添加该域名（当前已授权：' +
                    allowed.join(', ') + '）'
            };
        }
    }

    // 4. 计算截断长度
    const maxLen = (typeof options.maxLength === 'number' && options.maxLength > 0)
        ? Math.floor(options.maxLength)
        : (typeof cfg.webFetchMaxLength === 'number' && cfg.webFetchMaxLength > 0
            ? cfg.webFetchMaxLength
            : 8000);

    // 5. 跨域抓取
    let res;
    try {
        res = await _requestUrl(target.href, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
            },
            timeout: 20000
        });
    } catch (e) {
        return { ok: false, error: '请求失败：' + (e && e.message || String(e)) };
    }

    if (!res || !res.body) {
        return { ok: false, error: '响应体为空（status=' + (res && res.status) + '）' };
    }

    // 非 2xx 视为失败（但仍返回部分信息便于调试）
    if (res.status && (res.status < 200 || res.status >= 300)) {
        return {
            ok: false,
            error: 'HTTP 状态码 ' + res.status,
            raw: res.body.slice(0, 500)
        };
    }

    // 6. 解析并提取可见文本
    const parser = _getDOMParser();
    if (!parser) {
        // DOMParser 不可用时直接截断原文
        return {
            ok: true,
            content: res.body.slice(0, maxLen),
            title: '',
            url: target.href,
            raw: res.body
        };
    }

    // 判断 Content-Type：非 HTML 时直接返回原文（如 JSON API、纯文本）
    const ct = (res.headers['content-type'] || res.headers['Content-Type'] || '').toLowerCase();
    const isHtml = ct.includes('text/html') || ct.includes('application/xhtml') || ct === '' || ct.includes('text/plain');
    if (!isHtml) {
        return {
            ok: true,
            content: res.body.slice(0, maxLen),
            title: '',
            url: target.href,
            raw: res.body
        };
    }

    const doc = parser.parseFromString(res.body, 'text/html');

    // 移除噪声节点：script / style / nav / footer / header / aside / noscript / iframe / svg / form
    const noiseSelectors = [
        'script', 'style', 'noscript', 'iframe', 'svg', 'form',
        'nav', 'footer', 'header', 'aside',
        '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]',
        '[aria-hidden="true"]',
        '.ad', '.ads', '.advertise', '.advertisement', '.sidebar', '.menu', '.breadcrumb',
        '.cookie', '.cookie-banner', '.consent', '.gdpr',
        '.share', '.social', '.related', '.recommend', '.comments', '.comment'
    ];
    for (const sel of noiseSelectors) {
        const els = doc.querySelectorAll(sel);
        els.forEach(el => el.remove());
    }

    // 提取标题
    const titleEl = doc.querySelector('title');
    const title = titleEl ? (titleEl.textContent || '').trim() : '';

    // 优先提取 <main> / <article> / [role=main]；否则回退到 <body>
    let root = doc.querySelector('main, article, [role="main"], #content, .content, .post, .article');
    if (!root) root = doc.body || doc.documentElement;

    // 提取可见文本：遍历文本节点，过滤空白和不可见元素
    const text = _extractVisibleText(root);
    const truncated = text.length > maxLen ? text.slice(0, maxLen) + '\n...[已截断，原始长度 ' + text.length + ' 字符]' : text;

    return {
        ok: true,
        content: truncated,
        title,
        url: target.href,
        raw: res.body
    };
}

/**
 * 判断 host 是否匹配站点白名单规则
 *
 * 规则格式：
 *   - 精确域名：example.com（匹配 example.com，不匹配 a.example.com）
 *   - 通配子域：*.example.com（匹配 a.example.com、b.example.com，不匹配 example.com）
 *   - 简单后缀：example.com（也匹配 www.example.com，去 www 后比较）
 *
 * @param {string} host - 已去 www 的目标主机名
 * @param {string} rule - 白名单规则
 * @returns {boolean} 是否匹配
 */
function _matchSiteRule(host, rule) {
    if (typeof rule !== 'string') return false;
    const r = rule.trim().toLowerCase();
    if (!r) return false;
    const h = host.toLowerCase();
    // 通配子域：*.example.com
    if (r.startsWith('*.')) {
        const base = r.slice(2);
        return h === base || h.endsWith('.' + base);
    }
    // 精确匹配或后缀匹配
    return h === r || h.endsWith('.' + r);
}

/**
 * 从 DOM 根节点提取可见文本
 *
 * 规则：
 *   - 跳过 display:none / visibility:hidden / hidden 属性的元素
 *   - 块级元素之间补换行，保持文本结构
 *   - 折叠多余空白
 *
 * @param {Element} root - 根元素
 * @returns {string} 提取的可见文本
 */
function _extractVisibleText(root) {
    if (!root) return '';
    const blockTags = new Set([
        'div', 'p', 'br', 'li', 'ul', 'ol', 'section', 'article', 'main',
        'header', 'footer', 'aside', 'nav', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
        'blockquote', 'pre', 'table', 'tr', 'td', 'th', 'tbody', 'thead',
        'figure', 'figcaption', 'hr', 'address', 'details', 'summary'
    ]);

    const parts = [];
    /**
     * 递归遍历节点，收集文本
     * @param {Node} node
     */
    function walk(node) {
        if (!node) return;
        if (node.nodeType === Node.TEXT_NODE) {
            const t = node.nodeValue;
            if (t && t.trim()) {
                parts.push(t.replace(/\s+/g, ' '));
            }
            return;
        }
        if (node.nodeType !== Node.ELEMENT_NODE) return;

        const el = /** @type {Element} */ (node);
        const tag = el.tagName.toLowerCase();
        // 跳过隐藏元素
        if (el.hasAttribute('hidden')) return;
        const style = el.getAttribute('style') || '';
        if (/display\s*:\s*none/i.test(style)) return;
        if (/visibility\s*:\s*hidden/i.test(style)) return;

        // 子节点遍历
        for (let i = 0; i < el.childNodes.length; i++) {
            walk(el.childNodes[i]);
        }
        // 块级元素结尾补换行
        if (blockTags.has(tag)) {
            parts.push('\n');
        }
    }

    walk(root);

    // 合并并折叠多余空白
    return parts.join('')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

// ============================================================
// 初始化
// ============================================================

/**
 * 初始化 Web 工具模块（幂等）
 *
 * 执行内容：
 *   1. 将 WEB_TOOLS_DEFAULTS 合并到运行时 CONFIG（不覆盖用户已设置的值）
 *   2. 同步到 window.__dsConfig（与 config.js 的 saveConfig 行为一致）
 *   3. 暴露 executeWebSearch / executeWebFetch 到 window（避免 ES Module 循环依赖）
 *
 * 不修改 localStorage 持久化（Phase 6 统一集成时由 config.js 处理）
 */
export function initWebTools() {
    if (installed) return;
    installed = true;

    // 1. 合并默认值到运行时 CONFIG（不覆盖用户已设置的值）
    try {
        const targetCfg = (typeof window !== 'undefined' && window.__dsConfig) ? window.__dsConfig : _CONFIG_SNAPSHOT;
        if (targetCfg && typeof targetCfg === 'object') {
            let modified = false;
            for (const k of Object.keys(WEB_TOOLS_DEFAULTS)) {
                if (!(k in targetCfg) || targetCfg[k] === undefined) {
                    targetCfg[k] = WEB_TOOLS_DEFAULTS[k];
                    modified = true;
                }
                // 数组类型容错：用户配了非数组则重置为默认
                if (k === 'webFetchAllowedSites' && !Array.isArray(targetCfg[k])) {
                    targetCfg[k] = WEB_TOOLS_DEFAULTS[k];
                    modified = true;
                }
            }
            // 同步到 window.__dsConfig（不调 saveConfig 以免触发持久化）
            if (modified && typeof window !== 'undefined') {
                window.__dsConfig = targetCfg;
            }
        }
    } catch (e) {
        console.warn('[web-tools] init merge defaults failed:', e);
    }

    // 2. 暴露执行器到 window（供 capability-register 集成时调用，避免循环依赖）
    if (typeof window !== 'undefined') {
        if (typeof window._dsExecuteWebSearch !== 'function') {
            window._dsExecuteWebSearch = executeWebSearch;
        }
        if (typeof window._dsExecuteWebFetch !== 'function') {
            window._dsExecuteWebFetch = executeWebFetch;
        }
    }

    if (typeof console !== 'undefined') {
        console.log('[web-tools] initialized');
    }
}
