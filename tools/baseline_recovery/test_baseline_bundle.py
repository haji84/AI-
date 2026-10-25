import hashlib
import io
import json
import unittest
import zipfile
from dataclasses import replace
from unittest.mock import patch

from baseline_bundle import build_bundle, verify_bundle


def digest(data):
    return hashlib.sha256(data).hexdigest()


def pins(bundle):
    return {key: digest(getattr(bundle, key)) for key in ("archive", "manifest", "plan")}


def make(sources=None, **kw):
    return build_bundle(repository="haji84/AI-", revision="a" * 40,
                        candidate_id="recovery-proposal-test-01",
                        sources=sources if sources is not None else {"src/a.py": b"print('data only')\r\n"}, **kw)


class BaselineBundleTests(unittest.TestCase):
    def test_reproducible_exact_bytes_and_independent_recovery(self):
        sources = {"z.txt": b"\r\n", "src/a.py": b"raise Exception('MUST NOT RUN')\n"}
        try:
            first = make(sources)
        except NotImplementedError:
            self.fail("The source/plan binding API has not been implemented")
        self.assertEqual(first, make(dict(reversed(list(sources.items())))))
        report = verify_bundle(first, pins(first))
        self.assertEqual(report["status"], "CANDIDATE_ONLY")
        self.assertEqual(report["files"], 2)
        with zipfile.ZipFile(io.BytesIO(first.archive)) as archive:
            self.assertEqual({name: archive.read(name) for name in archive.namelist()}, sources)

    def test_actual_counts_and_utf8_ranges_preserve_source(self):
        raw = ("あ🙂é\r\n" * 900).encode()
        bundle = make({"one.txt": raw, "empty.txt": b""})
        plan = json.loads(bundle.plan)
        self.assertNotEqual(len(plan["chunks"]), 104)
        self.assertGreater(len(plan["chunks"]), 1)
        cursor = 0
        for index, chunk in enumerate(plan["chunks"]):
            self.assertEqual(chunk["id"], f"chunk-{index:06d}")
            self.assertEqual(chunk["path"], "one.txt")
            self.assertEqual(chunk["start"], cursor)
            piece = raw[chunk["start"]:chunk["end"]]
            piece.decode("utf-8", errors="strict")
            self.assertLessEqual(len(piece), 2300)
            self.assertEqual(digest(piece), chunk["sha256"])
            cursor = chunk["end"]
        self.assertEqual(cursor, len(raw))
        self.assertEqual(verify_bundle(bundle, pins(bundle))["chunks"], len(plan["chunks"]))

    def test_legacy_and_all_authority_gates_remain_unverified(self):
        report = verify_bundle(make(), pins(make()))
        legacy = report["legacy"]
        self.assertEqual(legacy["sha256"], "9cf979733d8d4753023b1dd239ba4a5f3be2e0a6a3216c9dda206c089a2b6aa5")
        self.assertEqual(legacy["pilotActual"], 0)
        self.assertEqual(legacy["fullActual"], 0)
        self.assertEqual(legacy["status"], "UNVERIFIED")
        self.assertEqual(report["designApproval"], "HOLD")
        for key in ("mergeAuthorized", "publisherEnabled", "goalAchieved"):
            self.assertIs(report[key], False)

    def test_missing_independent_pin_and_self_asserted_approval_rejected(self):
        bundle = make()
        for expected in ({}, {"archive": digest(bundle.archive)},
                         {**pins(bundle), "approved": True}, {**pins(bundle), "plan": "0" * 64}):
            with self.subTest(expected=expected), self.assertRaises(ValueError):
                verify_bundle(bundle, expected)

    def test_tampered_artifacts_rejected_against_original_pins(self):
        bundle = make()
        for key in ("archive", "manifest", "plan"):
            with self.subTest(key=key), self.assertRaises(ValueError):
                verify_bundle(replace(bundle, **{key: getattr(bundle, key) + b" "}), pins(bundle))

    def test_missing_duplicate_reordered_and_changed_plan_ranges_rejected_even_if_rehashed(self):
        bundle = make({"a.txt": b"x" * 5000})
        original = json.loads(bundle.plan)
        for mutation in (lambda p: p["chunks"].pop(),
                         lambda p: p["chunks"].append(p["chunks"][0]),
                         lambda p: p["chunks"].reverse(),
                         lambda p: p["chunks"][0].update(end=10),
                         lambda p: p.update(mergeAuthorized=True)):
            plan = json.loads(json.dumps(original))
            mutation(plan)
            changed = replace(bundle, plan=json.dumps(plan, sort_keys=True, separators=(",", ":")).encode())
            with self.subTest(mutation=mutation), self.assertRaises(ValueError):
                verify_bundle(changed, pins(changed))

    def test_unsafe_ambiguous_windows_paths_and_binary_inputs_rejected(self):
        paths = ["../x", "/x", "C:/x", "a\\b", "a//b", "a/./b", "a/../b", "CON", "a/AUX.txt", "a. ", "a:", "a\x00x"]
        for path in paths:
            with self.subTest(path=path), self.assertRaises(ValueError):
                make({path: b"safe"})
        for sources in ({"A.txt": b"a", "a.txt": b"b"}, {"binary.dat": b"\xff"}, {"nul.txt": b"a\x00b"}, {}):
            with self.subTest(sources=sources), self.assertRaises(ValueError):
                make(sources)

    def test_resource_and_identity_bounds_rejected(self):
        with self.assertRaises(ValueError):
            make({"big.txt": b"x" * (512 * 1024 + 1)})
        with self.assertRaises(ValueError):
            make({f"{n}.txt": b"" for n in range(513)})
        for repo, rev, name in (("not-a-repo", "a" * 40, "recovery-proposal-x"),
                                ("haji84/AI-", "bad", "recovery-proposal-x"),
                                ("haji84/AI-", "a" * 40, "v0.5")):
            with self.subTest(repo=repo, rev=rev, name=name), self.assertRaises(ValueError):
                build_bundle(repository=repo, revision=rev, candidate_id=name, sources={"x": b"ok"})

    def test_duplicate_and_nonregular_archive_entries_rejected_without_extraction(self):
        bundle = make()
        for variant in ("duplicate", "symlink"):
            stream = io.BytesIO()
            with zipfile.ZipFile(stream, "w") as archive:
                info = zipfile.ZipInfo("src/a.py")
                info.create_system = 3
                info.external_attr = (0o120777 if variant == "symlink" else 0o100644) << 16
                archive.writestr(info, b"print('data only')\r\n")
                if variant == "duplicate":
                    archive.writestr("src/a.py", b"duplicate")
            changed = replace(bundle, archive=stream.getvalue())
            with self.subTest(variant=variant), self.assertRaises(ValueError):
                verify_bundle(changed, pins(changed))

    def test_compressed_entries_rejected_before_constructing_any_decompressor(self):
        bundle = make()
        for compression in (zipfile.ZIP_DEFLATED, zipfile.ZIP_BZIP2, zipfile.ZIP_LZMA):
            stream = io.BytesIO()
            with zipfile.ZipFile(stream, "w", compression=compression) as archive:
                info = zipfile.ZipInfo("src/a.py")
                info.create_system = 3
                info.external_attr = 0o100644 << 16
                info.compress_type = compression
                archive.writestr(info, b"small data, never decompressed")
            changed = replace(bundle, archive=stream.getvalue())
            with self.subTest(compression=compression):
                with patch("zipfile._get_decompressor", side_effect=AssertionError("DECOMPRESSOR_CONSTRUCTED")):
                    with self.assertRaises(ValueError):
                        verify_bundle(changed, pins(changed))


if __name__ == "__main__":
    unittest.main()
