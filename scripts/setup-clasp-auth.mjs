#!/usr/bin/env node
/**
 * CI 用: CLASP_TOKEN シークレットを clasp 2.5.x が期待する
 * ~/.clasprc.json の形式に正規化して書き出す。
 * =====================================================================
 * clasp 2.5.0 は認証情報を { token, oauth2ClientSettings, isLocalCreds }
 * のネスト形式で読み込み、rc.token を OAuth クライアントへ渡す。
 * 一方、古い clasp のグローバル形式は
 *   { access_token, refresh_token, scope, token_type, expiry_date }
 * のフラット形式であり、これをそのまま ~/.clasprc.json に書くと
 *   「Cannot read properties of undefined (reading 'access_token')」
 * で失敗する（rc.token が undefined になるため）。
 *
 * 本スクリプトは、CLASP_TOKEN がフラット/ネストのどちらであっても、
 * clasp 2.5.x が読める形式へ変換して書き出す。
 * トークンの中身はログに出力しない。
 * =====================================================================
 */
import { writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// clasp が組み込みで用いるグローバル OAuth クライアント（公開値）。
const GLOBAL_CLIENT = {
  clientId: '1072944905499-vm2v2i5dvn0a0d2o4ca36i1vge8cvbn0.apps.googleusercontent.com',
  clientSecret: 'v6V3fKV_zWU7iw1DrpO1rknX',
  redirectUri: 'http://localhost'
};

/**
 * CLASP_TOKEN 文字列を clasp の rc オブジェクトに正規化する。
 * @param {string} raw CLASP_TOKEN の中身（JSON 文字列）
 * @return {{token:object, oauth2ClientSettings:object, isLocalCreds:boolean}}
 */
export function normalizeClaspToken(raw) {
  if (!raw || !String(raw).trim()) {
    throw new Error('CLASP_TOKEN が空です。');
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error('CLASP_TOKEN が JSON として解析できません: ' + e.message);
  }

  if (parsed && typeof parsed.token === 'object' && parsed.token) {
    // 既にネスト形式（clasp 2.4+ / `clasp login --creds`）。既定を補完して利用。
    return {
      token: parsed.token,
      oauth2ClientSettings: parsed.oauth2ClientSettings || GLOBAL_CLIENT,
      isLocalCreds: typeof parsed.isLocalCreds === 'boolean' ? parsed.isLocalCreds : false
    };
  }
  if (parsed && parsed.access_token) {
    // フラットなグローバル形式 → ネスト形式へ変換。
    return {
      token: parsed,
      oauth2ClientSettings: GLOBAL_CLIENT,
      isLocalCreds: false
    };
  }
  throw new Error('CLASP_TOKEN の形式を認識できません（token.access_token も access_token も見つかりません）。');
}

// スクリプトとして直接実行された場合のみ書き出す（テスト時の import では実行しない）。
if (import.meta.url === `file://${process.argv[1]}`) {
  const rc = normalizeClaspToken(process.env.CLASP_TOKEN);
  if (!rc.token.refresh_token) {
    console.warn('警告: refresh_token が見つかりません。access_token 期限切れ後に更新できません。');
  }
  const dest = join(homedir(), '.clasprc.json');
  writeFileSync(dest, JSON.stringify(rc));
  console.log('clasp 認証情報を書き出しました: ' + dest + '（isLocalCreds=' + rc.isLocalCreds + '）');
}
