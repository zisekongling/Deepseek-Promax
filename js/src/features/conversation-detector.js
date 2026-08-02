/**
 * 会话检测与缓存模块
 *
 * 从 DeepSeek-Enhancer 项目移植，适配油猴脚本环境。
 *
 * 功能：
 *   1. 从 URL 路径检测当前会话 ID
 *   2. 获取当前会话标题（从 document.title 或侧边栏链接）
 *   3. 缓存最近会话（最多 120 条，去重）
 *   4. 从侧边栏链接中提取会话列表
 *
 * 会话 URL 格式：https://chat.deepseek.com/a/chat/s/{conversationId}
 *
 * 存储 key：dspro.recentConversations.v1
 */

const RECENT_KEY = 'dspro.recentConversations.v1';
const MAX_RECENT = 120;
const CONVERSATION_PATH_RE = /^\/a\/chat\/s\/([a-f0-9-]{20,})/i;

/** 会话链接选择器 */
const CONVERSATION_LINK_SELECTORS = [
    'a[href*="/a/chat/s/"]',
    'a[href*="/chat/s/"]',
];

/** 侧边栏容器选择器 */
const SIDEBAR_SELECTORS = [
    '.ds-scroll-area',
    '[class*="ds-scroll"]',
    'aside',
    'nav',
    '[class*="sidebar" i]',
    '[class*="sider" i]',
];

/**
 * 从路径中提取会话 ID
 * @param {string} [pathname] - 路径，默认当前页面路径
 * @returns {string|null}
 */
export function getConversationIdFromPath(pathname = location.pathname) {
    const match = CONVERSATION_PATH_RE.exec(pathname);
    return match ? match[1] : null;
}

/**
 * 构建会话 URL
 * @param {string} conversationId
 * @returns {string}
 */
export function buildConversationUrl(conversationId) {
    return `https://chat.deepseek.com/a/chat/s/${conversationId}`;
}

/**
 * 检测当前活跃会话
 * @returns {{id:string, title:string, url:string}|null}
 */
export function getActiveConversation() {
    const id = getConversationIdFromPath();
    if (!id) return null;
    const title = (document.title || '').replace(/\s*-\s*DeepSeek\s*$/i, '').trim() || '未命名对话';
    return { id, title, url: buildConversationUrl(id) };
}

/**
 * 查找 DeepSeek 侧边栏容器
 * @returns {HTMLElement|null}
 */
export function findSidebar() {
    for (const selector of CONVERSATION_LINK_SELECTORS) {
        const link = document.querySelector(selector);
        if (!link) continue;
        const container = link.closest('.ds-scroll-area, [class*="ds-scroll"], aside, nav');
        if (container) return container;
    }
    for (const selector of SIDEBAR_SELECTORS) {
        const el = document.querySelector(selector);
        if (el) return el;
    }
    return null;
}

/**
 * 从侧边栏链接中提取会话列表
 * @returns {Array<{id:string, title:string, url:string}>}
 */
export function getSidebarConversations() {
    const results = [];
    const seen = new Set();
    for (const selector of CONVERSATION_LINK_SELECTORS) {
        document.querySelectorAll(selector).forEach(link => {
            const href = link.getAttribute('href');
            if (!href) return;
            let url;
            try { url = new URL(href, location.origin); } catch { return; }
            const id = getConversationIdFromPath(url.pathname);
            if (!id || seen.has(id)) return;
            seen.add(id);
            const title = (link.textContent || '').trim() || '未命名对话';
            results.push({ id, title, url: buildConversationUrl(id) });
        });
    }
    return results;
}

/**
 * 读取最近会话缓存
 * @returns {Array<{id:string, title:string, url:string}>}
 */
export function readRecentConversations() {
    try {
        const raw = localStorage.getItem(RECENT_KEY);
        if (!raw) return [];
        const data = JSON.parse(raw);
        if (!Array.isArray(data)) return [];
        return data.filter(item =>
            item && typeof item.id === 'string'
                 && typeof item.title === 'string'
                 && typeof item.url === 'string'
        );
    } catch {
        return [];
    }
}

/**
 * 缓存最近会话（去重，最多 120 条）
 * @param {Array<{id:string, title:string, url:string}>} conversations
 */
export function cacheRecentConversations(conversations) {
    if (!conversations || conversations.length === 0) return;
    const current = readRecentConversations();
    const byId = new Map();
    for (const conv of [...current, ...conversations]) {
        if (conv.id && conv.url) byId.set(conv.id, conv);
    }
    const orderedIds = new Set();
    for (const conv of [...conversations, ...current]) {
        if (byId.has(conv.id)) orderedIds.add(conv.id);
    }
    const next = Array.from(orderedIds, id => byId.get(id)).slice(0, MAX_RECENT);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
}

/**
 * 自动缓存当前会话（如果有）
 * 在 URL 变化时调用
 */
export function autoCacheCurrentConversation() {
    const conv = getActiveConversation();
    if (conv) cacheRecentConversations([conv]);
    return conv;
}
