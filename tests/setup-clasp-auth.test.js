/**
 * clasp 認証情報 正規化（scripts/setup-clasp-auth.mjs）のユニットテスト
 * =====================================================================
 * CLASP_TOKEN がフラット/ネストのどちらの形式でも、clasp 2.5.x が読める
 * ネスト形式 { token, oauth2ClientSettings, isLocalCreds } へ変換されることを検証する。
 * （ESM モジュールを動的 import で読み込む。）
 * =====================================================================
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');

const load = () => import('../scripts/setup-clasp-auth.mjs');

test.describe('normalizeClaspToken（clasp 認証情報の正規化）', () => {
  test.it('フラット形式（旧グローバル）をネスト形式へ変換する', async () => {
    const { normalizeClaspToken } = await load();
    const rc = normalizeClaspToken(JSON.stringify({
      access_token: 'AT', refresh_token: 'RT', token_type: 'Bearer', expiry_date: 1
    }));
    assert.strictEqual(rc.token.access_token, 'AT');
    assert.strictEqual(rc.token.refresh_token, 'RT');
    assert.strictEqual(rc.isLocalCreds, false);
    assert.ok(rc.oauth2ClientSettings.clientId, 'グローバルクライアントが補完される');
  });

  test.it('ネスト形式（グローバル）は token / clientSettings を保持する', async () => {
    const { normalizeClaspToken } = await load();
    const rc = normalizeClaspToken(JSON.stringify({
      token: { access_token: 'AT', refresh_token: 'RT' },
      oauth2ClientSettings: { clientId: 'x', clientSecret: 'y', redirectUri: 'http://localhost' },
      isLocalCreds: false
    }));
    assert.strictEqual(rc.token.access_token, 'AT');
    assert.strictEqual(rc.oauth2ClientSettings.clientId, 'x');
    assert.strictEqual(rc.isLocalCreds, false);
  });

  test.it('ネスト形式（--creds ローカル）は isLocalCreds を保持する', async () => {
    const { normalizeClaspToken } = await load();
    const rc = normalizeClaspToken(JSON.stringify({
      token: { access_token: 'AT', refresh_token: 'RT' },
      oauth2ClientSettings: { clientId: 'cid', clientSecret: 'cs', redirectUri: 'http://localhost' },
      isLocalCreds: true
    }));
    assert.strictEqual(rc.isLocalCreds, true);
    assert.strictEqual(rc.oauth2ClientSettings.clientId, 'cid');
  });

  test.it('空・非 JSON・不明な形式は例外', async () => {
    const { normalizeClaspToken } = await load();
    assert.throws(() => normalizeClaspToken(''));
    assert.throws(() => normalizeClaspToken('   '));
    assert.throws(() => normalizeClaspToken('not json'));
    assert.throws(() => normalizeClaspToken('{}'));
  });
});
