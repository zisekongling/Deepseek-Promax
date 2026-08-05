/**
 * 配置管理模块
 *
 * 负责：
 *   - 定义默认配置 DEFAULTS
 *   - 定义短 ID → CONFIG 键名映射 OPTION_CONFIG_KEYS（用于设置面板 checkbox）
 *   - 从 localStorage 加载 / 保存配置
 *   - 导出全局可变的 CONFIG 对象（其他模块直接引用此对象）
 *
 * 平台差异：
 *   - WebView 端（dspro.js）：标题伪装/自动跳转默认关闭，窄边距默认开启
 *   - 篡改猴版（dspro.user.js）：保留原默认值（三项均默认开启）
 *   通过 Platform.isWebView 在运行时探测环境，单源码双构建共享同一份 DEFAULTS
 *
 * 性能优化：
 *   - saveConfig 做异步防抖（默认 250ms），避免连续修改配置（如拖动滑块）时
 *     反复 JSON.stringify + localStorage.setItem 阻塞主线程
 *   - 读缓存：首次 loadConfig 后 _cacheDirty 置 false，后续 reloadConfig
 *     仅在外部确实需要强制刷新时才重新 parse localStorage
 */
import { Platform } from './platform/bridge.js';

/**
 * 是否 WebView 环境（运行时探测）
 * WebView 端：标题伪装/自动跳转默认关闭（避免对非 DeepSeek 域名的影响）
 * 篡改猴版：保留原默认值 true
 * 同时导出供 settings-panel.js 等模块按环境差异化渲染 UI
 */
export const IS_WEBVIEW = !!(Platform && Platform.isWebView);
const _IS_WEBVIEW = IS_WEBVIEW;

/**
 * 是否 Electron 桌面端（运行时探测）
 * Electron 端：与 DeepSeek++ 扩展共同运行，自动隐藏重叠功能
 */
export const IS_ELECTRON = !!(Platform && Platform.isElectron);
const _IS_ELECTRON = IS_ELECTRON;

/**
 * Electron 环境下自动禁用的配置项（与 DeepSeek++ 扩展功能重叠）
 * 这些功能由 DeepSeek++ 扩展提供，JS 脚本不需要重复启用
 */
const ELECTRON_DISABLED_KEYS = IS_ELECTRON ? [
    'agentSystemEnabled',
    'agentMemoryEnabled',
    'agentToolsEnabled',
    'agentLoopEnabled',
    'promptInjectEnabled',
    'webToolsEnabled',
    'webSearchEnabled',
    'webFetchEnabled',
    'mcpEnabled',
    'skillEnabled',
    'skillSidebarEnabled',
    'presetsEnabled',
    'scenariosEnabled',
    'projectEnabled',
    'pythonSandboxEnabled',
    'automationEnabled',
    'syncEnabled',
    'multimodalEnabled',
    'memoryImportEnabled',
    'artifactsExportEnabled',
    'petEnabled',
    'usageStatsEnabled',
    'tokenSpeedEnabled',
    'loopEngineEnabled',
    'personaSelected',
    'workflowSelected',
] : [];

/** 默认配置（部分项按环境差异化） */
export const DEFAULTS = {
    // 脚本总开关：关闭后仅保留设置面板入口，不执行任何功能增强
    scriptEnabled: true,
    sakuraEnabled: true,
    imageRenderEnabled: true,
    // 隐私类默认值按环境区分：
    //   WebView 端默认关闭（UI 隐藏，避免对非 DeepSeek 域名的影响）
    //   篡改猴版默认开启（UI 可见，用户可自行关闭）
    autoRedirectEnabled: !_IS_WEBVIEW,
    titleFakerEnabled: !_IS_WEBVIEW,
    themeColor: 'border',
    // 字体自定义开关：关闭时即使填了 fontFamily/fontUrl 也不应用
    fontCustomEnabled: true,
    // 聊天背景开关：关闭时即使填了 bgImage 也不应用
    bgImageEnabled: true,
    // 窄边距：两端均默认开启（WebView 端 UI 隐藏，篡改猴版 UI 可见可改）
    narrowPaddingEnabled: true,
    citationCleanEnabled: true,
    strikethroughEnabled: true,
    antiRecallEnabled: true,
    mermaidEnabled: true,
    autoRetryEnabled: true,
    defaultModeEnabled: false,
    defaultMode: 'default',
    removeForwardEnabled: true,
    removeDownloadAppEnabled: true,
    placeholderTextEnabled: true,
    placeholderText: '说点什么吧～',
    // 导出功能
    // Token 速度指示器
    tokenSpeedEnabled: false,
    // 使用量统计
    usageStatsEnabled: false,
    // 消息内联导出
    inlineExportEnabled: true,
    // 历史标签搜索
    historyTagsEnabled: true,
    // 右键场景模板
    contextMenuEnabled: true,
    // 预设系统总开关：关闭后不注入任何激活的预设内容
    presetsEnabled: true,
    // 技能系统总开关：关闭后 /命令 不触发技能
    skillEnabled: true,
    // 技能侧边栏：在输入框输入 / 时，与预设菜单并列显示技能列表
    skillSidebarEnabled: true,
    // 场景模板总开关：关闭后场景列表不加载（右键菜单也不显示场景项）
    scenariosEnabled: true,
    // Agent 系统（总开关：启用后 AI 可主动调用工具、记忆、循环）
    agentSystemEnabled: false,
    // 子模块开关（大模块，总开关 ON 时默认全部 ON，用户也可单独控制）
    // 1. 记忆模块：自动注入相关记忆到 prompt + 记忆管理面板
    agentMemoryEnabled: false,
    memoryAutoArchive: true,   // 启动时自动归档 90 天未访问且访问次数<3 的记忆
    // 2. 工具调用模块：注入 [能力] 提示词，教会 AI 调用工具（memory_save 等 XML 标签）并执行
    agentToolsEnabled: false,
    // 3. Agent 循环模块：工具调用执行后将结果回传给 DeepSeek，形成 Agent 循环（依赖 agentToolsEnabled）
    agentLoopEnabled: false,

    // 系统提示词注入
    promptInjectEnabled: false,
    promptText: '',
    // 隐私保护（敏感词替换）
    privacyShieldEnabled: false,
    sensitiveWords: {},
    caseSensitive: false,
    // 行内代码点击复制
    copyCodeEnabled: true,
    // 文件夹管理（侧边栏嵌入）
    folderPanelEnabled: true,
    // 循环引擎
    loopEngineEnabled: false,
    loopNotifyEnabled: true,
    loopCrashRecoveryEnabled: true,
    loopDriftEnabled: true,           // 漂移防护：达到轮次上限时软暂停
    loopUnattended: false,            // 无人值守模式（允许后台标签页运行）
    loopMaxRounds: 20,                // 默认最大轮次
    loopPosture: 'standard',          // 思考姿态：standard | evolving | extended
    loopPayloadMode: 'loop',          // 任务模式：loop | think | roadmap
    // 人格系统
    personaSelected: ['none'],        // 当前选中的人格 ID 列表（数组支持委员会）
    personaPerTask: false,            // 每步注入人格（每条循环命令都附带人格指令）
    // 工作流
    workflowSelected: 'none',         // 当前选中的工作流 ID
    workflowAutoAdvance: true,        // 自动推进到下一阶段
    workflowPauseBetween: false,      // 步间暂停（每阶段完成后暂停等待用户）
    // 项目元数据（用于交接报告）
    projectName: '',
    projectSlug: '',
    titleList: [
        "存在主义危机应对草案",
        "薛定谔的猫当前观测状态",
        "时间管理相对论推导过程",
        "熵增对抗委员会第1024次会议纪要",
        "宇宙终极答案的42号补丁",
        "摸鱼能量守恒定律验证报告",
        "本日精神熵值可视化图表",
        "神经网络的午睡梦话记录",
        "反内卷联盟行动纲领（草稿）",
        "昨日之我与今日之我的函数映射",
        "会议室空气成分分析月度总结",
        "拖延症优先级排序算法优化",
        "人类早期驯服野生键盘珍贵影像",
        "睡眠债利息计算模型",
        "代码屎山生态多样性调查报告"
    ],
    presets: [],
    fontFamily: '',
    fontUrl: '',
    bgImage: '',
    bgOpacity: 0.5,
    messageHistory: [],

    // === Phase 6 新增：Agent 能力增强 ===
    webToolsEnabled: true,        // Web 工具总开关（web_search + web_fetch）
    webSearchEnabled: true,       // web_search 工具开关
    webFetchEnabled: true,        // web_fetch 工具开关
    webFetchAllowedSites: [],     // web_fetch 站点白名单
    webFetchMaxLength: 8000,      // web_fetch 文本截断长度
    mcpEnabled: false,            // MCP 协议客户端总开关
    mcpPromptBudget: 10,          // 每服务投影到 prompt 的工具数预算
    mcpCallTimeout: 60000,        // MCP 工具调用超时（毫秒）
    mcpResultMaxBytes: 102400,    // MCP 工具结果大小上限（字节，100KB）

    // === Phase 6 新增：工作台组织与 UX ===
    // WebView 端默认关闭工作台/UX/制品导出（UI 隐藏且功能关闭），篡改猴版保留原默认值
    projectEnabled: false,        // 项目管理工作台开关（两端均默认关闭）
    language: 'auto',             // 界面语言（auto/zh-CN/en）
    petEnabled: false,            // 桌面宠物开关（两端均默认关闭）
    artifactsExportEnabled: !_IS_WEBVIEW, // 制品导出开关（WebView 关闭，篡改猴版开启）

    // === Phase 6 新增：数据与自动化 ===
    memoryImportEnabled: true,    // 记忆导入开关
    syncEnabled: false,           // 数据同步（WebDAV）开关
    automationEnabled: false,     // 自动化调度开关

    // === Phase 6 新增：高级能力 ===
    multimodalEnabled: false,     // 多模态分析开关
    pythonSandboxEnabled: false,  // Python 沙箱开关
    magicWandEnabled: true,         // 魔法棒：侧边栏控制面板 + 悬浮图标 + 点击切换 UI 效果
    timeInjectEnabled: true,        // 时间注入：在每次对话中注入当前日期时间，让 AI 感知时间

    // === 代码块折叠 ===
    codeFoldEnabled: true,          // 代码块折叠总开关
    codeFoldThreshold: 20,          // 自动折叠阈值（行数，0 = 禁用自动折叠）
    codeFoldPreviewLines: 0,        // 折叠预览行数（0 = 完全隐藏）

    // === 表格优化导出 ===
    tableExportEnabled: true,       // 表格导出总开关（悬停PNG/CSV按钮）
    tableThemeMode: 'auto',         // 表格主题：auto(透明叠加) | dual(双模式浅色/深色)
    tableWidthMode: 'equal',        // 表格列宽策略：equal(均分) | auto(自适应) | equal-minwidth(均分+最小宽度保护)

    // === AI思考过程自动折叠 ===
    thinkFoldEnabled: true,         // 自动折叠思考区域总开关
    thinkFoldSimulateClick: true    // 模拟点击折叠（保持原生交互，推荐）
};

/**
 * 设置面板短 ID → 实际 CONFIG 键名映射
 * 用于 checkbox 的 id 与配置键之间的正确对应
 */
export const OPTION_CONFIG_KEYS = {
    script: 'scriptEnabled',
    sakura: 'sakuraEnabled',
    fontCustom: 'fontCustomEnabled',
    bgImage: 'bgImageEnabled',
    image: 'imageRenderEnabled',
    strikethrough: 'strikethroughEnabled',
    redirect: 'autoRedirectEnabled',
    title: 'titleFakerEnabled',
    narrow: 'narrowPaddingEnabled',
    citation: 'citationCleanEnabled',
    antiRecall: 'antiRecallEnabled',
    mermaid: 'mermaidEnabled',
    autoRetry: 'autoRetryEnabled',
    defaultMode: 'defaultModeEnabled',
    removeForward: 'removeForwardEnabled',
    removeDownloadApp: 'removeDownloadAppEnabled',
    placeholderText: 'placeholderTextEnabled',

    promptInject: 'promptInjectEnabled',
    privacyShield: 'privacyShieldEnabled',
    caseSensitive: 'caseSensitive',
    copyCode: 'copyCodeEnabled',
    folderPanel: 'folderPanelEnabled',
    loopEngine: 'loopEngineEnabled',
    loopNotify: 'loopNotifyEnabled',
    loopCrashRecovery: 'loopCrashRecoveryEnabled',
    loopDrift: 'loopDriftEnabled',
    loopUnattended: 'loopUnattended',
    personaPerTask: 'personaPerTask',
    workflowAutoAdvance: 'workflowAutoAdvance',
    workflowPauseBetween: 'workflowPauseBetween',
    tokenSpeed: 'tokenSpeedEnabled',
    usageStats: 'usageStatsEnabled',
    inlineExport: 'inlineExportEnabled',
    historyTags: 'historyTagsEnabled',
    contextMenu: 'contextMenuEnabled',
    // 大模块总开关
    presets: 'presetsEnabled',
    skill: 'skillEnabled',
    skillSidebar: 'skillSidebarEnabled',
    scenarios: 'scenariosEnabled',
    // Agent 系统：1 个总开关 + 3 个大模块子开关
    agentSystem: 'agentSystemEnabled',
    agentMemory: 'agentMemoryEnabled',
    agentTools: 'agentToolsEnabled',
    agentLoop: 'agentLoopEnabled',

    // Phase 6 新增模块开关（language 为 select 不在此映射中，单独处理）
    webTools: 'webToolsEnabled',
    webSearch: 'webSearchEnabled',
    webFetch: 'webFetchEnabled',
    mcp: 'mcpEnabled',
    project: 'projectEnabled',
    pet: 'petEnabled',
    artifactsExport: 'artifactsExportEnabled',
    memoryImport: 'memoryImportEnabled',
    sync: 'syncEnabled',
    automationModule: 'automationEnabled',
    multimodal: 'multimodalEnabled',
    pythonSandbox: 'pythonSandboxEnabled',
    timeInject: 'timeInjectEnabled',
    magicWand: 'magicWandEnabled',
    codeFold: 'codeFoldEnabled',
    tableExport: 'tableExportEnabled',
    thinkFold: 'thinkFoldEnabled'
};

// ============================================================
// 存储层：内存缓存 + 防抖异步写入
// ============================================================

const STORAGE_KEY = 'ds_enhance_config';
const WRITE_DEBOUNCE_MS = 250;

/** 内存缓存的配置对象 */
let _cachedConfig = null;
/** 缓存是否脏（需要从 localStorage 重新读取） */
let _cacheDirty = true;
/** 防抖写入的定时器句柄 */
let _writeTimer = null;
/** 待写入的配置快照（null 表示无待写入） */
let _pendingConfig = null;

/**
 * 从 localStorage 加载配置，合并默认值（带内存缓存）
 * @returns {Object} 合并后的配置对象
 */
export function loadConfig() {
    if (!_cacheDirty && _cachedConfig) {
        // 返回浅拷贝，避免外部修改影响内部缓存状态（后续 saveConfig 会同步更新缓存）
        return { ..._cachedConfig };
    }
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        _cachedConfig = raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
    } catch (e) {
        _cachedConfig = { ...DEFAULTS };
    }
    // Electron 桌面端：强制关闭与 DeepSeek++ 扩展重叠的功能
    if (_IS_ELECTRON && ELECTRON_DISABLED_KEYS.length > 0) {
        for (const key of ELECTRON_DISABLED_KEYS) {
            _cachedConfig[key] = key === 'personaSelected' ? ['none'] : (key === 'workflowSelected' ? 'none' : false);
        }
    }
    _cacheDirty = false;
    return { ..._cachedConfig };
}

/**
 * 立即将待写入的配置 flush 到 localStorage
 * 页面卸载前或需要确保持久化时调用
 */
export function flushConfig() {
    if (_writeTimer) {
        clearTimeout(_writeTimer);
        _writeTimer = null;
    }
    if (_pendingConfig !== null) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(_pendingConfig));
        } catch (e) {}
        _pendingConfig = null;
    }
}

/**
 * 防抖异步写入：将配置快照暂存并延迟写入 localStorage
 * 多次连续调用会合并为一次实际的 setItem
 * @param {Object} config - 配置对象
 */
function scheduleWrite(config) {
    _pendingConfig = config;
    if (_writeTimer) return;
    _writeTimer = setTimeout(() => {
        _writeTimer = null;
        const cfg = _pendingConfig;
        _pendingConfig = null;
        if (cfg === null) return;
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
        } catch (e) {}
    }, WRITE_DEBOUNCE_MS);
}

/**
 * 保存配置到 localStorage（防抖异步）
 * 同时更新内存缓存与 CONFIG 引用，确保其他模块立即看到最新值
 * @param {Object} config - 配置对象
 */
export function saveConfig(config) {
    if (!config) return;
    // 立即更新内存缓存与 CONFIG 引用（其他模块通过 CONFIG 直接读取）
    _cachedConfig = { ...config };
    _cacheDirty = false;
    CONFIG = _cachedConfig;
    // 同步到 window.__dsConfig，供需要动态读取最新配置的模块使用
    if (typeof window !== 'undefined') window.__dsConfig = CONFIG;
    // 触发防抖写入
    scheduleWrite(_cachedConfig);
}

/** 全局配置对象（可变，其他模块直接引用） */
export let CONFIG = loadConfig();

/**
 * 重新加载配置（从 localStorage 强制刷新到 CONFIG）
 * 通常用于多标签页同步等场景；正常读取直接用 CONFIG 即可
 */
export function reloadConfig() {
    _cacheDirty = true;
    const cfg = loadConfig();
    CONFIG = cfg;
    _cachedConfig = cfg;
    if (typeof window !== 'undefined') window.__dsConfig = CONFIG;
    return CONFIG;
}

// 页面卸载前 flush 待写入的数据，避免丢失
if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', flushConfig);
}
