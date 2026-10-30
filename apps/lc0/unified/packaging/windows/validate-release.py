#!/usr/bin/env python3
"""Validate that the Unified Windows release cannot bundle the third-party LC0 engine.

Can be run locally without Windows. The optional artifact checks are for the
Windows CI build; they do not replace end-to-end installer/engine testing.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import re
from pathlib import Path

PROJECT = Path(__file__).resolve().parents[2]
MANIFEST = PROJECT / "extension" / "manifest.json"
INSTALLER = PROJECT / "packaging" / "windows" / "LC0Bot.iss"
BUILDER = PROJECT / "packaging" / "windows" / "build-native-host.ps1"
EXPECTED_ID = "fffphhehicejaoofboihaahcdjoomjck"
EXPECTED_HOST = "com.lc0bot.unifiedhost"
EXPECTED_SOURCE = r"dist\lc0-native-host.exe"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def extension_id_from_key(public_key: str) -> str:
    digest = hashlib.sha256(base64.b64decode(public_key, validate=True)).hexdigest()[:32]
    return "".join(chr(ord("a") + int(nibble, 16)) for nibble in digest)


def validate_source() -> None:
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    require(manifest["manifest_version"] == 3, "Expected a Manifest V3 extension")
    require("nativeMessaging" in manifest["permissions"], "Missing nativeMessaging permission")
    require(extension_id_from_key(manifest["key"]) == EXPECTED_ID, "Extension key/ID has changed")

    installer = INSTALLER.read_text(encoding="utf-8")
    require(f'#define MyHostName "{EXPECTED_HOST}"' in installer, "Wrong Native Host identity")
    require(f'#define MyExtensionId "{EXPECTED_ID}"' in installer, "Native Host extension ID mismatch")
    require("PrivilegesRequired=lowest" in installer, "Expected per-user installation")
    require(r"Software\Google\Chrome\NativeMessagingHosts\{#MyHostName}" in installer,
            "Chrome Native Messaging registration missing")
    require(r"Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\{#MyHostName}" in installer,
            "Brave Native Messaging registration missing")

    files_section = re.search(r"(?ims)^\[Files\]\s*\r?\n(.*?)(?=^\[[^\]]+\]|\Z)", installer)
    require(files_section is not None, "Inno Setup [Files] section missing")
    sources = re.findall(r'(?im)^\s*Source:\s*"([^"]+)"', files_section.group(1))
    require(sources == [EXPECTED_SOURCE],
            f"Installer must bundle only {EXPECTED_SOURCE!r}; found {sources!r}")

    builder = BUILDER.read_text(encoding="utf-8")
    require("--onefile" in builder and '--name "lc0-native-host"' in builder,
            "Expected a standalone PyInstaller Native Host")
    require("--add-data" not in builder and "--add-binary" not in builder,
            "Do not embed engine or network data in the Native Host")


def validate_pe_executable(path: Path, description: str) -> None:
    require(path.is_file(), f"{description} does not exist: {path}")
    require(path.stat().st_size > 1024, f"{description} is unexpectedly small: {path}")
    with path.open("rb") as stream:
        require(stream.read(2) == b"MZ", f"{description} is not a Windows PE executable: {path}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", type=Path, help="Compiled Native Host executable")
    parser.add_argument("--setup", type=Path, help="Compiled Inno Setup executable")
    args = parser.parse_args()
    validate_source()
    if args.host:
        validate_pe_executable(args.host, "Native Host")
    if args.setup:
        validate_pe_executable(args.setup, "Windows Setup")
    print("Unified Windows release contract OK")


if __name__ == "__main__":
    main()
