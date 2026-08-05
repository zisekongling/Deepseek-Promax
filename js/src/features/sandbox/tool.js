/**
 * @module features/sandbox/tool
 *
 * Python 沙箱工具层
 *
 * 模块职责：
 *   1. pythonExec(code, options?) — 在 pyodide 全局命名空间执行 Python 代码
 *      - 捕获 stdout/stderr（执行前重定向，执行后恢复）
 *      - 返回 { ok, stdout, stderr, result?, error?, executionTime? }
 *      - 超时控制（默认 10s）
 *      - 代码长度限制（默认 100KB）
 *   2. installPackage(name) — 经 micropip 安装纯 Python 包
 *   3. listInstalledPackages() — 返回已安装包列表
 *   4. resetPythonEnv() — 彻底重置执行环境（重新加载 pyodide）
 *
 * 安全限制：
 *   - 默认禁用网络访问（pyodide 本身无网络，micropip.install 需显式启用网络）
 *   - 限制执行时长（超时返回错误）
 *   - 代码长度限制（防止过大代码耗尽内存）
 *   - 不持久化执行环境：每次调用可选 reset 清理全局命名空间
 *
 * 与 python-worker.js 的协作：
 *   - 本模块不直接加载 pyodide，首次 pythonExec 时调用 loadPyodide() 触发懒加载
 *   - 已加载时直接复用缓存实例
 *
 * stdout/stderr 捕获策略：
 *   - 使用 pyodide 原生 setStdout/setStderr API（batched 模式）
 *   - 执行前设置收集器，执行后恢复为控制台输出（默认行为）
 *   - 这等效于重定向 sys.stdout/sys.stderr 到缓冲，但能捕获原生扩展输出
 */

import { loadPyodide, getPyodideInstance, isPyodideLoaded, resetPyodideRuntime } from './python-worker.js';

// ============================================================
// 常量定义
// ============================================================

/** 单次执行默认超时（毫秒） */
const DEFAULT_EXEC_TIMEOUT_MS = 10000;

/** 代码长度默认上限（字节）：100KB */
const DEFAULT_CODE_LIMIT_BYTES = 100 * 1024;

/** stdout/stderr 输出截断长度（字符）：避免超大输出耗尽内存 */
const OUTPUT_LIMIT_CHARS = 12000;

// ============================================================
// 默认 stdout/stderr 处理器（用于执行后恢复）
// ============================================================

/**
 * 默认 stdout 处理器：输出到 console.log
 * @param {string} text - 输出文本
 */
function _defaultStdoutHandler(text) {
    try { console.log(text); } catch (e) { /* 忽略 */ }
}

/**
 * 默认 stderr 处理器：输出到 console.warn
 * @param {string} text - 输出文本
 */
function _defaultStderrHandler(text) {
    try { console.warn(text); } catch (e) { /* 忽略 */ }
}

// ============================================================
// 辅助函数
// ============================================================

/**
 * 将 pyodide 执行结果格式化为字符串
 *
 * 处理 pyproxy 对象（自动调用 toJs 转换并销毁），
 * 以及字符串/数字/布尔等基本类型。
 *
 * @param {*} value - pyodide runPythonAsync 的返回值
 * @returns {string} 格式化后的字符串
 */
function _formatPythonValue(value) {
    if (value === undefined || value === null) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    try {
        // pyproxy 对象：转换为 JS 对象
        if (value && typeof value === 'object' && 'toJs' in value && typeof value.toJs === 'function') {
            const jsVal = value.toJs();
            try {
                return JSON.stringify(jsVal);
            } catch (e) {
                return String(jsVal);
            }
        }
    } catch (e) {
        // 转换失败，回退到 String()
    }
    try { return String(value); } catch (e) { return Object.prototype.toString.call(value); }
}

/**
 * 销毁 pyproxy 对象（释放 WASM 内存）
 * @param {*} value - 可能是 pyproxy 的值
 */
function _destroyIfPyProxy(value) {
    try {
        if (value && typeof value === 'object' && 'destroy' in value && typeof value.destroy === 'function') {
            value.destroy();
        }
    } catch (e) {
        // 销毁失败忽略
    }
}

/**
 * 截断文本到指定长度
 * @param {string} text - 原始文本
 * @param {number} limit - 最大长度（字符）
 * @returns {{ text: string, truncated: boolean }}
 */
function _limitText(text, limit) {
    if (typeof text !== 'string') return { text: '', truncated: false };
    if (text.length <= limit) return { text, truncated: false };
    return { text: text.slice(0, limit) + '\n...[输出已截断，原始长度 ' + text.length + ' 字符]', truncated: true };
}

/**
 * 计算字符串的字节长度（UTF-8）
 * @param {string} str - 输入字符串
 * @returns {number} 字节长度
 */
function _byteLength(str) {
    if (typeof str !== 'string') return 0;
    try {
        if (typeof TextEncoder !== 'undefined') {
            return new TextEncoder().encode(str).length;
        }
    } catch (e) { /* 回退 */ }
    // 回退估算：非 ASCII 字符按 3 字节计
    let bytes = 0;
    for (let i = 0; i < str.length; i++) {
        const code = str.charCodeAt(i);
        if (code < 0x80) bytes += 1;
        else if (code < 0x800) bytes += 2;
        else bytes += 3;
    }
    return bytes;
}

/**
 * 清理用户全局命名空间（删除用户定义的变量，保留内置与 dunder）
 *
 * 在 pythonExec({ reset: true }) 时调用，提供"每次调用可选 reset"的能力。
 * 不重新加载 pyodide（避免耗时），仅清理 __main__ 命名空间中的用户变量。
 *
 * @param {Object} pyodide - pyodide 实例
 * @returns {void}
 */
function _clearUserGlobals(pyodide) {
    try {
        // 删除所有非 dunder、非内置模块的全局变量
        // 用 Python 代码执行以保证语义正确
        pyodide.runPython(`
import builtins as _ds_builtins
_ds_builtins_names = set(dir(_ds_builtins))
_ds_user_names = [
    k for k in list(globals().keys())
    if not k.startswith('__') and k not in _ds_builtins_names and not k.startswith('_ds_')
]
for _ds_k in _ds_user_names:
    try:
        del globals()[_ds_k]
    except Exception:
        pass
# 清理临时变量
for _ds_k in list(globals().keys()):
    if _ds_k.startswith('_ds_'):
        try:
            del globals()[_ds_k]
        except Exception:
            pass
        `);
    } catch (e) {
        // 清理失败不影响后续执行
    }
}

// ============================================================
// pythonExec — 执行 Python 代码
// ============================================================

/**
 * 执行 Python 代码
 *
 * 调用流程：
 *   1. 校验 code 非空字符串
 *   2. 检查代码字节长度（默认上限 100KB）
 *   3. 确认 pyodide 已加载（首次调用触发懒加载）
 *   4. 可选 reset：清理用户全局命名空间
 *   5. 重定向 stdout/stderr 到收集器（执行前）
 *   6. 调用 runPythonAsync 执行代码（带超时控制）
 *   7. 恢复 stdout/stderr 到默认控制台输出（执行后，try/finally 保证）
 *   8. 格式化结果并返回
 *
 * 返回结构：
 *   - ok: 是否执行成功
 *   - stdout: 标准输出（截断到 OUTPUT_LIMIT_CHARS）
 *   - stderr: 标准错误（截断到 OUTPUT_LIMIT_CHARS）
 *   - result?: 最后一个表达式的值（成功时）
 *   - error?: 错误信息（失败时）
 *   - executionTime?: 执行耗时（毫秒）
 *
 * 超时说明：
 *   - 使用 Promise.race 实现超时控制
 *   - 超时后 Python 可能仍在后台运行（主线程限制，无法真正中断）
 *   - 若环境支持 SharedArrayBuffer，会尝试设置中断缓冲区实现真中断
 *
 * @param {string} code - Python 代码
 * @param {Object} [options] - 执行选项
 * @param {number} [options.timeoutMs=10000] - 执行超时（毫秒）
 * @param {number} [options.codeLimitBytes=102400] - 代码字节长度上限
 * @param {boolean} [options.reset=false] - 执行前清理用户全局命名空间
 * @param {Object} [options.loadOptions] - pyodide 加载选项（首次加载时生效）
 * @returns {Promise<{ok: boolean, stdout: string, stderr: string, result?: string, error?: string, executionTime?: number, truncated?: boolean}>}
 */
export async function pythonExec(code, options = {}) {
    // 1. 参数校验
    if (typeof code !== 'string') {
        return { ok: false, stdout: '', stderr: '', error: 'code 必须是字符串' };
    }
    if (code.trim().length === 0) {
        return { ok: false, stdout: '', stderr: '', error: 'code 不能为空' };
    }

    // 2. 代码长度检查
    const codeLimit = (typeof options.codeLimitBytes === 'number' && options.codeLimitBytes > 0)
        ? options.codeLimitBytes
        : DEFAULT_CODE_LIMIT_BYTES;
    const codeBytes = _byteLength(code);
    if (codeBytes > codeLimit) {
        return {
            ok: false,
            stdout: '',
            stderr: '',
            error: '代码过大：' + codeBytes + ' 字节，超过上限 ' + codeLimit + ' 字节（' + Math.floor(codeLimit / 1024) + 'KB）'
        };
    }

    // 3. 确保 pyodide 已加载（首次调用触发懒加载）
    let pyodide = getPyodideInstance();
    if (!pyodide) {
        try {
            pyodide = await loadPyodide(options.loadOptions || {});
        } catch (err) {
            return {
                ok: false,
                stdout: '',
                stderr: '',
                error: 'pyodide 加载失败：' + (err && err.message || String(err))
            };
        }
    }

    // 4. 可选 reset：清理用户全局命名空间
    if (options.reset === true) {
        _clearUserGlobals(pyodide);
    }

    // 5. 准备 stdout/stderr 收集器
    const stdoutLines = [];
    const stderrLines = [];
    let truncated = false;

    /** 重定向 stdout 到收集器 */
    const stdoutCollector = (text) => {
        if (text !== undefined && text !== null && String(text).length > 0) {
            stdoutLines.push(String(text));
        }
    };
    /** 重定向 stderr 到收集器 */
    const stderrCollector = (text) => {
        if (text !== undefined && text !== null && String(text).length > 0) {
            stderrLines.push(String(text));
        }
    };

    // 尝试设置中断缓冲区（若环境支持 SharedArrayBuffer，可实现真中断）
    let interruptBuffer = null;
    try {
        if (typeof SharedArrayBuffer !== 'undefined' && typeof pyodide.setInterruptBuffer === 'function') {
            interruptBuffer = new Int32Array(new SharedArrayBuffer(4));
            interruptBuffer[0] = 0;
            pyodide.setInterruptBuffer(interruptBuffer.buffer);
        }
    } catch (e) {
        // 不支持中断缓冲区，回退到 Promise.race 超时
    }

    const timeoutMs = (typeof options.timeoutMs === 'number' && options.timeoutMs > 0)
        ? options.timeoutMs
        : DEFAULT_EXEC_TIMEOUT_MS;

    const startedAt = Date.now();
    let result = null;
    let execError = null;
    let timedOut = false;

    // 6. 执行前重定向 stdout/stderr
    try {
        if (typeof pyodide.setStdout === 'function') {
            pyodide.setStdout({ batched: stdoutCollector });
        }
        if (typeof pyodide.setStderr === 'function') {
            pyodide.setStderr({ batched: stderrCollector });
        }

        // 7. 执行代码（带超时控制）
        const execPromise = pyodide.runPythonAsync(code);
        // 防止超时后 execPromise 在后台 reject 导致 unhandled rejection，
        // 并清理可能产生的 pyproxy 结果（超时后 Python 可能仍在后台运行并最终完成）
        execPromise.then(_destroyIfPyProxy, () => { /* 超时后的后台错误已被吞掉 */ });

        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => {
                timedOut = true;
                // 若支持中断缓冲区，触发 SIGINT 中断 Python
                if (interruptBuffer) {
                    try { interruptBuffer[0] = 2; } catch (e) { /* 忽略 */ }
                }
                reject(new Error('Python 执行超时（' + timeoutMs + 'ms），已尝试中断'));
            }, timeoutMs);
        });

        try {
            result = await Promise.race([execPromise, timeoutPromise]);
        } catch (err) {
            execError = err;
        }
    } catch (err) {
        execError = err;
    } finally {
        // 8. 恢复 stdout/stderr 到默认控制台输出（无论成功失败）
        try {
            if (typeof pyodide.setStdout === 'function') {
                pyodide.setStdout({ batched: _defaultStdoutHandler });
            }
            if (typeof pyodide.setStderr === 'function') {
                pyodide.setStderr({ batched: _defaultStderrHandler });
            }
        } catch (e) {
            // 恢复失败忽略
        }
    }

    const executionTime = Date.now() - startedAt;

    // 处理结果
    const stdoutLimited = _limitText(stdoutLines.join('\n'), OUTPUT_LIMIT_CHARS);
    const stderrLimited = _limitText(stderrLines.join('\n'), OUTPUT_LIMIT_CHARS);
    if (stdoutLimited.truncated || stderrLimited.truncated) {
        truncated = true;
    }

    if (execError) {
        // 超时或执行异常
        const errMsg = execError && execError.message ? execError.message : String(execError);
        const stderrWithErr = _limitText(
            [stderrLimited.text, timedOut ? '' : (execError && execError.stack ? String(execError.stack) : errMsg)]
                .filter(Boolean).join('\n'),
            OUTPUT_LIMIT_CHARS
        );
        return {
            ok: false,
            stdout: stdoutLimited.text,
            stderr: stderrWithErr.text,
            error: timedOut ? 'sandbox_timeout' : errMsg,
            executionTime,
            truncated: truncated || stderrWithErr.truncated
        };
    }

    // 成功：格式化结果
    let resultStr = '';
    try {
        resultStr = _formatPythonValue(result);
    } catch (e) {
        resultStr = '';
    } finally {
        _destroyIfPyProxy(result);
    }

    return {
        ok: true,
        stdout: stdoutLimited.text,
        stderr: stderrLimited.text,
        result: resultStr,
        executionTime,
        truncated
    };
}

// ============================================================
// installPackage — 安装 Python 包
// ============================================================

/**
 * 安装纯 Python 包（经 micropip）
 *
 * 注意事项：
 *   - pyodide 只支持纯 Python 包或预编译的 WASM 包
 *   - 不支持 C 扩展（如 numpy 需用 pyodide 内置版本，经 loadPackage 加载）
 *   - micropip.install 默认从 PyPI 下载，需要网络访问
 *   - 安装的包仅在当前 pyodide 实例生命周期内有效，重置运行时后需重新安装
 *
 * @param {string} name - 包名（如 'requests'）或包名==版本（如 'requests==2.31.0'）
 * @param {Object} [options] - 安装选项
 * @param {boolean} [options.fromPyPI=true] - 是否从 PyPI 安装（默认 true）
 * @returns {Promise<{ok: boolean, name?: string, version?: string, error?: string}>}
 */
export async function installPackage(name, options = {}) {
    if (typeof name !== 'string' || !name.trim()) {
        return { ok: false, error: '包名不能为空' };
    }
    const pkgName = name.trim();

    // 确保 pyodide 已加载
    let pyodide = getPyodideInstance();
    if (!pyodide) {
        try {
            pyodide = await loadPyodide();
        } catch (err) {
            return { ok: false, error: 'pyodide 加载失败：' + (err && err.message || String(err)) };
        }
    }

    try {
        // 加载 micropip（pyodide 内置包，需先 loadPackage）
        if (typeof pyodide.loadPackage === 'function') {
            await pyodide.loadPackage('micropip');
        }

        // 经 micropip 安装包
        // 注意：micropip.install 是异步的，需用 runPythonAsync + await
        const installCode = `
import micropip as _ds_micropip
_ds_install_result = None
_ds_install_error = None
try:
    _ds_install_result = await _ds_micropip.install(${JSON.stringify(pkgName)})
except Exception as _e:
    _ds_install_error = str(_e)
`;
        await pyodide.runPythonAsync(installCode);

        // 读取安装结果与错误
        const installError = pyodide.globals.get('_ds_install_error');
        if (installError) {
            const errStr = typeof installError === 'string' ? installError : String(installError);
            _destroyIfPyProxy(installError);
            return { ok: false, name: pkgName, error: '安装失败：' + errStr };
        }
        _destroyIfPyProxy(installError);

        // 读取已安装版本
        let version = '';
        try {
            const versionQuery = await pyodide.runPythonAsync(`
import importlib.metadata as _ds_im
try:
    _ds_pkg_version = _ds_im.version(${JSON.stringify(pkgName.split('==')[0].split('>=')[0].split('<=')[0].split('~=')[0].split('>')[0].split('<')[0].trim())})
except Exception:
    _ds_pkg_version = ''
_ds_pkg_version
`);
            version = typeof versionQuery === 'string' ? versionQuery : String(versionQuery || '');
            _destroyIfPyProxy(versionQuery);
        } catch (e) {
            // 版本查询失败不影响安装结果
        }

        return { ok: true, name: pkgName.split('==')[0].split('>=')[0].split('<=')[0].split('~=')[0].split('>')[0].split('<')[0].trim(), version };
    } catch (err) {
        return { ok: false, name: pkgName, error: '安装异常：' + (err && err.message || String(err)) };
    }
}

// ============================================================
// listInstalledPackages — 列出已安装包
// ============================================================

/**
 * 列出已安装的 Python 包
 *
 * 数据来源：
 *   1. pyodide.loadedPackages — 经 loadPackage 加载的内置包（如 numpy、micropip）
 *   2. micropip.list() — 经 micropip 安装的纯 Python 包
 *
 * @returns {Promise<{ok: boolean, packages?: Array<{name: string, version: string, source: string}>, error?: string}>}
 */
export async function listInstalledPackages() {
    // 确保 pyodide 已加载
    let pyodide = getPyodideInstance();
    if (!pyodide) {
        try {
            pyodide = await loadPyodide();
        } catch (err) {
            return { ok: false, error: 'pyodide 加载失败：' + (err && err.message || String(err)) };
        }
    }

    const packages = [];

    try {
        // 1. 收集 pyodide 内置包（loadedPackages）
        try {
            const loaded = pyodide.loadedPackages || {};
            if (loaded && typeof loaded === 'object') {
                for (const k of Object.keys(loaded)) {
                    packages.push({ name: k, version: '', source: 'builtin' });
                }
            }
        } catch (e) {
            // 忽略内置包收集失败
        }

        // 2. 收集 micropip 安装的包
        try {
            if (typeof pyodide.loadPackage === 'function') {
                await pyodide.loadPackage('micropip');
            }
            const listCode = `
import micropip as _ds_micropip
try:
    _ds_pkg_list = _ds_micropip.list()
except Exception:
    _ds_pkg_list = {}
_ds_pkg_list
`;
            const result = await pyodide.runPythonAsync(listCode);
            if (result) {
                // micropip.list() 返回 dict {name: version} 或 list of tuples
                let pkgDict = result;
                try {
                    // 若是 pyproxy，转换为 JS 对象
                    if (result && typeof result === 'object' && 'toJs' in result && typeof result.toJs === 'function') {
                        pkgDict = result.toJs();
                    }
                } catch (e) {
                    pkgDict = result;
                }
                // 遍历并收集
                if (pkgDict && typeof pkgDict === 'object') {
                    if (Array.isArray(pkgDict)) {
                        // 列表形式：[[name, version], ...]
                        for (const item of pkgDict) {
                            if (Array.isArray(item) && item.length >= 2) {
                                packages.push({ name: String(item[0]), version: String(item[1]), source: 'micropip' });
                            } else if (item) {
                                packages.push({ name: String(item), version: '', source: 'micropip' });
                            }
                        }
                    } else {
                        // 字典形式：{name: version}
                        for (const k of Object.keys(pkgDict)) {
                            packages.push({ name: k, version: String(pkgDict[k] || ''), source: 'micropip' });
                        }
                    }
                }
            }
            _destroyIfPyProxy(result);
        } catch (e) {
            // micropip 不可用时仅返回内置包
        }
    } catch (err) {
        return { ok: false, error: '列举包失败：' + (err && err.message || String(err)) };
    }

    // 去重（同名包优先保留 micropip 来源）
    const seen = new Map();
    for (const pkg of packages) {
        if (!seen.has(pkg.name)) {
            seen.set(pkg.name, pkg);
        } else if (pkg.source === 'micropip') {
            seen.set(pkg.name, pkg);
        }
    }

    return { ok: true, packages: Array.from(seen.values()) };
}

// ============================================================
// resetPythonEnv — 彻底重置执行环境
// ============================================================

/**
 * 彻底重置 Python 执行环境
 *
 * 调用 resetPyodideRuntime() 释放 pyodide 实例，
 * 下次 pythonExec 时会重新加载 pyodide（耗时）。
 *
 * 适用场景：
 *   - 执行环境被严重污染（变量冲突、模块状态异常）
 *   - 安装了有问题的包需要恢复干净环境
 *   - 长时间运行后释放内存
 *
 * @returns {void}
 */
export function resetPythonEnv() {
    resetPyodideRuntime();
}

// ============================================================
// 就绪状态查询
// ============================================================

/**
 * 判断 Python 沙箱是否已就绪（pyodide 已加载）
 * @returns {boolean} true 表示已就绪
 */
export function isSandboxReady() {
    return isPyodideLoaded();
}
