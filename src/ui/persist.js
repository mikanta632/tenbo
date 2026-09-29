// 保存まわりの共通処理（docs/design.md §9）。

/**
 * 保存する。失敗（端末の保存領域が足りない等）したら知らせて false を返す。
 * 呼び出し側は、保存できたときだけ画面の状態を進める（保存されていない操作を画面に残さない）。
 * notify は通知の出し方（既定は alert）。テストで差し替える。
 */
export function persist(write, notify = (message) => alert(message)) {
  try {
    write();
    return true;
  } catch {
    notify("保存できませんでした。端末の保存領域が足りない可能性があります。この操作は反映していません。");
    return false;
  }
}
