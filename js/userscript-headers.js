/**
 * Tampermonkey 油猴脚本头部元数据
 *
 * 此文件定义 ==UserScript== 块中的所有元数据字段，
 * webpack 构建时会通过 BannerPlugin 将其插入到输出文件顶部。
 */
module.exports = {
    name: 'DeepSeek promax',
    namespace: 'https://github.com/zisekongling/deepseek-',
    version: '5.0.0',
    description: '多主题切换、窄边距独立控制、美化、跳转、标题伪装 + 增强角标清理 + 图片链接强化 + 删除线渲染（代码块内不渲染）+ 防撤回（XHR 拦截，流式实时美化）+ Mermaid 图表渲染（含代码/图表切换）+ 自动重试按钮（最多10次）+ 设置项帮助提示 + 消息预设菜单（/触发） + 上下键历史切换 + 自定义字体 + 聊天背景 | Vibe Coding with AI',
    author: 'zisekongling',
    match: [
        '*://*.deepseek.com/*'
    ],
    icon: 'https://www.deepseek.com/favicon.ico',
    // 必须声明 GM_xmlhttpRequest 才能绕过同源策略发起跨域请求
    // （web_search/web_fetch 工具依赖此 API 抓取 DuckDuckGo/Bing/任意授权 URL）
    // 声明后 Tampermonkey 会注入 GM_xmlhttpRequest 全局函数，web-tools.js 据此选择通道
    // 同时声明 unsafeWindow：沙箱模式下 window 不透传写入到页面，
    // 必须用 unsafeWindow 才能让 window.fetch hook / window._dsXxx 注入对页面可见
    // webpack.config.js 的 WrapInSandboxIifePlugin 会用 IIFE 把 window 重定向到 unsafeWindow
    grant: ['GM_xmlhttpRequest', 'unsafeWindow'],
    // @connect 声明允许跨域访问的目标域名（GM_xmlhttpRequest 必需）
    // - '*' 兜底：web_fetch 工具按 CONFIG.webFetchAllowedSites 白名单授权任意 URL，
    //   首次访问未列出的域名时油猴会弹窗让用户确认（安全可控）
    // - 显式列出常用搜索源：避免每次搜索都弹窗
    connect: [
        '*',
        'html.duckduckgo.com',
        'duckduckgo.com',
        'www.bing.com',
        'bing.com'
    ],
    license: 'GPL-3.0',
    'run-at': 'document-start'
};
