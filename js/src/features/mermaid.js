/**
 * Mermaid 图表渲染模块
 *
 * 动态加载 Mermaid.js 库，将代码块中的 Mermaid 语法渲染为可视化图表。
 * 支持：流程图、时序图、甘特图、饼图、状态图等。
 * 替换整个代码块 wrapper，防止 DeepSeek 原生错误渲染覆盖图表。
 * 提供代码/图表切换按钮。
 */
import { CONFIG } from '../config.js';
import { utils } from '../utils.js';

let mermaidLoaded = false;
let mermaidLoading = false;

/**
 * 动态加载 Mermaid.js 库（仅加载一次）
 * @returns {Promise<void>}
 */
function loadMermaid() {
    if (mermaidLoaded) return Promise.resolve();
    if (mermaidLoading) {
        return new Promise((resolve) => {
            const check = setInterval(() => {
                if (mermaidLoaded) { clearInterval(check); resolve(); }
            }, 100);
        });
    }
    mermaidLoading = true;
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js';
        script.onload = () => {
            mermaidLoaded = true;
            mermaidLoading = false;
            if (window.mermaid) {
                window.mermaid.initialize({
                    theme: utils.isDarkMode() ? 'dark' : 'default',
                    securityLevel: 'loose',
                    themeVariables: {
                        primaryColor: '#f08ca8',
                        primaryTextColor: '#333',
                        primaryBorderColor: '#f08ca8',
                        lineColor: '#f08ca8',
                        secondaryColor: '#fcd5df',
                        tertiaryColor: '#fff5f7'
                    }
                });
            }
            resolve();
        };
        script.onerror = () => {
            mermaidLoading = false;
            reject(new Error('Mermaid 库加载失败'));
        };
        document.head.appendChild(script);
    });
}

/**
 * 渲染单个 Mermaid 代码块为图表。
 * 关键修复：替换整个代码块 wrapper（.md-code-block 等），而非仅 pre 元素，
 * 防止 DeepSeek 原生代码块头部 / 错误提示残留覆盖图表。
 * 如果 DeepSeek 自己的渲染器已成功渲染（wrapper 中有 SVG），则跳过。
 * @param {HTMLPreElement} pre - pre 元素
 * @param {HTMLElement} code - code 元素
 */
function renderMermaidElement(pre, code) {
    if (pre.dataset.mermaidProcessed === 'true') return;
    pre.dataset.mermaidProcessed = 'true';
    const content = code.textContent.trim();
    if (!content) return;

    // 查找代码块外层 wrapper，替换整个 wrapper 以移除 DeepSeek 原生代码块头部和错误提示
    const wrapper = pre.closest('.md-code-block')
                  || pre.closest('._121d384')
                  || pre.closest('.d2a24f03')
                  || pre.closest('.efa13877')
                  || pre.parentElement;
    if (!wrapper || !wrapper.parentNode) return;
    // 如果 wrapper 已经是图表容器，跳过
    if (wrapper.classList && wrapper.classList.contains('anime-mermaid-container')) return;
    // 如果 DeepSeek 自己的渲染器已成功渲染（wrapper 中有 SVG），跳过
    if (wrapper.querySelector('svg')) return;

    const container = document.createElement('div');
    container.className = 'anime-mermaid-container';
    container.dataset.mermaidContainer = 'true';

    const sourceWrapper = document.createElement('div');
    sourceWrapper.className = 'anime-mermaid-source';
    const preClone = pre.cloneNode(true);
    preClone.dataset.mermaidProcessed = 'false';
    sourceWrapper.appendChild(preClone);
    container.appendChild(sourceWrapper);

    const chartDiv = document.createElement('div');
    chartDiv.className = 'mermaid-chart';
    container.appendChild(chartDiv);

    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'anime-mermaid-toggle';
    toggleBtn.textContent = '显示代码';
    toggleBtn.addEventListener('click', () => {
        const source = container.querySelector('.anime-mermaid-source');
        const chart = container.querySelector('.mermaid-chart');
        if (source.style.display === 'none') {
            source.style.display = 'block';
            chart.style.display = 'none';
            toggleBtn.textContent = '显示图表';
        } else {
            source.style.display = 'none';
            chart.style.display = 'block';
            toggleBtn.textContent = '显示代码';
        }
    });
    container.appendChild(toggleBtn);

    // 在 wrapper 前插入容器，然后隐藏 wrapper（不移除，避免 React removeChild 错误）
    wrapper.parentNode.insertBefore(container, wrapper);
    wrapper.style.display = 'none';

    loadMermaid().then(() => {
        // 检查容器是否仍在 DOM 中（DeepSeek 可能已重新渲染并替换它）
        if (!utils.isNodeAttached(container)) return;
        if (window.mermaid) {
            const tempDiv = document.createElement('div');
            tempDiv.className = 'mermaid';
            tempDiv.textContent = content;
            chartDiv.appendChild(tempDiv);
            window.mermaid.run({ nodes: [tempDiv] }).catch(err => {
                chartDiv.innerHTML = `<div style="color:red;padding:8px;">⚠️ 图表渲染失败：${err.message}</div>`;
                sourceWrapper.style.display = 'block';
                toggleBtn.textContent = '显示图表';
            });
        }
    }).catch(err => {
        if (!utils.isNodeAttached(container)) return;
        chartDiv.innerHTML = `<div style="color:red;padding:8px;">⚠️ Mermaid 库加载失败</div>`;
        sourceWrapper.style.display = 'block';
        toggleBtn.textContent = '显示图表';
    });
}

/**
 * 扫描容器中的 pre 元素，检测 Mermaid 代码块并渲染。
 * 修复：跳过已在 mermaid 容器内的 pre（克隆的源代码），增加 flowchart 等关键词识别。
 * @param {Element} root - 扫描根元素
 */
export function scanMermaid(root) {
    if (!CONFIG.mermaidEnabled) return;
    if (!root || root.nodeType !== 1) return;
    // 跳过已经是 mermaid 容器的节点
    if (root.classList && root.classList.contains('anime-mermaid-container')) return;
    const pres = root.querySelectorAll('pre:not([data-mermaid-processed])');
    pres.forEach(pre => {
        // 跳过已在我们容器内的 pre（克隆的源代码）
        if (pre.closest('.anime-mermaid-container')) return;
        const code = pre.querySelector('code');
        if (!code) return;
        const text = code.textContent.trim();
        const isMermaid = code.className && (code.className.includes('mermaid') || code.className.includes('language-mermaid')) ||
                          /^(graph|flowchart|sequenceDiagram|gantt|pie|stateDiagram|classDiagram|erDiagram|journey|timeline|gitGraph|mindmap|requirementDiagram|C4Context|sankey|block)/.test(text);
        if (isMermaid) {
            renderMermaidElement(pre, code);
        }
    });
}
