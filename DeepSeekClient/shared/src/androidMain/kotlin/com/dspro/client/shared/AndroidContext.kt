package com.dspro.client.shared

import android.content.Context

/**
 * Android 平台全局 Context 持有者。
 *
 * 由 androidApp 在启动时注入 Application Context，
 * 供 shared 模块中需要访问 Android 系统服务（如 AssetManager）的代码使用。
 */
object AndroidContext {

    @Volatile
    private var appContext: Context? = null

    /**
     * 初始化全局 Context，应在 Application 或 Activity 启动时调用。
     *
     * @param context Application 级别的 Context
     */
    fun init(context: Context) {
        appContext = context.applicationContext
    }

    /**
     * 获取已注入的 Application Context。
     *
     * @return Application Context；未初始化时返回 null
     */
    fun get(): Context? = appContext
}
