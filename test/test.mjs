import assert from 'node:assert';
import { ReaBridge, DEFAULT_FILTERED_TOOLS } from '../lib/rea-bridge.mjs';
import { apply, name } from '../index.mjs';

console.log('====================================');
console.log('测试 DSH REA 插件桥接与生命周期');
console.log('====================================');

// 1. 测试 ReaBridge 底层
console.log('\n[1] 测试 ReaBridge 启动与握手...');
const bridge = new ReaBridge({
  logger: {
    debug: () => {},
    info: (m) => console.log('  [bridge:info]', m),
    warn: (m) => console.log('  [bridge:warn]', m),
  }
});

await bridge.start();
console.log('  ✓ REA 进程启动并握手成功');

const allTools = bridge.serverTools;
console.log(`  ✓ 成功从 REA 发现 ${allTools.length} 个原始工具`);
assert(allTools.length >= 50, '工具总数应大于 50');

const filtered = bridge.getTools(DEFAULT_FILTERED_TOOLS, false);
console.log(`  ✓ 默认精选过滤名单包含 ${filtered.length} 个工具`);
assert(filtered.length >= 5, '精选工具数应不低于 5');

// 2. 测试工具调用
console.log('\n[2] 测试工具调用 (inspect_apktool_client)...');
const capResult = await bridge.callTool('inspect_apktool_client', {});
console.log('  ✓ 工具执行结果摘要:');
console.log('   ', String(capResult).slice(0, 160).replace(/\n/g, ' '));
assert(capResult && String(capResult).length > 0, '应返回 inspect_apktool_client 结果');

// 2b. 回归测试：apktool 能力必须真的 available
//
// 🔴 历史缺陷：插件把 apktool.bat 交给 REA，而 REA 用 execFile（无 shell）执行，
// Windows 的 CreateProcess 不能直接执行 .bat/.cmd → `spawn EINVAL` → apktool 能力
// 永远 unavailable，表现为 capability_unavailable/unsupported_provider。
// 修法是改用 ApktoolLauncher.exe（转发 java -jar apktool.jar）。
// 这里断言 REA 报告的 provider 是真的可用，而不是 unsupported_provider。
console.log('\n[2b] 回归测试：apktool 能力可用性...');
{
  const payload = typeof capResult === 'string' ? JSON.parse(capResult) : capResult;
  const errorCode = payload?.error?.code;
  const provider = payload?.provider?.id ?? payload?.normalized_result?.client?.command_source;
  assert(
    !errorCode,
    `apktool 能力不可用（error.code=${errorCode}）。Windows 上 .bat 无法被 execFile 启动，` +
    `请确认 rea-tools\\ApktoolLauncher.exe 存在且可执行。`
  );
  const version = payload?.normalized_result?.client?.apktool_version;
  assert(version, `未取得 apktool 版本（provider=${provider}）`);
  console.log(`  ✓ apktool 能力可用，版本 ${version}`);
}

// 2c. 回归测试：adb 能力必须真的 available（REA_ADB_PATH 需要绝对路径的 .exe）
console.log('\n[2c] 回归测试：adb 能力可用性...');
{
  const adbResult = await bridge.callTool('inspect_adb_client', {});
  const payload = typeof adbResult === 'string' ? JSON.parse(adbResult) : adbResult;
  assert(!payload?.error?.code, `adb 能力不可用（error.code=${payload?.error?.code}）`);
  const version = payload?.normalized_result?.client?.version;
  assert(version, '未取得 adb 版本');
  console.log(`  ✓ adb 能力可用，版本 ${version}`);
}

// 3. 测试模拟 Cordis 注入
console.log('\n[3] 测试 Cordis 插件注册流程...');
const registeredTools = [];
const mockCtx = {
  tools: {
    register: (def) => {
      registeredTools.push(def);
      return () => {
        const idx = registeredTools.indexOf(def);
        if (idx !== -1) registeredTools.splice(idx, 1);
      };
    }
  },
  on: (event, handler) => {
    mockCtx._dispose = handler;
  },
  logger: () => ({
    info: (m) => console.log('  [cordis:info]', m),
    warn: (m) => console.log('  [cordis:warn]', m),
    error: (m) => console.log('  [cordis:error]', m),
  })
};

await apply(mockCtx, {});
console.log(`  ✓ 成功向 mock Cordis 注册了 ${registeredTools.length} 个工具`);
assert(registeredTools.length > 0, '注册的工具数应大于 0');

const firstTool = registeredTools[0];
assert(firstTool.name.startsWith('rea_'), '工具名前缀应为 rea_');
console.log(`  ✓ 示例工具: ${firstTool.name} -> ${firstTool.description}`);

// 4. 清理释放
console.log('\n[4] 测试插件释放与退出...');
if (mockCtx._dispose) mockCtx._dispose();
bridge.dispose();
console.log('  ✓ 资源与子进程已释放');

console.log('\n====================================');
console.log('✅ 全部测试通过 (4/4)');
console.log('====================================');
process.exit(0);
