import { ReaBridge, DEFAULT_FILTERED_TOOLS } from './lib/rea-bridge.mjs';

export const name = 'dsh-rea';
export const inject = ['tools'];

export async function apply(ctx, config = {}) {
  const logger = ctx.logger ? ctx.logger('rea') : console;

  logger.info('正在初始化 DSH REA 逆向工程工具桥接...');

  const bridge = new ReaBridge({
    reaScriptPath: config.reaScriptPath,
    apktoolPath: config.apktoolPath,
    javaHome: config.javaHome,
    logger,
  });

  try {
    await bridge.start();
  } catch (err) {
    logger.warn(`REA 后台启动失败，将在首次调用时尝试重新连接: ${err.message}`);
  }

  // 决定启用的工具范围
  const targetTools = bridge.getTools(
    config.tools || DEFAULT_FILTERED_TOOLS,
    Boolean(config.allTools)
  );

  logger.info(`已就绪，正在向 DSH 注册 ${targetTools.length} 个逆向分析工具...`);

  // 逐个注册为 DSH 原生 Tool
  const disposers = [];
  for (const tool of targetTools) {
    const dshToolName = `rea_${tool.name}`;
    
    const toolDef = {
      name: dshToolName,
      description: `[REA 逆向工程] ${tool.description || tool.name}`,
      parameters: tool.inputSchema || { type: 'object', properties: {} },
      execute: async (_callCtx, args) => {
        try {
          return await bridge.callTool(tool.name, args);
        } catch (callErr) {
          throw new Error(`[${dshToolName}] 执行失败: ${callErr.message}`);
        }
      },
    };

    try {
      const unreg = ctx.tools.register(toolDef);
      if (typeof unreg === 'function') disposers.push(unreg);
    } catch (regErr) {
      logger.warn(`注册工具 ${dshToolName} 失败: ${regErr.message}`);
    }
  }

  logger.info(`✓ 成功注册了 ${disposers.length || targetTools.length} 个 REA 逆向工具`);

  // 清理生命周期
  ctx.on('dispose', () => {
    logger.info('正在卸载 DSH REA 插件并关闭后台分析引擎...');
    for (const d of disposers) {
      try { d(); } catch {}
    }
    bridge.dispose();
  });
}
