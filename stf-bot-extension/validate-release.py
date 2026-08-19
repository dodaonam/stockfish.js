from __future__ import annotations

import base64
import hashlib
import json
import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent
MANIFEST_PATH = ROOT / "extension" / "manifest.json"
INSTALLER_PATH = ROOT / "STFBot.iss"
NATIVE_HOST_PATH = ROOT / "dist" / "stf-native-host.exe"


def extension_id(public_key: str) -> str:
    digest = hashlib.sha256(base64.b64decode(public_key)).digest()[:16]
    alphabet = "abcdefghijklmnop"
    return "".join(alphabet[value >> 4] + alphabet[value & 0x0F] for value in digest)


def main() -> int:
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    installer = INSTALLER_PATH.read_text(encoding="utf-8")

    if manifest.get("name") != "STF Bot":
        raise ValueError("manifest name is not STF Bot")
    if manifest.get("background", {}).get("service_worker") != "background.js":
        raise ValueError("manifest service worker is incorrect")
    if "nativeMessaging" not in manifest.get("permissions", []):
        raise ValueError("manifest lacks nativeMessaging permission")

    actual_id = extension_id(manifest["key"])
    declared_id = re.search(r'#define MyExtensionId "([^"]+)"', installer)
    if not declared_id or declared_id.group(1) != actual_id:
        raise ValueError(f"extension ID mismatch: {actual_id} != {declared_id.group(1) if declared_id else '<missing>'}")

    required_installer_tokens = (
        '#define MyHostName "com.stfbot.nativehost"',
        'Source: "dist\\stf-native-host.exe"',
        'OutputBaseFilename=STFBot-Setup-{#MyAppVersion}',
        'ManifestPath := ExpandConstant(\'{app}\\com.stfbot.nativehost.json\')',
        'enginePath',
        'CreateInputFilePage',
    )
    for token in required_installer_tokens:
        if token not in installer:
            raise ValueError(f"installer missing required token: {token}")

    if not NATIVE_HOST_PATH.is_file() or NATIVE_HOST_PATH.stat().st_size == 0:
        raise ValueError(f"missing native host artifact: {NATIVE_HOST_PATH}")

    print(f"validated STF release contract and {NATIVE_HOST_PATH.name}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, json.JSONDecodeError) as error:
        print(f"release validation failed: {error}", file=sys.stderr)
        raise SystemExit(1)
