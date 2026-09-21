// localStorage への保存（docs/design.md §4.2, §9）
//
// createStorage(ls) で保存先を差し替えられる（テスト用）。既定は globalThis.localStorage。

import { assertRule } from "./rules.js";
import { reduce } from "./reduce.js";
import { COUNTERS } from "./stats.js";

export const SCHEMA_VERSION = 4;

export const KEYS = Object.freeze({
  meta: "mj.meta",
  roster: "mj.roster",
  current: "mj.current",
  games: "mj.games",
  carry: "mj.carry",
});

/**
 * 片方向のマイグレーション。版 n のデータを n+1 に上げる関数を並べる。
 * 過去のマイグレーションは削除しない（§9.4）。
 */
const MIGRATIONS = {
  // 0 → 1: 初版。何もしない
  0: (data) => data,
  // 1 → 2: 旧アプリからの繰越（§8.5）を空で足す
  1: (data) => ({ ...data, carry: data.carry ?? [] }),
  // 2 → 3: 繰越に増えた集計項目を 0 で埋める（元の繰越には無かったので不明扱い）
  2: (data) => ({
    ...data,
    carry: (data.carry ?? []).map((c) => ({
      ...Object.fromEntries(COUNTERS.map((key) => [key, 0])),
      maxPoints: null,
      ...c,
    })),
  }),
  // 3 → 4: 繰越にチップ収支を足す（旧アプリにチップは無いので 0）
  3: (data) => ({
    ...data,
    carry: (data.carry ?? []).map((c) => ({ chipSum: 0, ...c })),
  }),
};

/**
 * 保存データ全体 { meta, roster, current, games, carry } を最新の schemaVersion に上げる。
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
      if (event.t === "adjust") check(event.chips == null || numbers(event.chips), "adjust.chips");
      if (event.t === "agari") {
        check(typeof event.tsumo === "boolean" && (event.tsumo ? event.from === null : seat(event.from)), "agari.from / tsumo");
        check(Array.isArray(event.winners) && event.winners.length > 0 && event.winners.every(isObject), "agari.winners");
        check(seats(event.winners.map((w) => w.who)) && (!event.tsumo || event.winners.length === 1), "agari.winners.who");
        for (const winner of event.winners) {
          check(event.tsumo || winner.who !== event.from, "和了者と放銃者の重複");
          check(winner.yakumanCount == null || (Number.isInteger(winner.yakumanCount) && winner.yakumanCount >= 0 && winner.yakumanCount <= 3), "yakumanCount");
          check(winner.chips == null || (Number.isInteger(winner.chips) && winner.chips >= 0), "winner.chips");
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
      check(s.chips == null || numbers(s.chips), "settlement.chips");
      check(Array.isArray(s.transfers) && s.transfers.every((v) => isObject(v) && (v.from === null || seat(v.from)) && (v.to === null || seat(v.to)) && Number.isFinite(v.amount)), "settlement.transfers");
    }
  }
  check(new Set(migrated.games.map((g) => g.id)).size === migrated.games.length, "games の ID 重複");
  const carry = migrated.carry ?? [];
  check(Array.isArray(carry), "carry");
  const counter = (value) => Number.isInteger(value) && value >= 0;
  for (const c of carry) {
    check(isObject(c) && id(c.playerId), "carry の playerId");
    check(c.playerCount === 3 || c.playerCount === 4, "carry の playerCount");
    check(Array.isArray(c.rankDist) && c.rankDist.length === 4 && c.rankDist.every(counter), "carry の rankDist");
    check(counter(c.games) && c.games === c.rankDist.reduce((a, b) => a + b, 0), "carry の games と rankDist の不一致");
    for (const key of COUNTERS) check(key.endsWith("Sum") ? Number.isFinite(c[key]) : counter(c[key]), `carry の ${key}`);
    for (const key of ["pointsSum", "ptSum", "yenSum"]) check(Number.isFinite(c[key]), `carry の ${key}`);
    check(c.maxPoints == null || Number.isFinite(c.maxPoints), "carry の maxPoints");
  }
  check(new Set(carry.map((c) => `${c.playerId}/${c.playerCount}`)).size === carry.length, "carry の重複");
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
        carry: read(KEYS.carry, []),
      };
      const version = (data.meta && data.meta.schemaVersion) || 0;
      if (version < SCHEMA_VERSION) {
        const migrated = migrate(data);
        ls.setItem(KEYS.roster, JSON.stringify(migrated.roster));
        ls.setItem(KEYS.current, JSON.stringify(migrated.current));
        ls.setItem(KEYS.games, JSON.stringify(migrated.games));
        ls.setItem(KEYS.carry, JSON.stringify(migrated.carry ?? []));
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
    /** 終了した対局を id で削除する（§8.5）。無ければ何もしない。 */
    deleteGame(id) {
      const games = this.loadGames();
      const next = games.filter((g) => g.id !== id);
      if (next.length !== games.length) write(KEYS.games, next);
      return next;
    },
    findGame(id) {
      return this.loadGames().find((g) => g.id === id) || null;
    },

    // --- carry（旧アプリからの繰越。§8.5） ---
    loadCarry() {
      return read(KEYS.carry, []);
    },
    saveCarry(carry) {
      write(KEYS.carry, carry);
    },

    // --- エクスポート／インポート（§9.4） ---
    exportAll() {
      return {
        meta: this.loadMeta(),
        roster: this.loadRoster(),
        current: this.loadCurrent(),
        games: this.loadGames(),
        carry: this.loadCarry(),
      };
    },
    importAll(data) {
      writeAll(prepareImport(data));
    },
    /** 今のデータに取り込む（§8.7 マージ）。戻り値は mergeImport の summary */
    mergeAll(data) {
      const { merged, summary } = mergeImport(this.exportAll(), prepareImport(data));
      writeAll(merged);
      return summary;
    },
  };

  /** 全キーをまとめて保存する。途中で失敗したら書いた分を戻す */
  function writeAll(migrated) {
    const entries = [
      [KEYS.roster, migrated.roster],
      [KEYS.current, migrated.current ?? null],
      [KEYS.games, migrated.games],
      [KEYS.carry, migrated.carry ?? []],
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
  }
}

/**
 * マージ（§8.7）。existing に incoming を足した新しい全データを返す。どちらも変更しない。
 * - 対局は ID で突き合わせ、無いものを追加。同じ ID は既存を残す
 * - プレイヤーは ID が同じなら同一人物。ID が違っても名前が同じなら同一人物とみなして既存の ID に寄せ、
 *   取り込む対局の席もその ID に書き換える（別の端末で同じ名前を登録した場合に成績を分裂させない）。
 *   寄せた結果ひとつの対局に同じ人が 2 席出るときは、その対局だけ寄せずに元の ID のまま取り込む
 * - 進行中の対局は既存を保持する
 * - 繰越（carry）は既存に無い（playerId, playerCount）だけ足す
 * 戻り値 { merged, summary: { games, skippedGames, players, mergedPlayers, carry } }
 */
export function mergeImport(existing, incoming) {
  const roster = existing.roster.map((p) => ({ ...p }));
  const byId = new Map(roster.map((p) => [p.id, p]));
  const byName = new Map();
  for (const p of roster) if (!byName.has(p.name.trim())) byName.set(p.name.trim(), p);
  const incomingIds = new Set(incoming.roster.map((p) => p.id));

  // 取り込む ID → 既存の ID。名前で寄せるのは、その既存 ID が取り込み側に無い場合だけ（1 人が 2 人に化けない）
  const map = new Map();
  let mergedPlayers = 0;
  const unmapped = [];
  for (const p of incoming.roster) {
    if (byId.has(p.id)) {
      map.set(p.id, p.id);
      continue;
    }
    const same = byName.get(p.name.trim());
    if (same && !incomingIds.has(same.id)) {
      map.set(p.id, same.id);
      mergedPlayers++;
    } else unmapped.push(p);
  }
  const added = new Map(); // 追加するプレイヤー（ID → Player）
  const addPlayer = (p) => {
    if (!byId.has(p.id) && !added.has(p.id)) added.set(p.id, { ...p });
  };
  for (const p of unmapped) addPlayer(p);
  const incomingPlayer = new Map(incoming.roster.map((p) => [p.id, p]));
  const remap = (id) => map.get(id) ?? id;
  const remapSeats = (seats) => {
    const mapped = seats.map(remap);
    if (new Set(mapped).size === mapped.length) return mapped;
    // 寄せると同じ人が 2 席になる対局。元の ID のまま取り込み、その人を別人として足す
    for (const id of seats) if (map.get(id) !== id && incomingPlayer.has(id)) addPlayer(incomingPlayer.get(id));
    return seats.slice();
  };

  const existingGameIds = new Set(existing.games.map((g) => g.id));
  if (existing.current) existingGameIds.add(existing.current.id);
  const newGames = [];
  let skippedGames = 0;
  for (const g of incoming.games) {
    if (existingGameIds.has(g.id)) {
      skippedGames++;
      continue;
    }
    newGames.push({ ...g, seats: remapSeats(g.seats) });
  }
  // 新しい順（appendGame と同じ）に並べ直す
  const games = [...existing.games, ...newGames].sort((a, b) => String(b.startedAt ?? "").localeCompare(String(a.startedAt ?? "")));

  const existingCarry = existing.carry ?? [];
  const carryKeys = new Set(existingCarry.map((c) => `${c.playerId}/${c.playerCount}`));
  const newCarry = [];
  for (const c of incoming.carry ?? []) {
    const playerId = remap(c.playerId);
    const key = `${playerId}/${c.playerCount}`;
    if (carryKeys.has(key)) continue;
    carryKeys.add(key);
    newCarry.push({ ...c, playerId });
  }

  const merged = {
    meta: { ...(existing.meta || {}), schemaVersion: SCHEMA_VERSION },
    roster: [...roster, ...added.values()],
    current: existing.current ?? null,
    games,
    carry: [...existingCarry, ...newCarry],
  };
  return { merged, summary: { games: newGames.length, skippedGames, players: added.size, mergedPlayers, carry: newCarry.length } };
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
