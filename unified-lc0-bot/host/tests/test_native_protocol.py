"""Cross-platform Native Host protocol tests (run on both Ubuntu and Windows)."""
import sys
import tempfile
import unittest
from pathlib import Path

HOST_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HOST_DIR))

import native_host


START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"


class StubEngine:
    def __init__(self):
        self.calls = []

    def bestmove(self, fen, search_mode, movetime_ms=None, nodes=None):
        self.calls.append((fen, search_mode, movetime_ms, nodes))
        return "e2e4", None, 12


class NativeHostProtocolTests(unittest.TestCase):
    def test_accepts_standard_fen(self):
        self.assertEqual(native_host.validate_fen(START_FEN), START_FEN)

    def test_rejects_invalid_fen(self):
        for fen in ("", "invalid", START_FEN.replace(" w ", " x "), START_FEN.replace("8/8/8/8/", "9/8/8/8/")):
            with self.subTest(fen=fen):
                with self.assertRaises(native_host.HostError):
                    native_host.validate_fen(fen)

    def test_rejects_missing_and_multiple_weights(self):
        with tempfile.TemporaryDirectory() as temporary:
            engine = Path(temporary)
            with self.assertRaises(native_host.HostError) as missing:
                native_host.find_weights(engine)
            self.assertEqual(missing.exception.code, "WEIGHTS_NOT_FOUND")
            (engine / "a.pb.gz").write_bytes(b"a")
            self.assertEqual(native_host.find_weights(engine).name, "a.pb.gz")
            (engine / "weights").mkdir()
            (engine / "weights" / "b.pb.gz").write_bytes(b"b")
            with self.assertRaises(native_host.HostError) as multiple:
                native_host.find_weights(engine)
            self.assertEqual(multiple.exception.code, "MULTIPLE_WEIGHTS")

    def test_bestmove_movetime_protocol(self):
        engine = StubEngine()
        result = native_host.handle_message(engine, {
            "type": "BESTMOVE", "requestId": "test-1", "fen": START_FEN,
            "searchMode": "movetime", "movetimeMs": 20
        })
        self.assertEqual(result["bestmove"], "e2e4")
        self.assertEqual(result["requestId"], "test-1")
        self.assertEqual(engine.calls, [(START_FEN, "movetime", 20, None)])

    def test_bestmove_nodes_protocol(self):
        engine = StubEngine()
        result = native_host.handle_message(engine, {
            "type": "BESTMOVE", "requestId": "test-2", "fen": START_FEN,
            "searchMode": "nodes", "nodes": 10000
        })
        self.assertEqual(result["nodes"], 10000)
        self.assertEqual(engine.calls, [(START_FEN, "nodes", None, 10000)])

    def test_rejects_out_of_range_nodes_without_starting_engine(self):
        engine = StubEngine()
        for nodes in (0, 10001, True, 1.5):
            with self.subTest(nodes=nodes):
                with self.assertRaises(native_host.HostError):
                    native_host.handle_message(engine, {
                        "type": "BESTMOVE", "requestId": "test-3", "fen": START_FEN,
                        "searchMode": "nodes", "nodes": nodes
                    })
        self.assertEqual(engine.calls, [])


if __name__ == "__main__":
    unittest.main()
