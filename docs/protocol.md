# プロトコル仕様

同期は WebSocket（サーバ→クライアント配信）+ REST（クライアント→サーバ操作）。メッセージは常に状態全体を運ぶ。

## REST

### `POST /api/sessions` — セッション作成

リクエスト: 空ボディ。

レスポンス `201`:

```json
{
  "id": "V1StGXR8_Z5jdHi6B-myT",
  "adminToken": "9f2c...base64url..."
}
```

`adminToken` はこの応答でのみ返る。クライアントは `localStorage["sharetimer:" + id] = adminToken` として保存する。

### `GET /api/time?t0=<epochMs>` — 時刻同期

クロックオフセット推定（NTP 方式）用。`t0` はクライアントの送信時刻（クエリ）。

レスポンス `200`:

```json
{ "serverTime": 1700000005000, "t0": 1700000004998 }
```

クライアントは応答受信時刻 `t1` を記録し、`offset = serverTime - (t0 + t1) / 2`、`rtt = t1 - t0` を求める。数回計測して最小 RTT のサンプルを採用する（[ADR 0002](adr/0002-absolute-endsat-ntp-sync.md)）。

### `GET /api/sessions/:id` — スナップショット

レスポンス `200`:

```json
{ "state": { "...": "..." } }
```

存在しない / 削除済みは `404`。

### `GET /api/sessions/:id/ws` — WebSocket ストリーム

- `Upgrade: websocket`。Worker が `idFromName(:id)` で対象 Durable Object にルーティングし、DO が `ctx.acceptWebSocket()` で受け入れる。
- 接続直後に `hello`、続けて現在の `state` を送る。以降は状態変化ごとに `state` を送る。
- セッション削除時は `closed` を送って接続を閉じる。
- 死活監視: DO は受入時に `ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"))` を設定する。クライアントの `ping` にエッジが `pong` を返し、**DO を起こさない**。
- 配信は `ctx.getWebSockets()` を回して `send()` する。hibernation からの復帰後もこの API で接続を列挙できる。
- クライアントからのアプリメッセージは `ping` 以外は受け付けない（配信専用）。

### `POST /api/sessions/:id/ops` — 管理操作

ヘッダ: `Authorization: Bearer <adminToken>`

リクエストボディ（`type` で分岐）:

| type | ボディ | 前提 |
|---|---|---|
| `set` | `{ "durationMs": 60000, "alarmSound": "beep" }` | `alarmSound` 省略可 |
| `pause` | `{}` | `status === "running"` |
| `resume` | `{}` | `status === "paused"` |
| `extend` | `{ "deltaMs": 60000 }` | `status === "running"` |
| `setAlarmSound` | `{ "alarmSound": "chime" }` | 一覧にある ID |

レスポンス:

- `200` 更新後の `{ "state": { ... } }`
- `401` トークン不正 / 欠落
- `404` セッションなし
- `409` 前提条件を満たさない（例: `paused` でないのに `resume`）
- `422` バリデーション違反

成功時、DO は接続中の全端末へ新しい `state` を配信する。トークンのハッシュ照合は定数時間比較（`crypto.subtle.timingSafeEqual`）で行う。

## 公開状態オブジェクト

```json
{
  "id": "V1StGXR8_Z5jdHi6B-myT",
  "status": "running",
  "durationMs": 60000,
  "endsAt": 1700000060000,
  "remainingMs": null,
  "alarmSound": "beep",
  "createdAt": 1700000000000,
  "serverTime": 1700000005000
}
```

- `endsAt` は `status === "running"` のときのみ非 null。
- `remainingMs` は `status === "paused"` のときのみ非 null。
- `serverTime` はこの状態を生成したサーバ時刻。クライアントのオフセット補正に使う。
- `adminTokenHash` / `lastAdminOpAt` はクライアントへ送らない。

## WebSocket メッセージ

サーバ → クライアント（JSON）:

```json
{"type":"hello", "data":{"retryMs":1000}}
{"type":"state", "data":{"id":"...","status":"running","durationMs":60000,"endsAt":1700000060000,"remainingMs":null,"alarmSound":"beep","createdAt":1700000000000,"serverTime":1700000005000}}
{"type":"time",  "data":{"serverTime":1700000010000}}
{"type":"closed","data":{}}
```

クライアント → サーバ:

- リテラル `ping` のみ。サーバ（エッジ）が `pong` を自動応答する。クライアントは `pong` が応答待ち窓（例: 30〜60 秒）内に来なければ切断とみなして再接続する。

- `hello.retryMs` は再接続バックオフの基準（SSE の `retry:` 相当）。
- レジューム: イベントは全状態スナップショットなので、再接続時にサーバが現在の `state` を即送るだけで等価（`Last-Event-ID` 相当は不要）。
- 再接続のトリガ・バックオフ・フォールバックは [ADR 0001](adr/0001-realtime-websocket-rest.md) / [design.md §6](design.md) を参照。

### クライアントの残り時間計算

```js
// offset は GET /api/time の NTP 方式推定値を正とする
remaining = endsAt - (Date.now() + offset);
```

### クライアントのアラーム判定と再生

- 前回 `running` だった状態から期限が到来した（補正済み `remaining <= 0`）ときに、そのタイマー世代で未再生ならアラームを 1 回鳴らす。
- 再生は Web Audio で**スケジュール**する。期限直前に再同期し、出力遅延を補正する（[ADR 0003](adr/0003-client-side-alarm.md)）。

```js
// outputLatencyMs は AudioContext.outputLatency / 手動キャリブレーション値
const delaySec = Math.max(0, (endsAt - (Date.now() + offset)) - outputLatencyMs) / 1000;
src.start(ctx.currentTime + delaySec);
```

- `endsAt` が変わったら世代リセット（次はまた鳴らせる）。
- 音量は端末ローカルの設定で、サーバとはやり取りしない。

## バリデーションとエラー

- `durationMs`: `1 <= durationMs <= MAX_DURATION`（24h、実運用はマージン込み）
- `deltaMs`: 正の整数。適用後 `endsAt - now <= MAX_DURATION`
- `alarmSound`: プリセット一覧のいずれか
- `id`: nanoid の書式に一致
- 不正な JSON ボディ: `400`。バリデーション違反: `422`。認可失敗: `401`。前提不一致: `409`。存在しない: `404`。レート制限: `429`（適用位置は実装時に定義）。
- リクエストボディのサイズ上限を設ける（例: 8 KB）。

## プリセット音源

`beep` / `chime` / `bell` などの ID と実ファイルは実装時に確定し、フロントの静的アセットとして同梱する。
