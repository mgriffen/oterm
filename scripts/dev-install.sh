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
echo "[1/4] Building plugin..."
cd "$PROJECT_DIR"
npm run build

# Step 2: Create plugin directory
echo "[2/4] Creating plugin directory..."
mkdir -p "$PLUGIN_DIR"

# Step 3: Build node-pty for Windows Electron
echo "[3/4] Building node-pty for Electron $ELECTRON_VERSION..."

# Must use a Windows-native path — cmd.exe can't handle WSL UNC paths
WIN_TEMP_BUILD='C:\Temp\oterm-pty-build'
TEMP_BUILD=$(wslpath "$WIN_TEMP_BUILD")
rm -rf "$TEMP_BUILD"
mkdir -p "$TEMP_BUILD"

# Create Directory.Build.targets to disable Spectre mitigation and add MSVC lib paths
# This must exist before electron-rebuild runs
# Discover the installed MSVC toolset version dynamically
MSVC_BASE='C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Tools\MSVC'
MSVC_VERSION=$(ls "$(wslpath "$MSVC_BASE")" | sort -V | tail -1)
if [ -z "$MSVC_VERSION" ]; then
    echo "ERROR: Could not find MSVC toolset under $MSVC_BASE" >&2
    exit 1
fi
MSVC_LIB_DIR="${MSVC_BASE}\\${MSVC_VERSION}\\lib\\x64"
cat > "$TEMP_BUILD/Directory.Build.targets" << EOF
<Project>
  <PropertyGroup>
    <SpectreMitigation>false</SpectreMitigation>
  </PropertyGroup>
  <ItemDefinitionGroup>
    <Link>
      <AdditionalLibraryDirectories>${MSVC_LIB_DIR};%(AdditionalLibraryDirectories)</AdditionalLibraryDirectories>
    </Link>
  </ItemDefinitionGroup>
</Project>
EOF

# Install node-pty and rebuild for Electron
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "
  Set-Location '$WIN_TEMP_BUILD'
  \$env:GYP_MSVS_VERSION = '2022'
  npm init -y | Out-Null
  npm install node-pty@1.1.0 --save
  npx @electron/rebuild --version $ELECTRON_VERSION --module-dir . --which-module node-pty
" 2>&1 | while read line; do echo "  $line"; done

# Verify the build produced native modules
CONPTY_NODE="$TEMP_BUILD/node_modules/node-pty/build/Release/conpty.node"
if [ ! -f "$CONPTY_NODE" ]; then
  echo "ERROR: Could not find compiled conpty.node"
  find "$TEMP_BUILD/node_modules/node-pty" -name "*.node" 2>/dev/null
  exit 1
fi

# Copy the full node-pty module (JS API + native bindings) to plugin dir
# node-pty needs its full JS layer to work, not just the bare .node files
echo "  Copying node-pty module..."
rm -rf "$PLUGIN_DIR/native/$PLATFORM_TRIPLE"
mkdir -p "$PLUGIN_DIR/native/$PLATFORM_TRIPLE"
cp -r "$TEMP_BUILD/node_modules/node-pty" "$PLUGIN_DIR/native/$PLATFORM_TRIPLE/node-pty"

# Step 4: Copy plugin files
echo "[4/4] Copying plugin files..."
cp "$PROJECT_DIR/main.js" "$PLUGIN_DIR/"
cp "$PROJECT_DIR/manifest.json" "$PLUGIN_DIR/"
cp "$PROJECT_DIR/styles.css" "$PLUGIN_DIR/"

echo ""
echo "=== Done ==="
echo "Plugin installed to: $PLUGIN_DIR"
echo ""
echo "Next steps:"
echo "  1. Open Obsidian"
echo "  2. Settings > Community plugins > Enable 'oterm'"
echo "  3. Click the terminal icon in the ribbon or run 'Open terminal'"

# Patch: replace worker_threads in ConoutConnection with inline pipe forwarding
# Electron's renderer process doesn't support worker_threads
echo "  Patching node-pty for Electron compatibility (no worker_threads)..."
cat > "$PLUGIN_DIR/native/$PLATFORM_TRIPLE/node-pty/lib/windowsConoutConnection.js" << 'CONOUT_EOF'
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConoutConnection = void 0;
var net_1 = require("net");
var conout_1 = require("./shared/conout");
var eventEmitter2_1 = require("./eventEmitter2");
var FLUSH_DATA_INTERVAL = 1000;
var ConoutConnection = (function () {
    function ConoutConnection(_conoutPipeName, _useConptyDll) {
        var _this = this;
        this._conoutPipeName = _conoutPipeName;
        this._useConptyDll = _useConptyDll;
        this._isDisposed = false;
        this._onReady = new eventEmitter2_1.EventEmitter2();
        this._conoutSocket = new net_1.Socket();
        this._conoutSocket.setEncoding('utf8');
        this._conoutSocket.connect(_conoutPipeName, function () {
            _this._server = net_1.createServer(function (workerSocket) {
                _this._conoutSocket.pipe(workerSocket);
            });
            _this._server.listen(conout_1.getWorkerPipeName(_conoutPipeName));
            _this._onReady.fire();
        });
    }
    Object.defineProperty(ConoutConnection.prototype, "onReady", {
        get: function () { return this._onReady.event; },
        enumerable: false,
        configurable: true
    });
    ConoutConnection.prototype.dispose = function () {
        if (!this._useConptyDll && this._isDisposed) { return; }
        this._isDisposed = true;
        this._drainDataAndClose();
    };
    ConoutConnection.prototype.connectSocket = function (socket) {
        socket.connect(conout_1.getWorkerPipeName(this._conoutPipeName));
    };
    ConoutConnection.prototype._drainDataAndClose = function () {
        var _this = this;
        if (this._drainTimeout) { clearTimeout(this._drainTimeout); }
        this._drainTimeout = setTimeout(function () { return _this._destroySocket(); }, FLUSH_DATA_INTERVAL);
    };
    ConoutConnection.prototype._destroySocket = function () {
        if (this._server) { this._server.close(); }
        if (this._conoutSocket) { this._conoutSocket.destroy(); }
    };
    return ConoutConnection;
}());
exports.ConoutConnection = ConoutConnection;
CONOUT_EOF
