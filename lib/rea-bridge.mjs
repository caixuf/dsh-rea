import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

// 默认精选的高价值逆向工具列表（避免 170+ 工具全部注入把模型的 Prompt 撑爆）
export const DEFAULT_FILTERED_TOOLS = [
  // ── Android APK / 移动端逆向 ──
  'decode_android_resources',     // 用 apktool 解码 APK 资源、图标、布局、文本
  'inspect_android_package',      // 解析 APK 清单 (Manifest)、组件与权限
  'search_android_classes',       // 检索 APK 类名
  'inspect_android_class',        // 查看 APK 某个类的成员与属性
  'inspect_android_method',       // 反编译某个具体方法 (Dalvik/Smali/Java)
  'trace_android_references',     // 追踪类/方法的引用与调用链
  
  // ── Web / Electron 静态逆向 ──
  'analyze_javascript_application', // 静态还原 JS/Electron 应用代码与结构
  'analyze_web_bundle',             // 静态分析 Web 打包产物 (Webpack/Next.js/Vite)
  
  // ── Native 二进制与系统 ──
  'inspect_native_load_image',    // 二进制加载镜像、段表与入口分析
  'inspect_native_instruction',   // 反汇编具体机器指令
  'resolve_native_call_targets',  // 解析原生符号调用跳转
  'annotate_native_function',     // 查看/添加函数分析注释
  
  // ── 运行时与辅助 ──
  'inspect_apktool_client',       // 检查 apktool 引擎可用性与版本
  'inspect_adb_client',           // 检查 adb 引擎可用性与版本
  'list_adb_devices',             // 查看连接的 Android 真机与模拟器
  'capture_adb_screen',           // 抓取连接设备的屏幕画面
];

export class ReaBridge {
  constructor(options = {}) {
    this.options = options;
    this.process = null;
    this.pendingRequests = new Map();
    this.requestId = 1;
    this.buffer = '';
    this.initialized = false;
    this.serverCapabilities = null;
    this.serverTools = [];
  }

  resolvePaths() {
    const userProfile = process.env.USERPROFILE || 'C:\\Users\\20247';
    
    // 1. REA 脚本路径
    const reaCandidates = [
      this.options.reaScriptPath,
      path.join(userProfile, 'Downloads\\oss-study\\rea-service\\node_modules\\rea-agents\\scripts\\rea.mjs'),
      path.join(userProfile, 'Downloads\\oss-study\\rea\\scripts\\rea.mjs'),
    ].filter(Boolean);
    
    let reaScript = reaCandidates.find(p => existsSync(p));
    if (!reaScript) {
      throw new Error(`找不到 REA 启动脚本，请确认已安装 rea-agents (检查候选路径: ${reaCandidates.join(', ')})`);
    }

    // 2. Node 执行路径
    const nodeCandidates = [
      process.execPath,
      'C:\\Users\\20247\\AppData\\Local\\Programs\\DeepSeek Harness\\resources\\runtime\\primary-runtime\\dependencies\\node\\bin\\node.exe',
    ];
    let nodePath = nodeCandidates.find(p => existsSync(p)) || 'node';

    // 3. Apktool & JDK 环境
    const apktoolPath = this.options.apktoolPath ||
      path.join(userProfile, 'Downloads\\oss-study\\rea-tools\\apktool.bat');
    const javaHome = this.options.javaHome ||
      path.join(userProfile, 'Downloads\\android-toolchain\\jdk17');

    return { reaScript, nodePath, apktoolPath, javaHome };
  }

  async start() {
    if (this.process) return;

    const { reaScript, nodePath, apktoolPath, javaHome } = this.resolvePaths();

    const env = {
      ...process.env,
      REA_APKTOOL_COMMAND: existsSync(apktoolPath) ? apktoolPath : undefined,
      JAVA_HOME: existsSync(javaHome) ? javaHome : process.env.JAVA_HOME,
    };

    if (existsSync(javaHome)) {
      env.PATH = `${path.join(javaHome, 'bin')};${env.PATH || ''}`;
    }

    this.process = spawn(nodePath, [reaScript, 'mcp'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
      windowsHide: true,
    });

    this.process.stdout.on('data', (chunk) => this.onData(chunk));
    this.process.stderr.on('data', (chunk) => {
      // 调试日志输出
      const msg = chunk.toString().trim();
      if (msg && this.options.logger) {
        this.options.logger.debug(`[rea-stderr] ${msg}`);
      }
    });

    this.process.on('close', (code) => {
      this.cleanup(new Error(`REA MCP 进程已退出 (code: ${code})`));
    });

    this.process.on('error', (err) => {
      this.cleanup(err);
    });

    // 发起 initialize 握手
    await this.sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'dsh-rea', version: '0.1.0' },
    });

    this.initialized = true;

    // 拉取工具清单
    const listRes = await this.sendRequest('tools/list', {});
    this.serverTools = listRes.tools || [];
  }

  onData(chunk) {
    this.buffer += chunk.toString('utf8');
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop(); // 保留尚未闭合的半行

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const msg = JSON.parse(trimmed);
        if (msg.id !== undefined && this.pendingRequests.has(msg.id)) {
          const { resolve, reject } = this.pendingRequests.get(msg.id);
          this.pendingRequests.delete(msg.id);
          if (msg.error) {
            reject(new Error(msg.error.message || `MCP Error ${msg.error.code}`));
          } else {
            resolve(msg.result);
          }
        }
      } catch {
        // 忽略非 JSON 行
      }
    }
  }

  sendRequest(method, params, timeoutMs = 60000) {
    return new Promise((resolve, reject) => {
      if (!this.process || this.process.killed) {
        return reject(new Error('REA 进程未运行'));
      }

      const id = this.requestId++;
      const timer = setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`REA 请求超时 (${method}, timeout ${timeoutMs}ms)`));
        }
      }, timeoutMs);

      this.pendingRequests.set(id, {
        resolve: (val) => { clearTimeout(timer); resolve(val); },
        reject: (err) => { clearTimeout(timer); reject(err); },
      });

      const payload = JSON.stringify({
        jsonrpc: '2.0',
        id,
        method,
        params,
      }) + '\n';

      this.process.stdin.write(payload, 'utf8');
    });
  }

  async callTool(name, args = {}, timeoutMs = 120000) {
    if (!this.initialized) await this.start();

    const res = await this.sendRequest('tools/call', {
      name,
      arguments: args,
    }, timeoutMs);

    // MCP 规范的返回为 { content: [{ type: 'text', text: '...' }] }
    if (res?.content && Array.isArray(res.content)) {
      const textParts = res.content
        .filter(c => c.type === 'text')
        .map(c => c.text);
      if (textParts.length > 0) {
        return textParts.join('\n');
      }
    }
    return JSON.stringify(res, null, 2);
  }

  getTools(filterList = DEFAULT_FILTERED_TOOLS, enableAll = false) {
    if (enableAll) return this.serverTools;
    const allowed = new Set(filterList);
    return this.serverTools.filter(t => allowed.has(t.name));
  }

  cleanup(error) {
    this.initialized = false;
    for (const { reject } of this.pendingRequests.values()) {
      reject(error || new Error('REA 连接被终止'));
    }
    this.pendingRequests.clear();
    if (this.process && !this.process.killed) {
      try { this.process.kill(); } catch {}
    }
    this.process = null;
  }

  dispose() {
    this.cleanup(new Error('REA 桥接已释放'));
  }
}
