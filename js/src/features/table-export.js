/**
 * 表格优化导出模块
 *
 * 功能：
 *   1. 悬停表格显示 PNG / CSV 导出按钮
 *   2. 表格主题适配（自动透明叠加 / 双模式浅色/深色）
 *   3. 表格列宽策略（均分 / 自适应 / 均分+最小宽度保护）
 *   4. 流式输出稳定检测（指纹追踪，防闪烁）
 *   5. 宽屏模式下的表格宽度约束（修复宽屏下表格溢出问题）
 *
 * 适配自 dass.js 的表格优化逻辑
 */
import { CONFIG, saveConfig } from '../config.js';

// ============================================================
// 状态
// ============================================================

let installed = false;
let tableObserver = null;

// 表格指纹追踪：记录每个表格的稳定计数，连续 2 次指纹不变即视为稳定
const _tableFingerprints = new WeakMap();
const STABLE_COUNT_NEEDED = 2;
const MAX_WAIT_MS = 5000;
const TABLE_DEBOUNCE_MS = 200;
let _tableDebounceTimer = null;

// ============================================================
// 表格指纹
// ============================================================

/**
 * 获取表格指纹（行数:单元格数）
 * @param {Element} table - 表格元素
 * @returns {string}
 */
function getTableFingerprint(table) {
    const rows = table.querySelectorAll('tr').length;
    const cells = table.querySelectorAll('td,th').length;
    return rows + ':' + cells;
}

// ============================================================
// 列宽计算
// ============================================================

/**
 * 根据内容文本长度计算列宽百分比（采样表头+前5行）
 * @param {Element} table - 表格元素
 * @param {number} colCount - 列数
 * @returns {string[]} 百分比数组
 */
function calcColumnWeights(table, colCount) {
    const weights = new Array(colCount).fill(0);
    const rows = table.querySelectorAll('tr');
    const limit = Math.min(rows.length, 6);
    for (let r = 0; r < limit; r++) {
        const cells = rows[r].cells;
        for (let c = 0; c < Math.min(cells.length, colCount); c++) {
            const len = (cells[c].textContent || '').length;
            if (len > weights[c]) weights[c] = len;
        }
    }
    for (let c = 0; c < colCount; c++) {
        if (weights[c] < 1) weights[c] = 1;
    }
    const total = weights.reduce((a, b) => a + b, 0);
    return weights.map(w => ((w / total) * 100).toFixed(2) + '%');
}

// ============================================================
// 表格样式应用
// ============================================================

/**
 * 应用表格样式（列宽策略 + 主题 + 宽度约束）
 * @param {Element} table - 表格元素
 */
function applyTableStyles(table) {
    const tableWidthMode = CONFIG.tableWidthMode || 'equal';

    // maxWidth 约束：所有模式统一，表格宽度不得超过容器
    const vc = document.querySelector('.ds-virtual-list-visible-items');
    let maxW;
    if (vc) {
        maxW = vc.clientWidth + 'px';
        table.style.maxWidth = maxW;
        vc.style.overflowX = 'visible';
        vc.style.maxWidth = '100%';
    } else {
        maxW = '100%';
        table.style.maxWidth = maxW;
    }

    // 列宽策略
    if (tableWidthMode === 'auto') {
        table.style.tableLayout = 'fixed';
        table.style.width = maxW;
        const headerRow = table.querySelector('thead tr') || table.querySelector('tr');
        if (headerRow && headerRow.cells.length) {
            const pcts = calcColumnWeights(table, headerRow.cells.length);
            for (let i = 0; i < pcts.length; i++) {
                headerRow.cells[i].style.width = pcts[i];
                headerRow.cells[i].style.minWidth = '';
            }
        }
    } else if (tableWidthMode === 'equal-minwidth') {
        table.style.width = '100%';
        const headerRow = table.querySelector('thead tr') || table.querySelector('tr');
        const colCount = headerRow ? headerRow.cells.length : 1;
        const containerWidth = vc ? vc.clientWidth : (table.parentElement ? table.parentElement.clientWidth : window.innerWidth);
        if (colCount * 80 > containerWidth) {
            // 总最小宽度超出容器 → 自动切换自适应模式
            table.style.tableLayout = 'fixed';
            table.style.width = maxW;
            if (headerRow) {
                const pcts = calcColumnWeights(table, colCount);
                for (let i = 0; i < pcts.length; i++) {
                    headerRow.cells[i].style.width = pcts[i];
                    headerRow.cells[i].style.minWidth = '';
                }
            }
            if (!table.dataset.dsWidthWarned) {
                table.dataset.dsWidthWarned = '1';
            }
        } else {
            table.style.tableLayout = 'fixed';
            const per = (100 / colCount).toFixed(2) + '%';
            for (let i = 0; i < colCount; i++) {
                if (headerRow && headerRow.cells[i]) {
                    headerRow.cells[i].style.width = per;
                    headerRow.cells[i].style.minWidth = '80px';
                }
            }
        }
    } else {
        // equal
        table.style.width = '100%';
        table.style.tableLayout = 'fixed';
        const headerRow = table.querySelector('thead tr') || table.querySelector('tr');
        if (headerRow && headerRow.cells.length) {
            const per = (100 / headerRow.cells.length).toFixed(2) + '%';
            for (let i = 0; i < headerRow.cells.length; i++) {
                headerRow.cells[i].style.width = per;
                headerRow.cells[i].style.minWidth = '';
            }
        }
    }

    if (getComputedStyle(table).position !== 'relative') {
        table.style.position = 'relative';
    }

    table.querySelectorAll('th,td').forEach(cell => {
        cell.style.whiteSpace = 'normal';
        cell.style.overflowWrap = 'anywhere';
        cell.style.wordBreak = 'break-word';
    });

    // 仅处理直接包裹表格的 .ds-scroll-area 容器
    const scrollArea = table.closest('.ds-scroll-area');
    if (scrollArea) {
        if (!scrollArea.dataset.dsOrigOverflowX) {
            scrollArea.dataset.dsOrigOverflowX = scrollArea.style.overflowX || '';
        }
        scrollArea.style.overflowX = 'visible';
    }

    // 所有处理完成，显示表格
    table.style.opacity = '1';
}

// ============================================================
// 表格导出
// ============================================================

/**
 * 获取单元格文本（递归处理子节点，保留换行）
 * @param {Element} cell - 单元格元素
 * @returns {string}
 */
function getCellText(cell) {
    let t = '';
    cell.childNodes.forEach(n => {
        if (n.nodeType === Node.TEXT_NODE) t += n.textContent;
        else if (n.nodeName === 'BR') t += '\n';
        else if (n.nodeType === Node.ELEMENT_NODE) t += getCellText(n);
    });
    t = t.replace(/[^\S\n]+/g, ' ').replace(/ *\n */g, '\n').trim();
    return t;
}

/**
 * 导出表格为 CSV
 * @param {Element} table - 表格元素
 */
function exportTableAsCSV(table) {
    const rows = [];
    const thead = table.querySelector('thead');
    if (thead) thead.querySelectorAll('tr').forEach(tr => {
        const rd = []; tr.querySelectorAll('th').forEach(th => rd.push(getCellText(th)));
        if (rd.length) rows.push(rd);
    });
    const tbody = table.querySelector('tbody');
    if (tbody) tbody.querySelectorAll('tr').forEach(tr => {
        const rd = []; tr.querySelectorAll('td').forEach(td => rd.push(getCellText(td)));
        if (rd.length) rows.push(rd);
    });
    else table.querySelectorAll('tr').forEach(tr => {
        const rd = []; tr.querySelectorAll('td,th').forEach(c => rd.push(getCellText(c)));
        if (rd.length) rows.push(rd);
    });
    if (!rows.length) return;
    const csv = rows.map(r => r.map(c => {
        if (c.includes(',') || c.includes('"') || c.includes('\n')) c = '"' + c.replace(/"/g, '""') + '"';
        return c;
    }).join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `table_${Date.now()}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 100);
}

/**
 * 收集表格样式（用于 PNG 导出 iframe）
 * @returns {string}
 */
function collectTableStyles() {
    let css = '';
    const isDark = document.body.classList.contains('dark');
    const mode = CONFIG.tableThemeMode || 'auto';

    for (const sheet of document.styleSheets) {
        try {
            for (const rule of sheet.cssRules || []) {
                const txt = rule.cssText;
                if (txt.includes('table') || txt.includes('th') || txt.includes('td') ||
                    txt.includes('.ds-markdown') || txt.includes('.md-code-block')) {
                    if (txt.includes('table-layout: fixed') || txt.includes('ds-table-internal-buttons')) continue;
                    css += txt + '\n';
                }
            }
        } catch (_) { /* 跨域样式表忽略 */ }
    }

    const bodyBg = getComputedStyle(document.body).backgroundColor || '#ffffff';
    css += `
        body { background: ${bodyBg}; }
        table {
            width: 100%; border-collapse: separate; border-spacing: 0;
            margin: 1em 0; border-radius: 12px; overflow: hidden;
            box-shadow: 0 1px 3px rgba(0,0,0,0.05);
        }
        th, td {
            padding: 12px 16px; vertical-align: top;
            font-size: 14px; line-height: 1.5;
            white-space: normal; word-wrap: break-word;
        }
        th { font-weight: 600; }
        ${mode === 'auto' ? `
            th, td { border: 1px solid rgba(128,128,128,0.2); }
            th { background: rgba(128,128,128,0.08); border-bottom: 1px solid rgba(128,128,128,0.2); }
            tbody tr:nth-child(even) { background-color: rgba(128,128,128,0.04); }
        ` : isDark ? `
            th, td { border: 1px solid #2d2d3d; }
            th { background: #1e1e2d; border-bottom: 1px solid #2d2d3d; color: #e4e4e8; }
            tbody tr:nth-child(even) { background-color: rgba(255,255,255,0.03); }
        ` : `
            th, td { border: 1px solid #e5e7eb; }
            th { background: #f3f4f6; border-bottom: 1px solid #e5e7eb; color: #1f2937; }
            tbody tr:nth-child(even) { background-color: #fafafa; }
        `}
    `;
    return css;
}

/**
 * 导出表格为 PNG（使用 html2canvas）
 * @param {Element} table - 表格元素
 */
async function exportTableAsPNG(table) {
    if (!window.html2canvas) {
        // 动态加载 html2canvas
        try {
            await new Promise((resolve, reject) => {
                const s = document.createElement('script');
                s.src = 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';
                s.onload = resolve;
                s.onerror = () => reject(new Error('html2canvas 加载失败'));
                document.head.appendChild(s);
            });
        } catch (e) {
            alert('导出PNG失败：html2canvas 未加载');
            return;
        }
    }

    let iframe = null;
    try {
        const clone = table.cloneNode(true);
        clone.style.opacity = '1';
        const btns = clone.querySelector('.ds-table-internal-buttons');
        if (btns) btns.remove();
        clone.removeAttribute('data-ds-internal-buttons-added');

        clone.style.tableLayout = '';
        clone.style.width = '';
        clone.style.maxWidth = '';
        clone.style.position = '';
        clone.querySelectorAll('th,td').forEach(cell => {
            cell.style.width = '';
            cell.style.whiteSpace = '';
            cell.style.overflowWrap = '';
            cell.style.wordBreak = '';
        });

        const styles = collectTableStyles();

        iframe = document.createElement('iframe');
        iframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:800px;height:600px;';
        iframe.srcdoc = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><style>${styles}</style></head>
<body style="margin:16px;">${clone.outerHTML}</body></html>`;

        document.body.appendChild(iframe);

        await new Promise((resolve) => {
            iframe.onload = resolve;
            setTimeout(resolve, 3000);
        });

        const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
        const iframeTable = iframeDoc.querySelector('table');
        if (!iframeTable) throw new Error('iframe 中未找到表格元素');

        const canvas = await window.html2canvas(iframeTable, {
            scale: 2,
            backgroundColor: '#ffffff',
            logging: false,
        });

        canvas.toBlob(blob => {
            if (blob) {
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.download = `table_${Date.now()}.png`;
                a.href = url;
                a.click();
                setTimeout(() => URL.revokeObjectURL(url), 100);
            } else {
                const dataUrl = canvas.toDataURL('image/png');
                fetch(dataUrl).then(r => r.blob()).then(blob => {
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.download = `table_${Date.now()}.png`;
                    a.href = url;
                    a.click();
                    setTimeout(() => URL.revokeObjectURL(url), 100);
                }).catch(() => alert('导出PNG失败：无法生成图片数据'));
            }
        }, 'image/png');
    } catch (e) {
        console.error('PNG导出异常:', e);
        alert('导出PNG失败：' + (e.message || '未知错误'));
    } finally {
        if (iframe) setTimeout(() => iframe.remove(), 200);
    }
}

// ============================================================
// 导出按钮
// ============================================================

/**
 * 为表格添加悬停导出按钮（PNG + CSV）
 * @param {Element} table - 表格元素
 */
function addButtonsToTable(table) {
    if (table.getAttribute('data-ds-internal-buttons-added') === 'true') return;
    table.setAttribute('data-ds-internal-buttons-added', 'true');

    const bc = document.createElement('div');
    bc.className = 'ds-table-internal-buttons';

    const pngBtn = document.createElement('button');
    pngBtn.className = 'ds-table-internal-export-btn';
    pngBtn.innerHTML = String.fromCodePoint(0x1F4F8); // 📸
    pngBtn.setAttribute('data-tooltip', '导出为 PNG');
    pngBtn.addEventListener('click', e => { e.stopPropagation(); exportTableAsPNG(table); });

    const csvBtn = document.createElement('button');
    csvBtn.className = 'ds-table-internal-export-btn';
    csvBtn.innerHTML = String.fromCodePoint(0x1F4C4); // 📄
    csvBtn.setAttribute('data-tooltip', '导出为 CSV');
    csvBtn.addEventListener('click', e => { e.stopPropagation(); exportTableAsCSV(table); });

    bc.appendChild(pngBtn);
    bc.appendChild(csvBtn);
    table.appendChild(bc);
}

// ============================================================
// 批量处理
// ============================================================

/**
 * 处理所有表格（含指纹稳定检测）
 */
function processAllTables() {
    let anyUnstable = false;
    const now = Date.now();

    document.querySelectorAll('.ds-markdown').forEach(container => {
        container.style.overflowX = 'visible';
        container.style.maxWidth = '100%';
        container.querySelectorAll('table').forEach(table => {
            const fp = getTableFingerprint(table);
            const state = _tableFingerprints.get(table);

            if (!state) {
                _tableFingerprints.set(table, { fp, count: STABLE_COUNT_NEEDED, firstSeen: now, done: true });
                applyTableStyles(table);
                addButtonsToTable(table);
                return;
            }

            if (state.done) {
                if (fp === state.fp) return;
                state.fp = fp;
                state.count = 0;
                state.done = false;
                anyUnstable = true;
                return;
            }

            if (fp !== state.fp) {
                state.fp = fp;
                state.count = 0;
                anyUnstable = true;
                return;
            }

            state.count++;
            const timedOut = (now - state.firstSeen) > MAX_WAIT_MS;
            if (state.count >= STABLE_COUNT_NEEDED || timedOut) {
                state.count = STABLE_COUNT_NEEDED;
                state.done = true;
                if (timedOut) state.firstSeen = now;
                applyTableStyles(table);
                addButtonsToTable(table);
            } else {
                anyUnstable = true;
            }
        });
    });

    if (anyUnstable) {
        scheduleTableProcess();
    }
}

/**
 * 防抖调度表格处理
 */
function scheduleTableProcess() {
    clearTimeout(_tableDebounceTimer);
    _tableDebounceTimer = setTimeout(processAllTables, TABLE_DEBOUNCE_MS);
}

/**
 * 切换表格导出按钮显示
 * @param {boolean} enabled
 */
function toggleTableButtons(enabled) {
    document.querySelectorAll('.ds-markdown table').forEach(table => {
        const btnContainer = table.querySelector('.ds-table-internal-buttons');
        if (enabled) {
            if (!btnContainer) {
                table.removeAttribute('data-ds-internal-buttons-added');
                addButtonsToTable(table);
            }
        } else {
            if (btnContainer) {
                btnContainer.remove();
                table.removeAttribute('data-ds-internal-buttons-added');
            }
        }
    });
}

/**
 * 应用表格主题类名到 html 元素
 * @param {string} mode - 'auto' | 'dual'
 */
export function applyTableThemeClass(mode) {
    const html = document.documentElement;
    html.classList.remove('ds-table-auto', 'ds-table-dual');
    html.classList.add(mode === 'auto' ? 'ds-table-auto' : 'ds-table-dual');
}

/**
 * 重新应用所有表格样式（设置变更时调用）
 */
export function reapplyAllTableStyles() {
    document.querySelectorAll('.ds-markdown table').forEach(t => applyTableStyles(t));
}

// ============================================================
// MutationObserver
// ============================================================

/**
 * 设置 DOM 监听，自动检测新表格
 */
function observeDOM() {
    if (tableObserver) return;
    tableObserver = new MutationObserver(mutations => {
        let hasNewTables = false;
        for (const m of mutations) {
            if (m.type !== 'childList' || !m.addedNodes.length) continue;
            for (const node of m.addedNodes) {
                if (node.nodeType !== Node.ELEMENT_NODE) continue;
                if (node.matches && node.matches('table,tbody,thead,tfoot,tr,td,th,.ds-markdown')) {
                    hasNewTables = true;
                } else if (node.querySelectorAll && (node.querySelector('table') || node.querySelector('.ds-markdown'))) {
                    hasNewTables = true;
                }
                if (hasNewTables) break;
            }
            if (hasNewTables) break;
        }
        if (hasNewTables) scheduleTableProcess();
    });
    tableObserver.observe(document.body, { childList: true, subtree: true });
}

// ============================================================
// CSS 样式
// ============================================================

const TABLE_EXPORT_CSS = `
/* 表格样式 — 公共布局 */
.ds-markdown table {
    opacity: 0;
    transition: opacity 0.12s ease-in;
    table-layout: fixed;
    width: 100% !important; border-collapse: separate !important;
    border-spacing: 0 !important; margin: 1em 0 !important;
    border-radius: 12px !important; overflow: hidden !important;
    box-shadow: 0 1px 3px rgba(0,0,0,0.05) !important; position: relative;
}
.ds-markdown th, .ds-markdown td {
    padding: 12px 16px !important;
    vertical-align: top !important; font-size: 14px !important; line-height: 1.5 !important;
}
.ds-markdown th {
    font-weight: 600 !important; letter-spacing: 0.02em !important;
}
.ds-markdown tbody tr { transition: background-color 0.2s !important; }

/* Plan A：透明叠加色（自动适应浅色/深色） */
html.ds-table-auto .ds-markdown th,
html.ds-table-auto .ds-markdown td {
    border: 1px solid rgba(128,128,128,0.2) !important;
}
html.ds-table-auto .ds-markdown th {
    background: rgba(128,128,128,0.08) !important;
    border-bottom: 1px solid rgba(128,128,128,0.2) !important;
}
html.ds-table-auto .ds-markdown tbody tr:nth-child(even) {
    background-color: rgba(128,128,128,0.04) !important;
}
html.ds-table-auto .ds-markdown tbody tr:hover {
    background-color: rgba(79,70,229,0.06) !important;
}

/* Plan B 浅色模式 */
html.ds-table-dual body:not(.dark) .ds-markdown th,
html.ds-table-dual body:not(.dark) .ds-markdown td {
    border: 1px solid #e5e7eb !important;
}
html.ds-table-dual body:not(.dark) .ds-markdown th {
    background: #f3f4f6 !important;
    border-bottom: 1px solid #e5e7eb !important; color: #1f2937 !important;
}
html.ds-table-dual body:not(.dark) .ds-markdown tbody tr:nth-child(even) {
    background-color: #fafafa !important;
}
html.ds-table-dual body:not(.dark) .ds-markdown tbody tr:hover {
    background-color: #eff6ff !important;
}

/* Plan B 深色模式 */
html.ds-table-dual body.dark .ds-markdown th,
html.ds-table-dual body.dark .ds-markdown td {
    border: 1px solid #2d2d3d !important;
}
html.ds-table-dual body.dark .ds-markdown th {
    background: #1e1e2d !important;
    border-bottom: 1px solid #2d2d3d !important; color: #e4e4e8 !important;
}
html.ds-table-dual body.dark .ds-markdown tbody tr:nth-child(even) {
    background-color: rgba(255,255,255,0.03) !important;
}
html.ds-table-dual body.dark .ds-markdown tbody tr:hover {
    background-color: rgba(79,70,229,0.1) !important;
}

/* 导出按钮 — 公共布局 */
.ds-table-internal-buttons {
    position: absolute; bottom: 12px; right: 12px;
    display: flex; flex-direction: column; gap: 8px; z-index: 10;
    opacity: 0; visibility: hidden; transition: opacity 0.2s, visibility 0.2s;
    pointer-events: none;
}
.ds-markdown table:hover .ds-table-internal-buttons,
.ds-table-internal-buttons:hover { opacity: 1; visibility: visible; pointer-events: auto; }
.ds-table-internal-export-btn {
    width: 32px; height: 32px; border-radius: 8px;
    cursor: pointer; display: flex; align-items: center; justify-content: center;
    box-shadow: 0 2px 6px rgba(0,0,0,0.1); transition: all 0.2s; font-size: 16px;
    position: relative;
}
.ds-table-internal-export-btn:active { transform: scale(0.98); }
.ds-table-internal-export-btn::after {
    content: attr(data-tooltip); position: absolute; right: 40px; top: 50%;
    transform: translateY(-50%); font-size: 12px; padding: 4px 8px; border-radius: 6px;
    white-space: nowrap; opacity: 0; visibility: hidden; transition: 0.1s;
    pointer-events: none;
}
.ds-table-internal-export-btn:hover::after { opacity: 1; visibility: visible; }

/* 导出按钮 — Plan A 自动 */
html.ds-table-auto .ds-table-internal-export-btn {
    background: rgba(128,128,128,0.12); border: 1px solid rgba(128,128,128,0.24);
}
html.ds-table-auto .ds-table-internal-export-btn:hover {
    background: rgba(128,128,128,0.2); border-color: rgba(128,128,128,0.36);
}
html.ds-table-auto .ds-table-internal-export-btn::after {
    background: rgba(0,0,0,0.82); color: white;
}

/* 导出按钮 — Plan B 浅色 */
html.ds-table-dual body:not(.dark) .ds-table-internal-export-btn {
    background: rgba(255,255,255,0.95); border: 1px solid #e2e8f0;
}
html.ds-table-dual body:not(.dark) .ds-table-internal-export-btn:hover {
    background: #fff; border-color: #cbd5e1;
}
html.ds-table-dual body:not(.dark) .ds-table-internal-export-btn::after {
    background: #1f2937; color: white;
}

/* 导出按钮 — Plan B 深色 */
html.ds-table-dual body.dark .ds-table-internal-export-btn {
    background: rgba(45,45,58,0.95); border: 1px solid #3d3d4a;
}
html.ds-table-dual body.dark .ds-table-internal-export-btn:hover {
    background: #3d3d4a; border-color: #5d5d6a;
}
html.ds-table-dual body.dark .ds-table-internal-export-btn::after {
    background: #e4e4e8; color: #1a1a22;
}
`;

/**
 * 注入样式
 */
function injectStyles() {
    if (document.getElementById('ds-table-export-style')) return;
    const style = document.createElement('style');
    style.id = 'ds-table-export-style';
    style.textContent = TABLE_EXPORT_CSS;
    document.head.appendChild(style);
}

// ============================================================
// 对外接口
// ============================================================

/**
 * 初始化表格优化导出模块
 */
export function initTableExport() {
    if (installed) return;
    installed = true;

    if (!CONFIG.tableExportEnabled) return;

    injectStyles();
    applyTableThemeClass(CONFIG.tableThemeMode || 'auto');
    processAllTables();
    observeDOM();

    // resize 节流处理表格
    window.addEventListener('resize', () => {
        clearTimeout(window._dsTableResizeFix);
        window._dsTableResizeFix = setTimeout(processAllTables, 100);
    });
}