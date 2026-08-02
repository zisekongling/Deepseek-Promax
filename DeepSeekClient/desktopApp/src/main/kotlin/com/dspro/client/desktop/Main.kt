package com.dspro.client.desktop

import com.dspro.client.shared.DeepSeekConfig
import com.dspro.client.shared.ScriptLoader
import com.sun.javafx.webkit.WebConsoleListener
import javafx.application.Application
import javafx.concurrent.Worker
import javafx.scene.Scene
import javafx.scene.web.WebEngine
import javafx.scene.web.WebView
import javafx.stage.Stage
import netscape.javascript.JSObject
import java.net.CookieHandler
import java.net.CookieManager
import java.net.CookiePolicy

/**
 * Desktop 应用入口。
 *
 * 使用 JavaFX WebView 作为网页容器，启动后直接加载 chat.deepseek.com，
 * 不提供任何原生按钮或菜单；页面加载完成后注入内置 dspro.js 增强脚本。
 *
 * 关键修复：JavaFX WebView 内置 WebKit 不支持 Web Crypto API（window.crypto.subtle），
 * 导致 DeepSeek 登录流程依赖的加密操作（digest/importKey/sign 等）无法执行，
 * 表现为「点击登录按钮一直转圈」。此处通过 CryptoBridge 注入 JS polyfill 解决。
 */
class Main : Application() {

    /**
     * Web Crypto 桥接实例。
     *
     * 必须作为字段保持强引用：JS-Java 桥接通过 JSObject.setMember 暴露给页面后，
     * 若 Java 端失去引用被 GC 回收，JS 调用将得到空对象。
     */
    private val cryptoBridge = CryptoBridge()

    /**
     * JavaFX 启动回调：构建窗口、配置 WebView 并加载目标地址。
     *
     * @param primaryStage 主窗口
     */
    override fun start(primaryStage: Stage) {
        // 1. 安装全局 JS console 监听，输出到 stderr 便于诊断登录等问题
        WebConsoleListener.setDefaultListener { _, message, lineNumber, sourceId ->
            System.err.println("[JS:${sourceId}:${lineNumber}] $message")
        }

        // 2. 配置 Cookie 策略为 ACCEPT_ALL，避免登录 Cookie 被拒绝
        val cookieManager = CookieManager()
        cookieManager.setCookiePolicy(CookiePolicy.ACCEPT_ALL)
        CookieHandler.setDefault(cookieManager)

        val webView = WebView()
        val engine: WebEngine = webView.engine

        // 桌面 Chrome UA，避免站点返回移动版页面
        engine.userAgent =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
            "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

        // 开启 JavaScript 与弹窗支持
        engine.isJavaScriptEnabled = true

        // 允许 JS 弹窗 alert/confirm 等
        engine.setOnAlert { it.consume() }

        // 页面加载异常捕获，输出到日志便于诊断
        engine.loadWorker.exceptionProperty().addListener { _, _, exception ->
            if (exception != null) {
                System.err.println("[LoadException] ${exception.message}")
            }
        }

        // 页面加载完成后：先注入 crypto polyfill，再注入 dspro.js
        // 顺序很重要：polyfill 必须在增强脚本之前就绪，避免登录依赖的加密 API 缺失
        engine.loadWorker.stateProperty().addListener { _, _, newState ->
            if (newState == Worker.State.SUCCEEDED) {
                injectCryptoPolyfill(engine)
                injectEnhanceScript(engine)
            }
        }

        engine.load(DeepSeekConfig.TARGET_URL)

        val scene = Scene(
            webView,
            DeepSeekConfig.DESKTOP_WINDOW_WIDTH,
            DeepSeekConfig.DESKTOP_WINDOW_HEIGHT
        )

        primaryStage.title = DeepSeekConfig.APP_TITLE
        primaryStage.scene = scene
        primaryStage.minWidth = DeepSeekConfig.DESKTOP_MIN_WIDTH
        primaryStage.minHeight = DeepSeekConfig.DESKTOP_MIN_HEIGHT
        primaryStage.show()
    }

    /**
     * 注入 crypto.subtle polyfill。
     *
     * 将 CryptoBridge 暴露为 window.__dsCryptoBridge，再执行 polyfill 脚本，
     * 用 Promise 包装 Java 同步调用，实现 Web Crypto API 兼容层。
     * 每次 SUCCEEDED 都需重新注入：页面导航会重置 JS 上下文与 bridge 引用。
     *
     * @param engine WebEngine
     */
    private fun injectCryptoPolyfill(engine: WebEngine) {
        try {
            val window = engine.executeScript("window") as JSObject
            window.setMember("__dsCryptoBridge", cryptoBridge)
            engine.executeScript(CRYPTO_POLYFILL_JS)
        } catch (e: Throwable) {
            System.err.println("[CryptoPolyfill] inject failed: ${e.message}")
        }
    }

    /**
     * 注入 dspro.js 增强脚本。
     *
     * @param engine WebEngine
     */
    private fun injectEnhanceScript(engine: WebEngine) {
        val script: String = ScriptLoader.loadScript()
        if (script.isNotEmpty()) {
            try {
                engine.executeScript(script)
            } catch (e: Throwable) {
                // 注入失败仅打印日志，不影响页面正常浏览
                System.err.println("[DeepSeekClient] dspro.js inject failed: ${e.message}")
            }
        }
    }

    companion object {
        /**
         * Web Crypto API polyfill 脚本。
         *
         * 通过 window.__dsCryptoBridge（CryptoBridge）实现：
         *   - crypto.subtle.digest（SHA-1/256/384/512）
         *   - crypto.subtle.importKey/exportKey（raw、jwk-oct）
         *   - crypto.subtle.sign/verify（HMAC）
         *   - crypto.subtle.encrypt/decrypt（AES-GCM、AES-CBC）
         *   - crypto.subtle.deriveBits/deriveKey（PBKDF2）
         *   - crypto.getRandomValues
         *
         * 二进制数据经 base64 在 JS 与 Java 间传递；密钥导入后以 keyId 引用。
         * 若原生 crypto.subtle 已可用（如未来 JavaFX 升级），则跳过注入。
         */
        private val CRYPTO_POLYFILL_JS = """
(function() {
    window.crypto = window.crypto || {};
    var bridge = window.__dsCryptoBridge;
    var hasNativeSubtle = !!(window.crypto.subtle && typeof window.crypto.subtle.digest === 'function');
    console.log('[DS-Polyfill] init | native subtle:', hasNativeSubtle, '| bridge:', !!bridge);
    if (!bridge) { console.error('[DS-Polyfill] Java bridge not found'); return; }

    // ===== 二进制工具 =====
    function viewToBytes(buf) {
        if (buf instanceof ArrayBuffer) return new Uint8Array(buf);
        if (ArrayBuffer.isView(buf)) return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
        if (typeof buf === 'string') {
            var enc = unescape(encodeURIComponent(buf));
            var arr = new Uint8Array(enc.length);
            for (var i = 0; i < enc.length; i++) arr[i] = enc.charCodeAt(i);
            return arr;
        }
        return new Uint8Array(0);
    }
    function bytesToB64(bytes) {
        var binary = '';
        for (var i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        return btoa(binary);
    }
    function bufToB64(buf) { return bytesToB64(viewToBytes(buf)); }
    function b64ToAb(b64) {
        var binary = atob(b64);
        var bytes = new Uint8Array(binary.length);
        for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return bytes.buffer;
    }
    function algName(alg) {
        if (typeof alg === 'string') return alg;
        return (alg && alg.name) ? alg.name : String(alg);
    }
    function hashName(algorithm) {
        if (typeof algorithm === 'object' && algorithm.hash) return algName(algorithm.hash);
        return 'SHA-256';
    }

    // ===== getRandomValues =====
    if (!window.crypto.getRandomValues) {
        window.crypto.getRandomValues = function(typedArray) {
            var b64 = bridge.randomBytes(typedArray.length);
            var binary = atob(b64);
            for (var i = 0; i < binary.length; i++) typedArray[i] = binary.charCodeAt(i);
            return typedArray;
        };
    }

    // ===== 原生 subtle 可用则跳过 =====
    if (hasNativeSubtle) {
        console.log('[DS-Polyfill] native subtle available, skip polyfill');
        return;
    }

    // ===== crypto.subtle polyfill =====
    var subtle = {
        digest: function(algorithm, data) {
            return new Promise(function(resolve, reject) {
                try { resolve(b64ToAb(bridge.digest(algName(algorithm), bufToB64(data)))); }
                catch(e) { reject(e); }
            });
        },
        importKey: function(format, keyData, algorithm, extractable, keyUsages) {
            return new Promise(function(resolve, reject) {
                try {
                    var keyId;
                    if (format === 'raw') {
                        keyId = bridge.importKeyRaw(bufToB64(keyData));
                    } else if (format === 'jwk') {
                        keyId = bridge.importKeyJwk(JSON.stringify(keyData));
                    } else {
                        reject(new Error('importKey: unsupported format ' + format));
                        return;
                    }
                    resolve({ type: 'secret', id: keyId, algorithm: algorithm, extractable: extractable, usages: keyUsages });
                } catch(e) { reject(e); }
            });
        },
        exportKey: function(format, key) {
            return new Promise(function(resolve, reject) {
                try {
                    if (format === 'raw') { resolve(b64ToAb(bridge.exportKeyRaw(key.id))); }
                    else { reject(new Error('exportKey: unsupported format ' + format)); }
                } catch(e) { reject(e); }
            });
        },
        sign: function(algorithm, key, data) {
            return new Promise(function(resolve, reject) {
                try {
                    var alg = algName(algorithm);
                    if (alg === 'HMAC') {
                        resolve(b64ToAb(bridge.hmacSign(hashName(algorithm), key.id, bufToB64(data))));
                    } else {
                        reject(new Error('sign: unsupported algorithm ' + alg));
                    }
                } catch(e) { reject(e); }
            });
        },
        verify: function(algorithm, key, signature, data) {
            return new Promise(function(resolve, reject) {
                try {
                    var alg = algName(algorithm);
                    if (alg === 'HMAC') {
                        resolve(bridge.hmacVerify(hashName(algorithm), key.id, bufToB64(signature), bufToB64(data)));
                    } else {
                        reject(new Error('verify: unsupported algorithm ' + alg));
                    }
                } catch(e) { reject(e); }
            });
        },
        encrypt: function(algorithm, key, data) {
            return new Promise(function(resolve, reject) {
                try {
                    var alg = algName(algorithm);
                    var dataB64 = bufToB64(data);
                    if (alg === 'AES-GCM') {
                        resolve(b64ToAb(bridge.aesGcmEncrypt(key.id, bufToB64(algorithm.iv), dataB64, algorithm.additionalData ? bufToB64(algorithm.additionalData) : null)));
                    } else if (alg === 'AES-CBC') {
                        resolve(b64ToAb(bridge.aesCbcEncrypt(key.id, bufToB64(algorithm.iv), dataB64)));
                    } else {
                        reject(new Error('encrypt: unsupported algorithm ' + alg));
                    }
                } catch(e) { reject(e); }
            });
        },
        decrypt: function(algorithm, key, data) {
            return new Promise(function(resolve, reject) {
                try {
                    var alg = algName(algorithm);
                    var dataB64 = bufToB64(data);
                    if (alg === 'AES-GCM') {
                        resolve(b64ToAb(bridge.aesGcmDecrypt(key.id, bufToB64(algorithm.iv), dataB64, algorithm.additionalData ? bufToB64(algorithm.additionalData) : null)));
                    } else if (alg === 'AES-CBC') {
                        resolve(b64ToAb(bridge.aesCbcDecrypt(key.id, bufToB64(algorithm.iv), dataB64)));
                    } else {
                        reject(new Error('decrypt: unsupported algorithm ' + alg));
                    }
                } catch(e) { reject(e); }
            });
        },
        deriveBits: function(algorithm, baseKey, length) {
            return new Promise(function(resolve, reject) {
                try {
                    var alg = algName(algorithm);
                    if (alg === 'PBKDF2') {
                        var passwordB64 = bridge.exportKeyRaw(baseKey.id);
                        resolve(b64ToAb(bridge.pbkdf2Derive(hashName(algorithm), passwordB64, bufToB64(algorithm.salt), algorithm.iterations || 100000, length)));
                    } else {
                        reject(new Error('deriveBits: unsupported algorithm ' + alg));
                    }
                } catch(e) { reject(e); }
            });
        },
        deriveKey: function(algorithm, baseKey, derivedKeyAlgorithm, extractable, keyUsages) {
            var self = this;
            return self.deriveBits(algorithm, baseKey, 256).then(function(bits) {
                return self.importKey('raw', bits, derivedKeyAlgorithm, extractable, keyUsages);
            });
        },
        generateKey: function() { return Promise.reject(new Error('generateKey not supported')); },
        wrapKey: function() { return Promise.reject(new Error('wrapKey not supported')); },
        unwrapKey: function() { return Promise.reject(new Error('unwrapKey not supported')); }
    };

    window.crypto.subtle = subtle;
    console.log('[DS-Polyfill] crypto.subtle polyfill installed');
})();
        """.trimIndent()
    }
}

/**
 * 程序入口在 Launcher.kt 中，由其调用 Application.launch 启动本类。
 * 分离启动器以规避 JavaFX classpath 模式下的运行时预检查问题。
 */
