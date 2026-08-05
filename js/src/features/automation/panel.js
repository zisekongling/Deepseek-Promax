/**
 * @file panel.js
 * @description 自动化调度器侧栏面板 UI
 *
 * 功能：
 *   - 任务列表（名称 / schedule / 上次运行 / 状态）
 *   - 创建任务（名称 / prompt / 选择会话 / schedule 类型 / 表达式）
 *   - 编辑 / 删除任务
 *   - 立即运行
 *   - 暂停 / 恢复
 *   - 运行历史查看（展开任务卡片）
 *
 * React 状态兼容：
 *   - 挂载用 sidebar.insertBefore(panel, sidebar.firstChild)，不触碰 React 子树
 *   - 隐藏面板用 style.display='none'，不直接 removeChild React 节点
 *   - DeepSeek 重新渲染侧边栏时面板可能丢失，通过 setInterval 定期重挂载
 *
 * 参考：js/src/ui/folder-panel.js 的挂载 / 事件委托 / 对话框模式。
 */

import {
    listTasks,
    getTask,
    createTask,
    updateTask,
    deleteTask,
    clearHistory
} from './store.js';
import { rescheduleTask } from './scheduler.js';
import { runTaskNow, getRunningTaskId } from './runner.js';
import {
    findSidebar,
    getSidebarConversations,
    readRecentConversations,
    getActiveConversation
} from '../conversation-detector.js';
import { showToast } from '../../ui/toast.js';

const PANEL_ID = 'dspro-automation-panel';
const STYLE_ID = 'dspro-automation-panel-style';

/** 面板是否已初始化（样式注入 + observer 安装） */
let mounted = false;

/** 已展开历史查看的任务 ID 集合 */
const _expandedHistory = new Set();

/** 定期重挂载定时器 */
let _remountTimer = null;

/**
 * 注入面板样式（仅一次）
 */
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
            max-height: 320px;
            overflow-y: auto;
            flex-shrink: 0;
        }
        #${PANEL_ID}::-webkit-scrollbar { width: 4px; }
        #${PANEL_ID}::-webkit-scrollbar-thumb { background: rgba(128,128,128,0.3); border-radius: 2px; }
        .ap-header {
            display: flex; align-items: center; justify-content: space-between;
            margin-bottom: 6px; padding: 0 2px;
        }
        .ap-title { font-weight: 600; font-size: 13px; display: flex; align-items: center; gap: 4px; }
        .ap-actions { display: flex; gap: 4px; }
        .ap-btn {
            border: none; border-radius: 4px; padding: 2px 6px; cursor: pointer;
            font-size: 12px; line-height: 1.4; background: transparent; color: inherit;
        }
        .ap-btn:hover { background: rgba(128,128,128,0.15); }
        .ap-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .ap-task {
            border: 1px solid rgba(128,128,128,0.12);
            border-radius: 6px; padding: 6px 8px; margin-bottom: 6px;
        }
        .ap-task.running { border-color: #1890ff; box-shadow: 0 0 0 2px rgba(24,144,255,0.15); }
        .ap-task.disabled { opacity: 0.55; }
        .ap-task-head {
            display: flex; align-items: center; gap: 4px;
        }
        .ap-status-dot {
            width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
            background: rgba(128,128,128,0.4);
        }
        .ap-status-dot.ok { background: #52c41a; }
        .ap-status-dot.err { background: #f5222d; }
        .ap-status-dot.run { background: #1890ff; animation: ap-pulse 1s infinite; }
        @keyframes ap-pulse { 0%,100%{opacity:1;} 50%{opacity:0.3;} }
        .ap-task-name {
            flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
            font-weight: 500; font-size: 12.5px;
        }
        .ap-task-ops { display: flex; gap: 1px; flex-shrink: 0; }
        .ap-task-ops button {
            border: none; background: transparent; cursor: pointer; padding: 1px 3px;
            font-size: 11px; border-radius: 3px; color: inherit; opacity: 0.7;
        }
        .ap-task-ops button:hover { background: rgba(128,128,128,0.2); opacity: 1; }
        .ap-task-meta {
            margin-top: 4px; font-size: 11px; color: rgba(128,128,128,0.85);
            display: flex; flex-direction: column; gap: 1px;
        }
        .ap-task-meta code {
            font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
            font-size: 10.5px; background: rgba(128,128,128,0.12); padding: 0 3px; border-radius: 2px;
        }
        .ap-history {
            margin-top: 6px; border-top: 1px dashed rgba(128,128,128,0.2); padding-top: 4px;
            max-height: 140px; overflow-y: auto;
        }
        .ap-history-item {
            font-size: 11px; padding: 2px 0; border-bottom: 1px solid rgba(128,128,128,0.08);
            word-break: break-all;
        }
        .ap-history-item:last-child { border-bottom: none; }
        .ap-history-time { color: rgba(128,128,128,0.7); margin-right: 4px; }
        .ap-history-ok { color: #52c41a; }
        .ap-history-err { color: #f5222d; }
        .ap-empty { color: rgba(128,128,128,0.5); font-size: 12px; padding: 8px 4px; text-align: center; }
        .ap-overlay {
            position: fixed; top: 0; left: 0; right: 0; bottom: 0; z-index: 99998;
            background: rgba(0,0,0,0.35); display: flex; align-items: center; justify-content: center;
        }
        .ap-dialog {
            background: var(--dsw-alias-bg-layer-2, #fff); color: var(--dsw-alias-label-primary, #333);
            border-radius: 12px; padding: 16px; min-width: 320px; max-width: 460px; max-height: 80vh;
            overflow-y: auto; box-shadow: 0 8px 32px rgba(0,0,0,0.25); z-index: 99999;
            display: flex; flex-direction: column; gap: 10px;
        }
        .ap-dialog h3 { margin: 0; font-size: 15px; font-weight: 600; }
        .ap-dialog label { font-size: 12px; font-weight: 500; display: block; margin-bottom: 2px; }
        .ap-dialog input, .ap-dialog textarea, .ap-dialog select {
            width: 100%; padding: 6px 10px; border: 1px solid rgba(128,128,128,0.3);
            border-radius: 6px; font-size: 13px; background: transparent; color: inherit;
            box-sizing: border-box; font-family: inherit;
        }
        .ap-dialog textarea { resize: vertical; min-height: 64px; }
        .ap-dialog input:focus, .ap-dialog textarea:focus, .ap-dialog select:focus {
            outline: none; border-color: var(--dsw-alias-brand-primary, #1890ff);
        }
        .ap-dialog .ap-row { display: flex; gap: 8px; }
        .ap-dialog .ap-row > * { flex: 1; }
        .ap-dialog .ap-check { display: flex; align-items: center; gap: 6px; font-size: 12px; }
        .ap-dialog .ap-check input { width: auto; }
        .ap-dialog-actions { display: flex; gap: 8px; margin-top: 4px; }
        .ap-dialog-actions button {
            flex: 1; padding: 6px 12px; border: none; border-radius: 6px; cursor: pointer; font-size: 13px;
        }
        .ap-dialog-actions .ap-confirm { background: var(--dsw-alias-brand-primary, #1890ff); color: #fff; }
        .ap-dialog-actions .ap-cancel { background: rgba(128,128,128,0.15); color: inherit; }
        .ap-dialog .ap-hint { font-size: 11px; color: rgba(128,128,128,0.7); }
        .ap-dialog .ap-err { color: #f5222d; font-size: 12px; }
    `;
    document.head.appendChild(style);
}

/**
 * HTML 转义
 * @param {string} text
 * @returns {string}
 */
function esc(text) {
    const div = document.createElement('div');
    div.textContent = text == null ? '' : String(text);
    return div.innerHTML;
}

/**
 * 格式化时间戳为简短可读字符串
 * @param {number} ts - 毫秒时间戳
 * @returns {string}
 */
function fmtTime(ts) {
    if (!ts) return '—';
    const d = new Date(ts);
    const pad = n => String(n).padStart(2, '0');
    return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * 获取会话选项列表（侧边栏 + 最近缓存 + 当前会话，去重）
 * @returns {Array<{id:string, title:string}>}
 */
function getConversationOptions() {
    const map = new Map();
    for (const c of getSidebarConversations()) {
        if (!map.has(c.id)) map.set(c.id, { id: c.id, title: c.title });
    }
    for (const c of readRecentConversations()) {
        if (!map.has(c.id)) map.set(c.id, { id: c.id, title: c.title });
    }
    const active = getActiveConversation();
    if (active && !map.has(active.id)) {
        map.set(active.id, { id: active.id, title: active.title });
    }
    return [...map.values()];
}

/**
 * 渲染任务列表到面板
 * @param {HTMLElement} container - 面板容器
 */
function renderPanel(container) {
    const tasks = listTasks();
    const runningId = getRunningTaskId();

    let html = `
        <div class="ap-header">
            <span class="ap-title">⏰ 自动化</span>
            <div class="ap-actions">
                <button class="ap-btn" data-action="new-task" title="新建任务">＋</button>
                <button class="ap-btn" data-action="refresh" title="刷新">⟳</button>
            </div>
        </div>
    `;

    if (tasks.length === 0) {
        html += `<div class="ap-empty">暂无自动化任务，点击 + 创建</div>`;
    } else {
        for (const task of tasks) {
            html += renderTaskCard(task, task.id === runningId);
        }
    }

    container.innerHTML = html;
}

/**
 * 渲染单个任务卡片
 * @param {object} task - 任务对象
 * @param {boolean} isRunning - 是否正在运行
 * @returns {string} HTML 字符串
 */
function renderTaskCard(task, isRunning) {
    const expanded = _expandedHistory.has(task.id);
    const lastOk = task.lastResult ? task.lastResult.ok : null;
    let dotClass = 'ap-status-dot';
    if (isRunning) dotClass += ' run';
    else if (lastOk === true) dotClass += ' ok';
    else if (lastOk === false) dotClass += ' err';

    const cardClass = `ap-task${isRunning ? ' running' : ''}${task.enabled ? '' : ' disabled'}`;

    let html = `
        <div class="${cardClass}" data-task-id="${esc(task.id)}">
            <div class="ap-task-head">
                <span class="${dotClass}"></span>
                <span class="ap-task-name" title="${esc(task.name)}">${esc(task.name)}</span>
                <span class="ap-task-ops">
                    <button data-action="run" data-task-id="${esc(task.id)}" title="立即运行" ${isRunning ? 'disabled' : ''}>▶</button>
                    <button data-action="toggle" data-task-id="${esc(task.id)}" title="${task.enabled ? '暂停' : '恢复'}">${task.enabled ? '⏸' : '▶'}</button>
                    <button data-action="edit" data-task-id="${esc(task.id)}" title="编辑">✏</button>
                    <button data-action="history" data-task-id="${esc(task.id)}" title="历史">📜</button>
                    <button data-action="delete" data-task-id="${esc(task.id)}" title="删除">🗑</button>
                </span>
            </div>
            <div class="ap-task-meta">
                <span><code>${esc(task.schedule.type)}:</code> ${esc(task.schedule.expr)}</span>
                <span>会话: ${task.conversationId ? esc(task.conversationId) : '<未指定>'}</span>
                <span>上次: ${fmtTime(task.lastRun)} ${lastOk === true ? '✓' : lastOk === false ? '✗' : ''}</span>
            </div>
    `;

    if (expanded) {
        const history = task.runHistory || [];
        html += '<div class="ap-history">';
        if (history.length === 0) {
            html += '<div class="ap-history-item ap-history-time">暂无运行历史</div>';
        } else {
            // 倒序展示（最新在前）
            for (const h of [...history].reverse()) {
                const okCls = h.ok ? 'ap-history-ok' : 'ap-history-err';
                const detail = h.ok ? (h.resultSummary ? esc(h.resultSummary) : '成功')
                                    : (h.error ? esc(h.error) : '失败');
                html += `
                    <div class="ap-history-item">
                        <span class="ap-history-time">${fmtTime(h.timestamp)}</span>
                        <span class="${okCls}">${h.ok ? '✓' : '✗'}</span>
                        <span style="color:rgba(128,128,128,0.7)"> ${(h.durationMs / 1000).toFixed(1)}s</span>
                        <div>${detail}</div>
                    </div>
                `;
            }
        }
        html += `<button class="ap-btn" data-action="clear-history" data-task-id="${esc(task.id)}" style="margin-top:4px;font-size:11px;">清空历史</button>`;
        html += '</div>';
    }

    html += '</div>';
    return html;
}

/**
 * 显示任务编辑对话框（创建 / 编辑共用）
 * @param {object} [task] - 传入则编辑，否则创建
 * @returns {Promise<object|null>} 表单数据，取消返回 null
 */
function showTaskEditor(task) {
    return new Promise(resolve => {
        const isEdit = !!task;
        const conversations = getConversationOptions();
        let convOptions = '<option value="">— 请选择会话 —</option>';
        for (const c of conversations) {
            const sel = task && task.conversationId === c.id ? ' selected' : '';
            convOptions += `<option value="${esc(c.id)}"${sel}>${esc(c.title)} (${esc(c.id.slice(0, 8))})</option>`;
        }
        // 若编辑现有任务且其会话不在列表中，补一条
        if (task && task.conversationId && !conversations.find(c => c.id === task.conversationId)) {
            convOptions += `<option value="${esc(task.conversationId)}" selected>自定义会话 (${esc(task.conversationId.slice(0, 8))})</option>`;
        }

        const overlay = document.createElement('div');
        overlay.className = 'ap-overlay';
        overlay.innerHTML = `
            <div class="ap-dialog">
                <h3>${isEdit ? '编辑任务' : '新建任务'}</h3>
                <div>
                    <label>任务名称</label>
                    <input type="text" id="ap-field-name" value="${task ? esc(task.name) : ''}" placeholder="例如：每日新闻摘要" />
                </div>
                <div>
                    <label>Prompt（发送给 DeepSeek 的内容）</label>
                    <textarea id="ap-field-prompt" placeholder="请总结今天的科技新闻...">${task ? esc(task.prompt) : ''}</textarea>
                </div>
                <div class="ap-row">
                    <div>
                        <label>目标会话</label>
                        <select id="ap-field-conv">${convOptions}</select>
                    </div>
                    <div>
                        <label>调度类型</label>
                        <select id="ap-field-type">
                            <option value="cron"${task && task.schedule.type === 'cron' ? ' selected' : ''}>cron</option>
                            <option value="rrule"${task && task.schedule.type === 'rrule' ? ' selected' : ''}>rrule</option>
                        </select>
                    </div>
                </div>
                <div>
                    <label>调度表达式</label>
                    <input type="text" id="ap-field-expr" value="${task ? esc(task.schedule.expr) : ''}" placeholder="*/15 * * * *" />
                    <div class="ap-hint" id="ap-expr-hint">cron: 5 字段（分 时 日 月 周），最小间隔 15 分钟</div>
                </div>
                <div class="ap-check">
                    <input type="checkbox" id="ap-field-enabled" ${(!task || task.enabled) ? 'checked' : ''} />
                    <label for="ap-field-enabled" style="margin:0;">启用</label>
                </div>
                <div class="ap-err" id="ap-err"></div>
                <div class="ap-dialog-actions">
                    <button class="ap-cancel">取消</button>
                    <button class="ap-confirm">${isEdit ? '保存' : '创建'}</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        const typeSel = overlay.querySelector('#ap-field-type');
        const exprHint = overlay.querySelector('#ap-expr-hint');
        const errBox = overlay.querySelector('#ap-err');

        /**
         * 根据调度类型更新表达式提示
         */
        function updateHint() {
            if (typeSel.value === 'cron') {
                exprHint.textContent = 'cron: 5 字段（分 时 日 月 周），如 */15 * * * *，最小间隔 15 分钟';
            } else {
                exprHint.textContent = 'rrule: 如 FREQ=DAILY;INTERVAL=1 或 FREQ=WEEKLY;BYDAY=MO,WE;INTERVAL=2';
            }
        }
        typeSel.addEventListener('change', updateHint);
        updateHint();

        const close = (value) => { overlay.remove(); resolve(value); };
        overlay.querySelector('.ap-cancel').addEventListener('click', () => close(null));
        overlay.addEventListener('click', e => { if (e.target === overlay) close(null); });

        overlay.querySelector('.ap-confirm').addEventListener('click', () => {
            const data = {
                name: overlay.querySelector('#ap-field-name').value.trim(),
                prompt: overlay.querySelector('#ap-field-prompt').value,
                conversationId: overlay.querySelector('#ap-field-conv').value || null,
                schedule: {
                    type: typeSel.value,
                    expr: overlay.querySelector('#ap-field-expr').value.trim()
                },
                enabled: overlay.querySelector('#ap-field-enabled').checked
            };
            if (!data.name) { errBox.textContent = '请填写任务名称'; return; }
            if (!data.prompt) { errBox.textContent = '请填写 prompt'; return; }
            if (!data.schedule.expr) { errBox.textContent = '请填写调度表达式'; return; }
            close(data);
        });
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
    const taskId = target.dataset.taskId;
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;

    switch (action) {
        case 'new-task': {
            showTaskEditor(null).then(data => {
                if (!data) return;
                const r = createTask(data);
                if (r.ok) {
                    showToast('任务已创建', { tone: 'success' });
                    rescheduleTask(r.task.id);
                    renderPanel(panel);
                } else {
                    showToast('创建失败：' + (r.error?.message || '未知错误'), { tone: 'error' });
                }
            });
            break;
        }
        case 'refresh': {
            renderPanel(panel);
            break;
        }
        case 'run': {
            if (!taskId) break;
            runTaskNow(taskId).then(r => {
                if (r.ok) {
                    showToast('任务运行成功', { tone: 'success' });
                } else {
                    showToast('运行失败：' + (r.error || '未知错误'), { tone: 'error' });
                }
                renderPanel(panel);
            });
            renderPanel(panel); // 立即刷新显示运行态
            break;
        }
        case 'toggle': {
            if (!taskId) break;
            const task = getTask(taskId);
            if (!task) break;
            const r = updateTask(taskId, { enabled: !task.enabled });
            if (r.ok) {
                rescheduleTask(taskId);
                renderPanel(panel);
                showToast(r.task.enabled ? '已启用' : '已暂停', { tone: 'info' });
            }
            break;
        }
        case 'edit': {
            if (!taskId) break;
            const task = getTask(taskId);
            if (!task) break;
            showTaskEditor(task).then(data => {
                if (!data) return;
                const r = updateTask(taskId, data);
                if (r.ok) {
                    showToast('已保存', { tone: 'success' });
                    rescheduleTask(taskId);
                    renderPanel(panel);
                } else {
                    showToast('保存失败：' + (r.error?.message || '未知错误'), { tone: 'error' });
                }
            });
            break;
        }
        case 'history': {
            if (!taskId) break;
            if (_expandedHistory.has(taskId)) _expandedHistory.delete(taskId);
            else _expandedHistory.add(taskId);
            renderPanel(panel);
            break;
        }
        case 'clear-history': {
            if (!taskId) break;
            clearHistory(taskId);
            renderPanel(panel);
            showToast('历史已清空', { tone: 'info' });
            break;
        }
        case 'delete': {
            if (!taskId) break;
            const task = getTask(taskId);
            if (!task) break;
            if (confirm(`确定删除任务「${task.name}」？`)) {
                deleteTask(taskId);
                _expandedHistory.delete(taskId);
                renderPanel(panel);
                showToast('已删除', { tone: 'info' });
            }
            break;
        }
    }
}

/**
 * 挂载面板到侧边栏（React 兼容：insertBefore，不触碰 React 子树）
 * @returns {boolean} 是否成功挂载
 */
function mountPanel() {
    const sidebar = findSidebar();
    if (!sidebar) return false;
    let panel = document.getElementById(PANEL_ID);
    if (!panel || !document.contains(panel)) {
        panel = document.createElement('div');
        panel.id = PANEL_ID;
        panel.addEventListener('click', handlePanelClick);
        // React 兼容：用 insertBefore 插到第一个子节点前，不 removeChild 任何 React 节点
        if (sidebar.firstChild) {
            sidebar.insertBefore(panel, sidebar.firstChild);
        } else {
            sidebar.appendChild(panel);
        }
    }
    renderPanel(panel);
    return true;
}

/**
 * 初始化自动化面板（注入样式 + 挂载 + 定期重挂载检查）
 */
export function initAutomationPanel() {
    if (mounted) return;
    mounted = true;
    injectStyle();

    if (!mountPanel()) {
        // 侧边栏尚未加载，用 observer 等待
        const bodyObserver = new MutationObserver(() => {
            if (mountPanel()) {
                bodyObserver.disconnect();
                startRemountWatch();
            }
        });
        bodyObserver.observe(document.body, { childList: true, subtree: true });
        setTimeout(() => bodyObserver.disconnect(), 15000);
        return;
    }

    startRemountWatch();
}

/**
 * 启动定期重挂载检查（DeepSeek 可能重新渲染侧边栏导致面板丢失）
 */
function startRemountWatch() {
    if (_remountTimer) return;
    _remountTimer = setInterval(() => {
        const panel = document.getElementById(PANEL_ID);
        if (!panel || !panel.isConnected) {
            mountPanel();
        }
    }, 3000);
}

/**
 * 刷新面板视图（外部调用，如任务运行后）
 */
export function refreshAutomationPanel() {
    const panel = document.getElementById(PANEL_ID);
    if (panel) renderPanel(panel);
}
