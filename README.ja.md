# nxapi Mobile

[English README](README.md) · [Android ビルド手順](android/README.md)

`nxapi` を Android 単体で動かすための非公式フォークです。スマホ内部で
nxapi のモバイルサーバーを起動し、端末内の画面を `127.0.0.1` だけで公開します。
PC や常時起動のサーバーは不要です。

## できること

- Nintendo Account でのログイン
- フレンド、ゲームサービス、お知らせの表示
- Discord Social SDK を使った Discord Rich Presence
- サブアカウント経由での Splatoon 3 の詳細表示
- Discord に表示するフレンド（プレイ状況取得元）の選択

Splatoon 3 の詳細表示には、選択したサブアカウントに Nintendo Switch Online
の有効な利用権、SplatNet 3 へのアクセス、対象アカウントとのフレンド関係が必要です。

## インストールと使い方

配布済み APK を使う場合は、Android 端末で APK をインストールして起動します。
初回は Nintendo Account でログインし、Discord 連携を使う場合はアプリ内の
Discord 設定から連携してください。

Android は OS の制限に従い、Discord のバックグラウンド更新が遅延または停止する
場合があります。バッテリー最適化の対象外に設定すると改善することがあります。

## ソースからビルドする

必要なものは Node.js/npm、JDK 17、Android SDK 35、Android NDK
`27.0.12077973` です。さらに、次のバイナリは Git に含めていないため各自で配置します。

- `android/app/libnode/bin/arm64-v8a/libnode.so`
- `android/app/libnode/include/node/`
- `android/app/libs/discord_partner_sdk.aar`

Discord SDK は Discord Developer Portal から取得してください。続けて次を実行します。

```powershell
npm ci
npm run build:mobile
.\android\prepare-node-project.ps1
.\android\gradlew.bat -p android assembleDebug
```

生成先は `android/app/build/outputs/apk/debug/app-debug.apk` です。npm が PATH にない場合は、
`prepare-node-project.ps1` に `-NpmCommand C:\path\to\npm.cmd` を指定できます。

詳細な依存ファイル、OAuth、リリース向け手順は [Android ビルド手順](android/README.md) を
確認してください。

## OAuth

このフォークには Public OAuth クライアント ID を同梱しています。Public クライアントの
ID は秘密情報ではありません。これが使えなくなった場合は、nxapi-auth で Public client を
作成し、`ca:gf ca:er ca:dr` のスコープを設定したうえで、
`MainActivity.java` の `DEFAULT_OAUTH_CLIENT_ID` を差し替えてください。

## 注意事項

- Nintendo、Discord、および nxapi の原作者はこのフォークと提携していません。
- Nintendo の非公式・リバースエンジニアリングされた API を利用します。利用は自己責任です。
- アカウントトークンなどの機微な情報を含むログやアプリデータを共有しないでください。
- ライセンスは元プロジェクトと同じ **AGPL-3.0-or-later** です。

## 元プロジェクト

このプロジェクトは [samuelthomas2774/nxapi](https://github.com/samuelthomas2774/nxapi) を
ベースにしています。CLI、Electron、API ライブラリなど、元の nxapi に関する英語ドキュメントは
[README.md](README.md) の後半に残しています。
