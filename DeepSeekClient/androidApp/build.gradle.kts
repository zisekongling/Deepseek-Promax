// androidApp 模块构建脚本：Android 应用，依赖 shared 模块，使用原生 WebView
plugins {
    alias(libs.plugins.androidApplication)
    alias(libs.plugins.kotlinAndroid)
}

android {
    namespace = "com.dspro.client.android"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.dspro.client.android"
        minSdk = 24
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0"
    }

    // Release 签名配置，使用项目内 keystore 对 APK 进行签名
    signingConfigs {
        create("release") {
            storeFile = file("../keystore/deepseek.jks")
            storePassword = "deepseek123"
            keyAlias = "deepseek"
            keyPassword = "deepseek123"
        }
    }

    buildTypes {
        release {
            // 关闭代码混淆以简化首次构建，发布时可按需开启
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("release")
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    sourceSets {
        getByName("main") {
            // Kotlin 源码放在 kotlin/ 目录，遵循 KMP 习惯
            kotlin.srcDirs("src/main/kotlin")
        }
    }

    // 打包时排除冲突资源
    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }
}

dependencies {
    // 依赖共享模块，获取 URL 配置与 dspro.js 加载逻辑
    implementation(project(":shared"))
}
