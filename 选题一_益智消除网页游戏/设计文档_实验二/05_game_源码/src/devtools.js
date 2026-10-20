// devtools.js —— 测试版专用：注入运行日志、调试面板与 window.__game 钩子
// 正式版（index.html → src/main.js）不会加载本文件。
import * as logger from './logger.js';
import * as log from './log.js';
import * as board from './board.js';
import * as ui from './ui.js';
import { ITEMS, LOADOUT_MAX } from './config.js';

/**
 * 安装调试设施并暴露只读状态/公开 API。
 * @param {{main?:object, doc?:Document, params?:string}} opts
 */
export function install(opts = {}) {
  const doc = opts.doc || (typeof document !== 'undefined' ? document : null);
  const params = opts.params !== undefined ? opts.params : (typeof location !== 'undefined' ? location.search : '');
  const isDebug = /[?&]debug=1\b/.test(params);

  log.attach(logger);
  logger.init({ minLevel: isDebug ? 'debug' : 'info' });
  logger.install();
  if (doc) logger.attachPanel(doc);
  if (opts.main) exposeGame(opts.main, logger);
  logger.info('devtools.install', { debug: isDebug, href: typeof location !== 'undefined' ? location.href : '' });
  return { ok: true, debug: isDebug };
}

/** 暴露 window.__game（测试版专有；正式版没有该对象） */
function exposeGame(main, loggerImpl) {
  if (typeof window === 'undefined') return;
  window.__game = {
    version: 'dev',
    state: main.state,
    api: {
      boot: main.boot, startLevel: main.startLevel, onSwap: main.onSwap, useItem: main.useItem,
      onItemModeChange: main.onItemModeChange, onHammerPick: main.onHammerPick,
      navigate: main.navigate, onSettle: main.onSettle, setSettings: main.setSettings,
      onReset: main.onReset, applyReset: main.applyReset, demoSave: main.demoSave,
      objectiveState: main.objectiveState, settleLevel: main.settleLevel,
      nextLevelId: main.nextLevelId, totalStars: main.totalStars,
      setLoadout: main.setLoadout, toggleLoadoutItem: main.toggleLoadoutItem,
      equippedItems: main.equippedItems, onItemPick: main.onItemPick,
      // 棋盘工具直接取自领域层，避免把测试用导出混进正式版的应用层模块
      findLegalMoves: board.findLegalMoves, matchAt: board.matchAt, isDeadlock: board.isDeadlock,
      resolveSwap: board.resolveSwap, cloneBoard: board.cloneBoard,
      applyBombItem: board.applyBombItem, applyColorClear: board.applyColorClear,
      clearCellsAndSettle: board.clearCellsAndSettle,
    },
    log: {
      get: loggerImpl.getLogs, clear: loggerImpl.clear, exportText: loggerImpl.exportText,
      panel: loggerImpl.togglePanel,
    },
    ui: ui.__internals,
    items: ITEMS,
    loadoutMax: LOADOUT_MAX,
  };
}
