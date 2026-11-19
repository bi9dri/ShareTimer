# ShareTimer - AI Instructions

ShareTimer はリアルタイム共有タイマーアプリケーションです（Cloudflare Workers + Vite / React + Playwright）。

## 開発・テストコマンド
- パッケージマネージャー: `pnpm`
- 型チェック: `pnpm typecheck`
- 単体テスト: `pnpm test`
- E2E テスト: `pnpm e2e`
- VRT (Visual Regression Testing): `pnpm vrt`
- 開発サーバー: `pnpm dev`

## 設計原則（不変の方針）
- アラームの出力遅延補正（`AudioContext.outputLatency` による前倒し、手動キャリブレーション、音響ループバック実測）は行わない。`outputLatency` は推定値で環境によっては大きく外れるため、期限ちょうどの時刻にスケジュールする。
- ユーザー管理（アカウント登録）は行わず、管理者の認可は `localStorage` のトークンのみで扱う。

## 開発ルール
- 依存関係のインストール・変更は必ず `pnpm` を使用すること。
- コード変更後は `pnpm typecheck` および `pnpm test` が通過することを確認すること。
- 音声の確認・検証には `earshot` スキルを活用すること。
- テスト作成・修復には `playwright-test-*` スキルを活用すること。
- Web標準のUI・CSS・アクセシビリティ実装には `modern-web-guidance` スキルを活用すること。