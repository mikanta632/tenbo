// localStorage への保存（docs/design.md §4.2, §9）
//
// createStorage(ls) で保存先を差し替えられる（テスト用）。既定は globalThis.localStorage。

export const SCHEMA_VERSION = 1;

export const KEYS = Object.freeze({
  meta: "mj.meta",
  roster: "mj.roster",
  current: "mj.current",
  games: "mj.games",
});

/**
 * 片方向のマイグレーション。版 n のデータを n+1 に上げる関数を並べる。
 * 過去のマイグレーションは削除しない（§9.4）。
 */
const MIGRATIONS = {
  // 0 → 1: 初版。何もしない
  0: (data) => data,
};

/**
 * 保存データ全体 { meta, roster, current, games } を最新の schemaVersion に上げる。
 */
export function migrate(data) {
  let version = (data.meta && data.meta.schemaVersion) || 0;
  let d = data;
  while (version < SCHEMA_VERSION) {
    const step = MIGRATIONS[version];
    if (!step) throw new Error(`マイグレーションが無い: ${version} → ${version + 1}`);
    d = step(d);
    version += 1;
  }
  return { ...d, meta: { ...(d.meta || {}), schemaVersion: SCHEMA_VERSION } };
}

function parse(json, fallback) {
  if (json === null || json === undefined) return fallback;
  try {
    return JSON.parse(json);
  } catch {
    return fallback;
  }
}

export function createStorage(ls = globalThis.localStorage, now = () => new Date().toISOString()) {
  function read(key, fallback) {
    return parse(ls.getItem(key), fallback);
  }
  function write(key, value) {
    ls.setItem(key, JSON.stringify(value));
    ls.setItem(KEYS.meta, JSON.stringify({ schemaVersion: SCHEMA_VERSION, updatedAt: now() }));
  }

  return {
    /** 起動時に呼ぶ。保存データを最新版に上げる。 */
    init() {
      const data = {
        meta: read(KEYS.meta, null),
        roster: read(KEYS.roster, []),
        current: read(KEYS.current, null),
        games: read(KEYS.games, []),
      };
      const version = (data.meta && data.meta.schemaVersion) || 0;
      if (version < SCHEMA_VERSION) {
        const migrated = migrate(data);
        ls.setItem(KEYS.roster, JSON.stringify(migrated.roster));
        ls.setItem(KEYS.current, JSON.stringify(migrated.current));
        ls.setItem(KEYS.games, JSON.stringify(migrated.games));
        ls.setItem(KEYS.meta, JSON.stringify({ schemaVersion: SCHEMA_VERSION, updatedAt: now() }));
      }
    },

    loadMeta() {
      return read(KEYS.meta, { schemaVersion: SCHEMA_VERSION, updatedAt: null });
    },

    // --- roster ---
    loadRoster() {
      return read(KEYS.roster, []);
    },
    saveRoster(roster) {
      write(KEYS.roster, roster);
    },
    /** プレイヤーを追加して roster を返す。 */
    addPlayer(name) {
      const roster = this.loadRoster();
      const id = "p_" + Math.random().toString(36).slice(2, 10);
      const player = { id, name, createdAt: now() };
      const next = [...roster, player];
      this.saveRoster(next);
      return player;
    },
    renamePlayer(id, name) {
      const roster = this.loadRoster().map((p) => (p.id === id ? { ...p, name } : p));
      this.saveRoster(roster);
      return roster;
    },

    // --- current ---
    loadCurrent() {
      return read(KEYS.current, null);
    },
    /** イベント確定ごとに全上書き（§9.2） */
    saveCurrent(game) {
      write(KEYS.current, game);
    },
    clearCurrent() {
      write(KEYS.current, null);
    },

    // --- games ---
    loadGames() {
      return read(KEYS.games, []);
    },
    /** 終局時に 1件追記。新しい順（§4.2）。 */
    appendGame(game) {
      const games = this.loadGames();
      const next = [game, ...games.filter((g) => g.id !== game.id)];
      write(KEYS.games, next);
      return next;
    },
    saveGames(games) {
      write(KEYS.games, games);
    },

    // --- エクスポート／インポート（§9.4） ---
    exportAll() {
      return {
        meta: this.loadMeta(),
        roster: this.loadRoster(),
        current: this.loadCurrent(),
        games: this.loadGames(),
      };
    },
    importAll(data) {
      const migrated = migrate(data);
      ls.setItem(KEYS.roster, JSON.stringify(migrated.roster || []));
      ls.setItem(KEYS.current, JSON.stringify(migrated.current || null));
      ls.setItem(KEYS.games, JSON.stringify(migrated.games || []));
      ls.setItem(KEYS.meta, JSON.stringify({ schemaVersion: SCHEMA_VERSION, updatedAt: now() }));
    },
  };
}

/** テスト用のメモリ上 localStorage 互換オブジェクト */
export function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear(),
    get length() {
      return map.size;
    },
    key: (i) => [...map.keys()][i] ?? null,
  };
}
