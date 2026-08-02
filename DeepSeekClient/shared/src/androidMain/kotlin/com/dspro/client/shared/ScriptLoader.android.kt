package com.dspro.client.shared

import android.content.Context

/**
 * Android 平台脚本加载实现。
 *
 * 通过全局 [AndroidContext] 获取 AssetManager，读取打包进 APK assets 的 dspro.js。
 * 需要先调用 [AndroidContext.init] 注入 Context。
 */
actual object ScriptLoader {

    /**
     * 读取 dspro.js 资源内容。
     *
     * @return 脚本文本；Context 未注入或读取异常时返回空串，避免注入崩溃。
     */
    actual fun loadScript(): String {
        return try {
            val context: Context? = AndroidContext.get()
            context?.assets?.open(DeepSeekConfig.SCRIPT_RESOURCE_PATH)?.use { stream ->
                stream.bufferedReader(Charsets.UTF_8).readText()
            } ?: ""
        } catch (e: Throwable) {
            // 读取失败时返回空串，调用方按空脚本处理
            ""
        }
    }
}
