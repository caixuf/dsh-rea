# dsh-rea: DSH REA 逆向工程助手插件

> 将 17.7 万星的开源逆向分析工具包 [REA (morluto/rea)](https://github.com/morluto/rea) 封装为 DeepSeek Harness (DSH) 原生插件。
> 让 AI Agent 拥有系统级移动端 APK、Web/Electron 以及二进制逆向分析能力。

---

## 核心特性

- **零侵入桥接**：基于标准 MCP (Model Context Protocol) 与 Cordis 插件架构，自动托管本地 REA 分析守护进程。
- **上下文保护**：从 REA 提供的 170+ 原生工具中精选最核心的 16 个高价值逆向工具（支持配置开启全量），防止巨大 Schema 撑爆模型上下文窗口。
- **环境免配置**：自动识别 DSH 自身的 Node 运行时、自动探测 Android Toolchain（Apktool、JDK 17、ADB）。
- **生命周期安全**：随 DSH 启动加载，随 DSH 会话销毁自动清理子进程。

---

## 注入给 Agent 的工具能力

| 工具名 | 说明 |
|---|---|
| `rea_decode_android_resources` | 用 apktool 解码目标 APK 的资源、图标、布局与文本 |
| `rea_inspect_android_package` | 解析 APK 清单 (Manifest)、组件与权限配置 |
| `rea_search_android_classes` | 检索反编译后的 APK 类名 |
| `rea_inspect_android_class` | 查看特定类的成员、方法与属性 |
| `rea_inspect_android_method` | 反编译某个具体方法 (Dalvik/Smali/Java) |
| `rea_trace_android_references` | 追踪类或方法的调用链与静态引用 |
| `rea_analyze_javascript_application` | 静态还原 JS/Electron 应用代码与结构 |
| `rea_analyze_web_bundle` | 静态分析 Web 打包产物 (Webpack/Next.js/Vite) |
| `rea_inspect_native_load_image` | 二进制段表、导入导出表与入口分析 |
| `rea_inspect_native_instruction` | 反汇编机器指令 |
| `rea_resolve_native_call_targets` | 解析原生符号调用跳转 |
| `rea_list_adb_devices` | 查看当前连接的 Android 真机与模拟器 |
| `rea_capture_adb_screen` | 抓取当前连接设备的屏幕快照 |

---

## 安装与配置

在 DSH 的机器级补丁 `<dsh-home>/cordis.patch.yml` 中挂载：

```yaml
- insert:
    - id: rea
      name: dsh-rea
      # 可选配置项：
      # config:
      #   allTools: false  # true 则开启全部 170+ 个工具
```

同时在 `<dsh-home>/node_modules/` 和 `<dsh-home>/profiles/<profile>/node_modules/` 软链接或复制 `dsh-rea`。

---

## 外部工具依赖

REA 的三类能力需要调用方自带外部工具，插件会自动探测并注入绝对路径：

| 能力 | 依赖 | 环境变量 | 缺失时的表现 |
|---|---|---|---|
| APK 资源解码 | apktool 2.9.3 | `REA_APKTOOL_COMMAND` | `capability_unavailable` / `unsupported_provider` |
| APK 类/方法反编译 | jadx-headless-mcp 0.7.1 JAR | `REA_JADX_MCP_JAR` | 同上 |
| 真机调试 | adb | `REA_ADB_PATH` | 同上 |

默认探测位置（可用 config 覆盖）：

```
<userprofile>\Downloads\oss-study\rea-tools\ApktoolLauncher.exe   # apktool
<userprofile>\Downloads\oss-study\rea-tools\jadx-headless-mcp-0.7.1-all.jar
<userprofile>\Downloads\android-toolchain\android-sdk\platform-tools\adb.exe
```

### 🔴 Windows 上的 apktool 陷阱

**不要把 `apktool.bat` 交给 REA。** REA 内部用 `execFile`（无 shell）执行 apktool，
而 Windows 的 `CreateProcess` 不能直接执行 `.bat`/`.cmd`：

```
Error: spawn EINVAL
```

结果就是 apktool 能力**永远** unavailable，且错误信息指向 REA 而不是根因。

正确做法是用 `tools/ApktoolLauncher.exe` —— 一层转发器（`java -jar apktool.jar`），
用 .NET Framework 自带的 `csc.exe` 编译，无需任何构建工具链：

```powershell
csc /nologo /target:exe /out:ApktoolLauncher.exe tools\ApktoolLauncher.cs
```

编译后与 `apktool.jar` 放同一目录，并提供 `java-path.txt`（每行一个 JDK 绝对路径）：

```
C:\Users\<you>\Downloads\android-toolchain\jdk17
```

launcher 的 java 解析顺序：`$JAVA_HOME\bin\java.exe` → `java-path.txt` → `PATH`。

---

## 运行测试

```powershell
node test/test.mjs
```

测试包含 apktool / adb 能力的回归断言——能力不可用时测试会失败并给出根因提示，
避免再次出现「以为配好了、其实一直是 unavailable」的情况。

---

## 许可证

[Apache-2.0](LICENSE)
