#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""DeepSeekClient 构建脚本

功能：
  1. 从 icon.png 自动生成 Android 各尺寸图标与 Windows .ico 文件
  2. 同步 dspro.js 到 shared 模块资源目录（更新脚本后重新构建）
  3. 支持构建 APK（Android 签名）或 Electron EXE（Desktop）
  4. 构建完成后复制产物至本目录的 output 文件夹
  5. 构建 JS 后自动启动 HTTP 服务，供浏览器安装/更新油猴脚本（10 秒或按回车关闭）

用法：
  python build.py            # 交互式菜单
  python build.py --apk      # 仅构建 APK
  python build.py --exe      # 仅构建 Electron EXE
  python build.py --all      # 构建全部
  python build.py --icons-only  # 仅生成图标
  python build.py --js-only     # 仅构建 JS (webpack 打包 + 同步到 shared + Electron)
  python build.py --desktop-only  # 仅构建桌面端脚本 (dspro.desktop.js + 同步到 Electron)
  python build.py --mobile-only   # 仅构建移动端脚本 (dspro.mobile.js + 同步到 shared)
  python build.py --version-only  # 仅修改 Android 版本号 (交互式)
  python build.py --no-icons    # 跳过图标生成
  python build.py --no-js       # 跳过 JS 构建
  python build.py --no-serve    # 跳过自动启动 HTTP 服务
"""

import argparse
import re
import shutil
import subprocess
import sys
from pathlib import Path
import http.server
import socketserver
import threading
import webbrowser   # 新增：自动打开浏览器


def wait_exit():
    """等待用户按任意键退出（Windows 优先使用 msvcrt，其他平台回退到 input）。"""
    print("\n" + "=" * 40)
    print("按任意键退出...")
    try:
        import msvcrt
        msvcrt.getch()
    except ImportError:
        try:
            input()
        except EOFError:
            pass

try:
    from PIL import Image
except ImportError:
    print("[错误] 需要 Pillow 库，请运行: pip install Pillow")
    sys.exit(1)

# ============================================================
# 路径常量
# ============================================================
SCRIPT_DIR = Path(__file__).parent.resolve()
PROJECT_DIR = SCRIPT_DIR / "DeepSeekClient"
OUTPUT_DIR = SCRIPT_DIR / "output"

# 图标源文件与产物路径
ICON_SRC = SCRIPT_DIR / "icon.png"
BUILD_RESOURCES = PROJECT_DIR / "build-resources"
ICO_PATH = BUILD_RESOURCES / "DeepSeek.ico"
RES_DIR = PROJECT_DIR / "androidApp" / "src" / "main" / "res"

# js 模块化源码目录与构建产物路径
JS_DIR = SCRIPT_DIR / "js"
JS_DIST_DIR = JS_DIR / "dist"
JS_DIST_USER = JS_DIST_DIR / "dspro.user.js"
JS_DIST_WEBVIEW = JS_DIST_DIR / "dspro.js"
JS_DIST_DESKTOP = JS_DIST_DIR / "dspro.desktop.js"
JS_DIST_EARLY_BOOT = JS_DIST_DIR / "dspro.early-boot.js"
JS_DIST_MOBILE = JS_DIST_DIR / "dspro.mobile.js"

DSPRO_USER_JS_SRC = SCRIPT_DIR / "dspro.user.js"

SHARED_RESOURCES = PROJECT_DIR / "shared" / "src" / "commonMain" / "resources"
DSPRO_JS_DST = SHARED_RESOURCES / "dspro.js"
DSPRO_EARLY_BOOT_DST = SHARED_RESOURCES / "dspro.early-boot.js"
DSPRO_MOBILE_DST = SHARED_RESOURCES / "dspro.mobile.js"

JS_DIST_ARTIFACTS = [
    ("dspro.user.js (篡改猴版)", JS_DIST_USER),
    ("dspro.js (WebView 主脚本)", JS_DIST_WEBVIEW),
    ("dspro.desktop.js (Electron 桌面端专属)", JS_DIST_DESKTOP),
    ("dspro.early-boot.js (WebView 早注入 stub)", JS_DIST_EARLY_BOOT),
    ("dspro.mobile.js (移动端专属脚本)", JS_DIST_MOBILE),
]

GRADLEW = PROJECT_DIR / "gradlew.bat"

# Electron 项目路径
ELECTRON_DIR = SCRIPT_DIR / "deepseek-electron"
ELECTRON_DIST_DIR = ELECTRON_DIR / "dist3"
ELECTRON_RESOURCES = ELECTRON_DIR / "resources"

ANDROID_GRADLE = PROJECT_DIR / "androidApp" / "build.gradle.kts"

ANDROID_ICON_SIZES = {
    "mipmap-mdpi": 48,
    "mipmap-hdpi": 72,
    "mipmap-xhdpi": 96,
    "mipmap-xxhdpi": 144,
    "mipmap-xxxhdpi": 192,
}

FOREGROUND_SIZES = {
    "mipmap-mdpi": 108,
    "mipmap-hdpi": 162,
    "mipmap-xhdpi": 216,
    "mipmap-xxhdpi": 324,
    "mipmap-xxxhdpi": 432,
}


# ============================================================
# 图标生成
# ============================================================
def generate_icons():
    """从 icon.png 生成 Android 各尺寸 PNG 图标与 Windows .ico 文件。"""
    if not ICON_SRC.exists():
        print(f"[错误] 找不到图标源文件: {ICON_SRC}")
        sys.exit(1)

    print("[图标] 生成 Android 图标与 .ico ...")
    src = Image.open(ICON_SRC).convert("RGBA")

    for folder, size in ANDROID_ICON_SIZES.items():
        out_dir = RES_DIR / folder
        out_dir.mkdir(parents=True, exist_ok=True)
        img = src.resize((size, size), Image.LANCZOS)
        img.save(out_dir / "ic_launcher.png")
        img.save(out_dir / "ic_launcher_round.png")

    for folder, size in FOREGROUND_SIZES.items():
        out_dir = RES_DIR / folder
        out_dir.mkdir(parents=True, exist_ok=True)
        fg = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        icon_size = int(size * 72 / 108)
        icon = src.resize((icon_size, icon_size), Image.LANCZOS)
        offset = ((size - icon_size) // 2, (size - icon_size) // 2)
        fg.paste(icon, offset, icon)
        fg.save(out_dir / "ic_launcher_foreground.png")

    BUILD_RESOURCES.mkdir(parents=True, exist_ok=True)
    src.save(
        ICO_PATH,
        format="ICO",
        sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )

    print(f"  Android 图标: {len(ANDROID_ICON_SIZES)} 套密度")
    print(f"  ICO 文件: {ICO_PATH.name}")


# ============================================================
# JS 模块化构建
# ============================================================
def build_js():
    """使用 webpack 将 js/src/ 模块化源码打包为 4 个产物。"""
    print("[构建] JS 模块化打包 (webpack 多入口构建)...")

    if not JS_DIR.exists():
        print(f"  [错误] JS 源码目录不存在: {JS_DIR}")
        sys.exit(1)

    node_modules = JS_DIR / "node_modules"
    if not node_modules.exists():
        print("  [依赖] node_modules 不存在，正在安装依赖（使用代理）...")
        proxy_env = {
            "HTTP_PROXY": "http://127.0.0.1:10808",
            "HTTPS_PROXY": "http://127.0.0.1:10808",
        }
        if not run_cmd("npm install", cwd=JS_DIR, shell=True, env=proxy_env):
            print("[失败] npm install 失败")
            sys.exit(1)

    if not run_cmd("npm run build", cwd=JS_DIR, shell=True):
        print("[失败] webpack 构建失败")
        sys.exit(1)

    missing = []
    for label, path in JS_DIST_ARTIFACTS:
        if path.exists():
            size_kb = path.stat().st_size / 1024
            print(f"  {label}: {size_kb:.1f} KB")
        else:
            print(f"  [错误] 构建产物缺失: {path}")
            missing.append(path)

    if missing:
        print(f"[失败] 共 {len(missing)} 个产物缺失，请检查 webpack.config.js")
        sys.exit(1)

    shutil.copy2(JS_DIST_USER, DSPRO_USER_JS_SRC)
    print(f"  已复制篡改猴版到根目录: {DSPRO_USER_JS_SRC.name}")

    user_js_path = SCRIPT_DIR / "script.user.js"
    shutil.copy2(JS_DIST_USER, user_js_path)
    print(f"  已创建用户脚本副本: {user_js_path.name}")


# ============================================================
# 桌面端脚本构建
# ============================================================
def build_desktop_js():
    """仅构建桌面端专属脚本 dspro.desktop.js 并同步到 Electron 资源目录。"""
    build_js()

    print("[同步] 桌面端脚本 -> Electron resources/")
    ELECTRON_RESOURCES.mkdir(parents=True, exist_ok=True)
    shutil.copy2(JS_DIST_DESKTOP, ELECTRON_RESOURCES / "dspro.desktop.js")
    size_kb = JS_DIST_DESKTOP.stat().st_size / 1024
    print(f"  dspro.desktop.js ({size_kb:.1f} KB)")


def build_mobile_js():
    """仅构建移动端专属脚本 dspro.mobile.js 并同步到 shared 资源目录。"""
    build_js()

    print("[同步] 移动端脚本 -> shared/src/commonMain/resources/")
    SHARED_RESOURCES.mkdir(parents=True, exist_ok=True)
    shutil.copy2(JS_DIST_MOBILE, DSPRO_MOBILE_DST)
    size_kb = DSPRO_MOBILE_DST.stat().st_size / 1024
    print(f"  dspro.mobile.js ({size_kb:.1f} KB)")


# ============================================================
# dspro.js 同步
# ============================================================
def sync_dspro_js():
    """构建 JS 并同步 3 个 WebView 产物到 shared 模块资源目录。"""
    build_js()

    print("[同步] WebView 产物 -> shared/src/commonMain/resources/")
    SHARED_RESOURCES.mkdir(parents=True, exist_ok=True)

    shutil.copy2(JS_DIST_WEBVIEW, DSPRO_JS_DST)
    size_kb = DSPRO_JS_DST.stat().st_size / 1024
    print(f"  dspro.js            ({size_kb:.1f} KB)")

    shutil.copy2(JS_DIST_EARLY_BOOT, DSPRO_EARLY_BOOT_DST)
    size_kb = DSPRO_EARLY_BOOT_DST.stat().st_size / 1024
    print(f"  dspro.early-boot.js ({size_kb:.1f} KB)")

    shutil.copy2(JS_DIST_MOBILE, DSPRO_MOBILE_DST)
    size_kb = DSPRO_MOBILE_DST.stat().st_size / 1024
    print(f"  dspro.mobile.js     ({size_kb:.1f} KB)")

    # 同步桌面端脚本到 Electron 资源目录
    print("[同步] 桌面端脚本 -> Electron resources/")
    ELECTRON_RESOURCES.mkdir(parents=True, exist_ok=True)
    shutil.copy2(JS_DIST_DESKTOP, ELECTRON_RESOURCES / "dspro.desktop.js")
    shutil.copy2(JS_DIST_WEBVIEW, ELECTRON_RESOURCES / "dspro.js")
    shutil.copy2(JS_DIST_EARLY_BOOT, ELECTRON_RESOURCES / "early-boot.js")
    size_kb = JS_DIST_DESKTOP.stat().st_size / 1024
    print(f"  dspro.desktop.js    ({size_kb:.1f} KB)")
    print(f"  dspro.js            ({JS_DIST_WEBVIEW.stat().st_size / 1024:.1f} KB)")
    print(f"  early-boot.js       ({JS_DIST_EARLY_BOOT.stat().st_size / 1024:.1f} KB)")


# ============================================================
# 命令执行
# ============================================================
def run_cmd(cmd, cwd=None, shell=False, env=None):
    """运行命令并实时输出，返回是否成功。

    Args:
        cmd: 命令列表
        cwd: 工作目录
        shell: 是否使用 shell 执行
        env: 额外的环境变量（dict），会合并到当前环境中
    """
    cwd = cwd or PROJECT_DIR
    print(f"  $ {' '.join(str(c) for c in cmd)}")
    # 合并环境变量
    run_env = None
    if env:
        import os
        run_env = os.environ.copy()
        run_env.update(env)
    result = subprocess.run(cmd, cwd=str(cwd), shell=shell, env=run_env)
    return result.returncode == 0


def force_rmtree(path):
    """强制删除目录树，处理只读文件。"""
    import os
    import stat

    def _onerror(func, p, exc_info):
        os.chmod(p, stat.S_IWRITE)
        func(p)

    shutil.rmtree(path, onerror=_onerror)


# ============================================================
# Android 版本号修改
# ============================================================
def read_android_version():
    """从 androidApp/build.gradle.kts 读取当前 versionCode 与 versionName。"""
    if not ANDROID_GRADLE.exists():
        return None, None
    text = ANDROID_GRADLE.read_text(encoding="utf-8")
    code_match = re.search(r"versionCode\s*=\s*(\d+)", text)
    name_match = re.search(r'versionName\s*=\s*"([^"]*)"', text)
    version_code = code_match.group(1) if code_match else None
    version_name = name_match.group(1) if name_match else None
    return version_code, version_name


def modify_android_version():
    """交互式修改 androidApp/build.gradle.kts 的 versionCode 与 versionName。"""
    if not ANDROID_GRADLE.exists():
        print(f"[错误] 找不到 Android 构建脚本: {ANDROID_GRADLE}")
        sys.exit(1)

    current_code, current_name = read_android_version()
    if current_code is None or current_name is None:
        print("[错误] 无法从 build.gradle.kts 解析当前版本号")
        sys.exit(1)

    print("\n[版本] 修改 Android 版本号")
    print(f"  当前版本号: {current_name}")
    print(f"  当前版本代号: {current_code}")

    new_name = input(f"请输入修改的版本号（当前版本号{current_name}）: ").strip()
    new_code = input(f"请输入修改的版本代号（当前版本代号{current_code}）: ").strip()

    if not new_name and not new_code:
        print("[提示] 未输入任何变更，跳过修改。")
        return

    if new_code and not new_code.isdigit():
        print(f"[错误] 版本代号必须为正整数，输入: {new_code}")
        sys.exit(1)

    text = ANDROID_GRADLE.read_text(encoding="utf-8")
    if new_name:
        text = re.sub(
            r'versionName\s*=\s*"[^"]*"',
            f'versionName = "{new_name}"',
            text,
        )
    if new_code:
        text = re.sub(
            r"versionCode\s*=\s*\d+",
            f"versionCode = {new_code}",
            text,
        )

    ANDROID_GRADLE.write_text(text, encoding="utf-8")
    final_code = new_code or current_code
    final_name = new_name or current_name
    print(f"\n[完成] 已更新 Android 版本号")
    print(f"  版本号: {current_name} -> {final_name}")
    print(f"  版本代号: {current_code} -> {final_code}")
    print(f"  文件: {ANDROID_GRADLE}")


# ============================================================
# APK 构建
# ============================================================
def build_apk():
    """构建签名 Release APK。"""
    print("\n[构建] Android APK（签名 Release）...")
    cmd = [str(GRADLEW), ":androidApp:assembleRelease", "--console=plain", "--no-daemon"]
    if not run_cmd(cmd):
        print("[失败] APK 构建失败")
        sys.exit(1)

    apk = PROJECT_DIR / "androidApp/build/outputs/apk/release/androidApp-release.apk"
    if not apk.exists():
        apk = PROJECT_DIR / "androidApp/build/outputs/apk/release/androidApp-release-unsigned.apk"
    if not apk.exists():
        print("[失败] 找不到构建产物 APK")
        sys.exit(1)

    size_mb = apk.stat().st_size / (1024 * 1024)
    print(f"  APK: {apk.name} ({size_mb:.2f} MB)")
    return apk


# ============================================================
# ADB 安装
# ============================================================
def find_adb():
    """定位 adb 可执行文件路径。"""
    import os
    sdk = os.environ.get("ANDROID_HOME") or os.environ.get("ANDROID_SDK_ROOT")
    if sdk:
        candidate = Path(sdk) / "platform-tools" / "adb.exe"
        if candidate.exists():
            return str(candidate)
    return "adb"


def install_apk(apk_path):
    """通过 adb 将 APK 安装到已连接的 Android 设备。"""
    print("\n[安装] 通过 adb 安装到已连接设备...")
    adb = find_adb()

    devices_cmd = [adb, "devices"]
    print(f"  $ {' '.join(devices_cmd)}")
    try:
        result = subprocess.run(devices_cmd, capture_output=True, text=True)
    except FileNotFoundError:
        print(f"  [警告] 未找到 adb 可执行文件，请将 ANDROID_HOME 加入环境变量或将 adb 加入 PATH")
        print(f"  可手动安装: adb install -r \"{apk_path}\"")
        return False

    lines = [ln for ln in result.stdout.splitlines() if ln.strip()]
    device_lines = [ln for ln in lines if "\tdevice" in ln]
    if not device_lines:
        print("  [警告] 未检测到已连接的设备（请确认 USB 调试已开启并已授权）")
        print(f"  可手动安装: adb install -r \"{apk_path}\"")
        return False

    install_cmd = [adb, "install", "-r", "-d", str(apk_path)]
    print(f"  $ {' '.join(install_cmd)}")
    install_result = subprocess.run(install_cmd)
    if install_result.returncode == 0:
        print("  安装成功")
        return True
    else:
        print("  [警告] adb 安装失败，请查看上方输出")
        print(f"  可手动安装: adb install -r \"{apk_path}\"")
        return False


# ============================================================
# Electron 桌面应用构建
# ============================================================
def build_electron():
    """构建 Electron 桌面应用（electron-builder --win dir，便携文件夹）。"""
    print("\n[构建] Electron 桌面应用...")

    if not ELECTRON_DIR.exists():
        print(f"[警告] 找不到 Electron 项目目录: {ELECTRON_DIR}，跳过 Electron 构建")
        return None

    # 代理环境变量（仅下载依赖时使用）
    proxy_env = {
        "HTTP_PROXY": "http://127.0.0.1:10808",
        "HTTPS_PROXY": "http://127.0.0.1:10808",
        "ELECTRON_MIRROR": "https://npmmirror.com/mirrors/electron/",
    }

    # 1. 安装依赖（如果 node_modules 不存在）
    node_modules = ELECTRON_DIR / "node_modules"
    if not node_modules.exists():
        print("  [依赖] node_modules 不存在，正在安装依赖（使用代理）...")
        if not run_cmd("npm install", cwd=ELECTRON_DIR, shell=True, env=proxy_env):
            print("[警告] npm install 失败，跳过 Electron 构建")
            return None

    # 2. 同步 JS 产物到 Electron resources
    print("  同步 JS 产物到 Electron resources/")
    ELECTRON_RESOURCES.mkdir(parents=True, exist_ok=True)
    shutil.copy2(JS_DIST_EARLY_BOOT, ELECTRON_RESOURCES / "early-boot.js")
    shutil.copy2(JS_DIST_WEBVIEW, ELECTRON_RESOURCES / "dspro.js")
    shutil.copy2(JS_DIST_DESKTOP, ELECTRON_RESOURCES / "dspro.desktop.js")
    print(f"    early-boot.js ({JS_DIST_EARLY_BOOT.stat().st_size / 1024:.1f} KB)")
    print(f"    dspro.js ({JS_DIST_WEBVIEW.stat().st_size / 1024:.1f} KB)")
    print(f"    dspro.desktop.js ({JS_DIST_DESKTOP.stat().st_size / 1024:.1f} KB)")

    # 3. 同步图标（electron-builder 使用 icon.png，.ico 用于最终 exe 图标）
    if ICON_SRC.exists():
        shutil.copy2(ICON_SRC, ELECTRON_RESOURCES / "icon.png")
        print(f"    图标已同步: icon.png")
    if ICO_PATH.exists():
        shutil.copy2(ICO_PATH, ELECTRON_RESOURCES / "icon.ico")
        print(f"    图标已同步: icon.ico")

    # 4. 运行 electron-builder（使用代理 + 国内镜像）
    print("  执行 npm run build (electron-builder --win --dir)...")
    if not run_cmd("npm run build", cwd=ELECTRON_DIR, shell=True, env=proxy_env):
        print("[警告] Electron 构建失败，跳过产物复制")
        return None

    # 5. 返回整个 win-unpacked 便携文件夹
    unpacked = ELECTRON_DIST_DIR / "win-unpacked"
    if unpacked.exists() and unpacked.is_dir():
        total_size = sum(f.stat().st_size for f in unpacked.rglob("*") if f.is_file())
        print(f"  win-unpacked/ ({total_size / (1024*1024):.0f} MB)")
        return unpacked
    else:
        print(f"[警告] 找不到构建产物 win-unpacked/ (在 {ELECTRON_DIST_DIR} 中查找)")
        return None


# ============================================================
# 产物复制
# ============================================================
def copy_to_output(artifacts):
    """将构建产物复制到 output 文件夹。"""
    print("\n[复制] 产物 -> output/")
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    for name, path in artifacts:
        src_path = Path(path)
        if not src_path.exists():
            print(f"  [警告] 产物不存在: {path}")
            continue
        if src_path.is_dir():
            dst = OUTPUT_DIR / name
            if dst.exists():
                force_rmtree(dst)
            shutil.copytree(src_path, dst)
            print(f"  {name}/ -> output/{name}/")
        else:
            shutil.copy2(src_path, OUTPUT_DIR / name)
            print(f"  {name} -> output/{name}")
    print(f"\n输出目录: {OUTPUT_DIR}")


# ============================================================
# HTTP 服务引导更新油猴脚本（自动打开链接）
# ============================================================
def serve_js_script(file_path: Path, port: int = 8000):
    """在独立线程中启动 python -m http.server，并自动打开浏览器。"""
    if not file_path.exists():
        print(f"[警告] 文件不存在: {file_path}，跳过 HTTP 服务")
        return

    def _run_server():
        """线程目标：启动 HTTP 服务器子进程。"""
        proc = subprocess.Popen(
            [sys.executable, "-m", "http.server", str(port)],
            cwd=str(SCRIPT_DIR),
        )
        proc.wait()

    server_thread = threading.Thread(target=_run_server, daemon=True)
    server_thread.start()

    url = f"http://localhost:{port}/{file_path.name}"
    print("\n" + "=" * 50)
    print("[HTTP服务] 已启动")
    print(f"  地址: http://localhost:{port}/")
    print(f"  脚本: {url}")
    print("  正在自动打开浏览器...")
    print("=" * 50)

    webbrowser.open_new_tab(url)


# ============================================================
# 任务执行
# ============================================================
def run_task(args):
    """执行单次构建任务（图标生成 / JS 构建 / APK / EXE / 复制 / 安装）。"""
    if args.all:
        args.apk = True
        args.exe = True

    if args.icons_only:
        generate_icons()
        print("\n图标生成完成!")
        return

    if args.js_only:
        sync_dspro_js()   # 内部调用 build_js + 同步
        # 启动 HTTP 服务（除非显式跳过）
        if not args.no_serve:
            serve_js_script(DSPRO_USER_JS_SRC)
        print("\nJS 构建完成!")
        return

    if args.desktop_only:
        build_desktop_js()
        print("\n桌面端脚本构建完成!")
        return

    if args.mobile_only:
        build_mobile_js()
        print("\n移动端脚本构建完成!")
        return

    if args.version_only:
        modify_android_version()
        return

    if not args.no_icons:
        generate_icons()

    if not args.no_js:
        sync_dspro_js()
    else:
        print("[跳过] JS 构建 (--no-js)")

    artifacts = []
    built_apk = None
    if args.apk:
        built_apk = build_apk()
        if built_apk is not None:
            artifacts.append(("DeepSeek.apk", built_apk))
    if args.exe:
        exe_dir = build_electron()
        if exe_dir is not None:
            artifacts.append(("DeepSeek", exe_dir))

    if artifacts:
        copy_to_output(artifacts)

    if built_apk is not None and not args.no_install:
        install_apk(built_apk)

    print("\n构建完成!")


def make_args(**kwargs):
    """构造一个带默认值的 argparse.Namespace，供交互菜单使用。"""
    defaults = {
        "apk": False, "exe": False, "all": False,
        "icons_only": False, "js_only": False, "desktop_only": False, "mobile_only": False, "version_only": False,
        "no_icons": False, "no_js": False, "no_install": False, "no_serve": False,
    }
    defaults.update(kwargs)
    return argparse.Namespace(**defaults)


def show_menu():
    """显示交互式主菜单，返回用户选择对应的 args 对象；选择退出返回 None。"""
    cur_code, cur_name = read_android_version()
    version_hint = ""
    if cur_name and cur_code:
        version_hint = f" (当前 {cur_name} / {cur_code})"

    print("\n" + "=" * 40)
    print("=== DeepSeekClient 构建脚本 ===")
    print("  1. 构建 APK (Android)")
    print("  2. 构建 EXE (Electron Desktop)")
    print("  3. 构建全部 (APK + Electron EXE)")
    print("  4. 仅生成图标")
    print("  5. 仅构建 JS (webpack 5 产物 + 同步到 shared + Electron)")
    print("  6. 仅构建桌面端脚本 (dspro.desktop.js + 同步到 Electron)")
    print("  7. 仅构建移动端脚本 (dspro.mobile.js + 同步到 shared)")
    print(f"  8. 修改 Android 版本号{version_hint}")
    print("  0. 退出")
    choice = input("请选择 [0-8]: ").strip()
    mapping = {
        "1": make_args(apk=True),
        "2": make_args(exe=True),
        "3": make_args(all=True),
        "4": make_args(icons_only=True),
        "5": make_args(js_only=True),
        "6": make_args(desktop_only=True),
        "7": make_args(mobile_only=True),
        "8": make_args(version_only=True),
    }
    return mapping.get(choice, None)


# ============================================================
# 主入口
# ============================================================
def main():
    """主入口：解析参数并执行构建任务。返回 True 表示需要等待用户退出，False 表示直接退出。"""
    parser = argparse.ArgumentParser(description="DeepSeekClient 构建脚本")
    parser.add_argument("--apk", action="store_true", help="构建 Android APK")
    parser.add_argument("--exe", action="store_true", help="构建 Electron Desktop EXE")
    parser.add_argument("--all", action="store_true", help="构建全部 (APK + EXE)")
    parser.add_argument("--icons-only", action="store_true", help="仅生成图标")
    parser.add_argument("--js-only", action="store_true", help="仅构建 JS (webpack 打包 + 同步)")
    parser.add_argument("--desktop-only", action="store_true", help="仅构建桌面端脚本 (dspro.desktop.js + 同步到 Electron)")
    parser.add_argument("--mobile-only", action="store_true", help="仅构建移动端脚本 (dspro.mobile.js + 同步到 shared)")
    parser.add_argument("--version-only", action="store_true", help="仅修改 Android 版本号 (交互式)")
    parser.add_argument("--no-icons", action="store_true", help="跳过图标生成")
    parser.add_argument("--no-js", action="store_true", help="跳过 JS 构建")
    parser.add_argument("--no-install", action="store_true", help="跳过构建后 adb 自动安装")
    parser.add_argument("--no-serve", action="store_true", help="跳过自动启动 HTTP 服务")
    args = parser.parse_args()

    if any([args.apk, args.exe, args.all, args.icons_only, args.js_only, args.desktop_only, args.mobile_only, args.version_only]):
        run_task(args)
        return False  # 参数模式：任务完成后直接退出

    print("已进入循环模式，任务完成后自动返回主菜单。选择 0 退出。")
    while True:
        task_args = show_menu()
        if task_args is None:
            print("再见!")
            return True  # 交互模式：等待用户按键退出
        try:
            run_task(task_args)
        except SystemExit:
            print("\n[提示] 任务执行出错，返回主菜单。")


if __name__ == "__main__":
    should_wait = main()
    if should_wait:
        wait_exit()
