/**
 * 设置面板模块（v5.0.0 重构版）
 *
 * 统一 8 个标签页（不再区分 WebView / 篡改猴版）：
 *   🎨 外观 / ✨ 对话增强 / 🧩 功能扩展 / 🤖 Agent 系统 / 🔒 隐私与安全 / 🔄 数据同步 / 🛠️ 高级与扩展 / 📋 信息
 *
 * 设计特性：
 *   - 桌面端（>900px）：双栏侧边栏布局（竖直标签 + 内容区）
 *   - 平板/手机（≤900px）：顶部横滚标签 + 内容区
 *   - 手机端（≤480px）：全屏底部工作表风格
 *   - 统一 CSS 变量驱动主题，减少内联样式
 */
import { CONFIG, DEFAULTS, OPTION_CONFIG_KEYS, saveConfig, IS_ELECTRON } from '../config.js';
import { utils } from '../utils.js';
import { THEMES, getThemeColors } from '../themes.js';
import { doExport, doImageExport } from '../features/export.js';
import { clearPrivacyCache } from '../features/privacy-shield.js';
import { renderMemoryPanel, getMemoryPanelCSS, refreshMemoryPanel } from '../features/memory.js';
import { getAllPresets, savePreset, deletePreset, getActivePresetId, setActivePresetId } from '../features/preset.js';
import { getAllScenarios, addCustomScenario, deleteScenario, saveScenario } from '../features/scenario.js';
import { getAllSkills, saveSkill, deleteSkill, setSkillEnabled, getAllSkillSources, deleteSkillSource, previewGitHubSkillSource, importGitHubSkillSource, importSkillFromText, checkGitHubSkillSourceUpdates, updateGitHubSkillSource } from '../features/skill.js';
import { showToast } from './toast.js';

// ============================================================
// i18n 安全 getter
// ============================================================

/**
 * i18n 翻译安全 getter
 * window._dsI18n 可用时调用其 t() 方法，否则回退为 key 本身
 * @param {string} k - 点分资源 key（如 'settings.panel.title'）
 * @param {Object} [p] - 占位符参数
 * @returns {string} 翻译后的文案；i18n 未初始化时返回 key 本身
 */
const t = (k, p) => (window._dsI18n ? window._dsI18n.t(k, p) : k);

/**
 * 带回退的 i18n 翻译 getter
 * 当 i18n 未初始化或 key 缺失（t() 返回 key 本身）时，回退到 fallback 文案
 * 用于 i18n 资源可能尚未覆盖的 key（如 Phase 6 扩展模块的 toggle/section）
 * @param {string} k - 点分资源 key
 * @param {string} fallback - 回退文案（通常为硬编码中文）
 * @returns {string} 翻译后的文案或回退文案
 */
const tt = (k, fallback) => {
    const r = t(k);
    return r === k ? fallback : r;
};

let settingsModal = null;

/** 各功能开关的帮助描述文本（全部补全，无缺失） */
const optionDescriptions = {
    // 大模块总开关描述
    script: '🟢 脚本总开关：关闭后仅保留设置面板入口，不执行任何功能增强（樱花/字体/背景/Agent 等全部停用）。适合临时禁用脚本排查问题',
    presets: '💬 预设系统总开关：关闭后不注入任何激活的预设内容（角色/场景提示词），预设列表仍可管理但不会生效',
    skill: '⚡ 技能系统总开关：关闭后 /命令 不触发技能，输入框的斜杠命令按普通文本处理',
    skillSidebar: '📋 技能侧边栏：在输入框输入 / 时，在预设菜单旁显示技能列表，可快速选择技能',
    scenarios: '📋 场景模板总开关：关闭后场景列表不加载，右键菜单也不显示场景项（仅保留自定义场景输入区）',
    fontCustom: '🔤 启用字体自定义：通过系统字体或在线字体（.woff2/.ttf/Google Fonts CSS）替换 DeepSeek 默认字体',
    bgImage: '🖼️ 启用聊天背景：为聊天区域设置自定义背景图片（支持图片 URL 或本地上传），并可调节透明度',
    sakura: '在页面中飘落樱花动画，营造浪漫氛围',
    image: '自动将 Markdown 图片链接和纯图片 URL 渲染为可点击预览的图片',
    strikethrough: '将 ~~text~~ 转换为删除线样式（代码块内不生效）',
    redirect: '仅当访问 www.deepseek.com 或 deepseek.com 时跳转到 chat.deepseek.com',
    title: '随机更换浏览器标签页标题，防止他人通过标题窥探浏览内容',
    narrow: '压缩聊天内容的左右内边距，使布局更紧凑、信息密度更高',
    citation: '移除回复中的 [citation:数字] 标记和来源引用图标',
    antiRecall: '拦截并缓存被撤回的回复，防止对话内容意外消失',
    mermaid: '渲染 Mermaid 代码块为图表（流程图、时序图、甘特图等）',
    autoRetry: '当出现重试按钮时自动点击，最多重试 10 次，避免手动操作',
    defaultMode: '新对话开始时自动切换到指定模式（快速/专家/识图）',
    removeForward: '移除消息上的转发/分享按钮，保持界面简洁',
    removeDownloadApp: '移除页面中的下载应用入口和下拉菜单中的下载选项',
    placeholderText: '修改输入框的占位符提示文字内容（修改文字而非颜色）',
    promptInject: '在每次发送消息时自动注入系统提示词（DeepSeek 不会显示但会遵循）',
    privacyShield: '将页面中消息容器内的敏感词替换为指定文本，保护隐私信息',
    caseSensitive: '敏感词替换时是否区分大小写（关闭则不区分大小写匹配）',
    copyCode: '点击 Markdown 行内代码时自动复制到剪贴板，方便快捷引用',
    folderPanel: '在 DeepSeek 侧边栏嵌入文件夹管理面板，支持两层层级结构和会话收藏',
    loopEngine: '启用循环引擎，AI 回复以信号标记结尾时自动继续对话，实现无人值守循环',
    loopNotify: '循环引擎每次执行时发送浏览器桌面通知，实时掌握进度',
    loopCrashRecovery: '循环引擎崩溃后自动恢复执行，3 分钟无活动自动暂停',
    loopDrift: '漂移防护：达到轮次上限时软暂停，可选延长或重新锚定到原始任务',
    loopUnattended: '无人值守模式：允许后台标签页运行，使用 Web Worker 防止节流',
    personaPerTask: '每步注入人格：每条循环命令都附带人格指令（而非仅首轮）',
    workflowAutoAdvance: '工作流自动推进：AI 完成一阶段后自动发送下一阶段指令',
    workflowPauseBetween: '步间暂停：每个工作流阶段完成后暂停，等待用户手动继续',
    inlineExport: '在每条 AI 回复旁添加导出按钮，可单独导出该条消息为 Markdown 文件',
    historyTags: '在历史搜索弹窗中注入标签过滤器，可给会话打标签并按标签筛选',
    contextMenu: '选中文本后弹出菜单，支持一键总结/解释/翻译，支持自定义场景模板',
    tokenSpeed: '在每条 AI 回复旁显示实时 token 数和输出速度（tok/s），需配合请求拦截',
    usageStats: '记录每轮对话的 token 数、速度和耗时，生成 30 天活跃热力图',
    // Agent 系统：总开关 + 3 个大模块
    agentSystem: '🤖 Agent 系统总开关：一键启用完整 Agent 能力（记忆 + 工具调用 + 循环）。开启后 AI 可主动调用工具保存/调用/审查记忆，并自动发送续跑消息形成 Agent 循环。注意：开启后 DeepSeek 会出现自动发消息的现象（工具结果回传），请勿手动干涉输入框',
    agentMemory: '🧠 记忆模块：自动将相关记忆注入到 prompt，让 AI 记住你的偏好和历史对话。提供记忆管理面板（增删改查、归档、导入导出）',
    agentTools: '🔧 工具调用模块：注入 [能力] 提示词，教会 AI 主动调用工具（memory_save/memory_recall/agent_finish 等 XML 标签），自动识别并执行 AI 输出的工具调用',
    agentLoop: '🔄 Agent 循环模块：工具调用执行后将结果包装在 <tool_results> XML 中作为新消息发送给 AI，让 AI 看到工具结果并继续对话（Agent 循环，最多 3 轮）。依赖工具调用模块',

    // Phase 6 新增模块开关描述
    webTools: '🌐 Web 工具总开关：启用后 AI 可通过 web_search 联网搜索、web_fetch 抓取网页正文',
    webSearch: '🔍 web_search 工具：经跨域请求抓取 DuckDuckGo/Bing 搜索结果，返回结构化标题/URL/摘要',
    webFetch: '📄 web_fetch 工具：抓取目标 URL 的可见正文文本，按站点白名单授权并截断到指定长度',
    mcp: '🔌 MCP 协议客户端：连接外部 MCP 服务器，扩展 AI 的工具调用能力（需在管理面板配置服务端）',
    project: '📁 项目管理工作台：管理多个项目，隔离会话/记忆/配置，支持快速切换与项目级上下文注入',
    pet: '🐳 桌面宠物：在页面角落显示一只鲸鱼宠物，根据对话状态切换心情与台词，陪伴你的对话',
    artifactsExport: '📤 制品导出：将 AI 生成的代码/文档导出为 HTML/Markdown/PDF 等制品文件',
    memoryImport: '📥 记忆导入：从外部文件（JSON/Markdown）批量导入记忆到记忆系统',
    sync: '🔄 数据同步：通过 WebDAV 同步配置/记忆/项目数据到云端，支持多设备数据一致',
    automationModule: '⏰ 自动化调度：定时执行预设任务，支持 cron 表达式调度与条件触发',
    multimodal: '🎨 多模态分析：分析图片/音频/视频内容，扩展 AI 对非文本模态的理解能力',
    pythonSandbox: '🐍 Python 沙箱：在浏览器中通过 Pyodide 执行 Python 代码，供 AI 调用以完成计算任务',
    codeFold: '📦 代码块折叠：自动折叠超过阈值的代码块，显示预览行数，支持折叠/展开切换',
    tableExport: '📊 表格优化导出：悬停表格显示 PNG/CSV 导出按钮，支持主题适配和列宽策略',
    thinkFold: '🧠 思考过程自动折叠：AI 开始思考后自动收起"已思考"过程，减少页面滚动',
};

// ============================================================
// 帮助弹出框（支持手机端触摸）
// ============================================================

/**
 * 显示帮助弹出框
 * @param {string} text - 帮助文本
 * @param {HTMLElement} anchorEl - 触发元素（用于定位）
 */
function showHelpPopup(text, anchorEl) {
    hideHelpPopup();

    const popup = document.createElement('div');
    popup.id = 'ds-help-popup';
    popup.textContent = text;
    popup.style.cssText = `
        position: fixed;
        background: rgba(0, 0, 0, 0.85);
        color: #fff;
        padding: 10px 16px;
        border-radius: 10px;
        font-size: 13px;
        max-width: 280px;
        z-index: 9999999;
        pointer-events: none;
        line-height: 1.6;
        box-shadow: 0 8px 24px rgba(0,0,0,0.4);
        animation: dsFadeIn 0.15s ease;
    `;

    const rect = anchorEl.getBoundingClientRect();
    let top = rect.bottom + 6;
    let left = rect.left;

    document.body.appendChild(popup);

    const popupRect = popup.getBoundingClientRect();
    if (left + popupRect.width > window.innerWidth - 8) {
        left = window.innerWidth - popupRect.width - 8;
    }
    if (top + popupRect.height > window.innerHeight - 8) {
        top = rect.top - popupRect.height - 6;
    }

    popup.style.top = top + 'px';
    popup.style.left = left + 'px';
}

/**
 * 隐藏帮助弹出框
 */
function hideHelpPopup() {
    const existing = document.getElementById('ds-help-popup');
    if (existing) existing.remove();
}

// ============================================================
// 预设列表
// ============================================================

/**
 * 构建预设列表 HTML（异步，数据来自 features/preset.js）
 * 支持激活/取消激活、删除操作
 * @returns {Promise<string>} 预设列表的 HTML 字符串
 */
async function buildPresetList() {
    const [presets, activeId] = await Promise.all([getAllPresets(), getActivePresetId()]);
    if (presets.length === 0) return '<div class="ds-empty-hint">暂无预设，添加一个吧</div>';
    return presets.map((p) => {
        const isActive = p.id === activeId;
        return `
        <div class="ds-preset-item ${isActive ? 'ds-preset-active' : ''}" data-id="${p.id}">
            <div class="ds-preset-info">
                <span class="ds-preset-name">${isActive ? '▶ ' : ''}${p.name || '未命名'}</span>
                <span class="ds-preset-prompt">${(p.content || '').slice(0, 80)}${p.content && p.content.length > 80 ? '…' : ''}</span>
            </div>
            <button class="ds-preset-toggle" data-id="${p.id}" title="${isActive ? '取消激活' : '激活此预设'}">${isActive ? '◉' : '○'}</button>
            <button class="ds-preset-delete" data-id="${p.id}" title="删除">✕</button>
        </div>
        `;
    }).join('');
}

/**
 * 刷新预设列表容器（异步渲染 + 重绑事件）
 * @param {HTMLElement} container - 预设列表容器元素
 */
async function refreshPresetList(container) {
    if (!container) return;
    container.innerHTML = await buildPresetList();
    container.querySelectorAll('.ds-preset-delete').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const id = e.target.dataset.id;
            await deletePreset(id);
            await refreshPresetList(container);
            showToast('预设已删除', { tone: 'success' });
        });
    });
    container.querySelectorAll('.ds-preset-toggle').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const id = e.target.dataset.id;
            const activeId = await getActivePresetId();
            // 切换激活状态：已激活则取消，未激活则激活
            await setActivePresetId(activeId === id ? null : id);
            await refreshPresetList(container);
            // 刷新 prompt-augmentation 的 preset 缓存
            if (typeof window.refreshPresetCache === 'function') {
                window.refreshPresetCache();
            }
            showToast(activeId === id ? '已取消激活' : '已激活预设', { tone: 'success' });
        });
    });
}

// ============================================================
// 场景模板列表
// ============================================================

/**
 * 转义字符串以安全用于 HTML 属性值
 * @param {string} s - 原始值
 * @returns {string} 转义后的值
 */
function escapeHtmlAttr(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * 构建场景列表 HTML（含内置与自定义，支持禁用/删除自定义）
 * @returns {Promise<string>} 场景列表的 HTML 字符串
 */
async function buildScenarioList() {
    const scenarios = await getAllScenarios({ includeDisabled: true });
    if (scenarios.length === 0) return '<div class="ds-empty-hint">暂无场景</div>';
    return scenarios.map((s) => {
        const isBuiltin = s.builtIn;
        const toggleTitle = s.enabled ? '点击禁用' : '点击启用';
        const toggleIcon = s.enabled ? '◉' : '○';
        return `
        <div class="ds-scenario-item ${s.enabled ? '' : 'ds-item-disabled'}" data-id="${escapeHtmlAttr(s.id)}">
            <div class="ds-scenario-info">
                <span class="ds-scenario-name">${isBuiltin ? '<span class="ds-badge ds-badge-builtin">内置</span>' : '<span class="ds-badge ds-badge-custom">自定义</span>'}${escapeHtmlAttr(s.label)}</span>
                <span class="ds-scenario-template">${escapeHtmlAttr(s.template).slice(0, 80)}${s.template.length > 80 ? '…' : ''}</span>
            </div>
            <button class="ds-item-toggle" data-id="${escapeHtmlAttr(s.id)}" data-action="toggle" title="${toggleTitle}">${toggleIcon}</button>
            ${isBuiltin ? '' : `<button class="ds-item-delete" data-id="${escapeHtmlAttr(s.id)}" data-action="delete" title="删除">✕</button>`}
        </div>
        `;
    }).join('');
}

/**
 * 刷新场景列表容器
 * @param {HTMLElement} container - 场景列表容器元素
 */
async function refreshScenarioList(container) {
    if (!container) return;
    container.innerHTML = await buildScenarioList();
    container.querySelectorAll('.ds-item-delete').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const id = e.target.dataset.id;
            await deleteScenario(id);
            await refreshScenarioList(container);
            showToast('场景已删除', { tone: 'success' });
        });
    });
    container.querySelectorAll('.ds-item-toggle').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const id = e.target.dataset.id;
            const all = await getAllScenarios({ includeDisabled: true });
            const target = all.find(s => s.id === id);
            if (!target) return;
            await saveScenario({ ...target, enabled: !target.enabled });
            await refreshScenarioList(container);
            showToast(target.enabled ? '场景已禁用' : '场景已启用', { tone: 'success' });
        });
    });
}

// ============================================================
// 技能库列表
// ============================================================

/**
 * 构建技能列表 HTML（含内置/自定义/远程，支持禁用自定义/删除自定义）
 *
 * 三类技能：
 *   - builtin：始终启用，不可删除/禁用（徽章"内置"）
 *   - custom：用户手动创建，可禁用/删除（徽章"自定义"）
 *   - remote：从 GitHub/文本导入，可禁用/删除，显示来源徽章
 *
 * @returns {Promise<string>} 技能列表的 HTML 字符串
 */
async function buildSkillList() {
    const skills = await getAllSkills({ includeDisabled: true });
    if (skills.length === 0) return '<div class="ds-empty-hint">暂无技能</div>';
    return skills.map((s) => {
        const isBuiltin = s.source === 'builtin';
        const isRemote = s.source === 'remote';
        const enabled = s.enabled !== false;
        const toggleTitle = enabled ? '点击禁用' : '点击启用';
        const toggleIcon = enabled ? '◉' : '○';
        // 徽章：内置 / 自定义 / GitHub / 文本
        let badge;
        if (isBuiltin) {
            badge = '<span class="ds-badge ds-badge-builtin">内置</span>';
        } else if (isRemote) {
            const provider = s.remote && s.remote.provider;
            if (provider === 'github') {
                badge = '<span class="ds-badge ds-badge-remote">GitHub</span>';
            } else if (provider === 'text') {
                badge = '<span class="ds-badge ds-badge-text">文本</span>';
            } else {
                badge = '<span class="ds-badge ds-badge-remote">远程</span>';
            }
        } else {
            badge = '<span class="ds-badge ds-badge-custom">自定义</span>';
        }
        // 来源备注（远程技能显示原始名 + 路径）
        const sourceNote = isRemote && s.remote
            ? `<span class="ds-skill-source">来源: ${escapeHtmlAttr(s.remote.originalName || s.remote.path || '')}</span>`
            : '';
        return `
        <div class="ds-skill-item ${enabled ? '' : 'ds-item-disabled'}" data-name="${escapeHtmlAttr(s.name)}">
            <div class="ds-skill-info">
                <span class="ds-skill-name">${badge}<code>/${escapeHtmlAttr(s.name)}</code></span>
                <span class="ds-skill-desc">${escapeHtmlAttr(s.description || '')}</span>
                ${sourceNote}
            </div>
            ${isBuiltin ? '' : `<button class="ds-item-toggle" data-name="${escapeHtmlAttr(s.name)}" data-action="toggle" title="${toggleTitle}">${toggleIcon}</button>`}
            ${isBuiltin ? '' : `<button class="ds-item-delete" data-name="${escapeHtmlAttr(s.name)}" data-action="delete" title="删除">✕</button>`}
        </div>
        `;
    }).join('');
}

/**
 * 构建技能源列表 HTML（GitHub 源 + 文本源）
 *
 * 每个源显示：名称/URL + 导入的技能数 + 检查更新/立即更新/删除按钮
 *
 * @returns {Promise<string>} 技能源列表的 HTML 字符串
 */
async function buildSkillSourceList() {
    const sources = await getAllSkillSources();
    if (!sources || sources.length === 0) return '<div class="ds-empty-hint">暂无导入源</div>';
    return sources.map(src => {
        const isGitHub = src.provider === 'github';
        const providerLabel = isGitHub ? 'GitHub' : '文本';
        const providerBadge = isGitHub
            ? '<span class="ds-badge ds-badge-remote">GitHub</span>'
            : '<span class="ds-badge ds-badge-text">文本</span>';
        const title = isGitHub ? (src.repository || src.url) : (src.displayName || 'Text Import');
        const subInfo = isGitHub
            ? `分支: ${escapeHtmlAttr(src.ref || '')} · 路径: ${escapeHtmlAttr(src.rootPath || '/')}`
            : `导入时间: ${new Date(src.importedAt).toLocaleString()}`;
        const skillCount = (src.importedSkillNames || []).length;
        return `
        <div class="ds-skill-source-item" data-source-id="${escapeHtmlAttr(src.id)}">
            <div class="ds-skill-info">
                <span class="ds-skill-name">${providerBadge}<code>${escapeHtmlAttr(title)}</code></span>
                <span class="ds-skill-desc">${subInfo} · 已导入 ${skillCount} 个技能</span>
            </div>
            ${isGitHub ? `<button class="ds-item-check" data-source-id="${escapeHtmlAttr(src.id)}" data-action="check" title="检查更新">⟳</button>` : ''}
            ${isGitHub ? `<button class="ds-item-update" data-source-id="${escapeHtmlAttr(src.id)}" data-action="update" title="立即更新">⬆</button>` : ''}
            <button class="ds-item-delete" data-source-id="${escapeHtmlAttr(src.id)}" data-action="delete-source" title="删除源（同时删除其下所有技能）">✕</button>
        </div>
        `;
    }).join('');
}

/**
 * 刷新技能列表容器
 * @param {HTMLElement} container - 技能列表容器元素
 */
async function refreshSkillList(container) {
    if (!container) return;
    container.innerHTML = await buildSkillList();
    container.querySelectorAll('.ds-item-delete[data-action="delete"]').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const name = e.target.dataset.name;
            await deleteSkill(name);
            await refreshSkillList(container);
            // 同步刷新源列表（删除 remote skill 可能影响源的 importedSkillNames）
            const sourceContainer = document.getElementById('skill-source-list-container');
            if (sourceContainer) await refreshSkillSourceList(sourceContainer);
            showToast('技能已删除', { tone: 'success' });
        });
    });
    container.querySelectorAll('.ds-item-toggle').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const name = e.target.dataset.name;
            const all = await getAllSkills({ includeDisabled: true });
            const target = all.find(s => s.name === name);
            if (!target) return;
            await setSkillEnabled(name, !(target.enabled !== false));
            await refreshSkillList(container);
            showToast(target.enabled !== false ? '技能已禁用' : '技能已启用', { tone: 'success' });
        });
    });
}

/**
 * 刷新技能源列表容器
 * @param {HTMLElement} container - 技能源列表容器元素
 */
async function refreshSkillSourceList(container) {
    if (!container) return;
    container.innerHTML = await buildSkillSourceList();
    // 删除源（同时删除其下所有技能）
    container.querySelectorAll('.ds-item-delete[data-action="delete-source"]').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const sourceId = e.target.dataset.sourceId;
            if (!confirm('删除此源将同时删除其导入的所有技能，确认继续？')) return;
            try {
                await deleteSkillSource(sourceId);
                await refreshSkillSourceList(container);
                const skillContainer = document.getElementById('skill-list-container');
                if (skillContainer) await refreshSkillList(skillContainer);
                showToast('源已删除', { tone: 'success' });
            } catch (err) {
                showToast('删除源失败：' + (err && err.message || err), { tone: 'error' });
            }
        });
    });
    // 检查 GitHub 源更新（仅查询，不写入）
    container.querySelectorAll('.ds-item-check[data-action="check"]').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const sourceId = e.target.dataset.sourceId;
            showToast('正在检查更新...', { tone: 'info' });
            try {
                const result = await checkGitHubSkillSourceUpdates(sourceId);
                if (result.hasUpdates) {
                    const parts = [];
                    if (result.changedPaths && result.changedPaths.length > 0) parts.push(`${result.changedPaths.length} 个已变更`);
                    if (result.newPaths && result.newPaths.length > 0) parts.push(`${result.newPaths.length} 个新增`);
                    if (result.missingPaths && result.missingPaths.length > 0) parts.push(`${result.missingPaths.length} 个已移除`);
                    showToast(`发现更新：${parts.join('，')}`, { tone: 'success' });
                } else {
                    showToast('已是最新版本', { tone: 'info' });
                }
            } catch (err) {
                showToast('检查更新失败：' + (err && err.message || err), { tone: 'error' });
            }
        });
    });
    // 立即更新 GitHub 源（重新拉取并写入）
    container.querySelectorAll('.ds-item-update[data-action="update"]').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const sourceId = e.target.dataset.sourceId;
            if (!confirm('更新此源将重新拉取并覆盖本地版本，确认继续？')) return;
            showToast('正在更新...', { tone: 'info' });
            try {
                const result = await updateGitHubSkillSource(sourceId);
                await refreshSkillSourceList(container);
                const skillContainer = document.getElementById('skill-list-container');
                if (skillContainer) await refreshSkillList(skillContainer);
                showToast(`更新成功：导入 ${result.imported.length} 个，替换 ${result.replaced} 个，重命名 ${result.renamed} 个`, { tone: 'success' });
            } catch (err) {
                showToast('更新失败：' + (err && err.message || err), { tone: 'error' });
            }
        });
    });
}

// ============================================================
// CSS 样式（现代化 + 响应式双栏布局）
// ============================================================

/**
 * 生成设置面板的完整 CSS 样式文本
 * @param {boolean} isDark - 是否深色模式
 * @param {Object} t - 主题配色对象
 * @returns {string} CSS 文本
 */
function buildStylesCSS(isDark, t) {
    return `
    @keyframes dsFadeIn { from { opacity: 0; } to { opacity: 1; } }
    @keyframes dsSlideUp { from { opacity: 0; transform: translateY(20px) scale(0.98); } to { opacity: 1; transform: translateY(0) scale(1); } }

    #ds-settings-modal {
        --ds-primary: ${t.primary};
        --ds-accent: ${t.accent};
        --ds-panel-bg: ${isDark ? '#1e1e2e' : '#ffffff'};
        --ds-panel-text: ${isDark ? '#cdd6f4' : '#1a1a2e'};
        --ds-panel-border: ${isDark ? '#313244' : '#e8e8ef'};
        --ds-card-bg: ${isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.025)'};
        --ds-input-bg: ${isDark ? '#313244' : '#f5f5f7'};
        --ds-input-border: ${isDark ? '#45475a' : '#d8d8e0'};
        --ds-section-color: ${isDark ? '#7f849c' : '#888'};
        --ds-hover-bg: ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)'};
        --ds-radius: 14px;
        --ds-radius-sm: 10px;
        --ds-radius-xs: 8px;
        --ds-shadow: 0 24px 80px rgba(0,0,0,0.4);
        --ds-transition: 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        --ds-sidebar-width: 160px;
    }

    #ds-settings-modal .ds-panel {
        animation: dsSlideUp 0.28s cubic-bezier(0.4, 0, 0.2, 1);
        display: flex; flex-direction: column;
    }

    #ds-settings-modal .ds-panel-header {
        display: flex; justify-content: space-between; align-items: flex-start;
        margin-bottom: 16px; flex-shrink: 0;
    }
    #ds-settings-modal .ds-panel-title {
        margin: 0; font-size: 24px; font-weight: 800;
        background: linear-gradient(135deg, ${t.primary}, ${t.accent});
        -webkit-background-clip: text; -webkit-text-fill-color: transparent;
        background-clip: text; letter-spacing: -0.5px;
    }
    #ds-settings-modal .ds-panel-subtitle {
        font-size: 12px; color: ${isDark ? '#7f849c' : '#aaa'};
        margin-top: 2px; display: block;
    }
    #ds-settings-modal .ds-close-btn {
        background: var(--ds-card-bg); border: none; font-size: 22px;
        cursor: pointer; color: inherit; opacity: 0.6;
        transition: var(--ds-transition); padding: 6px 10px;
        border-radius: var(--ds-radius-xs); line-height: 1; flex-shrink: 0;
    }
    #ds-settings-modal .ds-close-btn:hover { opacity: 1; }

    /* 双栏主体：侧边栏标签 + 内容区 */
    #ds-settings-modal .ds-body {
        display: flex; flex: 1; min-height: 0; gap: 0;
    }
    #ds-settings-modal .ds-tabs {
        display: flex; gap: 2px; overflow-x: auto;
        scrollbar-width: none; -ms-overflow-style: none;
        border-bottom: 2px solid var(--ds-panel-border);
        flex-shrink: 0;
    }
    #ds-settings-modal .ds-tabs::-webkit-scrollbar { display: none; }
    #ds-settings-modal .ds-tab {
        padding: 10px 16px; cursor: pointer; font-size: 14px; font-weight: 500;
        border-bottom: 2px solid transparent; margin-bottom: -2px;
        transition: var(--ds-transition); border-radius: var(--ds-radius-xs) var(--ds-radius-xs) 0 0;
        white-space: nowrap; opacity: 0.55;
    }
    #ds-settings-modal .ds-tab:hover { opacity: 0.85; background: var(--ds-hover-bg); }
    #ds-settings-modal .ds-tab.active {
        opacity: 1; border-bottom-color: var(--ds-primary); color: var(--ds-primary);
        font-weight: 700;
        background: var(--ds-hover-bg);
    }

    /* 标签内容 */
    #ds-settings-modal .ds-tab-content { display: none; }
    #ds-settings-modal .ds-tab-content.active { display: block; animation: dsFadeIn 0.2s ease; }

    /* 分区标题 */
    #ds-settings-modal .ds-section {
        font-weight: 600; font-size: 13px; margin: 16px 0 8px;
        color: var(--ds-section-color); text-transform: uppercase; letter-spacing: 0.5px;
    }
    #ds-settings-modal .ds-section:first-child { margin-top: 0; }

    /* 开关组件 */
    #ds-settings-modal .ds-toggle {
        position: relative; display: inline-block; width: 42px; height: 24px; flex-shrink: 0;
    }
    #ds-settings-modal .ds-toggle input { opacity: 0; width: 0; height: 0; }
    #ds-settings-modal .ds-slider {
        position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0;
        background: var(--ds-input-border); transition: var(--ds-transition);
        border-radius: 24px;
    }
    #ds-settings-modal .ds-slider:before {
        position: absolute; content: ""; height: 18px; width: 18px; left: 3px; bottom: 3px;
        background: white; transition: var(--ds-transition); border-radius: 50%;
        box-shadow: 0 2px 4px rgba(0,0,0,0.2);
    }
    #ds-settings-modal .ds-toggle input:checked + .ds-slider { background: var(--ds-primary); }
    #ds-settings-modal .ds-toggle input:checked + .ds-slider:before { transform: translateX(18px); }

    /* 设置行 */
    #ds-settings-modal .ds-row {
        display: flex; align-items: center; gap: 8px;
        padding: 9px 12px; border-radius: var(--ds-radius-xs);
        transition: background var(--ds-transition);
    }
    #ds-settings-modal .ds-row:hover { background: var(--ds-hover-bg); }
    #ds-settings-modal .ds-label { flex: 1; font-size: 14px; cursor: pointer; user-select: none; }

    /* 帮助图标 */
    #ds-settings-modal .ds-help {
        display: inline-flex; align-items: center; justify-content: center;
        width: 20px; height: 20px; border-radius: 50%;
        background: var(--ds-card-bg); color: var(--ds-section-color);
        font-size: 11px; font-weight: 700; cursor: pointer;
        transition: var(--ds-transition); flex-shrink: 0; user-select: none;
    }
    #ds-settings-modal .ds-help:hover { background: var(--ds-primary); color: #fff; }

    /* 信息卡片 */
    #ds-settings-modal .ds-info-card {
        margin-top: 12px; padding: 12px 14px; border-radius: var(--ds-radius-sm);
        background: var(--ds-card-bg); font-size: 12px; line-height: 1.7;
        color: var(--ds-section-color); border: 1px solid var(--ds-panel-border);
    }
    #ds-settings-modal .ds-info-card b { color: var(--ds-panel-text); }
    #ds-settings-modal .ds-info-card code {
        background: var(--ds-card-bg); padding: 2px 6px; border-radius: 4px;
        font-size: 11px; border: 1px solid var(--ds-panel-border);
    }
    /* 警告卡片（用于提示用户注意自动消息等副作用） */
    #ds-settings-modal .ds-warn-card {
        padding: 12px 14px; border-radius: var(--ds-radius-sm);
        background: rgba(245, 158, 11, 0.08);
        font-size: 12px; line-height: 1.7;
        color: var(--ds-section-color);
        border: 1px solid rgba(245, 158, 11, 0.35);
    }
    #ds-settings-modal .ds-warn-card-title {
        font-size: 13px; font-weight: 700; color: #d97706;
        margin-bottom: 6px;
    }
    #ds-settings-modal .ds-warn-card-body { color: var(--ds-section-color); }
    #ds-settings-modal .ds-warn-card-body b { color: #d97706; }

    /* 预设/场景/技能列表项通用样式 */
    #ds-settings-modal .ds-preset-item,
    #ds-settings-modal .ds-scenario-item,
    #ds-settings-modal .ds-skill-item {
        display: flex; align-items: center; justify-content: space-between;
        padding: 8px 12px; border-radius: var(--ds-radius-xs);
        background: var(--ds-card-bg); margin-bottom: 4px;
        transition: var(--ds-transition); gap: 8px;
    }
    #ds-settings-modal .ds-preset-item:hover,
    #ds-settings-modal .ds-scenario-item:hover,
    #ds-settings-modal .ds-skill-item:hover { background: var(--ds-hover-bg); }
    #ds-settings-modal .ds-item-disabled { opacity: 0.5; }
    #ds-settings-modal .ds-preset-info,
    #ds-settings-modal .ds-scenario-info,
    #ds-settings-modal .ds-skill-info {
        flex: 1; display: flex; flex-direction: column; gap: 2px; overflow: hidden;
    }
    #ds-settings-modal .ds-preset-name,
    #ds-settings-modal .ds-scenario-name,
    #ds-settings-modal .ds-skill-name {
        font-weight: 600; font-size: 14px;
        display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
    }
    #ds-settings-modal .ds-preset-prompt,
    #ds-settings-modal .ds-scenario-template,
    #ds-settings-modal .ds-skill-desc {
        font-size: 12px; color: var(--ds-section-color);
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    #ds-settings-modal .ds-skill-name code {
        background: var(--ds-card-bg); padding: 1px 6px; border-radius: 4px;
        font-size: 12px; border: 1px solid var(--ds-panel-border); color: var(--ds-primary);
    }
    /* 列表项操作按钮（启用/禁用切换 + 删除） */
    #ds-settings-modal .ds-preset-delete,
    #ds-settings-modal .ds-item-toggle,
    #ds-settings-modal .ds-item-delete {
        background: none; border: none; cursor: pointer;
        padding: 4px 8px; border-radius: 6px; transition: var(--ds-transition);
        font-size: 14px; line-height: 1; flex-shrink: 0;
    }
    #ds-settings-modal .ds-preset-delete,
    #ds-settings-modal .ds-item-delete { color: #e74c3c; font-size: 16px; }
    #ds-settings-modal .ds-preset-delete:hover,
    #ds-settings-modal .ds-item-delete:hover { background: rgba(231,76,60,0.15); }
    #ds-settings-modal .ds-item-toggle { color: var(--ds-primary); font-size: 16px; }
    #ds-settings-modal .ds-item-toggle:hover { background: var(--ds-hover-bg); }
    /* 来源徽章（内置/自定义） */
    #ds-settings-modal .ds-badge {
        display: inline-block; padding: 1px 7px; border-radius: 10px;
        font-size: 10px; font-weight: 600; line-height: 1.6; flex-shrink: 0;
    }
    #ds-settings-modal .ds-badge-builtin {
        background: rgba(99, 102, 241, 0.14); color: #6366f1;
        border: 1px solid rgba(99, 102, 241, 0.3);
    }
    #ds-settings-modal .ds-badge-custom {
        background: rgba(16, 185, 129, 0.14); color: #10b981;
        border: 1px solid rgba(16, 185, 129, 0.3);
    }
    /* 来源徽章：GitHub/远程(蓝) + 文本(橙) + 警告(黄) */
    #ds-settings-modal .ds-badge-remote {
        background: rgba(59, 130, 246, 0.14); color: #3b82f6;
        border: 1px solid rgba(59, 130, 246, 0.3);
    }
    #ds-settings-modal .ds-badge-text {
        background: rgba(245, 158, 11, 0.14); color: #f59e0b;
        border: 1px solid rgba(245, 158, 11, 0.3);
    }
    #ds-settings-modal .ds-badge-warn {
        background: rgba(234, 179, 8, 0.14); color: #eab308;
        border: 1px solid rgba(234, 179, 8, 0.3);
    }
    /* 技能源列表项（与 skill-item 同样式，但多出 check/update 按钮） */
    #ds-settings-modal .ds-skill-source-item {
        display: flex; align-items: center; justify-content: space-between;
        padding: 8px 12px; border-radius: var(--ds-radius-xs);
        background: var(--ds-card-bg); margin-bottom: 4px;
        transition: var(--ds-transition); gap: 8px;
    }
    #ds-settings-modal .ds-skill-source-item:hover { background: var(--ds-hover-bg); }
    /* 技能来源备注（小字） */
    #ds-settings-modal .ds-skill-source {
        font-size: 11px; color: var(--ds-section-color); opacity: 0.8;
    }
    /* GitHub 预览列表项（checkbox + 技能信息） */
    #ds-settings-modal .ds-skill-preview-list {
        display: flex; flex-direction: column; gap: 4px;
        max-height: 320px; overflow-y: auto;
    }
    #ds-settings-modal .ds-skill-preview-item {
        display: flex; align-items: flex-start; gap: 8px;
        padding: 8px 12px; border-radius: var(--ds-radius-xs);
        background: var(--ds-card-bg); cursor: pointer;
        border: 1px solid var(--ds-panel-border);
    }
    #ds-settings-modal .ds-skill-preview-item:hover { background: var(--ds-hover-bg); }
    #ds-settings-modal .ds-skill-preview-item input[type="checkbox"] {
        margin-top: 3px; flex-shrink: 0;
    }
    /* 源列表的 check/update 按钮 */
    #ds-settings-modal .ds-item-check,
    #ds-settings-modal .ds-item-update {
        background: none; border: none; cursor: pointer;
        padding: 4px 8px; border-radius: 6px; transition: var(--ds-transition);
        font-size: 14px; line-height: 1; flex-shrink: 0;
    }
    #ds-settings-modal .ds-item-check { color: var(--ds-primary); }
    #ds-settings-modal .ds-item-check:hover { background: var(--ds-hover-bg); }
    #ds-settings-modal .ds-item-update { color: #f59e0b; }
    #ds-settings-modal .ds-item-update:hover { background: rgba(245,158,11,0.15); }
    #ds-settings-modal .ds-empty-hint { color: var(--ds-section-color); font-size: 13px; padding: 12px; text-align: center; }

    /* 输入框组：用圆角边框把"输入框 + 添加按钮"包成一组，强调操作关联 */
    #ds-settings-modal .ds-add-row {
        display: flex; gap: 0; margin-top: 10px; flex-wrap: wrap;
        padding: 6px; border-radius: var(--ds-radius-sm);
        background: var(--ds-card-bg); border: 1px solid var(--ds-panel-border);
        align-items: stretch;
    }
    #ds-settings-modal .ds-add-row input {
        flex: 1; min-width: 90px;
        background: transparent; border: 1px solid transparent;
        padding: 7px 10px; border-radius: var(--ds-radius-xs);
        color: var(--ds-panel-text);
    }
    #ds-settings-modal .ds-add-row input:focus {
        outline: none; border-color: var(--ds-primary);
        background: var(--ds-input-bg);
    }
    #ds-settings-modal .ds-add-row .ds-btn {
        margin-left: 6px; flex-shrink: 0;
    }
    #ds-settings-modal .ds-add-row .ds-btn-primary {
        background: var(--ds-primary); color: #fff;
    }
    /* 输入框提示示例（在输入框组下方显示具体示例） */
    #ds-settings-modal .ds-input-hint {
        margin-top: 6px; padding-left: 4px;
        font-size: 11px; line-height: 1.6;
        color: var(--ds-section-color);
    }
    #ds-settings-modal .ds-input-hint code {
        background: var(--ds-card-bg); padding: 1px 6px; border-radius: 4px;
        font-size: 11px; border: 1px solid var(--ds-panel-border);
        color: var(--ds-primary);
    }

    /* 通用输入框 */
    #ds-settings-modal .ds-input {
        padding: 8px 12px; border-radius: var(--ds-radius-xs);
        border: 1px solid var(--ds-input-border); background: var(--ds-input-bg);
        width: 100%; font-size: 14px; box-sizing: border-box;
        color: var(--ds-panel-text); transition: var(--ds-transition);
    }
    #ds-settings-modal .ds-input:focus {
        outline: none; border-color: var(--ds-primary);
        box-shadow: 0 0 0 3px rgba(0,0,0,0.04);
    }
    #ds-settings-modal .ds-input-row {
        display: flex; gap: 8px; align-items: center;
        margin-bottom: 8px; flex-wrap: wrap;
    }
    #ds-settings-modal .ds-input-row label { font-size: 13px; min-width: 90px; flex-shrink: 0; }
    #ds-settings-modal textarea.ds-input { resize: vertical; line-height: 1.6; }

    /* 多模态配置：Key 输入框下方安全提示小字 */
    #ds-settings-modal .ds-mm-key-hint {
        font-size: 11px; color: var(--ds-section-color);
        margin: 2px 0 8px 98px; line-height: 1.5;
    }
    @media (max-width: 480px) {
        #ds-settings-modal .ds-mm-key-hint { margin-left: 76px; }
    }

    /* 按钮 */
    #ds-settings-modal .ds-btn {
        padding: 9px 16px; border: none; border-radius: var(--ds-radius-sm);
        font-weight: 600; font-size: 13px; cursor: pointer;
        transition: var(--ds-transition); display: inline-flex;
        align-items: center; justify-content: center; gap: 4px;
    }
    #ds-settings-modal .ds-btn-primary { background: var(--ds-primary); color: #fff; }
    #ds-settings-modal .ds-btn-primary:hover { opacity: 0.88; transform: translateY(-1px); }
    #ds-settings-modal .ds-btn-accent { background: var(--ds-accent); color: #fff; }
    #ds-settings-modal .ds-btn-accent:hover { opacity: 0.88; transform: translateY(-1px); }
    #ds-settings-modal .ds-btn-outline {
        background: transparent; border: 1px solid var(--ds-panel-border);
        color: var(--ds-panel-text);
    }
    #ds-settings-modal .ds-collapse-btn.active {
        background: var(--ds-primary); color: #fff;
    }
    #ds-settings-modal .ds-btn-outline:hover { background: var(--ds-hover-bg); }
    #ds-settings-modal .ds-btn-row { display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
    #ds-settings-modal .ds-btn-row .ds-btn { flex: 1; min-width: 100px; }

    /* 敏感词标签 */
    #ds-settings-modal .ds-tag {
        display: flex; align-items: center; justify-content: space-between;
        padding: 6px 12px; margin: 3px 0; border-radius: var(--ds-radius-xs);
        background: var(--ds-card-bg); font-size: 13px;
        border: 1px solid var(--ds-panel-border);
    }
    #ds-settings-modal .ds-tag-remove {
        background: rgba(239,68,68,0.12); border: none; border-radius: 6px;
        padding: 2px 10px; cursor: pointer; color: #ef4444; font-size: 12px;
        transition: var(--ds-transition);
    }
    #ds-settings-modal .ds-tag-remove:hover { background: rgba(239,68,68,0.25); }

    /* 主题选择器 */
    #ds-settings-modal .ds-theme-dot {
        display: inline-block; width: 32px; height: 32px; border-radius: 50%;
        cursor: pointer; border: 3px solid transparent;
        box-shadow: 0 2px 8px rgba(0,0,0,0.15); margin: 4px;
        transition: var(--ds-transition);
    }
    #ds-settings-modal .ds-theme-dot:hover { transform: scale(1.1); }
    #ds-settings-modal .ds-theme-label {
        display: inline-block; padding: 4px 14px; border-radius: 20px;
        background: var(--ds-input-bg); color: var(--ds-panel-text);
        font-size: 13px; cursor: pointer; border: 3px solid transparent;
        margin: 4px; transition: var(--ds-transition);
    }
    #ds-settings-modal .ds-theme-label:hover { transform: scale(1.05); }

    /* 滑块 */
    #ds-settings-modal input[type="range"] {
        -webkit-appearance: none; appearance: none; height: 6px;
        border-radius: 3px; background: var(--ds-input-border); outline: none;
    }
    #ds-settings-modal input[type="range"]::-webkit-slider-thumb {
        -webkit-appearance: none; appearance: none; width: 18px; height: 18px;
        border-radius: 50%; background: var(--ds-primary); cursor: pointer;
        box-shadow: 0 2px 4px rgba(0,0,0,0.2);
    }
    #ds-settings-modal input[type="range"]::-moz-range-thumb {
        width: 18px; height: 18px; border-radius: 50%; border: none;
        background: var(--ds-primary); cursor: pointer;
    }

    /* 底部操作栏：保存与恢复默认按钮统一高度/圆角，用主次颜色区分优先级 */
    #ds-settings-modal .ds-footer {
        display: flex; gap: 12px; margin-top: 20px; flex-shrink: 0;
    }
    #ds-settings-modal .ds-footer .ds-btn-save {
        flex: 1; padding: 13px 20px; font-size: 15px; font-weight: 700;
        border-radius: var(--ds-radius-sm);
        background: linear-gradient(135deg, ${t.primary}, ${t.accent});
        box-shadow: 0 4px 16px ${t.glow};
        color: #fff; border: none; cursor: pointer;
        transition: var(--ds-transition);
        display: inline-flex; align-items: center; justify-content: center; gap: 4px;
    }
    #ds-settings-modal .ds-footer .ds-btn-save:hover { opacity: 0.9; transform: translateY(-1px); }
    #ds-settings-modal .ds-footer .ds-btn-reset {
        padding: 13px 20px; font-size: 14px; font-weight: 600;
        border-radius: var(--ds-radius-sm);
        background: var(--ds-card-bg);
        color: var(--ds-panel-text);
        border: 1px solid var(--ds-panel-border);
        cursor: pointer; transition: var(--ds-transition);
        flex-shrink: 0;
        display: inline-flex; align-items: center; justify-content: center; gap: 4px;
    }
    #ds-settings-modal .ds-footer .ds-btn-reset:hover {
        background: var(--ds-hover-bg); border-color: var(--ds-primary); color: var(--ds-primary);
    }

    /* ====== 响应式：桌面端双栏布局（>900px） ====== */
    @media (min-width: 901px) {
        #ds-settings-modal .ds-body { flex-direction: row; }
        #ds-settings-modal .ds-tabs {
            flex-direction: column; width: var(--ds-sidebar-width);
            border-bottom: none; border-right: 2px solid var(--ds-panel-border);
            padding-right: 4px; overflow-y: auto; overflow-x: hidden;
            gap: 2px;
        }
        #ds-settings-modal .ds-tab {
            border-bottom: none; border-right: 3px solid transparent;
            margin-bottom: 0; margin-right: -2px;
            border-radius: var(--ds-radius-xs);
            padding: 11px 14px;
            opacity: 0.6;
        }
        #ds-settings-modal .ds-tab:hover { opacity: 0.85; }
        #ds-settings-modal .ds-tab.active {
            border-right-color: var(--ds-primary); border-bottom-color: transparent;
            opacity: 1; font-weight: 700;
            background: var(--ds-hover-bg);
            color: var(--ds-primary);
        }
        #ds-settings-modal .ds-tab-content-wrapper {
            flex: 1; overflow-y: auto; padding-left: 20px; min-width: 0;
        }
    }

    /* ====== 响应式：平板/手机竖向布局（≤900px） ====== */
    @media (max-width: 900px) {
        #ds-settings-modal .ds-body { flex-direction: column; }
        #ds-settings-modal .ds-tabs {
            border-bottom: 2px solid var(--ds-panel-border);
            border-right: none; padding-right: 0;
        }
        #ds-settings-modal .ds-tab-content-wrapper {
            overflow-y: auto; flex: 1; padding-top: 12px;
        }
    }

    /* ====== 响应式：平板（≤768px） ====== */
    @media (max-width: 768px) {
        #ds-settings-modal .ds-panel {
            width: 95% !important; max-width: none !important;
            padding: 20px !important; border-radius: 16px !important;
        }
        #ds-settings-modal .ds-tab { padding: 8px 12px; font-size: 13px; }
        #ds-settings-modal .ds-input-row label { min-width: 80px; }
    }

    /* ====== 响应式：手机（≤480px）底部工作表 ====== */
    @keyframes dsSlideUpSheet { from { transform: translateY(100%); } to { transform: translateY(0); } }
    @media (max-width: 480px) {
        #ds-settings-modal {
            align-items: flex-end !important;
        }
        #ds-settings-modal .ds-panel {
            width: 100% !important; max-width: none !important;
            max-height: 85vh !important; height: auto !important;
            padding: 16px 14px !important;
            border-radius: 20px 20px 0 0 !important;
            border: none !important;
            animation: dsSlideUpSheet 0.3s cubic-bezier(0.4, 0, 0.2, 1) !important;
            box-shadow: 0 -8px 32px rgba(0,0,0,0.3) !important;
        }
        #ds-settings-modal .ds-panel-header { margin-bottom: 12px; }
        #ds-settings-modal .ds-panel-title { font-size: 18px; }
        #ds-settings-modal .ds-panel-subtitle { font-size: 11px; }
        #ds-settings-modal .ds-tab { padding: 7px 10px; font-size: 12px; }
        #ds-settings-modal .ds-row { padding: 7px 6px; }
        #ds-settings-modal .ds-label { font-size: 13px; }
        #ds-settings-modal .ds-input-row { margin-bottom: 6px; }
        #ds-settings-modal .ds-input-row label { min-width: 68px; font-size: 12px; }
        #ds-settings-modal .ds-input { font-size: 13px; padding: 7px 10px; }
        #ds-settings-modal .ds-btn { font-size: 12px; padding: 8px 12px; }
        #ds-settings-modal .ds-btn-row { gap: 6px; }
        #ds-settings-modal .ds-btn-row .ds-btn { min-width: 72px; }
        #ds-settings-modal .ds-section { font-size: 12px; margin: 12px 0 6px; }
        #ds-settings-modal .ds-footer { gap: 8px; margin-top: 16px; }
        #ds-settings-modal .ds-footer .ds-btn-save { font-size: 14px; padding: 12px 14px; }
        #ds-settings-modal .ds-footer .ds-btn-reset { font-size: 13px; padding: 12px 14px; }
        /* 拖动指示条（视觉提示这是底部工作表） */
        #ds-settings-modal .ds-sheet-handle {
            display: block !important;
            width: 36px; height: 4px; border-radius: 2px;
            background: var(--ds-input-border); margin: -4px auto 10px;
            opacity: 0.6;
        }
    }

    /* ====== 记忆管理面板样式 ====== */
    #ds-settings-modal ${getMemoryPanelCSS()}
    `;
}

// ============================================================
// 标签页 HTML 构建器（按分类拆分，减少单函数体积）
// ============================================================

/**
 * 生成开关行的 HTML
 * 标签和描述优先走 i18n（settings.toggle.<id>.label / .desc），
 * key 缺失时回退到传入的 label 和 optionDescriptions 硬编码文案
 * @param {string} id - 配置短 ID
 * @param {string} label - 显示标签（i18n 缺失时的回退）
 * @returns {string} HTML 字符串
 */
function toggleRow(id, label) {
    const labelKey = 'settings.toggle.' + id + '.label';
    const descKey = 'settings.toggle.' + id + '.desc';
    const tLabel = t(labelKey);
    const tDesc = t(descKey);
    // t() 在 key 缺失时返回 key 本身，此时回退到传入的 label / optionDescriptions
    const finalLabel = tLabel === labelKey ? label : tLabel;
    const finalDesc = tDesc === descKey ? (optionDescriptions[id] || '') : tDesc;
    return `
        <div class="ds-row">
            <span class="ds-label" data-toggle="${id}">${finalLabel}</span>
            <span class="ds-help" data-help="${finalDesc}">?</span>
            <label class="ds-toggle">
                <input type="checkbox" id="chk-${id}" ${CONFIG[OPTION_CONFIG_KEYS[id]] ? 'checked' : ''}>
                <span class="ds-slider"></span>
            </label>
        </div>
    `;
}

/**
 * 构建外观标签页 HTML
 *
 * 结构：
 *   - 主题颜色 / 樱花 / 窄边距（默认开启且隐藏）/ 字体自定义（系统字体隐藏）
 *   - 聊天背景 / 占位符文字 / 桌面宠物
 *
 * @param {string} themeOptions - 主题选择器选项 HTML
 * @returns {string}
 */
function buildAppearanceTab(themeOptions) {
    return `
        <div class="ds-tab-content active" data-content="appearance">
            <div class="ds-section">${tt('settings.section.themeAtmosphere', '主题与氛围')}</div>
            <div id="theme-selector" style="display:flex;flex-wrap:wrap;align-items:center;margin-bottom:8px;">${themeOptions}</div>
            ${toggleRow('sakura', '🌸 樱花飘落')}
            ${toggleRow('pet', '🐳 桌面宠物')}

            <div class="ds-section">${tt('settings.section.layoutFont', '布局与字体')}</div>
            <div class="ds-row" id="ds-row-narrow" style="display:none;">
                <span class="ds-label" data-toggle="narrow">📐 窄边距</span>
                <span class="ds-help" data-help="${optionDescriptions.narrow}">?</span>
                <label class="ds-toggle">
                    <input type="checkbox" id="chk-narrow" ${CONFIG.narrowPaddingEnabled ? 'checked' : ''}>
                    <span class="ds-slider"></span>
                </label>
            </div>
            ${toggleRow('fontCustom', '🔤 启用字体自定义')}
            <div class="ds-input-row" id="ds-row-font-family" style="display:none;">
                <label>系统字体</label>
                <input type="text" class="ds-input" id="font-family" placeholder="如：Arial, 'Microsoft YaHei'" value="${CONFIG.fontFamily || ''}" style="flex:1;">
            </div>
            <div class="ds-input-row">
                <label>在线字体</label>
                <input type="text" class="ds-input" id="font-url" placeholder=".woff2 / .ttf 或 Google Fonts CSS" value="${CONFIG.fontUrl || ''}" style="flex:1;">
            </div>

            <div class="ds-section">${tt('settings.section.chatBackground', '🖼️ 聊天背景')}</div>
            ${toggleRow('bgImage', '🖼️ 启用聊天背景')}
            <div class="ds-input-row">
                <label>图片 URL</label>
                <input type="text" class="ds-input" id="bg-image" placeholder="输入图片链接或选择文件" value="${CONFIG.bgImage || ''}" style="flex:1;">
                <input type="file" id="bg-file-input" accept="image/*" style="max-width:120px;">
            </div>
            <div class="ds-input-row">
                <label>透明度</label>
                <input type="range" id="bg-opacity" min="0" max="1" step="0.05" value="${CONFIG.bgOpacity !== undefined ? CONFIG.bgOpacity : 0.5}" style="flex:1;">
                <span id="bg-opacity-label" style="min-width:36px;text-align:right;font-size:13px;">${(CONFIG.bgOpacity !== undefined ? CONFIG.bgOpacity : 0.5).toFixed(2)}</span>
            </div>

            <div class="ds-section">${tt('settings.section.interfaceCustom', 'UI 定制')}</div>
            ${toggleRow('placeholderText', '💬 修改占位符文字')}
            <div class="ds-input-row" style="margin-top:4px;">
                <label>占位文字</label>
                <input type="text" class="ds-input" id="placeholder-text" placeholder="如：说点什么吧～" value="${CONFIG.placeholderText || ''}" style="flex:1;">
            </div>
        </div>
    `;
}

/**
 * 构建对话增强标签页 HTML
 *
 * 结构：
 *   - 内容渲染 / 交互增强 / 导出与统计 / 对话上下文
 *
 * @returns {string}
 */
function buildEnhanceTab() {
    return `
        <div class="ds-tab-content" data-content="enhance">
            <div class="ds-section">${tt('settings.section.contentRender', '内容渲染')}</div>
            ${toggleRow('image', '🖼️ 图片渲染')}
            ${toggleRow('strikethrough', '✏️ 删除线渲染')}
            ${toggleRow('mermaid', '📊 Mermaid 图表')}
            ${toggleRow('citation', '🗑️ 移除角标')}
            ${toggleRow('copyCode', '📋 行内代码点击复制')}

            <div class="ds-section">${tt('settings.section.dialogEnhance', '交互增强')}</div>
            ${toggleRow('antiRecall', '🛡️ 防撤回')}
            ${toggleRow('autoRetry', '🔄 自动重试')}
            ${toggleRow('folderPanel', '📁 文件夹管理')}
            ${toggleRow('defaultMode', '⚡ 默认模式')}
            <div class="ds-input-row" style="margin-top:4px;">
                <label>目标模式</label>
                <select id="default-mode-select" class="ds-input" style="flex:1;">
                    <option value="default" ${(CONFIG.defaultMode || 'default') === 'default' ? 'selected' : ''}>快速模式（不切换）</option>
                    <option value="expert" ${CONFIG.defaultMode === 'expert' ? 'selected' : ''}>专家模式</option>
                    <option value="vision" ${CONFIG.defaultMode === 'vision' ? 'selected' : ''}>识图模式</option>
                </select>
            </div>
            ${toggleRow('contextMenu', '🖱️ 右键场景模板')}
            ${IS_ELECTRON ? '' : toggleRow('tokenSpeed', '⚡ Token 速度指示器')}
            ${toggleRow('magicWand', '🪄 页面缩略控制')}

            <div class="ds-section">${tt('settings.section.pageEnhance', '页面增强')}</div>
            ${toggleRow('codeFold', '📦 代码块折叠')}
            ${toggleRow('tableExport', '📊 表格优化导出')}
            ${toggleRow('thinkFold', '🧠 思考过程自动折叠')}

            <div class="ds-collapse-btn-row" style="margin-top:4px;display:flex;flex-wrap:wrap;gap:6px;">
                <button class="ds-btn ds-collapse-btn" data-action="sidebar" title="切换侧边栏宽度">📐 侧边栏</button>
                <button class="ds-btn ds-collapse-btn" data-action="font" title="切换用户对话字体大小">🔤 字体</button>
                <button class="ds-btn ds-collapse-btn" data-action="textarea" title="扩展/收起输入框">📝 输入框</button>
            </div>

            <div class="ds-section" style="margin-top:12px;">${tt('settings.section.dialogContext', '对话上下文')}</div>
            ${toggleRow('timeInject', '🕐 时间注入')}

            <div class="ds-section">${tt('settings.section.quickActions', '快捷操作')}</div>
            ${toggleRow('inlineExport', '📤 消息内联导出')}
            ${toggleRow('historyTags', '🏷️ 历史标签搜索')}
            <div class="ds-info-card">点击下方按钮导出当前对话，数据来源优先级：API 拦截 → 直接请求 → DOM 提取。截图导出需联网加载 html2canvas。</div>
            <div class="ds-btn-row">
                <button id="ds-export-json-btn" class="ds-btn ds-btn-primary">📥 导出 JSON</button>
                <button id="ds-export-md-btn" class="ds-btn ds-btn-primary">📝 导出 MD</button>
                <button id="ds-export-img-btn" class="ds-btn ds-btn-primary">📸 截图 PNG</button>
            </div>

            <div class="ds-section">${tt('settings.section.statsExport', '统计与导出')}</div>
            ${IS_ELECTRON ? '' : toggleRow('usageStats', '📊 启用使用量统计')}
            ${IS_ELECTRON ? '' : '<div id="ds-usage-panel-container" style="margin-top:8px;"></div>'}
        </div>
    `;
}



/**
 * 构建隐私标签页 HTML
 *
 * 包含：浏览隐私 + 敏感词替换
 *
 * @returns {string}
 */
function buildPrivacyTab() {
    return `
        <div class="ds-tab-content" data-content="privacy">
            <div class="ds-section">${tt('settings.section.browsePrivacy', '浏览隐私')}</div>
            ${toggleRow('title', '🎭 标题伪装')}
            ${toggleRow('redirect', '↗️ 自动跳转')}
            <div class="ds-input-row" style="margin-top:8px;">
                <label>标题列表</label>
                <textarea id="title-list-text" rows="5" class="ds-input" style="flex:1;" placeholder="每行一个标题">${(CONFIG.titleList || DEFAULTS.titleList).join('\n')}</textarea>
            </div>
            <div class="ds-section">${tt('settings.section.sensitiveReplace', '🔐 敏感词替换')}</div>
            ${toggleRow('privacyShield', '🛡️ 启用敏感词替换')}
            ${toggleRow('caseSensitive', '🔍 区分大小写')}
            <div class="ds-add-row">
                <input type="text" class="ds-input" id="sensitive-word-input" placeholder="敏感词" style="flex:1;">
                <input type="text" class="ds-input" id="sensitive-replacement-input" placeholder="替换为" style="flex:1;">
                <button id="add-sensitive-word-btn" class="ds-btn ds-btn-primary">添加</button>
            </div>
            <div id="sensitive-word-list" style="margin-top:8px;"></div>
        </div>
    `;
}

/**
 * 构建功能扩展标签页 HTML
 *
 * 合并：预设与模板 + 对话上下文 + 界面清理
 *
 * @returns {string}
 */
function buildFeaturesTab() {
    return `
        <div class="ds-tab-content" data-content="features">
            ${IS_ELECTRON ? `
                <div class="ds-info-card">
                    <b>预设/场景/技能/提示词注入</b> 由 DeepSeek++ 扩展统一管理。<br>
                    请使用侧边栏中的 DeepSeek++ 面板来配置这些功能。
                </div>
            ` : `
            <div class="ds-section">${tt('settings.section.presetTemplate', '预设与模板')}</div>

            <div class="ds-section" style="font-size:13px;margin-top:4px;">${tt('settings.section.messagePreset', '💬 预设系统')}</div>
            <div class="ds-info-card">激活的预设会自动注入到每条消息前缀（无需手动操作）。点击 <code>◉</code> 切换激活状态，<code>✕</code> 删除。在聊天框输入 <code>/</code> 可打开侧边栏，已激活的预设标注"已激活"不可注入，未激活的预设可点击注入。</div>
            <div id="preset-list-container" style="margin-top:10px;"></div>
            <div class="ds-add-row">
                <input type="text" class="ds-input" id="preset-name" placeholder="名称（如：猫娘）">
                <input type="text" class="ds-input" id="preset-prompt" placeholder="提示词（如：你是一个猫娘）">
                <button id="add-preset-btn" class="ds-btn ds-btn-primary">+ 添加</button>
            </div>
            <div class="ds-input-hint">示例：名称填 <code>猫娘</code>，提示词填 <code>你是一个可爱的猫娘，每句话后面加"喵~"</code></div>

            <div class="ds-section" style="font-size:13px;margin-top:12px;">${tt('settings.section.scenarioTemplate', '📋 场景模板')}</div>
            ${toggleRow('scenarios', '📋 启用场景模板')}
            <div class="ds-info-card">选中文本后右键可套用场景模板。<b>内置场景</b>不可删除，可禁用；<b>自定义场景</b>可删除。</div>
            <div id="scenario-list-container" style="margin-top:10px;"></div>
            <div class="ds-add-row">
                <input type="text" class="ds-input" id="scenario-label" placeholder="场景名称（如：缩写）">
                <input type="text" class="ds-input" id="scenario-template" placeholder="模板（用 {text} 表示选中文本）">
                <button id="add-scenario-btn" class="ds-btn ds-btn-primary">+ 添加</button>
            </div>
            <div class="ds-input-hint">示例：名称填 <code>缩写</code>，模板填 <code>请将以下内容缩写为要点：{text}</code>，使用时选中文字右键即可套用</div>

            <div class="ds-section" style="font-size:13px;margin-top:12px;">${tt('settings.section.skillLibrary', '⚡ 技能库')}</div>
            ${toggleRow('skill', '⚡ 启用技能系统')}
            ${toggleRow('skillSidebar', '📋 技能侧边栏（输入 / 时显示技能列表）')}
            <div class="ds-info-card">在聊天输入框输入 <code>/技能名 参数</code> 触发技能。<b>内置技能</b>始终启用；<b>自定义技能</b>可禁用/删除，添加后需编辑指令正文。</div>
            <div id="skill-list-container" style="margin-top:10px;"></div>
            <div class="ds-add-row">
                <input type="text" class="ds-input" id="skill-name" placeholder="技能名（kebab-case）">
                <input type="text" class="ds-input" id="skill-description" placeholder="简短描述">
                <button id="add-skill-btn" class="ds-btn ds-btn-primary">+ 添加</button>
            </div>
            <div class="ds-input-hint">
                命名规范：仅小写字母/数字/连字符，如 <code>my-skill</code>、<code>kebit</code><br>
                使用示例：在聊天框输入 <code>/my-skill 生成 3</code>，<code>{args}</code> 会被替换为 <code>生成 3</code>
            </div>
            ${buildSkillImportSection()}

            <div class="ds-section">${tt('settings.section.dialogContext', '对话上下文')}</div>
            ${toggleRow('promptInject', '🤖 系统提示词注入')}
            <div class="ds-input-row" style="margin-top:4px;">
                <label>提示词内容</label>
                <textarea id="prompt-inject-text" rows="4" class="ds-input" style="flex:1;" placeholder="输入系统提示词，将在每次对话时自动注入…">${CONFIG.promptText || ''}</textarea>
            </div>
            `}

            <div class="ds-section">${tt('settings.section.interfaceCleanup', '界面清理')}</div>
            ${toggleRow('removeForward', '✂️ 移除转发按钮')}
            ${toggleRow('removeDownloadApp', '📱 移除下载入口')}
        </div>
    `;
}

/**
 * 构建技能导入区域 HTML（GitHub 导入 + 文本导入 + 源列表）
 *
 * 用于 buildFeaturesTab 的技能库分区
 *
 * @returns {string}
 */
function buildSkillImportSection() {
    return `
        <div class="ds-section" style="margin-top:18px;">${tt('settings.section.skillImport', '📥 导入技能')}</div>

        <!-- GitHub 导入 -->
        <div class="ds-info-card">
            <b>从 GitHub 导入</b>：支持仓库/目录/SKILL.md 链接，会自动拉取同目录下的资源文件（references/agents/templates/examples）。
        </div>
        <div class="ds-add-row">
            <input type="text" class="ds-input" id="skill-github-url" placeholder="GitHub URL（如 https://github.com/owner/repo/tree/main/skills）">
            <button id="skill-preview-github-btn" class="ds-btn">🔍 预览</button>
        </div>
        <div id="skill-github-preview" style="margin-top:8px;"></div>

        <!-- 文本导入 -->
        <div class="ds-info-card" style="margin-top:12px;">
            <b>从文本导入</b>：粘贴 SKILL.md 全文（含 YAML frontmatter），格式见下方示例。
        </div>
        <textarea class="ds-input" id="skill-text-content" rows="6" placeholder="---&#10;name: my-skill&#10;description: 描述&#10;---&#10;指令正文（可用 {args} 占位符）" style="width:100%;font-family:monospace;font-size:12px;margin-top:6px;"></textarea>
        <div class="ds-add-row" style="margin-top:6px;">
            <input type="text" class="ds-input" id="skill-text-display-name" placeholder="源名称（可选，如：我的自定义技能）">
            <input type="text" class="ds-input" id="skill-text-skill-name" placeholder="导入后的技能名（可选）">
            <button id="skill-import-text-btn" class="ds-btn ds-btn-primary">📥 从文本导入</button>
        </div>

        <!-- 技能源列表 -->
        <div class="ds-section" style="margin-top:18px;">${tt('settings.section.skillSources', '📦 已导入的源')}</div>
        <div id="skill-source-list-container" style="margin-top:8px;"></div>
    `;
}

/**
 * 构建 Agent 标签页 HTML
 *
 * 结构：1 个总开关 + 3 个子模块 + 记忆管理面板 + Agent 能力增强
 *   - MCP 协议客户端：隐藏且不启用
 *
 * @returns {string}
 */
function buildAgentTab() {
    // Electron 桌面端：Agent 功能由 DeepSeek++ 扩展提供，隐藏以免重复
    if (IS_ELECTRON) {
        return `
            <div class="ds-tab-content" data-content="agent">
                <div class="ds-info-card">
                    <b>Agent 系统</b> 由 DeepSeek++ 扩展统一管理。<br>
                    请使用侧边栏中的 DeepSeek++ 面板来配置 Agent 相关功能。
                </div>
            </div>
        `;
    }
    return `
        <div class="ds-tab-content" data-content="agent">
            <div class="ds-section">${tt('settings.section.agentCore', 'Agent 核心')}</div>
            ${toggleRow('agentSystem', '🤖 启用 Agent 系统')}
            <div class="ds-warn-card" style="margin:12px 0;">
                <div class="ds-warn-card-title">⚠️ 重要提示：关于工具调用产生的自动消息</div>
                <div class="ds-warn-card-body">
                    开启 Agent 系统后，DeepSeek 会在调用工具（保存/调用/融合/审查记忆）后<b>自动发送一条续跑消息</b>，将工具执行结果回传给 AI，让 AI 基于结果继续对话（即 Agent 循环）。<br><br>
                    这是<b>正常行为</b>，并非 bug：<br>
                    • 输入框会自动被锁定并填充续跑内容，<b>请勿手动输入或点击发送</b><br>
                    • 右下角会显示"停止 Agent"按钮，如需中断可点击它<br>
                    • 一次用户消息最多触发 3 轮续跑，达到上限自动停止<br>
                    • 切换会话或刷新页面可立即终止续跑<br>
                    • AI 调用 <code>agent_finish</code> 工具时正常结束循环<br><br>
                    如不想出现自动消息，可关闭"Agent 循环"子模块，仅使用工具调用能力。
                </div>
            </div>

            <div class="ds-section">${tt('settings.section.submodule', '子模块控制')}</div>
            ${toggleRow('agentMemory', '🧠 记忆模块')}
            ${toggleRow('agentTools', '🔧 工具调用模块')}
            ${toggleRow('agentLoop', '🔄 Agent 循环模块')}

            <div class="ds-section">${tt('settings.section.memoryManage', '记忆管理')}</div>
            <div id="ds-memory-panel-container" style="margin-top:8px;"></div>

            <div class="ds-section">${tt('settings.section.agentEnhance', '🌐 Agent 能力增强')}</div>
            ${toggleRow('webTools', '🌐 Web 工具总开关')}
            ${toggleRow('webSearch', '🔍 web_search 搜索')}
            ${toggleRow('webFetch', '📄 web_fetch 抓取')}
            <div class="ds-row" id="ds-row-mcp" style="display:none;">
                <span class="ds-label" data-toggle="mcp">🔌 MCP 协议客户端</span>
                <span class="ds-help" data-help="${optionDescriptions.mcp}">?</span>
                <label class="ds-toggle">
                    <input type="checkbox" id="chk-mcp">
                    <span class="ds-slider"></span>
                </label>
            </div>
        </div>
    `;
}

/**
 * 构建数据同步标签页 HTML
 *
 * 包含：WebDAV 同步（配置 + 测试/上传/下载/双向同步）+ 数据管理（记忆导入）
 *
 * @returns {string}
 */
function buildSyncTab() {
    // Electron 桌面端：数据同步/记忆导入由 DeepSeek++ 扩展提供
    if (IS_ELECTRON) {
        return `
            <div class="ds-tab-content" data-content="sync">
                <div class="ds-info-card">
                    <b>数据同步/记忆导入</b> 由 DeepSeek++ 扩展统一管理。<br>
                    请使用侧边栏中的 DeepSeek++ 面板来配置这些功能。
                </div>
            </div>
        `;
    }
    return `
        <div class="ds-tab-content" data-content="sync">
            <div class="ds-section">${tt('settings.section.webdavSync', 'WebDAV 同步')}</div>
            ${toggleRow('sync', '🔄 WebDAV 数据同步')}

            <div id="ds-sync-config-section" style="margin-top:10px;padding:12px 14px;border-radius:var(--ds-radius-sm);background:var(--ds-card-bg);border:1px solid var(--ds-panel-border);">
                <div class="ds-input-row">
                    <label>服务器地址</label>
                    <input type="text" class="ds-input" id="sync-server" placeholder="https://dav.example.com" style="flex:1;">
                </div>
                <div class="ds-input-row">
                    <label>用户名</label>
                    <input type="text" class="ds-input" id="sync-username" placeholder="WebDAV 用户名" style="flex:1;">
                </div>
                <div class="ds-input-row">
                    <label>密码</label>
                    <input type="password" class="ds-input" id="sync-password" placeholder="WebDAV 密码" style="flex:1;" autocomplete="new-password">
                </div>
                <div style="font-size:11px;color:var(--ds-section-color);margin:-4px 0 8px 0;padding-left:90px;line-height:1.5;">
                    ⚠️ 密码以明文存储于浏览器本地，不同步上传
                </div>
                <div class="ds-input-row">
                    <label>远程 basePath</label>
                    <input type="text" class="ds-input" id="sync-basepath" placeholder="/dspro/" style="flex:1;">
                </div>
                <div class="ds-btn-row">
                    <button id="ds-sync-test-btn" class="ds-btn ds-btn-outline">🔌 测试连接</button>
                    <button id="ds-sync-upload-btn" class="ds-btn ds-btn-primary">⬆️ 立即上传</button>
                    <button id="ds-sync-download-btn" class="ds-btn ds-btn-primary">⬇️ 立即下载</button>
                    <button id="ds-sync-both-btn" class="ds-btn ds-btn-accent">🔄 双向同步</button>
                </div>
                <div class="ds-info-card" id="ds-sync-status" style="margin-top:10px;">
                    <div><b>上次上传：</b><span data-field="lastUpload">—</span></div>
                    <div><b>上次下载：</b><span data-field="lastDownload">—</span></div>
                    <div><b>远端代次：</b><span data-field="remoteGeneration">0</span></div>
                    <div><b>上次错误：</b><span data-field="lastError">—</span></div>
                </div>
            </div>

            <div class="ds-section">${tt('settings.section.dataManage', '数据管理')}</div>
            ${toggleRow('memoryImport', '📥 记忆导入')}
        </div>
    `;
}

/**
 * 构建信息 (About) 标签页 HTML
 *
 * 显示脚本版本、作者、更新日志等信息
 *
 * @returns {string}
 */
function buildAboutTab() {
    const version = (typeof window !== 'undefined' && window.__dsVersion) || 'v5.0.0';
    return `
        <div class="ds-tab-content" data-content="about">
            <div class="ds-section">${tt('settings.section.about', '📋 关于')}</div>
            <div class="ds-info-card">
                <div style="font-size:15px;font-weight:700;margin-bottom:8px;">DeepSeek Pro 增强脚本</div>
                <div style="margin-bottom:4px;"><b>版本：</b>${version}</div>
                <div style="margin-bottom:4px;"><b>作者：</b><a href="https://github.com/zisekongling" target="_blank" style="color:var(--ds-primary);">伊莲/紫色空灵</a> & <a href="https://www.trae.cn/" target="_blank" style="color:var(--ds-primary);">TRAE</a></div>
                <div style="margin-bottom:4px;"><b>仓库：</b><a href="https://github.com/zisekongling" target="_blank" style="color:var(--ds-primary);">GitHub</a></div>
                <div style="margin-top:8px;font-size:11px;color:var(--ds-section-color);">
                    本脚本为 DeepSeek Chat 提供增强功能，包括记忆系统、Agent 能力、Web 工具、皮肤美化等。
                </div>
            </div>
        </div>
    `;
}

/**
 * 构建扩展与高级标签页 HTML
 *
 * 结构：
 *   - 工作台与 UX（项目管理工作台全版本隐藏）
 *   - 多模态分析
 *   - Python 沙箱（隐藏且默认关闭）
 *
 * @returns {string}
 */
function buildExtensionsTab() {
    // Electron 桌面端：高级功能由 DeepSeek++ 扩展提供
    if (IS_ELECTRON) {
        return `
            <div class="ds-tab-content" data-content="extensions">
                <div class="ds-info-card">
                    <b>工作台/UX/高级能力</b> 由 DeepSeek++ 扩展统一管理。<br>
                    请使用侧边栏中的 DeepSeek++ 面板来配置这些功能。
                </div>
            </div>
        `;
    }
    return `
        <div class="ds-tab-content" data-content="extensions">
            <div class="ds-section">${tt('settings.section.workbenchUx', '工作台与 UX')}</div>
            <div class="ds-row" id="ds-row-project" style="display:none;">
                <span class="ds-label" data-toggle="project">📁 项目管理工作台</span>
                <span class="ds-help" data-help="${optionDescriptions.project}">?</span>
                <label class="ds-toggle">
                    <input type="checkbox" id="chk-project">
                    <span class="ds-slider"></span>
                </label>
            </div>
            <div class="ds-input-row" style="margin-top:4px;">
                <label>界面语言</label>
                <select id="language-select" class="ds-input" style="flex:1;">
                    <option value="auto" ${(CONFIG.language || 'auto') === 'auto' ? 'selected' : ''}>自动（跟随浏览器）</option>
                    <option value="zh-CN" ${CONFIG.language === 'zh-CN' ? 'selected' : ''}>简体中文</option>
                    <option value="en" ${CONFIG.language === 'en' ? 'selected' : ''}>English</option>
                </select>
            </div>
            ${toggleRow('artifactsExport', '📤 制品导出')}

            <div class="ds-section">${tt('settings.section.advancedCapability', '高级能力')}</div>
            ${toggleRow('multimodal', '🎨 多模态分析')}
            ${buildMultimodalConfigSection()}
            <div class="ds-row" id="ds-row-python-sandbox" style="display:none;">
                <span class="ds-label" data-toggle="pythonSandbox">🐍 Python 沙箱</span>
                <span class="ds-help" data-help="${optionDescriptions.pythonSandbox}">?</span>
                <label class="ds-toggle">
                    <input type="checkbox" id="chk-pythonSandbox">
                    <span class="ds-slider"></span>
                </label>
            </div>

        </div>
    `;
}

// ============================================================
// 多模态配置分区（Provider / OpenAI / Gemini / 通用配置）
// ============================================================

/**
 * 读取多模态配置（防御性封装 window._dsMultimodal.getConfig）
 * @returns {Object|null} 配置对象；模块未加载时返回 null
 */
function getMmConfig() {
    try {
        if (typeof window !== 'undefined' && window._dsMultimodal && typeof window._dsMultimodal.getConfig === 'function') {
            return window._dsMultimodal.getConfig();
        }
    } catch (e) {}
    return null;
}

/**
 * 构建多模态配置分区 HTML
 *
 * 包含：Provider 选择、OpenAI 配置、Gemini 配置、通用配置（maxImages / timeout）、保存与测试按钮。
 * Key 输入框不回显明文：已配置时 placeholder 显示"已配置（不显示）"，留空表示不修改。
 *
 * @returns {string}
 */
function buildMultimodalConfigSection() {
    const cfg = getMmConfig();
    if (!cfg) {
        return `<div class="ds-info-card" style="margin-top:8px;">⚠️ 多模态模块未加载，配置不可用。</div>`;
    }
    const provider = cfg.provider === 'gemini' ? 'gemini' : 'openai';
    const oaiKeyed = !!(cfg.openai && cfg.openai.apiKey && cfg.openai.apiKey.length > 0);
    const gemKeyed = !!(cfg.gemini && cfg.gemini.apiKey && cfg.gemini.apiKey.length > 0);
    return `
        <div id="mm-config-block" style="margin:8px 0 4px;padding:12px 14px;border-radius:var(--ds-radius-sm);background:var(--ds-card-bg);border:1px solid var(--ds-panel-border);">
            <div class="ds-input-row">
                <label>服务商</label>
                <select id="mm-provider" class="ds-input" style="flex:1;">
                    <option value="openai" ${provider === 'openai' ? 'selected' : ''}>OpenAI</option>
                    <option value="gemini" ${provider === 'gemini' ? 'selected' : ''}>Gemini</option>
                </select>
            </div>

            <div id="mm-openai-config" class="mm-provider-config" style="display:${provider === 'openai' ? 'block' : 'none'};">
                <div class="ds-input-row">
                    <label>API Key</label>
                    <input type="password" id="mm-openai-key" class="ds-input" placeholder="${oaiKeyed ? '已配置（不显示）' : '输入 OpenAI API Key'}" autocomplete="off">
                </div>
                <div class="ds-mm-key-hint">Key 仅存储于浏览器本地，不同步上传</div>
                <div class="ds-input-row">
                    <label>模型</label>
                    <input type="text" id="mm-openai-model" class="ds-input" value="${escapeHtmlAttr(cfg.openai.model)}" placeholder="gpt-4o">
                </div>
                <div class="ds-input-row">
                    <label>Base URL</label>
                    <input type="text" id="mm-openai-baseurl" class="ds-input" value="${escapeHtmlAttr(cfg.openai.baseUrl)}" placeholder="https://api.openai.com/v1">
                </div>
            </div>

            <div id="mm-gemini-config" class="mm-provider-config" style="display:${provider === 'gemini' ? 'block' : 'none'};">
                <div class="ds-input-row">
                    <label>API Key</label>
                    <input type="password" id="mm-gemini-key" class="ds-input" placeholder="${gemKeyed ? '已配置（不显示）' : '输入 Gemini API Key'}" autocomplete="off">
                </div>
                <div class="ds-mm-key-hint">Key 仅存储于浏览器本地，不同步上传</div>
                <div class="ds-input-row">
                    <label>模型</label>
                    <input type="text" id="mm-gemini-model" class="ds-input" value="${escapeHtmlAttr(cfg.gemini.model)}" placeholder="gemini-1.5-flash">
                </div>
                <div class="ds-input-row">
                    <label>Base URL</label>
                    <input type="text" id="mm-gemini-baseurl" class="ds-input" value="${escapeHtmlAttr(cfg.gemini.baseUrl)}" placeholder="https://generativelanguage.googleapis.com/v1beta">
                </div>
            </div>

            <div class="ds-input-row">
                <label>最大图片数</label>
                <input type="number" id="mm-max-images" class="ds-input" min="1" max="8" value="${cfg.maxImages}" style="flex:1;">
            </div>
            <div class="ds-input-row">
                <label>超时 (ms)</label>
                <input type="number" id="mm-timeout" class="ds-input" min="5000" max="300000" step="1000" value="${cfg.timeout}" style="flex:1;">
            </div>

            <div class="ds-btn-row">
                <button id="mm-save-btn" class="ds-btn ds-btn-primary">💾 保存多模态配置</button>
                <button id="mm-test-btn" class="ds-btn ds-btn-outline">🧪 测试 Key</button>
            </div>
        </div>
    `;
}

/**
 * 同步多模态配置 UI 到指定配置视图
 *
 * 用于初始化、showSettings 同步、保存后刷新。Key 输入框始终清空，
 * 根据 apiKeyConfigured 切换 placeholder。
 *
 * @param {HTMLElement} modal - 设置面板根元素
 * @param {Object} [safeView] - saveConfig 返回的脱敏视图；未提供时从 getConfig() 推导
 */
function syncMultimodalUI(modal, safeView) {
    if (!modal) return;
    if (!safeView) {
        const cfg = getMmConfig();
        if (!cfg) return;
        safeView = {
            provider: cfg.provider,
            openai: { model: cfg.openai.model, baseUrl: cfg.openai.baseUrl, apiKeyConfigured: cfg.openai.apiKey.length > 0 },
            gemini: { model: cfg.gemini.model, baseUrl: cfg.gemini.baseUrl, apiKeyConfigured: cfg.gemini.apiKey.length > 0 },
            maxImages: cfg.maxImages,
            timeout: cfg.timeout
        };
    }
    const provider = safeView.provider === 'gemini' ? 'gemini' : 'openai';

    const providerSelect = modal.querySelector('#mm-provider');
    if (providerSelect) providerSelect.value = provider;
    const openaiBox = modal.querySelector('#mm-openai-config');
    const geminiBox = modal.querySelector('#mm-gemini-config');
    if (openaiBox) openaiBox.style.display = (provider === 'openai') ? 'block' : 'none';
    if (geminiBox) geminiBox.style.display = (provider === 'gemini') ? 'block' : 'none';

    // OpenAI：Key 清空 + placeholder 切换；model / baseUrl 回显
    const oaiKey = modal.querySelector('#mm-openai-key');
    if (oaiKey) {
        oaiKey.value = '';
        oaiKey.placeholder = safeView.openai.apiKeyConfigured ? '已配置（不显示）' : '输入 OpenAI API Key';
    }
    const oaiModel = modal.querySelector('#mm-openai-model');
    if (oaiModel) oaiModel.value = safeView.openai.model || '';
    const oaiBaseUrl = modal.querySelector('#mm-openai-baseurl');
    if (oaiBaseUrl) oaiBaseUrl.value = safeView.openai.baseUrl || '';

    // Gemini：同上
    const gemKey = modal.querySelector('#mm-gemini-key');
    if (gemKey) {
        gemKey.value = '';
        gemKey.placeholder = safeView.gemini.apiKeyConfigured ? '已配置（不显示）' : '输入 Gemini API Key';
    }
    const gemModel = modal.querySelector('#mm-gemini-model');
    if (gemModel) gemModel.value = safeView.gemini.model || '';
    const gemBaseUrl = modal.querySelector('#mm-gemini-baseurl');
    if (gemBaseUrl) gemBaseUrl.value = safeView.gemini.baseUrl || '';

    // 通用配置
    const maxImagesInput = modal.querySelector('#mm-max-images');
    if (maxImagesInput) maxImagesInput.value = safeView.maxImages;
    const timeoutInput = modal.querySelector('#mm-timeout');
    if (timeoutInput) timeoutInput.value = safeView.timeout;
}

/**
 * 绑定多模态配置分区事件：Provider 切换、保存、测试
 * @param {HTMLElement} modal - 设置面板根元素
 */
function bindMultimodalEvents(modal) {
    const providerSelect = modal.querySelector('#mm-provider');
    const openaiBox = modal.querySelector('#mm-openai-config');
    const geminiBox = modal.querySelector('#mm-gemini-config');
    const saveBtn = modal.querySelector('#mm-save-btn');
    const testBtn = modal.querySelector('#mm-test-btn');

    // 服务商切换：show/hide 对应配置表单（不销毁 DOM，保留已输入值）
    if (providerSelect) {
        providerSelect.addEventListener('change', () => {
            const p = providerSelect.value;
            if (openaiBox) openaiBox.style.display = (p === 'openai') ? 'block' : 'none';
            if (geminiBox) geminiBox.style.display = (p === 'gemini') ? 'block' : 'none';
        });
    }

    // 保存配置：收集非空字段拼 patch，调 saveConfig，用返回的脱敏视图刷新 UI
    if (saveBtn) {
        saveBtn.addEventListener('click', () => {
            if (!window._dsMultimodal || typeof window._dsMultimodal.saveConfig !== 'function') {
                showToast('多模态模块未加载', { tone: 'error' });
                return;
            }
            const patch = { provider: providerSelect ? providerSelect.value : 'openai' };

            // OpenAI：仅收集非空字段（Key 留空表示不修改）
            const openaiPatch = {};
            const oaiModel = modal.querySelector('#mm-openai-model');
            const oaiBaseUrl = modal.querySelector('#mm-openai-baseurl');
            const oaiKey = modal.querySelector('#mm-openai-key');
            if (oaiModel && oaiModel.value.trim()) openaiPatch.model = oaiModel.value.trim();
            if (oaiBaseUrl && oaiBaseUrl.value.trim()) openaiPatch.baseUrl = oaiBaseUrl.value.trim();
            if (oaiKey && oaiKey.value.trim()) openaiPatch.apiKey = oaiKey.value.trim();
            if (Object.keys(openaiPatch).length > 0) patch.openai = openaiPatch;

            // Gemini：同上
            const geminiPatch = {};
            const gemModel = modal.querySelector('#mm-gemini-model');
            const gemBaseUrl = modal.querySelector('#mm-gemini-baseurl');
            const gemKey = modal.querySelector('#mm-gemini-key');
            if (gemModel && gemModel.value.trim()) geminiPatch.model = gemModel.value.trim();
            if (gemBaseUrl && gemBaseUrl.value.trim()) geminiPatch.baseUrl = gemBaseUrl.value.trim();
            if (gemKey && gemKey.value.trim()) geminiPatch.apiKey = gemKey.value.trim();
            if (Object.keys(geminiPatch).length > 0) patch.gemini = geminiPatch;

            // 通用配置：clamp 到合法区间
            const maxImagesInput = modal.querySelector('#mm-max-images');
            const timeoutInput = modal.querySelector('#mm-timeout');
            if (maxImagesInput) patch.maxImages = Math.max(1, Math.min(8, parseInt(maxImagesInput.value, 10) || 4));
            if (timeoutInput) patch.timeout = Math.max(5000, Math.min(300000, parseInt(timeoutInput.value, 10) || 60000));

            try {
                const safeView = window._dsMultimodal.saveConfig(patch);
                syncMultimodalUI(modal, safeView);
                showToast('多模态配置已保存', { tone: 'success' });
            } catch (e) {
                showToast('保存失败：' + (e && e.message || e), { tone: 'error' });
            }
        });
    }

    // 测试按钮：校验当前 provider 的 API Key 格式（优先取输入框新值，回退已保存值）
    if (testBtn) {
        testBtn.addEventListener('click', () => {
            if (!window._dsMultimodal || typeof window._dsMultimodal.getConfig !== 'function') {
                showToast('多模态模块未加载', { tone: 'error' });
                return;
            }
            const provider = providerSelect ? providerSelect.value : 'openai';
            const keyInput = modal.querySelector(provider === 'gemini' ? '#mm-gemini-key' : '#mm-openai-key');
            const inputVal = keyInput ? keyInput.value.trim() : '';
            const cfg = window._dsMultimodal.getConfig();
            const pCfg = provider === 'gemini' ? cfg.gemini : cfg.openai;
            const effectiveKey = inputVal || (pCfg.apiKey || '');
            if (!effectiveKey) {
                showToast('未配置 API Key，请先填写', { tone: 'warning' });
                return;
            }
            if (effectiveKey.length < 10) {
                showToast('API Key 格式可疑（长度过短）', { tone: 'warning' });
                return;
            }
            showToast('API Key 格式检查通过（' + provider + '）', { tone: 'success' });
        });
    }
}

/**
 * 构建自动化标签页 HTML
 * 包含：循环引擎、思考姿态、任务模式、人格系统、工作流、路线图、队列、交接报告
 * @returns {string}
 */
function buildAutomationTab() {
    // Electron 桌面端：自动化功能由 DeepSeek++ 扩展提供
    if (IS_ELECTRON) {
        return `
            <div class="ds-tab-content" data-content="automation">
                <div class="ds-info-card">
                    <b>循环引擎/人格/工作流/自动化</b> 由 DeepSeek++ 扩展统一管理。<br>
                    请使用侧边栏中的 DeepSeek++ 面板来配置这些功能。
                </div>
            </div>
        `;
    }
    return `
        <div class="ds-tab-content" data-content="automation">
            <div class="ds-section">${tt('settings.section.loopEngine', '循环引擎')}</div>
            ${toggleRow('loopEngine', '👻 启用循环引擎')}
            ${toggleRow('loopNotify', '🔔 桌面通知')}
            ${toggleRow('loopCrashRecovery', '🔄 崩溃恢复')}
            ${toggleRow('loopDrift', '🛡️ 漂移防护（轮次上限）')}
            ${toggleRow('loopUnattended', '🤖 无人值守模式')}
            <div class="ds-input-row" style="margin-top:4px;">
                <label>最大轮次</label>
                <input type="number" id="loop-max-rounds" class="ds-input" min="1" max="999" value="${CONFIG.loopMaxRounds || 20}" style="flex:1;">
            </div>
            <div class="ds-info-card">
                <b>信号协议：</b>AI 回复以 <code>[[GITL::PROCEED]]</code> 结尾则自动继续，以 <code>[[GITL::HALT]]</code> 结尾则停止。<br>
                <b>防检测：</b>8-15 秒随机延迟。<br>
                <b>看门狗：</b>3 分钟无活动自动暂停。
            </div>

            <div class="ds-section">${tt('settings.section.thinkingPosture', '🧠 思考姿态')}</div>
            <div class="ds-input-row">
                <label>姿态选择</label>
                <select id="loop-posture-select" class="ds-input" style="flex:1;">
                    <option value="standard" ${(CONFIG.loopPosture || 'standard') === 'standard' ? 'selected' : ''}>🔒 锁定 — 严格按计划</option>
                    <option value="evolving" ${CONFIG.loopPosture === 'evolving' ? 'selected' : ''}>🌱 自适应 — 可中途扩展</option>
                    <option value="extended" ${CONFIG.loopPosture === 'extended' ? 'selected' : ''}>🔍 审计 — 计划 + 最终缺口审计</option>
                </select>
            </div>
            <div class="ds-info-card" id="posture-desc-card">
                锁定到声明的计划，不允许添加、删除、合并或重排步骤。最可预测。
            </div>

            <div class="ds-section">${tt('settings.section.taskMode', '▶ 任务模式')}</div>
            <div class="ds-input-row">
                <label>模式选择</label>
                <select id="loop-payload-select" class="ds-input" style="flex:1;">
                    <option value="loop" ${(CONFIG.loopPayloadMode || 'loop') === 'loop' ? 'selected' : ''}>▶ 循环 — 分步执行</option>
                    <option value="think" ${CONFIG.loopPayloadMode === 'think' ? 'selected' : ''}>🧠 先思考 — AI 自规划分批</option>
                    <option value="roadmap" ${CONFIG.loopPayloadMode === 'roadmap' ? 'selected' : ''}>🗺 路线图 — AI 研究→路线图→自动执行</option>
                </select>
            </div>
            <div class="ds-input-row">
                <label>任务描述</label>
                <textarea id="loop-task-input" rows="3" class="ds-input" style="flex:1;" placeholder="输入要循环执行的任务…"></textarea>
            </div>
            <div class="ds-btn-row">
                <button id="ds-loop-start-btn" class="ds-btn ds-btn-primary">▶ 开始循环</button>
                <button id="ds-loop-pause-btn" class="ds-btn ds-btn-outline">⏸ 暂停</button>
                <button id="ds-loop-stop-btn" class="ds-btn ds-btn-outline">⏹ 停止</button>
                <button id="ds-loop-reset-btn" class="ds-btn ds-btn-outline">↺ 重置</button>
            </div>

            <div class="ds-section">${tt('settings.section.personaSystem', '👤 人格系统')}</div>
            <div class="ds-input-row">
                <label>选择人格</label>
                <select id="persona-select" class="ds-input" style="flex:1;" multiple size="4">
                    <option value="none" ${(CONFIG.personaSelected || ['none']).includes('none') ? 'selected' : ''}>无</option>
                    <option value="researcher" ${(CONFIG.personaSelected || []).includes('researcher') ? 'selected' : ''}>研究员</option>
                    <option value="builder" ${(CONFIG.personaSelected || []).includes('builder') ? 'selected' : ''}>建造者</option>
                    <option value="redteam" ${(CONFIG.personaSelected || []).includes('redteam') ? 'selected' : ''}>红队</option>
                    <option value="devil" ${(CONFIG.personaSelected || []).includes('devil') ? 'selected' : ''}>魔鬼代言人</option>
                    <option value="tester" ${(CONFIG.personaSelected || []).includes('tester') ? 'selected' : ''}>测试工程师</option>
                    <option value="customer" ${(CONFIG.personaSelected || []).includes('customer') ? 'selected' : ''}>客户声音</option>
                    <option value="executive" ${(CONFIG.personaSelected || []).includes('executive') ? 'selected' : ''}>执行官</option>
                    <option value="roundtable" ${(CONFIG.personaSelected || []).includes('roundtable') ? 'selected' : ''}>圆桌会议</option>
                </select>
            </div>
            <div class="ds-info-card">
                <b>多选：</b>按住 Ctrl/Cmd 多选组合委员会。<br>
                <b>圆桌会议：</b>AI 模拟 5 种视角独立评估后综合。<br>
                <b>每步注入：</b>开启后每条循环命令都附带人格指令。
            </div>
            ${toggleRow('personaPerTask', '🔁 每步注入人格')}

            <div class="ds-section">${tt('settings.section.workflowAutomation', '⛓ 工作流自动化')}</div>
            <div class="ds-input-row">
                <label>选择工作流</label>
                <select id="workflow-select" class="ds-input" style="flex:1;">
                    <option value="none" ${(CONFIG.workflowSelected || 'none') === 'none' ? 'selected' : ''}>手动（不自动注入阶段）</option>
                    <option value="deep_research" ${CONFIG.workflowSelected === 'deep_research' ? 'selected' : ''}>深度研究 — 研究→分支→红队→综合</option>
                    <option value="rd_lab" ${CONFIG.workflowSelected === 'rd_lab' ? 'selected' : ''}>R&D 实验室 — 发明→原型→评估→收敛</option>
                    <option value="shipyard" ${CONFIG.workflowSelected === 'shipyard' ? 'selected' : ''}>船坞 — 概念→执行计划→QA→生产就绪</option>
                    <option value="debate" ${CONFIG.workflowSelected === 'debate' ? 'selected' : ''}>辩论 — 多视角挑战与综合</option>
                    <option value="pre_mortem" ${CONFIG.workflowSelected === 'pre_mortem' ? 'selected' : ''}>前置复盘 — 假设失败→调查→加固</option>
                    <option value="trollproof" ${CONFIG.workflowSelected === 'trollproof' ? 'selected' : ''}>抗喷子 — 敌意反馈→过滤→加固</option>
                    <option value="lens_relay" ${CONFIG.workflowSelected === 'lens_relay' ? 'selected' : ''}>透镜接力 — 多视角独立评估→综合</option>
                </select>
            </div>
            ${toggleRow('workflowAutoAdvance', '⚡ 自动推进下一阶段')}
            ${toggleRow('workflowPauseBetween', '⏸ 步间暂停（每阶段后等待）')}

            <div class="ds-section">${tt('settings.section.roadmapAutopilot', '🗺 路线图自动驾驶')}</div>
            <div class="ds-input-row">
                <label>任务描述</label>
                <textarea id="roadmap-task-input" rows="3" class="ds-input" style="flex:1;" placeholder="输入任务，AI 会先生成路线图再逐步执行…"></textarea>
            </div>
            <div class="ds-btn-row">
                <button id="ds-roadmap-start-btn" class="ds-btn ds-btn-primary">🗺 路线图</button>
                <button id="ds-thinkfirst-btn" class="ds-btn ds-btn-outline">🧠 先思考</button>
            </div>

            <div class="ds-section">${tt('settings.section.promptQueue', '📋 提示词队列')}</div>
            <div class="ds-input-row">
                <label>任务列表</label>
                <textarea id="queue-input" rows="5" class="ds-input" style="flex:1;" placeholder="每行一个任务，脚本会依次执行…&#10;1. 分析需求&#10;2. 设计架构&#10;3. 编写代码&#10;4. 测试验证"></textarea>
            </div>
            <button id="ds-queue-start-btn" class="ds-btn ds-btn-primary" style="width:100%;margin-top:8px;">📋 开始队列</button>

            <div class="ds-section">${tt('settings.section.handoffReport', '🤝 交接报告')}</div>
            <div class="ds-input-row">
                <label>项目名称</label>
                <input type="text" id="project-name" class="ds-input" placeholder="用于交接报告元数据" value="${CONFIG.projectName || ''}" style="flex:1;">
            </div>
            <div class="ds-btn-row">
                <button id="ds-handoff-btn" class="ds-btn ds-btn-primary">🤝 生成交接</button>
                <button id="ds-handoff-backup-btn" class="ds-btn ds-btn-outline">📥 备份交接</button>
            </div>
        </div>
    `;
}

// ============================================================
// 事件绑定（按功能模块拆分）
// ============================================================

/**
 * 绑定导出按钮事件（带点击反馈）
 * @param {HTMLElement} modal - 设置面板根元素
 */
function bindExportEvents(modal) {
    /**
     * 给导出按钮添加点击反馈：临时显示"正在准备…"提示，完成后恢复
     * @param {HTMLElement} btn - 按钮元素
     * @param {Function} fn - 异步导出函数
     */
    function exportWithFeedback(btn, fn) {
        if (!btn) return;
        btn.addEventListener('click', async () => {
            const originalText = btn.textContent;
            btn.textContent = '⏳ 正在准备…';
            btn.style.opacity = '0.7';
            btn.style.pointerEvents = 'none';
            try {
                await fn();
            } finally {
                btn.textContent = originalText;
                btn.style.opacity = '';
                btn.style.pointerEvents = '';
            }
        });
    }

    exportWithFeedback(modal.querySelector('#ds-export-json-btn'), () => doExport('json'));
    exportWithFeedback(modal.querySelector('#ds-export-md-btn'), () => doExport('md'));
    exportWithFeedback(modal.querySelector('#ds-export-img-btn'), () => doImageExport());
}

/**
 * 绑定页面缩略控制按钮事件
 * 点击按钮触发对应的页面元素折叠/缩放效果
 * @param {HTMLElement} modal - 设置面板根元素
 */
function bindCollapseControlEvents(modal) {
    modal.querySelectorAll('.ds-collapse-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const action = btn.dataset.action;
            btn.classList.toggle('active');

            const { toggleSidebarWidth, toggleUserChatFont, toggleTextareaExpand } = await import('../features/magic-wand.js');

            switch (action) {
                case 'sidebar':
                    toggleSidebarWidth();
                    break;
                case 'font':
                    toggleUserChatFont();
                    break;
                case 'textarea':
                    toggleTextareaExpand();
                    break;
            }
        });
    });
}

/**
 * 绑定循环引擎/路线图/队列/交接报告等自动化按钮事件
 * @param {HTMLElement} modal - 设置面板根元素
 */
function bindAutomationEvents(modal) {
    const loopStartBtn = modal.querySelector('#ds-loop-start-btn');
    const loopPauseBtn = modal.querySelector('#ds-loop-pause-btn');
    const loopStopBtn = modal.querySelector('#ds-loop-stop-btn');
    const loopResetBtn = modal.querySelector('#ds-loop-reset-btn');
    const roadmapStartBtn = modal.querySelector('#ds-roadmap-start-btn');
    const thinkFirstBtn = modal.querySelector('#ds-thinkfirst-btn');
    const queueStartBtn = modal.querySelector('#ds-queue-start-btn');
    const handoffBtn = modal.querySelector('#ds-handoff-btn');
    const handoffBackupBtn = modal.querySelector('#ds-handoff-backup-btn');

    if (loopStartBtn) loopStartBtn.addEventListener('click', async () => {
        const { startLoop, requestNotifyPermission, setEngineOptions } = await import('../features/loop-engine.js');
        if (CONFIG.loopNotifyEnabled) await requestNotifyPermission();

        // 同步 UI 选择的模式/姿态/轮次到引擎
        const payloadMode = modal.querySelector('#loop-payload-select')?.value || 'loop';
        const posture = modal.querySelector('#loop-posture-select')?.value || 'standard';
        const maxRounds = parseInt(modal.querySelector('#loop-max-rounds')?.value) || 20;
        CONFIG.loopPayloadMode = payloadMode;
        CONFIG.loopPosture = posture;
        CONFIG.loopMaxRounds = maxRounds;
        saveConfig(CONFIG);
        setEngineOptions({ payloadMode, posture, maxRounds });

        // 如果选中了工作流，激活它
        try { window.__dsStartWorkflowIfSelected?.(); } catch (_) {}

        const task = modal.querySelector('#loop-task-input')?.value || '';
        startLoop(task.trim() || undefined);
        hideSettings();
    });
    if (loopPauseBtn) loopPauseBtn.addEventListener('click', async () => {
        const { pauseLoop } = await import('../features/loop-engine.js');
        pauseLoop('手动暂停');
    });
    if (loopStopBtn) loopStopBtn.addEventListener('click', async () => {
        const { stopLoop } = await import('../features/loop-engine.js');
        stopLoop();
    });
    if (loopResetBtn) loopResetBtn.addEventListener('click', async () => {
        const { resetLoop } = await import('../features/loop-engine.js');
        resetLoop();
    });
    if (roadmapStartBtn) roadmapStartBtn.addEventListener('click', async () => {
        const { startRoadmap } = await import('../features/roadmap.js');
        const task = modal.querySelector('#roadmap-task-input')?.value || '';
        if (task.trim()) { startRoadmap(task); hideSettings(); }
    });
    if (thinkFirstBtn) thinkFirstBtn.addEventListener('click', async () => {
        const { startThinkFirst } = await import('../features/roadmap.js');
        const task = modal.querySelector('#roadmap-task-input')?.value || '';
        if (task.trim()) { startThinkFirst(task); hideSettings(); }
    });
    if (queueStartBtn) queueStartBtn.addEventListener('click', async () => {
        const { startQueue } = await import('../features/roadmap.js');
        const lines = modal.querySelector('#queue-input')?.value || '';
        if (lines.trim()) { startQueue(lines); hideSettings(); }
    });
    if (handoffBtn) handoffBtn.addEventListener('click', async () => {
        const { handoffInChat } = await import('../features/handoff.js');
        handoffInChat();
        hideSettings();
    });
    if (handoffBackupBtn) handoffBackupBtn.addEventListener('click', async () => {
        const { generateBackupHandoff, downloadHandoff } = await import('../features/handoff.js');
        const md = generateBackupHandoff();
        if (md) downloadHandoff(md);
    });

    // ── 姿态描述实时切换 ──
    const postureSelect = modal.querySelector('#loop-posture-select');
    const postureDescCard = modal.querySelector('#posture-desc-card');
    /** 三种姿态的中文描述（与 postures.js POSTURES.desc 对齐） */
    const postureDescs = {
        standard: '锁定到声明的计划，不允许添加、删除、合并或重排步骤。最可预测。',
        evolving: '计划可以在执行中扩展 — 当出现真实阻碍或缺口时，AI 可加步骤并说明理由。',
        extended: '锁定执行计划，完成后做一次覆盖审计，仅补材料性缺口。'
    };
    if (postureSelect && postureDescCard) {
        postureSelect.addEventListener('change', () => {
            postureDescCard.textContent = postureDescs[postureSelect.value] || postureDescs.standard;
        });
    }

    // ── 人格多选 ──
    const personaSelect = modal.querySelector('#persona-select');
    if (personaSelect) {
        personaSelect.addEventListener('change', async () => {
            const selected = [...personaSelect.selectedOptions].map(o => o.value).filter(Boolean);
            const { setPersonas } = await import('../features/personas.js');
            // 如果选中了 "none" 或清空了选择，重置为 ['none']
            if (selected.length === 0 || selected.includes('none')) {
                setPersonas(['none']);
            } else {
                setPersonas(selected);
            }
        });
    }

    // ── 工作流选择 ──
    const workflowSelect = modal.querySelector('#workflow-select');
    if (workflowSelect) {
        workflowSelect.addEventListener('change', async () => {
            const id = workflowSelect.value || 'none';
            const { setSelected } = await import('../features/workflows.js');
            setSelected(id);
        });
    }

    // ── 项目名称 ──
    const projectNameInput = modal.querySelector('#project-name');
    if (projectNameInput) {
        projectNameInput.addEventListener('change', () => {
            CONFIG.projectName = projectNameInput.value.trim();
            saveConfig(CONFIG);
        });
    }

    // ── 最大轮次实时同步 ──
    const maxRoundsInput = modal.querySelector('#loop-max-rounds');
    if (maxRoundsInput) {
        maxRoundsInput.addEventListener('change', async () => {
            const v = Math.max(1, Math.min(999, parseInt(maxRoundsInput.value) || 20));
            CONFIG.loopMaxRounds = v;
            saveConfig(CONFIG);
            const { setEngineOptions } = await import('../features/loop-engine.js');
            setEngineOptions({ maxRounds: v });
        });
    }

    // ── 模式选择实时同步 ──
    const payloadSelect = modal.querySelector('#loop-payload-select');
    if (payloadSelect) {
        payloadSelect.addEventListener('change', async () => {
            CONFIG.loopPayloadMode = payloadSelect.value;
            saveConfig(CONFIG);
            const { setEngineOptions } = await import('../features/loop-engine.js');
            setEngineOptions({ payloadMode: payloadSelect.value });
        });
    }
}

/**
 * 绑定敏感词管理事件
 * @param {HTMLElement} modal - 设置面板根元素
 */
function bindSensitiveWordEvents(modal) {
    const sensitiveList = modal.querySelector('#sensitive-word-list');
    const wordInput = modal.querySelector('#sensitive-word-input');
    const replacementInput = modal.querySelector('#sensitive-replacement-input');
    const addWordBtn = modal.querySelector('#add-sensitive-word-btn');

    /** 渲染敏感词列表 */
    function renderSensitiveList() {
        if (!sensitiveList) return;
        const entries = Object.entries(CONFIG.sensitiveWords || {});
        if (entries.length === 0) {
            sensitiveList.innerHTML = '<div class="ds-empty-hint">暂无敏感词</div>';
            return;
        }
        sensitiveList.innerHTML = entries.map(([word, replacement]) => `
            <div class="ds-tag">
                <span><strong>${word}</strong> → ${replacement}</span>
                <button data-word="${word}" class="ds-tag-remove">删除</button>
            </div>
        `).join('');
        sensitiveList.querySelectorAll('.ds-tag-remove').forEach(btn => {
            btn.addEventListener('click', () => {
                const w = btn.dataset.word;
                delete CONFIG.sensitiveWords[w];
                saveConfig(CONFIG);
                clearPrivacyCache();
                renderSensitiveList();
            });
        });
    }

    if (addWordBtn) {
        addWordBtn.addEventListener('click', () => {
            const word = (wordInput?.value || '').trim();
            const replacement = (replacementInput?.value || '').trim();
            if (!word) { wordInput?.focus(); return; }
            if (!replacement) { replacementInput?.focus(); return; }
            if (!CONFIG.sensitiveWords) CONFIG.sensitiveWords = {};
            CONFIG.sensitiveWords[word] = replacement;
            saveConfig(CONFIG);
            clearPrivacyCache();
            if (wordInput) wordInput.value = '';
            if (replacementInput) replacementInput.value = '';
            renderSensitiveList();
        });
    }
    renderSensitiveList();
}

/**
 * 绑定预设管理事件（含场景模板、技能库的添加/列表刷新）
 * @param {HTMLElement} modal - 设置面板根元素
 */
async function bindPresetEvents(modal) {
    // ===== 消息预设 =====
    const addPresetBtn = modal.querySelector('#add-preset-btn');
    const presetNameInput = modal.querySelector('#preset-name');
    const presetPromptInput = modal.querySelector('#preset-prompt');
    if (addPresetBtn) {
        addPresetBtn.addEventListener('click', async () => {
            if (!presetNameInput || !presetPromptInput) {
                showToast('预设输入框未初始化', { tone: 'error' });
                return;
            }
            const name = presetNameInput.value.trim();
            const prompt = presetPromptInput.value.trim();
            if (!name || !prompt) {
                showToast('名称和提示词不能为空', { tone: 'warning' });
                presetNameInput?.focus();
                return;
            }
            try {
                await savePreset({ name, content: prompt });
                const container = modal.querySelector('#preset-list-container');
                await refreshPresetList(container);
                presetNameInput.value = '';
                presetPromptInput.value = '';
                showToast('预设已添加', { tone: 'success' });
            } catch (e) {
                showToast('添加失败：' + (e && e.message || e), { tone: 'error' });
            }
        });
    }
    const presetContainer = modal.querySelector('#preset-list-container');
    if (presetContainer) {
        await refreshPresetList(presetContainer);
    }

    // ===== 场景模板 =====
    const addScenarioBtn = modal.querySelector('#add-scenario-btn');
    const scenarioLabelInput = modal.querySelector('#scenario-label');
    const scenarioTemplateInput = modal.querySelector('#scenario-template');
    if (addScenarioBtn) {
        addScenarioBtn.addEventListener('click', async () => {
            if (!scenarioLabelInput || !scenarioTemplateInput) {
                showToast('场景输入框未初始化', { tone: 'error' });
                return;
            }
            const label = scenarioLabelInput.value.trim();
            const template = scenarioTemplateInput.value.trim();
            if (!label || !template) {
                showToast('场景名称和模板不能为空', { tone: 'warning' });
                scenarioLabelInput?.focus();
                return;
            }
            if (!template.includes('{text}')) {
                showToast('模板中需包含 {text} 占位符（表示选中文本）', { tone: 'warning' });
                scenarioTemplateInput?.focus();
                return;
            }
            try {
                await addCustomScenario(label, template);
                const container = modal.querySelector('#scenario-list-container');
                await refreshScenarioList(container);
                scenarioLabelInput.value = '';
                scenarioTemplateInput.value = '';
                showToast('场景已添加', { tone: 'success' });
            } catch (e) {
                showToast('添加失败：' + (e && e.message || e), { tone: 'error' });
            }
        });
    }
    const scenarioContainer = modal.querySelector('#scenario-list-container');
    if (scenarioContainer) {
        await refreshScenarioList(scenarioContainer);
    }

    // ===== 技能库 =====
    const addSkillBtn = modal.querySelector('#add-skill-btn');
    const skillNameInput = modal.querySelector('#skill-name');
    const skillDescInput = modal.querySelector('#skill-description');
    if (addSkillBtn) {
        addSkillBtn.addEventListener('click', async () => {
            if (!skillNameInput || !skillDescInput) {
                showToast('技能输入框未初始化', { tone: 'error' });
                return;
            }
            const name = skillNameInput.value.trim();
            const desc = skillDescInput.value.trim();
            if (!name) {
                showToast('技能名不能为空', { tone: 'warning' });
                skillNameInput?.focus();
                return;
            }
            // kebab-case 校验
            if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) {
                showToast('技能名需为 kebab-case 格式（小写字母/数字/连字符）', { tone: 'warning' });
                skillNameInput?.focus();
                return;
            }
            try {
                await saveSkill({
                    name,
                    description: desc || '自定义技能',
                    instructions: `请执行以下任务：\n{args}`,
                    source: 'custom',
                    memoryEnabled: false,
                    enabled: true
                });
                const container = modal.querySelector('#skill-list-container');
                await refreshSkillList(container);
                skillNameInput.value = '';
                skillDescInput.value = '';
                showToast('技能已添加，请在数据中编辑其指令正文', { tone: 'success' });
            } catch (e) {
                showToast('添加失败：' + (e && e.message || e), { tone: 'error' });
            }
        });
    }
    const skillContainer = modal.querySelector('#skill-list-container');
    if (skillContainer) {
        await refreshSkillList(skillContainer);
    }

    // ===== 技能导入：GitHub 预览/导入 + 文本导入 + 源列表 =====
    await bindSkillImportEvents(modal);
}

/**
 * 绑定技能导入相关事件（GitHub 预览/导入、文本导入、源列表刷新）
 *
 * 触发流程：
 *   1. GitHub 预览：用户输入 URL → 调 previewGitHubSkillSource → 渲染 checkbox 列表
 *   2. GitHub 导入：用户勾选后点"导入选中"→ 调 importGitHubSkillSource → 刷新列表
 *   3. 文本导入：用户粘贴 SKILL.md → 调 importSkillFromText → 刷新列表
 *   4. 源列表：打开面板时刷新，支持检查更新/立即更新/删除
 *
 * @param {HTMLElement} modal - 设置面板根元素
 */
async function bindSkillImportEvents(modal) {
    // GitHub 预览
    const previewBtn = modal.querySelector('#skill-preview-github-btn');
    const githubUrlInput = modal.querySelector('#skill-github-url');
    const previewContainer = modal.querySelector('#skill-github-preview');
    if (previewBtn && githubUrlInput && previewContainer) {
        previewBtn.addEventListener('click', async () => {
            const url = githubUrlInput.value.trim();
            if (!url) {
                showToast('请输入 GitHub URL', { tone: 'warning' });
                githubUrlInput.focus();
                return;
            }
            previewContainer.innerHTML = '<div class="ds-empty-hint">正在加载...</div>';
            try {
                const preview = await previewGitHubSkillSource(url);
                if (!preview.skills || preview.skills.length === 0) {
                    previewContainer.innerHTML = '<div class="ds-empty-hint">未找到 SKILL.md</div>';
                    return;
                }
                // 渲染 checkbox 列表
                const itemsHtml = preview.skills.map(item => {
                    const meta = [
                        item.version ? `v${item.version}` : '',
                        item.lastUpdated ? `更新: ${item.lastUpdated}` : '',
                        `${item.bytes} bytes`
                    ].filter(Boolean).join(' · ');
                    const warning = item.nameChanged ? '<span class="ds-badge ds-badge-warn">将重命名</span>' : '';
                    return `
                        <label class="ds-skill-preview-item">
                            <input type="checkbox" value="${escapeHtmlAttr(item.path)}" ${item.existingSkillName ? '' : 'checked'}>
                            <div class="ds-skill-info">
                                <span class="ds-skill-name"><code>${escapeHtmlAttr(item.name)}</code>${warning}${item.existingSkillName ? `<span class="ds-skill-source">→ ${escapeHtmlAttr(item.existingSkillName)}</span>` : ''}</span>
                                <span class="ds-skill-desc">${escapeHtmlAttr(item.description || '')}</span>
                                <span class="ds-skill-source">${escapeHtmlAttr(item.path)} · ${meta}</span>
                            </div>
                        </label>
                    `;
                }).join('');
                const warningsHtml = (preview.warnings && preview.warnings.length > 0)
                    ? `<div class="ds-warn-card" style="margin:6px 0;">${preview.warnings.map(w => `<div>⚠️ ${escapeHtmlAttr(w)}</div>`).join('')}</div>`
                    : '';
                previewContainer.innerHTML = `
                    ${warningsHtml}
                    <div class="ds-skill-preview-list">${itemsHtml}</div>
                    <div class="ds-add-row" style="margin-top:8px;">
                        <button id="skill-import-github-btn" class="ds-btn ds-btn-primary">📥 导入选中</button>
                        <span class="ds-input-hint">共 ${preview.skills.length} 个，已选中 <span id="skill-github-selected-count">0</span> 个</span>
                    </div>
                `;
                // 更新选中计数
                const updateCount = () => {
                    const checked = previewContainer.querySelectorAll('input[type="checkbox"]:checked').length;
                    const countEl = previewContainer.querySelector('#skill-github-selected-count');
                    if (countEl) countEl.textContent = String(checked);
                };
                previewContainer.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.addEventListener('change', updateCount));
                updateCount();
                // 导入按钮
                const importBtn = previewContainer.querySelector('#skill-import-github-btn');
                if (importBtn) {
                    importBtn.addEventListener('click', async () => {
                        const selected = Array.from(previewContainer.querySelectorAll('input[type="checkbox"]:checked')).map(cb => cb.value);
                        if (selected.length === 0) {
                            showToast('请至少选择一个技能', { tone: 'warning' });
                            return;
                        }
                        importBtn.disabled = true;
                        importBtn.textContent = '导入中...';
                        try {
                            const result = await importGitHubSkillSource({ url, selectedPaths: selected });
                            await refreshSkillList(modal.querySelector('#skill-list-container'));
                            const srcContainer = modal.querySelector('#skill-source-list-container');
                            if (srcContainer) await refreshSkillSourceList(srcContainer);
                            showToast(`导入成功：${result.imported.length} 个，替换 ${result.replaced} 个，重命名 ${result.renamed} 个`, { tone: 'success' });
                            previewContainer.innerHTML = '';
                        } catch (err) {
                            showToast('导入失败：' + (err && err.message || err), { tone: 'error' });
                        } finally {
                            importBtn.disabled = false;
                            importBtn.textContent = '📥 导入选中';
                        }
                    });
                }
            } catch (err) {
                previewContainer.innerHTML = `<div class="ds-empty-hint">加载失败：${escapeHtmlAttr(err && err.message || String(err))}</div>`;
            }
        });
    }

    // 文本导入
    const importTextBtn = modal.querySelector('#skill-import-text-btn');
    const textContentInput = modal.querySelector('#skill-text-content');
    const textDisplayNameInput = modal.querySelector('#skill-text-display-name');
    const textSkillNameInput = modal.querySelector('#skill-text-skill-name');
    if (importTextBtn && textContentInput) {
        importTextBtn.addEventListener('click', async () => {
            const content = textContentInput.value;
            if (!content || !content.trim()) {
                showToast('SKILL.md 内容不能为空', { tone: 'warning' });
                textContentInput.focus();
                return;
            }
            importTextBtn.disabled = true;
            importTextBtn.textContent = '导入中...';
            try {
                const result = await importSkillFromText({
                    content,
                    displayName: textDisplayNameInput ? textDisplayNameInput.value.trim() : '',
                    skillName: textSkillNameInput ? textSkillNameInput.value.trim() : ''
                });
                if (result.ok) {
                    await refreshSkillList(modal.querySelector('#skill-list-container'));
                    const srcContainer = modal.querySelector('#skill-source-list-container');
                    if (srcContainer) await refreshSkillSourceList(srcContainer);
                    showToast(`导入成功：${result.imported.length} 个技能`, { tone: 'success' });
                    textContentInput.value = '';
                    if (textDisplayNameInput) textDisplayNameInput.value = '';
                    if (textSkillNameInput) textSkillNameInput.value = '';
                } else {
                    showToast('导入失败：' + (result.error || '未知错误'), { tone: 'error' });
                }
            } catch (err) {
                showToast('导入失败：' + (err && err.message || err), { tone: 'error' });
            } finally {
                importTextBtn.disabled = false;
                importTextBtn.textContent = '📥 从文本导入';
            }
        });
    }

    // 技能源列表
    const sourceContainer = modal.querySelector('#skill-source-list-container');
    if (sourceContainer) {
        await refreshSkillSourceList(sourceContainer);
    }

    // 监听 AI 调用 skill_draft_create 创建的草稿（拉起保存 UI）
    // 注意：每次打开面板都会重绑，因此先移除旧 handler 再添加新的，避免重复触发
    if (typeof window !== 'undefined') {
        if (typeof window._dsSkillDraftHandler === 'function') {
            window.removeEventListener('ds:skill-draft-created', window._dsSkillDraftHandler);
        }
        window._dsSkillDraftHandler = function(e) {
            if (e && e.detail && e.detail.draft) {
                _showSkillDraftModal(modal, e.detail.draft);
            }
        };
        window.addEventListener('ds:skill-draft-created', window._dsSkillDraftHandler);
        // 处理在面板打开前就已生成的草稿
        if (typeof window._dsPendingSkillDraft !== 'undefined') {
            _showSkillDraftModal(modal, window._dsPendingSkillDraft);
            delete window._dsPendingSkillDraft;
        }
    }
}

/**
 * 显示 skill 草稿保存对话框
 *
 * 当 AI 调用 skill_draft_create 工具后，草稿会通过 window._dsPendingSkillDraft
 * 或 ds:skill-draft-created 事件传递到设置面板。
 *
 * 实现策略：
 *   - 草稿已包含完整的 instructions（AI 生成的指令正文）→ 弹出确认对话框，
 *     用户确认后直接 saveSkill 保存为自定义技能（带完整 instructions）
 *   - 草稿缺失 instructions → 仅填充名称/描述到输入框，让用户手动添加
 *
 * @param {HTMLElement} modal - 设置面板根元素（用于定位）
 * @param {Object} draft - skill 草稿对象
 */
async function _showSkillDraftModal(modal, draft) {
    if (!draft || !draft.name) return;
    // 切换到功能扩展标签页
    const featuresTab = modal.querySelector('[data-tab="features"]');
    if (featuresTab) featuresTab.click();
    // 草稿含完整 instructions：弹出确认后直接保存
    if (draft.instructions && draft.instructions.length > 0) {
        const preview = draft.instructions.length > 200
            ? draft.instructions.slice(0, 200) + '...'
            : draft.instructions;
        const confirmed = confirm(
            `AI 生成了技能草稿：\n\n` +
            `名称：${draft.name}\n` +
            `描述：${draft.description || '(无)'}\n` +
            `启用记忆：${draft.memoryEnabled ? '是' : '否'}\n\n` +
            `指令预览：\n${preview}\n\n` +
            `是否保存为自定义技能？`
        );
        if (confirmed) {
            try {
                await saveSkill({
                    name: draft.name,
                    description: draft.description || 'AI 生成的技能',
                    instructions: draft.instructions,
                    source: 'custom',
                    memoryEnabled: draft.memoryEnabled === true,
                    enabled: true,
                    metadata: draft.metadata || { createdBy: 'skill_draft_create' }
                });
                const container = modal.querySelector('#skill-list-container');
                if (container) await refreshSkillList(container);
                showToast(`技能"${draft.name}"已保存`, { tone: 'success' });
            } catch (err) {
                showToast('保存失败：' + (err && err.message || err), { tone: 'error' });
                // 失败时回退到填充输入框
                const nameInput = modal.querySelector('#skill-name');
                const descInput = modal.querySelector('#skill-description');
                if (nameInput) nameInput.value = draft.name;
                if (descInput) descInput.value = draft.description || '';
            }
        }
        return;
    }
    // 草稿缺 instructions：仅填充输入框
    const nameInput = modal.querySelector('#skill-name');
    const descInput = modal.querySelector('#skill-description');
    if (nameInput) nameInput.value = draft.name;
    if (descInput) descInput.value = draft.description || '';
    showToast(`AI 生成了技能草稿"${draft.name}"，已填入输入框，请检查后点击"+ 添加"`, { tone: 'success' });
}

/**
 * 绑定外观相关事件（主题选择器、背景上传、透明度滑块）
 * @param {HTMLElement} modal - 设置面板根元素
 * @param {Object} t - 主题配色
 */
function bindAppearanceEvents(modal, t) {
    // 主题选择器
    const themeSelector = modal.querySelector('#theme-selector');
    if (themeSelector) {
        themeSelector.addEventListener('click', (e) => {
            const target = e.target.closest('[data-theme]');
            if (!target) return;
            themeSelector.querySelectorAll('[data-theme]').forEach(el => el.style.borderColor = 'transparent');
            target.style.borderColor = 'var(--ds-primary)';
            themeSelector.dataset.selectedTheme = target.dataset.theme;
        });
        const currentTheme = CONFIG.themeColor || 'border';
        themeSelector.querySelectorAll('[data-theme]').forEach(el => {
            if (el.dataset.theme === currentTheme) el.style.borderColor = t.primary;
        });
        themeSelector.dataset.selectedTheme = currentTheme;
    }

    // 背景文件上传
    const bgFileInput = modal.querySelector('#bg-file-input');
    if (bgFileInput) {
        bgFileInput.addEventListener('change', function(e) {
            const file = this.files[0];
            if (!file) return;
            const reader = new FileReader();
            const bgImageInput = modal.querySelector('#bg-image');
            reader.onload = (ev) => { if (bgImageInput) bgImageInput.value = ev.target.result; };
            reader.readAsDataURL(file);
            this.value = '';
        });
    }

    // 透明度滑块
    const opacitySlider = modal.querySelector('#bg-opacity');
    const opacityLabel = modal.querySelector('#bg-opacity-label');
    if (opacitySlider && opacityLabel) {
        opacitySlider.addEventListener('input', function() {
            opacityLabel.textContent = parseFloat(this.value).toFixed(2);
        });
    }
}

/**
 * 绑定 WebDAV 同步配置分区事件
 *
 * 行为：
 *   - 表单 input/change 即时持久化到 sync store（saveSyncConfig）
 *   - "sync 总开关" toggle 联动 store.enabled 字段
 *   - "测试连接/立即上传/立即下载/双向同步" 按钮调用对应 API
 *   - 操作按钮带 loading 状态，完成后 toast 反馈
 *   - 每次操作完成后刷新状态显示
 *
 * 容错：sync 模块未初始化（window._dsSync 不存在）时静默跳过，
 *   不影响设置面板其他功能
 *
 * @param {HTMLElement} modal - 设置面板根元素
 */
function bindSyncEvents(modal) {
    const api = (typeof window !== 'undefined') ? window._dsSync : null;
    if (!api) return;  // sync 模块未初始化：跳过事件绑定

    /** 表单 input id → saveSyncConfig 字段名映射 */
    const FIELD_MAP = {
        'sync-server': 'server',
        'sync-username': 'username',
        'sync-password': 'password',
        'sync-basepath': 'basePath'
    };

    /**
     * 从 store 读取配置并填充到表单输入框
     */
    function loadConfigToForm() {
        const cfg = api.getSyncConfig();
        Object.entries(FIELD_MAP).forEach(([id, key]) => {
            const el = modal.querySelector('#' + id);
            if (el) el.value = cfg[key] || '';
        });
    }

    /**
     * 将表单当前值同步写入 store（浅合并）
     */
    function saveFormToStore() {
        const patch = {};
        Object.entries(FIELD_MAP).forEach(([id, key]) => {
            const el = modal.querySelector('#' + id);
            if (el) patch[key] = el.value;
        });
        api.saveSyncConfig(patch);
    }

    /**
     * 把时间戳格式化为可读字符串
     * @param {number|null} ts - 毫秒时间戳
     * @returns {string} 形如 2026-08-03 14:25:08；null 返回 "—"
     */
    function fmtTime(ts) {
        if (!ts) return '—';
        try {
            const d = new Date(ts);
            const pad = (n) => String(n).padStart(2, '0');
            return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
        } catch (e) {
            return '—';
        }
    }

    /**
     * 刷新同步状态显示（读取 getSyncStatus 并写入 DOM）
     */
    function refreshStatus() {
        const status = api.getSyncStatus();
        const card = modal.querySelector('#ds-sync-status');
        if (!card) return;
        const setField = (name, text) => {
            const el = card.querySelector(`[data-field="${name}"]`);
            if (el) el.textContent = text;
        };
        setField('lastUpload', fmtTime(status.lastUpload));
        setField('lastDownload', fmtTime(status.lastDownload));
        setField('remoteGeneration', status.remoteGeneration || 0);
        setField('lastError', status.lastError || '—');
    }

    /**
     * 给按钮添加 loading + toast 反馈的统一包装
     *
     * 流程：
     *   1. 操作前先 saveFormToStore（保证读到最新配置）
     *   2. 按钮禁用 + 显示"⏳ 处理中…"
     *   3. 执行异步操作
     *   4. 成功：调用 onSuccess 或显示 successMsg
     *   5. 失败：toast 错误信息
     *   6. finally：恢复按钮 + 刷新状态
     *
     * @param {HTMLElement} btn - 按钮元素
     * @param {Function} fn - 异步操作函数，返回 {ok, error, ...}
     * @param {Object} [opts] - 选项
     * @param {string} [opts.successMsg] - 默认成功提示
     * @param {Function} [opts.onSuccess] - 自定义成功回调（覆盖 successMsg）
     */
    function withFeedback(btn, fn, opts = {}) {
        if (!btn) return;
        btn.addEventListener('click', async () => {
            // 操作前先保存表单，保证 sync 模块读到最新配置
            saveFormToStore();
            const originalText = btn.textContent;
            btn.textContent = '⏳ 处理中…';
            btn.style.opacity = '0.7';
            btn.style.pointerEvents = 'none';
            try {
                const result = await fn();
                if (result && result.ok) {
                    if (typeof opts.onSuccess === 'function') {
                        opts.onSuccess(result);
                    } else {
                        showToast(opts.successMsg || '✅ 操作成功', { tone: 'success' });
                    }
                } else {
                    const errMsg = (result && result.error) || '操作失败';
                    showToast(errMsg, { tone: 'error' });
                }
            } catch (e) {
                showToast(e.message || '操作异常', { tone: 'error' });
            } finally {
                btn.textContent = originalText;
                btn.style.opacity = '';
                btn.style.pointerEvents = '';
                refreshStatus();
            }
        });
    }

    // 表单 input change 即时保存（避免用户填了不点"保存并应用"就丢失）
    Object.keys(FIELD_MAP).forEach(id => {
        const el = modal.querySelector('#' + id);
        if (el) el.addEventListener('change', saveFormToStore);
    });

    // sync 总开关联动：toggle 状态实时同步到 store.enabled
    const syncToggle = modal.querySelector('#chk-sync');
    if (syncToggle) {
        syncToggle.addEventListener('change', () => {
            api.saveSyncConfig({ enabled: syncToggle.checked });
        });
        // 初始化时把 store.enabled 同步到 toggle（store 优先，避免两边不一致）
        const cfg = api.getSyncConfig();
        if (typeof cfg.enabled === 'boolean') {
            syncToggle.checked = cfg.enabled;
        }
    }

    // 测试连接：sync 模块无 testConnection，用 uploadSync 上传一次小数据验证连通性
    withFeedback(
        modal.querySelector('#ds-sync-test-btn'),
        () => api.uploadSync(),
        {
            successMsg: '✅ 连接测试成功',
            onSuccess: (r) => showToast(`✅ 连接成功，远端代次 #${r.generation}`, { tone: 'success' })
        }
    );
    // 立即上传
    withFeedback(
        modal.querySelector('#ds-sync-upload-btn'),
        () => api.uploadSync(),
        { successMsg: '✅ 上传成功' }
    );
    // 立即下载
    withFeedback(
        modal.querySelector('#ds-sync-download-btn'),
        () => api.downloadSync(),
        {
            onSuccess: (r) => {
                const applied = r.applied || 0;
                const skipped = r.skipped || 0;
                showToast(`✅ 下载完成：应用 ${applied} 项，跳过 ${skipped} 项`, { tone: 'success' });
            }
        }
    );
    // 双向同步
    withFeedback(
        modal.querySelector('#ds-sync-both-btn'),
        () => api.syncBoth(),
        {
            onSuccess: (r) => {
                const upGen = r.upload && r.upload.generation;
                showToast(`✅ 双向同步完成，新代次 #${upGen}`, { tone: 'success' });
            }
        }
    );

    // 初始化：填充表单 + 刷新状态
    loadConfigToForm();
    refreshStatus();
}

// ============================================================
// 创建设置面板
// ============================================================

/**
 * 创建设置面板 DOM 元素并绑定所有事件
 * @returns {HTMLElement} 设置面板的 modal 元素
 */
function createSettingsModal() {
    const modal = document.createElement('div');
    modal.id = 'ds-settings-modal';
    const isDark = utils.isDarkMode();
    // 注意：此处变量名使用 themeColors 而非 t，避免遮蔽模块级 i18n getter t()
    const themeColors = getThemeColors(CONFIG.themeColor) || { primary: '#793f82', accent: '#9B7AA0' };

    modal.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0, 0, 0, 0.5); backdrop-filter: blur(8px);
        display: none; justify-content: center; align-items: center;
        z-index: 999999; font-family: -apple-system, 'Segoe UI', system-ui, sans-serif;
    `;

    // 注入样式（仅一次，每次创建时更新以适配主题/暗色切换）
    let styleEl = document.getElementById('ds-settings-style');
    if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = 'ds-settings-style';
        document.head.appendChild(styleEl);
    }
    styleEl.textContent = buildStylesCSS(isDark, themeColors);

    // 主题颜色选择器
    const themeNames = ['border', 'forest', 'ocean', 'sunset', 'lavender', 'cherry', 'original'];
    const themeOptions = themeNames.map(name => {
        if (name === 'original') {
            return `<span class="ds-theme-label" data-theme="original">默认</span>`;
        }
        const th = THEMES[name].light;
        return `<span class="ds-theme-dot" data-theme="${name}" style="background:${th.primary};" title="${name}"></span>`;
    }).join('');

    const panel = document.createElement('div');
    panel.className = 'ds-panel ds-overlay';
    panel.style.cssText = `
        background: ${isDark ? '#1e1e2e' : '#ffffff'};
        color: ${isDark ? '#cdd6f4' : '#1a1a2e'};
        border-radius: 24px; padding: 28px 32px;
        max-width: 860px; width: 92%; max-height: 88vh;
        overflow: hidden; box-shadow: 0 24px 80px rgba(0,0,0,0.4);
        border: 1px solid ${isDark ? '#313244' : '#e8e8ef'};
    `;

    panel.innerHTML = `
        <div class="ds-sheet-handle" style="display:none;"></div>
        <div class="ds-panel-header">
            <div>
                <h2 class="ds-panel-title">${t('settings.panel.title')}</h2>
                <span class="ds-panel-subtitle">${t('settings.panel.subtitle')}</span>
            </div>
            <div style="display:flex;align-items:center;gap:12px;">
                <span style="color:var(--ds-text-primary, #1a1a2e);font-size:13px;font-weight:500;white-space:nowrap;">🟢 脚本总开关</span>
                <label class="ds-toggle">
                    <input type="checkbox" id="chk-script" ${CONFIG[OPTION_CONFIG_KEYS['script']] ? 'checked' : ''}>
                    <span class="ds-slider"></span>
                </label>
                <button id="ds-settings-close" class="ds-close-btn">&times;</button>
            </div>
        </div>

        <div class="ds-body">
            <div class="ds-tabs">
                <div class="ds-tab active" data-tab="appearance">${tt('settings.tab.appearance', '🎨 外观')}</div>
                <div class="ds-tab" data-tab="enhance">${tt('settings.tab.enhance', '✨ 对话增强')}</div>
                <div class="ds-tab" data-tab="features">${tt('settings.tab.features', '🧩 功能扩展')}</div>
                <div class="ds-tab" data-tab="agent">${tt('settings.tab.agent', '🤖 Agent 系统')}</div>
                <div class="ds-tab" data-tab="privacy">${tt('settings.tab.privacy', '🔒 隐私与安全')}</div>
                <div class="ds-tab" data-tab="sync">${tt('settings.tab.sync', '🔄 数据同步')}</div>
                <div class="ds-tab" data-tab="extensions">${tt('settings.tab.extensions', '🛠️ 高级与扩展')}</div>
                <div class="ds-tab" data-tab="about">${tt('settings.tab.about', '📋 信息')}</div>
            </div>
            <div class="ds-tab-content-wrapper">
                ${buildAppearanceTab(themeOptions)}
                ${buildEnhanceTab()}
                ${buildFeaturesTab()}
                ${buildAgentTab()}
                ${buildPrivacyTab()}
                ${buildSyncTab()}
                ${buildExtensionsTab()}
                ${buildAboutTab()}
            </div>
        </div>

        <div class="ds-footer">
            <button id="ds-settings-save" class="ds-btn ds-btn-primary ds-btn-save">${t('settings.footer.save')}</button>
            <button id="ds-settings-reset" class="ds-btn ds-btn-outline ds-btn-reset">${t('settings.footer.reset')}</button>
        </div>
    `;

    modal.appendChild(panel);
    document.body.appendChild(modal);

    // ===== 事件绑定 =====
    const closeBtn = modal.querySelector('#ds-settings-close');
    const saveBtn = modal.querySelector('#ds-settings-save');
    const resetBtn = modal.querySelector('#ds-settings-reset');

    closeBtn.addEventListener('click', hideSettings);
    saveBtn.addEventListener('click', saveSettings);
    resetBtn.addEventListener('click', resetSettings);

    // 标签页切换
    modal.querySelectorAll('.ds-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const target = tab.dataset.tab;
            modal.querySelectorAll('.ds-tab').forEach(tb => tb.classList.toggle('active', tb === tab));
            modal.querySelectorAll('.ds-tab-content').forEach(c => {
                c.classList.toggle('active', c.dataset.content === target);
            });
            // 切换到对话增强 tab 时渲染使用量统计面板
            if (target === 'enhance') {
                const usageContainer = modal.querySelector('#ds-usage-panel-container');
                if (usageContainer && window._dsRenderUsagePanel) {
                    usageContainer.innerHTML = window._dsRenderUsagePanel();
                }
            }
            // 切换到 Agent tab 时渲染记忆管理面板
            if (target === 'agent') {
                const memContainer = modal.querySelector('#ds-memory-panel-container');
                if (memContainer) {
                    memContainer.innerHTML = renderMemoryPanel();
                }
            }
        });
    });

    // 各模块事件绑定
    bindExportEvents(modal);
    bindCollapseControlEvents(modal);
    bindSensitiveWordEvents(modal);
    bindPresetEvents(modal);
    bindAppearanceEvents(modal, themeColors);
    bindMultimodalEvents(modal);
    bindSyncEvents(modal);

    // 界面语言切换：即时生效，保存后派发事件触发设置面板重渲染
    const languageSelect = modal.querySelector('#language-select');
    if (languageSelect) {
        languageSelect.addEventListener('change', () => {
            const lang = languageSelect.value;
            // 同步到 CONFIG 并持久化（保持 select 状态与 CONFIG 一致）
            CONFIG.language = lang;
            saveConfig(CONFIG);
            // 调用 i18n setLanguage 立即切换语言（更新内部缓存 + localStorage）
            if (window._dsI18n) {
                window._dsI18n.setLanguage(lang);
            }
            // 派发事件，由模块级监听器重渲染设置面板
            window.dispatchEvent(new CustomEvent('ds-i18n-changed'));
        });
    }

    // 帮助弹出框（点击 ? 图标显示，点击其他地方关闭）
    modal.addEventListener('click', (e) => {
        const helpIcon = e.target.closest('.ds-help');
        if (helpIcon) {
            e.stopPropagation();
            const text = helpIcon.dataset.help || '';
            if (text) showHelpPopup(text, helpIcon);
        } else {
            hideHelpPopup();
        }
    });

    // 点击 label 文字也能切换 toggle
    modal.querySelectorAll('[data-toggle]').forEach(label => {
        label.addEventListener('click', (e) => {
            const id = label.dataset.toggle;
            const checkbox = modal.querySelector('#chk-' + id);
            if (checkbox) {
                checkbox.checked = !checkbox.checked;
                e.stopPropagation();
            }
        });
    });

    // 点击遮罩关闭
    modal.addEventListener('click', (e) => { if (e.target === modal) hideSettings(); });

    return modal;
}

// ============================================================
// 显示/隐藏
// ============================================================

/**
 * 显示设置面板，同步所有控件状态到当前 CONFIG 值
 */
export async function showSettings() {
    if (!settingsModal) settingsModal = createSettingsModal();
    settingsModal.style.display = 'flex';
    // 同步所有控件状态
    const ids = Object.keys(OPTION_CONFIG_KEYS);
    ids.forEach(id => {
        const el = document.getElementById('chk-' + id);
        if (el) {
            const key = OPTION_CONFIG_KEYS[id];
            el.checked = CONFIG[key] !== undefined ? CONFIG[key] : true;
        }
    });
    // title-list-text 同步状态
    const txt = document.getElementById('title-list-text');
    if (txt) txt.value = (CONFIG.titleList || DEFAULTS.titleList).join('\n');
    const sel = document.getElementById('theme-selector');
    if (sel) {
        const theme = CONFIG.themeColor || 'border';
        const themeColors = getThemeColors(theme) || { primary: '#793f82' };
        sel.querySelectorAll('[data-theme]').forEach(el => el.style.borderColor = el.dataset.theme === theme ? themeColors.primary : 'transparent');
        sel.dataset.selectedTheme = theme;
    }
    // 刷新预设/场景/技能列表（每次打开面板时从数据层重新加载最新数据）
    const presetListEl = document.getElementById('preset-list-container');
    if (presetListEl) await refreshPresetList(presetListEl);
    const scenarioListEl = document.getElementById('scenario-list-container');
    if (scenarioListEl) await refreshScenarioList(scenarioListEl);
    const skillListEl = document.getElementById('skill-list-container');
    if (skillListEl) await refreshSkillList(skillListEl);
    // 刷新技能源列表（GitHub/文本源，支持检查更新/立即更新/删除）
    const skillSourceListEl = document.getElementById('skill-source-list-container');
    if (skillSourceListEl) await refreshSkillSourceList(skillSourceListEl);
    const fontFamily = document.getElementById('font-family');
    if (fontFamily) fontFamily.value = CONFIG.fontFamily || '';
    const fontUrl = document.getElementById('font-url');
    if (fontUrl) fontUrl.value = CONFIG.fontUrl || '';
    const bgImage = document.getElementById('bg-image');
    if (bgImage) bgImage.value = CONFIG.bgImage || '';
    const bgOpacity = document.getElementById('bg-opacity');
    if (bgOpacity) bgOpacity.value = CONFIG.bgOpacity !== undefined ? CONFIG.bgOpacity : 0.5;
    const bgOpacityLabel = document.getElementById('bg-opacity-label');
    if (bgOpacityLabel) bgOpacityLabel.textContent = (CONFIG.bgOpacity !== undefined ? CONFIG.bgOpacity : 0.5).toFixed(2);
    const placeholderText = document.getElementById('placeholder-text');
    if (placeholderText) placeholderText.value = CONFIG.placeholderText || '';
    const defaultModeSelect = document.getElementById('default-mode-select');
    if (defaultModeSelect) defaultModeSelect.value = CONFIG.defaultMode || 'default';
    const promptInjectText = document.getElementById('prompt-inject-text');
    if (promptInjectText) promptInjectText.value = CONFIG.promptText || '';
    // Phase 6：同步界面语言 select
    const languageSelect = document.getElementById('language-select');
    if (languageSelect) languageSelect.value = CONFIG.language || 'auto';
    // 多模态配置分区：每次打开面板时同步最新配置到 UI
    if (settingsModal) syncMultimodalUI(settingsModal);
}

/**
 * 隐藏设置面板并恢复被临时隐藏的浮动菜单容器
 */
export function hideSettings() {
    if (settingsModal) settingsModal.style.display = 'none';
    hideHelpPopup();
    // 恢复被临时隐藏的 DeepSeek 浮动菜单容器，否则下拉菜单将永久无法打开
    // 使用 window 全局回调避免与 menu-inject.js 形成循环导入
    if (typeof window._dsRestoreFloatingWrappers === 'function') {
        try { window._dsRestoreFloatingWrappers(); } catch (e) {}
    }
}

/**
 * 获取设置面板 modal 元素
 * @returns {HTMLElement|null}
 */
export function getSettingsModal() { return settingsModal; }

/**
 * 清除设置面板（移除 DOM 并重置引用）
 */
export function clearSettingsModal() {
    if (settingsModal) {
        settingsModal.remove();
        settingsModal = null;
    }
}

// ============================================================
// i18n 语言切换即时生效：监听 ds-i18n-changed 事件重渲染设置面板
// ============================================================

/**
 * 语言切换事件监听（幂等注册）
 * 当设置面板处于打开状态时，关闭并重新创建面板，使所有文案跟随新语言
 */
if (typeof window !== 'undefined' && !window.__dsI18nChangedListenerAdded) {
    window.__dsI18nChangedListenerAdded = true;
    window.addEventListener('ds-i18n-changed', () => {
        // 仅当设置面板已创建且当前可见时才重渲染
        if (settingsModal && settingsModal.style.display === 'flex') {
            clearSettingsModal();
            showSettings();
        }
    });
}

// ============================================================
// 保存/重置
// ============================================================

/**
 * 保存设置：读取所有控件值写入 CONFIG，保存后刷新页面
 */
function saveSettings() {
    // 读取所有 checkbox
    Object.keys(OPTION_CONFIG_KEYS).forEach(id => {
        const el = document.getElementById('chk-' + id);
        if (el) CONFIG[OPTION_CONFIG_KEYS[id]] = el.checked;
    });

    // Agent 系统总开关联动：总开关 OFF 时强制关闭三个子模块
    // 总开关 ON 时保留用户对子模块的单独控制（允许只启用部分模块）
    if (!CONFIG.agentSystemEnabled) {
        CONFIG.agentMemoryEnabled = false;
        CONFIG.agentToolsEnabled = false;
        CONFIG.agentLoopEnabled = false;
    }
    // 标题列表
    const titleListEl = document.getElementById('title-list-text');
    if (titleListEl) {
        const titles = titleListEl.value.split('\n').map(s => s.trim()).filter(Boolean);
        CONFIG.titleList = titles.length ? titles : DEFAULTS.titleList;
    }
    // 主题
    const themeEl = document.getElementById('theme-selector');
    const theme = themeEl ? themeEl.dataset.selectedTheme : null;
    if (theme) CONFIG.themeColor = theme;
    // 字体
    const fontFamilyEl = document.getElementById('font-family');
    if (fontFamilyEl) CONFIG.fontFamily = fontFamilyEl.value.trim();
    const fontUrlEl = document.getElementById('font-url');
    if (fontUrlEl) CONFIG.fontUrl = fontUrlEl.value.trim();
    // 背景
    const bgImageEl = document.getElementById('bg-image');
    if (bgImageEl) CONFIG.bgImage = bgImageEl.value.trim();
    const bgOpacityEl = document.getElementById('bg-opacity');
    const bgOpacity = bgOpacityEl ? parseFloat(bgOpacityEl.value) : NaN;
    CONFIG.bgOpacity = isNaN(bgOpacity) ? 0.5 : Math.min(1, Math.max(0, bgOpacity));
    // 占位符文字（两端均存在该 UI 元素，加守卫防御性处理）
    const placeholderTextEl = document.getElementById('placeholder-text');
    if (placeholderTextEl) {
        CONFIG.placeholderText = placeholderTextEl.value.trim() || '说点什么吧～';
    }
    // 默认模式
    const modeSelect = document.getElementById('default-mode-select');
    if (modeSelect) CONFIG.defaultMode = modeSelect.value;
    // 提示词注入文本
    const promptTextArea = document.getElementById('prompt-inject-text');
    if (promptTextArea) CONFIG.promptText = promptTextArea.value.trim();
    // Phase 6：保存界面语言选择
    const languageSelectEl = document.getElementById('language-select');
    if (languageSelectEl) CONFIG.language = languageSelectEl.value;
    // 清除隐私保护正则缓存（敏感词或大小写设置可能已变更）
    clearPrivacyCache();

    saveConfig(CONFIG);
    hideSettings();
    alert('✅ 设置已保存，正在刷新页面…');
    location.reload();
}

/**
 * 恢复默认设置并刷新页面
 */
function resetSettings() {
    saveConfig({ ...DEFAULTS });
    hideSettings();
    alert('✅ 已恢复默认设置，正在刷新页面…');
    location.reload();
}
