/**
 * スプレッドシートへの保存（GAS 専用の I/O レイヤ）
 * =====================================================================
 * 計算 1 回分（入力値＋計算結果）を、履歴シートへ「1 行 = 1 スナップショット」で
 * 追記保存する。列レイアウト（セルのマッピング）は SheetSchema.js に一元化された
 * スキーマを唯一の定義として用いる。本ファイルは SpreadsheetApp/DriveApp 等の
 * GAS 専用 API を扱うため、Node のユニットテスト対象からは外す
 * （テスト対象の純粋ロジックは SheetSchema.js 側に置く）。
 *
 * 実行はアクセスユーザーとして行われる（appsscript.json: USER_ACCESSING）ため、
 * 保存先は各ユーザー自身の Drive。scope は drive.file（アプリが作成/選択した
 * ファイルのみ）＋ spreadsheets の最小権限で足りる。
 * =====================================================================
 */

/**
 * 履歴を書き込むシート（タブ）の既定名。
 * @type {string}
 */
var DEFAULT_HISTORY_SHEET_NAME = '計算履歴';

/**
 * 新規作成するスプレッドシートの既定名。
 * @type {string}
 */
var DEFAULT_SPREADSHEET_NAME = '面材張り耐力要素 計算履歴';

/**
 * 計算 1 回分を履歴シートへ追記保存する。
 *
 * options:
 *   - spreadsheetId {string}   … 既存の保存先。あれば追記、無ければ新規作成。
 *   - spreadsheetName {string} … 新規作成時のファイル名（既定: DEFAULT_SPREADSHEET_NAME）。
 *   - sheetName {string}       … タブ名（既定: DEFAULT_HISTORY_SHEET_NAME）。
 *   - folderId {string}        … 新規作成時に格納する Drive フォルダ ID（任意）。
 *
 * @param {{width:number, height:number, panelArea:number, nails:{x:number,y:number}[]}} input 入力
 * @param {Object} result computeNailArrayConstants の戻り値
 * @param {Object} [options] 保存先オプション
 * @return {{spreadsheetId:string, spreadsheetUrl:string, sheetName:string,
 *          rowNumber:number, schemaVersion:number}} 保存結果
 */
function saveSheetRecord(input, result, options) {
  options = options || {};
  var sheetName = options.sheetName || DEFAULT_HISTORY_SHEET_NAME;

  var spreadsheet = openOrCreateSpreadsheet_(options);
  var sheet = ensureHistorySheet_(spreadsheet, sheetName);

  // スキーマに沿ってレコード化 → 列順の 1 行へ変換して追記。
  var record = buildSheetRecord(input, result, new Date());
  var row = sheetRowFromRecord(record);
  sheet.appendRow(row);

  return {
    spreadsheetId: spreadsheet.getId(),
    spreadsheetUrl: spreadsheet.getUrl(),
    sheetName: sheetName,
    rowNumber: sheet.getLastRow(),
    schemaVersion: SHEET_SCHEMA_VERSION
  };
}

/**
 * 保存先スプレッドシートを開く（spreadsheetId 指定時）か、新規作成する。
 * 新規作成時、folderId 指定があればそのフォルダへ移動する（drive.file 権限の範囲内）。
 *
 * @param {Object} options saveSheetRecord の options
 * @return {GoogleAppsScript.Spreadsheet.Spreadsheet}
 */
function openOrCreateSpreadsheet_(options) {
  if (options.spreadsheetId) {
    return SpreadsheetApp.openById(options.spreadsheetId);
  }
  var name = options.spreadsheetName || DEFAULT_SPREADSHEET_NAME;
  var spreadsheet = SpreadsheetApp.create(name);

  if (options.folderId) {
    try {
      var file = DriveApp.getFileById(spreadsheet.getId());
      var folder = DriveApp.getFolderById(options.folderId);
      folder.addFile(file);
      DriveApp.getRootFolder().removeFile(file);
    } catch (err) {
      // フォルダ移動に失敗してもマイドライブ直下に残るだけで保存自体は成立する。
      // 保存を止めないため、ここでは握りつぶしてログのみ残す。
      console.warn('フォルダへの移動に失敗しました: ' + (err && err.message ? err.message : err));
    }
  }
  return spreadsheet;
}

/**
 * 指定名のタブを取得（無ければ作成）し、見出し行がスキーマと一致していることを保証する。
 * 先頭シート（新規作成時の「シート1」）が空なら、それを履歴シートとして流用・改名する。
 *
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} spreadsheet 保存先
 * @param {string} sheetName タブ名
 * @return {GoogleAppsScript.Spreadsheet.Sheet}
 */
function ensureHistorySheet_(spreadsheet, sheetName) {
  var sheet = spreadsheet.getSheetByName(sheetName);

  if (!sheet) {
    // 新規作成直後の空の既定シートがあれば、それを改名して使い回す。
    var sheets = spreadsheet.getSheets();
    if (sheets.length === 1 && sheets[0].getLastRow() === 0) {
      sheet = sheets[0].setName(sheetName);
    } else {
      sheet = spreadsheet.insertSheet(sheetName);
    }
  }

  ensureHeaderRow_(sheet);
  return sheet;
}

/**
 * シート 1 行目にスキーマの見出し行を保証する。
 * 空なら見出しを書き込み、太字・固定表示にする。既に何かあれば尊重して上書きしない
 * （各行の schemaVersion 列でレイアウト版は追跡できるため、旧版の見出しは壊さない）。
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet シート
 */
function ensureHeaderRow_(sheet) {
  var header = sheetHeaderRow();
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, header.length).setValues([header]);
    sheet.getRange(1, 1, 1, header.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
}
