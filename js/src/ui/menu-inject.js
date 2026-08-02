/**
 * 菜单项注入模块
 *
 * 在 DeepSeek 侧边栏中查找菜单按钮，点击后向下拉菜单中注入"脚本设置"入口。
 * 同时支持手机端 ds-dropdown-menu 下拉菜单的注入。
 * 若找不到菜单按钮，则创建独立的悬浮设置按钮作为备用入口。
 */
import { utils } from '../utils.js';
import { CONFIG } from '../config.js';
import { showSettings } from './settings-panel.js';

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
 * 恢复所有被临时隐藏的浮动菜单容器的 display
 * 应在隐藏设置面板后调用，避免下拉菜单永久无法打开
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
}

// 注册全局回调，供 settings-panel.js 调用，避免循环导入
window._dsRestoreFloatingWrappers = restoreFloatingWrappers;

/**
 * 先关闭 DeepSeek 下拉菜单，再显示设置面板
 *
 * 关键：关闭操作在 showSettings() 之前执行，
 * 此时设置面板尚未显示，click 事件不会影响它。
 */
function closeDropdownThenShowSettings() {
    // 关闭 DeepSeek 下拉菜单
    // 注意：不使用 btn.click()，因为它是 toggle（切换）行为——
    // 若点击菜单项时 DeepSeek 已自动关闭下拉菜单，btn.click() 会重新打开它，
    // 再被 body.click() 关闭，导致 DeepSeek 内部状态紊乱，
    // 第二次点击菜单按钮时将无法正常打开下拉菜单。
    // 改用 Esc 键 + mousedown/click 外部事件，这些操作只会关闭菜单，不会 toggle。

    // 方法1：派发 Esc 键关闭下拉菜单（dropdown 组件通常支持 Esc 关闭）
    try {
        document.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true
        }));
    } catch (e) {}

    // 方法2：派发 mousedown 到 body，触发 onClickOutside 检测（多数库监听 mousedown 而非 click）
    try {
        document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    } catch (e) {}

    // 方法3：派发 click 到 body 触发 DeepSeek 的外部点击检测（兜底）
    try { document.body.click(); } catch (e) {}

    // 方法4：隐藏手机端浮动菜单容器（兜底，使用 display:none 避免破坏 React DOM）
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
    item.innerHTML = '⚙️ 脚本设置';
    item.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        // 先关闭下拉菜单，再显示设置
        closeDropdownThenShowSettings();
    });
    menu.appendChild(item);
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
    label.textContent = '脚本设置';

    item.appendChild(iconWrap);
    item.appendChild(label);

    item.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        // 先关闭下拉菜单，再显示设置
        closeDropdownThenShowSettings();
    });

    menu.appendChild(item);
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
