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
}
