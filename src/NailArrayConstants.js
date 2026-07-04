/**
 * 釘配列諸定数（Ixy, Zxy, Cxy）の計算ライブラリ
 * =====================================================================
 * グレー本『木造軸組工法住宅の許容応力度設計』
 *   3.2 面材張り耐力要素の詳細計算法で用いる釘配列諸定数の計算
 *   （式 3.2.1〜3.2.7）に準拠。
 *
 * 計算上の仮定:
 *   - 面材・軸材は剛体、軸材どうしはピン接合。
 *   - 釘のせん断変形は中立軸に対して平面保持仮定が成立する。
 *
 * このファイルは「唯一の計算実装」であり、
 *   - Google Apps Script（サーバサイド）
 *   - Node.js（tests/ 以下のユニットテスト）
 * の双方から利用される。GAS ではグローバル関数として、Node では
 * module.exports 経由で読み込まれる（末尾のガードを参照）。
 * =====================================================================
 */

/**
 * 弾性中立軸位置を求める。
 * y0 = Σ(yj・nj) / Σnj 、 x0 = Σ(xi・ni) / Σni （式 3.2.2a / 3.2.2b の中立軸）。
 * 釘リストを「1要素=釘1本」で表現するため、各座標の重み nj は座標の重複本数として
 * 自然に折り込まれ、単純な相加平均となる。
 *
 * @param {number[]} coords 釘座標（x もしくは y）の配列 [mm]（釘1本につき1要素）
 * @return {number} 弾性中立軸位置 [mm]
 */
function neutralAxisPosition(coords) {
  if (!Array.isArray(coords) || coords.length === 0) {
    throw new Error('neutralAxisPosition: 座標配列が空です。');
  }
  let total = 0;
  for (let k = 0; k < coords.length; k++) {
    total += coords[k];
  }
  return total / coords.length;
}

/**
 * 釘配列二次モーメントを求める。
 *   Ix = Σ(yj - y0)^2・nj  （式 3.2.2a）
 *   Iy = Σ(xi - x0)^2・ni  （式 3.2.2b）
 *
 * @param {number[]} coords 釘座標の配列 [mm]（釘1本につき1要素）
 * @param {number} axis 弾性中立軸位置 [mm]
 * @return {number} 釘配列二次モーメント [mm^2]
 */
function secondMomentOfNailArray(coords, axis) {
  let moment = 0;
  for (let k = 0; k < coords.length; k++) {
    const d = coords[k] - axis;
    moment += d * d;
  }
  return moment;
}

/**
 * 中立軸から端部の釘までの距離の最大値を求める。
 *   (yj - y0)max 、 (xi - x0)max
 *
 * @param {number[]} coords 釘座標の配列 [mm]
 * @param {number} axis 弾性中立軸位置 [mm]
 * @return {number} 中立軸からの距離の最大値 [mm]
 */
function maxDistanceFromAxis(coords, axis) {
  let maxDist = 0;
  for (let k = 0; k < coords.length; k++) {
    const d = Math.abs(coords[k] - axis);
    if (d > maxDist) {
      maxDist = d;
    }
  }
  return maxDist;
}

/**
 * 単位面積あたりの釘配列二次モーメント Ixy を求める（式 3.2.1）。
 *   Ixy = ( Ix・Iy / (Ix + Iy) ) / Aw   [mm^2/mm^2]
 *
 * @param {number} ix Ix [mm^2]
 * @param {number} iy Iy [mm^2]
 * @param {number} panelArea 面材の面積 Aw [mm^2]
 * @return {number} Ixy [mm^2/mm^2]
 */
function unitSecondMoment(ix, iy, panelArea) {
  const denom = ix + iy;
  if (denom === 0) {
    throw new Error('unitSecondMoment: Ix + Iy が 0 です（釘が1点に集中しています）。');
  }
  return (ix * iy / denom) / panelArea;
}

/**
 * 各方向の弾性中立軸に対する釘配列係数を求める（式 3.2.4a / 3.2.4b）。
 *   Zx = Ix / (yj - y0)max
 *   Zy = Iy / (xi - x0)max
 * 端部距離が 0（当該方向に配列の広がりが無い）の場合は 0 を返す。
 *
 * @param {number} secondMoment 当該方向の釘配列二次モーメント [mm^2]
 * @param {number} maxDist 中立軸から端部の釘までの距離の最大値 [mm]
 * @return {number} 釘配列係数 [mm]
 */
function arrangementCoefficient(secondMoment, maxDist) {
  if (maxDist === 0) {
    return 0;
  }
  return secondMoment / maxDist;
}

/**
 * 単位面積あたりの釘配列係数 Zxy を求める（式 3.2.3）。
 *   Zxy = 1 / ( Aw・√(1/Zx^2 + 1/Zy^2) )   [mm/mm^2]
 *
 * @param {number} zx Zx [mm]
 * @param {number} zy Zy [mm]
 * @param {number} panelArea 面材の面積 Aw [mm^2]
 * @return {number} Zxy [mm/mm^2]
 */
function unitArrangementCoefficient(zx, zy, panelArea) {
  // Zx もしくは Zy が 0 の場合、1/Z^2 は Infinity となり、
  // IEEE 754 の規約に従って Zxy は 0 に収束する（例外は生じない）。
  const invSq = (zx === 0 ? Infinity : 1 / (zx * zx)) +
                (zy === 0 ? Infinity : 1 / (zy * zy));
  const root = Math.sqrt(invSq);
  if (root === 0 || !isFinite(root)) {
    return 0;
  }
  return 1 / (panelArea * root);
}

/**
 * 全塑性状態の全体変形に対する X 方向の変形割合 αx を求める（式 3.2.7）。
 *   αx = Iy / (Ix + Iy)
 *
 * @param {number} ix Ix [mm^2]
 * @param {number} iy Iy [mm^2]
 * @return {number} αx（無次元）
 */
function deformationRatioX(ix, iy) {
  const denom = ix + iy;
  if (denom === 0) {
    throw new Error('deformationRatioX: Ix + Iy が 0 です（釘が1点に集中しています）。');
  }
  return iy / denom;
}

/**
 * 単位面積あたりの塑性釘配列係数 Zpxy を求める（式 3.2.6）。
 *   Zpxy = Σ√( {(yj - y0)・αx}^2 + {(xi - x0)・(1 - αx)}^2 ) / Aw   [mm/mm^2]
 *
 * @param {{x:number,y:number}[]} nails 釘座標のリスト（釘1本につき1要素）[mm]
 * @param {number} x0 X方向弾性中立軸位置 [mm]
 * @param {number} y0 Y方向弾性中立軸位置 [mm]
 * @param {number} alphaX αx（式 3.2.7）
 * @param {number} panelArea 面材の面積 Aw [mm^2]
 * @return {number} Zpxy [mm/mm^2]
 */
function plasticUnitArrangementCoefficient(nails, x0, y0, alphaX, panelArea) {
  let sum = 0;
  for (let k = 0; k < nails.length; k++) {
    const dy = (nails[k].y - y0) * alphaX;
    const dx = (nails[k].x - x0) * (1 - alphaX);
    sum += Math.sqrt(dy * dy + dx * dx);
  }
  return sum / panelArea;
}

/**
 * 釘配列降伏終局比 Cxy を求める（式 3.2.5）。
 *   Cxy = Zpxy / Zxy 、ただし Cxy < 1.0 の場合は Cxy = 1.0 とする。
 *
 * @param {number} zpxy Zpxy [mm/mm^2]
 * @param {number} zxy Zxy [mm/mm^2]
 * @return {number} Cxy（無次元、1.0 以上）
 */
function yieldUltimateRatio(zpxy, zxy) {
  if (zxy === 0) {
    throw new Error('yieldUltimateRatio: Zxy が 0 です。');
  }
  const ratio = zpxy / zxy;
  return ratio < 1.0 ? 1.0 : ratio;
}

/**
 * 入力（釘リストと面材面積）を検証する。
 *
 * @param {{x:number,y:number}[]} nails 釘座標のリスト
 * @param {number} panelArea 面材の面積 Aw [mm^2]
 */
function validateNailInput(nails, panelArea) {
  if (!Array.isArray(nails) || nails.length === 0) {
    throw new Error('釘座標のリストが空です。少なくとも1本の釘が必要です。');
  }
  for (let k = 0; k < nails.length; k++) {
    const nail = nails[k];
    if (!nail || typeof nail.x !== 'number' || typeof nail.y !== 'number' ||
        !isFinite(nail.x) || !isFinite(nail.y)) {
      throw new Error('釘座標 #' + (k + 1) + ' の x, y は有限の数値である必要があります。');
    }
  }
  if (typeof panelArea !== 'number' || !isFinite(panelArea) || panelArea <= 0) {
    throw new Error('面材の面積 Aw は正の数値である必要があります。');
  }
}

/**
 * 釘配列諸定数（Ixy, Zxy, Cxy）を一括で計算する。
 * グレー本 3.2 の計算手順 1)〜9) に対応する。
 *
 * @param {{x:number,y:number}[]} nails 釘座標のリスト（釘1本につき1要素）[mm]
 * @param {number} panelArea 面材の面積 Aw [mm^2]
 * @return {{
 *   n:number, panelArea:number,
 *   x0:number, y0:number,
 *   Ix:number, Iy:number, Ixy:number,
 *   dxMax:number, dyMax:number,
 *   Zx:number, Zy:number, Zxy:number,
 *   alphaX:number, Zpxy:number, Cxy:number
 * }} 釘配列諸定数
 */
function computeNailArrayConstants(nails, panelArea) {
  validateNailInput(nails, panelArea);

  const xs = nails.map(function (nail) { return nail.x; });
  const ys = nails.map(function (nail) { return nail.y; });

  // 2) 各方向の弾性中立軸位置 x0, y0
  const x0 = neutralAxisPosition(xs);
  const y0 = neutralAxisPosition(ys);

  // 3) 各方向の釘配列二次モーメント Ix, Iy
  const ix = secondMomentOfNailArray(ys, y0); // Y方向中立軸まわり（X軸まわり）
  const iy = secondMomentOfNailArray(xs, x0); // X方向中立軸まわり（Y軸まわり）

  // 4) 単位面積あたりの釘配列二次モーメント Ixy
  const ixy = unitSecondMoment(ix, iy, panelArea);

  // 5) 各方向の釘配列係数 Zx, Zy
  const dyMax = maxDistanceFromAxis(ys, y0);
  const dxMax = maxDistanceFromAxis(xs, x0);
  const zx = arrangementCoefficient(ix, dyMax);
  const zy = arrangementCoefficient(iy, dxMax);

  // 6) 単位面積あたりの釘配列係数 Zxy
  const zxy = unitArrangementCoefficient(zx, zy, panelArea);

  // 7) αx
  const alphaX = deformationRatioX(ix, iy);

  // 8) 単位面積あたりの塑性釘配列係数 Zpxy
  const zpxy = plasticUnitArrangementCoefficient(nails, x0, y0, alphaX, panelArea);

  // 9) 釘配列降伏終局比 Cxy
  const cxy = yieldUltimateRatio(zpxy, zxy);

  return {
    n: nails.length,
    panelArea: panelArea,
    x0: x0,
    y0: y0,
    Ix: ix,
    Iy: iy,
    Ixy: ixy,
    dxMax: dxMax,
    dyMax: dyMax,
    Zx: zx,
    Zy: zy,
    Zxy: zxy,
    alphaX: alphaX,
    Zpxy: zpxy,
    Cxy: cxy
  };
}

/**
 * 矩形格子状の釘配列を生成する補助関数。
 * xs の各値と ys の各値の全組合せに釘を1本ずつ配置する。
 *
 * @param {number[]} xs X座標のリスト [mm]
 * @param {number[]} ys Y座標のリスト [mm]
 * @return {{x:number,y:number}[]} 釘座標のリスト
 */
function buildRectangularGrid(xs, ys) {
  const nails = [];
  for (let i = 0; i < xs.length; i++) {
    for (let j = 0; j < ys.length; j++) {
      nails.push({ x: xs[i], y: ys[j] });
    }
  }
  return nails;
}

// ---------------------------------------------------------------------
// 環境ガード:
//   - Node.js（テスト実行時）では module.exports へ関数群を公開する。
//   - Google Apps Script では module が未定義のため、この分岐は無視され、
//     各関数はグローバル関数としてそのまま利用可能となる。
// ---------------------------------------------------------------------
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    neutralAxisPosition: neutralAxisPosition,
    secondMomentOfNailArray: secondMomentOfNailArray,
    maxDistanceFromAxis: maxDistanceFromAxis,
    unitSecondMoment: unitSecondMoment,
    arrangementCoefficient: arrangementCoefficient,
    unitArrangementCoefficient: unitArrangementCoefficient,
    deformationRatioX: deformationRatioX,
    plasticUnitArrangementCoefficient: plasticUnitArrangementCoefficient,
    yieldUltimateRatio: yieldUltimateRatio,
    validateNailInput: validateNailInput,
    computeNailArrayConstants: computeNailArrayConstants,
    buildRectangularGrid: buildRectangularGrid
  };
}
