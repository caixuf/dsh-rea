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
