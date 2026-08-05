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

    /**
     * 读取 dspro.early-boot.js（早注入 stub）资源内容。
     *
     * @return 脚本文本；Context 未注入或读取异常时返回空串，避免注入崩溃。
     */
    actual fun loadEarlyBootScript(): String {
        return try {
            val context: Context? = AndroidContext.get()
            context?.assets?.open(DeepSeekConfig.EARLY_BOOT_SCRIPT_RESOURCE_PATH)?.use { stream ->
                stream.bufferedReader(Charsets.UTF_8).readText()
            } ?: ""
        } catch (e: Throwable) {
            // 读取失败时返回空串，调用方按空脚本处理
            ""
        }
    }

    /**
     * 读取 dspro.mobile.js（移动端专属脚本）资源内容。
     *
     * 该脚本针对 Android WebView 移动端优化：触屏适配、长按菜单、
     * 性能优化默认配置、原生桥接预热。由 MainActivity 在 onPageFinished 注入。
     *
     * 若移动端脚本读取失败，回退到通用 dspro.js 脚本。
     *
     * @return 脚本文本；Context 未注入或读取异常时返回空串，避免注入崩溃。
     */
    actual fun loadMobileScript(): String {
        return try {
            val context: Context? = AndroidContext.get()
            context?.assets?.open(DeepSeekConfig.MOBILE_SCRIPT_RESOURCE_PATH)?.use { stream ->
                stream.bufferedReader(Charsets.UTF_8).readText()
            } ?: loadScript()  // 回退到通用脚本
        } catch (e: Throwable) {
            // 读取失败时回退到通用脚本
            loadScript()
        }
    }
}
