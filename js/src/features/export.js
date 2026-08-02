/**
 * 对话导出模块
 *
 * 支持三种导出格式：
 *   - JSON：原始 API 数据格式（包含 session、messages、fragments）
 *   - Markdown：人类可读的对话记录（含思考过程、时间戳）
 *   - PNG 图片：使用 html2canvas 截图（动态加载 CDN）
 *
 * 数据来源优先级：Store（API 拦截）→ IndexedDB → DOM 提取兜底
 */
import { CONFIG } from '../config.js';
import { Store, handleBiz, findBizPayload, getSidFromUrl } from './data-store.js';

const HTML2CANVAS_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';

/**
 * 动态加载 html2canvas 库
 * @returns {Promise<typeof html2canvas>}
 */
function loadHtml2Canvas() {
    if (typeof window.html2canvas === 'function') return Promise.resolve(window.html2canvas);
    return new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = HTML2CANVAS_CDN;
        s.onload = () => {
            if (typeof window.html2canvas === 'function') resolve(window.html2canvas);
            else reject(new Error('html2canvas 加载失败'));
        };
        s.onerror = () => reject(new Error('无法加载 html2canvas，请检查网络'));
        document.head.appendChild(s);
    });
}

/**
 * 从 DOM 提取对话数据（兜底方案，当 API 数据不可用时使用）
 * @returns {Object} { sid, aid, title, msgs, source }
 */
function extractDomExportData() {
    const root = document.querySelector('main') || document.querySelector('[role="main"]') || document.body;
    const selectors = [
        '.ds-message', '.ds-markdown', '[class*="markdown"]', '[class*="Markdown"]',
        '[data-message-id]', '[data-testid*="message"]', '[data-role]',
        '[class*="message"]', '[class*="Message"]', '[class*="prose"]',
        '[class*="content"]', '[class*="chat-message"]', 'article'
    ];
    const seen = new Set();
    const nodes = [];
    selectors.forEach(sel => {
        root.querySelectorAll(sel).forEach(el => {
            if (seen.has(el) || !el.offsetParent) return;
            const text = (el.innerText || el.textContent || '').trim();
            if (text.length < 2) return;
            seen.add(el);
            nodes.push({ el, text });
        });
    });
    if (nodes.length === 0) {
        root.querySelectorAll('p, li, pre, h1, h2, h3, blockquote').forEach(el => {
            if (seen.has(el) || !el.offsetParent) return;
            const text = (el.innerText || el.textContent || '').trim();
            if (text.length < 6) return;
            seen.add(el);
            nodes.push({ el, text });
        });
    }
    // 去重
    const unique = [];
    const textSeen = new Set();
    nodes.forEach(item => {
        const compact = item.text.replace(/\s+/g, ' ').slice(0, 500);
        if (textSeen.has(compact)) return;
        textSeen.add(compact);
        unique.push(item);
    });
    const msgs = unique.map((item, i) => {
        const cls = String(item.el?.className || '').toLowerCase();
        const role = /user|human|question|ask/.test(cls) ? 'USER' :
                     (/assistant|bot|answer|ai|deepseek/.test(cls) ? 'ASSISTANT' : (i % 2 === 0 ? 'USER' : 'ASSISTANT'));
        return {
            message_id: 'dom-' + i,
            role,
            status: 'FINISHED',
            inserted_at: Math.floor(Date.now() / 1000),
            fragments: [{ type: 'RESPONSE', content: item.text }]
        };
    });
    return {
        sid: getSidFromUrl() || 'dom-' + Date.now(),
        aid: '',
        title: document.title.replace(/\s*-\s*DeepSeek.*/i, '') || 'DeepSeek 对话',
        msgs,
        source: 'dom'
    };
}

/**
 * 执行 JSON 或 Markdown 导出
 * @param {string} type - 'json' 或 'md'
 * @param {Object} data - 对话数据
 */
function execExport(type, data) {
    const safeTitle = (data.title || 'DeepSeek').replace(/[/\\?%*:|"<>]/g, '-');
    const dateStr = new Date().toISOString().slice(0, 10);

    if (type === 'json') {
        const blob = new Blob([JSON.stringify({
            chat_session: { id: data.sid, title: data.title },
            chat_messages: data.msgs
        }, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = safeTitle + '_' + dateStr + '.json';
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    } else {
        let md = '# ' + (data.title || 'DeepSeek 对话') + '\n\n';
        data.msgs.forEach(msg => {
            const role = (msg.role || '').toUpperCase() === 'USER' ? '👤 用户' : '🤖 DeepSeek';
            const time = msg.inserted_at ? new Date(msg.inserted_at * 1000).toLocaleString() : '';
            md += '### ' + role + '\n';
            if (time) md += '*' + time + '*\n\n';
            const frags = msg.fragments || [];
            let contentAdded = false;
            frags.forEach(f => {
                if (f.type === 'THINK') {
                    md += '> 💭 思考过程:\n> ' + (f.content || '').replace(/\n/g, '\n> ') + '\n\n';
                    contentAdded = true;
                }
                if (f.type === 'RESPONSE' && f.content) {
                    md += f.content + '\n\n';
                    contentAdded = true;
                }
            });
            if (!contentAdded && msg.content) md += msg.content + '\n\n';
            md += '---\n\n';
        });
        const blob = new Blob([md], { type: 'text/markdown' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = safeTitle + '_' + dateStr + '.md';
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }
}

/**
 * 导出对话为 JSON 或 Markdown
 * @param {string} type - 'json' 或 'md'
 * @returns {Promise<boolean>} 是否成功
 */
export async function doExport(type) {
    // 优先使用 Store 中的 API 数据
    if (Store.hasData()) {
        execExport(type, Store.get());
        return true;
    }

    // 尝试从 URL 获取会话 ID 并直接请求 API
    const sid = getSidFromUrl() || Store.get().sid;
    if (sid) {
        try {
            const resp = await fetch('/api/v0/chat/history_messages?chat_session_id=' + sid);
            if (resp.ok) {
                const json = await resp.json();
                const biz = findBizPayload(json?.data?.biz_data) || findBizPayload(json);
                if (biz) {
                    handleBiz(biz);
                    if (Store.hasData()) {
                        execExport(type, Store.get());
                        return true;
                    }
                }
            }
        } catch(e) {}
    }

    // 兜底：从 DOM 提取数据
    const domData = extractDomExportData();
    if (domData.msgs.length > 0) {
        execExport(type, domData);
        return true;
    }

    alert('未找到对话数据，请先打开一个对话后重试');
    return false;
}

/**
 * 导出对话为 PNG 图片
 * 动态加载 html2canvas，支持选择消息范围
 * @returns {Promise<boolean>} 是否成功
 */
export async function doImageExport() {
    // 获取消息节点
    const root = document.querySelector('main') || document.querySelector('[role="main"]') || document.body;
    const selectors = ['.ds-message', '[data-message-id]', '[data-testid*="message"]', '[class*="message"]', '[class*="Message"]', 'article'];
    let msgs = [];
    const seen = new Set();
    for (const sel of selectors) {
        const nodes = [...root.querySelectorAll(sel)].filter(el => {
            if (seen.has(el) || el.id?.startsWith('ds-') || el.id?.startsWith('dss-')) return false;
            const text = (el.innerText || el.textContent || '').trim();
            const rect = el.getBoundingClientRect();
            return text.length >= 2 && rect.width >= 80 && rect.height >= 12;
        });
        if (nodes.length) { msgs = nodes; break; }
        nodes.forEach(n => seen.add(n));
    }

    if (!msgs.length) {
        alert('未找到对话内容');
        return false;
    }

    // 加载 html2canvas
    let html2canvas;
    try {
        html2canvas = await loadHtml2Canvas();
    } catch(e) {
        alert(e.message);
        return false;
    }

    // 创建离屏容器并克隆消息
    const container = document.createElement('div');
    container.style.cssText = 'width:760px;max-width:760px;padding:20px;background:#fff;position:fixed;left:-10000px;top:0;color:#111827;font-family:system-ui,sans-serif';
    msgs.forEach(m => {
        const clone = m.cloneNode(true);
        clone.style.setProperty('max-width', '100%', 'important');
        clone.style.setProperty('width', '100%', 'important');
        clone.style.setProperty('box-sizing', 'border-box', 'important');
        container.appendChild(clone);
    });
    document.body.appendChild(container);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

    try {
        const totalText = msgs.reduce((n, el) => n + ((el.innerText || el.textContent || '').length), 0);
        const scale = msgs.length > 16 || totalText > 16000 ? 1 : 1.35;
        const canvas = await html2canvas(container, {
            scale, backgroundColor: '#ffffff', useCORS: true, logging: false, removeContainer: false
        });
        const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
        const a = document.createElement('a');
        a.download = 'deepseek-' + new Date().toISOString().slice(0, 10) + '.png';
        a.href = URL.createObjectURL(blob);
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
        return true;
    } catch(e) {
        alert('截图失败: ' + e.message);
        return false;
    } finally {
        container.remove();
    }
}
