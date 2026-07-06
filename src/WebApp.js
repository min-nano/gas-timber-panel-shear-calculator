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

/**
 * クライアントから呼ばれる保存 API。
 * 計算を実行し、入力値と結果を保存する。1 スプレッドシート = 1 物件とし、
 *   - 現在値タブ「パターン」へ patternId で upsert（1 行 = 1 パターン）
 *   - 履歴タブ「履歴」へ追記（1 行 = 1 保存）
 * を行う。保存先が未指定なら新規スプレッドシートを作成し、その ID を返す
 * （以降はその ID を渡してもらうことで同一物件へ保存が集約される）。
 *
 * サーバ側で計算をやり直すため、保存される結果セルの値は必ずテスト済みロジックと一致する。
 *
 * @param {{nails:{x:number,y:number}[], panelArea:number,
 *          width:number, height:number,
 *          projectName?:string, patternId?:string, patternName?:string,
 *          storage?:{spreadsheetId?:string, spreadsheetName?:string,
 *                    folderId?:string}}} payload 入力＋識別＋保存先
 * @return {{ok:boolean, result?:Object, storage?:Object, error?:string}}
 */
function saveCalculationApi(payload) {
  try {
    if (!payload || typeof payload !== 'object') {
      throw new Error('入力が不正です。');
    }
    // 保存する結果は、表示と同じ唯一の実装で計算し直したものを用いる。
    const result = computeNailArrayConstants(payload.nails, payload.panelArea);
    const input = {
      width: payload.width,
      height: payload.height,
      panelArea: payload.panelArea,
      nails: payload.nails
    };
    // 保存先（storage）に物件・パターン識別を合成して渡す。
    const options = Object.assign({}, payload.storage || {}, {
      projectName: payload.projectName,
      patternId: payload.patternId,
      patternName: payload.patternName
    });
    const storage = saveSheetRecord(input, result, options);
    return { ok: true, result: result, storage: storage };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

/**
 * 物件（スプレッドシート）内の全パターン（現在値タブ）を返す API。
 * アプリのパターン切替・既存物件の読み込みに使う。
 *
 * @param {{spreadsheetId:string}} payload 対象スプレッドシート
 * @return {{ok:boolean, spreadsheetId?:string, spreadsheetUrl?:string,
 *          patterns?:Object[], schemaVersion?:number, error?:string}}
 */
function listPatternsApi(payload) {
  try {
    if (!payload || !payload.spreadsheetId) {
      throw new Error('spreadsheetId が指定されていません。');
    }
    const loaded = loadSheetPatterns(payload.spreadsheetId, {});
    return {
      ok: true,
      spreadsheetId: loaded.spreadsheetId,
      spreadsheetUrl: loaded.spreadsheetUrl,
      patterns: loaded.patterns,
      schemaVersion: loaded.schemaVersion
    };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

/**
 * セルマッピングのスキーマ（バージョン・列レイアウト）を返す API。
 * UI や他ツールが列位置を機械的に把握するために使う。
 *
 * @return {{ok:boolean, schema?:Object, error?:string}}
 */
function getSheetSchemaApi() {
  try {
    return { ok: true, schema: sheetSchemaDescriptor() };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}
