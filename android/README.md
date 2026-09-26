# nxapi Mobile for Android

[English](README.md) · [日本語](../README.ja.md)

This directory contains the standalone Android port of nxapi. It embeds Node.js,
serves the mobile UI only on `127.0.0.1`, and connects to the Discord Android app
through the Discord Social SDK.

## Features

- Nintendo Account login without a PC
- Friends, game-specific services, and announcements
- Background Discord Rich Presence
- Optional enhanced Splatoon 3 presence through a secondary Nintendo Account
- Selection of the friend whose presence is shown in Discord

Enhanced Splatoon 3 presence requires the secondary account to have an active
Nintendo Switch Online membership, SplatNet 3 access, and the target account in
its friend list.

## Binary dependencies

Binary SDKs are intentionally not committed to Git:

- Android arm64 Node.js library and headers:
  `app/libnode/bin/arm64-v8a/libnode.so` and `app/libnode/include/node/`
- Discord Social SDK Android AAR: `app/libs/discord_partner_sdk.aar`

Obtain the Discord SDK from the Discord Developer Portal for your application.
The application ID used by this fork is declared in `MainActivity.java`.

## Build

Requirements: Node.js/npm, JDK 17, Android SDK 35, Android NDK
`27.0.12077973`, and the binary dependencies above.

```powershell
npm ci
npm run build:mobile
.\android\prepare-node-project.ps1
.\android\gradlew.bat -p android assembleDebug
```

If npm is not on `PATH`, pass its full path using
`-NpmCommand C:\path\to\npm.cmd`.

The APK is written to `android/app/build/outputs/apk/debug/app-debug.apk`.
The generated Node staging directory, APKs, SDK binaries, and build outputs are
excluded by `.gitignore`.

## OAuth client

The bundled nxapi-auth client is a Public OAuth client. Its client ID is not a
secret. If it is revoked, replace `DEFAULT_OAUTH_CLIENT_ID` in
`MainActivity.java` with another Public client that has the scopes
`ca:gf ca:er ca:dr`.

## Upstream and license

This is based on [samuelthomas2774/nxapi](https://github.com/samuelthomas2774/nxapi)
and remains licensed under AGPL-3.0-or-later. Nintendo, Discord, and this project
are not affiliated.
