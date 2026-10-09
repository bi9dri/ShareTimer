# ADR 0001: リアルタイム同期に WebSocket + REST を採用する

- 日付: 2026-10-10
- 状態: 承認済み

## 文脈

複数端末でタイマー状態を共有する。配信はサーバ→クライアントの一方向、操作はクライアント→サーバの一方向。双方向の対話（チャット等）は不要。

当初は SSE（`EventSource`）を採用していた。しかし配信基盤を Cloudflare Workers + Durable Objects に定めたことで前提が変わった（[ADR 0005](0005-cloudflare-durable-objects-hosting.md)）。**SSE には WebSocket のような Hibernation 相当の仕組みがなく、接続が開いている間ずっと Durable Object が起き続けて duration 課金が発生する。** 閲覧が長時間に及ぶ可能性がある以上、これは受け入れられない。

## 決定

- サーバ→クライアントの配信は **WebSocket**（DO の Hibernation API）。
- クライアント→サーバの管理操作は **REST**（`POST /ops`）。WS は配信専用と割り切り、双方向には使わない。
- SSE が無料で提供していた利便を、クライアント側の**接続マネージャ**で再現する:

| SSE が自動でやっていたこと | WS で再現するもの |
|---|---|
| 自動再接続 | `onclose` / `onerror` / `online` / `visibilitychange` をトリガに、指数バックオフ + ジッタで再接続 |
| `retry:` による間隔制御 | 接続直後の `hello` に `retryMs` を含め、バックオフの基準にする |
| `Last-Event-ID` によるレジューム | イベントは常に全状態スナップショット。再接続時にサーバが現在の `state` を即送るだけで等価 |
| `event:` 名前付きイベント | `{type, data}` エンベロープに統一（`state` / `time` / `hello` / `closed`） |
| 切断の検知 | クライアントが定期送信する `ping` にエッジが `setWebSocketAutoResponse` で `pong` を返す（DO を起こさない）。無応答なら再接続 |
| 素の HTTP で通る | WS が張れない環境向けに**ポーリング・フォールバック** |

## 影響

- 良い: Hibernation により、更新が無い間は DO が休止して duration 課金が止まる。長時間の閲覧でもコストが跳ねない。
- 良い: WebSocket の送信メッセージは無料。課金はほぼ接続・アラーム・受信メッセージのみ（[ADR 0005](0005-cloudflare-durable-objects-hosting.md) の試算）。
- 悪い: 自動再接続・retry・レジュームを自前で持つ必要がある（接続マネージャ）。
- 悪い: WS が張れないネットワークではポーリングに落ち、更新が遅れる。
- 悪い: WS は DevTools 以外でデバッグしづらい（`wscat` 等を使う）。
