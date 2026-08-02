/**
 * 标题伪装模块
 *
 * 定期将浏览器标签页标题替换为随机趣味标题，保护隐私。
 * 通过 setInterval + MutationObserver 监听标题变化并覆盖。
 */
import { CONFIG, DEFAULTS } from '../config.js';

let titleFakerInterval = null;
let titleFakerObserver = null;
let titleFakerVisibilityHandler = null;
let lastTitle = '';
let isSetting = false;

/**
 * 从标题列表中随机选取一个（避免连续重复）
 * @param {string[]} list - 标题列表
 * @returns {string}
 */
function getRandomTitle(list) {
    if (!list?.length) return 'DeepSeek';
    if (list.length === 1) return list[0];
    let newTitle;
    do { newTitle = list[Math.floor(Math.random() * list.length)]; }
    while (newTitle === lastTitle && list.length > 1);
    return newTitle;
}

/**
 * 设置伪造标题（若功能已禁用则跳过）
 */
function setFakeTitle() {
    if (!CONFIG.titleFakerEnabled || isSetting) return;
    isSetting = true;
    try {
        const newTitle = getRandomTitle(CONFIG.titleList || DEFAULTS.titleList);
        if (document.title !== newTitle) {
            document.title = newTitle;
            lastTitle = newTitle;
        }
    } catch (e) {}
    isSetting = false;
}

/**
 * 启动标题伪装：定时器 + 可见性监听 + MutationObserver
 */
export function initTitleFaker() {
    if (!CONFIG.titleFakerEnabled) return;
    setFakeTitle();
    if (titleFakerInterval) clearInterval(titleFakerInterval);
    titleFakerInterval = setInterval(setFakeTitle, 3000);
    // 保存 handler 引用以便后续移除，避免重复绑定导致内存泄漏
    titleFakerVisibilityHandler = () => { if (!document.hidden) setFakeTitle(); };
    document.addEventListener('visibilitychange', titleFakerVisibilityHandler);
    const titleEl = document.querySelector('title');
    if (titleEl) {
        // 断开旧 observer 避免泄漏
        if (titleFakerObserver) titleFakerObserver.disconnect();
        titleFakerObserver = new MutationObserver(() => {
            if (!CONFIG.titleFakerEnabled || (CONFIG.titleList || DEFAULTS.titleList).includes(document.title)) return;
            setFakeTitle();
        });
        titleFakerObserver.observe(titleEl, { childList: true, characterData: true, subtree: true });
    }
}

/**
 * 停止标题伪装：清除定时器、断开 Observer、移除事件监听
 */
export function stopTitleFaker() {
    if (titleFakerInterval) {
        clearInterval(titleFakerInterval);
        titleFakerInterval = null;
    }
    if (titleFakerObserver) {
        titleFakerObserver.disconnect();
        titleFakerObserver = null;
    }
    if (titleFakerVisibilityHandler) {
        document.removeEventListener('visibilitychange', titleFakerVisibilityHandler);
        titleFakerVisibilityHandler = null;
    }
}
