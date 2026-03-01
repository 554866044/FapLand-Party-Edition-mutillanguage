# F-Land (Fap Land — Party Edition)

A chaotic, adult-oriented, up to 4-player asynchronous multiplayer board game that also can be played solo. Think "Mario Party" meets haptic hardware synchronization.

## The Elevator Pitch

Players race across a 2D virtual game board while simultaneously watching a local video synced to their personal haptic hardware (TheHandy). As they progress, they collect coins and use them to place "Traps" (anti-perks) on the board. When an opponent lands on a trap, their video, hardware, or gameplay is sabotaged in real-time.

## Core Gameplay Loop

1. **The Setup:** Players open multiplayer, the app resumes or creates a Supabase multiplayer account automatically, enter their Handy Connection Key, and select a local video (`.mp4`/`.webm`) and its matching `.funscript` file. On servers with Discord auth configured, players must link a Discord account that has an email. Custom/self-hosted servers without Discord OAuth fall back to anonymous multiplayer.
2. **The Race:** The game is an asynchronous race. Players roll dice to move across the PixiJS 2D board.
3. **The Sabotage (Traps):** Players spend coins to place traps on specific board tiles. If Player B lands on Player A's "Speed Trap," Player B's video `playbackRate` dynamically shifts to 1.5x, and their Handy hardware instantly scales its speed to match.
4. **The Queue:** To handle concurrent attacks, traps do not overwrite each other. They are pushed into a sequential "Trap Queue." The player's client processes them one by one until the queue is empty.
5. **The Climax:** The match ends when the conditions are met, and the Host broadcasts the final `MatchRecord`.

## Technology Stack

- **Frontend**: React 19, TypeScript, TailwindCSS 4, Vite
- **Desktop Environment**: Electron
- **Game Engine**: PixiJS (`@pixi/react`)
- **Backend & Multiplayer**: Supabase (Database & Realtime Broadcast for intense setup)
- **Local Storage**: Prisma + LibSQL
- **Hardware API**: TheHandy API v3 (Firmware 4, HSP protocol)

## Hardware Integration Constraints

- **Protocol**: Exclusively utilizes the official REST API v3 (Firmware 4) in HSP (Handy Streaming Protocol) mode.
- **Variable Speeds**: To keep haptics perfectly synced with trap effects (e.g., `video.playbackRate = 1.5`), the game issues immediate `PUT /hsp/playbackrate` commands.
- **Latency**: Prioritizes the Local Network API (direct IP communication) to ensure traps and haptic alterations trigger instantly.

## Development

Install dependencies with the local flake-backed toolchain:

```bash
nix develop -c npm install
```

Create a local env file before running multiplayer locally:

```bash
cp .example.env .env
```

Set `VITE_MULTIPLAYER_DEVELOPMENT_SUPABASE_ANON_KEY` in `.env` to your local Supabase anon key. The development key is no longer kept in source.

If you want local Supabase multiplayer to require Discord linking, also set:

```bash
SUPABASE_AUTH_EXTERNAL_DISCORD_CLIENT_ID=...
SUPABASE_AUTH_EXTERNAL_DISCORD_SECRET=...
```

The desktop OAuth callback used by the packaged app is `fland://auth/callback`.

Start the development server:

```bash
nix develop -c npm run dev
```

Run multiplayer development environment:

```bash
nix develop -c npm run dev:multiplayer
```

Build for production:

```bash
nix develop -c npm run build
```

Build the hardened renderer/main bundle with terser minification, target-specific obfuscation, and production source maps disabled:

```bash
nix develop -c npm run build:release
```

Build the hardened release bundle with compressed size reporting enabled:

```bash
nix develop -c npm run build:analyze
```

Build a packaged release with Electron fuses, ASAR packaging, and embedded ASAR integrity validation:

```bash
nix develop -c npm run build:package
```

Build a packaged tester build that keeps dev-only app features enabled while preserving the packaged hardening defaults:

```bash
nix develop -c npm run build:testers
```

Optional build flags:

- `FLAND_BUILD_PROFILE=default|release`
- `FLAND_OBFUSCATE_RENDERER=true|false`
- `FLAND_OBFUSCATE_PRELOAD=true|false`
- `FLAND_OBFUSCATE_MAIN=true|false`
- `FLAND_BUILD_ANALYZE=true|false`
- `FLAND_ENABLE_DEV_FEATURES=true|false`

## License

This project is licensed under the GNU Affero General Public License v3.0 - see the [LICENSE](LICENSE) file for details.
