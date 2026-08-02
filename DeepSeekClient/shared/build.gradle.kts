// shared 模块构建脚本：KMP 库，编译到 Android 与 JVM，提供 URL 配置与脚本加载逻辑
plugins {
    alias(libs.plugins.kotlinMultiplatform)
    alias(libs.plugins.androidLibrary)
}

kotlin {
    // Android 目标，供 androidApp 依赖
    androidTarget {
        compilations.all {
            kotlinOptions {
                jvmTarget = "17"
            }
        }
    }
    // JVM 目标，供 desktopApp 依赖
    jvm()

    sourceSets {
        commonMain.dependencies {
            // 纯 Kotlin 标准库，无外部依赖
        }
    }
}

// Android 库配置
android {
    namespace = "com.dspro.client.shared"
    compileSdk = 35

    defaultConfig {
        minSdk = 24
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    // 将 commonMain/resources 作为 Android assets 打包，使 dspro.js 能随 AAR 传递到 APK
    sourceSets {
        getByName("main") {
            assets.srcDirs("src/commonMain/resources")
        }
    }
}
