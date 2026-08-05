/**
 * 字体自定义模块
 *
 * 通过 CSS 变量 --anime-custom-font 注入自定义字体，
 * 配合 styles 模块中的 var(--anime-custom-font, fallback) !important 生效。
 * 支持：系统字体名、在线字体文件（woff2/woff/ttf/otf）、Google Fonts CSS 链接。
 *
 * 字体回退链：用户自定义字体 → DeepSeek 原生 Inter → 系统中文字体 → sans-serif
 * 这样既允许用户自定义字体，又不破坏 DeepSeek 原有的英文/数字渲染。
 *
 * 缓存机制：
 *   - 字体二进制（Blob）和 CSS 文本缓存到 IndexedDB（key 为 URL）
 *   - 上次加载的 URL 和成功状态记录在 localStorage（ds-font-cache-meta）
 *   - 若 URL 未变且上次成功，直接使用 IndexedDB 缓存，避免重复网络请求
 *   - 若 URL 变化或上次失败，重新发起 fetch 请求并更新缓存
 *   - fetch 失败时回退到 @import/url() 直接引用，让浏览器自行加载
 */
import { CONFIG } from '../config.js';

/** IndexedDB 数据库名 */
const FONT_CACHE_DB = 'ds-font-cache';
/** IndexedDB 对象存储名 */
const FONT_CACHE_STORE = 'fonts';
/** localStorage 中存储字体缓存 meta 信息的键名 */
const FONT_META_KEY = 'ds-font-cache-meta';

/** DeepSeek 原生字体回退链，确保不破坏原有渲染 */
const FALLBACK_FONTS = "'Inter', 'PingFang SC', 'Hiragino Sans GB', 'Noto Sans SC', 'Microsoft YaHei', sans-serif";

/** IndexedDB 连接 Promise（单例，避免重复打开） */
let _dbPromise = null;

/**
 * 打开字体缓存 IndexedDB
 * @returns {Promise<IDBDatabase>}
 */
function openFontDB() {
    if (_dbPromise) return _dbPromise;
    _dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(FONT_CACHE_DB, 1);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(FONT_CACHE_STORE)) {
                db.createObjectStore(FONT_CACHE_STORE);
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
    return _dbPromise;
}

/**
 * 从 IndexedDB 读取缓存
 * @param {string} key - 缓存键（通常是 URL）
 * @returns {Promise<any|null>} 缓存值，不存在或出错时返回 null
 */
async function idbGet(key) {
    try {
        const db = await openFontDB();
        return await new Promise((resolve) => {
            const tx = db.transaction(FONT_CACHE_STORE, 'readonly');
            const req = tx.objectStore(FONT_CACHE_STORE).get(key);
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => resolve(null);
        });
    } catch (e) {
        return null;
    }
}

/**
 * 写入 IndexedDB 缓存
 * @param {string} key - 缓存键
 * @param {any} value - 缓存值（Blob 或字符串）
 */
async function idbSet(key, value) {
    try {
        const db = await openFontDB();
        await new Promise((resolve) => {
            const tx = db.transaction(FONT_CACHE_STORE, 'readwrite');
            tx.objectStore(FONT_CACHE_STORE).put(value, key);
            tx.oncomplete = () => resolve();
            tx.onerror = () => resolve();
        });
    } catch (e) {}
}

/**
 * 读取字体缓存 meta（记录上次加载的 URL 和成功状态）
 * @returns {{url:string, success:boolean, time:number}|null}
 */
function getFontMeta() {
    try {
        const s = localStorage.getItem(FONT_META_KEY);
        return s ? JSON.parse(s) : null;
    } catch (e) {
        return null;
    }
}

/**
 * 写入字体缓存 meta
 * @param {{url:string, success:boolean, time:number}} meta
 */
function setFontMeta(meta) {
    try {
        localStorage.setItem(FONT_META_KEY, JSON.stringify(meta));
    } catch (e) {}
}

/**
 * Blob 转 base64 data URL
 * @param {Blob} blob
 * @returns {Promise<string>}
 */
function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

/**
 * 根据 URL 扩展名推断 @font-face 的 format() 值
 * @param {string} url - 字体文件 URL
 * @returns {string} 格式标识符
 */
function detectFontFormat(url) {
    const lower = url.toLowerCase().split('?')[0].split('#')[0];
    if (lower.endsWith('.woff2')) return 'woff2';
    if (lower.endsWith('.woff')) return 'woff';
    if (lower.endsWith('.ttf')) return 'truetype';
    if (lower.endsWith('.otf')) return 'opentype';
    if (lower.endsWith('.eot')) return 'embedded-opentype';
    if (lower.endsWith('.svg')) return 'svg';
    return 'truetype';
}

/**
 * 构造 @font-face CSS 文本
 * @param {string} src - 字体源 URL 或 data URL
 * @param {string} fmt - 字体格式
 * @param {string} effectiveFamily - 字体回退链
 * @returns {string}
 */
function buildFontFaceCss(src, fmt, effectiveFamily) {
    return `@font-face { font-family: 'CustomFont'; src: url("${src}") format('${fmt}'); font-weight: normal; font-style: normal; font-display: swap; }\n:root { --anime-custom-font: ${effectiveFamily}; }`;
}

/**
 * 注入字体样式到 <head>（移除旧样式后创建新样式）
 * @param {string} cssText - CSS 文本
 */
function injectFontStyle(cssText) {
    const old = document.getElementById('anime-custom-font-style');
    if (old) old.remove();
    const style = document.createElement('style');
    style.id = 'anime-custom-font-style';
    style.textContent = cssText;
    document.head.appendChild(style);
}

/**
 * 更新已注入的字体样式（仅更新 textContent，不移除元素，避免闪烁）
 * @param {string} cssText - 新的 CSS 文本
 */
function updateFontStyle(cssText) {
    const style = document.getElementById('anime-custom-font-style');
    if (style) {
        style.textContent = cssText;
    } else {
        injectFontStyle(cssText);
    }
}

/**
 * 获取字体文件并缓存到 IndexedDB
 * @param {string} url - 字体文件 URL
 * @returns {Promise<string>} base64 data URL
 */
async function fetchFontFile(url) {
    const resp = await fetch(url, { mode: 'cors', credentials: 'omit' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const blob = await resp.blob();
    await idbSet(url, blob);
    return await blobToDataUrl(blob);
}

/**
 * 获取 Google Fonts CSS 并缓存，同时缓存 CSS 中引用的字体文件
 * @param {string} url - CSS URL
 * @returns {Promise<string>} 处理后的 CSS 文本（字体 URL 已替换为 base64 data URL）
 */
async function fetchCssWithFonts(url) {
    const resp = await fetch(url, { mode: 'cors', credentials: 'omit' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    let cssText = await resp.text();
    // 处理 CSS 中的 url()，缓存字体文件并替换为 base64 data URL
    const urlRegex = /url\((['"]?)(https?:\/\/[^'")]+)\1\)/g;
    const matches = [...cssText.matchAll(urlRegex)];
    for (const m of matches) {
        const fontUrl = m[2];
        try {
            const dataUrl = await fetchFontFile(fontUrl);
            cssText = cssText.split(m[0]).join(`url("${dataUrl}")`);
        } catch (e) {
            // 单个字体文件失败，保留原 URL
        }
    }
    await idbSet(url, cssText);
    return cssText;
}

/**
 * 异步加载 CSS 字体（Google Fonts 等），优先使用缓存
 * @param {string} url - CSS URL
 * @param {boolean} useCache - 是否优先使用缓存（URL 未变且上次成功）
 * @param {string} effectiveFamily - 字体回退链
 */
async function applyCssFont(url, useCache, effectiveFamily) {
    try {
        if (useCache) {
            const cached = await idbGet(url);
            if (cached) {
                updateFontStyle(cached + `\n:root { --anime-custom-font: ${effectiveFamily}; }`);
                return;
            }
            // 缓存不存在（可能 IndexedDB 被清理），回退到重新加载
        }
        // 重新加载并缓存
        const cssContent = await fetchCssWithFonts(url);
        setFontMeta({ url, success: true, time: Date.now() });
        updateFontStyle(cssContent + `\n:root { --anime-custom-font: ${effectiveFamily}; }`);
    } catch (e) {
        setFontMeta({ url, success: false, time: Date.now() });
        // 失败时回退到 @import（让浏览器加载）
        updateFontStyle(`@import url("${url}");\n:root { --anime-custom-font: ${effectiveFamily}; }`);
    }
}

/**
 * 异步加载字体文件，优先使用缓存
 * @param {string} url - 字体文件 URL
 * @param {string} fmt - 字体格式
 * @param {boolean} useCache - 是否优先使用缓存（URL 未变且上次成功）
 * @param {string} effectiveFamily - 字体回退链
 */
async function applyFontFile(url, fmt, useCache, effectiveFamily) {
    try {
        if (useCache) {
            const cachedBlob = await idbGet(url);
            if (cachedBlob) {
                const dataUrl = await blobToDataUrl(cachedBlob);
                updateFontStyle(buildFontFaceCss(dataUrl, fmt, effectiveFamily));
                return;
            }
            // 缓存不存在（可能 IndexedDB 被清理），回退到重新加载
        }
        // 重新加载并缓存
        const dataUrl = await fetchFontFile(url);
        setFontMeta({ url, success: true, time: Date.now() });
        updateFontStyle(buildFontFaceCss(dataUrl, fmt, effectiveFamily));
    } catch (e) {
        setFontMeta({ url, success: false, time: Date.now() });
        // 失败时回退到直接 URL 引用（让浏览器加载）
        updateFontStyle(buildFontFaceCss(url, fmt, effectiveFamily));
    }
}

/**
 * 应用自定义字体：通过 CSS 变量 --anime-custom-font 注入，
 * 被 styles 模块的 !important 规则引用。
 *
 * 字体优先级：
 *   1. 有 URL 字体文件时：CustomFont → 用户指定的 family → Inter → 系统字体
 *   2. 仅填 family 时：用户指定的 family → Inter → 系统字体
 *   3. 都不填时：移除变量，使用 styles 模块的默认回退链
 *
 * 缓存策略：
 *   - 若 URL 未变且上次加载成功（useCache=true），优先使用 IndexedDB 缓存，不发起网络请求
 *   - 否则发起 fetch 请求，成功后缓存到 IndexedDB
 *   - fetch 失败时回退到 @import/url() 直接引用
 */
export function applyFont() {
    const family = CONFIG.fontFamily || '';
    const url = CONFIG.fontUrl || '';
    // 清除旧的字体样式
    const oldFontStyle = document.getElementById('anime-custom-font-style');
    if (oldFontStyle) oldFontStyle.remove();
    // 清除旧的行内样式（兼容旧版本残留）
    document.body.style.fontFamily = '';

    // 字体自定义开关关闭时，移除 CSS 变量，回退到默认字体链
    if (!CONFIG.fontCustomEnabled) {
        document.documentElement.style.removeProperty('--anime-custom-font');
        return;
    }

    if (!family && !url) {
        // 无自定义字体，移除 CSS 变量，回退到 styles 模块的默认字体链
        document.documentElement.style.removeProperty('--anime-custom-font');
        return;
    }

    /** 最终写入 CSS 变量的字体链 */
    let effectiveFamily = '';
    const meta = getFontMeta();
    /** URL 未变且上次成功：优先使用缓存，不发起网络请求 */
    const useCache = !!(meta && meta.url === url && meta.success);

    if (url) {
        if (url.endsWith('.css') || url.includes('fonts.googleapis.com')) {
            // Google Fonts 或外部 CSS：family 优先，回退到 Inter + 系统字体
            effectiveFamily = (family ? family + ', ' : '') + FALLBACK_FONTS;
            if (useCache) {
                // useCache：不注入 @import（避免网络请求），只注入变量，等待缓存读取
                injectFontStyle(`:root { --anime-custom-font: ${effectiveFamily}; }`);
            } else {
                // 非 useCache：注入 @import 让浏览器并行加载，同时异步 fetch 缓存
                injectFontStyle(`@import url("${url}");\n:root { --anime-custom-font: ${effectiveFamily}; }`);
            }
            // 异步加载（使用缓存或重新请求）
            applyCssFont(url, useCache, effectiveFamily);
        } else {
            // 字体文件：创建 @font-face，自动推断格式
            const fmt = detectFontFormat(url);
            // 有 URL 字体文件时，CustomFont 优先，回退到用户 family → Inter → 系统字体
            effectiveFamily = "'CustomFont'" + (family ? ', ' + family : '') + ', ' + FALLBACK_FONTS;
            if (useCache) {
                // useCache：不注入 url()（避免网络请求），只注入变量，等待缓存读取
                injectFontStyle(`:root { --anime-custom-font: ${effectiveFamily}; }`);
            } else {
                // 非 useCache：注入 url() 让浏览器并行加载，同时异步 fetch 缓存
                injectFontStyle(buildFontFaceCss(url, fmt, effectiveFamily));
            }
            // 异步加载（使用缓存或重新请求）
            applyFontFile(url, fmt, useCache, effectiveFamily);
        }
    } else {
        // 仅填字体名，回退到 Inter + 系统字体
        effectiveFamily = family + ', ' + FALLBACK_FONTS;
        injectFontStyle(`:root { --anime-custom-font: ${effectiveFamily}; }`);
    }
}
