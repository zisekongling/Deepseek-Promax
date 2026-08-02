/**
 * 文本处理模块
 *
 * 包含图片渲染、删除线渲染、角标清理、链接扫描等功能。
 * 通过遍历 Text 节点对 DeepSeek 的输出进行实时美化。
 * 处理顺序：角标清理 → 删除线渲染 → 图片渲染（与原版一致）
 */
import { CONFIG } from '../config.js';
import { utils } from '../utils.js';
import { scanMermaid } from './mermaid.js';
import { replaceSensitiveData } from './privacy-shield.js';

// ============================================================
// 图片渲染
// ============================================================

/**
 * 创建图片元素
 * @param {string} url - 图片 URL
 * @param {string} alt - 替代文本
 * @returns {HTMLImageElement}
 */
function createImageElement(url, alt = '') {
    const img = document.createElement('img');
    img.src = url;
    img.alt = alt || '图片';
    img.className = 'anime-rendered-image';
    img.loading = 'lazy';
    img.onerror = () => { if (img.parentNode) img.style.display = 'none'; };
    return img;
}

/**
 * 将节点替换为图片链接（用于 scanLinks 中的 <a> 标签替换）
 * 使用 insertBefore + display:none 代替 replaceChild，避免破坏 React 的 DOM 管理
 * @param {Node} node - 待替换的节点
 * @param {string} url - 图片 URL
 * @param {string} alt - 替代文本
 */
function replaceNodeWithImage(node, url, alt) {
    if (!utils.isNodeAttached(node)) return;
    try {
        const img = createImageElement(url, alt);
        const link = document.createElement('a');
        link.href = url; link.target = '_blank'; link.rel = 'noreferrer';
        link.className = 'anime-image-link';
        link.appendChild(img);
        // 在原节点前插入图片链接，然后隐藏原节点（不移除，避免 React removeChild 错误）
        node.parentNode.insertBefore(link, node);
        node.style.display = 'none';
    } catch (e) {}
}

// ============================================================
// 角标清理
// ============================================================

/**
 * 清理文本节点中的角标标记文本 [reference:N] / [citation:N]
 * @param {Text} textNode
 */
function cleanTextCitations(textNode) {
    if (!CONFIG.citationCleanEnabled) return;
    if (!textNode || textNode.nodeType !== 3) return;
    const original = textNode.textContent;
    const cleaned = utils.removeCitationText(original);
    if (cleaned !== original) {
        textNode.textContent = cleaned;
    }
}

/**
 * 清理元素中的角标 DOM 节点
 * 使用 display:none 隐藏而非 removeChild 移除，避免破坏 React 的 DOM 管理
 * @param {Element} root
 */
function cleanElementCitations(root) {
    if (!CONFIG.citationCleanEnabled) return;
    if (!root || root.nodeType !== 1) return;
    const candidates = root.querySelectorAll('a, span, cite, sup, [data-citation]');
    candidates.forEach(el => {
        if (utils.isCitationElement(el) && el.style.display !== 'none') {
            el.style.display = 'none';
        }
    });
}

// ============================================================
// 删除线渲染
// ============================================================

/**
 * 在文本节点中渲染 ~~删除线~~ 语法为 <del> 元素
 * @param {Text} textNode
 * @returns {Text[]|null} 新插入的文本节点数组（供图片渲染使用），无匹配时返回 null
 */
function renderStrikethrough(textNode) {
    if (!CONFIG.strikethroughEnabled) return null;
    if (textNode.nodeType !== 3) return null;
    const text = textNode.textContent;
    if (!/~~.+?~~/.test(text)) return null;
    if (utils.isInsideCodeBlock(textNode)) return null;

    const parent = textNode.parentNode;
    if (!parent) return null;

    const fragment = document.createDocumentFragment();
    let lastIndex = 0;
    const regex = /~~(.+?)~~/g;
    let match;

    while ((match = regex.exec(text)) !== null) {
        if (match.index > lastIndex) {
            fragment.appendChild(document.createTextNode(text.substring(lastIndex, match.index)));
        }
        const del = document.createElement('del');
        del.textContent = match[1];
        fragment.appendChild(del);
        lastIndex = match.index + match[0].length;
    }
    if (lastIndex < text.length) {
        fragment.appendChild(document.createTextNode(text.substring(lastIndex)));
    }

    // 收集 fragment 中的文本节点（插入后需要处理图片渲染）
    const insertedTextNodes = [];
    for (let child of fragment.childNodes) {
        if (child.nodeType === 3) insertedTextNodes.push(child);
    }

    // 在原文本节点前插入 fragment，然后清空原文本节点（不移除，避免 React removeChild 错误）
    parent.insertBefore(fragment, textNode);
    textNode.textContent = '';
    return insertedTextNodes.length > 0 ? insertedTextNodes : null;
}

// ============================================================
// 图片渲染入口
// ============================================================

/**
 * 渲染文本节点中的第一个图片（Markdown 或纯 URL）
 * 仅处理第一个匹配项，在原文本节点前插入 span（包含前置文本 + 图片链接 + 后置文本）
 * 然后清空原文本节点（不移除，避免 React removeChild 错误）
 * @param {Text} textNode
 */
function renderImages(textNode) {
    if (!CONFIG.imageRenderEnabled) return;
    if (textNode.nodeType !== 3) return;
    if (!utils.isNodeAttached(textNode)) return;

    const text = textNode.textContent || '';
    if (text.trim().length < 5) return;

    try {
        const mdMatches = utils.extractMarkdownImage(text);
        if (mdMatches.length) {
            const first = mdMatches[0];
            const span = document.createElement('span');
            if (first.index > 0) span.appendChild(document.createTextNode(text.substring(0, first.index)));
            const img = createImageElement(first.url, first.alt);
            const link = document.createElement('a');
            link.href = first.url; link.target = '_blank'; link.rel = 'noreferrer';
            link.className = 'anime-image-link'; link.appendChild(img);
            span.appendChild(link);
            const end = first.index + first.length;
            if (end < text.length) span.appendChild(document.createTextNode(text.substring(end)));
            // 在原文本节点前插入 span，然后清空原文本节点
            if (utils.isNodeAttached(textNode)) {
                textNode.parentNode.insertBefore(span, textNode);
                textNode.textContent = '';
            }
            return;
        }

        const urlMatches = utils.extractPlainImageUrls(text);
        if (urlMatches.length) {
            const firstUrl = urlMatches[0];
            const span = document.createElement('span');
            if (firstUrl.index > 0) span.appendChild(document.createTextNode(text.substring(0, firstUrl.index)));
            const img = createImageElement(firstUrl.url);
            const link = document.createElement('a');
            link.href = firstUrl.url; link.target = '_blank'; link.rel = 'noreferrer';
            link.className = 'anime-image-link'; link.appendChild(img);
            span.appendChild(link);
            const end = firstUrl.index + firstUrl.length;
            if (end < text.length) span.appendChild(document.createTextNode(text.substring(end)));
            // 在原文本节点前插入 span，然后清空原文本节点
            if (utils.isNodeAttached(textNode)) {
                textNode.parentNode.insertBefore(span, textNode);
                textNode.textContent = '';
            }
        }
    } catch (e) {}
}

/**
 * 清理文本节点中的系统提示词注入标记 [系统指令]...[/系统指令]
 * 直接修改 textContent，不改变 DOM 结构，避免 React removeChild 错误
 * @param {Text} textNode
 */
function cleanPromptInjection(textNode) {
    if (!CONFIG.promptInjectEnabled) return;
    const text = textNode.textContent;
    if (!text || !text.includes('[系统指令]')) return;
    // 移除 [系统指令]...[/系统指令] 标记及后面的空白
    const cleaned = text.replace(/\[系统指令\][\s\S]*?\[\/系统指令\]\s*/g, '');
    if (cleaned !== text) {
        textNode.textContent = cleaned;
    }
}

/**
 * 处理单个文本节点：敏感词替换 → 提示词标记清理 → 角标清理 → 删除线渲染 → 图片渲染
 * 如果删除线产生了新文本节点，则遍历它们逐一渲染图片
 * @param {Text} textNode
 */
export function processTextNode(textNode) {
    if (textNode.nodeType !== 3) return;
    if (!utils.isNodeAttached(textNode)) return;

    replaceSensitiveData(textNode);
    cleanPromptInjection(textNode);
    cleanTextCitations(textNode);

    let insertedTextNodes = null;
    if (CONFIG.strikethroughEnabled) {
        insertedTextNodes = renderStrikethrough(textNode);
    }

    if (CONFIG.imageRenderEnabled) {
        if (insertedTextNodes) {
            // 删除线渲染后产生了新文本节点，遍历它们渲染图片
            // 逆序处理避免索引偏移
            for (let i = insertedTextNodes.length - 1; i >= 0; i--) {
                renderImages(insertedTextNodes[i]);
            }
        } else {
            renderImages(textNode);
        }
    }
}

// ============================================================
// 扫描函数
// ============================================================

/**
 * 扫描容器中的链接，将图片 URL 链接替换为图片元素
 * @param {Element} root
 */
export function scanLinks(root) {
    if (!CONFIG.imageRenderEnabled) return;
    if (!root || root.nodeType !== 1) return;
    const links = root.querySelectorAll('a[href]:not([data-anime-processed])');
    links.forEach(link => {
        if (!utils.isNodeAttached(link) || link.dataset.animeProcessed === 'true') return;
        const url = link.getAttribute('href');
        if (!url || !utils.isImageUrl(url)) return;
        link.dataset.animeProcessed = 'true';
        replaceNodeWithImage(link, url, link.textContent || '');
    });
}

/**
 * 扫描容器中的所有文本节点并处理（逆序遍历）
 * @param {Element} root
 */
export function scanTextNodes(root) {
    if (!root || root.nodeType !== 1) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) => {
            const parent = node.parentNode;
            if (parent.tagName === 'SCRIPT' || parent.tagName === 'STYLE' || parent.tagName === 'IMG' || parent.tagName === 'A' ||
                parent.classList.contains('anime-image-link') || parent.classList.contains('anime-rendered-image')) {
                return NodeFilter.FILTER_REJECT;
            }
            return NodeFilter.FILTER_ACCEPT;
        }
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    // 逆序处理避免替换后索引偏移
    for (let i = nodes.length - 1; i >= 0; i--) {
        processTextNode(nodes[i]);
    }
}

/**
 * 全量扫描：角标清理 → 链接扫描 → 文本节点扫描 → Mermaid 图表扫描
 * 每个步骤独立 try-catch，防止单步失败导致整体崩溃
 * @param {Element} root
 */
export function fullScan(root) {
    if (!root || root.nodeType !== 1) return;
    // early return：无子节点且非元素时跳过
    if (!root.childNodes || root.childNodes.length === 0) return;
    try { cleanElementCitations(root); } catch (e) {}
    try { scanLinks(root); } catch (e) {}
    try { scanTextNodes(root); } catch (e) {}
    try { scanMermaid(root); } catch (e) {}
}
