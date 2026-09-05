# 麻雀 卓上点数表示器

実卓（リアル麻雀）で使う点数表示器。iPhone 1台を卓上に置いて使う、単一利用者向けの個人プロジェクト。

## 仕様の所在

`docs/design.md` が唯一の仕様。実装の判断に迷ったら必ずここを参照する。
設計書に書かれていない仕様上の判断が必要になった場合、**勝手に決めずに質問する**。
実装の都合で設計書と違う形にする必要が出た場合も、まず理由を説明して確認を取る。

## 技術的な制約

これらは判断済みであり、変更提案は不要。

- 素の HTML / CSS / JavaScript のみ。フレームワークを使わない
- **ビルド工程を持たない**。トランスパイル、バンドル、最小化を行わない
- npm パッケージへの依存を持たない。`package.json` は `"type": "module"` とテスト実行スクリプトのためだけに置く
- ES Modules でファイルを分割する。`<script type="module">` から直接読む
- 保存は localStorage。IndexedDB は使わない
- 配信は GitHub Pages。静的ファイルのみ
- 対象ブラウザは iOS Safari のみ。他ブラウザの互換性を考慮しない

理由: 開発環境に Mac がなく、外出先から iPhone のエディタで直接修正できることに価値がある。ビルドを挟むとこれができなくなる。

## ディレクトリ構成

```
index.html
CLAUDE.md
package.json
docs/design.md
src/
  score.js      点数計算（純関数）
  reduce.js     イベント列の畳み込み（純関数）
  edit.js       イベント列の編集と再計算
  storage.js    localStorage
  rules.js      Rule の型・既定値・プリセット・検証
  ui/           画面（段階2以降）
test/
  score.test.js
  reduce.test.js
style.css
```

`src/score.js` と `src/reduce.js` は副作用を持たない純関数として書く。DOM、localStorage、Date に触れない。

## テスト

Node の組み込みテストランナーを使う。

```
npm test     # node --test "test/*.test.js"
```

追加の依存を入れない。

## コミット

- コミットメッセージは日本語で書く
- Co-Authored-By の署名を付けない
- 1コミット1目的。テストが通らない状態でコミットしない

## 禁止事項

- 設計書に書かれていない機能を勝手に追加しない
- テストの期待値を、実装に合わせて書き換えない。期待値が間違っていると判断した場合は報告する
- エクスポートした対局データ（JSON）をリポジトリにコミットしない。`.gitignore` に入れる
