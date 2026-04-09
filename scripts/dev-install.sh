#!/bin/bash
# Dev install script — builds node-pty for Obsidian's Electron and
# copies the plugin into the vault for local testing.
#
# Usage: bash scripts/dev-install.sh
#
# Prerequisites:
#   - Node.js and npm available on the Windows side (via powershell.exe)
#   - Visual Studio Build Tools (for native compilation on Windows)

set -euo pipefail

VAULT_DIR="/mnt/c/Users/mgrif/obsidianvaults/Sync Vault"
PLUGIN_DIR="${VAULT_DIR}/.obsidian/plugins/oterm"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ELECTRON_VERSION="39.6.0"
PLATFORM_TRIPLE="win32-x64"

echo "=== oterm dev install ==="

# Step 1: Build the plugin
echo "[1/5] Building plugin..."
cd "$PROJECT_DIR"
npm run build

# Step 2: Create plugin directory
echo "[2/5] Creating plugin directory..."
mkdir -p "$PLUGIN_DIR"
mkdir -p "$PLUGIN_DIR/native/$PLATFORM_TRIPLE"

# Step 3: Build node-pty for Windows Electron
echo "[3/5] Building node-pty for Electron $ELECTRON_VERSION..."
TEMP_BUILD="/tmp/oterm-pty-build"
rm -rf "$TEMP_BUILD"
mkdir -p "$TEMP_BUILD"

# Convert to Windows path for powershell
WIN_TEMP_BUILD=$(wslpath -w "$TEMP_BUILD")

powershell.exe -NoProfile -Command "
  Set-Location '$WIN_TEMP_BUILD'
  npm init -y | Out-Null
  npm install node-pty@1.1.0 --save
  npx electron-rebuild --version $ELECTRON_VERSION --module-dir . --which-module node-pty
" 2>&1 | while read line; do echo "  $line"; done

# Find the compiled .node file
PTY_NODE=$(find "$TEMP_BUILD/node_modules/node-pty/build/Release" -name "*.node" 2>/dev/null | head -1)
if [ -z "$PTY_NODE" ]; then
  # Try prebuilds directory
  PTY_NODE=$(find "$TEMP_BUILD/node_modules/node-pty/prebuilds" -name "*.node" 2>/dev/null | head -1)
fi

if [ -z "$PTY_NODE" ]; then
  echo "ERROR: Could not find compiled pty.node"
  echo "Contents of node-pty directory:"
  find "$TEMP_BUILD/node_modules/node-pty" -name "*.node" 2>/dev/null
  exit 1
fi

echo "  Found native binary: $PTY_NODE"
cp "$PTY_NODE" "$PLUGIN_DIR/native/$PLATFORM_TRIPLE/pty.node"

# Step 4: Generate checksums.json
echo "[4/5] Generating checksums.json..."
CHECKSUM=$(sha256sum "$PLUGIN_DIR/native/$PLATFORM_TRIPLE/pty.node" | awk '{print $1}')
cat > "$PLUGIN_DIR/checksums.json" <<CHECKSUMS
{
  "node-pty-$PLATFORM_TRIPLE.node": "$CHECKSUM"
}
CHECKSUMS

# Step 5: Copy plugin files
echo "[5/5] Copying plugin files..."
cp "$PROJECT_DIR/main.js" "$PLUGIN_DIR/"
cp "$PROJECT_DIR/manifest.json" "$PLUGIN_DIR/"
cp "$PROJECT_DIR/styles.css" "$PLUGIN_DIR/"

echo ""
echo "=== Done ==="
echo "Plugin installed to: $PLUGIN_DIR"
echo "Checksum: $CHECKSUM"
echo ""
echo "Next steps:"
echo "  1. Open Obsidian"
echo "  2. Settings > Community plugins > Enable 'oterm'"
echo "  3. Click the terminal icon in the ribbon or run 'Open terminal'"
