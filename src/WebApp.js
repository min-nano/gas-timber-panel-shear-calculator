/**
 * Web アプリのサーバサイド エントリポイント。
 * =====================================================================
 * このスクリプトは「Web アプリにアクセスしているユーザー」として実行される
 * （appsscript.json の webapp.executeAs = USER_ACCESSING）。
 * そのため、各ユーザーは自身の権限で計算を実行し、他人が勝手に
 * スプレッドシートを作成することはできない。
 *
 * MVP の役割:
 *   - index.html（SPA）を配信する。
 *   - クライアントから google.script.run で呼ばれる計算 API を提供する。
 *     計算本体は NailArrayConstants.js（唯一の計算実装）に委譲するため、
 *     UI に表示される数値は必ずユニットテスト済みのロジックと一致する。
 * =====================================================================
 */

/**
 * Web アプリの GET ハンドラ。SPA（index.html）を返す。
 * @param {GoogleAppsScript.Events.DoGet} e イベントオブジェクト
 * @return {GoogleAppsScript.HTML.HtmlOutput}
 */
function doGet(e) {
  return HtmlService.createTemplateFromFile('index')
    .evaluate()
    .setTitle('面材張り耐力要素 釘配列諸定数 計算（グレー本 3.2）')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * HTML テンプレート内から別の HTML ファイルを取り込むための補助関数。
 * index.html 内で <?!= include('filename') ?> のように使用する。
 * @param {string} filename 拡張子を除いた HTML ファイル名
 * @return {string} ファイルの内容
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * クライアント（google.script.run）から呼ばれる計算 API。
 * 釘配列諸定数（Ixy, Zxy, Cxy ほか）を計算して返す。
 *
 * @param {{nails:{x:number,y:number}[], panelArea:number}} payload 入力
 * @return {{ok:boolean, result?:Object, error?:string}} 計算結果またはエラー
 */
function computeNailArrayConstantsApi(payload) {
  try {
    if (!payload || typeof payload !== 'object') {
      throw new Error('入力が不正です。');
    }
    const result = computeNailArrayConstants(payload.nails, payload.panelArea);
    return { ok: true, result: result };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}
