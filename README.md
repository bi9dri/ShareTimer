# ShareTimer

複数端末で共有できるカウントダウンタイマー。ユーザ管理は行わない。セッションを作成した端末が「管理者」となり、他は「ユーザ」として閲覧のみを行う。

## 特徴

- セッション URL を共有するだけ。アカウント登録は不要。
- サーバ主導の状態を WebSocket で全端末へリアルタイム配信。ページリロード不要。
- 管理者は localStorage のトークンで認可され、タイマーを操作できる。
- タイムアウト時は全端末でアラームが 1 回鳴る。音量と停止は端末ローカル。
- 全端末が可能な限り厳密に同時に鳴ることを最優先（NTP 方式の時刻同期 + Web Audio）。
- セッションは最後の管理操作から 24 時間で自動削除される。

## 技術構成（予定）

- ホスティング: Cloudflare Workers + Durable Objects（1 セッション = 1 DO、SQLite storage）
- 同期: WebSocket（配信、Hibernation）+ REST（管理操作）
- フロント: 素の TypeScript。Cloudflare Pages から配信
- 非営利利用なら Cloudflare 無料枠で運用可能（[ADR 0005](docs/adr/0005-cloudflare-durable-objects-hosting.md)）

> 未実装。設計は [docs/design.md](docs/design.md) を参照。

## ドキュメント

- [docs/design.md](docs/design.md) — 全体設計
- [docs/protocol.md](docs/protocol.md) — REST / WebSocket のプロトコル仕様
- [docs/adr/](docs/adr/) — 意思決定の記録（ADR）

## 開発

```sh
npm install
npx wrangler dev
```
