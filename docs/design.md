# ShareTimer 設計

複数端末で 1 つのカウントダウンを共有する。中心にあるのは「離れた端末同士が同じ残り時間を見て、同じ瞬間にアラームを鳴らす」こと。個々の決定の理由は各 ADR を参照。

## 1. 目的とスコープ

### やること

- セッション作成と URL 共有
- 管理者によるタイマー操作（設定・一時停止・再開・延長・再設定・アラーム音変更）
- 全端末へのリアルタイム状態配信
- タイムアウト時の全端末アラーム
- 最後の管理操作から 24 時間でのセッション自動削除

### やらないこと（非目標）

- ユーザ登録・ログイン・権限管理
- アラーム音のアップロード（プリセットのみ）
- タイマーの履歴・統計
- 複数リージョンでの強整合レプリケーション（セッションは単一の Durable Object が所有する）

## 2. 用語

| 用語 | 意味 |
|---|---|
| セッション | 1 つの共有タイマー。ID と状態を持つ |
| 管理者 | セッション作成時に発行されたトークンを保持する端末 |
| ユーザ | トークンを持たない端末。閲覧のみ |
| セッション ID | URL に含まれる公開識別子（nanoid） |
| 管理者トークン | 管理操作の認可に使う秘密値。作成端末の localStorage に保存 |
| endsAt | タイマー終了予定の絶対時刻（epoch ms） |

## 3. 全体構成

```
 管理者端末                    Cloudflare                             ユーザ端末
 ┌─────────┐  POST /ops   ┌───────────────────────────┐  WebSocket  ┌─────────┐
 │  admin  │ ───────────▶ │ Worker（ルーティング）       │ ──────────▶ │ viewer  │
 │  token  │ ◀─── 200 ─── │      ↓ idFromName(id)     │  state 配信 │         │
 └────┬────┘              │ ┌───────────────────────┐ │             └────┬────┘
      │ WebSocket          │ │ Durable Object（1/セッション）          │ WebSocket
      └────────────────────│ │  状態=SQLite / WS=Hibernation          │
                           │ │  Alarms=期限・TTL                       │
                           │ └───────────────────────┘ │
                           └───────────────────────────┘
                  全端末が同じ `state` を受信して描画
```

- Worker がセッション ID を Durable Object にルーティングする（1 セッション = 1 DO）。DO が唯一の状態の源泉で、状態変化は接続中の全端末へ配信される。セッションごとに独立するため水平にスケールし、セッション間の調整は不要。
- 状態は DO の SQLite storage に永続化する。静的ファイルは Cloudflare Pages から配信する。詳細は [ADR 0005](adr/0005-cloudflare-durable-objects-hosting.md)。

## 4. データモデル

DO が保持するセッション。

| フィールド | 型 | 説明 |
|---|---|---|
| `id` | string | nanoid(21)。URL に含む公開値 |
| `adminTokenHash` | string | 管理者トークンの SHA-256。平文は保持しない |
| `status` | `idle` \| `running` \| `paused` \| `expired` | タイマー状態 |
| `durationMs` | number | 設定された長さ。最大 `MAX_DURATION` |
| `endsAt` | number \| null | `running` のときのみ。終了予定 epoch ms |
| `remainingMs` | number \| null | `paused` のときのみ。残り時間 |
| `alarmSound` | string | プリセット ID（同梱音源。§7） |
| `lastAdminOpAt` | number | 最後の管理操作時刻。TTL の起点 |
| `createdAt` | number | 作成時刻 |

`MAX_DURATION = 24h`、`SESSION_TTL = 24h`。詳細は §9。クライアントへ送る公開状態は `adminTokenHash` / `lastAdminOpAt` を除く（[protocol.md](protocol.md)）。

## 5. 状態遷移

```
        set                 pause                 resume
 idle ──────▶ running ⇄ paused   running ──────▶ running
                 │
                 │ now >= endsAt（または extend で延びる）
                 ▼
              expired ──set──▶ running   （再設定＝リピート）
```

| 操作 | 効果 |
|---|---|
| `set {durationMs, alarmSound?}` | `durationMs` を設定し `running` に。`endsAt = now + durationMs`。期限切れ後に呼べば再スタート（リピート） |
| `pause` | `remainingMs = max(0, endsAt - now)`、`endsAt = null`、`paused` |
| `resume` | `endsAt = now + remainingMs`、`running` |
| `extend {deltaMs}` | `running` のときのみ `endsAt += deltaMs`（`MAX_DURATION` を超えない範囲） |
| `setAlarmSound {alarmSound}` | アラーム音を変更する（次回の期限切れに適用） |

- `idle` は作成直後（未設定）の状態。最初の `set` で `running` になる。
- 期限切れは残り時間がゼロになった時点。§7 のとおり端末側がローカルに判定して鳴らす。

## 6. 同期方式（WebSocket + REST）

- **配信**: 各クライアントは `GET /api/sessions/:id/ws` に WebSocket で接続する。接続直後に現在の `state` を 1 回受け取り、以降は変化のたびに `state` を受け取る。
- **操作**: 管理操作は `POST /api/sessions/:id/ops` に送る。DO が状態を更新し、接続中の全端末へ新しい `state` を配信する。
- メッセージは常に**状態全体**を運ぶ増分なしの単純なプロトコル。詳細は [protocol.md](protocol.md)、採用理由と SSE からの移行は [ADR 0001](adr/0001-realtime-websocket-rest.md)。

### クロック同期

残り時間の表示と「全端末が同時に鳴る」精度は、サーバ時刻とのオフセット推定精度で決まる。単純な一方向補正ではなく **NTP 方式のラウンドトリップ推定**を使う。手順・目標精度は [ADR 0002](adr/0002-absolute-endsat-ntp-sync.md)。

### 再接続と死活監視

- 自動再接続（指数バックオフ + ジッタ）、`hello.retryMs` による間隔制御、全スナップショットによるレジュームは接続マネージャで実現する（[ADR 0001](adr/0001-realtime-websocket-rest.md)）。
- 死活監視はクライアントが定期送信する `ping` に、エッジが `setWebSocketAutoResponse` で `pong` を返す方式。DO を起こさない。無応答なら再接続する。
- WebSocket が張れない環境では `GET /api/sessions/:id` の定期ポーリングにフォールバックする（更新は遅れる）。

## 7. アラーム

- **全端末**が鳴らす。各端末が補正済み残り時間が 0 に達した時点で **1 回**再生し、停止もローカルで行う。サーバは再生・停止状態を管理しない（[ADR 0003](adr/0003-client-side-alarm.md)）。
- **同時性を最優先**し、NTP 同期と Web Audio のスケジューリングで再生する。出力遅延の補正は行わない（[ADR 0003](adr/0003-client-side-alarm.md) / [ADR 0007](adr/0007-no-output-latency-compensation.md)）。
- **音量**は各端末ローカルの設定（localStorage）。サーバへ送らない。
- 音源は**同梱の WAV**（`public/alarm/`）で、ID は `alarm` / `bell` / `piano` / `jingle`。起動時に全件を `decodeAudioData` して常備し、期限直前のダウンロード待ちをなくす（[ADR 0006](adr/0006-bundled-alarm-audio-files.md)）。
- 期限切れ後に接続した端末は、初回 `state` が `expired` でも鳴らさない。鳴らすのは `running` から期限切れへの遷移を見た端末だけ。

## 8. 管理者認可

- セッション作成時に推測困難なトークンを発行し（作成応答でのみ返す）、サーバはハッシュのみ保存する。作成端末は localStorage に保存し、管理操作は `Authorization: Bearer` で認可する。詳細とトレードオフは [ADR 0004](adr/0004-admin-token-localstorage.md)。
- セッション URL（nanoid(21)）は実質 capability で、知っていれば閲覧できる（仕様）。管理操作はトークン必須のため、URL 漏洩だけでは乗っ取れない。
- ハッシュ照合は定数時間比較で行う。
- レート制限・濫用対策は未定義（実装時に追加）。

## 9. ライフサイクルと TTL

- `lastAdminOpAt` はすべての管理操作で更新される。
- 期限切れと TTL 削除は DO Alarm で行う。DO は同時に 1 アラームしか持てないため、`next = min(endsAt, lastAdminOpAt + SESSION_TTL)` を都度 `setAlarm` する。hibernation 中でもアラームで起きるので信頼できる。
  1. `lastAdminOpAt` から `SESSION_TTL`（24h）を超えたセッションを削除し、接続中の端末へ `closed` を配信。
  2. `running` で `now >= endsAt` のセッションを `expired` に遷移させ、`state` を配信（期限切れ後に接続する端末の初期スナップショットを正しくするため）。
- hibernation からの復帰では constructor が alarm ハンドラより先に走る。既存アラームを壊さないよう、復元経路でも `getAlarm()` を確認してから設定する。
- `MAX_DURATION` は 24h。`set` 直後に終了と削除が同時刻に重ならないよう、`SESSION_TTL` との間に小さなマージンを持たせる。

## 10. 既知の制約と将来

| 制約 | 対応 |
|---|---|
| 無料枠超過で Free では操作が失敗（課金ではなくエラー） | 監視して Paid へ（[ADR 0005](adr/0005-cloudflare-durable-objects-hosting.md)） |
| 期限切れ後に接続した端末はアラームを逃す | 許容。必要なら「鳴りっぱなし」モードを追加（[ADR 0003](adr/0003-client-side-alarm.md)） |
| 同時鳴動の精度に下限がある（数十 ms） | 物理的な限界。キャリブレーションで低減（[ADR 0003](adr/0003-client-side-alarm.md)） |
| WS 不可の環境ではポーリングに落ち更新が遅れる | 許容（[ADR 0001](adr/0001-realtime-websocket-rest.md)） |
| 管理者トークンを失うと復旧不可 | トークン再発行は非目標（[ADR 0004](adr/0004-admin-token-localstorage.md)） |

## 11. 決定一覧

- [ADR 0001: WebSocket + REST を採用（SSE の恩恵は接続マネージャで再現）](adr/0001-realtime-websocket-rest.md)
- [ADR 0002: タイマー状態を絶対時刻 endsAt で表し、NTP 方式で同期する](adr/0002-absolute-endsat-ntp-sync.md)
- [ADR 0003: アラームは全端末がローカルに判定・再生・停止する](adr/0003-client-side-alarm.md)
- [ADR 0004: 管理者トークンを localStorage に保存する](adr/0004-admin-token-localstorage.md)
- [ADR 0005: Cloudflare Workers + Durable Objects で配信する](adr/0005-cloudflare-durable-objects-hosting.md)
- [ADR 0006: アラーム音源は合成ではなく同梱の音声ファイルにする](adr/0006-bundled-alarm-audio-files.md)
- [ADR 0007: アラームの出力遅延補正を廃止する](adr/0007-no-output-latency-compensation.md)
