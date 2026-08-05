/**
 * 菜单项注入模块
 *
 * 在 DeepSeek 侧边栏中查找菜单按钮，点击后向下拉菜单中注入"脚本设置"入口。
 * 同时支持手机端 ds-dropdown-menu 下拉菜单的注入。
 * 若找不到菜单按钮，则创建独立的悬浮设置按钮作为备用入口。
 */
import { utils } from '../utils.js';
import { CONFIG } from '../config.js';
import { Platform } from '../platform/bridge.js';
import { showSettings } from './settings-panel.js';

/**
 * i18n 翻译安全 getter
 * window._dsI18n 可用时调用其 t() 方法，否则回退为 key 本身
 * @param {string} k - 点分资源 key（如 'menu.scriptSettingsWithIcon'）
 * @param {Object} [p] - 占位符参数
 * @returns {string} 翻译后的文案；i18n 未初始化时返回 key 本身
 */
const t = (k, p) => (window._dsI18n ? window._dsI18n.t(k, p) : k);

let mobileObserver = null;
let menuBtnRetryTimer = null;
// 记录被临时隐藏的浮动菜单容器及其原始 display 值，用于恢复
const hiddenFloatingWrappers = new Map();

/**
 * 查找 DeepSeek 的菜单按钮（多种选择器兜底）
 * @returns {Element|null}
 */
function findMenuBtn() {
    return document.querySelector('._2afd28d[tabindex="0"]') ||
           document.querySelector('._9d8da05')?.closest('[class*="user"], div[role="button"]') ||
           document.querySelector('[aria-label*="用户"], [aria-label*="User"]') ||
           document.querySelector('svg[viewBox="0 0 16 16"] path[d*="M4.55146 8.00001"]')?.closest('[tabindex="0"], div[role="button"]');
}

/**
 * 判断下拉菜单是否为"用户菜单"（包含退出登录/登出等选项）
 * 只有用户菜单才应该注入"脚本设置"
 * @param {Element} menu - 下拉菜单容器
 * @returns {boolean}
 */
function isUserMenu(menu) {
    if (!menu) return false;
    const text = menu.textContent || '';
    // 匹配多种"退出登录"相关文本
    return /退出|登出|注销|Sign\s*out|Log\s*out|退出登录|退出账号/i.test(text);
}

/**
 * 派发 Esc 键事件以关闭 DeepSeek 下拉菜单
 * Esc 只会关闭已打开的菜单，不会 toggle 菜单按钮状态，是安全的关闭方式
 */
function dispatchEscapeKey() {
    try {
        document.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true
        }));
    } catch (e) {}
}

/**
 * 手机端专用：点击菜单项后显示设置面板
 *
 * 与桌面端 closeDropdownThenShowSettings 的关键区别：
 * 不强制 display:none 隐藏 .ds-floating-position-wrapper，也不阻止 click 冒泡。
 * 让 DeepSeek 的菜单点击处理器自动关闭菜单（setOpen(false)），
 * 这样 React 的 isOpen 状态会正确变为 false，
 * 用户关闭设置面板后再次点击头像，toggle → isOpen=true，菜单能正常打开。
 *
 * 桌面端强制隐藏 wrapper 会导致 React isOpen 仍为 true，
 * 恢复 display 后菜单"假打开"，用户点击头像实际是"关闭"操作，菜单无反应。
 */
function mobileShowSettingsAfterMenuClose() {
    // 兜底：派发 Esc 键，确保即使 DeepSeek 未处理 click 也能关闭菜单
    dispatchEscapeKey();
    // 延迟显示设置面板，等待 DeepSeek 关闭菜单的动画/状态更新
    setTimeout(() => {
        showSettings();
    }, 300);
}

/**
 * 恢复所有被临时隐藏的浮动菜单容器的 display
 * 应在隐藏设置面板后调用，避免下拉菜单永久无法打开
 * 恢复后再触发一次 Esc 键，确保菜单状态同步为"已关闭"，防止 toggle 状态紊乱
 */
export function restoreFloatingWrappers() {
    hiddenFloatingWrappers.forEach((originalDisplay, wrapper) => {
        if (wrapper && document.body.contains(wrapper)) {
            if (originalDisplay === null || originalDisplay === undefined || originalDisplay === '') {
                wrapper.style.removeProperty('display');
            } else {
                wrapper.style.display = originalDisplay;
            }
        }
    });
    hiddenFloatingWrappers.clear();
    // 恢复 wrapper 后触发 Esc，确保如果 DeepSeek 菜单状态仍为"已打开"时被同步关闭
    // 这样下次点击菜单按钮时，状态是"已关闭"，toggle → "已打开"，菜单能正常打开
    dispatchEscapeKey();
}

// 注册全局回调，供 settings-panel.js 调用，避免循环导入
window._dsRestoreFloatingWrappers = restoreFloatingWrappers;

/**
 * 先关闭 DeepSeek 下拉菜单，再显示设置面板
 *
 * 关键：关闭操作在 showSettings() 之前执行，
 * 此时设置面板尚未显示，事件不会影响它。
 *
 * 注意：不使用 body.click()，因为 click 事件冒泡到 document 后，
 * 可能被 DeepSeek 菜单按钮的 toggle 委托监听器误捕获，
 * 导致按钮状态反转（按钮认为"已打开"但 wrapper 被 display:none 隐藏），
 * 用户关闭设置面板后点击菜单按钮实际是"关闭"操作，菜单无法打开。
 * 改用 Esc 键 + mousedown，这两个事件只会触发 onClickOutside 关闭菜单，不会 toggle 按钮。
 */
function closeDropdownThenShowSettings() {
    // 方法1：派发 Esc 键关闭下拉菜单（dropdown 组件通常支持 Esc 关闭，不会 toggle 按钮）
    dispatchEscapeKey();

    // 方法2：派发 mousedown 到 body，触发 onClickOutside 检测（多数库监听 mousedown 而非 click）
    try {
        document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    } catch (e) {}

    // 方法3：隐藏手机端浮动菜单容器（兜底，使用 display:none 避免破坏 React DOM）
    // 重要：保存原始 display 值，后续在隐藏设置面板时恢复，否则下拉菜单永久无法打开
    document.querySelectorAll('.ds-floating-position-wrapper').forEach(w => {
        if (!w.closest('#ds-settings-modal') && !hiddenFloatingWrappers.has(w)) {
            hiddenFloatingWrappers.set(w, w.style.display || null);
            w.style.display = 'none';
        }
    });

    // 等待 DeepSeek 关闭下拉菜单后再显示设置
    setTimeout(() => {
        showSettings();
    }, 200);
}

/**
 * 打开 DeepSeek++ 侧边栏（仅 Electron 桌面端）
 * 通过 IPC 通知主进程打开扩展的 sidepanel.html
 */
function openSidepanel() {
    if (!Platform.isElectron) return;
    try {
        const invoke = (window.__TAURI_INTERNALS__ && typeof window.__TAURI_INTERNALS__.invoke === 'function')
            ? window.__TAURI_INTERNALS__.invoke.bind(window.__TAURI_INTERNALS__)
            : null;
        if (invoke) {
            invoke('open_sidepanel').catch(() => {
                console.warn('[menu-inject] open_sidepanel IPC 失败，尝试备用方案');
                // 备用方案：通过 chrome.runtime 发送消息到扩展
                if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
                    chrome.runtime.sendMessage({ type: 'OPEN_SIDEPANEL' }).catch(() => {});
                }
            });
        }
    } catch (e) {
        console.warn('[menu-inject] 打开侧边栏失败:', e);
    }
}

/**
 * 向桌面端下拉菜单中添加"脚本设置"菜单项
 * 仅对用户菜单（含退出登录选项）生效，避免注入到其他侧边栏菜单
 * @param {Element} menu - 下拉菜单容器
 */
function addMenuItemToMenu(menu) {
    if (!menu || menu.querySelector('#ds-settings-menu-item')) return;
    // 只在有退出登录的用户菜单中注入脚本设置
    if (!isUserMenu(menu)) return;
    const isDark = utils.isDarkMode();
    const sep = document.createElement('div');
    sep.style.cssText = 'height:1px;background:#ddd;margin:4px 0;';
    menu.appendChild(sep);
    const item = document.createElement('div');
    item.id = 'ds-settings-menu-item';
    item.style.cssText = `padding:8px 16px;cursor:pointer;display:flex;align-items:center;gap:8px;color:${isDark?'#e8d5dd':'#4a3040'};font-size:14px;border-radius:4px;`;
    item.innerHTML = t('menu.scriptSettingsWithIcon');
    item.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        // 先关闭下拉菜单，再显示设置
        closeDropdownThenShowSettings();
    });
    menu.appendChild(item);

    // 电子端：添加"打开侧边栏"菜单项
    if (Platform.isElectron) {
        const sidebarItem = document.createElement('div');
        sidebarItem.id = 'ds-sidebar-menu-item';
        sidebarItem.style.cssText = `padding:8px 16px;cursor:pointer;display:flex;align-items:center;gap:8px;color:${isDark?'#e8d5dd':'#4a3040'};font-size:14px;border-radius:4px;`;
        sidebarItem.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="9" y1="3" x2="9" y2="21"/></svg> 打开侧边栏';
        sidebarItem.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            openSidepanel();
            // 关闭下拉菜单
            dispatchEscapeKey();
        });
        menu.appendChild(sidebarItem);

        // 扩展菜单高度以适应新增项
        if (menu.style.maxHeight) {
            menu.style.maxHeight = '500px';
        }
    }
}

/**
 * 向手机端 ds-dropdown-menu 中添加"脚本设置"菜单项
 * 仅对用户菜单（含退出登录选项）生效，避免注入到其他侧边栏菜单
 * 同时移除"下载手机应用"选项（如果启用）
 * @param {Element} menu - ds-dropdown-menu 容器
 */
function addMobileMenuItem(menu) {
    if (!menu || menu.querySelector('#ds-settings-mobile-item')) return;
    // 只在有退出登录的用户菜单中注入脚本设置
    if (!isUserMenu(menu)) return;

    // 移除"下载手机应用"选项（由 removeDownloadAppEnabled 控制）
    if (typeof CONFIG !== 'undefined' && CONFIG.removeDownloadAppEnabled) {
        const options = menu.querySelectorAll('.ds-dropdown-menu-option');
        options.forEach(opt => {
            const label = opt.querySelector('.ds-dropdown-menu-option__label');
            if (label && /下载.*应用|下载.*App/i.test(label.textContent || '')) {
                opt.style.display = 'none';
            }
        });
    }

    const item = document.createElement('div');
    item.id = 'ds-settings-mobile-item';
    item.className = 'ds-dropdown-menu-option ds-dropdown-menu-option--none';
    item.setAttribute('role', 'menuitem');
    item.style.cssText = 'cursor:pointer;';

    // 图标容器
    const iconWrap = document.createElement('div');
    iconWrap.className = 'ds-dropdown-menu-option__icon';
    iconWrap.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zm0 2a4.5 4.5 0 0 1 4.472 4H10.5a2.5 2.5 0 0 0-4.9-.5L4.2 5.6A4.48 4.48 0 0 1 8 3.5zm-4.472 4.5a4.5 4.5 0 0 0 7.272 3.4l-1.6-1.6A2.5 2.5 0 0 1 5.5 8H3.528z" fill="currentColor"></path></svg>`;

    // 标签
    const label = document.createElement('div');
    label.className = 'ds-dropdown-menu-option__label';
    label.textContent = t('menu.scriptSettings');

    item.appendChild(iconWrap);
    item.appendChild(label);

    item.addEventListener('click', (e) => {
        // 仅阻止默认行为，不阻止冒泡：
        // 让 click 事件冒泡到 DeepSeek 的菜单容器，触发其自身的"点击菜单项 → 关闭菜单"逻辑
        // 这样 React 的 isOpen 状态会正确变为 false，避免下次点击头像无法打开菜单
        e.preventDefault();
        mobileShowSettingsAfterMenuClose();
    });

    menu.appendChild(item);

    // 电子端：添加"打开侧边栏"菜单项
    if (Platform.isElectron) {
        const sidebarItem = document.createElement('div');
        sidebarItem.id = 'ds-sidebar-mobile-item';
        sidebarItem.className = 'ds-dropdown-menu-option ds-dropdown-menu-option--none';
        sidebarItem.setAttribute('role', 'menuitem');
        sidebarItem.style.cssText = 'cursor:pointer;';

        const sidebarIconWrap = document.createElement('div');
        sidebarIconWrap.className = 'ds-dropdown-menu-option__icon';
        sidebarIconWrap.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="9" y1="3" x2="9" y2="21"/></svg>';

        const sidebarLabel = document.createElement('div');
        sidebarLabel.className = 'ds-dropdown-menu-option__label';
        sidebarLabel.textContent = '打开侧边栏';

        sidebarItem.appendChild(sidebarIconWrap);
        sidebarItem.appendChild(sidebarLabel);

        sidebarItem.addEventListener('click', (e) => {
            e.preventDefault();
            openSidepanel();
            dispatchEscapeKey();
        });

        menu.appendChild(sidebarItem);

        // 扩展移动端菜单高度
        menu.style.maxHeight = '600px';
    }
}

/**
 * 移除独立悬浮设置按钮（当菜单按钮找到后）
 */
function removeStandaloneButton() {
    const btn = document.getElementById('ds-standalone-settings');
    if (btn) btn.remove();
}

/**
 * 注入菜单项：监听菜单按钮点击，在下拉菜单出现后注入设置入口
 * 同时监听手机端 ds-dropdown-menu 的出现
 * 使用重试机制确保晚出现的菜单按钮也能被绑定
 */
export function injectMenuItem() {
    let btn = findMenuBtn();

    if (btn) {
        attachMenuListener(btn);
        removeStandaloneButton();
    } else {
        // 菜单按钮可能尚未加载，创建悬浮按钮并重试查找
        createStandaloneSettingsButton();

        // 定期重试查找菜单按钮（最多 15 秒）
        let retries = 0;
        menuBtnRetryTimer = setInterval(() => {
            btn = findMenuBtn();
            if (btn) {
                clearInterval(menuBtnRetryTimer);
                menuBtnRetryTimer = null;
                attachMenuListener(btn);
                removeStandaloneButton();
            } else if (++retries > 30) {
                clearInterval(menuBtnRetryTimer);
                menuBtnRetryTimer = null;
            }
        }, 500);
    }

    // 手机端：监听 ds-dropdown-menu 的出现
    if (mobileObserver) mobileObserver.disconnect();
    mobileObserver = new MutationObserver(() => {
        const mobileMenu = document.querySelector('.ds-dropdown-menu');
        if (mobileMenu && mobileMenu.querySelector('.ds-dropdown-menu-option')) {
            // 确保不是我们自己的设置面板
            if (!mobileMenu.closest('#ds-settings-modal')) {
                addMobileMenuItem(mobileMenu);
            }
        }
    });
    mobileObserver.observe(document.body, { childList: true, subtree: true });
}

/**
 * 给菜单按钮绑定点击监听，等待下拉菜单出现后注入
 * @param {Element} btn
 */
function attachMenuListener(btn) {
    btn.addEventListener('click', () => {
        let attempts = 0;
        const tryAdd = () => {
            const menu = document.querySelector('[role="menu"]') ||
                        document.querySelector('.ds-dropdown-menu') ||
                        document.querySelector('[class*="dropdown"]');
            if (menu) {
                if (menu.classList.contains('ds-dropdown-menu') &&
                    menu.querySelector('.ds-dropdown-menu-option')) {
                    addMobileMenuItem(menu);
                } else {
                    addMenuItemToMenu(menu);
                }
                return;
            }
            if (++attempts < 20) requestAnimationFrame(tryAdd);
        };
        requestAnimationFrame(tryAdd);
    });
}

/**
 * 创建独立悬浮设置按钮（备用入口）
 */
function createStandaloneSettingsButton() {
    if (document.getElementById('ds-standalone-settings')) return;
    const btn = document.createElement('div');
    btn.id = 'ds-standalone-settings';
    btn.innerHTML = '⚙️';
    btn.style.cssText = `position:fixed;bottom:20px;right:20px;width:44px;height:44px;border-radius:50%;background:${utils.isDarkMode()?'#e895a8':'#f08ca8'};color:#fff;font-size:22px;display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 4px 12px rgba(0,0,0,0.3);z-index:99999;transition:transform 0.2s;`;
    btn.addEventListener('mouseenter', () => btn.style.transform = 'scale(1.1)');
    btn.addEventListener('mouseleave', () => btn.style.transform = 'scale(1)');
    btn.addEventListener('click', showSettings);
    document.body.appendChild(btn);
}
