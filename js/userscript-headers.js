/**
 * Tampermonkey 油猴脚本头部元数据
 *
 * 此文件定义 ==UserScript== 块中的所有元数据字段，
 * webpack 构建时会通过 BannerPlugin 将其插入到输出文件顶部。
 */
module.exports = {
    name: 'DeepSeek promax',
    namespace: 'https://github.com/zisekongling/deepseek-',
    version: '4.0.0',
    description: '多主题切换、窄边距独立控制、美化、跳转、标题伪装 + 增强角标清理 + 图片链接强化 + 删除线渲染（代码块内不渲染）+ 防撤回（XHR 拦截，流式实时美化）+ Mermaid 图表渲染（含代码/图表切换）+ 自动重试按钮（最多10次）+ 设置项帮助提示 + 消息预设菜单（/触发） + 上下键历史切换 + 自定义字体 + 聊天背景 | Vibe Coding with AI',
    author: 'zisekongling',
    match: [
        '*://*.deepseek.com/*'
    ],
    icon: 'https://www.deepseek.com/favicon.ico',
    grant: 'none',
    license: 'GPL-3.0',
    'run-at': 'document-start'
};
