# 麻雀 卓上点数表示器

実卓用の点数表示器。iPhone を卓の中央に置き、ホーム画面に追加した PWA として使う。
仕様は `docs/design.md`。開発上の約束は `CLAUDE.md`。

## 動かす

ビルド工程は無い。静的ファイルをそのまま配信する。

```
npm test                      # 点数計算・畳み込み・精算などの単体テスト
python -m http.server 8765    # ローカル確認（http://localhost:8765/）
```

## GitHub Pages に置く

1. GitHub にリポジトリを作り、`main` に push する
2. リポジトリの Settings → Pages → Build and deployment で
   Source を「Deploy from a branch」、Branch を `main` / `/ (root)` にする
3. 数分後に `https://<ユーザー名>.github.io/<リポジトリ名>/` で開ける

すべてのパスは相対なので、リポジトリ名がどれでも動く。`.nojekyll` を置いてあるため Jekyll の処理は入らない。

## iPhone で使う

1. Safari で上の URL を開く
2. 共有 → 「ホーム画面に追加」
3. ホーム画面のアイコンから起動する（Safari のタブからではなく）

ホーム画面から起動した場合、データは Safari と別の領域に保存され、7日間未使用で消える制限の対象外になる。
それでも端末の初期化やアプリの削除で消えるので、開始画面か結果画面の「エクスポート」で JSON を「ファイル」に保存しておく。復元は「インポート」。

## 更新の反映

`version.js` の `APP_VERSION` を上げてから push する。Service Worker のキャッシュ名に版番号が入っているため、
次にアプリを起動し直したときに新しいファイルに切り替わる（対局中に入れ替わることはない）。
版番号はアプリのメニューに表示される。
