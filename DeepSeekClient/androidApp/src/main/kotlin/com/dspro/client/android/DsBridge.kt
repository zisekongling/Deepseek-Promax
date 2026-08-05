package com.dspro.client.android

import android.app.Activity
import android.app.DownloadManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.ClipData
import android.content.ClipboardManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.view.View
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.widget.Toast
import com.dspro.client.shared.DeepSeekConfig
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL

/**
 * 原生桥接类，通过 addJavascriptInterface 注入 WebView 为 window.AndroidBridge。
 *
 * 暴露两个 @JavascriptInterface 入口：
 *   - invokeSync(method, argsJson) -> String   同步调用，立即返回结果
 *   - invokeAsync(method, argsJson, callbackId) 异步调用，完成后通过
 *     webView.evaluateJavascript("window._dsBridgeCallback(callbackId, success, result)") 回调
 *
 * 支持的方法（与 js/src/platform/bridge.js 的 Platform API 一一对应）：
 *   同步：getInfo / toast / vibrate / setClipboard / notify / setImmersive / exitApp
 *   异步：share / readFile / writeFile / download / http / checkUpdate / pickFile
 *
 * 线程模型：
 *   - invokeSync / invokeAsync 在 WebView 的 JS 线程被调用
 *   - 涉及 UI 的操作（Toast/沉浸式/通知）用 runOnUiThread 派发
 *   - 耗时操作（http/文件读写）在后台线程执行，避免阻塞页面
 *   - JS 回调必须通过 runOnUiThread + evaluateJavascript，evaluateJavascript 不能在非 UI 线程调用
 */
class DsBridge(private val activity: Activity, private val webView: WebView) {

    companion object {
        /** 通知渠道 ID */
        private const val NOTIFICATION_CHANNEL_ID = "dspro_bridge"
        /** 通知 ID 自增起点 */
        private var nextNotificationId = 2000
        /** 异步 HTTP 请求的连接超时（毫秒） */
        private const val HTTP_CONNECT_TIMEOUT_MS = 15000
        /** 异步 HTTP 请求的读取超时（毫秒） */
        private const val HTTP_READ_TIMEOUT_MS = 30000
    }

    /** 初始化时创建通知渠道（Android 8.0+ 强制要求） */
    init {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                NOTIFICATION_CHANNEL_ID,
                "DS Pro 桥接通知",
                NotificationManager.IMPORTANCE_DEFAULT
            ).apply { description = "DS Pro 脚本通过桥接发送的系统通知" }
            val nm = activity.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.createNotificationChannel(channel)
        }
    }

    // ============================================================
    // JS 调用入口
    // ============================================================

    /**
     * 同步调用入口：JS 侧 window.AndroidBridge.invokeSync(method, argsJson)
     * @param method 方法名
     * @param argsJson JSON 字符串参数
     * @return 结果 JSON 字符串；不识别的方法返回 "null"
     */
    @JavascriptInterface
    fun invokeSync(method: String, argsJson: String): String {
        return try {
            when (method) {
                "getInfo" -> getInfo()
                "toast" -> { showToast(argsJson); "true" }
                "vibrate" -> { vibrate(argsJson); "true" }
                "setClipboard" -> { setClipboard(argsJson); "true" }
                "notify" -> { showNotification(argsJson); "true" }
                "setImmersive" -> { setImmersive(argsJson); "true" }
                "exitApp" -> { activity.runOnUiThread { activity.finish() }; "true" }
                else -> "null"
            }
        } catch (e: Exception) {
            // 同步调用失败返回 null，避免 JS 侧 JSON.parse 抛错
            "null"
        }
    }

    /**
     * 异步调用入口：JS 侧 window.AndroidBridge.invokeAsync(method, argsJson, callbackId)
     * 完成后通过 evaluateJavascript 调用 window._dsBridgeCallback(callbackId, success, result)
     * @param method 方法名
     * @param argsJson JSON 字符串参数
     * @param callbackId 回调 ID（由 JS 侧分配，原样回传）
     */
    @JavascriptInterface
    fun invokeAsync(method: String, argsJson: String, callbackId: String) {
        Thread {
            val (success, result) = try {
                when (method) {
                    "share" -> { shareText(argsJson); Pair(true, "true") }
                    "readFile" -> Pair(true, JSONObject().apply { put("content", readFile(argsJson)) }.toString())
                    "writeFile" -> { writeFile(argsJson); Pair(true, "true") }
                    "download" -> Pair(true, JSONObject().apply { put("path", download(argsJson)) }.toString())
                    "http" -> Pair(true, http(argsJson))
                    "checkUpdate" -> Pair(true, checkUpdate())
                    "execInTermux" -> Pair(true, execInTermux(argsJson))
                    "openHtmlViewer" -> { openHtmlViewer(argsJson); Pair(true, "true") }
                    "pickFile" -> Pair(false, "\"pickFile 暂未实现\"")
                    else -> Pair(false, "\"未知方法: $method\"")
                }
            } catch (e: Exception) {
                Pair(false, "\"" + escapeJson(e.message ?: "未知错误") + "\"")
            }
            // 回调 JS：必须在 UI 线程调用 evaluateJavascript
            val successInt = if (success) 1 else 0
            val js = "window._dsBridgeCallback('$callbackId', $successInt, $result);"
            activity.runOnUiThread { webView.evaluateJavascript(js, null) }
        }.start()
    }

    // ============================================================
    // 同步方法实现
    // ============================================================

    /**
     * 获取宿主版本与平台信息
     * @return JSON 字符串 {version, platform, build}
     */
    private fun getInfo(): String {
        return JSONObject().apply {
            put("version", DeepSeekConfig.APP_VERSION)
            put("platform", "android")
            put("build", "${Build.MANUFACTURER} ${Build.MODEL}")
        }.toString()
    }

    /**
     * 显示 Toast（在 UI 线程派发）
     * @param argsJson {msg: string, long: boolean}
     */
    private fun showToast(argsJson: String) {
        val args = JSONObject(argsJson)
        val msg = args.optString("msg", "")
        val long = args.optBoolean("long", false)
        activity.runOnUiThread {
            Toast.makeText(activity, msg, if (long) Toast.LENGTH_LONG else Toast.LENGTH_SHORT).show()
        }
    }

    /**
     * 震动反馈
     * @param argsJson {pattern: number | number[]}
     */
    private fun vibrate(argsJson: String) {
        val args = JSONObject(argsJson)
        val pattern = args.opt("pattern")
        // 兼容 number 与 number[] 两种形式
        val timings: LongArray = when (pattern) {
            is Number -> longArrayOf(pattern.toLong())
            is JSONArray -> {
                LongArray(pattern.length()) { i -> pattern.optLong(i) }
            }
            else -> longArrayOf(30L)
        }
        if (timings.isEmpty()) return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            // API 31+ 通过 VibratorManager 获取 Vibrator
            val vm = activity.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager
            if (timings.size == 1) {
                vm.defaultVibrator.vibrate(VibrationEffect.createOneShot(timings[0], VibrationEffect.DEFAULT_AMPLITUDE))
            } else {
                // waveform 第一个元素是延迟，后续交替 震动-静止
                vm.defaultVibrator.vibrate(VibrationEffect.createWaveform(timings, -1))
            }
        } else {
            // API 31- 通过 Vibrator 服务（已废弃但兼容）
            @Suppress("DEPRECATION")
            val v = activity.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                if (timings.size == 1) {
                    v.vibrate(VibrationEffect.createOneShot(timings[0], VibrationEffect.DEFAULT_AMPLITUDE))
                } else {
                    v.vibrate(VibrationEffect.createWaveform(timings, -1))
                }
            } else {
                @Suppress("DEPRECATION")
                v.vibrate(timings, -1)
            }
        }
    }

    /**
     * 复制文本到系统剪贴板
     * @param argsJson {text: string}
     */
    private fun setClipboard(argsJson: String) {
        val args = JSONObject(argsJson)
        val text = args.optString("text", "")
        val cm = activity.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        cm.setPrimaryClip(ClipData.newPlainText("DS Pro", text))
    }

    /**
     * 发送系统通知
     * @param argsJson {title: string, body: string}
     */
    private fun showNotification(argsJson: String) {
        val args = JSONObject(argsJson)
        val title = args.optString("title", "DS Pro")
        val body = args.optString("body", "")
        val nm = activity.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        // 使用原生 Notification.Builder，避免引入 androidx.core 依赖
        val notification = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(activity, NOTIFICATION_CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(Notification.BigTextStyle().bigText(body))
                .setAutoCancel(true)
                .build()
        } else {
            // API 24-25：Notification.Builder(context) 已废弃但可用，不需要 channelId
            @Suppress("DEPRECATION")
            Notification.Builder(activity)
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(Notification.BigTextStyle().bigText(body))
                .setAutoCancel(true)
                .build()
        }
        nm.notify(nextNotificationId++, notification)
    }

    /**
     * 切换沉浸式全屏模式
     * @param argsJson {enabled: boolean}
     */
    private fun setImmersive(argsJson: String) {
        val args = JSONObject(argsJson)
        val enabled = args.optBoolean("enabled", true)
        activity.runOnUiThread {
            if (enabled) {
                activity.window.decorView.systemUiVisibility = (
                    View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                        or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                        or View.SYSTEM_UI_FLAG_FULLSCREEN
                        or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                )
                activity.window.statusBarColor = Color.TRANSPARENT
                activity.window.navigationBarColor = Color.TRANSPARENT
            } else {
                // 退出沉浸式：清除所有 flag，显示状态栏与导航栏
                activity.window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_VISIBLE
            }
        }
    }

    // ============================================================
    // 异步方法实现
    // ============================================================

    /**
     * 调用系统分享面板分享文本（发起 Intent 后立即回调成功，不等待用户操作）
     * @param argsJson {text: string, title: string}
     */
    private fun shareText(argsJson: String) {
        val args = JSONObject(argsJson)
        val text = args.optString("text", "")
        val title = args.optString("title", "分享")
        val sendIntent = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_SUBJECT, title)
            putExtra(Intent.EXTRA_TEXT, text)
            // 让分享面板在 JS 调用的 Activity 之外打开，避免影响 WebView
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        activity.startActivity(Intent.createChooser(sendIntent, title))
    }

    /**
     * 读取应用私有目录下的文件文本
     * @param argsJson {path: string} 相对 filesDir 的路径
     * @return 文件内容字符串
     */
    private fun readFile(argsJson: String): String {
        val args = JSONObject(argsJson)
        val path = args.optString("path", "")
        val file = File(activity.filesDir, path)
        return if (file.exists() && file.isFile) file.readText(Charsets.UTF_8) else ""
    }

    /**
     * 写入文本到应用私有目录下的文件
     * @param argsJson {path: string, content: string}
     */
    private fun writeFile(argsJson: String) {
        val args = JSONObject(argsJson)
        val path = args.optString("path", "")
        val content = args.optString("content", "")
        val file = File(activity.filesDir, path)
        file.parentFile?.mkdirs()
        file.writeText(content, Charsets.UTF_8)
    }

    /**
     * 通过 DownloadManager 下载 URL 到系统下载目录
     * @param argsJson {url: string, filename: string}
     * @return 保存的文件名（实际路径由系统决定，存于公共 Downloads 目录）
     */
    private fun download(argsJson: String): String {
        val args = JSONObject(argsJson)
        val url = args.optString("url", "")
        val filename = args.optString("filename", "dspro_download")
        if (url.isEmpty()) throw IllegalArgumentException("url 不能为空")
        val dm = activity.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
        val request = DownloadManager.Request(Uri.parse(url)).apply {
            setTitle(filename)
            setDestinationInExternalFilesDir(activity, android.os.Environment.DIRECTORY_DOWNLOADS, filename)
            setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
        }
        dm.enqueue(request)
        return filename
    }

    /**
     * 通过原生 HttpURLConnection 发起 HTTP 请求，绕过 WebView 的 CORS 限制
     * @param argsJson {method, url, headers, body}
     * @return JSON {status, headers, body}
     */
    private fun http(argsJson: String): String {
        val args = JSONObject(argsJson)
        val method = args.optString("method", "GET").uppercase()
        val urlStr = args.optString("url", "")
        val headers = args.optJSONObject("headers")
        val body = args.optString("body", "")

        val conn = (URL(urlStr).openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = HTTP_CONNECT_TIMEOUT_MS
            readTimeout = HTTP_READ_TIMEOUT_MS
            // 有 body 时启用输出流
            if (body.isNotEmpty()) doOutput = true
            // 设置请求头
            if (headers != null) {
                for (key in headers.keys()) {
                    setRequestProperty(key, headers.getString(key))
                }
            }
        }
        try {
            if (body.isNotEmpty()) {
                OutputStreamWriter(conn.outputStream, Charsets.UTF_8).use { it.write(body) }
            }
            val status = conn.responseCode
            val respBody = try {
                conn.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
            } catch (e: Exception) {
                // 错误响应体从 errorStream 读取
                conn.errorStream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() } ?: ""
            }
            val respHeaders = JSONObject()
            for ((k, v) in conn.headerFields) {
                if (k != null && v.isNotEmpty()) respHeaders.put(k.lowercase(), v.joinToString(", "))
            }
            return JSONObject().apply {
                put("status", status)
                put("headers", respHeaders)
                put("body", respBody)
            }.toString()
        } finally {
            conn.disconnect()
        }
    }

    /**
     * 检查应用更新：从 DeepSeekConfig.UPDATE_CHECK_URL 获取最新版本信息
     * @return JSON {hasUpdate, version, url, note}
     */
    private fun checkUpdate(): String {
        val updateUrl = DeepSeekConfig.UPDATE_CHECK_URL
        // 未配置更新源时直接返回无更新
        if (updateUrl.isEmpty()) {
            return JSONObject().apply {
                put("hasUpdate", false)
                put("version", "")
                put("url", "")
                put("note", "未配置更新检查源")
            }.toString()
        }
        val conn = (URL(updateUrl).openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            connectTimeout = HTTP_CONNECT_TIMEOUT_MS
            readTimeout = HTTP_READ_TIMEOUT_MS
            // GitHub API 要求 User-Agent
            setRequestProperty("User-Agent", "DeepSeekClient/${DeepSeekConfig.APP_VERSION}")
            setRequestProperty("Accept", "application/vnd.github+json")
        }
        try {
            val respBody = conn.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
            val json = JSONObject(respBody)
            val tagName = json.optString("tag_name", "").removePrefix("v")
            val htmlUrl = json.optString("html_url", "")
            val note = json.optString("body", "")
            val hasUpdate = tagName.isNotEmpty() && tagName != DeepSeekConfig.APP_VERSION
            return JSONObject().apply {
                put("hasUpdate", hasUpdate)
                put("version", tagName)
                put("url", htmlUrl)
                put("note", note)
            }.toString()
        } finally {
            conn.disconnect()
        }
    }

    /**
     * 通过 Termux RunCommandService 在终端中执行命令
     *
     * 使用会话重用模式（no-session-with-name），将命令发送到固定名称的会话中，
     * 首次执行创建新会话，后续执行复用同一会话，保持环境连续性。
     * 需要 Termux 已安装且开启"允许外部应用"权限。
     *
     * @param argsJson {terminal: string, code: string}
     * @return JSON 执行结果
     */
    private fun execInTermux(argsJson: String): String {
        val args = JSONObject(argsJson)
        val code = args.optString("code", "")
        if (code.isEmpty()) throw IllegalArgumentException("code 不能为空")

        // 检查 Termux 是否已安装
        val pm = activity.packageManager
        val termuxInstalled = runCatching {
            pm.getPackageInfo("com.termux", 0)
        }.isSuccess

        if (!termuxInstalled) {
            return JSONObject().apply {
                put("success", false)
                put("error", "Termux 未安装，请先安装 Termux 应用")
            }.toString()
        }

        // 通过 Intent 调用 Termux RunCommandService
        // 使用 bash -c 执行多行命令，会话复用模式确保命令发送到同一终端
        val intent = Intent().apply {
            setClassName("com.termux", "com.termux.app.RunCommandService")
            action = "com.termux.RUN_COMMAND"
            putExtra("com.termux.RUN_COMMAND_PATH",
                "/data/data/com.termux/files/usr/bin/bash")
            putExtra("com.termux.RUN_COMMAND_ARGUMENTS", arrayOf("-c", code))
            putExtra("com.termux.RUN_COMMAND_WORKDIR",
                "/data/data/com.termux/files/home")
            putExtra("com.termux.RUN_COMMAND_BACKGROUND", false)
            // 会话复用：首次创建名为 dspro-exec 的会话，后续复用
            putExtra("com.termux.RUN_COMMAND_SESSION_CREATE_MODE", "no-session-with-name")
            putExtra("com.termux.RUN_COMMAND_SESSION_NAME", "dspro-exec")
            // 会话动作：切换到该会话并打开Activity
            putExtra("com.termux.RUN_COMMAND_SESSION_ACTION", "0")
        }

        return try {
            // 启动服务
            activity.startService(intent)
            JSONObject().apply {
                put("success", true)
                put("message", "已发送到 Termux")
            }.toString()
        } catch (e: Exception) {
            // 可能 Termux 未开启"允许外部应用"权限
            JSONObject().apply {
                put("success", false)
                put("error", "发送到 Termux 失败: ${e.message}。请确保 Termux 中已开启 allow-external-apps = true")
            }.toString()
        }
    }

    /**
     * 打开 HTML 预览容器（HtmlViewerActivity）
     *
     * 将 HTML 代码写入临时文件，然后通过 Intent 启动 HtmlViewerActivity
     * 加载并展示该 HTML 文件。HtmlViewerActivity 提供全屏 WebView 和关闭按钮。
     *
     * @param argsJson {html: string} 完整的 HTML 代码字符串
     */
    private fun openHtmlViewer(argsJson: String) {
        val args = JSONObject(argsJson)
        val html = args.optString("html", "")
        if (html.isEmpty()) throw IllegalArgumentException("html 不能为空")

        // 写入临时 HTML 文件到应用私有目录
        val htmlFile = File(activity.filesDir, "html_preview.html")
        htmlFile.writeText(html, Charsets.UTF_8)

        // 通过 Intent 启动 HtmlViewerActivity
        val intent = Intent(activity, HtmlViewerActivity::class.java).apply {
            putExtra("html_file_path", htmlFile.absolutePath)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        activity.startActivity(intent)
    }

    // ============================================================
    // 工具方法
    // ============================================================

    /**
     * 转义 JSON 字符串中的特殊字符，避免拼接到回调 JS 时破坏语法
     * @param s 原始字符串
     * @return 转义后的字符串
     */
    private fun escapeJson(s: String): String {
        val sb = StringBuilder()
        for (c in s) {
            when (c) {
                '"' -> sb.append("\\\"")
                '\\' -> sb.append("\\\\")
                '\n' -> sb.append("\\n")
                '\r' -> sb.append("\\r")
                '\t' -> sb.append("\\t")
                else -> sb.append(c)
            }
        }
        return sb.toString()
    }
}
