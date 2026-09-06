// localStorage への保存（docs/design.md §4.2, §9）
//
// createStorage(ls) で保存先を差し替えられる（テスト用）。既定は globalThis.localStorage。

import { assertRule } from "./rules.js";
import { reduce } from "./reduce.js";

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
  if (!isObject(data)) throw new Error("バックアップはオブジェクトである必要があります");
  let version = data.meta?.schemaVersion ?? 0;
  if (!Number.isInteger(version) || version < 0 || version > SCHEMA_VERSION) {
    throw new Error(`対応していない schemaVersion: ${version}`);
  }
  let d = data;
  while (version < SCHEMA_VERSION) {
    const step = MIGRATIONS[version];
    if (!step) throw new Error(`マイグレーションが無い: ${version} → ${version + 1}`);
    d = step(d);
    version += 1;
  }
  return { ...d, meta: { ...(d.meta || {}), schemaVersion: SCHEMA_VERSION } };
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** 保存前に、復元後の画面表示・畳み込みで必要なデータを検証する。保存データは変更しない。 */
export function prepareImport(data) {
  const migrated = migrate(data);
  const check = (ok, field) => {
    if (!ok) throw new Error(`バックアップの形式が不正: ${field}`);
  };
  const id = (value) => typeof value === "string" && value.length > 0;
  check(Array.isArray(migrated.roster), "roster");
  check(Array.isArray(migrated.games), "games");
  for (const player of migrated.roster) {
    check(isObject(player) && id(player.id) && typeof player.name === "string", "roster のプレイヤー");
  }
  check(new Set(migrated.roster.map((p) => p.id)).size === migrated.roster.length, "roster の ID 重複");
  const games = migrated.current == null ? migrated.games : [...migrated.games, migrated.current];
  for (const game of games) {
    check(isObject(game) && id(game.id), "Game");
    check(isObject(game.rule), `${game.id}.rule`);
    const rule = assertRule(game.rule);
    check(rule.abortiveRyuukyoku == null || Array.isArray(rule.abortiveRyuukyoku), "abortiveRyuukyoku");
    const n = rule.playerCount;
    const seat = (value) => Number.isInteger(value) && value >= 0 && value < n;
    const seats = (value) => Array.isArray(value) && value.every(seat) && new Set(value).size === value.length;
    const numbers = (value) => Array.isArray(value) && value.length === n && value.every(Number.isFinite);
    check(Array.isArray(game.seats) && game.seats.length === n && game.seats.every(id) && new Set(game.seats).size === n, `${game.id}.seats`);
    check(game.bottomSeat == null || seat(game.bottomSeat), "bottomSeat");
    check(game.emptyPosition == null || ["bottom", "right", "top", "left"].includes(game.emptyPosition), "emptyPosition");
    for (const key of ["startedAt", "endedAt"]) check(game[key] == null || typeof game[key] === "string", key);
    check(Array.isArray(game.events), `${game.id}.events`);
    for (const event of game.events) {
      check(isObject(event), "Event");
      check(["riichi", "meld", "kita", "agari", "ryuukyoku", "chombo", "adjust", "end"].includes(event.t), "Event.t");
      if (["riichi", "meld", "kita", "chombo"].includes(event.t)) check(seat(event.who), "Event.who");
      if (event.t === "meld") check(typeof event.value === "boolean", "meld.value");
      if (event.t === "kita") check(event.delta === 1 || event.delta === -1, "kita.delta");
      if (["agari", "ryuukyoku", "chombo", "adjust"].includes(event.t)) check(numbers(event.deltas), "Event.deltas");
      if (event.t === "agari") {
        check(typeof event.tsumo === "boolean" && (event.tsumo ? event.from === null : seat(event.from)), "agari.from / tsumo");
        check(Array.isArray(event.winners) && event.winners.length > 0 && event.winners.every(isObject), "agari.winners");
        check(seats(event.winners.map((w) => w.who)) && (!event.tsumo || event.winners.length === 1), "agari.winners.who");
        for (const winner of event.winners) {
          check(event.tsumo || winner.who !== event.from, "和了者と放銃者の重複");
          check(winner.yakumanCount == null || (Number.isInteger(winner.yakumanCount) && winner.yakumanCount >= 0 && winner.yakumanCount <= 3), "yakumanCount");
          if (!winner.yakumanCount) check(Number.isFinite(winner.han) && winner.han > 0 && Number.isFinite(winner.fu) && winner.fu > 0, "han / fu");
          if (winner.sekinin != null) check(isObject(winner.sekinin) && seat(winner.sekinin.who) && Number.isInteger(winner.sekinin.yakumanCount) && winner.sekinin.yakumanCount > 0, "sekinin");
        }
      }
      if (event.t === "ryuukyoku") {
        check(["exhaustive", "abortive", "nagashi"].includes(event.type), "ryuukyoku.type");
        check(seats(event.tenpai) && seats(event.nagashiBy), "tenpai / nagashiBy");
      }
    }
    const state = reduce(game.events, rule);
    check(numbers(state.points) && Number.isFinite(state.kyotaku), "畳み込み後の点数");
    if (game.settlement != null) {
      const s = game.settlement;
      check(isObject(s) && [s.points, s.ranks, s.pt, s.yen].every(numbers), "settlement");
      check(Array.isArray(s.transfers) && s.transfers.every((v) => isObject(v) && (v.from === null || seat(v.from)) && (v.to === null || seat(v.to)) && Number.isFinite(v.amount)), "settlement.transfers");
    }
  }
  check(new Set(migrated.games.map((g) => g.id)).size === migrated.games.length, "games の ID 重複");
  return migrated;
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
    /** 終了した対局を id で差し替える（順序は変えない）。無ければ何もしない。 */
    updateGame(game) {
      const games = this.loadGames();
      if (!games.some((g) => g.id === game.id)) return games;
      const next = games.map((g) => (g.id === game.id ? game : g));
      write(KEYS.games, next);
      return next;
    },
    findGame(id) {
      return this.loadGames().find((g) => g.id === id) || null;
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
      const migrated = prepareImport(data);
      const entries = [
        [KEYS.roster, migrated.roster],
        [KEYS.current, migrated.current ?? null],
        [KEYS.games, migrated.games],
        [KEYS.meta, { schemaVersion: SCHEMA_VERSION, updatedAt: now() }],
      ].map(([key, value]) => [key, JSON.stringify(value), ls.getItem(key)]);
      const written = [];
      try {
        for (const entry of entries) {
          ls.setItem(entry[0], entry[1]);
          written.push(entry);
        }
      } catch (error) {
        // localStorage は複数キーを一括保存できない。成功した書き込みだけを逆順で戻す。
        for (const [key, , previous] of written.reverse()) {
          if (previous === null) ls.removeItem(key);
          else ls.setItem(key, previous);
        }
        throw error;
      }
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
