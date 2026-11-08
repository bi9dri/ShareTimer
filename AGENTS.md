# ShareTimer - AI Instructions

ShareTimer はリアルタイム共有タイマーアプリケーションです（Cloudflare Workers + Vite / React + Playwright）。

## 開発・テストコマンド
- パッケージマネージャー: `pnpm`
- 型チェック: `pnpm typecheck`
- 単体テスト: `pnpm test`
- E2E テスト: `pnpm e2e`
- VRT (Visual Regression Testing): `pnpm vrt`
- 開発サーバー: `pnpm dev`

## 開発ルール
- 依存関係のインストール・変更は必ず `pnpm` を使用すること。
- コード変更後は `pnpm typecheck` および `pnpm test` が通過することを確認すること。
- 音声の確認・検証には `earshot` スキルを活用すること。
- テスト作成・修復には `playwright-test-*` スキルを活用すること。