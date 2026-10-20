// settlement.test.mjs —— 应用层编排的纯函数断言（FR-07/08/09/10/14）
// 覆盖：线性解锁、结算金币（星级 + 首通双倍）、星级与最好分、排行榜、道具解锁与携带、存档迁移、重置、设置、目标判定
// 运行：node tests/settlement.test.mjs
import {
  nextLevelId, totalStars, settleLevel, applyReset, sanitizeSettings,
  objectiveState, upsertTotalBoard, upsertLevelBoard,
} from '../src/main.js';
import { LEVELS, levelById } from '../src/levels.js';
import { defaultSave, normalizeSave, migrateSave } from '../src/storage.js';
import {
  COIN_BY_STARS, ITEMS, LOADOUT_MAX, coinsForClear, itemById, isItemUnlocked, sanitizeLoadout, unlockedItems, itemsAreOrdered,
} from '../src/config.js';

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}${detail ? '  [' + detail + ']' : ''}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? '  [' + detail + ']' : ''}`); }
}
function fresh(patch = {}) {
  return { ...defaultSave(), nickname: '测试员', ...patch };
}

console.log('=== 线性解锁（FR-08） ===');
check('章内推进：1-1 → 1-2', nextLevelId('1-1') === '1-2');
check('章末跨章：1-10 → 2-1', nextLevelId('1-10') === '2-1');
check('章末跨章：2-10 → 3-1', nextLevelId('2-10') === '3-1');
check('最后一关无下一关', nextLevelId('3-10') === null);
check('非法关卡 id 返回 null', nextLevelId('9-9') === null);

console.log('\n=== 结算金币：星级 × 首通双倍（FR-09） ===');
const lv11 = levelById('1-1');
{
  const save = fresh();
  const r = settleLevel(save, lv11, { won: true, inLevelScore: lv11.scoreTarget, movesLeft: 0 }, 1000);
  check('首次通关 1 星 → 20 金币（10×2）', r.stars === 1 && r.coinsGained === 20 && r.save.coins === 20, `stars=${r.stars} coins=${r.coinsGained}`);
  check('首通标记 firstClear=true', r.firstClear === true);
  check('写入星级与最好分', r.save.stars['1-1'] === 1 && r.save.bestScores['1-1'] === r.total);
  check('解锁下一关 1-2', r.save.unlockedLevelId === '1-2');
}
{
  const save = fresh();
  const r = settleLevel(save, lv11, { won: true, inLevelScore: Math.round(lv11.scoreTarget * 1.7), movesLeft: 3 }, 1000);
  check('首次通关 3 星 → 80 金币（40×2）', r.stars === 3 && r.coinsGained === 80, `stars=${r.stars} coins=${r.coinsGained}`);
}
{
  const save = fresh({ stars: { '1-1': 3 }, bestScores: { '1-1': lv11.scoreTarget * 3 }, unlockedLevelId: '1-2' });
  const r = settleLevel(save, lv11, { won: true, inLevelScore: Math.round(lv11.scoreTarget * 1.7), movesLeft: 3 }, 1000);
  check('重复通关 3 星 → 40 金币（不加倍）', r.stars === 3 && r.coinsGained === 40, `coins=${r.coinsGained}`);
  check('重复通关 firstClear=false', r.firstClear === false);
  check('星级不被更低成绩覆盖', r.save.stars['1-1'] === 3);
  check('最好成绩保留历史更高值', r.save.bestScores['1-1'] === lv11.scoreTarget * 3);
}
{
  const save = fresh({ stars: { '1-1': 1 }, bestScores: { '1-1': lv11.scoreTarget }, unlockedLevelId: '1-2' });
  const r = settleLevel(save, lv11, { won: true, inLevelScore: lv11.scoreTarget, movesLeft: 0 }, 1000);
  check('重复通关 1 星 → 10 金币', r.coinsGained === 10, `coins=${r.coinsGained}`);
}
{
  const save = fresh({ unlockedLevelId: '1-3', stars: { '1-1': 2, '1-2': 1 }, bestScores: { '1-1': 12000, '1-2': 9000 } });
  const r = settleLevel(save, lv11, { won: false, inLevelScore: 500, movesLeft: 0 }, 1000);
  check('失败：金币为 0', r.coinsGained === 0 && r.save.coins === 0);
  check('失败：0 星且不写星数', r.stars === 0 && r.save.stars['1-1'] === 2);
  check('失败：不写最好成绩', r.save.bestScores['1-1'] === 12000);
  check('失败：不解锁、不回退解锁', r.save.unlockedLevelId === '1-3');
}
{
  const save = fresh();
  const r = settleLevel(save, lv11, { won: true, inLevelScore: 0, movesLeft: 0 }, 1000);
  check('未得分也可过关（clear 型）→ 仍 1 星、20 金币', r.stars === 1 && r.coinsGained === 20, `stars=${r.stars} coins=${r.coinsGained}`);
}
{
  check('金币表常量：1/2/3 星 = 10/20/40',
    COIN_BY_STARS[1] === 10 && COIN_BY_STARS[2] === 20 && COIN_BY_STARS[3] === 40);
  check('coinsForClear：0 星 = 0', coinsForClear(0, true) === 0);
  check('coinsForClear：越界星级钳制', coinsForClear(5, false) === 40 && coinsForClear(-1, true) === 0);
  check('coinsForClear：1 星首通 20 / 非首通 10', coinsForClear(1, true) === 20 && coinsForClear(1, false) === 10);
}

console.log('\n=== 道具：解锁、携带与价格（FR-09） ===');
{
  check('道具总数 6 个', ITEMS.length === 6, ITEMS.map((i) => i.id).join(','));
  check('解锁关卡：1-1 / 1-5 / 1-10 / 2-1 / 2-5 / 2-10',
    ITEMS.map((i) => i.unlock).join(',') === '1-1,1-5,1-10,2-1,2-5,2-10');
  check('价格表：30/60/90/130/180/250', ITEMS.map((i) => i.price).join(',') === '30,60,90,130,180,250', ITEMS.map((i) => i.price).join(','));
  check('有效度单调递增且与价格同序', itemsAreOrdered() === true);
  check('解锁关卡顺序 = 有效度升序', ITEMS.slice().sort((a, b) => a.effectiveness - b.effectiveness).map((i) => i.id).join(',') === ITEMS.map((i) => i.id).join(','));
  check('全部道具都有效果描述', ITEMS.every((i) => typeof i.desc === 'string' && i.desc.length > 4));
  check('kind 分类合法（hint/shuffle/cell/instant）', ITEMS.every((i) => ['hint', 'shuffle', 'cell', 'instant'].includes(i.kind)));
}
{
  const stars = { '1-1': 1 };
  check('通关 1-1 解锁「提示」', isItemUnlocked(itemById('hint'), stars) === true);
  check('未通关 1-5 不解锁「洗牌」', isItemUnlocked(itemById('shuffle'), stars) === false);
  check('unlockedItems 只返回已解锁的', unlockedItems(stars).map((i) => i.id).join(',') === 'hint');
  check('星级为 0 不算解锁', isItemUnlocked(itemById('hint'), { '1-1': 0 }) === false);
}
{
  const all = { '1-1': 1, '1-5': 1, '1-10': 1, '2-1': 1, '2-5': 1, '2-10': 1 };
  check('sanitizeLoadout 保留合法顺序', sanitizeLoadout(['hammer', 'hint', 'bomb'], all).join(',') === 'hammer,hint,bomb');
  check('sanitizeLoadout 去重', sanitizeLoadout(['hint', 'hint'], all).join(',') === 'hint');
  check('sanitizeLoadout 丢弃未知 id', sanitizeLoadout(['nope', 'hint'], all).join(',') === 'hint');
  check('sanitizeLoadout 丢弃未解锁道具', sanitizeLoadout(['hint', 'bomb'], { '1-1': 1 }).join(',') === 'hint');
  check('sanitizeLoadout 截断到上限 3', sanitizeLoadout(ITEMS.map((i) => i.id), all).length === LOADOUT_MAX, `上限 ${LOADOUT_MAX}`);
  check('LOADOUT_MAX = 3', LOADOUT_MAX === 3);
}
{
  const bad = { ...defaultSave(), stars: { '1-1': 1 }, loadout: ['hint', 'bomb', 'zzz'] };
  const fixed = normalizeSave(bad);
  check('归一化后剔除未解锁/未知道具', fixed.loadout.join(',') === 'hint', fixed.loadout.join(','));
}
{
  const v1 = {
    version: 1, nickname: '老玩家', unlockedLevelId: '1-3', coins: 120,
    items: { shuffle: 2, hammer: 1, steps: 0 }, stars: { '1-1': 3 }, bestScores: {},
    leaderboard: { total: [], levels: {} },
    settings: { musicOn: true, musicVol: 80, sfxOn: true, sfxVol: 80 }, guided: true,
  };
  const up = migrateSave(v1);
  check('v1 存档可迁移到 v2', !!up && up.version === 2, up ? `v${up.version}` : 'null');
  check('迁移后保留金币与星级', !!up && up.coins === 120 && up.stars['1-1'] === 3);
  check('迁移后不再保留 items 字段', !!up && up.items === undefined);
  check('迁移后 loadout 为空数组', !!up && Array.isArray(up.loadout) && up.loadout.length === 0);
}

console.log('\n=== 排行榜（FR-10、DATA-04） ===');
{
  let save = fresh();
  save = upsertLevelBoard(save, '1-1', 10000, 1000);
  save = upsertLevelBoard(save, '1-1', 8000, 2000);
  check('单关榜同昵称取最高分', save.leaderboard.levels['1-1'].length === 1 && save.leaderboard.levels['1-1'][0].score === 10000);
  save = upsertLevelBoard(save, '1-1', 12000, 3000);
  check('单关榜刷新更高分', save.leaderboard.levels['1-1'][0].score === 12000);
  check('单关榜时间戳更新', save.leaderboard.levels['1-1'][0].ts === 3000);
}
{
  let save = fresh({ stars: { '1-1': 3, '1-2': 2 }, bestScores: { '1-1': 15000, '1-2': 10000 } });
  save = upsertTotalBoard(save, 500);
  const e = save.leaderboard.total[0];
  check('总星榜：星数 = 总星数', e.stars === 5, `stars=${e.stars}`);
  check('总星榜：分数 = 各关最好分之和', e.score === 25000, `score=${e.score}`);
}
{
  let save = fresh();
  for (let i = 0; i < 12; i++) save.leaderboard.total.push({ nickname: '玩家' + i, stars: i, score: i * 100, ts: i });
  save = upsertTotalBoard(save, 999);
  check('总星榜保留前 10 条', save.leaderboard.total.length === 10);
  check('总星榜按星数降序', save.leaderboard.total.every((e, i, a) => i === 0 || a[i - 1].stars >= e.stars));
}

console.log('\n=== 设置与重置（FR-14） ===');
{
  const save = fresh({
    nickname: '小明', coins: 500, loadout: ['hint', 'hammer'], stars: { '1-1': 3, '1-10': 1 },
    bestScores: { '1-1': 20000 }, unlockedLevelId: '1-5', guided: true,
    settings: { musicOn: false, musicVol: 30, sfxOn: true, sfxVol: 55 },
  });
  const reset = applyReset(save);
  check('重置：解锁回到 1-1', reset.unlockedLevelId === '1-1');
  check('重置：金币归零', reset.coins === 0);
  check('重置：携带列表清空', Array.isArray(reset.loadout) && reset.loadout.length === 0);
  check('重置：星数与最好分清空', Object.keys(reset.stars).length === 0 && Object.keys(reset.bestScores).length === 0);
  check('重置：两个榜单清空', reset.leaderboard.total.length === 0 && Object.keys(reset.leaderboard.levels).length === 0);
  check('重置：保留昵称', reset.nickname === '小明');
  check('重置：保留音量与开关', reset.settings.musicOn === false && reset.settings.musicVol === 30 && reset.settings.sfxVol === 55);
  check('重置：引导标记复位', reset.guided === false);
}
{
  const save = fresh({ settings: { musicOn: true, musicVol: 80, sfxOn: true, sfxVol: 80 } });
  const s1 = sanitizeSettings(save, { musicVol: 999, sfxVol: -20 });
  check('音量钳制到 0~100', s1.settings.musicVol === 100 && s1.settings.sfxVol === 0);
  const s2 = sanitizeSettings(save, { nickname: '   ' });
  check('空白昵称保留原名', s2.nickname === save.nickname);
  const s3 = sanitizeSettings(save, { nickname: '新名字新名字新名字' });
  check('昵称截断至 8 字', s3.nickname.length === 8);
}

console.log('\n=== 目标判定（FR-05-3/4） ===');
{
  const clearLv = LEVELS.find((l) => l.objectiveType === 'clear');
  const cleared = new Array(clearLv.colors).fill(0);
  cleared[clearLv.targetColor] = clearLv.objectiveTarget - 1;
  check('消除型：未达标', objectiveState(clearLv, cleared, 0).met === false, objectiveState(clearLv, cleared, 0).label);
  cleared[clearLv.targetColor] = clearLv.objectiveTarget;
  check('消除型：达标', objectiveState(clearLv, cleared, 0).met === true, objectiveState(clearLv, cleared, 0).label);
  const scoreLv = LEVELS.find((l) => l.objectiveType === 'score');
  check('计分型：未达标', objectiveState(scoreLv, [], scoreLv.scoreTarget - 1).met === false);
  check('计分型：达标', objectiveState(scoreLv, [], scoreLv.scoreTarget).met === true);
  check('总星数统计正确', totalStars({ stars: { '1-1': 3, '1-2': 1, '1-3': 2 } }) === 6);
}

console.log(`\n结算与应用层断言：通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail === 0 ? 0 : 1);
