# Packaging

Manifests for the package managers whisperlane is distributed through. The
release itself is the primary channel; these files exist so that
`winget install` and `scoop install` reach the same signed installer.

## What lives here

- `winget/manifests/s/Smarteknoloji/Whisperlane/<version>/` — the three
  manifests expected by `microsoft/winget-pkgs`, in the exact folder layout
  that repository uses. Submitting a release means copying that version
  folder into a fork of `winget-pkgs` and opening a pull request.
- `scoop/whisperlane.json` — the manifest for our own bucket,
  `fahrim/scoop-whisperlane`. In the bucket it sits at `bucket/whisperlane.json`.

## Every release

1. The release workflow writes `SHA256SUMS.txt` next to the installers and
   attaches it to the release. Both package managers refuse a download they
   cannot verify, so this file is the source of truth for the hashes below.
2. Add the new version folder under `winget/manifests/` with the installer
   URL and the SHA256 from that file, then open the pull request.
3. Update `scoop/whisperlane.json` (version, url, hash) and push it to the
   bucket repository.

`checkver` and `autoupdate` in the scoop manifest let Scoop find new GitHub
releases on its own; the hash still has to be updated, because Scoop pins it.

## Why the installer, and not a zip

The NSIS installer is what carries the transcription runtime and the updater
signature. A portable zip would need its own build target and its own answer
for updates, so Scoop is pointed at the installer with `/D` and the app is
managed by Scoop afterwards.

## Why winget starts at 0.8.1

The 0.8.0 installer was built before the bundle declared a publisher, so its
uninstall entry has an empty one. `winget-pkgs` validates the manifest
against what the installer registers, and an empty publisher does not match a
manifest that names one. 0.8.1 is built with `bundle.publisher` set to
`Smarteknoloji`, which is the release the winget pull request points at.

The package identifier follows the publisher: `Smarteknoloji.Whisperlane`.
Renaming it later means abandoning the identifier, so it is set once here.
