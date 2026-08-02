package com.dspro.client.shared

/**
 * DeepSeek 客户端全局配置。
 *
 * 集中管理目标 URL、窗口尺寸等常量，供 Android 与 Desktop 两端共享，
 * 避免在多个平台重复定义。
 */
object DeepSeekConfig {

    /** 应用启动后直接打开的目标地址，无任何中间页面或按钮。 */
    const val TARGET_URL: String = "https://chat.deepseek.com/"

    /** 内置增强脚本在 classpath 中的资源路径。 */
    const val SCRIPT_RESOURCE_PATH: String = "dspro.js"

    /** Desktop 窗口默认宽度（像素）。 */
    const val DESKTOP_WINDOW_WIDTH: Double = 1200.0

    /** Desktop 窗口默认高度（像素）。 */
    const val DESKTOP_WINDOW_HEIGHT: Double = 820.0

    /** Desktop 窗口最小宽度（像素）。 */
    const val DESKTOP_MIN_WIDTH: Double = 480.0

    /** Desktop 窗口最小高度（像素）。 */
    const val DESKTOP_MIN_HEIGHT: Double = 540.0

    /** 应用显示名称。 */
    const val APP_TITLE: String = "DeepSeek"
}
