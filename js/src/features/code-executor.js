/**
 * 代码块执行按钮模块
 *
 * 在代码块（bash/bat/powershell）的复制按钮左边注入"执行"按钮，
 * 点击后弹出下拉菜单选择终端类型：
 *   - Tauri 桌面端：cmd / PowerShell
 *   - Windows 桌面端（旧 Playwright）：cmd / PowerShell
 *   - Android WebView：Termux
 *   - 篡改猴环境：不支持（降级提示）
 *
 * 平台识别：
 *   - window.__TAURI__ → Tauri 桌面端
 *   - window.AndroidBridge → Android WebView
 *   - window.DesktopBridge → 桌面端（旧 Playwright 方案）
 *   - 其他 → 篡改猴/浏览器
 */
import { Platform } from '../platform/bridge.js';

// 支持执行的语言标签
const EXECUTABLE_LANGS = new Set(['bash', 'bat', 'powershell', 'sh', 'cmd', 'shell']);

// 已处理过的代码块（避免重复注入按钮）
const processedBlocks = new WeakSet();

let installed = false;

/**
 * 检测当前平台
 * @returns {'desktop' | 'android' | 'tampermonkey'}
 */
function detectPlatform() {
    if (Platform.isElectron) return 'desktop';
    if (Platform.isWebView) return 'android';
    if (typeof window !== 'undefined' && window.DesktopBridge) return 'desktop';
    return 'tampermonkey';
}

/**
 * 获取可用的终端列表
 * @param {string} platform - 平台类型
 * @returns {Array<{id: string, label: string}>}
 */
function getTerminals(platform) {
    if (platform === 'desktop') {
        return [
            { id: 'cmd', label: 'CMD' },
            { id: 'powershell', label: 'PowerShell' }
        ];
    }
    if (platform === 'android') {
        return [
            { id: 'termux', label: 'Termux' }
        ];
    }
    return [];
}

/**
 * 创建执行按钮 DOM
 * @returns {HTMLElement}
 */
function createExecButton() {
    const btn = document.createElement('div');
    btn.className = 'ds-button ds-button--borderlessNeutral ds-button--borderless ds-button--capsule ds-button--xs ds-button--icon-relative-m ds-button--min-width';
    btn.setAttribute('role', 'button');
    btn.setAttribute('tabindex', '0');
    btn.style.marginRight = '2px';
    btn.innerHTML = `
        <div class="ds-button__background"></div>
        <div class="ds-button__icon">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M5.5 3.5L11 8L5.5 12.5V3.5Z" fill="currentColor" stroke="currentColor" stroke-width="1" stroke-linejoin="round"/>
            </svg>
        </div>
        <span class="ds-button__content"><span class="code-info-button-text">执行</span></span>
    `;
    return btn;
}

/**
 * 创建终端选择下拉菜单
 * @param {Array<{id: string, label: string}>} terminals
 * @param {string} codeText - 要执行的代码
 * @param {HTMLElement} anchorEl - 锚点元素（用于定位）
 * @returns {HTMLElement}
 */
function createDropdown(terminals, codeText, anchorEl) {
    // 移除已有的下拉菜单
    const existing = document.querySelector('.ds-exec-dropdown');
    if (existing) existing.remove();

    const dropdown = document.createElement('div');
    dropdown.className = 'ds-exec-dropdown';
    dropdown.style.cssText = `
        position: absolute; z-index: 99999; min-width: 140px;
        background: var(--anime-card-bg, #fff); border-radius: 8px;
        box-shadow: 0 4px 16px rgba(0,0,0,0.15); padding: 4px 0;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 13px;
    `;

    terminals.forEach(term => {
        const item = document.createElement('div');
        item.className = 'ds-exec-dropdown-item';
        item.textContent = term.label;
        item.style.cssText = `
            padding: 8px 16px; cursor: pointer; transition: background 0.15s;
            color: var(--anime-text-primary, #333); white-space: nowrap;
        `;
        item.addEventListener('mouseenter', () => {
            item.style.background = 'var(--anime-primary, #e8e8e8)';
            item.style.color = '#fff';
        });
        item.addEventListener('mouseleave', () => {
            item.style.background = '';
            item.style.color = '';
        });
        item.addEventListener('click', (e) => {
            e.stopPropagation();
            dropdown.remove();
            executeCode(term.id, codeText);
        });
        dropdown.appendChild(item);
    });

    document.body.appendChild(dropdown);

    // 定位下拉菜单
    const rect = anchorEl.getBoundingClientRect();
    const dropdownHeight = terminals.length * 36 + 8;
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;

    if (spaceBelow >= dropdownHeight || spaceBelow >= spaceAbove) {
        dropdown.style.top = (rect.bottom + 4) + 'px';
    } else {
        dropdown.style.top = (rect.top - dropdownHeight - 4) + 'px';
    }

    // 水平居中于按钮
    const left = rect.left + rect.width / 2 - 70;
    dropdown.style.left = Math.max(4, Math.min(left, window.innerWidth - 144)) + 'px';

    return dropdown;
}

/**
 * 执行代码
 * @param {string} terminalId - 终端ID（cmd/powershell/termux）
 * @param {string} codeText - 要执行的代码
 */
function executeCode(terminalId, codeText) {
    const platform = detectPlatform();

    // 桌面端（Electron 或旧 Playwright）：通过 Platform.execInTerminal
    if (platform === 'desktop') {
        // Electron 使用 IPC，旧 Playwright 使用 DesktopBridge
        if (Platform.isElectron) {
            Platform.execInTerminal(terminalId, codeText).then(() => {
                showToast('已发送到 ' + (terminalId === 'cmd' ? 'CMD' : 'PowerShell'));
            }).catch((e) => {
                showToast('执行失败: ' + (e.message || '未知错误'), true);
            });
            return;
        }
        // 旧 Playwright 方案
        try {
            window.DesktopBridge.execInTerminal(terminalId, codeText);
            showToast('已发送到 ' + (terminalId === 'cmd' ? 'CMD' : 'PowerShell'));
        } catch (e) {
            showToast('执行失败: ' + e.message, true);
        }
        return;
    }

    // Android：通过 bridge 异步调用 Termux
    if (platform === 'android') {
        Platform.execInTerminal(terminalId, codeText).then(() => {
            showToast('已发送到 Termux');
        }).catch((e) => {
            showToast('执行失败: ' + (e.message || 'Termux 不可用'), true);
        });
        return;
    }

    // 篡改猴：不支持
    showToast('当前环境不支持终端执行', true);
}

/**
 * 显示 Toast 提示
 * @param {string} message
 * @param {boolean} [isError=false]
 */
function showToast(message, isError = false) {
    const existing = document.querySelector('.ds-exec-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'ds-exec-toast';
    toast.innerHTML = `
        <div class="ds-exec-toast-icon" style="background:${isError ? '#ff4d4f' : '#52c41a'}">
            <svg viewBox="0 0 24 24" style="width:12px;height:12px;fill:none;stroke:#fff;stroke-width:2.5;stroke-linecap:round;stroke-linejoin:round">
                ${isError
                    ? '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>'
                    : '<polyline points="20 6 9 17 4 12"/>'}
            </svg>
        </div>
        <span>${message}</span>
    `;
    toast.style.cssText = `
        position:fixed;top:16px;left:50%;transform:translateX(-50%) translateY(-20px);
        background:#fff;border-radius:8px;padding:12px 20px;
        box-shadow:0 4px 16px rgba(0,0,0,0.12);display:flex;align-items:center;gap:8px;
        z-index:999999;opacity:0;transition:all 0.3s ease;
        font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
        font-size:14px;color:#333;
    `;
    document.body.appendChild(toast);
    requestAnimationFrame(() => { toast.style.opacity = '1'; toast.style.transform = 'translateX(-50%) translateY(0)'; });
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(-50%) translateY(-20px)';
        setTimeout(() => toast.remove(), 300);
    }, 2000);
}

/**
 * 从代码块中提取语言标签
 * @param {Element} codeBlock - .md-code-block 元素
 * @returns {string|null} 语言标签（小写），无法识别返回 null
 */
function extractLang(codeBlock) {
    // 查找语言标签 span（如 .d813de27）
    const langSpan = codeBlock.querySelector('.d813de27');
    if (langSpan) {
        return langSpan.textContent.trim().toLowerCase();
    }
    // 备选：查找 md-code-block-banner 中的第一个 span
    const banner = codeBlock.querySelector('.md-code-block-banner');
    if (banner) {
        const spans = banner.querySelectorAll('span');
        for (const span of spans) {
            const text = span.textContent.trim().toLowerCase();
            if (EXECUTABLE_LANGS.has(text)) return text;
        }
    }
    return null;
}

/**
 * 从代码块中提取代码文本
 * @param {Element} codeBlock - .md-code-block 元素
 * @returns {string}
 */
function extractCodeText(codeBlock) {
    const pre = codeBlock.querySelector('pre');
    if (pre) return pre.textContent || '';
    return '';
}

/**
 * 为代码块注入执行按钮
 * @param {Element} codeBlock - .md-code-block 元素
 */
function injectExecButton(codeBlock) {
    if (processedBlocks.has(codeBlock)) return;

    const lang = extractLang(codeBlock);
    if (!lang || !EXECUTABLE_LANGS.has(lang)) return;

    processedBlocks.add(codeBlock);

    // 找到按钮行容器 .efa13877（复制/下载按钮所在行）
    // 注意：._246a029 是 .efa13877 的父容器，不能直接用它，
    // 否则 insertBefore 会把按钮插入到按钮行上方而非左侧
    const btnRow = codeBlock.querySelector('.efa13877');
    if (!btnRow) return;

    // 检查是否已有执行按钮
    if (btnRow.querySelector('.ds-exec-btn')) return;

    const execBtn = createExecButton();
    execBtn.classList.add('ds-exec-btn');

    // 插入到按钮行第一个子元素之前（在复制按钮左边）
    const firstChild = btnRow.firstChild;
    if (firstChild) {
        btnRow.insertBefore(execBtn, firstChild);
    } else {
        btnRow.appendChild(execBtn);
    }

    const codeText = extractCodeText(codeBlock);
    const platform = detectPlatform();
    const terminals = getTerminals(platform);

    if (terminals.length === 0) return;

    // 点击执行按钮：显示下拉菜单或直接执行
    execBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        // 关闭已有的下拉菜单
        const existing = document.querySelector('.ds-exec-dropdown');
        if (existing) { existing.remove(); return; }
        // 只有一个终端时直接执行
        if (terminals.length === 1) {
            executeCode(terminals[0].id, codeText);
        } else {
            createDropdown(terminals, codeText, execBtn);
        }
    });
}

/**
 * 全局点击事件：关闭下拉菜单
 * @param {Event} e
 */
function handleGlobalClick(e) {
    const dropdown = document.querySelector('.ds-exec-dropdown');
    if (dropdown && !e.target.closest('.ds-exec-btn') && !e.target.closest('.ds-exec-dropdown')) {
        dropdown.remove();
    }
}

/**
 * 扫描页面中所有代码块并注入执行按钮
 */
function scanCodeBlocks() {
    const codeBlocks = document.querySelectorAll('.md-code-block');
    codeBlocks.forEach(injectExecButton);
}

/**
 * 使用 MutationObserver 监听新代码块的出现
 */
function startObserver() {
    const observer = new MutationObserver((mutations) => {
        let hasNewNodes = false;
        for (const mutation of mutations) {
            if (mutation.addedNodes.length > 0) {
                hasNewNodes = true;
                break;
            }
        }
        if (hasNewNodes) {
            // 使用 requestAnimationFrame 避免频繁触发
            requestAnimationFrame(scanCodeBlocks);
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });
}

/**
 * 初始化代码执行器
 */
export function initCodeExecutor() {
    if (installed) return;
    installed = true;

    const platform = detectPlatform();
    const terminals = getTerminals(platform);

    // 篡改猴环境且无可用终端，跳过
    if (platform === 'tampermonkey' && terminals.length === 0) {
        console.log('[code-executor] 当前环境不支持终端执行');
        return;
    }

    // 初始扫描
    scanCodeBlocks();

    // 监听新代码块
    startObserver();

    // 全局点击关闭下拉菜单
    document.addEventListener('click', handleGlobalClick, true);

    console.log('[code-executor] 已初始化, platform:', platform, ', terminals:', terminals.map(t => t.id));
}