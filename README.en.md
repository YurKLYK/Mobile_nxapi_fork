# nxapi Mobile

[日本語](README.ja.md) · [Android build guide](android/README.md)

An unofficial fork that runs [nxapi](https://github.com/samuelthomas2774/nxapi)
on an Android device without a PC or an always-on server. The app runs its
mobile server locally and exposes its UI only at `127.0.0.1`.

## Features

- Nintendo Account sign-in, friends, game services, and announcements
- Discord Rich Presence through Discord Social SDK
- Optional Splatoon 3 details through a secondary Nintendo Account
- Selection of the friend whose presence is published to Discord

Enhanced Splatoon 3 presence requires the secondary account to have an active
Nintendo Switch Online membership, SplatNet 3 access, and the target account in
its friend list.

## Build from source

Install Node.js/npm, JDK 17, Android SDK 35, and Android NDK `27.0.12077973`.
The following binary dependencies are deliberately excluded from Git and must
be supplied locally:

- `android/app/libnode/bin/arm64-v8a/libnode.so`
- `android/app/libnode/include/node/`
- `android/app/libs/discord_partner_sdk.aar`

Get the Discord SDK from the Discord Developer Portal, then run:

```powershell
npm ci
npm run build:mobile
.\android\prepare-node-project.ps1
.\android\gradlew.bat -p android assembleDebug
```

The APK is generated at `android/app/build/outputs/apk/debug/app-debug.apk`.
If npm is not on `PATH`, provide its full path to
`prepare-node-project.ps1` with `-NpmCommand C:\path\to\npm.cmd`.

## OAuth

This fork bundles a Public nxapi-auth OAuth client ID. A Public client ID is
not secret. If it is revoked, create a Public client with scopes
`ca:gf ca:er ca:dr`, then replace `DEFAULT_OAUTH_CLIENT_ID` in
`MainActivity.java`.

## Notes

- This is not affiliated with Nintendo, Discord, or the original nxapi author.
- It uses unofficial, reverse-engineered Nintendo APIs. Use it at your own risk.
- Do not share app data or logs that may contain account tokens.
- Licensed under **AGPL-3.0-or-later**, the same license as the upstream project.
