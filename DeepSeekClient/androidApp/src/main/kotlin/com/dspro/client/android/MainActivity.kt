package com.dspro.client.android

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.WindowInsets
import android.view.WindowManager
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import com.dspro.client.shared.AndroidContext
import com.dspro.client.shared.DeepSeekConfig
import com.dspro.client.shared.ScriptLoader

/**
 * 应用唯一 Activity。
 *
 * 启动后直接展示一个全屏 WebView 加载 chat.deepseek.com，
 * 不提供任何原生按钮或菜单；页面加载完成后注入内置 dspro.js 增强脚本。
 */
class MainActivity : Activity() {

    private lateinit var webView: WebView

    /** 文件选择请求码，用于 onActivityResult 配对 */
    private val fileChooserRequestCode = 10001

    /** WebView 上传 <input type="file"> 时的回调句柄，结束时必须调用以解锁 input 元素 */
    private var filePathCallback: ValueCallback<Array<Uri>>? = null

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // 注入 Application Context，供 shared 模块读取 assets 中的 dspro.js
        AndroidContext.init(applicationContext)

        // 沉浸式边到边布局，让 WebView 占据整个屏幕（含状态栏与导航栏区域）
        window.decorView.systemUiVisibility = (
            View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
        )
        window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS)
        window.statusBarColor = Color.TRANSPARENT
        window.navigationBarColor = Color.TRANSPARENT

        webView = WebView(this).apply {
            // 开启 JS 与 DOM 存储，DeepSeek 网页正常运行所必需
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.databaseEnabled = true
            // 允许文件上传下载等基础能力
            settings.allowFileAccess = true
            settings.allowContentAccess = true
            // 视口与缩放
            settings.useWideViewPort = true
            settings.loadWithOverviewMode = true
            settings.builtInZoomControls = false
            settings.displayZoomControls = false
            // 媒体自动播放（部分场景需要）
            settings.mediaPlaybackRequiresUserGesture = false
            // 混合内容加载（https 页面中的 http 资源）
            settings.mixedContentMode =
                android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW
            // 标识自定义 UA，便于站点识别客户端
            settings.userAgentString =
                settings.userAgentString.replace("; wv", "; DeepSeekClient")

            webViewClient = DeepSeekWebViewClient()
            webChromeClient = DeepSeekWebChromeClient()

            // 监听系统窗口 insets，给 WebView 底部预留系统导航栏高度
            // 让 DeepSeek 网页底部输入栏避开 Android 系统导航栏（手势条/虚拟按键）区域
            // 使用 navigationBars()（API 30+）或 stableInsetBottom（API 30-）
            // 避免 adjustResize 模式下软键盘弹出时 padding 叠加 IME 高度
            setOnApplyWindowInsetsListener { v, insets ->
                val bottom = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    insets.getInsets(WindowInsets.Type.navigationBars()).bottom
                } else {
                    insets.stableInsetBottom
                }
                v.setPadding(0, 0, 0, bottom)
                insets
            }
        }

        setContentView(webView)
        webView.loadUrl(DeepSeekConfig.TARGET_URL)
    }

    /**
     * 自定义 WebChromeClient：
     * - 实现 onShowFileChooser 以支持 <input type="file"> 文件上传
     */
    private inner class DeepSeekWebChromeClient : WebChromeClient() {

        /**
         * 当网页触发文件选择时回调。
         * 通过 ACTION_GET_CONTENT 启动系统文件选择器，等待 onActivityResult 返回结果。
         */
        override fun onShowFileChooser(
            webView: WebView?,
            filePathCallback: ValueCallback<Array<Uri>>?,
            fileChooserParams: FileChooserParams?
        ): Boolean {
            // 先取消上一次未完成的回调，避免内存泄漏或回调错乱
            this@MainActivity.filePathCallback?.onReceiveValue(null)
            this@MainActivity.filePathCallback = filePathCallback

            // 构造文件选择 Intent，允许选择任意类型文件
            val intent = Intent(Intent.ACTION_GET_CONTENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                type = "*/*"
                // 支持多选，DeepSeek 网页可能一次性选择多张图片
                putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
            }

            return try {
                @Suppress("DEPRECATION")
                startActivityForResult(intent, fileChooserRequestCode)
                true
            } catch (e: Exception) {
                // 无可用 Activity 处理选择请求时，回调失败并提示
                this@MainActivity.filePathCallback = null
                Toast.makeText(this@MainActivity, "未找到可用的文件选择器", Toast.LENGTH_SHORT).show()
                false
            }
        }
    }

    /**
     * 自定义 WebViewClient：
     * - 限制仅 deepseek.com 域内跳转在 WebView 内完成
     * - 页面加载完成后注入 dspro.js
     */
    private inner class DeepSeekWebViewClient : WebViewClient() {

        override fun shouldOverrideUrlLoading(
            view: WebView,
            request: WebResourceRequest
        ): Boolean {
            val host: String = request.url.host ?: return false
            // 非 deepseek.com 域名交给系统浏览器打开
            return !host.endsWith("deepseek.com")
        }

        override fun onPageFinished(view: WebView, url: String) {
            super.onPageFinished(view, url)
            // 注入内置增强脚本；读取失败时跳过
            val script: String = ScriptLoader.loadScript()
            if (script.isNotEmpty()) {
                view.evaluateJavascript(script, null)
            }
        }
    }

    /**
     * 文件选择结果回调：将所选 Uri 数组回传给 WebView，完成上传流程。
     */
    @Deprecated("Deprecated in Java", ReplaceWith("registerForActivityResult"))
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode != fileChooserRequestCode) {
            super.onActivityResult(requestCode, resultCode, data)
            return
        }
        val callback = filePathCallback
        filePathCallback = null
        val uris: Array<Uri>? = when {
            resultCode != Activity.RESULT_OK -> null
            data?.data != null -> arrayOf(data.data!!)
            data?.clipData != null -> {
                val list = mutableListOf<Uri>()
                val clip = data.clipData!!
                for (i in 0 until clip.itemCount) {
                    list.add(clip.getItemAt(i).uri)
                }
                list.toTypedArray()
            }
            else -> null
        }
        callback?.onReceiveValue(uris)
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        // 优先在 WebView 内回退历史，无历史时退出应用
        if (this::webView.isInitialized && webView.canGoBack()) {
            webView.goBack()
        } else {
            @Suppress("DEPRECATION")
            super.onBackPressed()
        }
    }

    override fun onDestroy() {
        // 清理未完成的文件选择回调
        filePathCallback?.onReceiveValue(null)
        filePathCallback = null
        if (this::webView.isInitialized) {
            webView.destroy()
        }
        super.onDestroy()
    }
}
