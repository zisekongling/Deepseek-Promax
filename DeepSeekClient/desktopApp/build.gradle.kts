// desktopApp 模块构建脚本：JVM 应用，使用 JavaFX WebView 作为网页容器
plugins {
    alias(libs.plugins.kotlinJvm)
    alias(libs.plugins.javafx)
    application
}

// JavaFX 模块声明，包含 web（WebView）与 controls（Stage/Scene）
javafx {
    version = "21.0.5"
    modules = listOf("javafx.web", "javafx.controls")
}

application {
    // 应用入口类，指向 Launcher.kt 中的顶层 main 函数
    mainClass.set("com.dspro.client.desktop.LauncherKt")
}

dependencies {
    // 依赖共享模块，获取 URL 配置与 dspro.js 加载逻辑
    implementation(project(":shared"))
}

// 强制 Kotlin 编译到 JVM 17 字节码，与运行时 JDK 匹配
tasks.withType<org.jetbrains.kotlin.gradle.tasks.KotlinCompile> {
    kotlinOptions {
        jvmTarget = "17"
    }
}

// 运行时 JVM 参数，确保 JavaFX 模块与内部 API（WebConsoleListener）可用
tasks.withType<JavaExec> {
    jvmArgs(
        "--add-opens=javafx.web/javafx.scene.web=ALL-UNNAMED",
        "--add-opens=javafx.web/com.sun.javafx.webkit=ALL-UNNAMED",
        "--add-opens=javafx.web/com.sun.webkit=ALL-UNNAMED"
    )
}
