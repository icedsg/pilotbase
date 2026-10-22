#!/bin/sh
# Builds the Mac App Store package for this Mac's architecture.
#   MAS_PROFILE=/path/to/Pilotbase_Mac_App_Store.provisionprofile sh scripts/build-mas.sh
# Optional: MAS_KEYCHAIN (+ MAS_KEYCHAIN_PASSWORD) for a keychain that holds only
# the store identities; a new key in the login keychain makes codesign wait for
# an "allow access" prompt on screen.
# Needs the "3rd Party Mac Developer Application" and "... Installer" identities
# (Mac App Distribution / Mac Installer Distribution certificates) in the login
# keychain, the sidecar in ../api/dist/pilotbase-api and `npm install` done.
# The store needs a plain version and a build number that grows with every
# upload: MAS_VERSION=3.0.0 MAS_BUILD=2 (the App Store Connect version must match).
# Output: release/Pilotbase-<version>-mas-<arch>.pkg (upload with Transporter or
# `xcrun altool --upload-package`).
set -e
cd "$(dirname "$0")/.."
: "${MAS_PROFILE:?set MAS_PROFILE to the Mac App Store provisioning profile}"
ARCH=$(uname -m)
[ "$ARCH" = "x86_64" ] && ARCH=x64
if [ -n "$MAS_KEYCHAIN" ]; then
  [ -n "$MAS_KEYCHAIN_PASSWORD" ] && security unlock-keychain -p "$MAS_KEYCHAIN_PASSWORD" "$MAS_KEYCHAIN"
  export CSC_KEYCHAIN="$MAS_KEYCHAIN"
fi
npx tsc -p .
# electron-builder 25 signs a mas app twice: first with the mac options, then
# with the mas ones. mac.identity=null skips the first (slow, wrong entitlements)
# pass; the team name picks the 3rd Party Mac Developer identities for the second.
npx electron-builder --mac mas "--$ARCH" -c.mac.identity=null \
  -c.mas.identity="${MAS_IDENTITY:-Harish Palaniappan (C52W73GC5T)}" \
  -c.mas.provisioningProfile="$MAS_PROFILE" \
  -c.extraMetadata.version="${MAS_VERSION:?set MAS_VERSION, e.g. 3.0.0}" -c.buildVersion="${MAS_BUILD:?set MAS_BUILD}" "$@"
