# Linux移植：upstream v1.13.2 へ載せ替えたときの記録

英語版（正）: [linux-upstream-sync-notes.md](linux-upstream-sync-notes.md)

2026年11月、Linux移植を旧fork（`tosihide/amical`、2026-04-01時点のupstreamが基点）から、upstream v1.13.2 を新しくforkしたリポジトリ（`tsdhgm/amical` の `develop_ubuntu` ブランチ）へ移しました。その間にupstreamは458コミット進んでいました。何が壊れ、なぜ壊れ、次にupstreamをマージするとき何を確認すべきかを残します。

## 要約

当初の見立ては「移植は専用ブランチにあるので、ほぼそのまま持って来られる」でした。これは移植で**追加した**ファイル（ネイティブヘルパー、資料、パッケージ設定）については当たっていました。外れたのは、**upstreamのファイルに差し込んでいた**Linux用の分岐です。upstreamがそれらのファイルの大半を書き直していたため、差し込みは作り直しになり、さらにLinuxを想定していない新しいupstreamコードも増えていました。

動作確認で見つかった問題の大半はupstreamの変更が原因で、1件は単純な移植漏れ、2件はLinuxヘルパーにもともとあった弱点（旧ビルドではたまたま表に出なかったもの）でした。

## upstreamの変更が原因だった問題

| 症状 | 原因 | 対処 |
| --- | --- | --- |
| 起動時に `systemPreferences.getMediaAccessStatus is not a function` で失敗 | upstreamの新しいオンボーディングのコードが、macOS/Windows専用の権限APIを呼んでいた | Linuxでは呼ばないようにした（`onboarding-service.ts`、`trpc/routers/onboarding.ts`） |
| 録音中のウィジェットがDockの上に出ない | Electronが38から44になり、Waylandに直結して動くのが既定になった。Waylandではアプリが自分のウィンドウ位置や最前面表示を決められず、作業領域もDockを除外しない | XWayland経由で動かす（`--ozone-platform=x11`）。パッケージ版は自動でこの引数を付けて再起動する（`main/main.ts`）。`pnpm start` では引数で指定する |
| 音声認識の結果が空になる | upstreamがマイク取り込みの `autoGainControl` を無効にした。入力音量が小さいと音声検出に引っかからない | コードは変更していない。マイクの入力音量を上げる |
| サインイン画面が空で、枠だけ振動する | OAuthのエンドポイントの既定値がコードから無くなり、`apps/desktop/.env` が無いとすべて空になる | `.env` を作る（後述）。設定が無いときはウィンドウを作る前に失敗するようにした |
| クラウド音声認識が `NETWORK_ERROR` で失敗 | `API_ENDPOINT` も既定値が無くなり、以前のホストは廃止されていた | `API_ENDPOINT=https://dictation.amical.ai` を設定する |
| 認証、サービス起動、録音まわりでマージ衝突 | `AuthService` がEffectベースになり、`ServiceManager` はサービスグラフを組む方式に変わり、`recording-manager.ts` は `main/lifecycle/` に置き換わった | Linux用の認証ウィンドウを `auth-service.ts` に作り直し、貼り付け処理を `main/lifecycle/live.ts` に移し、`main/runtime/layers.ts` でLinuxのネイティブブリッジを有効にした |
| ヘルパーとの通信仕様のずれ | `setShortcuts` が `subsetChords` / `exactChords` を受け取る形になり、新しいRPCメソッドも増えた | ヘルパーを新形式に合わせ、実装できないメソッドには「何も起きなかった」という結果を返すようにした（`handlers/unsupported.ts`） |
| Linuxでショートカットの既定値とキー表示がおかしい | ショートカットがキーの組の配列になり、`draftMode` が追加され、キー表示の処理はmacOSとWindowsしか知らなかった | `db/app-settings.ts` のLinux既定値を更新し、`utils/keycode-map.ts` にLinuxの分岐を追加した |
| Linux上で実行したときだけテストが落ちる | Linux用の分岐が入ったことで、「実行環境はLinuxではない」という前提が崩れた | テスト側で、差し替え可能な `utils/platform` の関数を通してプラットフォームを固定した |

## 移植漏れ

**貼り付けが何も起きない。** 配布していた `.deb`（v1.1.0-linux.8）は、`develop_ubuntu` より7コミット進んだ `ubuntu-26.04-lts` から作られていました。最初は `develop_ubuntu` だけをマージしたため、ydotool 1.x向けの修正が抜けていました。ydotool 1.0.4 は `shift+Insert` を待ち時間として扱って正常終了するので、キーは送られないのに呼び出しは「成功」になります。`ubuntu-26.04-lts` をマージして解決しました。

教訓：移植の前に、旧リポジトリの全ブランチを取り込み元と比べ（`git log --oneline A..B`）、配布したビルドがどのブランチから作られたかを確認すること。

## Linuxヘルパーにもともとあった弱点

- **開始音が聞こえない。** ヘルパーは音の再生を始めた直後にシステム出力をミュートしていて、音が出る前に消されていました。開始音が鳴り終わってからミュートするようにしました。
- **システム出力がミュートのまま残る。** 録音中は既定の出力をミュートします。録音の途中でアプリやヘルパーが強制終了されるとミュートが残り、その後は「利用者がもともとミュートしていた」と判断されて解除されなくなります。ヘルパーが終了時にミュートを戻すようにしました。`SIGKILL` の場合は戻せないので、`pactl set-sink-mute @DEFAULT_SINK@ 0` で直します。

## あえて移植しなかったもの

- Linuxでオンボーディング完了まで録音系サービスの初期化を遅らせる処理。upstreamのサービスグラフには当てはまらず、これ無しでもオンボーディング中のサインインが動くことを確認しました。
- 修飾キーを `flagsChanged` として送る方式。ヘルパーが通常の `keyDown` / `keyUp` を送るようにしたので、`shortcut-manager.ts` はupstreamと同一のままです。

## ローカル設定（`apps/desktop/.env`）

`.env` はコミットしません。`pnpm start` と `pnpm make:linux` の両方が読み、パッケージ版には値が埋め込まれます。

```bash
AUTH_CLIENT_ID=<OAuthクライアントID>
AUTHORIZATION_ENDPOINT=https://core.amical.ai/api/auth/oauth2/authorize
AUTH_LOGIN_URL=https://login.amical.ai/auth/sign-in
AUTH_TOKEN_ENDPOINT=https://core.amical.ai/api/auth/oauth2/token
AUTH_REDIRECT_URI=amical://oauth/callback
API_ENDPOINT=https://dictation.amical.ai
# 認証エンドポイントからの推測。upstreamでは未確認。
CORE_API_URL=https://core.amical.ai
TELEMETRY_ENABLED=false
```

## 依存関係のインストール

- `ONNXRUNTIME_NODE_INSTALL=skip pnpm install --frozen-lockfile` — この変数で、Linuxでは失敗するonnxruntimeのCUDA取得（任意）を飛ばします。
- 依存の追加や更新には `--config.blockExoticSubdeps=false` が必要です。ロックファイルの再解決が走ると、Electron Forgeが依存するgit経由の `@electron/node-gyp` をpnpm 11が拒否するためです（これはupstreamのロックファイルに既に含まれています）。

## 次回のupstreamマージのチェックリスト

1. `main` をupstreamと同一に保ち、こまめに `develop_ubuntu` へマージする。今回の手間の原因は、個々の変更ではなく7か月分のずれでした。
2. マージ後、upstreamの新しいコードから、macOSとWindowsしか想定していない分岐を探す：`isWindows()`、`process.platform === "win32"`、既定値として使われている `WINDOWS_` 定数、`systemPreferences.` の呼び出し。
3. `packages/types/src/schemas` とLinuxヘルパーのディスパッチャ（`linux-helper-ts/src/rpc/dispatcher.ts`）を比べ、RPCメソッドの追加や変更を確認する。
4. Electronのバージョンを確認する。メジャー更新で、表示方式、クリップボードAPI（Electron 44から非同期）、ウィンドウの挙動が変わることがあります。
5. Linux上で `pnpm type:check` と `pnpm test` を実行し、続けて手で確認する：起動、サインイン、ショートカット、開始音と終了音、ウィジェットの位置、音声認識、別ウィンドウへの貼り付け。
6. 確認中の終了はトレイメニューから行う。録音の途中で強制終了すると、システム出力がミュートのまま残ります。
