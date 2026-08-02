// 根项目构建脚本，集中声明插件版本，供各子模块应用
plugins {
    // Kotlin 多平台插件，用于 shared 模块编译到 Android 与 JVM
    alias(libs.plugins.kotlinMultiplatform) apply false
    // Android Gradle Plugin，用于 androidApp 模块
    alias(libs.plugins.androidApplication) apply false
    // Android Library 插件，用于 shared 模块作为 KMP 库
    alias(libs.plugins.androidLibrary) apply false
    // Kotlin Android 插件，用于 androidApp 模块的 Kotlin 编译
    alias(libs.plugins.kotlinAndroid) apply false
    // JavaFX Gradle 插件，用于 desktopApp 模块管理 JavaFX 依赖
    alias(libs.plugins.javafx) apply false
    // Kotlin JVM 插件，用于 desktopApp 模块的 Kotlin 编译
    alias(libs.plugins.kotlinJvm) apply false
}
