#!/usr/bin/env bash
# Download FFmpeg/FFprobe and build whisper-cli for bundling with the app.
# Usage: scripts/fetch-sidecars.sh <rust-target-triple>
# Output: src-tauri/binaries/clipmaster-{ffmpeg,ffprobe,whisper-cli}-<triple>[.exe]
set -euo pipefail

TRIPLE="${1:?target triple required, e.g. x86_64-unknown-linux-gnu}"
WHISPER_TAG="${WHISPER_TAG:-v1.9.4}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/src-tauri/binaries"
WORK="$(mktemp -d)"
EXT=""
[[ "$TRIPLE" == *windows* ]] && EXT=".exe"
mkdir -p "$OUT"
cd "$WORK"

echo "==> FFmpeg for $TRIPLE"
case "$TRIPLE" in
  x86_64-unknown-linux-gnu)
    curl -fsSL -o ff.tar.xz https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linux64-gpl.tar.xz
    tar -xJf ff.tar.xz
    D=ffmpeg-master-latest-linux64-gpl
    cp "$D/bin/ffmpeg" "$OUT/clipmaster-ffmpeg-$TRIPLE"
    cp "$D/bin/ffprobe" "$OUT/clipmaster-ffprobe-$TRIPLE"
    cp "$D/LICENSE.txt" "$OUT/FFMPEG-LICENSE.txt"
    ;;
  x86_64-pc-windows-msvc)
    curl -fsSL -o ff.zip https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip
    unzip -q ff.zip
    D=ffmpeg-master-latest-win64-gpl
    cp "$D/bin/ffmpeg.exe" "$OUT/clipmaster-ffmpeg-$TRIPLE.exe"
    cp "$D/bin/ffprobe.exe" "$OUT/clipmaster-ffprobe-$TRIPLE.exe"
    cp "$D/LICENSE.txt" "$OUT/FFMPEG-LICENSE.txt"
    ;;
  aarch64-apple-darwin | x86_64-apple-darwin)
    ARCH=arm64
    [[ "$TRIPLE" == x86_64* ]] && ARCH=amd64
    for tool in ffmpeg ffprobe; do
      curl -fsSL -o "$tool.zip" "https://ffmpeg.martin-riedl.de/redirect/latest/macos/$ARCH/release/$tool.zip"
      unzip -q -o "$tool.zip"
      cp "$tool" "$OUT/clipmaster-$tool-$TRIPLE"
      chmod +x "$OUT/clipmaster-$tool-$TRIPLE"
    done
    curl -fsSL -o "$OUT/FFMPEG-LICENSE.txt" https://www.gnu.org/licenses/gpl-3.0.txt
    ;;
  *)
    echo "Unsupported target $TRIPLE" >&2
    exit 1
    ;;
esac

echo "==> whisper.cpp $WHISPER_TAG"
git clone -q --depth 1 --branch "$WHISPER_TAG" https://github.com/ggml-org/whisper.cpp
# Static, portable build: no -march=native so it runs on any CPU of this arch.
cmake -S whisper.cpp -B wbuild -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DGGML_NATIVE=OFF \
  -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_SERVER=OFF ${WHISPER_CMAKE_ARGS:-}
cmake --build wbuild --config Release -j 4 --target whisper-cli
BIN=$(find wbuild -type f \( -name "whisper-cli" -o -name "whisper-cli.exe" \) | head -1)
cp "$BIN" "$OUT/clipmaster-whisper-cli-$TRIPLE$EXT"
cp whisper.cpp/LICENSE "$OUT/WHISPER-LICENSE.txt"

chmod +x "$OUT"/*-"$TRIPLE"* || true
ls -la "$OUT"
