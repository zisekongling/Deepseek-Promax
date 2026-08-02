package com.dspro.client.desktop

import java.security.Key
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.IvParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * Web Crypto API（window.crypto.subtle）的 Java 原生桥接实现。
 *
 * 背景：JavaFX WebView 内置的 WebKit 引擎不支持 Web Crypto API
 * （window.crypto.subtle 为 undefined）。现代网站登录流程（如 DeepSeek）
 * 依赖 crypto.subtle.digest / importKey / encrypt / sign 等方法进行密码哈希、
 * token 生成与请求签名，缺失会导致 JS 执行卡死，表现为「点击登录一直转圈」。
 *
 * 本类通过 JS-Java 桥接，用 java.security / javax.crypto 实现常用算法，
 * 由 JS 端包装为 Promise-based 的 crypto.subtle polyfill。
 *
 * 数据约定：
 *   - 二进制数据通过 base64 字符串在 JS 与 Java 间传递
 *   - 密钥导入后返回 keyId（UUID），后续操作以 keyId 引用
 */
class CryptoBridge {

    /** 已导入密钥的内存存储：keyId -> Key */
    private val keyStore = HashMap<String, Key>()

    // ============================================================
    // 哈希：crypto.subtle.digest
    // ============================================================

    /**
     * 计算摘要（SHA-1/256/384/512）。
     * @param algorithm 算法名，如 "SHA-256"
     * @param base64Data 输入数据的 base64
     * @return 摘要结果的 base64
     */
    fun digest(algorithm: String, base64Data: String): String {
        val alg = normalizeDigestAlgorithm(algorithm)
        val data = b64dec(base64Data)
        val md = MessageDigest.getInstance(alg)
        val hash = md.digest(data)
        return b64enc(hash)
    }

    // ============================================================
    // 随机数：crypto.getRandomValues
    // ============================================================

    /**
     * 生成密码学安全随机字节。
     * @param length 字节数
     * @return 随机字节的 base64
     */
    fun randomBytes(length: Int): String {
        val bytes = ByteArray(length)
        SecureRandom().nextBytes(bytes)
        return b64enc(bytes)
    }

    // ============================================================
    // 密钥导入/导出：crypto.subtle.importKey / exportKey
    // ============================================================

    /**
     * 导入 raw 格式密钥（对称密钥）。
     * @param base64KeyData 密钥原始字节的 base64
     * @return keyId，后续操作以此引用
     */
    fun importKeyRaw(base64KeyData: String): String {
        val keyBytes = b64dec(base64KeyData)
        val keyId = UUID.randomUUID().toString()
        // 使用通用 AES 密钥规格，实际算法在使用时通过 Cipher/Mac 指定
        val key = SecretKeySpec(keyBytes, "AES")
        keyStore[keyId] = key
        return keyId
    }

    /**
     * 导入 JWK 格式密钥（仅支持 oct 对称密钥）。
     * @param jwkJson JWK JSON 字符串
     * @return keyId
     */
    fun importKeyJwk(jwkJson: String): String {
        val k = extractJwkField(jwkJson, "k") ?: throw IllegalArgumentException("JWK missing k field")
        val keyBytes = b64urldec(k)
        return importKeyRaw(b64enc(keyBytes))
    }

    /**
     * 导出密钥为 raw base64。
     * @param keyId 密钥 ID
     * @return 密钥字节的 base64
     */
    fun exportKeyRaw(keyId: String): String {
        val key = keyStore[keyId] ?: throw IllegalArgumentException("unknown keyId: $keyId")
        return b64enc(key.encoded)
    }

    // ============================================================
    // HMAC 签名/验签：crypto.subtle.sign / verify
    // ============================================================

    /**
     * HMAC 签名。
     * @param algorithm 哈希算法，如 "SHA-256"
     * @param keyId 密钥 ID
     * @param base64Data 待签名数据的 base64
     * @return 签名的 base64
     */
    fun hmacSign(algorithm: String, keyId: String, base64Data: String): String {
        val key = lookupKey(keyId)
        val alg = "Hmac" + normalizeDigestAlgorithm(algorithm).replace("-", "")
        val mac = Mac.getInstance(alg)
        mac.init(SecretKeySpec(key.encoded, alg))
        val sig = mac.doFinal(b64dec(base64Data))
        return b64enc(sig)
    }

    /**
     * HMAC 验签。
     * @param algorithm 哈希算法
     * @param keyId 密钥 ID
     * @param base64Signature 待验证签名的 base64
     * @param base64Data 原始数据的 base64
     * @return 签名是否匹配
     */
    fun hmacVerify(algorithm: String, keyId: String, base64Signature: String, base64Data: String): Boolean {
        val expected = hmacSign(algorithm, keyId, base64Data)
        return constantTimeEquals(b64dec(expected), b64dec(base64Signature))
    }

    // ============================================================
    // AES-GCM 加解密：crypto.subtle.encrypt / decrypt
    // ============================================================

    /**
     * AES-GCM 加密。
     * @param keyId 密钥 ID
     * @param base64Iv IV 的 base64（通常 12 字节）
     * @param base64Data 明文的 base64
     * @param base64Aad 附加认证数据的 base64，可为空
     * @return 密文+tag 的 base64
     */
    fun aesGcmEncrypt(keyId: String, base64Iv: String, base64Data: String, base64Aad: String?): String {
        val key = lookupKey(keyId)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        val iv = b64dec(base64Iv)
        cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key.encoded, "AES"), GCMParameterSpec(128, iv))
        if (!base64Aad.isNullOrEmpty()) {
            cipher.updateAAD(b64dec(base64Aad))
        }
        val ct = cipher.doFinal(b64dec(base64Data))
        return b64enc(ct)
    }

    /**
     * AES-GCM 解密。
     * @param keyId 密钥 ID
     * @param base64Iv IV 的 base64
     * @param base64Data 密文+tag 的 base64
     * @param base64Aad 附加认证数据的 base64，可为空
     * @return 明文的 base64
     */
    fun aesGcmDecrypt(keyId: String, base64Iv: String, base64Data: String, base64Aad: String?): String {
        val key = lookupKey(keyId)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        val iv = b64dec(base64Iv)
        cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(key.encoded, "AES"), GCMParameterSpec(128, iv))
        if (!base64Aad.isNullOrEmpty()) {
            cipher.updateAAD(b64dec(base64Aad))
        }
        val pt = cipher.doFinal(b64dec(base64Data))
        return b64enc(pt)
    }

    // ============================================================
    // AES-CBC 加解密
    // ============================================================

    /**
     * AES-CBC 加密（PKCS5Padding）。
     */
    fun aesCbcEncrypt(keyId: String, base64Iv: String, base64Data: String): String {
        val key = lookupKey(keyId)
        val cipher = Cipher.getInstance("AES/CBC/PKCS5Padding")
        cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key.encoded, "AES"), IvParameterSpec(b64dec(base64Iv)))
        return b64enc(cipher.doFinal(b64dec(base64Data)))
    }

    /**
     * AES-CBC 解密（PKCS5Padding）。
     */
    fun aesCbcDecrypt(keyId: String, base64Iv: String, base64Data: String): String {
        val key = lookupKey(keyId)
        val cipher = Cipher.getInstance("AES/CBC/PKCS5Padding")
        cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(key.encoded, "AES"), IvParameterSpec(b64dec(base64Iv)))
        return b64enc(cipher.doFinal(b64dec(base64Data)))
    }

    // ============================================================
    // PBKDF2 派生：crypto.subtle.deriveBits
    // ============================================================

    /**
     * PBKDF2 派生密钥位（RFC 8018）。
     *
     * 直接基于 HMAC 实现，以 byte[] 作为 password，避免 PBEKeySpec 的 char[] 转换
     * 导致与浏览器 Web Crypto 结果不一致（UTF-8 编码多字节问题）。
     *
     * @param algorithm 哈希算法，如 "SHA-256"
     * @param base64Password 口令字节的 base64
     * @param base64Salt 盐的 base64
     * @param iterations 迭代次数
     * @param length 派生位长度
     * @return 派生字节的 base64
     */
    fun pbkdf2Derive(algorithm: String, base64Password: String, base64Salt: String, iterations: Int, length: Int): String {
        val alg = normalizeDigestAlgorithm(algorithm).replace("-", "")
        val password = b64dec(base64Password)
        val salt = b64dec(base64Salt)
        val keyLengthBits = if (length <= 0) 256 else length
        val keyLengthBytes = keyLengthBits / 8
        val macAlg = "Hmac$alg"
        val mac = Mac.getInstance(macAlg)
        mac.init(SecretKeySpec(password, macAlg))

        val hLen = mac.macLength
        val numBlocks = (keyLengthBytes + hLen - 1) / hLen
        val derived = ByteArray(keyLengthBytes)

        for (blockIndex in 1..numBlocks) {
            // U1 = HMAC(Password, Salt || INT_BE(blockIndex))
            val u = ByteArray(salt.size + 4)
            System.arraycopy(salt, 0, u, 0, salt.size)
            u[salt.size] = (blockIndex ushr 24).toByte()
            u[salt.size + 1] = (blockIndex ushr 16).toByte()
            u[salt.size + 2] = (blockIndex ushr 8).toByte()
            u[salt.size + 3] = blockIndex.toByte()

            var t = mac.doFinal(u)
            val blockResult = t.copyOf()

            // U2..Uc，异或累积
            for (j in 2..iterations) {
                t = mac.doFinal(t)
                for (k in 0 until hLen) {
                    blockResult[k] = (blockResult[k].toInt() xor t[k].toInt()).toByte()
                }
            }

            val offset = (blockIndex - 1) * hLen
            val copyLen = minOf(hLen, keyLengthBytes - offset)
            System.arraycopy(blockResult, 0, derived, offset, copyLen)
        }

        return b64enc(derived)
    }

    // ============================================================
    // 内部工具
    // ============================================================

    /** 查找密钥，不存在则抛异常 */
    private fun lookupKey(keyId: String): Key {
        return keyStore[keyId] ?: throw IllegalArgumentException("unknown keyId: $keyId")
    }

    /** 归一化摘要算法名：SHA-256 -> SHA-256，sha256 -> SHA-256 */
    private fun normalizeDigestAlgorithm(algorithm: String): String {
        val upper = algorithm.uppercase().replace("_", "-")
        return when (upper) {
            "SHA256", "SHA-256" -> "SHA-256"
            "SHA1", "SHA-1" -> "SHA-1"
            "SHA384", "SHA-384" -> "SHA-384"
            "SHA512", "SHA-512" -> "SHA-512"
            else -> upper
        }
    }

    /** base64 编码 */
    private fun b64enc(bytes: ByteArray): String = Base64.getEncoder().encodeToString(bytes)

    /** base64 解码 */
    private fun b64dec(s: String): ByteArray = Base64.getDecoder().decode(s)

    /** base64url 解码（JWK 中的 k 字段使用 base64url） */
    private fun b64urldec(s: String): ByteArray {
        val padded = s + "=".repeat((4 - s.length % 4) % 4)
        return Base64.getUrlDecoder().decode(padded)
    }

    /** 恒定时间比较，防止时序攻击 */
    private fun constantTimeEquals(a: ByteArray, b: ByteArray): Boolean {
        if (a.size != b.size) return false
        var diff = 0
        for (i in a.indices) diff = diff or (a[i].toInt() xor b[i].toInt())
        return diff == 0
    }

    /** 从 JWK JSON 中提取指定字段值（简易解析，避免引入 JSON 库） */
    private fun extractJwkField(json: String, field: String): String? {
        val pattern = "\"$field\"\\s*:\\s*\"([^\"]+)\"".toRegex()
        return pattern.find(json)?.groupValues?.getOrNull(1)
    }
}
