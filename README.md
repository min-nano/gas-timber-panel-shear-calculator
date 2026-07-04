# 面材張り耐力要素 釘配列諸定数 計算（グレー本 3.2）

グレー本『木造軸組工法住宅の許容応力度設計』の **3.2 面材張り耐力要素の詳細計算法で用いる釘配列諸定数の計算** に準拠し、
釘配列諸定数 **Ixy・Zxy・Cxy** を求める Google Apps Script（GAS）Web アプリです。

将来的には、この釘配列諸定数をもとに耐力壁・水平構面の**剛性と耐力**を求める詳細計算法（3.3〜3.6）へ拡張していきます。本リポジトリはその **MVP（釘配列諸定数の算定）** です。

---

## MVP でできること

- 面材寸法（→ 面材面積 Aw）と釘配列（格子または座標直接入力）を与えると、次を算定します。
  - `Ixy` … 単位面積あたりの釘配列二次モーメント（式 3.2.1）
  - `Zxy` … 単位面積あたりの釘配列係数（式 3.2.3）
  - `Cxy` … 釘配列降伏終局比（式 3.2.5）
- 途中経過（x₀, y₀, Ix, Iy, Zx, Zy, αx, Zpxy …）もすべて表示し、計算のブラックボックス化を防ぎます（白箱化）。
- 「グレー本の計算例を読み込む」ボタンで、解説（図 3.2.2）の計算例をワンクリックで再現できます。

---

## 計算根拠（グレー本 3.2）

| 記号 | 意味 | 式 |
|------|------|----|
| x₀, y₀ | 各方向の弾性中立軸位置 | 3.2.2 |
| Ix, Iy | 各方向の釘配列二次モーメント | 3.2.2a / 3.2.2b |
| Ixy | 単位面積あたりの釘配列二次モーメント | 3.2.1 |
| Zx, Zy | 各方向の釘配列係数 | 3.2.4a / 3.2.4b |
| Zxy | 単位面積あたりの釘配列係数 | 3.2.3 |
| αx | 全塑性状態の X 方向変形割合 | 3.2.7 |
| Zpxy | 単位面積あたりの塑性釘配列係数 | 3.2.6 |
| Cxy | 釘配列降伏終局比（< 1.0 のときは 1.0） | 3.2.5 |

計算上の仮定：面材・軸材は剛体、軸材どうしはピン接合、釘のせん断変形は中立軸に対して平面保持仮定が成立。適用にあたっては 3.3〜3.6 各節の適用範囲を満たす必要があります。

### 解説の計算例（検証用）

図 3.2.2（X ∈ {0, 445, 890}, Y ∈ {0, 145, 295, 445, 590} の 15 本格子、面材 610 × 910 = 555100 mm²）で、
本実装の出力がグレー本の記載値と一致することをユニットテストで確認しています。

| 量 | グレー本 | 本実装 |
|----|---------|--------|
| x₀, y₀ | 445, 295 mm | 445, 295 mm |
| Ix, Iy | 657150, 1980250 mm² | 一致 |
| Ixy | 0.889 mm²/mm² | 0.889 |
| Zx, Zy | 2228, 4450 mm | 一致 |
| Zxy | 0.0036 mm/mm² | 0.0036 |
| αx | 0.751 | 0.751 |
| Zpxy | 0.0045 mm/mm² | 0.0045 |
| Cxy | 1.25（丸め後） | 約 1.26（丸め前） |

---

## フォルダ構成

```
.
├── src/                       # clasp のターゲット（rootDir = src）
│   ├── appsscript.json        # マニフェスト（Web アプリ設定）
│   ├── NailArrayConstants.js  # 計算本体（唯一の計算実装）
│   ├── WebApp.js              # doGet / 計算 API（サーバサイド）
│   └── index.html             # SPA（Vue3 + Tailwind, CDN 読込）
├── tests/                     # ユニットテスト（src とは別フォルダ）
│   └── NailArrayConstants.test.js
├── .github/workflows/ci.yml   # テスト & GAS デプロイ
├── .clasp.json.example        # .clasp.json のひな形
└── package.json
```

**設計方針：計算の唯一の実装（single source of truth）**
`src/NailArrayConstants.js` は、GAS サーバサイドと Node.js のユニットテストの両方から読み込まれます
（ファイル末尾の環境ガードにより、GAS ではグローバル関数、Node では `module.exports` として動作）。
Web UI は `google.script.run` 経由でこの実装を呼び出すため、**画面に表示される数値は必ずテスト済みのロジックと一致**します。

---

## 実行方法

### ユニットテスト（ローカル、依存パッケージ不要）

```bash
npm test          # = node --test tests/*.test.js
```

### GAS へのデプロイ

デプロイは GitHub Actions（`.github/workflows/ci.yml`）で自動化しています。
`main` への push で、テスト成功後に `clasp push` → `clasp deploy` が実行されます。以下のシークレットを使用します。

| シークレット | 内容 |
|-------------|------|
| `CLASP_TOKEN` | `clasp login` で得られる `~/.clasprc.json` の内容（JSON） |
| `GAS_SCRIPT_ID` | Apps Script のスクリプト ID |
| `GAS_DEPLOYMENT_ID` | 更新対象のデプロイ ID |

> `CLASP_TOKEN` は、フラット形式（`{access_token, refresh_token, ...}`）でもネスト形式
> （`{token, oauth2ClientSettings, isLocalCreds}`）でも構いません。CI 内の
> `scripts/setup-clasp-auth.mjs` が clasp 2.5.x の要求する形式へ自動変換します。

ローカルから手動デプロイする場合：

```bash
cp .clasp.json.example .clasp.json   # scriptId を記入（rootDir は src のまま）
npx clasp push -f
npx clasp deploy -i "<GAS_DEPLOYMENT_ID>" -d "manual deploy"
```

> `.clasp.json` と `~/.clasprc.json` は認証情報・スクリプト ID を含むため `.gitignore` 済みです。

### Web アプリの実行権限

`src/appsscript.json` で **アクセスしているユーザーとして実行**（`executeAs: USER_ACCESSING`）に設定しています。
各ユーザーは自身の権限で計算を実行するため、他人が勝手にスプレッドシートを作成することはありません。
（社内ドメインに限定したい場合は `access` を `DOMAIN` に変更してください。）

---

## ロードマップ

- [x] **MVP**: 釘配列諸定数 Ixy・Zxy・Cxy の算定 ＋ 解説計算例のテスト
- [ ] 面材・釘・枠材のマスタ（スプレッドシート）とプルダウン選択
- [ ] Web アプリ起動時に保存先スプレッドシートを指定 → リアルタイム保存（履歴管理）
- [ ] 耐力壁・水平構面の剛性・耐力の詳細計算（グレー本 3.3〜3.6）
- [ ] Print CSS（`@media print` / A4）による計算書 PDF 出力
