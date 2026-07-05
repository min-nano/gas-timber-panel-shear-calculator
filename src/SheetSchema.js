/**
 * スプレッドシート保存レイアウト（セルマッピング）のスキーマ定義
 * =====================================================================
 * 計算の入力値と結果を Google スプレッドシートへ保存する際の、列の並び
 * （＝セルのマッピング）を一元管理する。
 *
 * 【データモデル（v2）】
 *   - 1 スプレッドシート = 1 物件（プロジェクト）。
 *   - 1 物件は複数の「パターン」を持つ（例: 同一物件内の複数の面材配置）。
 *   - 保存は 2 タブ構成:
 *       ・現在値タブ（既定名「パターン」）… 1 行 = 1 パターン。patternId で upsert
 *         （＝同じパターンは常に同じ行を上書き）。他シート/スクリプトが参照する正本。
 *       ・履歴タブ（既定名「履歴」）… 1 行 = 1 保存。常に追記。時系列の記録。
 *   - どちらのタブも本ファイルの同一スキーマ（列レイアウト）を用いる。
 *
 * 【なぜスキーマを切り出すのか】
 *   将来、別のシート・スクリプト・帳票がこのシートを参照する可能性がある。
 *   列位置をハードコードすると、列を 1 つ挿入しただけで全参照がずれ、静かにバグる。
 *   そこで列レイアウトを本ファイルに集約し、バージョン番号（SHEET_SCHEMA_VERSION）
 *   で管理する。参照側は
 *     - 各行に記録される schemaVersion 列でレイアウト版を確認できる
 *     - sheetColumnLetter('Cxy') のように「キー → 列」を問い合わせできる
 *   ため、列位置が変わってもコードを1か所直せば追従できる。
 *   さらに現在値タブでは patternId で行が固定される（upsert）ため、
 *   「列＝フィールド」「行＝パターン」の 2 次元でセル参照が安定する。
 *
 * 【バージョン運用】
 *   列の追加・削除・並べ替え・意味の変更を行ったら SHEET_SCHEMA_VERSION を上げる。
 *   既存行の schemaVersion 値は変更しない（過去データはその版のレイアウトのまま）。
 *
 * このファイルは「セルマッピングの唯一の定義」であり、
 *   - Google Apps Script（サーバサイド。SheetStorage.js から利用）
 *   - Node.js（tests/ 以下のユニットテスト）
 * の双方から読み込まれる（末尾の環境ガードを参照）。純粋関数のみで構成し、
 * SpreadsheetApp 等の GAS 専用 API には依存しない（＝テスト可能に保つ）。
 * =====================================================================
 */

/**
 * セルマッピングのスキーマ版。
 * 列レイアウトを変更したら必ずインクリメントすること。
 *   v1 → v2: 物件名・パターンID・パターン名（key 列）を追加。
 * @type {number}
 */
var SHEET_SCHEMA_VERSION = 2;

/**
 * 現在値タブで upsert（行の同定）に用いるキー列のキー名。
 * @type {string}
 */
var SHEET_KEY_COLUMN = 'patternId';

/**
 * 各タブ（シート）の既定名。
 */
var SHEET_CURRENT_TAB_NAME = 'パターン';   // 現在値: 1 行 = 1 パターン（upsert）
var SHEET_HISTORY_TAB_NAME = '履歴';       // 履歴  : 1 行 = 1 保存（追記）

/**
 * 列定義（この配列の並び順が、そのままセルのマッピング）。
 * 各列:
 *   - key    … レコード内部のキー（プログラムからの参照名。変更しない）
 *   - header … シート見出し行に表示する日本語ラベル
 *   - unit   … 単位（見出しに [unit] として付与。無単位は ''）
 *   - source … 'meta'（記録メタ）/ 'key'（物件・パターン識別）/
 *              'input'（入力値）/ 'result'（計算結果）
 *
 * 入力値だけでなく結果セルも列として持つことで、他データとの連携時に
 * 再計算せずとも結果を直接参照できる。
 * @type {{key:string, header:string, unit:string, source:string}[]}
 */
var SHEET_COLUMNS = [
  { key: 'recordedAt',    header: '記録日時',            unit: '',          source: 'meta' },
  { key: 'schemaVersion', header: 'スキーマ版',          unit: '',          source: 'meta' },

  { key: 'projectName',   header: '物件名',              unit: '',          source: 'key' },
  { key: 'patternId',     header: 'パターンID',          unit: '',          source: 'key' },
  { key: 'patternName',   header: 'パターン名',          unit: '',          source: 'key' },

  { key: 'width',         header: '面材幅 W',            unit: 'mm',        source: 'input' },
  { key: 'height',        header: '面材高さ H',          unit: 'mm',        source: 'input' },
  { key: 'panelArea',     header: '面材面積 Aw',         unit: 'mm^2',      source: 'input' },
  { key: 'nailCount',     header: '釘本数 n',            unit: '',          source: 'input' },
  { key: 'nailCoords',    header: '釘座標(JSON)',        unit: 'mm',        source: 'input' },

  { key: 'x0',            header: 'X方向中立軸 x0',      unit: 'mm',        source: 'result' },
  { key: 'y0',            header: 'Y方向中立軸 y0',      unit: 'mm',        source: 'result' },
  { key: 'Ix',            header: '二次モーメント Ix',   unit: 'mm^2',      source: 'result' },
  { key: 'Iy',            header: '二次モーメント Iy',   unit: 'mm^2',      source: 'result' },
  { key: 'Ixy',           header: 'Ixy',                 unit: 'mm^2/mm^2', source: 'result' },
  { key: 'dxMax',         header: '端部距離 (x-x0)max',  unit: 'mm',        source: 'result' },
  { key: 'dyMax',         header: '端部距離 (y-y0)max',  unit: 'mm',        source: 'result' },
  { key: 'Zx',            header: '釘配列係数 Zx',       unit: 'mm',        source: 'result' },
  { key: 'Zy',            header: '釘配列係数 Zy',       unit: 'mm',        source: 'result' },
  { key: 'Zxy',           header: 'Zxy',                 unit: 'mm/mm^2',   source: 'result' },
  { key: 'alphaX',        header: '変形割合 alphaX',     unit: '',          source: 'result' },
  { key: 'Zpxy',          header: '塑性釘配列係数 Zpxy', unit: 'mm/mm^2',   source: 'result' },
  { key: 'Cxy',           header: 'Cxy',                 unit: '',          source: 'result' }
];

/**
 * 列の見出しラベル（単位付き）を返す。unit が空なら header のみ。
 * 例: {header:'面材幅 W', unit:'mm'} → '面材幅 W [mm]'
 *
 * @param {{header:string, unit:string}} column 列定義
 * @return {string} 見出しラベル
 */
function sheetHeaderLabel(column) {
  return column.unit ? column.header + ' [' + column.unit + ']' : column.header;
}

/**
 * 見出し行（シート 1 行目に書き込む配列）を返す。
 * @return {string[]} 各列の見出しラベル
 */
function sheetHeaderRow() {
  return SHEET_COLUMNS.map(sheetHeaderLabel);
}

/**
 * 指定キーの列が何番目か（1 始まり。スプレッドシートの列番号に一致）を返す。
 * @param {string} key 列キー
 * @return {number} 1 始まりの列番号。存在しなければ -1
 */
function sheetColumnIndex(key) {
  for (var i = 0; i < SHEET_COLUMNS.length; i++) {
    if (SHEET_COLUMNS[i].key === key) {
      return i + 1;
    }
  }
  return -1;
}

/**
 * 1 始まりの列番号を A1 記法の列文字（1→A, 27→AA …）に変換する。
 * @param {number} index 1 始まりの列番号
 * @return {string} 列文字
 */
function sheetIndexToLetter(index) {
  if (typeof index !== 'number' || index < 1) {
    throw new Error('sheetIndexToLetter: 列番号は 1 以上である必要があります。');
  }
  var n = index;
  var letter = '';
  while (n > 0) {
    var rem = (n - 1) % 26;
    letter = String.fromCharCode(65 + rem) + letter;
    n = Math.floor((n - 1) / 26);
  }
  return letter;
}

/**
 * 指定キーの列の A1 列文字を返す（他シート/スクリプトからの参照用）。
 * 例: sheetColumnLetter('Cxy') → 'W'
 *
 * @param {string} key 列キー
 * @return {string} A1 列文字
 */
function sheetColumnLetter(key) {
  var index = sheetColumnIndex(key);
  if (index < 0) {
    throw new Error('sheetColumnLetter: 未知の列キーです: ' + key);
  }
  return sheetIndexToLetter(index);
}

/**
 * 値が有限数なら数値のまま、そうでなければ空文字（セル空欄）を返す補助関数。
 * @param {*} v 値
 * @return {number|string} 数値または ''
 */
function numberOrBlank(v) {
  return (typeof v === 'number' && isFinite(v)) ? v : '';
}

/**
 * 値を文字列セル値へ正規化する（null/undefined は空欄）。
 * @param {*} v 値
 * @return {string} 文字列または ''
 */
function stringOrBlank(v) {
  return (v === undefined || v === null) ? '' : String(v);
}

/**
 * 入力値・計算結果・識別情報から、スキーマに沿った 1 レコード
 * （列キー → 値の平坦オブジェクト）を組み立てる。
 * 結果セルの値も一緒に確定させることで、保存後に他データと連携しやすくする。
 *
 * @param {{width:number, height:number, panelArea:number, nails:{x:number,y:number}[]}} input 入力
 * @param {Object} result computeNailArrayConstants の戻り値
 * @param {Date|string} [recordedAt] 記録日時（省略時は空欄）
 * @param {{projectName?:string, patternId?:string, patternName?:string}} [meta] 物件・パターン識別
 * @return {Object} 列キーをプロパティに持つレコード
 */
function buildSheetRecord(input, result, recordedAt, meta) {
  input = input || {};
  result = result || {};
  meta = meta || {};
  return {
    recordedAt: (recordedAt !== undefined && recordedAt !== null) ? recordedAt : '',
    schemaVersion: SHEET_SCHEMA_VERSION,

    projectName: stringOrBlank(meta.projectName),
    patternId: stringOrBlank(meta.patternId),
    patternName: stringOrBlank(meta.patternName),

    width: numberOrBlank(input.width),
    height: numberOrBlank(input.height),
    panelArea: numberOrBlank(input.panelArea !== undefined ? input.panelArea : result.panelArea),
    nailCount: numberOrBlank(result.n !== undefined ? result.n : (input.nails ? input.nails.length : undefined)),
    nailCoords: input.nails ? JSON.stringify(input.nails) : '',

    x0: numberOrBlank(result.x0),
    y0: numberOrBlank(result.y0),
    Ix: numberOrBlank(result.Ix),
    Iy: numberOrBlank(result.Iy),
    Ixy: numberOrBlank(result.Ixy),
    dxMax: numberOrBlank(result.dxMax),
    dyMax: numberOrBlank(result.dyMax),
    Zx: numberOrBlank(result.Zx),
    Zy: numberOrBlank(result.Zy),
    Zxy: numberOrBlank(result.Zxy),
    alphaX: numberOrBlank(result.alphaX),
    Zpxy: numberOrBlank(result.Zpxy),
    Cxy: numberOrBlank(result.Cxy)
  };
}

/**
 * レコードを、SHEET_COLUMNS の並び順どおりの 1 次元配列（＝シートの 1 行）に変換する。
 * この配列の並びがセルのマッピングそのもの。
 *
 * @param {Object} record buildSheetRecord の戻り値
 * @return {Array} 各列の値（列順）
 */
function sheetRowFromRecord(record) {
  record = record || {};
  return SHEET_COLUMNS.map(function (column) {
    var v = record[column.key];
    return v === undefined ? '' : v;
  });
}

/**
 * シートの 1 行（列順の配列）を、列キー付きのレコードへ復元する。
 * 現在値タブの読み出し（パターン一覧の取得）に用いる。
 *
 * @param {Array} row 列順の値の配列
 * @return {Object} 列キーをプロパティに持つレコード
 */
function sheetRecordFromRow(row) {
  row = row || [];
  var record = {};
  for (var i = 0; i < SHEET_COLUMNS.length; i++) {
    record[SHEET_COLUMNS[i].key] = row[i];
  }
  return record;
}

/**
 * スキーマの自己記述（バージョン・キー列・タブ名・列マッピング一覧）を返す。
 * 他のスクリプトや UI が列レイアウトを機械的に把握するために使う。
 *
 * @return {{version:number, keyColumn:string, tabs:{current:string, history:string},
 *          columns:{key:string, header:string, unit:string, source:string,
 *          index:number, letter:string}[]}}
 */
function sheetSchemaDescriptor() {
  return {
    version: SHEET_SCHEMA_VERSION,
    keyColumn: SHEET_KEY_COLUMN,
    tabs: { current: SHEET_CURRENT_TAB_NAME, history: SHEET_HISTORY_TAB_NAME },
    columns: SHEET_COLUMNS.map(function (column, i) {
      return {
        key: column.key,
        header: column.header,
        unit: column.unit,
        source: column.source,
        index: i + 1,
        letter: sheetIndexToLetter(i + 1)
      };
    })
  };
}

// ---------------------------------------------------------------------
// 環境ガード:
//   - Node.js（テスト実行時）では module.exports へ公開する。
//   - Google Apps Script では module が未定義のため無視され、各関数・定数は
//     グローバルとして SheetStorage.js から直接利用できる。
// ---------------------------------------------------------------------
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SHEET_SCHEMA_VERSION: SHEET_SCHEMA_VERSION,
    SHEET_KEY_COLUMN: SHEET_KEY_COLUMN,
    SHEET_CURRENT_TAB_NAME: SHEET_CURRENT_TAB_NAME,
    SHEET_HISTORY_TAB_NAME: SHEET_HISTORY_TAB_NAME,
    SHEET_COLUMNS: SHEET_COLUMNS,
    sheetHeaderLabel: sheetHeaderLabel,
    sheetHeaderRow: sheetHeaderRow,
    sheetColumnIndex: sheetColumnIndex,
    sheetIndexToLetter: sheetIndexToLetter,
    sheetColumnLetter: sheetColumnLetter,
    numberOrBlank: numberOrBlank,
    stringOrBlank: stringOrBlank,
    buildSheetRecord: buildSheetRecord,
    sheetRowFromRecord: sheetRowFromRecord,
    sheetRecordFromRow: sheetRecordFromRow,
    sheetSchemaDescriptor: sheetSchemaDescriptor
  };
}
