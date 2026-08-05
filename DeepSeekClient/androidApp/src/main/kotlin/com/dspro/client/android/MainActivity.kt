package com.dspro.client.android

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.WindowInsets
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
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

    /** 输入法输入预览栏，键盘弹出时显示在键盘上方，镜像 DeepSeek 输入框内容 */
    private lateinit var previewBar: IMEPreviewBar

    /** 文件选择请求码，用于 onActivityResult 配对 */
    private val fileChooserRequestCode = 10001

    /** WebView 上传 <input type="file"> 时的回调句柄，结束时必须调用以解锁 input 元素 */
    private var filePathCallback: ValueCallback<Array<Uri>>? = null

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // 注入 Application Context，供 shared 模块读取 assets 中的 dspro.js
        AndroidContext.init(applicationContext)

        // 开启 WebView 调试模式：允许通过 chrome://inspect 远程调试页面与注入脚本，
        // 便于开发期排查 DeepSeek 网页与 dspro.js 注入逻辑。Release 包同样保留以便线上诊断。
        WebView.setWebContentsDebuggingEnabled(true)

        // 沉浸式全屏：同时隐藏状态栏与导航栏，通过 IMMERSIVE_STICKY 使其在用户
        // 从屏幕边缘滑动时短暂半透明出现后自动隐藏，实现真正的全屏沉浸体验
        window.decorView.systemUiVisibility = (
            View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_FULLSCREEN
                or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
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

            // 注入 JS 桥接对象，用于网页输入框内容变化时回调原生更新预览栏
            addJavascriptInterface(IMEBridge(), "AndroidIME")
            // 注入原生能力桥接对象 window.AndroidBridge，供 dspro.js 的 platform/bridge.js
            // 调用 Toast/震动/剪贴板/分享/文件/HTTP/通知/更新/全屏 等原生能力
            addJavascriptInterface(DsBridge(this@MainActivity, this), "AndroidBridge")
        }

        // 用 FrameLayout 作为根容器，WebView 填满，预览浮层叠加其上
        val rootLayout = FrameLayout(this).apply {
            addView(
                webView,
                FrameLayout.LayoutParams(
                    FrameLayout.LayoutParams.MATCH_PARENT,
                    FrameLayout.LayoutParams.MATCH_PARENT
                )
            )
        }
        previewBar = IMEPreviewBar(this).also { it.attachTo(rootLayout) }

        // 监听系统窗口 insets：
        // - 导航栏高度作为 WebView 底部 padding（避免内容被手势条遮挡）
        // - IME 高度驱动预览浮层定位（键盘弹出时浮层上移到键盘上方）
        // API 30+ 使用 WindowInsets.Type 精确区分 navigationBars 与 ime；
        // API 30- 通过 systemWindowInsetBottom 与 stableInsetBottom 差值判断 IME
        webView.setOnApplyWindowInsetsListener { v, insets ->
            val navBars: Int
            val ime: Int
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                navBars = insets.getInsets(WindowInsets.Type.navigationBars()).bottom
                ime = insets.getInsets(WindowInsets.Type.ime()).bottom
            } else {
                navBars = insets.stableInsetBottom
                val sysBottom = insets.systemWindowInsetBottom
                // IME 弹出时 systemWindowInsetBottom 会大于 stableInsetBottom（导航栏高度）
                ime = if (sysBottom > navBars) sysBottom else 0
            }
            v.setPadding(0, 0, 0, navBars)
            previewBar.onImeHeightChanged(ime)
            insets
        }

        setContentView(rootLayout)
        webView.loadUrl(DeepSeekConfig.TARGET_URL)
    }

    /**
     * JS 桥接对象，供网页通过 window.AndroidIME 回调原生。
     *
     * 网页端注入的监听脚本会在 DeepSeek 输入框触发 input/blur 事件时调用
     * onInputChanged，将当前输入框内容（含输入法 composing 文本）传回原生，
     * 原生据此更新预览浮层显示。
     */
    private inner class IMEBridge {
        @JavascriptInterface
        fun onInputChanged(text: String) {
            runOnUiThread { previewBar.setText(text) }
        }
    }

    companion object {
        /**
         * 注入到网页的输入预览监听脚本。
         *
         * 在 document 上以捕获阶段监听 input 与 blur 事件，兼容 textarea、input
         * 及 contenteditable 三类输入控件；composing 过程中的 input 事件同样会被
         * 捕获，从而实时镜像输入法正在输入的内容。通过 window.__imePreviewInstalled
         * 标记防止重复注入。
         */
        private const val IME_PREVIEW_JS = """
(function(){
    if(window.__imePreviewInstalled) return;
    window.__imePreviewInstalled=true;
    function getText(t){
        if(t.tagName==='TEXTAREA'||t.tagName==='INPUT') return t.value;
        if(t.isContentEditable) return t.innerText||t.textContent||'';
        return null;
    }
    document.addEventListener('input', function(e){
        var t=e.target; if(!t) return;
        var text=getText(t); if(text===null) return;
        if(window.AndroidIME&&window.AndroidIME.onInputChanged) window.AndroidIME.onInputChanged(text);
    }, true);
    document.addEventListener('blur', function(e){
        var t=e.target; if(!t) return;
        if(getText(t)===null) return;
        if(window.AndroidIME&&window.AndroidIME.onInputChanged) window.AndroidIME.onInputChanged('');
    }, true);
})();
        """
    }

    /**
     * 窗口获得焦点时重新应用沉浸式 flags。
     *
     * 系统在弹出文件选择器、权限对话框、软键盘等操作后会重置 systemUiVisibility，
     * 因此在窗口重新获得焦点时需要再次应用，确保状态栏与导航栏始终保持隐藏。
     */
    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) {
            window.decorView.systemUiVisibility = (
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                    or View.SYSTEM_UI_FLAG_FULLSCREEN
                    or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
            )
        }
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
     * - 页面开始加载时（onPageStarted）提前注入 early-boot stub，安装 fetch/XHR/redirect hook
     * - 页面加载完成后（onPageFinished）注入主脚本 dspro.js
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

        override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
            super.onPageStarted(view, url, favicon)
            // 提前注入 early-boot stub：在页面业务脚本加载前安装 fetch/XHR/redirect hook，
            // 确保 Agent 请求拦截、防撤回、跳转等 document-start 类功能在 WebView 环境下生效。
            // early-boot 内部通过 window.__dsEarlyBootDone 保证幂等，刷新时不会重复安装。
            val earlyBoot: String = ScriptLoader.loadEarlyBootScript()
            if (earlyBoot.isNotEmpty()) {
                view?.evaluateJavascript(earlyBoot, null)
            }
        }

        override fun onPageFinished(view: WebView, url: String) {
            super.onPageFinished(view, url)
            // 注入移动端专属脚本；读取失败时回退到通用 dspro.js
            // 移动端脚本会检测 __dsEarlyBootDone 跳过 hook 重复安装
            val script: String = ScriptLoader.loadMobileScript()
            if (script.isNotEmpty()) {
                view.evaluateJavascript(script, null)
            }
            // 注入输入预览监听脚本，监听 DeepSeek 输入框内容变化并回调原生预览栏
            view.evaluateJavascript(IME_PREVIEW_JS, null)
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
