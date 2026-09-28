// storage.js —— 存档（FR-11、7.2 存档 schema）
// 支持：损坏备份 + 重置、版本迁移、写入失败提示、存储不可用降级（内存模式）
import { SAVE_KEY, SAVE_VERSION, ITEM_INITIAL, ITEM_CAP, NICKNAME_MAX } from './config.js';

export function defaultSave() {
  return {
    version: SAVE_VERSION,
    nickname: '玩家' + Math.floor(1000 + Math.random() * 9000),
    unlockedLevelId: '1-1',
    coins: 0,
    items: { ...ITEM_INITIAL },
    stars: {},
    bestScores: {},
    leaderboard: { total: [], levels: {} },
    settings: { musicOn: true, musicVol: 80, sfxOn: true, sfxVol: 80 },
    guided: false,
    updatedAt: Date.now(),
  };
}

/** 结构校验（7.2）：字段缺失或类型错误视为损坏 */
export function isValidSave(data) {
  if (!data || typeof data !== 'object') return false;
  if (typeof data.version !== 'number') return false;
  if (typeof data.unlockedLevelId !== 'string') return false;
  if (typeof data.coins !== 'number' || !Number.isFinite(data.coins)) return false;
  if (!data.items || typeof data.items !== 'object') return false;
  for (const k of Object.keys(ITEM_INITIAL)) {
    if (typeof data.items[k] !== 'number') return false;
  }
  if (!data.stars || typeof data.stars !== 'object') return false;
  if (!data.settings || typeof data.settings !== 'object') return false;
  return true;
}

/** 归一化：钳制范围，补齐缺省字段（防止手改存档导致异常） */
export function normalizeSave(data) {
  const base = defaultSave();
  const out = { ...base, ...data };
  out.nickname = String(data.nickname || base.nickname).slice(0, NICKNAME_MAX);
  out.coins = Math.max(0, Math.floor(out.coins));
  out.items = { ...ITEM_INITIAL, ...(data.items || {}) };
  for (const k of Object.keys(out.items)) {
    out.items[k] = Math.min(ITEM_CAP, Math.max(0, Math.floor(out.items[k])));
  }
  out.stars = { ...(data.stars || {}) };
  out.bestScores = { ...(data.bestScores || {}) };
  out.leaderboard = {
    total: Array.isArray(data.leaderboard?.total) ? data.leaderboard.total : [],
    levels: data.leaderboard?.levels && typeof data.leaderboard.levels === 'object' ? data.leaderboard.levels : {},
  };
  out.settings = { ...base.settings, ...(data.settings || {}) };
  return out;
}

/** 版本迁移：当前仅 v1；未来结构变更在此追加分支，无法迁移返回 null */
export function migrateSave(data) {
  if (!data || typeof data.version !== 'number') return null;
  if (data.version === SAVE_VERSION) return normalizeSave(data);
  if (data.version < SAVE_VERSION) {
    const upgraded = { ...data, version: SAVE_VERSION };
    return isValidSave(upgraded) ? normalizeSave(upgraded) : null;
  }
  return null;   // 来自更高版本，无法降级
}

export function createStorage(backend, now = () => Date.now()) {
  let available = !!backend;
  let memory = null;

  function readRaw() {
    if (!available) return null;
    try {
      return backend.getItem(SAVE_KEY);
    } catch (e) {
      available = false;
      return null;
    }
  }

  return {
    get available() {
      return available;
    },
    /** 读取；status: ok | fresh | corrupt | migrated | unavailable */
    load() {
      if (!available) return { data: defaultSave(), status: 'unavailable' };
      const raw = readRaw();
      if (raw === null || raw === undefined || raw === '') return { data: defaultSave(), status: 'fresh' };

      let parsed = null;
      try {
        parsed = JSON.parse(raw);
      } catch (e) {
        this.backupCorrupt(raw);
        return { data: defaultSave(), status: 'corrupt' };
      }
      if (!isValidSave(parsed)) {
        this.backupCorrupt(raw);
        return { data: defaultSave(), status: 'corrupt' };
      }
      const migrated = migrateSave(parsed);
      if (!migrated) {
        this.backupCorrupt(raw);
        return { data: defaultSave(), status: 'corrupt' };
      }
      return { data: migrated, status: parsed.version === SAVE_VERSION ? 'ok' : 'migrated' };
    },
    /** 写入：先写临时键再覆盖正式键（7.2 写入原子性） */
    save(data) {
      const payload = { ...normalizeSave(data), updatedAt: now() };
      if (!available) {
        memory = payload;
        return { ok: true, memoryOnly: true };
      }
      const json = JSON.stringify(payload);
      try {
        backend.setItem(SAVE_KEY + '_tmp', json);
        backend.setItem(SAVE_KEY, json);
        backend.removeItem(SAVE_KEY + '_tmp');
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e && e.name ? e.name : 'WriteError' };
      }
    },
    backupCorrupt(raw) {
      if (!available) return null;
      const key = `${SAVE_KEY}_corrupt_${now()}`;
      try {
        backend.setItem(key, raw);
        return key;
      } catch (e) {
        return null;
      }
    },
    reset() {
      if (!available) {
        memory = defaultSave();
        return { ok: true, memoryOnly: true };
      }
      try {
        backend.removeItem(SAVE_KEY);
        return { ok: true };
      } catch (e) {
        return { ok: false, error: 'RemoveError' };
      }
    },
    get memorySnapshot() {
      return memory;
    },
  };
}

/** 浏览器入口：localStorage 不可用时返回降级实例（FR-11-6） */
export function browserStorage() {
  let backend = null;
  try {
    backend = globalThis.localStorage || null;
    if (backend) {
      const probe = SAVE_KEY + '_probe';
      backend.setItem(probe, '1');
      backend.removeItem(probe);
    }
  } catch (e) {
    backend = null;
  }
  return createStorage(backend);
}
