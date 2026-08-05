package com.dspro.client.android

import android.annotation.SuppressLint
import android.app.Activity
import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import java.io.File

/**
 * 全屏 HTML 预览 Activity。
 *
 * 从 DsBridge.openHtmlViewer 通过 Intent 启动，接收 HTML 文件路径，
 * 用 WebView 加载并展示。提供顶部工具栏（标题 + 关闭按钮），
 * 点击关闭按钮或系统返回键均可退出。
 *
 * Intent extras:
 *   - html_file_path (String): 临时 HTML 文件的绝对路径
 */
class HtmlViewerActivity : Activity() {

    private lateinit var webView: WebView
    private var htmlFilePath: String = ""

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // 从 Intent 获取 HTML 文件路径
        htmlFilePath = intent.getStringExtra("html_file_path") ?: ""

        // 沉浸式全屏
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

        // 创建 WebView
        webView = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.allowFileAccess = true
            settings.allowContentAccess = true
            settings.useWideViewPort = true
            settings.loadWithOverviewMode = true
            settings.builtInZoomControls = true
            settings.displayZoomControls = false
            settings.mediaPlaybackRequiresUserGesture = false
            // 允许混合内容（file:// 加载 http 资源）
            settings.mixedContentMode =
                android.webkit.WebSettings.MIXED_CONTENT_ALWAYS_ALLOW

            webViewClient = WebViewClient()
            webChromeClient = WebChromeClient()
        }

        // 根布局：FrameLayout（WebView 全屏 + 顶部工具栏浮层）
        val rootLayout = FrameLayout(this).apply {
            layoutParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
            setBackgroundColor(Color.WHITE)
        }

        // WebView 填满全屏
        rootLayout.addView(
            webView,
            FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        )

        // 顶部工具栏（半透明浮层）
        val toolbar = createToolbar()
        rootLayout.addView(
            toolbar,
            FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply {
                gravity = Gravity.TOP
            }
        )

        setContentView(rootLayout)

        // 加载 HTML 文件
        loadHtmlFile()
    }

    /**
     * 创建顶部工具栏：半透明背景 + 标题 + 关闭按钮
     * @return 工具栏 View
     */
    private fun createToolbar(): View {
        val toolbar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(16, 48, 16, 12)
            setBackgroundColor(Color.parseColor("#E6000000")) // 半透明黑色
            gravity = Gravity.CENTER_VERTICAL
        }

        // 标题
        val titleText = TextView(this).apply {
            text = "HTML 预览"
            textSize = 16f
            setTextColor(Color.WHITE)
            layoutParams = LinearLayout.LayoutParams(
                0,
                ViewGroup.LayoutParams.WRAP_CONTENT,
                1f
            )
        }
        toolbar.addView(titleText)

        // 关闭按钮（用 TextView 实现 ✕ 图标）
        val closeText = TextView(this).apply {
            text = "✕"
            textSize = 22f
            setTextColor(Color.WHITE)
            setPadding(16, 4, 4, 4)
            setOnClickListener { finish() }
        }
        toolbar.addView(closeText)

        return toolbar
    }

    /**
     * 加载 HTML 文件到 WebView
     */
    private fun loadHtmlFile() {
        if (htmlFilePath.isEmpty()) {
            webView.loadData(
                "<html><body><h2>错误：未提供 HTML 文件路径</h2></body></html>",
                "text/html",
                "UTF-8"
            )
            return
        }

        val file = File(htmlFilePath)
        if (file.exists() && file.isFile) {
            webView.loadUrl("file://$htmlFilePath")
        } else {
            webView.loadData(
                "<html><body><h2>错误：HTML 文件不存在</h2><p>$htmlFilePath</p></body></html>",
                "text/html",
                "UTF-8"
            )
        }
    }

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

    override fun onBackPressed() {
        // 如果 WebView 有历史记录则回退，否则关闭 Activity
        if (this::webView.isInitialized && webView.canGoBack()) {
            webView.goBack()
        } else {
            super.onBackPressed()
        }
    }

    override fun onDestroy() {
        if (this::webView.isInitialized) {
            webView.destroy()
        }
        // 清理临时文件
        if (htmlFilePath.isNotEmpty()) {
            try {
                val file = File(htmlFilePath)
                if (file.exists()) file.delete()
            } catch (_: Exception) {}
        }
        super.onDestroy()
    }
}