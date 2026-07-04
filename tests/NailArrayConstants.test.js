/**
 * 釘配列諸定数 計算ライブラリのユニットテスト
 * =====================================================================
 * Node.js 標準のテストランナー（node:test）で実行する（外部依存なし）。
 *   $ npm test            （= node --test tests/）
 *
 * テスト対象: ../src/NailArrayConstants.js（GAS 本体と同一の唯一の実装）
 *
 * 主なテストケース:
 *   1. グレー本 3.2【解説】の計算例（図 3.2.2）を再現する統合テスト。
 *   2. 各関数単位のユニットテスト。
 *   3. 入力検証・エッジケース。
 * =====================================================================
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const calc = require('../src/NailArrayConstants.js');

// --- 補助関数 -------------------------------------------------------

/** 相対/絶対許容誤差での近似比較 */
function assertClose(actual, expected, tol, message) {
  const diff = Math.abs(actual - expected);
  assert.ok(
    diff <= tol,
    (message || '') + ` 期待値≈${expected}, 実測値=${actual}, 差=${diff} (許容=${tol})`
  );
}

/** 指定した桁数に四捨五入する（グレー本の表示桁との突合用） */
function roundTo(value, digits) {
  const f = Math.pow(10, digits);
  return Math.round(value * f) / f;
}

// =====================================================================
// 1. グレー本 3.2【解説】の計算例（図 3.2.2）
//    釘: X ∈ {0, 445, 890}, Y ∈ {0, 145, 295, 445, 590} の格子（15本）
//    面材: 610 × 910 = 555100 mm²
// =====================================================================
test.describe('グレー本 3.2【解説】の計算例（図 3.2.2）', () => {
  const nails = calc.buildRectangularGrid(
    [0, 445, 890],
    [0, 145, 295, 445, 590]
  );
  const panelArea = 610 * 910; // 555100 mm²
  const r = calc.computeNailArrayConstants(nails, panelArea);

  test.it('釘本数・面材面積が正しい', () => {
    assert.strictEqual(r.n, 15);
    assert.strictEqual(r.panelArea, 555100);
  });

  test.it('弾性中立軸位置 x0 = 445, y0 = 295 [mm]', () => {
    assert.strictEqual(r.x0, 445);
    assert.strictEqual(r.y0, 295);
  });

  test.it('釘配列二次モーメント Ix = 657150, Iy = 1980250 [mm²]', () => {
    assert.strictEqual(r.Ix, 657150);
    assert.strictEqual(r.Iy, 1980250);
  });

  test.it('Ixy = 0.889 [mm²/mm²]（式 3.2.1）', () => {
    assert.strictEqual(roundTo(r.Ixy, 3), 0.889);
  });

  test.it('端部距離 (y-y0)max = 295, (x-x0)max = 445 [mm]', () => {
    assert.strictEqual(r.dyMax, 295);
    assert.strictEqual(r.dxMax, 445);
  });

  test.it('釘配列係数 Zx = 2228, Zy = 4450 [mm]（式 3.2.4）', () => {
    assert.strictEqual(roundTo(r.Zx, 0), 2228);
    assert.strictEqual(roundTo(r.Zy, 0), 4450);
  });

  test.it('Zxy = 0.0036 [mm/mm²]（式 3.2.3）', () => {
    assert.strictEqual(roundTo(r.Zxy, 4), 0.0036);
  });

  test.it('αx = 0.751（式 3.2.7）', () => {
    assert.strictEqual(roundTo(r.alphaX, 3), 0.751);
  });

  test.it('Zpxy = 0.0045 [mm/mm²]（式 3.2.6）', () => {
    assert.strictEqual(roundTo(r.Zpxy, 4), 0.0045);
  });

  test.it('Cxy ≈ 1.25〜1.26（式 3.2.5、Cxy ≧ 1.0）', () => {
    // グレー本は丸めた 0.0045 / 0.0036 = 1.25 と表示。
    assert.strictEqual(roundTo(0.0045 / 0.0036, 2), 1.25);
    // 丸め前の厳密値は約 1.26。いずれも 1.0 以上であること。
    assertClose(r.Cxy, 1.26, 0.02, 'Cxy');
    assert.ok(r.Cxy >= 1.0);
  });
});

// =====================================================================
// 2. 各関数単位のユニットテスト
// =====================================================================
test.describe('neutralAxisPosition（弾性中立軸位置, 式 3.2.2 の中立軸）', () => {
  test.it('等間隔配列の中立軸は相加平均', () => {
    assert.strictEqual(calc.neutralAxisPosition([0, 445, 890]), 445);
    assert.strictEqual(calc.neutralAxisPosition([0, 145, 295, 445, 590]), 295);
  });
  test.it('重複座標（本数の重み）を正しく反映する', () => {
    // 0 が2本, 300 が1本 → (0+0+300)/3 = 100
    assert.strictEqual(calc.neutralAxisPosition([0, 0, 300]), 100);
  });
  test.it('空配列は例外', () => {
    assert.throws(() => calc.neutralAxisPosition([]));
  });
});

test.describe('secondMomentOfNailArray（釘配列二次モーメント, 式 3.2.2）', () => {
  test.it('Σ(c-axis)^2 を計算する', () => {
    assert.strictEqual(calc.secondMomentOfNailArray([-1, 1], 0), 2);
    assert.strictEqual(calc.secondMomentOfNailArray([2, 4, 6], 4), 8); // 4+0+4
  });
  test.it('計算例 Ix を再現する', () => {
    const ys = [0, 145, 295, 445, 590, 0, 145, 295, 445, 590, 0, 145, 295, 445, 590];
    assert.strictEqual(calc.secondMomentOfNailArray(ys, 295), 657150);
  });
});

test.describe('maxDistanceFromAxis（端部距離の最大値）', () => {
  test.it('中立軸からの最大絶対距離を返す', () => {
    assert.strictEqual(calc.maxDistanceFromAxis([0, 145, 295, 445, 590], 295), 295);
    assert.strictEqual(calc.maxDistanceFromAxis([0, 445, 890], 445), 445);
  });
});

test.describe('unitSecondMoment（Ixy, 式 3.2.1）', () => {
  test.it('計算例の値を再現する', () => {
    assertClose(calc.unitSecondMoment(657150, 1980250, 555100), 0.8889, 1e-3, 'Ixy');
  });
  test.it('Ix + Iy = 0 は例外', () => {
    assert.throws(() => calc.unitSecondMoment(0, 0, 100));
  });
});

test.describe('arrangementCoefficient（Zx, Zy, 式 3.2.4）', () => {
  test.it('I / dmax を返す', () => {
    assertClose(calc.arrangementCoefficient(657150, 295), 2227.63, 0.1, 'Zx');
    assert.strictEqual(calc.arrangementCoefficient(1980250, 445), 4450);
  });
  test.it('端部距離 0 のとき 0 を返す（0除算を回避）', () => {
    assert.strictEqual(calc.arrangementCoefficient(0, 0), 0);
  });
});

test.describe('unitArrangementCoefficient（Zxy, 式 3.2.3）', () => {
  test.it('計算例の値を再現する', () => {
    assertClose(calc.unitArrangementCoefficient(2228, 4450, 555100), 0.0036, 1e-4, 'Zxy');
  });
  test.it('Zx = 0 のとき Zxy = 0（例外を出さない）', () => {
    assert.strictEqual(calc.unitArrangementCoefficient(0, 4450, 555100), 0);
  });
});

test.describe('deformationRatioX（αx, 式 3.2.7）', () => {
  test.it('Iy / (Ix + Iy) を返す', () => {
    assertClose(calc.deformationRatioX(657150, 1980250), 0.751, 1e-3, 'αx');
  });
});

test.describe('plasticUnitArrangementCoefficient（Zpxy, 式 3.2.6）', () => {
  test.it('計算例の値を再現する', () => {
    const nails = calc.buildRectangularGrid([0, 445, 890], [0, 145, 295, 445, 590]);
    const alphaX = calc.deformationRatioX(657150, 1980250);
    const zpxy = calc.plasticUnitArrangementCoefficient(nails, 445, 295, alphaX, 555100);
    assertClose(zpxy, 0.0045, 1e-4, 'Zpxy');
  });
});

test.describe('yieldUltimateRatio（Cxy, 式 3.2.5）', () => {
  test.it('Zpxy / Zxy を返す', () => {
    assertClose(calc.yieldUltimateRatio(0.0045, 0.0036), 1.25, 1e-9, 'Cxy');
  });
  test.it('比が 1.0 未満なら 1.0 に丸める', () => {
    assert.strictEqual(calc.yieldUltimateRatio(0.5, 1.0), 1.0);
  });
  test.it('Zxy = 0 は例外', () => {
    assert.throws(() => calc.yieldUltimateRatio(0.1, 0));
  });
});

test.describe('buildRectangularGrid（格子生成の補助関数）', () => {
  test.it('全組合せの釘を生成する', () => {
    const nails = calc.buildRectangularGrid([0, 445, 890], [0, 145, 295, 445, 590]);
    assert.strictEqual(nails.length, 15);
    assert.deepStrictEqual(nails[0], { x: 0, y: 0 });
    assert.deepStrictEqual(nails[nails.length - 1], { x: 890, y: 590 });
  });
});

// =====================================================================
// 3. 入力検証・エッジケース
// =====================================================================
test.describe('validateNailInput / computeNailArrayConstants の入力検証', () => {
  test.it('釘リストが空なら例外', () => {
    assert.throws(() => calc.computeNailArrayConstants([], 100));
  });
  test.it('面材面積が 0 以下なら例外', () => {
    assert.throws(() => calc.computeNailArrayConstants([{ x: 0, y: 0 }], 0));
    assert.throws(() => calc.computeNailArrayConstants([{ x: 0, y: 0 }], -5));
  });
  test.it('座標が数値でなければ例外', () => {
    assert.throws(() => calc.computeNailArrayConstants([{ x: 'a', y: 0 }], 100));
    assert.throws(() => calc.computeNailArrayConstants([{ x: 0, y: NaN }], 100));
  });
});
