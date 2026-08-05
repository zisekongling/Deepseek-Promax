// 项目设置文件，定义项目名称、插件仓库与包含的子模块
pluginManagement {
    repositories {
        // Google Maven 仓库，提供 Android Gradle Plugin
        google()
        // Maven Central，提供 Kotlin 等插件
        mavenCentral()
        // Gradle 插件门户
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositories {
        // Google Maven 仓库，提供 AndroidX 等库
        google()
        // Maven Central，提供 Kotlin、JavaFX 等库
        mavenCentral()
    }
}

rootProject.name = "DeepSeekClient"

// 包含共享模块（KMP），存放 URL 配置与脚本加载逻辑
include(":shared")

// 包含 Android 应用模块，使用原生 WebView 容器
include(":androidApp")
