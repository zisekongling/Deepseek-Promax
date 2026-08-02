/**
 * 工具函数模块
 *
 * 提供全局共享的工具方法：防抖、暗色模式检测、图片 URL 判断、
 * 角标文本清理、Markdown 图片提取、DOM 节点状态检查等。
 */

export const utils = {
    /**
     * 防抖函数
     * @param {Function} fn - 需要防抖的函数
     * @param {number} delay - 延迟毫秒数
     * @returns {Function} 防抖后的函数
     */
    debounce(fn, delay) {
        let timer;
        return function (...args) {
            clearTimeout(timer);
            timer = setTimeout(() => fn.apply(this, args), delay);
        };
    },

    /**
     * 检测当前是否为暗色模式
     * @returns {boolean}
     */
    isDarkMode() {
        const html = document.documentElement;
        if (html.hasAttribute('data-theme')) return html.getAttribute('data-theme') === 'dark';
        if (html.classList.contains('dark')) return true;
        const bgColor = getComputedStyle(document.body).backgroundColor;
        if (bgColor) {
            const rgb = bgColor.match(/\d+/g);
            if (rgb && rgb.length >= 3) {
                const brightness = (rgb[0] * 299 + rgb[1] * 587 + rgb[2] * 114) / 1000;
                return brightness < 128;
            }
        }
        return window.matchMedia('(prefers-color-scheme: dark)').matches;
    },

    /**
     * 判断 URL 是否指向图片资源
     * @param {string} url
     * @returns {boolean}
     */
    isImageUrl(url) {
        if (!url) return false;
        const extRegex = /\.(jpe?g|png|gif|bmp|webp|svg|avif|tif|tiff|ico)(\?.*)?$/i;
        if (extRegex.test(url)) return true;
        const imageHosts = ['imgur.com', 'cloudinary.com', 'images.unsplash.com', 'cdn.pixabay.com', 'i.ibb.co', 'image.lexica.art'];
        try {
            const host = new URL(url).hostname.replace(/^www\./, '');
            if (imageHosts.some(h => host.includes(h))) return true;
        } catch (_) {}
        return false;
    },

    /**
     * 移除文本中的角标标记 [reference:N] / [citation:N]
     * @param {string} text
     * @returns {string}
     */
    removeCitationText(text) {
        if (!text) return text;
        return text.replace(/\[(?:reference|citation):\d+\]/gi, '');
    },

    /**
     * 判断元素是否为角标元素
     * @param {Element} el
     * @returns {boolean}
     */
    isCitationElement(el) {
        if (!el) return false;
        if (el.matches && el.matches('.ds-markdown-cite, ._2ed5dee, cite, sup, [data-citation]')) return true;
        if (el.classList && (el.classList.contains('ds-markdown-cite') || el.classList.contains('_2ed5dee'))) return true;
        if (el.matches && el.matches('[data-citation]')) return true;
        const citeSpan = el.querySelector('span.ds-markdown-cite, span._2ed5dee');
        if (citeSpan) return true;
        if (el.textContent && /\[(?:reference|citation):\d+\]/i.test(el.textContent)) return true;
        if (el.classList && el.classList.contains('_49c6e07')) return true;
        return false;
    },

    /**
     * 从文本中提取 Markdown 图片语法 ![alt](url)
     * @param {string} text
     * @returns {Array<{alt:string,url:string,index:number,length:number}>}
     */
    extractMarkdownImage(text) {
        const regex = /!\[([^\]]*)\]\(([^)]+)\)/g;
        const matches = [];
        let match;
        while ((match = regex.exec(text)) !== null) {
            if (this.isImageUrl(match[2])) {
                matches.push({ alt: match[1], url: match[2], index: match.index, length: match[0].length });
            }
        }
        return matches;
    },

    /**
     * 从文本中提取纯图片 URL
     * @param {string} text
     * @returns {Array<{url:string,index:number,length:number}>}
     */
    extractPlainImageUrls(text) {
        const regex = /https?:\/\/[^\s"'<>]+\.(?:jpe?g|png|gif|bmp|webp|svg|avif)(?:\?[^\s"'<>]*)?/gi;
        return [...text.matchAll(regex)].map(m => ({ url: m[0], index: m.index, length: m[0].length }));
    },

    /**
     * 检查节点是否仍然附加在 DOM 中
     * @param {Node} node
     * @returns {boolean}
     */
    isNodeAttached(node) {
        return node && node.parentNode && document.contains(node);
    },

    /**
     * 检查节点是否位于代码块内
     * @param {Node} node
     * @returns {boolean}
     */
    isInsideCodeBlock(node) {
        let current = node;
        while (current && current.nodeType === 1) {
            const tag = current.tagName.toLowerCase();
            if (tag === 'pre' || tag === 'code') return true;
            if (current.classList) {
                for (const cls of current.classList) {
                    if (cls.includes('code') || cls.includes('Code') || cls === 'md-code-block' || cls === 'ds-markdown-code') {
                        return true;
                    }
                }
            }
            current = current.parentNode;
        }
        return false;
    }
};
