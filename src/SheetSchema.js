/**
 * スプレッドシート保存レイアウト（セルマッピング）のスキーマ定義
 * =====================================================================
 * 計算の入力値と結果を Google スプレッドシートへ「1 行 = 1 計算スナップショット」
 * で追記保存する際の、列の並び（＝セルのマッピング）を一元管理する。
 *
 * 【なぜスキーマを切り出すのか】
 *   将来、別のシート・スクリプト・帳票がこの履歴シートを参照する可能性がある。
 *   そのとき「Cxy は S 列」のように列位置をハードコードすると、列を 1 つ挿入した
 *   だけで全参照がずれ、静かにバグる。そこで列レイアウトを本ファイルに集約し、
 *   バージョン番号（SHEET_SCHEMA_VERSION）で管理する。参照側は
 *     - 各行に記録される schemaVersion 列でレイアウト版を確認できる
 *     - sheetColumnLetter('Cxy') のように「キー → 列」を問い合わせできる
 *   ため、列位置が変わってもコードを1か所直せば追従できる。
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
 * @type {number}
 */
var SHEET_SCHEMA_VERSION = 1;

/**
 * 履歴シートの列定義（この配列の並び順が、そのままセルのマッピング）。
 * 各列:
 *   - key    … レコード内部のキー（プログラムからの参照名。変更しない）
 *   - header … シート見出し行に表示する日本語ラベル
 *   - unit   … 単位（見出しに [unit] として付与。無単位は ''）
 *   - source … 'meta'（記録メタ情報）/ 'input'（入力値）/ 'result'（計算結果）
 *
 * 入力値だけでなく結果セルも列として持つことで、他データとの連携時に
 * 再計算せずとも結果を直接参照できる。
 * @type {{key:string, header:string, unit:string, source:string}[]}
 */
var SHEET_COLUMNS = [
  { key: 'recordedAt',    header: '記録日時',            unit: '',         source: 'meta' },
  { key: 'schemaVersion', header: 'スキーマ版',          unit: '',         source: 'meta' },

  { key: 'width',         header: '面材幅 W',            unit: 'mm',       source: 'input' },
  { key: 'height',        header: '面材高さ H',          unit: 'mm',       source: 'input' },
  { key: 'panelArea',     header: '面材面積 Aw',         unit: 'mm^2',     source: 'input' },
  { key: 'nailCount',     header: '釘本数 n',            unit: '',         source: 'input' },
  { key: 'nailCoords',    header: '釘座標(JSON)',        unit: 'mm',       source: 'input' },

  { key: 'x0',            header: 'X方向中立軸 x0',      unit: 'mm',       source: 'result' },
  { key: 'y0',            header: 'Y方向中立軸 y0',      unit: 'mm',       source: 'result' },
  { key: 'Ix',            header: '二次モーメント Ix',   unit: 'mm^2',     source: 'result' },
  { key: 'Iy',            header: '二次モーメント Iy',   unit: 'mm^2',     source: 'result' },
  { key: 'Ixy',           header: 'Ixy',                 unit: 'mm^2/mm^2', source: 'result' },
  { key: 'dxMax',         header: '端部距離 (x-x0)max',  unit: 'mm',       source: 'result' },
  { key: 'dyMax',         header: '端部距離 (y-y0)max',  unit: 'mm',       source: 'result' },
  { key: 'Zx',            header: '釘配列係数 Zx',       unit: 'mm',       source: 'result' },
  { key: 'Zy',            header: '釘配列係数 Zy',       unit: 'mm',       source: 'result' },
  { key: 'Zxy',           header: 'Zxy',                 unit: 'mm/mm^2',  source: 'result' },
  { key: 'alphaX',        header: '変形割合 alphaX',     unit: '',         source: 'result' },
  { key: 'Zpxy',          header: '塑性釘配列係数 Zpxy', unit: 'mm/mm^2',  source: 'result' },
  { key: 'Cxy',           header: 'Cxy',                 unit: '',         source: 'result' }
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
 * 例: sheetColumnLetter('Cxy') → 'T'
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
 * 入力値・計算結果から、スキーマに沿った 1 レコード（列キー → 値の平坦オブジェクト）を組み立てる。
 * ここで結果セルの値も一緒に確定させることで、保存後に他データと連携しやすくする。
 *
 * @param {{width:number, height:number, panelArea:number, nails:{x:number,y:number}[]}} input 入力
 * @param {Object} result computeNailArrayConstants の戻り値
 * @param {Date|string} [recordedAt] 記録日時（省略時は呼び出し側で付与）
 * @return {Object} 列キーをプロパティに持つレコード
 */
function buildSheetRecord(input, result, recordedAt) {
  input = input || {};
  result = result || {};
  return {
    recordedAt: recordedAt !== undefined && recordedAt !== null ? recordedAt : '',
    schemaVersion: SHEET_SCHEMA_VERSION,

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
 * 値が有限数なら数値のまま、そうでなければ空文字（セル空欄）を返す補助関数。
 * @param {*} v 値
 * @return {number|string} 数値または ''
 */
function numberOrBlank(v) {
  return (typeof v === 'number' && isFinite(v)) ? v : '';
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
 * スキーマの自己記述（バージョン・列マッピング一覧）を返す。
 * 他のスクリプトや UI が列レイアウトを機械的に把握するために使う。
 *
 * @return {{version:number, columns:{key:string, header:string, unit:string,
 *          source:string, index:number, letter:string}[]}}
 */
function sheetSchemaDescriptor() {
  return {
    version: SHEET_SCHEMA_VERSION,
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
    SHEET_COLUMNS: SHEET_COLUMNS,
    sheetHeaderLabel: sheetHeaderLabel,
    sheetHeaderRow: sheetHeaderRow,
    sheetColumnIndex: sheetColumnIndex,
    sheetIndexToLetter: sheetIndexToLetter,
    sheetColumnLetter: sheetColumnLetter,
    buildSheetRecord: buildSheetRecord,
    numberOrBlank: numberOrBlank,
    sheetRowFromRecord: sheetRowFromRecord,
    sheetSchemaDescriptor: sheetSchemaDescriptor
  };
}
