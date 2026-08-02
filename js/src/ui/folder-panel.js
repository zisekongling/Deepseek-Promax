/**
 * 文件夹管理 - 侧边栏嵌入面板
 *
 * 在 DeepSeek 侧边栏顶部嵌入文件夹管理面板，支持：
 *   - 两层文件夹层级结构（文件夹 > 子文件夹 > 会话）
 *   - 创建/重命名/删除文件夹
 *   - 添加当前会话到文件夹
 *   - 点击会话跳转
 *   - 折叠/展开文件夹
 *   - 置顶文件夹
 *   - 导入/导出
 *
 * 挂载策略：通过查找 a[href*="/chat/s/"] 定位侧边栏容器，在其顶部插入面板。
 * 如果找不到侧边栏，降级为不显示（不影响其他功能）。
 *
 * 从 DeepSeek-Enhancer 项目移植，React 组件改为纯 DOM 操作。
 */

import { CONFIG } from '../config.js';
import { FolderStore } from '../features/folder-store.js';
import {
    findSidebar,
    getActiveConversation,
    autoCacheCurrentConversation,
    getSidebarConversations,
} from '../features/conversation-detector.js';

const PANEL_ID = 'dspro-folder-panel';
const STYLE_ID = 'dspro-folder-panel-style';
let mounted = false;
let lastUrl = '';

/** 注入面板样式（仅一次） */
function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
        #${PANEL_ID} {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            font-size: 13px;
            padding: 8px;
            margin-bottom: 4px;
            border-bottom: 1px solid rgba(128,128,128,0.15);
            max-height: 280px;
            overflow-y: auto;
            flex-shrink: 0;
        }
        #${PANEL_ID}::-webkit-scrollbar { width: 4px; }
        #${PANEL_ID}::-webkit-scrollbar-thumb { background: rgba(128,128,128,0.3); border-radius: 2px; }
        .fp-header {
            display: flex; align-items: center; justify-content: space-between;
            margin-bottom: 6px; padding: 0 2px;
        }
        .fp-title { font-weight: 600; font-size: 13px; display: flex; align-items: center; gap: 4px; }
        .fp-actions { display: flex; gap: 4px; }
        .fp-btn {
            border: none; border-radius: 4px; padding: 2px 6px; cursor: pointer;
            font-size: 12px; line-height: 1.4; background: transparent; color: inherit;
        }
        .fp-btn:hover { background: rgba(128,128,128,0.15); }
        .fp-folder-row {
            display: flex; align-items: center; gap: 2px; padding: 3px 4px;
            border-radius: 4px; cursor: pointer; user-select: none;
        }
        .fp-folder-row:hover { background: rgba(128,128,128,0.1); }
        .fp-folder-row.active { background: rgba(128,128,128,0.15); }
        .fp-toggle { width: 14px; text-align: center; font-size: 10px; flex-shrink: 0; transition: transform 0.15s; }
        .fp-toggle.collapsed { transform: rotate(-90deg); }
        .fp-folder-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .fp-folder-ops { display: none; gap: 1px; flex-shrink: 0; }
        .fp-folder-row:hover .fp-folder-ops { display: flex; }
        .fp-folder-ops button {
            border: none; background: transparent; cursor: pointer; padding: 1px 3px;
            font-size: 11px; border-radius: 3px; color: inherit; opacity: 0.7;
        }
        .fp-folder-ops button:hover { background: rgba(128,128,128,0.2); opacity: 1; }
        .fp-children { margin-left: 16px; display: block; }
        .fp-children.hidden { display: none; }
        .fp-item-row {
            display: flex; align-items: center; gap: 4px; padding: 3px 4px 3px 20px;
            border-radius: 4px; cursor: pointer; user-select: none;
        }
        .fp-item-row:hover { background: rgba(128,128,128,0.1); }
        .fp-item-title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
        .fp-item-del { display: none; border: none; background: transparent; cursor: pointer; padding: 1px 3px; font-size: 11px; opacity: 0.7; color: inherit; }
        .fp-item-row:hover .fp-item-del { display: block; }
        .fp-item-del:hover { color: #ef4444; opacity: 1; }
        .fp-empty { color: rgba(128,128,128,0.5); font-size: 12px; padding: 8px 4px; text-align: center; }
        .fp-add-current {
            display: flex; align-items: center; justify-content: center; gap: 4px;
            margin-top: 6px; padding: 4px 8px; border-radius: 4px; cursor: pointer;
            font-size: 12px; border: 1px dashed rgba(128,128,128,0.3); background: transparent; color: inherit;
        }
        .fp-add-current:hover { background: rgba(128,128,128,0.1); border-color: rgba(128,128,128,0.5); }
        .fp-select-overlay {
            position: fixed; top: 0; left: 0; right: 0; bottom: 0; z-index: 99998;
            background: transparent; display: flex; align-items: center; justify-content: center;
        }
        .fp-select-dialog {
            background: var(--dsw-alias-bg-layer-2, #fff); color: var(--dsw-alias-label-primary, #333);
            border-radius: 12px; padding: 16px; min-width: 280px; max-width: 360px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.2); z-index: 99999;
        }
        .fp-select-dialog h3 { margin: 0 0 12px; font-size: 15px; font-weight: 600; }
        .fp-select-list { max-height: 240px; overflow-y: auto; margin-bottom: 12px; }
        .fp-select-item {
            display: flex; align-items: center; gap: 8px; padding: 8px 12px;
            border-radius: 6px; cursor: pointer; font-size: 13px;
        }
        .fp-select-item:hover { background: rgba(128,128,128,0.12); }
        .fp-select-cancel { width: 100%; padding: 6px; border: none; border-radius: 6px; cursor: pointer; background: rgba(128,128,128,0.15); color: inherit; font-size: 13px; }
        .fp-input-dialog {
            background: var(--dsw-alias-bg-layer-2, #fff); color: var(--dsw-alias-label-primary, #333);
            border-radius: 12px; padding: 20px; min-width: 300px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.2); z-index: 99999;
        }
        .fp-input-dialog h3 { margin: 0 0 12px; font-size: 15px; font-weight: 600; }
        .fp-input-dialog input {
            width: 100%; padding: 8px 12px; border: 1px solid rgba(128,128,128,0.3);
            border-radius: 6px; font-size: 14px; background: transparent; color: inherit; box-sizing: border-box;
        }
        .fp-input-dialog input:focus { outline: none; border-color: var(--dsw-alias-brand-primary, #007bff); }
        .fp-input-actions { display: flex; gap: 8px; margin-top: 12px; }
        .fp-input-actions button {
            flex: 1; padding: 6px 12px; border: none; border-radius: 6px; cursor: pointer; font-size: 13px;
        }
        .fp-input-actions .fp-confirm { background: var(--dsw-alias-brand-primary, #007bff); color: #fff; }
        .fp-input-actions .fp-cancel { background: rgba(128,128,128,0.15); color: inherit; }
    `;
    document.head.appendChild(style);
}

/** HTML 转义 */
function esc(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
}

/**
 * 渲染文件夹面板内容
 * @param {HTMLElement} container
 */
function renderPanel(container) {
    const data = FolderStore.getData();
    const rootFolders = data.folders
        .filter(f => !f.parentId)
        .sort((a, b) => (b.pinned - a.pinned) || (a.order - b.order));

    let html = `
        <div class="fp-header">
            <span class="fp-title">📁 文件夹</span>
            <div class="fp-actions">
                <button class="fp-btn" data-action="new-root" title="新建文件夹">＋</button>
                <button class="fp-btn" data-action="export" title="导出">⬇</button>
                <button class="fp-btn" data-action="import" title="导入">⬆</button>
            </div>
        </div>
    `;

    if (rootFolders.length === 0 && data.items.length === 0) {
        html += `<div class="fp-empty">暂无文件夹，点击 + 创建</div>`;
    } else {
        html += '<div class="fp-tree">';
        for (const folder of rootFolders) {
            html += renderFolderV2(folder, data);
        }
        html += '</div>';
    }

    const active = getActiveConversation();
    if (active) {
        html += `<button class="fp-add-current" data-action="add-current">📌 收藏当前会话到文件夹</button>`;
    }

    container.innerHTML = html;
}

/** 折叠状态缓存（内存中，刷新后重置） */
const _collapsedSet = new Set();

/**
 * 判断文件夹是否折叠
 * @param {string} folderId
 * @returns {boolean}
 */
function isFolderCollapsed(folderId) {
    return _collapsedSet.has(folderId);
}

/**
 * 渲染单个文件夹（使用 _collapsedSet 管理折叠状态）
 * @param {object} folder
 * @param {object} data
 * @param {number} [depth=0]
 * @returns {string}
 */
function renderFolderV2(folder, data, depth = 0) {
    const subFolders = data.folders
        .filter(f => f.parentId === folder.id)
        .sort((a, b) => a.order - b.order);
    const items = data.items
        .filter(i => i.folderId === folder.id)
        .sort((a, b) => a.order - b.order);
    const hasChildren = subFolders.length > 0 || items.length > 0;
    const isExpanded = !isFolderCollapsed(folder.id);

    let html = `
        <div class="fp-folder-row" data-folder-id="${esc(folder.id)}">
            <span class="fp-toggle ${isExpanded ? '' : 'collapsed'}" data-action="toggle" data-folder-id="${esc(folder.id)}">${hasChildren ? '▼' : '·'}</span>
            <span class="fp-folder-name" data-action="toggle" data-folder-id="${esc(folder.id)}">${folder.pinned ? '📌 ' : '📁 '}${esc(folder.name)}</span>
            <span class="fp-folder-ops">
                ${depth === 0 ? `<button data-action="add-sub" data-folder-id="${esc(folder.id)}" title="新建子文件夹">＋</button>` : ''}
                <button data-action="rename" data-folder-id="${esc(folder.id)}" title="重命名">✏</button>
                <button data-action="pin" data-folder-id="${esc(folder.id)}" title="置顶">${folder.pinned ? '📍' : '📌'}</button>
                <button data-action="delete" data-folder-id="${esc(folder.id)}" title="删除">🗑</button>
            </span>
        </div>
    `;

    if (hasChildren) {
        html += `<div class="fp-children ${isExpanded ? '' : 'hidden'}" data-children-of="${esc(folder.id)}">`;
        for (const sub of subFolders) {
            html += renderFolderV2(sub, data, depth + 1);
        }
        for (const item of items) {
            html += `
                <div class="fp-item-row" data-item-id="${esc(item.id)}" data-url="${esc(item.url)}" title="${esc(item.title)}">
                    <span class="fp-item-title" data-action="open-item" data-url="${esc(item.url)}">💬 ${esc(item.title)}</span>
                    <button class="fp-item-del" data-action="del-item" data-item-id="${esc(item.id)}" title="移除">✕</button>
                </div>
            `;
        }
        html += `</div>`;
    }

    return html;
}

/**
 * 显示输入对话框
 * @param {string} title
 * @param {string} [defaultValue]
 * @param {string} [placeholder]
 * @returns {Promise<string|null>}
 */
function showInputDialog(title, defaultValue = '', placeholder = '') {
    return new Promise(resolve => {
        const overlay = document.createElement('div');
        overlay.className = 'fp-select-overlay';
        overlay.innerHTML = `
            <div class="fp-input-dialog">
                <h3>${esc(title)}</h3>
                <input type="text" value="${esc(defaultValue)}" placeholder="${esc(placeholder)}" />
                <div class="fp-input-actions">
                    <button class="fp-cancel">取消</button>
                    <button class="fp-confirm">确定</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        const input = overlay.querySelector('input');
        input.focus();
        input.select();
        const close = (value) => { overlay.remove(); resolve(value); };
        overlay.querySelector('.fp-cancel').addEventListener('click', () => close(null));
        overlay.querySelector('.fp-confirm').addEventListener('click', () => close(input.value.trim()));
        input.addEventListener('keydown', e => {
            if (e.key === 'Enter') close(input.value.trim());
            if (e.key === 'Escape') close(null);
        });
        overlay.addEventListener('click', e => { if (e.target === overlay) close(null); });
    });
}

/**
 * 显示文件夹选择对话框（用于收藏当前会话）
 * @returns {Promise<string|null>} folderId
 */
function showFolderSelectDialog() {
    return new Promise(resolve => {
        const data = FolderStore.getData();
        const folders = data.folders.sort((a, b) => (b.pinned - a.pinned) || (a.order - b.order));
        const overlay = document.createElement('div');
        overlay.className = 'fp-select-overlay';
        let listHtml = '';
        if (folders.length === 0) {
            listHtml = '<div style="text-align:center;padding:16px;color:rgba(128,128,128,0.6);">请先创建文件夹</div>';
        } else {
            for (const f of folders) {
                const indent = f.parentId ? '　' : '';
                listHtml += `<div class="fp-select-item" data-folder-id="${esc(f.id)}">${indent}${f.pinned ? '📌' : '📁'} ${esc(f.name)}</div>`;
            }
        }
        overlay.innerHTML = `
            <div class="fp-select-dialog">
                <h3>选择目标文件夹</h3>
                <div class="fp-select-list">${listHtml}</div>
                <button class="fp-select-cancel">取消</button>
            </div>
        `;
        document.body.appendChild(overlay);
        const close = (value) => { overlay.remove(); resolve(value); };
        overlay.querySelector('.fp-select-cancel').addEventListener('click', () => close(null));
        overlay.querySelectorAll('.fp-select-item').forEach(item => {
            item.addEventListener('click', () => close(item.dataset.folderId));
        });
        overlay.addEventListener('click', e => { if (e.target === overlay) close(null); });
    });
}

/**
 * 处理面板内点击事件（事件委托）
 * @param {Event} e
 */
function handlePanelClick(e) {
    const target = e.target.closest('[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    const folderId = target.dataset.folderId;
    const itemId = target.dataset.itemId;
    const url = target.dataset.url;
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;

    switch (action) {
        case 'toggle': {
            if (folderId) {
                if (_collapsedSet.has(folderId)) _collapsedSet.delete(folderId);
                else _collapsedSet.add(folderId);
                renderPanel(panel);
            }
            break;
        }
        case 'new-root': {
            showInputDialog('新建文件夹', '', '请输入文件夹名称').then(name => {
                if (name) { FolderStore.createFolder(name); renderPanel(panel); }
            });
            break;
        }
        case 'add-sub': {
            showInputDialog('新建子文件夹', '', '请输入子文件夹名称').then(name => {
                if (name) { FolderStore.createFolder(name, folderId); renderPanel(panel); }
            });
            break;
        }
        case 'rename': {
            const folder = FolderStore.getData().folders.find(f => f.id === folderId);
            showInputDialog('重命名文件夹', folder?.name || '', '请输入新名称').then(name => {
                if (name) { FolderStore.renameFolder(folderId, name); renderPanel(panel); }
            });
            break;
        }
        case 'pin': {
            FolderStore.togglePin(folderId);
            renderPanel(panel);
            break;
        }
        case 'delete': {
            if (confirm('确定删除此文件夹及其所有内容？')) {
                FolderStore.deleteFolder(folderId);
                renderPanel(panel);
            }
            break;
        }
        case 'open-item': {
            if (url) {
                e.preventDefault();
                e.stopPropagation();
                window.location.assign(url);
            }
            break;
        }
        case 'del-item': {
            e.preventDefault();
            e.stopPropagation();
            FolderStore.removeConversation(itemId);
            renderPanel(panel);
            break;
        }
        case 'add-current': {
            const active = getActiveConversation();
            if (active) {
                showFolderSelectDialog().then(fid => {
                    if (fid) {
                        FolderStore.addConversation(fid, active);
                        renderPanel(panel);
                    }
                });
            }
            break;
        }
        case 'export': {
            const payload = FolderStore.exportData();
            const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `dspro-folders-${Date.now()}.json`;
            a.click();
            URL.revokeObjectURL(a.href);
            break;
        }
        case 'import': {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.json';
            input.addEventListener('change', () => {
                const file = input.files[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = () => {
                    try {
                        const payload = JSON.parse(reader.result);
                        const strategy = confirm('点击"确定"合并到现有数据，点击"取消"覆盖现有数据') ? 'merge' : 'overwrite';
                        FolderStore.importData(payload, strategy);
                        renderPanel(panel);
                    } catch (err) {
                        alert('导入失败: ' + err.message);
                    }
                };
                reader.readAsText(file);
            });
            input.click();
            break;
        }
    }
}

/**
 * 挂载文件夹面板到侧边栏
 * @returns {boolean} 是否成功挂载
 */
function mountPanel() {
    const sidebar = findSidebar();
    if (!sidebar) return false;
    let panel = document.getElementById(PANEL_ID);
    if (!panel) {
        panel = document.createElement('div');
        panel.id = PANEL_ID;
        panel.addEventListener('click', handlePanelClick);
        sidebar.prepend(panel);
    }
    // 检查面板是否仍在 DOM 中（DeepSeek 可能重新渲染侧边栏）
    if (!document.contains(panel)) {
        panel = document.createElement('div');
        panel.id = PANEL_ID;
        panel.addEventListener('click', handlePanelClick);
        sidebar.prepend(panel);
    }
    renderPanel(panel);
    return true;
}

/**
 * 初始化文件夹面板
 * 使用 MutationObserver 监听侧边栏变化，自动挂载/重新挂载
 */
export function initFolderPanel() {
    if (mounted) return;
    mounted = true;
    injectStyle();

    // 自动缓存当前会话
    autoCacheCurrentConversation();

    // 尝试挂载
    if (!mountPanel()) {
        // 侧边栏可能尚未加载，使用 observer 等待
        const bodyObserver = new MutationObserver(() => {
            if (mountPanel()) {
                // 挂载成功后切换为轻量 observer，只监听侧边栏变化
                bodyObserver.disconnect();
                observeSidebarChanges();
            }
        });
        bodyObserver.observe(document.body, { childList: true, subtree: true });

        // 10 秒后停止重试
        setTimeout(() => bodyObserver.disconnect(), 10000);
        return;
    }

    observeSidebarChanges();
}

/**
 * 监听侧边栏变化和 URL 变化
 */
function observeSidebarChanges() {
    // URL 变化时自动缓存当前会话并刷新面板
    const checkUrlChange = () => {
        if (location.href !== lastUrl) {
            lastUrl = location.href;
            autoCacheCurrentConversation();
            const panel = document.getElementById(PANEL_ID);
            if (panel) renderPanel(panel);
        }
    };

    // 监听 popstate
    window.addEventListener('popstate', checkUrlChange);

    // 监听 pushState/replaceState（添加保护标记防止多次覆写导致递归栈溢出）
    if (!history.pushState._dsFolderWrapped) {
        const origPush = history.pushState;
        const wrappedPush = function(...args) {
            origPush.apply(this, args);
            setTimeout(checkUrlChange, 100);
        };
        wrappedPush._dsFolderWrapped = true;
        history.pushState = wrappedPush;
    }
    if (!history.replaceState._dsFolderWrapped) {
        const origReplace = history.replaceState;
        const wrappedReplace = function(...args) {
            origReplace.apply(this, args);
            setTimeout(checkUrlChange, 100);
        };
        wrappedReplace._dsFolderWrapped = true;
        history.replaceState = wrappedReplace;
    }

    // 定期检查面板是否仍在 DOM 中（DeepSeek 可能重新渲染侧边栏）
    setInterval(() => {
        const panel = document.getElementById(PANEL_ID);
        if (!panel || !panel.isConnected) {
            mountPanel();
        }
        checkUrlChange();
    }, 3000);
}
