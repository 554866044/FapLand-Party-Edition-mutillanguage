# What's New

## v0.2.12-beta

### Added

- An optional global **FPS Counter** can now be enabled from Settings to monitor renderer performance.
- **TheHandy** now supports direct stroke-range adjustment from both Settings and the global overlay, including reset controls and live percentage feedback.
- Playlist Workshop and Map Editor now include a **Disable Dice Animation** option for instant movement after rolls.

### Changed

- Round library previews now load through a dedicated playback-entry cache, deferred images, and hover-delayed video activation to keep large libraries feeling more responsive.
- Installed round shelves use better height estimation and broader virtualization, including grouped layouts, to keep scrolling smoother.
- The converter now shows visual skeleton cards while installed rounds or heroes are still loading.

### Fixed

- Remote round playback now recovers from browser autoplay mute restrictions and restores audio after the next user interaction.
- Website video scan discovery errors are now tracked instead of being silently skipped, making cache issues easier to diagnose.
- Cache invalidation now also clears stored playback entries when round media changes, and Settings keep the FPS counter toggle in sync across persisted store values, local cache, and the live overlay.

---

## v0.2.9-beta

### Added

- In-app release notes are now available directly from Settings.
- A dedicated **What's New** section makes recent improvements easier to discover.

### Changed

- Release notes are now authored from a single markdown file bundled with the app.
- Settings now place project information in a clearer flow: **Help**, **What's New**, then **Credits / License**.

### Fixed

- Settings now have a more structured place for update history instead of relying on external context.

---

For the full project history, visit the repository:
<https://github.com/FapLandPartyDev/FapLand-Party-Edition>
