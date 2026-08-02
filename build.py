#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""DeepSeekClient 构建脚本

功能：
  1. 从 icon.png 自动生成 Android 各尺寸图标与 Windows .ico 文件
  2. 同步 dspro.js 到 shared 模块资源目录（更新脚本后重新构建）
  3. 支持选择构建 APK（Android 签名）或 EXE（Desktop jpackage）
  4. 构建完成后复制产物至本目录的 output 文件夹

用法：
  python build.py            # 交互式菜单
  python build.py --apk      # 仅构建 APK
  python build.py --exe      # 仅构建 EXE
  python build.py --all      # 构建全部
  python build.py --icons-only  # 仅生成图标
  python build.py --no-icons    # 跳过图标生成
"""

import argparse
import shutil
import subprocess
import sys
from pathlib import Path


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

# dspro.js 模块化源码目录与构建产物路径
JS_DIR = SCRIPT_DIR / "js"
JS_DIST = JS_DIR / "dist" / "dspro.js"

# dspro.js 源文件与目标路径（同步到 shared 资源目录）
DSPRO_JS_SRC = SCRIPT_DIR / "dspro.js"
DSPRO_JS_DST = PROJECT_DIR / "shared" / "src" / "commonMain" / "resources" / "dspro.js"

# 构建工具路径
GRADLEW = PROJECT_DIR / "gradlew.bat"
JPACKAGE = Path("C:/Program Files/Java/jdk-21.0.10/bin/jpackage.exe")

# Android 图标各密度尺寸（dp -> px）
ANDROID_ICON_SIZES = {
    "mipmap-mdpi": 48,
    "mipmap-hdpi": 72,
    "mipmap-xhdpi": 96,
    "mipmap-xxhdpi": 144,
    "mipmap-xxxhdpi": 192,
}

# Adaptive icon foreground 各密度尺寸（108dp）
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

    # 生成普通启动器图标（ic_launcher.png / ic_launcher_round.png）
    for folder, size in ANDROID_ICON_SIZES.items():
        out_dir = RES_DIR / folder
        out_dir.mkdir(parents=True, exist_ok=True)
        img = src.resize((size, size), Image.LANCZOS)
        img.save(out_dir / "ic_launcher.png")
        img.save(out_dir / "ic_launcher_round.png")

    # 生成 adaptive icon foreground（icon 居中占安全区 72/108）
    for folder, size in FOREGROUND_SIZES.items():
        out_dir = RES_DIR / folder
        out_dir.mkdir(parents=True, exist_ok=True)
        fg = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        icon_size = int(size * 72 / 108)
        icon = src.resize((icon_size, icon_size), Image.LANCZOS)
        offset = ((size - icon_size) // 2, (size - icon_size) // 2)
        fg.paste(icon, offset, icon)
        fg.save(out_dir / "ic_launcher_foreground.png")

    # 生成 Windows .ico 文件（多尺寸）
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
    """使用 webpack 将 js/src/ 模块化源码打包为单文件 dspro.js。"""
    print("[构建] JS 模块化打包 (webpack)...")

    if not JS_DIR.exists():
        print(f"  [错误] JS 源码目录不存在: {JS_DIR}")
        sys.exit(1)

    # 检查 node_modules 是否存在，不存在则自动安装依赖
    node_modules = JS_DIR / "node_modules"
    if not node_modules.exists():
        print("  [依赖] node_modules 不存在，正在安装依赖...")
        if not run_cmd("npm install", cwd=JS_DIR, shell=True):
            print("[失败] npm install 失败")
            sys.exit(1)

    # 执行 webpack 构建
    if not run_cmd("npm run build", cwd=JS_DIR, shell=True):
        print("[失败] webpack 构建失败")
        sys.exit(1)

    # 检查构建产物
    if not JS_DIST.exists():
        print(f"  [错误] 构建产物不存在: {JS_DIST}")
        sys.exit(1)

    size_kb = JS_DIST.stat().st_size / 1024
    print(f"  构建产物: {JS_DIST.name} ({size_kb:.1f} KB)")

    # 复制到根目录（供独立使用和 Tampermonkey 加载）
    shutil.copy2(JS_DIST, DSPRO_JS_SRC)
    print(f"  已复制到根目录: {DSPRO_JS_SRC.name}")


# ============================================================
# dspro.js 同步
# ============================================================
def sync_dspro_js():
    """构建 JS 并同步到 shared 模块资源目录，确保构建使用最新脚本。"""
    # 先执行 webpack 构建
    build_js()

    print("[同步] dspro.js -> shared/src/commonMain/resources/")
    if not DSPRO_JS_SRC.exists():
        print(f"  [警告] 源文件不存在: {DSPRO_JS_SRC}，跳过同步")
        return
    DSPRO_JS_DST.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(DSPRO_JS_SRC, DSPRO_JS_DST)
    size_kb = DSPRO_JS_DST.stat().st_size / 1024
    print(f"  已复制 ({size_kb:.1f} KB)")


# ============================================================
# 命令执行
# ============================================================
def run_cmd(cmd, cwd=None, shell=False):
    """运行命令并实时输出，返回是否成功。"""
    cwd = cwd or PROJECT_DIR
    print(f"  $ {' '.join(str(c) for c in cmd)}")
    result = subprocess.run(cmd, cwd=str(cwd), shell=shell)
    return result.returncode == 0


def force_rmtree(path):
    """强制删除目录树，处理只读文件（jpackage 生成的 exe 默认为 ReadOnly）。

    shutil.rmtree 遇到只读文件会抛出 PermissionError(WinError 5)，
    此函数通过 onerror 回调先清除只读属性再重试删除。
    """
    import os
    import stat

    def _onerror(func, p, exc_info):
        os.chmod(p, stat.S_IWRITE)
        func(p)

    shutil.rmtree(path, onerror=_onerror)


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

    # 签名后 APK 名称通常为 androidApp-release.apk
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
    """定位 adb 可执行文件路径。

    查找顺序：
      1. 环境变量 ANDROID_HOME / ANDROID_SDK_ROOT 下的 platform-tools/adb.exe
      2. PATH 中的 adb（直接返回 'adb'，由系统解析，找不到时由调用方捕获异常）

    返回值为命令字符串或列表首元素，供 subprocess.run 使用。
    """
    import os
    sdk = os.environ.get("ANDROID_HOME") or os.environ.get("ANDROID_SDK_ROOT")
    if sdk:
        candidate = Path(sdk) / "platform-tools" / "adb.exe"
        if candidate.exists():
            return str(candidate)
    # 回退到 PATH 中的 adb（依赖用户配置环境变量）
    return "adb"


def install_apk(apk_path):
    """通过 adb 将 APK 安装到已连接的 Android 设备。

    使用 -r 参数覆盖安装以保留应用数据。设备未连接或 adb 不可用时
    仅打印警告，不中止构建流程（构建产物已生成，安装失败可手动安装）。
    """
    print("\n[安装] 通过 adb 安装到已连接设备...")
    adb = find_adb()

    # 先确认有设备在线，避免直接 install 时长时间等待
    devices_cmd = [adb, "devices"]
    print(f"  $ {' '.join(devices_cmd)}")
    try:
        result = subprocess.run(devices_cmd, capture_output=True, text=True)
    except FileNotFoundError:
        print(f"  [警告] 未找到 adb 可执行文件，请将 ANDROID_HOME 加入环境变量或将 adb 加入 PATH")
        print(f"  可手动安装: adb install -r \"{apk_path}\"")
        return False

    # 解析 'adb devices' 输出，统计状态为 device 的设备数
    lines = [ln for ln in result.stdout.splitlines() if ln.strip()]
    device_lines = [ln for ln in lines if "\tdevice" in ln]
    if not device_lines:
        print("  [警告] 未检测到已连接的设备（请确认 USB 调试已开启并已授权）")
        print(f"  可手动安装: adb install -r \"{apk_path}\"")
        return False

    # 执行安装：-r 覆盖安装保留数据，-d 允许降版本安装
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
# EXE 构建
# ============================================================
def build_exe():
    """构建 Desktop EXE（Gradle installDist + jpackage app-image）。"""
    print("\n[构建] Desktop EXE（jpackage app-image）...")

    # 第一步：Gradle 构建 JAR
    cmd = [str(GRADLEW), ":desktopApp:installDist", "--console=plain", "--no-daemon"]
    if not run_cmd(cmd):
        print("[失败] Desktop JAR 构建失败")
        sys.exit(1)

    # 第二步：jpackage 打包为原生 exe
    lib_dir = PROJECT_DIR / "desktopApp/build/install/desktopApp/lib"
    dest_dir = PROJECT_DIR / "build/exe"

    # 清理旧产物（构建产物目录，重建是正常流程）
    # 注意：jpackage 生成的 exe 默认为 ReadOnly，必须用 force_rmtree 处理
    if dest_dir.exists():
        print(f"  清理旧产物: {dest_dir}")
        force_rmtree(dest_dir)

    cmd = [
        str(JPACKAGE),
        "--name", "DeepSeek",
        "--type", "app-image",
        "--input", str(lib_dir),
        "--main-jar", "desktopApp.jar",
        "--main-class", "com.dspro.client.desktop.LauncherKt",
        "--dest", str(dest_dir),
        "--icon", str(ICO_PATH),
        # 运行时需访问 JavaFX 内部 API（WebConsoleListener 捕获 JS console）
        "--java-options", "--add-opens=javafx.web/javafx.scene.web=ALL-UNNAMED",
        "--java-options", "--add-opens=javafx.web/com.sun.javafx.webkit=ALL-UNNAMED",
        "--java-options", "--add-opens=javafx.web/com.sun.webkit=ALL-UNNAMED",
    ]
    if not run_cmd(cmd):
        print("[失败] EXE 打包失败")
        sys.exit(1)

    exe_dir = dest_dir / "DeepSeek"
    exe_file = exe_dir / "DeepSeek.exe"
    if not exe_file.exists():
        print("[失败] 找不到构建产物 EXE")
        sys.exit(1)

    size_mb = sum(f.stat().st_size for f in exe_dir.rglob("*") if f.is_file()) / (1024 * 1024)
    print(f"  EXE: {exe_file} (总 {size_mb:.2f} MB)")
    return exe_dir


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
# 主入口
# ============================================================
def main():
    parser = argparse.ArgumentParser(description="DeepSeekClient 构建脚本")
    parser.add_argument("--apk", action="store_true", help="构建 Android APK")
    parser.add_argument("--exe", action="store_true", help="构建 Desktop EXE")
    parser.add_argument("--all", action="store_true", help="构建全部 (APK + EXE)")
    parser.add_argument("--icons-only", action="store_true", help="仅生成图标")
    parser.add_argument("--js-only", action="store_true", help="仅构建 JS (webpack 打包)")
    parser.add_argument("--no-icons", action="store_true", help="跳过图标生成")
    parser.add_argument("--no-js", action="store_true", help="跳过 JS 构建")
    parser.add_argument("--no-install", action="store_true", help="跳过构建后 adb 自动安装")
    args = parser.parse_args()

    # 无参数时进入交互式菜单
    if not any([args.apk, args.exe, args.all, args.icons_only, args.js_only]):
        print("=== DeepSeekClient 构建脚本 ===")
        print("  1. 构建 APK (Android)")
        print("  2. 构建 EXE (Desktop)")
        print("  3. 构建全部 (APK + EXE)")
        print("  4. 仅生成图标")
        print("  5. 仅构建 JS (webpack 打包)")
        choice = input("请选择 [1-5]: ").strip()
        mapping = {"1": "apk", "2": "exe", "3": "all", "4": "icons_only", "5": "js_only"}
        if choice not in mapping:
            print("无效选择")
            sys.exit(1)
        setattr(args, mapping[choice], True)

    if args.all:
        args.apk = True
        args.exe = True

    # 仅生成图标
    if args.icons_only:
        generate_icons()
        print("\n图标生成完成!")
        return

    # 仅构建 JS
    if args.js_only:
        build_js()
        print("\nJS 构建完成!")
        return

    # 生成图标（除非 --no-icons）
    if not args.no_icons:
        generate_icons()

    # 同步 dspro.js（包含 webpack 构建，除非 --no-js）
    if not args.no_js:
        sync_dspro_js()
    else:
        print("[跳过] JS 构建 (--no-js)")

    # 执行构建
    artifacts = []
    built_apk = None
    if args.apk:
        built_apk = build_apk()
        artifacts.append(("DeepSeek.apk", built_apk))
    if args.exe:
        exe_dir = build_exe()
        artifacts.append(("DeepSeek", exe_dir))

    # 复制产物到 output
    if artifacts:
        copy_to_output(artifacts)

    # APK 构建完成后自动通过 adb 安装到已连接设备（可用 --no-install 跳过）
    if built_apk is not None and not args.no_install:
        install_apk(built_apk)

    print("\n构建完成!")


if __name__ == "__main__":
    try:
        main()
    finally:
        wait_exit()
