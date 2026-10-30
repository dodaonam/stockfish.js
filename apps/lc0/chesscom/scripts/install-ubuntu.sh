#!/usr/bin/env bash
set -euo pipefail

LC0_VERSION="v0.32.1"
LC0_REPOSITORY="https://github.com/LeelaChessZero/lc0.git"
NATIVE_HOST_NAME="com.lc0bot.nativehost"
EXTENSION_ID="fpcmlebcligjofgppbfhaciaildiieaj"
DEFAULT_WEIGHT_SHA256="c2fbea2282a25d9f77bb3ba764b89a3b45451fcc0a747b5ec5c2b39a816e35a3"

fail() {
  printf 'LC0 Bot setup failed: %s\n' "$*" >&2
  exit 1
}

info() {
  printf 'LC0 Bot: %s\n' "$*"
}

PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
DEFAULT_WEIGHT="${PROJECT_DIR}/assets/weights/evilgyal-6.pb.gz"

if [[ ! -r /etc/os-release ]]; then
  fail "cannot identify the operating system."
fi
# shellcheck disable=SC1091
. /etc/os-release
if [[ "${ID:-}" != "ubuntu" ]]; then
  fail "Ubuntu 22.04 or newer is required."
fi
if ! dpkg --compare-versions "${VERSION_ID:-0}" ge 22.04; then
  fail "Ubuntu 22.04 or newer is required; found ${VERSION_ID:-unknown}."
fi
if [[ "$(uname -m)" != "x86_64" ]]; then
  fail "this build supports x86_64 only; found $(uname -m)."
fi

if [[ ! -f "$DEFAULT_WEIGHT" ]]; then
  fail "default weight is missing: $DEFAULT_WEIGHT"
fi
actual_weight_sha256="$(sha256sum "$DEFAULT_WEIGHT" | awk '{print $1}')"
if [[ "$actual_weight_sha256" != "$DEFAULT_WEIGHT_SHA256" ]]; then
  fail "default weight checksum does not match the planned evilgyal-6.pb.gz file."
fi

DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
CACHE_HOME="${XDG_CACHE_HOME:-$HOME/.cache}"
CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}"
if [[ "$DATA_HOME" != /* || "$CACHE_HOME" != /* || "$CONFIG_HOME" != /* ]]; then
  fail "XDG data, cache, and config paths must be absolute."
fi

DATA_DIR="${DATA_HOME}/lc0bot"
ENGINE_DIR="${DATA_DIR}/engine"
WEIGHTS_DIR="${ENGINE_DIR}/weights"
HOST_PATH="${DATA_DIR}/native_host.py"
CONFIG_PATH="${DATA_DIR}/engine-config.json"
CACHE_DIR="${CACHE_HOME}/lc0bot"
SOURCE_DIR="${CACHE_DIR}/lc0-${LC0_VERSION}"

existing_weights=()
if [[ -d "$ENGINE_DIR" ]]; then
  while IFS= read -r -d '' weight; do
    existing_weights+=("$weight")
  done < <(find "$ENGINE_DIR" -maxdepth 2 -type f -name '*.pb.gz' -print0)
fi
if ((${#existing_weights[@]} > 1)); then
  printf 'Multiple weights found:\n' >&2
  printf '  %s\n' "${existing_weights[@]}" >&2
  fail "keep exactly one .pb.gz file under $ENGINE_DIR before installing."
fi

required_packages=(
  build-essential
  git
  python3
  meson
  ninja-build
  pkg-config
  zlib1g-dev
  libeigen3-dev
  libopenblas-dev
)
missing_packages=()
for package in "${required_packages[@]}"; do
  package_status="$(dpkg-query -W -f='${db:Status-Abbrev}' "$package" 2>/dev/null || true)"
  if [[ "$package_status" != ii* ]]; then
    missing_packages+=("$package")
  fi
done

if command -v meson >/dev/null 2>&1; then
  meson_version="$(meson --version)"
  if ! dpkg --compare-versions "$meson_version" ge 0.61 && ! printf '%s\n' "${missing_packages[@]}" | grep -qx meson; then
    missing_packages+=(meson)
  fi
fi

if ((${#missing_packages[@]} > 0)); then
  apt_prefix=()
  if ((EUID != 0)); then
    command -v sudo >/dev/null 2>&1 || fail "sudo is required to install build dependencies."
    sudo -v
    apt_prefix=(sudo)
  fi
  info "installing missing build dependencies: ${missing_packages[*]}"
  "${apt_prefix[@]}" apt-get update
  "${apt_prefix[@]}" apt-get install --no-install-recommends -y "${missing_packages[@]}"
fi

export PATH="/usr/bin:/bin:$PATH"
command -v meson >/dev/null 2>&1 || fail "Meson was not installed."
meson_version="$(meson --version)"
if ! dpkg --compare-versions "$meson_version" ge 0.61; then
  fail "Meson 0.61 or newer is required; found $meson_version."
fi

mkdir -p "$CACHE_DIR"
if [[ -e "$SOURCE_DIR" ]]; then
  [[ -d "$SOURCE_DIR/.git" ]] || fail "source cache exists but is not a Git checkout: $SOURCE_DIR"
  source_tag="$(git -C "$SOURCE_DIR" describe --tags --exact-match HEAD 2>/dev/null || true)"
  [[ "$source_tag" == "$LC0_VERSION" ]] || fail "source cache is not pinned to $LC0_VERSION: $SOURCE_DIR"
  git -C "$SOURCE_DIR" submodule update --init --recursive
else
  info "cloning Lc0 $LC0_VERSION (including its source submodule)"
  git clone --depth 1 --recurse-submodules --branch "$LC0_VERSION" "$LC0_REPOSITORY" "$SOURCE_DIR"
fi

info "building Lc0 $LC0_VERSION with the CPU/OpenBLAS backend"
(
  cd "$SOURCE_DIR"
  unset INSTALL_PREFIX
  ./build.sh release \
    -Dblas=true -Dopenblas=true \
    -Dplain_cuda=false -Dcudnn=false \
    -Dopencl=false -Ddx=false -Dtensorflow=false \
    -Donnx=false -Dxla=false -Dsycl=off -Dgtest=false
)

BUILT_ENGINE="${SOURCE_DIR}/build/release/lc0"
[[ -x "$BUILT_ENGINE" ]] || fail "Lc0 build completed without an executable at $BUILT_ENGINE"

mkdir -p "$ENGINE_DIR" "$WEIGHTS_DIR"
install -m 0755 "$BUILT_ENGINE" "$ENGINE_DIR/lc0"
if ((${#existing_weights[@]} == 0)); then
  install -m 0644 "$DEFAULT_WEIGHT" "$WEIGHTS_DIR/evilgyal-6.pb.gz"
fi
install -m 0755 "${PROJECT_DIR}/host/native_host.py" "$HOST_PATH"

python3 - "$CONFIG_PATH" "$ENGINE_DIR" <<'PY'
import json
import os
import sys
import tempfile
from pathlib import Path

config_path = Path(sys.argv[1])
config_path.parent.mkdir(parents=True, exist_ok=True)
payload = {"protocolVersion": 1, "engineDir": str(Path(sys.argv[2]).resolve())}
fd, temporary_path = tempfile.mkstemp(prefix="engine-config-", dir=config_path.parent)
try:
    with os.fdopen(fd, "w", encoding="utf-8") as stream:
        json.dump(payload, stream, separators=(",", ":"))
        stream.write("\n")
    os.replace(temporary_path, config_path)
except Exception:
    try:
        os.unlink(temporary_path)
    except FileNotFoundError:
        pass
    raise
PY

python3 - "$HOST_PATH" "$CONFIG_HOME" "$NATIVE_HOST_NAME" "$EXTENSION_ID" <<'PY'
import json
import os
import sys
import tempfile
from pathlib import Path

host_path = str(Path(sys.argv[1]).resolve())
config_home = Path(sys.argv[2])
host_name = sys.argv[3]
extension_id = sys.argv[4]
manifest = {
    "name": host_name,
    "description": "LC0 Bot Native Messaging host",
    "path": host_path,
    "type": "stdio",
    "allowed_origins": [f"chrome-extension://{extension_id}/"],
}
manifest_dirs = [
    config_home / "google-chrome" / "NativeMessagingHosts",
    config_home / "BraveSoftware" / "Brave-Browser" / "NativeMessagingHosts",
]
for manifest_dir in manifest_dirs:
    manifest_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = manifest_dir / f"{host_name}.json"
    fd, temporary_path = tempfile.mkstemp(prefix=f"{host_name}-", dir=manifest_dir)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(manifest, stream, separators=(",", ":"))
            stream.write("\n")
        os.replace(temporary_path, manifest_path)
    except Exception:
        try:
            os.unlink(temporary_path)
        except FileNotFoundError:
            pass
        raise
legacy_chromium_manifest = config_home / "chromium" / "NativeMessagingHosts" / f"{host_name}.json"
legacy_chromium_manifest.unlink(missing_ok=True)
PY

info "installed Lc0 and Native Messaging host for Google Chrome and Brave."
info "replace the single .pb.gz file under $WEIGHTS_DIR to change the network."
