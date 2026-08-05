/**
 * @file webdav-client.js
 * @module features/sync/webdav-client
 *
 * WebDAV 客户端模块
 *
 * 提供基于 WebDAV 协议的远程存储操作：PUT / GET / DELETE / PROPFIND / MKCOL。
 *
 * 跨域请求策略（按宿主环境降级）：
 *   1. 篡改猴环境：使用 GM_xmlhttpRequest 跨域（无 CORS 限制）
 *   2. Android WebView 环境：调用 Platform.http() 走原生网络栈绕过 CORS
 *   3. 普通网页环境：回退到 fetch（受 CORS 限制，仅同域或允许跨域的服务器可用）
 *
 * 鉴权方式：HTTP Basic Auth（用户名+密码 base64 编码到 Authorization 头）。
 * 密码安全：
 *   - 仅用于生成 Authorization 头，不会被记录到日志
 *   - 不会出现在同步快照中（snapshot 仅含业务数据）
 *   - UTF-8 安全的 base64 编码，支持中文用户名/密码
 *
 * 错误处理：
 *   - 401 未授权：抛出明确的"未授权"错误
 *   - 404 不存在：get/exists 返回 null/false，delete 视为幂等成功
 *   - 409 冲突：PUT 时自动创建目录后重试一次
 *
 * 幂等性：
 *   - PUT 同一文件多次覆盖，不报错
 *   - DELETE 不存在的文件返回 404 也视为成功
 *   - MKCOL 已存在的目录（405/301）不报错
 */

import { Platform } from '../../platform/bridge.js';

// ============================================================
// 内部工具函数
// ============================================================

/**
 * 将字符串进行 UTF-8 安全的 base64 编码
 * 直接 btoa 不支持非 ASCII 字符（如中文用户名/密码），需先 UTF-8 编码
 * @param {string} str - 原始字符串
 * @returns {string} base64 编码字符串
 */
function utf8ToBase64(str) {
    try {
        // 浏览器环境：先 UTF-8 编码再 btoa
        return btoa(unescape(encodeURIComponent(str)));
    } catch (e) {
        // 非浏览器环境回退（如 Node）
        try {
            return Buffer.from(str, 'utf-8').toString('base64');
        } catch (e2) {
            return btoa(str);
        }
    }
}

/**
 * 拼接服务器地址、基础路径与文件名，生成完整 URL
 * 处理重复/缺失的斜杠，保证 URL 合法
 * @param {string} server - WebDAV 服务器地址（如 https://dav.example.com）
 * @param {string} basePath - 远程基础路径（如 /dav/dspro 或 dspro）
 * @param {string} [fileName] - 文件名（可选，不传则返回目录 URL）
 * @returns {string} 完整 URL
 */
function buildUrl(server, basePath, fileName) {
    const base = (server || '').replace(/\/+$/, '');
    const path = (basePath || '').replace(/^\/+|\/+$/g, '');
    if (fileName) {
        const file = fileName.replace(/^\/+/, '');
        return path ? `${base}/${path}/${file}` : `${base}/${file}`;
    }
    return path ? `${base}/${path}` : base;
}

/**
 * 构造 Basic Auth 的 Authorization 头值
 * @param {string} username - 用户名
 * @param {string} password - 密码
 * @returns {string} 形如 "Basic xxxx=="
 */
function buildAuthHeader(username, password) {
    return 'Basic ' + utf8ToBase64(`${username || ''}:${password || ''}`);
}

/**
 * 解析 HTTP 响应头字符串为对象（键统一小写）
 * @param {string} headerStr - 响应头原始字符串
 * @returns {Object} 键值对对象
 */
function _parseResponseHeaders(headerStr) {
    const obj = {};
    if (!headerStr) return obj;
    String(headerStr).split(/\r?\n/).forEach(line => {
        const idx = line.indexOf(':');
        if (idx > 0) {
            const key = line.slice(0, idx).trim().toLowerCase();
            const val = line.slice(idx + 1).trim();
            obj[key] = val;
        }
    });
    return obj;
}

/**
 * 通过 GM_xmlhttpRequest 发起请求（篡改猴环境，可跨域）
 * @param {string} method - HTTP 方法
 * @param {string} url - 完整 URL
 * @param {Object} headers - 请求头对象
 * @param {string} body - 请求体（GET/HEAD 等无 body）
 * @returns {Promise<{status: number, body: string, headers: Object}>}
 */
function gmRequest(method, url, headers, body) {
    return new Promise((resolve, reject) => {
        if (typeof GM_xmlhttpRequest === 'undefined') {
            reject(new Error('GM_xmlhttpRequest 不可用'));
            return;
        }
        GM_xmlhttpRequest({
            method,
            url,
            headers,
            data: body || undefined,
            onload: (resp) => resolve({
                status: resp.status,
                body: resp.responseText || '',
                headers: _parseResponseHeaders(resp.responseHeaders || '')
            }),
            onerror: (err) => reject(new Error('网络错误：' + (err.error || '请求失败'))),
            ontimeout: () => reject(new Error('请求超时')),
            onabort: () => reject(new Error('请求被中止'))
        });
    });
}

/**
 * 通过 Platform.http 发起请求（WebView 环境，走原生网络栈绕过 CORS）
 * @param {string} method - HTTP 方法
 * @param {string} url - 完整 URL
 * @param {Object} headers - 请求头对象
 * @param {string} body - 请求体
 * @returns {Promise<{status: number, body: string, headers: Object}>}
 */
async function platformRequest(method, url, headers, body) {
    const resp = await Platform.http(method, url, headers, body || '');
    return {
        status: resp.status,
        body: resp.body || '',
        headers: resp.headers || {}
    };
}

/**
 * 通过 fetch 发起请求（普通网页环境，受 CORS 限制）
 * @param {string} method - HTTP 方法
 * @param {string} url - 完整 URL
 * @param {Object} headers - 请求头对象
 * @param {string} body - 请求体
 * @returns {Promise<{status: number, body: string, headers: Object}>}
 */
async function fetchRequest(method, url, headers, body) {
    const methodUpper = method.toUpperCase();
    const hasBody = !['GET', 'HEAD', 'PROPFIND', 'OPTIONS'].includes(methodUpper);
    const resp = await fetch(url, {
        method: methodUpper,
        headers,
        body: hasBody ? (body || undefined) : undefined
    });
    const text = await resp.text();
    const hdrs = {};
    resp.headers.forEach((v, k) => { hdrs[k.toLowerCase()] = v; });
    return { status: resp.status, body: text, headers: hdrs };
}

/**
 * 统一的 HTTP 请求入口：按环境选择合适的传输方式
 * 优先级：GM_xmlhttpRequest > Platform.http > fetch
 * @param {string} method - HTTP 方法
 * @param {string} url - 完整 URL
 * @param {Object} [headers={}] - 请求头
 * @param {string} [body=''] - 请求体
 * @returns {Promise<{status: number, body: string, headers: Object}>}
 */
async function request(method, url, headers = {}, body = '') {
    // 1. 篡改猴环境：优先 GM_xmlhttpRequest（可跨域）
    if (typeof GM_xmlhttpRequest !== 'undefined') {
        return gmRequest(method, url, headers, body);
    }
    // 2. WebView 环境：Platform.http 走原生网络栈
    if (Platform && Platform.bridgeAvailable) {
        return platformRequest(method, url, headers, body);
    }
    // 3. 普通网页：fetch 回退（受 CORS 限制）
    return fetchRequest(method, url, headers, body);
}

/**
 * 检查 HTTP 状态码是否表示成功（2xx）
 * @param {number} status - HTTP 状态码
 * @returns {boolean}
 */
function isOk(status) {
    return status >= 200 && status < 300;
}

// ============================================================
// WebDAV 客户端工厂
// ============================================================

/**
 * 创建一个 WebDAV 客户端实例
 *
 * @param {Object} options - 客户端配置
 * @param {string} options.server - WebDAV 服务器地址（如 https://dav.example.com）
 * @param {string} options.username - 用户名
 * @param {string} options.password - 密码
 * @param {string} [options.basePath=''] - 远程基础路径（如 dspro）
 * @returns {{put: Function, get: Function, delete: Function, propfind: Function, mkcol: Function, exists: Function}}
 *   返回客户端对象，包含 put/get/delete/propfind/mkcol/exists 六个方法
 */
export function createWebdavClient({ server, username, password, basePath = '' }) {
    /**
     * 构造带鉴权信息的请求头
     * @param {Object} [extra={}] - 额外的请求头字段
     * @returns {Object} 合并后的请求头对象
     */
    function makeHeaders(extra = {}) {
        return {
            Authorization: buildAuthHeader(username, password),
            ...extra
        };
    }

    /**
     * 拼接完整 URL
     * @param {string} [fileName] - 文件名（可选）
     * @returns {string} 完整 URL
     */
    function url(fileName) {
        return buildUrl(server, basePath, fileName);
    }

    /**
     * 确保基础目录存在（幂等：已存在不报错）
     * 通过 MKCOL 创建目录，已存在时 405/301 视为成功
     * @returns {Promise<void>}
     * @throws {Error} 401 未授权、409 父目录不存在、其他网络错误
     */
    async function ensureBaseDir() {
        const u = url('') + '/';
        const resp = await request('MKCOL', u, makeHeaders());
        // 405 Method Not Allowed / 301 Moved：目录已存在，视为成功
        if (resp.status === 405 || resp.status === 301 || resp.status === 200 || resp.status === 201) {
            return;
        }
        if (resp.status === 401) {
            throw new Error('未授权：用户名或密码错误');
        }
        if (resp.status === 409) {
            throw new Error(`无法创建远程目录，请确认父目录存在: ${basePath}`);
        }
        if (resp.status >= 400) {
            throw new Error(`创建远程目录失败 (HTTP ${resp.status})`);
        }
    }

    /**
     * 上传文件内容（PUT）
     * 幂等：重复 PUT 同一文件不会报错，会覆盖旧内容
     * 409 冲突时自动创建目录后重试一次
     * @param {string} fileName - 文件名
     * @param {string} content - 文件内容
     * @returns {Promise<void>}
     * @throws {Error} 401 未授权、网络错误、重试后仍失败
     */
    async function put(fileName, content) {
        const u = url(fileName);
        const headers = makeHeaders({ 'Content-Type': 'application/json; charset=utf-8' });
        const resp = await request('PUT', u, headers, content);
        if (resp.status === 401) {
            throw new Error('未授权：用户名或密码错误');
        }
        if (isOk(resp.status)) return;
        // 409 冲突：目录不存在，自动创建后重试一次
        if (resp.status === 409) {
            await ensureBaseDir();
            const retry = await request('PUT', u, headers, content);
            if (isOk(retry.status)) return;
            if (retry.status === 401) {
                throw new Error('未授权：用户名或密码错误');
            }
            throw new Error(`上传 ${fileName} 失败 (HTTP ${retry.status})`);
        }
        throw new Error(`上传 ${fileName} 失败 (HTTP ${resp.status})`);
    }

    /**
     * 下载文件内容（GET）
     * @param {string} fileName - 文件名
     * @returns {Promise<string|null>} 文件内容；404 时返回 null
     * @throws {Error} 401 未授权、网络错误
     */
    async function get(fileName) {
        const u = url(fileName);
        const resp = await request('GET', u, makeHeaders());
        if (resp.status === 404) return null;
        if (resp.status === 401) {
            throw new Error('未授权：用户名或密码错误');
        }
        if (isOk(resp.status)) return resp.body;
        throw new Error(`下载 ${fileName} 失败 (HTTP ${resp.status})`);
    }

    /**
     * 删除文件（DELETE）
     * 幂等：删除不存在的文件（404）也视为成功
     * @param {string} fileName - 文件名
     * @returns {Promise<void>}
     * @throws {Error} 401 未授权、网络错误
     */
    async function deleteFile(fileName) {
        const u = url(fileName);
        const resp = await request('DELETE', u, makeHeaders());
        // 200/204/202/404 均视为成功（幂等）
        if (resp.status === 200 || resp.status === 204 || resp.status === 202 || resp.status === 404) return;
        if (resp.status === 401) {
            throw new Error('未授权：用户名或密码错误');
        }
        throw new Error(`删除 ${fileName} 失败 (HTTP ${resp.status})`);
    }

    /**
     * 查询资源属性（PROPFIND）
     * @param {string} [fileName=''] - 文件名（空字符串表示查询基础目录）
     * @param {number} [depth=1] - 查询深度：0 仅当前资源，1 包含直接子项
     * @returns {Promise<string|null>} PROPFIND 响应体（XML 字符串）；404 返回 null
     * @throws {Error} 401 未授权、网络错误
     */
    async function propfind(fileName = '', depth = 1) {
        const u = url(fileName);
        const body = '<?xml version="1.0" encoding="utf-8"?>' +
            '<propfind xmlns="DAV:"><prop><displayname/></prop></propfind>';
        const resp = await request('PROPFIND', u, makeHeaders({
            Depth: String(depth),
            'Content-Type': 'application/xml; charset=utf-8'
        }), body);
        if (resp.status === 404) return null;
        if (resp.status === 401) {
            throw new Error('未授权：用户名或密码错误');
        }
        // 207 Multi-Status 是 PROPFIND 的成功响应
        if (resp.status === 207 || isOk(resp.status)) return resp.body;
        throw new Error(`PROPFIND ${fileName || '(base)'} 失败 (HTTP ${resp.status})`);
    }

    /**
     * 创建远程目录（MKCOL）
     * 幂等：目录已存在（405/301）不报错
     * @returns {Promise<void>}
     */
    async function mkcol() {
        await ensureBaseDir();
    }

    /**
     * 检查文件是否存在
     * 通过 PROPFIND Depth 0 探测，404 返回 false，200/207 返回 true
     * @param {string} fileName - 文件名
     * @returns {Promise<boolean>}
     * @throws {Error} 401 未授权、网络错误
     */
    async function exists(fileName) {
        const u = url(fileName);
        const body = '<?xml version="1.0" encoding="utf-8"?>' +
            '<propfind xmlns="DAV:"><prop><displayname/></prop></propfind>';
        const resp = await request('PROPFIND', u, makeHeaders({
            Depth: '0',
            'Content-Type': 'application/xml; charset=utf-8'
        }), body);
        if (resp.status === 404) return false;
        if (resp.status === 401) {
            throw new Error('未授权：用户名或密码错误');
        }
        if (resp.status === 207 || isOk(resp.status)) return true;
        // 其他错误保守返回 false
        return false;
    }

    return { put, get, delete: deleteFile, propfind, mkcol, exists };
}
