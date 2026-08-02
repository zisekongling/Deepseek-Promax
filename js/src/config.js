/**
 * 配置管理模块
 *
 * 负责：
 *   - 定义默认配置 DEFAULTS
 *   - 定义短 ID → CONFIG 键名映射 OPTION_CONFIG_KEYS（用于设置面板 checkbox）
 *   - 从 localStorage 加载 / 保存配置
 *   - 导出全局可变的 CONFIG 对象（其他模块直接引用此对象）
 */

/** 默认配置 */
export const DEFAULTS = {
    sakuraEnabled: true,
    imageRenderEnabled: true,
    autoRedirectEnabled: true,
    titleFakerEnabled: true,
    themeColor: 'border',
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
    messageHistory: []
};

/**
 * 设置面板短 ID → 实际 CONFIG 键名映射
 * 用于 checkbox 的 id 与配置键之间的正确对应
 */
export const OPTION_CONFIG_KEYS = {
    sakura: 'sakuraEnabled',
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
    workflowPauseBetween: 'workflowPauseBetween'
};

/**
 * 从 localStorage 加载配置，合并默认值
 * @returns {Object} 合并后的配置对象
 */
export function loadConfig() {
    try {
        const raw = localStorage.getItem('ds_enhance_config');
        if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
    } catch (e) {}
    return { ...DEFAULTS };
}

/**
 * 保存配置到 localStorage
 * @param {Object} config - 配置对象
 */
export function saveConfig(config) {
    try {
        localStorage.setItem('ds_enhance_config', JSON.stringify(config));
    } catch (e) {}
}

/** 全局配置对象（可变，其他模块直接引用） */
export let CONFIG = loadConfig();

/**
 * 重新加载配置（从 localStorage 刷新到 CONFIG）
 */
export function reloadConfig() {
    CONFIG = loadConfig();
    return CONFIG;
}
