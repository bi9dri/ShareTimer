# ShareTimer

複数人で共有できるカウントダウンタイマー。ユーザ管理は行わない。セッションを作成した端末が「管理者」となり、他は「ユーザ」として閲覧のみを行う。

## 特徴

- セッション URL を共有するだけ。アカウント登録は不要。
- サーバ主導の状態を WebSocket で全端末へリアルタイム配信。ページリロード不要。
- 管理者は localStorage のトークンで認可され、タイマーを操作できる。
- タイムアウト時は全端末でアラームが 1 回鳴る。音量と停止は端末ローカル。
- 全端末が可能な限り厳密に同時に鳴ることを最優先（NTP 方式の時刻同期 + Web Audio）。
- セッションは最後の管理操作から 24 時間で自動削除される。

## 技術構成

- ホスティング: Cloudflare Workers + Durable Objects（1 セッション = 1 DO、SQLite storage）
- 同期: WebSocket（配信、Hibernation）+ REST（管理操作）
- フロント: 素の TypeScript。ビルドは Vite+（Vite / Rolldown）、実行は Workers の静的アセットとして同一オリジン配信
- アラーム音源: 同梱の WAV を Web Audio でスケジュール再生する（[ADR 0006](docs/adr/0006-bundled-alarm-audio-files.md)）
- 非営利利用なら Cloudflare 無料枠で運用可能（[ADR 0005](docs/adr/0005-cloudflare-durable-objects-hosting.md)）

## ドキュメント

- [docs/design.md](docs/design.md) — 全体設計
- [docs/protocol.md](docs/protocol.md) — REST / WebSocket のプロトコル仕様
- [docs/adr/](docs/adr/) — 意思決定の記録（ADR）

## 開発

Node.js と pnpm は mise で管理する。

```sh
mise install
pnpm install

# クライアントをビルドしてローカルサーバを起動する
pnpm dev
# http://127.0.0.1:8787

# クライアントを再ビルドせずサーバだけ起動する（`pnpm build:client` 済みのとき）
pnpm preview

# favicon・アプリアイコン・OGP 画像を public/ に再生成する（logo.svg と wordmark.svg が元）
# 初回だけブラウザが要る: pnpm exec playwright install chromium
pnpm icons
```

## テスト

```sh
pnpm test       # vitest（Workers ランタイム内で Durable Object ごと実行）
pnpm test:watch # ウォッチモード
pnpm typecheck  # 型チェック（worker / client / tooling の 3 プロジェクト）
pnpm e2e        # Playwright（ビルドと wrangler dev の起動を自動で行う）
```

`pnpm e2e` は `tests/e2e/` を実行する。テスト計画は `specs/` に置く。

### E2E エージェント

Playwright 公式のテストエージェントを `.claude/agents/` に導入済み（`.mcp.json` の `playwright-test` MCP サーバ経由）。

- `playwright-test-planner` — テスト計画を `specs/` に書く
- `playwright-test-generator` — 計画から `tests/e2e/` のテストを生成する
- `playwright-test-healer` — 失敗したテストを修復する

## 構成

| パス | 内容 |
|---|---|
| `src/worker/` | Worker のルーターと Durable Object |
| `src/worker/domain/` | 状態遷移・バリデーション・トークンなどの純粋ロジック |
| `src/frontend/` | 素の TypeScript クライアント |
| `public/` | アラーム音源・favicon・OGP 画像・webmanifest |
| `scripts/` | アイコンと OGP 画像の生成（`pnpm icons`） |
| `tests/unit/` | 純粋ロジックのユニットテスト |
| `tests/worker/` | Durable Object の統合テスト |
| `tests/e2e/` | Playwright の E2E テスト |
