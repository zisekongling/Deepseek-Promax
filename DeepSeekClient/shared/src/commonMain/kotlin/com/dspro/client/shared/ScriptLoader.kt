package com.dspro.client.shared

/**
 * 脚本加载器，跨平台读取内置 dspro.js 资源内容。
 *
 * 由于 Android 与 JVM 读取 classpath 资源的 API 不同，
 * 这里通过 expect 声明，由各平台提供 actual 实现。
 */
expect object ScriptLoader {

    /**
     * 从 classpath 读取 dspro.js 全部内容并返回字符串。
     *
     * @return 脚本文本；若读取失败返回空字符串，避免注入时抛出异常。
     */
    fun loadScript(): String

    /**
     * 从 classpath 读取 dspro.early-boot.js（WebView 早注入 stub）全部内容。
     *
     * 该脚本仅安装 fetch/XHR/redirect hook，无 UI 依赖，
     * 供宿主在 onPageStarted 阶段提前注入，确保 document-start 类功能生效。
     *
     * @return 脚本文本；若读取失败返回空字符串，避免注入时抛出异常。
     */
    fun loadEarlyBootScript(): String

    /**
     * 从 classpath 读取 dspro.mobile.js（Android 移动端专属脚本）全部内容。
     *
     * 该脚本针对移动端优化：触屏适配、长按菜单、性能优化默认配置、
     * 原生桥接预热。供 Android 宿主在 onPageFinished 阶段注入。
     *
     * @return 脚本文本；若读取失败返回空字符串，避免注入时抛出异常。
     */
    fun loadMobileScript(): String
}
