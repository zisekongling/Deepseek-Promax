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
 * 从自定义专家模式指示器中提取会话名称
 * 结构：._9fcbeda._7ee190f > .afa34042.e0a1edb7.e37a04e4._5a50d80
 * 常见名称示例："星璃问候主人"、"晚上问候"、"消息未打完请补充"
 * @returns {string|null} 自定义名称，未找到返回 null
 */
function getCustomConversationName() {
    try {
        const nameEl = document.querySelector('._9fcbeda._7ee190f .afa34042.e0a1edb7.e37a04e4._5a50d80');
        if (nameEl && nameEl.textContent) {
            return nameEl.textContent.trim();
        }
        return null;
    } catch (e) {
        return null;
    }
}

/**
 * 检测当前活跃会话
 * 优先使用自定义专家模式指示器中的名称，检测失败才回退到 document.title
 * @returns {{id:string, title:string, url:string}|null}
 */
export function getActiveConversation() {
    const id = getConversationIdFromPath();
    if (!id) return null;

    // 优先检测自定义名称（如"星璃问候主人"），失败回退到 document.title
    const customName = getCustomConversationName();
    const title = customName
        || (document.title || '').replace(/\s*-\s*DeepSeek\s*$/i, '').trim()
        || '未命名对话';

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
