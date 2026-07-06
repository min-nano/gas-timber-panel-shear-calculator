/**
 * スプレッドシートへの保存（GAS 専用の I/O レイヤ）
 * =====================================================================
 * 1 スプレッドシート = 1 物件（プロジェクト）とし、計算 1 回分（入力値＋計算結果）を
 * 2 つのタブへ書き込む:
 *   - 現在値タブ（既定「パターン」）… patternId で upsert。1 行 = 1 パターンの正本。
 *   - 履歴タブ（既定「履歴」）      … 常に追記。1 行 = 1 保存の時系列ログ。
 *
 * 列レイアウト（セルのマッピング）は SheetSchema.js に一元化されたスキーマを
 * 唯一の定義として用いる。本ファイルは SpreadsheetApp/DriveApp 等の GAS 専用 API を
 * 扱うため、Node のユニットテスト対象からは外す（テスト対象の純粋ロジックは
 * SheetSchema.js 側に置く）。
 *
 * 実行はアクセスユーザーとして行われる（appsscript.json: USER_ACCESSING）ため、
 * 保存先は各ユーザー自身の Drive。scope は drive.file（アプリが作成/選択した
 * ファイルのみ）＋ spreadsheets の最小権限で足りる。
 * =====================================================================
 */

/**
 * 新規作成するスプレッドシートの既定名。
 * @type {string}
 */
var DEFAULT_SPREADSHEET_NAME = '面材張り耐力要素 計算履歴';

/**
 * 計算 1 回分を保存する。現在値タブへ upsert し、履歴タブへ追記する。
 *
 * options:
 *   - spreadsheetId {string}   … 既存の保存先。あれば追記、無ければ新規作成。
 *   - spreadsheetName {string} … 新規作成時のファイル名（既定: DEFAULT_SPREADSHEET_NAME）。
 *   - folderId {string}        … 新規作成時に格納する Drive フォルダ ID（任意）。
 *   - projectName {string}     … 物件名。
 *   - patternId {string}       … パターン識別子（現在値タブの upsert キー）。
 *   - patternName {string}     … パターン名。
 *   - currentSheetName {string}… 現在値タブ名（既定: SHEET_CURRENT_TAB_NAME）。
 *   - historySheetName {string}… 履歴タブ名（既定: SHEET_HISTORY_TAB_NAME）。
 *
 * @param {{width:number, height:number, panelArea:number, nails:{x:number,y:number}[]}} input 入力
 * @param {Object} result computeNailArrayConstants の戻り値
 * @param {Object} [options] 保存先・識別オプション
 * @return {{spreadsheetId:string, spreadsheetUrl:string,
 *          currentSheetName:string, historySheetName:string,
 *          patternRow:number, patternInserted:boolean, historyRow:number,
 *          patternId:string, schemaVersion:number}} 保存結果
 */
function saveSheetRecord(input, result, options) {
  options = options || {};
  var currentName = options.currentSheetName || SHEET_CURRENT_TAB_NAME;
  var historyName = options.historySheetName || SHEET_HISTORY_TAB_NAME;
  var meta = {
    projectName: options.projectName,
    patternId: options.patternId,
    patternName: options.patternName
  };

  var spreadsheet = openOrCreateSpreadsheet_(options);

  // スキーマに沿ってレコード化 → 列順の 1 行へ変換。
  var record = buildSheetRecord(input, result, new Date(), meta);
  var row = sheetRowFromRecord(record);

  // 現在値タブ: patternId で upsert（同じパターンは同じ行を上書き）。
  var currentSheet = ensureSheetWithHeader_(spreadsheet, currentName);
  var upsert = upsertByPatternId_(currentSheet, row, record.patternId);

  // 履歴タブ: 常に追記。
  var historySheet = ensureSheetWithHeader_(spreadsheet, historyName);
  historySheet.appendRow(row);

  return {
    spreadsheetId: spreadsheet.getId(),
    spreadsheetUrl: spreadsheet.getUrl(),
    currentSheetName: currentName,
    historySheetName: historyName,
    patternRow: upsert.rowNumber,
    patternInserted: upsert.inserted,
    historyRow: historySheet.getLastRow(),
    patternId: record.patternId,
    schemaVersion: SHEET_SCHEMA_VERSION
  };
}

/**
 * 物件（スプレッドシート）内の全パターン（現在値タブの各行）を読み出す。
 * アプリのページネーション（パターン切替）・既存物件の読み込みに使う。
 *
 * @param {string} spreadsheetId 対象スプレッドシートの ID
 * @param {Object} [options] { currentSheetName }
 * @return {{spreadsheetId:string, spreadsheetUrl:string, currentSheetName:string,
 *          patterns:Object[], schemaVersion:number}} パターン一覧（列キー付きレコード）
 */
function loadSheetPatterns(spreadsheetId, options) {
  options = options || {};
  var currentName = options.currentSheetName || SHEET_CURRENT_TAB_NAME;

  var spreadsheet = SpreadsheetApp.openById(spreadsheetId);
  var sheet = spreadsheet.getSheetByName(currentName);
  var patterns = [];

  if (sheet) {
    var lastRow = sheet.getLastRow();
    if (lastRow >= 2) {
      var values = sheet.getRange(2, 1, lastRow - 1, SHEET_COLUMNS.length).getValues();
      for (var i = 0; i < values.length; i++) {
        patterns.push(sheetRecordFromRow(values[i]));
      }
    }
  }

  return {
    spreadsheetId: spreadsheet.getId(),
    spreadsheetUrl: spreadsheet.getUrl(),
    currentSheetName: currentName,
    patterns: patterns,
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
 * 新規スプレッドシート作成直後の空の既定シート（1 枚だけ・空）があれば、
 * それを改名して流用する。
 *
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} spreadsheet 保存先
 * @param {string} sheetName タブ名
 * @return {GoogleAppsScript.Spreadsheet.Sheet}
 */
function ensureSheetWithHeader_(spreadsheet, sheetName) {
  var sheet = spreadsheet.getSheetByName(sheetName);

  if (!sheet) {
    var sheets = spreadsheet.getSheets();
    if (sheets.length === 1 && sheets[0].getLastRow() === 0) {
      // 新規作成直後の空の既定シートを流用・改名する。
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

/**
 * 現在値タブへ patternId をキーに upsert する。
 * 既存の一致行があれば上書き、無ければ追記する。
 * patternId が空の場合は同定できないため、常に追記扱いとする。
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet 現在値タブ
 * @param {Array} row 列順の値
 * @param {string} patternId upsert キー
 * @return {{rowNumber:number, inserted:boolean}} 書き込んだ行番号と、新規追加か否か
 */
function upsertByPatternId_(sheet, row, patternId) {
  var keyCol = sheetColumnIndex(SHEET_KEY_COLUMN); // 1 始まり
  var lastRow = sheet.getLastRow();

  if (patternId && keyCol > 0 && lastRow >= 2) {
    var ids = sheet.getRange(2, keyCol, lastRow - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      if (String(ids[i][0]) === String(patternId)) {
        var target = i + 2; // 見出し行を除いた 0 始まり → 実行行番号
        sheet.getRange(target, 1, 1, row.length).setValues([row]);
        return { rowNumber: target, inserted: false };
      }
    }
  }

  sheet.appendRow(row);
  return { rowNumber: sheet.getLastRow(), inserted: true };
}
