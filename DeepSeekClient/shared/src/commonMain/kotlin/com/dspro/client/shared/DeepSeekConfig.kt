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

    /** WebView 早注入 stub 脚本在 classpath 中的资源路径。
     *  由宿主在 onPageStarted 阶段注入，安装 fetch/XHR/redirect hook。 */
    const val EARLY_BOOT_SCRIPT_RESOURCE_PATH: String = "dspro.early-boot.js"

    /** 移动端专属脚本在 classpath 中的资源路径。
     *  由宿主在 onPageFinished 阶段注入，针对移动端触屏/性能优化。 */
    const val MOBILE_SCRIPT_RESOURCE_PATH: String = "dspro.mobile.js"

    /** 应用当前版本号，用于更新检查比较。 */
    const val APP_VERSION: String = "1.0.0"

    /** 更新检查 URL（GitHub Releases API）；为空则跳过更新检查。 */
    const val UPDATE_CHECK_URL: String = ""

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
