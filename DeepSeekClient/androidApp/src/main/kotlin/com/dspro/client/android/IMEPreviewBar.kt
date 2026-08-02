package com.dspro.client.android

import android.content.Context
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.TextView

/**
 * 输入法输入预览栏。
 *
 * 当软键盘弹出时，在键盘上方显示一个文本栏，实时镜像显示 DeepSeek 网页输入框的
 * 当前内容（包括输入法 composing 过程中的文本），避免网页输入框被软键盘遮挡
 * 导致用户看不到自己输入了什么。
 *
 * 仅用于显示，不接管输入焦点，用户仍在 DeepSeek 网页内操作；内容通过 JS 桥接
 * 监听网页输入框的 input 事件获取。
 *
 * @param context 上下文
 */
class IMEPreviewBar(context: Context) {

    /** dp 转 px 工具 */
    private val density = context.resources.displayMetrics.density

    /** 浮层文本视图，显示输入框当前内容 */
    private val textView: TextView = TextView(context).apply {
        // 半透明深色背景，与 DeepSeek 暗色主题协调
        background = GradientDrawable().apply {
            setColor(Color.parseColor("#E61A1A1A"))
            // 仅顶部圆角，底部紧贴键盘
            cornerRadii = floatArrayOf(
                12 * density, 12 * density,  // 左上
                12 * density, 12 * density,  // 右上
                0f, 0f,                       // 右下
                0f, 0f                        // 左下
            )
        }
        setTextColor(Color.WHITE)
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
        setPadding(
            (16 * density).toInt(), (10 * density).toInt(),
            (16 * density).toInt(), (10 * density).toInt()
        )
        maxLines = 4
        gravity = Gravity.START or Gravity.CENTER_VERTICAL
        isClickable = false
        isFocusable = false
        // 保证空内容时仍有可见高度
        minimumHeight = (40 * density).toInt()
    }

    /** 浮层布局参数，定位在窗口底部，通过 bottomMargin 抬高到 IME 上方 */
    private val params: FrameLayout.LayoutParams = FrameLayout.LayoutParams(
        FrameLayout.LayoutParams.MATCH_PARENT,
        FrameLayout.LayoutParams.WRAP_CONTENT
    ).apply {
        gravity = Gravity.BOTTOM
    }

    /** 浮层是否已添加到根容器 */
    private var attached = false

    /**
     * 将浮层添加到指定的 FrameLayout 根容器。
     * 添加后浮层默认不可见，等待 IME 弹出时显示。
     *
     * @param root 根容器，浮层将叠加在 WebView 之上
     */
    fun attachTo(root: FrameLayout) {
        if (attached) return
        textView.visibility = View.GONE
        root.addView(textView, params)
        attached = true
    }

    /**
     * 根据 IME 高度更新浮层位置与可见性。
     *
     * @param imeHeight IME 高度（px），>0 时显示浮层并定位到 IME 上方；0 时隐藏浮层
     */
    fun onImeHeightChanged(imeHeight: Int) {
        if (!attached) return
        if (imeHeight > 0) {
            params.bottomMargin = imeHeight
            textView.layoutParams = params
            if (textView.visibility != View.VISIBLE) {
                textView.visibility = View.VISIBLE
            }
        } else {
            if (textView.visibility != View.GONE) {
                textView.visibility = View.GONE
            }
        }
    }

    /**
     * 更新显示的文本。
     *
     * @param text 输入框当前内容，空字符串时显示占位（保持栏高度）
     */
    fun setText(text: String) {
        textView.text = if (text.isEmpty()) " " else text
    }
}
