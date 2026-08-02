package com.dspro.client.shared

import java.io.InputStream

/**
 * JVM（Desktop）平台脚本加载实现。
 *
 * 通过当前线程的 ContextClassLoader 读取打包进 JAR 的 resources/dspro.js。
 */
actual object ScriptLoader {

    /**
     * 读取 dspro.js 资源内容。
     *
     * @return 脚本文本；读取异常时返回空字符串。
     */
    actual fun loadScript(): String {
        return try {
            val stream: InputStream? = Thread.currentThread().contextClassLoader
                ?.getResourceAsStream(DeepSeekConfig.SCRIPT_RESOURCE_PATH)
            stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() } ?: ""
        } catch (e: Throwable) {
            // 读取失败时返回空串，调用方按空脚本处理，避免注入崩溃
            ""
        }
    }
}
