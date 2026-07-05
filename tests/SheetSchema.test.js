/**
 * スプレッドシート保存スキーマ（セルマッピング）のユニットテスト
 * =====================================================================
 * Node.js 標準のテストランナー（node:test）で実行する（外部依存なし）。
 *   $ npm test
 *
 * テスト対象: ../src/SheetSchema.js（セルマッピングの唯一の定義。GAS と共通）
 *
 * ねらい:
 *   - 列レイアウト（キー → 列位置）が安定していることを保証する。
 *   - 入力値・計算結果からスキーマ順の行を正しく組み立てられることを保証する。
 *   これらが崩れると、履歴シートを参照する他シート/スクリプトが静かにバグるため、
 *   マッピングをテストで固定する（＝リグレッション検知）。
 * =====================================================================
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const schema = require('../src/SheetSchema.js');
const calc = require('../src/NailArrayConstants.js');

test.describe('スキーマ版とセルマッピングの安定性', () => {
  test.it('スキーマ版は正の整数', () => {
    assert.ok(Number.isInteger(schema.SHEET_SCHEMA_VERSION));
    assert.ok(schema.SHEET_SCHEMA_VERSION >= 1);
  });

  test.it('列キーは一意', () => {
    const keys = schema.SHEET_COLUMNS.map((c) => c.key);
    assert.strictEqual(new Set(keys).size, keys.length);
  });

  test.it('各列は key / header / source を持ち、source は meta|input|result', () => {
    for (const col of schema.SHEET_COLUMNS) {
      assert.ok(col.key && typeof col.key === 'string');
      assert.ok(col.header && typeof col.header === 'string');
      assert.ok(['meta', 'input', 'result'].includes(col.source), '不正な source: ' + col.source);
    }
  });

  test.it('先頭 2 列はメタ（記録日時・スキーマ版）で固定', () => {
    assert.strictEqual(schema.SHEET_COLUMNS[0].key, 'recordedAt');
    assert.strictEqual(schema.SHEET_COLUMNS[1].key, 'schemaVersion');
  });

  test.it('入力列と結果列の両方が存在する（結果セルも保存する）', () => {
    const sources = schema.SHEET_COLUMNS.map((c) => c.source);
    assert.ok(sources.includes('input'), '入力列が無い');
    assert.ok(sources.includes('result'), '結果列が無い');
  });

  test.it('計算結果の全キーが結果列としてマッピングされている', () => {
    // computeNailArrayConstants の出力キーが漏れなく列化されていること。
    const resultKeys = ['x0', 'y0', 'Ix', 'Iy', 'Ixy', 'dxMax', 'dyMax',
      'Zx', 'Zy', 'Zxy', 'alphaX', 'Zpxy', 'Cxy'];
    const mapped = new Set(schema.SHEET_COLUMNS.map((c) => c.key));
    for (const k of resultKeys) {
      assert.ok(mapped.has(k), '結果キーが列に無い: ' + k);
    }
  });
});

test.describe('列位置の問い合わせ（sheetColumnIndex / sheetColumnLetter）', () => {
  test.it('1 始まりの列番号を返す', () => {
    assert.strictEqual(schema.sheetColumnIndex('recordedAt'), 1);
    assert.strictEqual(schema.sheetColumnIndex('schemaVersion'), 2);
  });
  test.it('未知のキーは -1', () => {
    assert.strictEqual(schema.sheetColumnIndex('does_not_exist'), -1);
  });
  test.it('列番号 → A1 列文字の変換', () => {
    assert.strictEqual(schema.sheetIndexToLetter(1), 'A');
    assert.strictEqual(schema.sheetIndexToLetter(26), 'Z');
    assert.strictEqual(schema.sheetIndexToLetter(27), 'AA');
    assert.strictEqual(schema.sheetIndexToLetter(28), 'AB');
  });
  test.it('キー → 列文字（他スクリプトからの参照用）', () => {
    assert.strictEqual(schema.sheetColumnLetter('recordedAt'), 'A');
    // Cxy は最終列。列数と一致する位置にあること。
    assert.strictEqual(
      schema.sheetColumnLetter('Cxy'),
      schema.sheetIndexToLetter(schema.SHEET_COLUMNS.length)
    );
  });
  test.it('未知のキーは例外', () => {
    assert.throws(() => schema.sheetColumnLetter('nope'));
  });
});

test.describe('見出し行（sheetHeaderRow）', () => {
  test.it('列数と一致し、単位付きラベルになる', () => {
    const header = schema.sheetHeaderRow();
    assert.strictEqual(header.length, schema.SHEET_COLUMNS.length);
    assert.strictEqual(header[schema.sheetColumnIndex('width') - 1], '面材幅 W [mm]');
    // 無単位の列は単位角括弧を付けない。
    assert.strictEqual(header[schema.sheetColumnIndex('Cxy') - 1], 'Cxy');
  });
});

test.describe('レコード組み立てと行変換（buildSheetRecord / sheetRowFromRecord）', () => {
  const nails = calc.buildRectangularGrid([0, 445, 890], [0, 145, 295, 445, 590]);
  const panelArea = 610 * 910;
  const result = calc.computeNailArrayConstants(nails, panelArea);
  const recordedAt = new Date('2026-07-05T00:00:00Z');
  const record = schema.buildSheetRecord(
    { width: 610, height: 910, panelArea: panelArea, nails: nails },
    result,
    recordedAt
  );

  test.it('入力値がレコードへ反映される', () => {
    assert.strictEqual(record.width, 610);
    assert.strictEqual(record.height, 910);
    assert.strictEqual(record.panelArea, panelArea);
    assert.strictEqual(record.nailCount, 15);
    assert.strictEqual(record.schemaVersion, schema.SHEET_SCHEMA_VERSION);
    assert.strictEqual(record.recordedAt, recordedAt);
  });

  test.it('結果セルの値がレコードへ反映される', () => {
    assert.strictEqual(record.x0, 445);
    assert.strictEqual(record.y0, 295);
    assert.strictEqual(record.Ix, 657150);
    assert.strictEqual(record.Cxy, result.Cxy);
  });

  test.it('釘座標は JSON 文字列として復元可能な形で保存される', () => {
    const restored = JSON.parse(record.nailCoords);
    assert.strictEqual(restored.length, 15);
    assert.deepStrictEqual(restored[0], { x: 0, y: 0 });
  });

  test.it('行は列順どおりに並ぶ（マッピング一致）', () => {
    const row = schema.sheetRowFromRecord(record);
    assert.strictEqual(row.length, schema.SHEET_COLUMNS.length);
    // 各列の値が「その列のキーの値」と一致すること。
    schema.SHEET_COLUMNS.forEach((col, i) => {
      const expected = record[col.key] === undefined ? '' : record[col.key];
      assert.strictEqual(row[i], expected, '列ずれ: ' + col.key);
    });
    // 具体的な位置の抜き取り検証。
    assert.strictEqual(row[schema.sheetColumnIndex('Cxy') - 1], result.Cxy);
  });

  test.it('非有限値（NaN/Infinity/未定義）は空欄になる', () => {
    const r = schema.buildSheetRecord({ width: NaN, nails: [] }, { x0: Infinity });
    assert.strictEqual(r.width, '');
    assert.strictEqual(r.x0, '');
    // 列変換でも欠損は空文字。
    const row = schema.sheetRowFromRecord(r);
    assert.strictEqual(row.length, schema.SHEET_COLUMNS.length);
  });
});

test.describe('スキーマ自己記述（sheetSchemaDescriptor）', () => {
  test.it('version と columns（index・letter 付き）を返す', () => {
    const d = schema.sheetSchemaDescriptor();
    assert.strictEqual(d.version, schema.SHEET_SCHEMA_VERSION);
    assert.strictEqual(d.columns.length, schema.SHEET_COLUMNS.length);
    assert.strictEqual(d.columns[0].index, 1);
    assert.strictEqual(d.columns[0].letter, 'A');
    // descriptor の letter は sheetColumnLetter と整合する。
    for (const col of d.columns) {
      assert.strictEqual(col.letter, schema.sheetColumnLetter(col.key));
    }
  });
});
