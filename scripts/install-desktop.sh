#!/usr/bin/env bash
# Install a .desktop entry + icons for the dev build of BotCord so the
# Linux taskbar uses our icon instead of the generic Electron one.
#
# Run once after cloning. Re-run if you move the repo.

set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE_ICON="$REPO_DIR/public/botcord-icon.png"

if [ ! -f "$SOURCE_ICON" ]; then
  echo "error: $SOURCE_ICON not found" >&2
  exit 1
fi

if ! command -v magick >/dev/null 2>&1 && ! command -v convert >/dev/null 2>&1; then
  echo "error: ImageMagick (magick or convert) required to generate icon sizes" >&2
  exit 1
fi

ICON_DIR_ROOT="$HOME/.local/share/icons/hicolor"
APPS_DIR="$HOME/.local/share/applications"
mkdir -p "$APPS_DIR"

# Generate icons at standard hicolor sizes. ImageMagick handles aspect-fit:
# the source can be any aspect ratio; we centre it on a square transparent
# canvas so the WM gets a square icon at every size.
SIZES=(16 22 24 32 48 64 96 128 256 512)
for SIZE in "${SIZES[@]}"; do
  TARGET_DIR="$ICON_DIR_ROOT/${SIZE}x${SIZE}/apps"
  mkdir -p "$TARGET_DIR"
  TARGET="$TARGET_DIR/botcord.png"
  CONTENT_SIZE=$(( SIZE * 4 / 5 ))  # 80% content, 10% padding each side
  if command -v magick >/dev/null 2>&1; then
    magick "$SOURCE_ICON" -trim +repage \
      -resize "${CONTENT_SIZE}x${CONTENT_SIZE}" \
      -background none -gravity center -extent "${SIZE}x${SIZE}" \
      "PNG32:$TARGET"
  else
    convert "$SOURCE_ICON" -trim +repage \
      -resize "${CONTENT_SIZE}x${CONTENT_SIZE}" \
      -background none -gravity center -extent "${SIZE}x${SIZE}" \
      "PNG32:$TARGET"
  fi
  echo "  installed $TARGET"
done

# Write the .desktop entry. Exec runs the dev server from the repo dir.
DESKTOP_FILE="$APPS_DIR/botcord-dev.desktop"
cat > "$DESKTOP_FILE" <<EOF
[Desktop Entry]
Name=BotCord (dev)
Comment=Discord admin cockpit (development build)
Exec=bash -lc "cd '$REPO_DIR' && npm run dev"
Icon=botcord
Terminal=false
Type=Application
Categories=Network;Chat;
StartupWMClass=botcord
StartupNotify=true
EOF

echo "  installed $DESKTOP_FILE"

# Refresh the icon and desktop caches so the entry shows up immediately.
if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  gtk-update-icon-cache -f "$ICON_DIR_ROOT" >/dev/null 2>&1 || true
fi
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$APPS_DIR" >/dev/null 2>&1 || true
fi
if command -v kbuildsycoca6 >/dev/null 2>&1; then
  kbuildsycoca6 >/dev/null 2>&1 || true
elif command -v kbuildsycoca5 >/dev/null 2>&1; then
  kbuildsycoca5 >/dev/null 2>&1 || true
fi

echo
echo "Done. You can now launch BotCord (dev) from your application menu."
echo "If the icon doesn't update, you may need to log out/in or restart plasmashell."
