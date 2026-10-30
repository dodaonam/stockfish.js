import json
import sys
import tempfile
import unittest
from pathlib import Path


HOST_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HOST_DIR))

import native_host


class NativeHostLinuxEngineTests(unittest.TestCase):
    @unittest.skipIf(sys.platform == "win32", "Linux engine path test")
    def test_engine_path_uses_executable_lc0_without_windows_dll(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            engine_dir = root / "engine"
            engine_dir.mkdir()
            engine_path = engine_dir / "lc0"
            engine_path.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
            engine_path.chmod(0o755)
            (root / native_host.CONFIG_FILE_NAME).write_text(
                json.dumps({"engineDir": str(engine_dir)}), encoding="utf-8"
            )

            engine = native_host.UciEngine()
            engine.root = root

            self.assertEqual(engine._engine_path(), engine_path.resolve())

    @unittest.skipIf(sys.platform == "win32", "Linux executable permission test")
    def test_engine_path_rejects_non_executable_lc0(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            engine_dir = root / "engine"
            engine_dir.mkdir()
            engine_path = engine_dir / "lc0"
            engine_path.write_text("not executable", encoding="utf-8")
            (root / native_host.CONFIG_FILE_NAME).write_text(
                json.dumps({"engineDir": str(engine_dir)}), encoding="utf-8"
            )

            engine = native_host.UciEngine()
            engine.root = root

            with self.assertRaisesRegex(native_host.HostError, "not executable"):
                engine._engine_path()


if __name__ == "__main__":
    unittest.main()
