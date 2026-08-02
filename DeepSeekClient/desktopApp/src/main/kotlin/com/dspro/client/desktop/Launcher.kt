package com.dspro.client.desktop

import javafx.application.Application

/**
 * 应用启动入口（非 Application 子类）。
 *
 * JavaFX 11+ 在 classpath（非模块化）模式下，若主类直接继承 Application，
 * JVM 会因检测到 Application 子类而要求 JavaFX 运行时预先初始化，导致启动失败。
 * 此启动器不继承 Application，规避该检查，由 Application.launch 内部初始化运行时。
 *
 * @param args 命令行参数
 */
fun main(args: Array<String>) {
    Application.launch(Main::class.java, *args)
}
