"""Data-only successor-baseline proposal; no execution or approval authority.

Callers must preserve the three expected digests independently. Digests establish
byte integrity, not source authenticity, model execution or owner approval.
"""

import hashlib
import io
import json
import re
import stat
import zipfile
from dataclasses import dataclass

FILE_LIMIT = 512 * 1024
TOTAL_LIMIT = 8 * 1024 * 1024
ARCHIVE_LIMIT = 10 * 1024 * 1024
JSON_LIMIT = 2 * 1024 * 1024
FILE_COUNT_LIMIT = 512
CHUNK_BYTES = 2300
LEGACY_SHA = "9cf979733d8d4753023b1dd239ba4a5f3be2e0a6a3216c9dda206c089a2b6aa5"


@dataclass(frozen=True)
class Bundle:
    archive: bytes
    manifest: bytes
    plan: bytes


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def _json(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("utf-8")


def _legacy():
    return {"version": "v0.5", "sha256": LEGACY_SHA, "filesExpected": 47,
            "pilotExpected": 8, "pilotActual": 0, "fullExpected": 104,
            "fullActual": 0, "status": "UNVERIFIED"}


def _gates():
    return {"status": "CANDIDATE_ONLY", "designApproval": "HOLD",
            "mergeAuthorized": False, "publisherEnabled": False,
            "goalAchieved": False, "legacy": _legacy()}


def _path(name):
    if not isinstance(name, str) or len(name) > 240:
        raise ValueError("INVALID_SOURCE_PATH")
    parts = name.split("/")
    reserved = {"CON", "PRN", "AUX", "NUL", *(f"COM{n}" for n in range(1, 10)),
                *(f"LPT{n}" for n in range(1, 10))}
    for part in parts:
        if (not re.fullmatch(r"[A-Za-z0-9_.-]+", part) or part in (".", "..")
                or part.endswith(".") or part.split(".")[0].upper() in reserved):
            raise ValueError("INVALID_SOURCE_PATH")
    return name


def _identity(repository, revision, candidate_id):
    if not isinstance(repository, str) or not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repository):
        raise ValueError("INVALID_REPOSITORY")
    if not isinstance(revision, str) or not re.fullmatch(r"[a-f0-9]{40}", revision):
        raise ValueError("INVALID_REVISION")
    if not isinstance(candidate_id, str) or not re.fullmatch(r"recovery-proposal-[a-z0-9-]{1,64}", candidate_id):
        raise ValueError("INVALID_CANDIDATE_ID")


def _sources(sources):
    if type(sources) is not dict or not 1 <= len(sources) <= FILE_COUNT_LIMIT:
        raise ValueError("INVALID_SOURCE_COUNT")
    seen = set()
    total = 0
    for name, raw in sources.items():
        _path(name)
        if name.casefold() in seen:
            raise ValueError("CASE_COLLISION")
        seen.add(name.casefold())
        if type(raw) is not bytes or len(raw) > FILE_LIMIT or b"\0" in raw:
            raise ValueError("INVALID_SOURCE_BYTES")
        try:
            raw.decode("utf-8", errors="strict")
        except UnicodeError as exc:
            raise ValueError("NON_UTF8_SOURCE") from exc
        total += len(raw)
        if total > TOTAL_LIMIT:
            raise ValueError("SOURCE_TOTAL_LIMIT")
    # Avoid file/directory prefix ambiguity on future approved consumers.
    for name in sources:
        parts = name.casefold().split("/")
        if any("/".join(parts[:n]) in seen for n in range(1, len(parts))):
            raise ValueError("SOURCE_PREFIX_COLLISION")


def _chunks(name, raw, first_index):
    result = []
    start = 0
    while start < len(raw):
        end = min(start + CHUNK_BYTES, len(raw))
        while end < len(raw) and raw[end] & 0xC0 == 0x80:
            end -= 1
        piece = raw[start:end]
        result.append({"id": f"chunk-{first_index + len(result):06d}", "path": name,
                       "start": start, "end": end, "sha256": sha256(piece)})
        start = end
    return result


def build_bundle(*, repository, revision, candidate_id, sources):
    """Package explicit UTF-8 bytes. This never reads paths or executes source."""
    _identity(repository, revision, candidate_id)
    _sources(sources)
    stream = io.BytesIO()
    files = []
    chunks = []
    with zipfile.ZipFile(stream, "w", compression=zipfile.ZIP_STORED) as archive:
        for name, raw in sorted(sources.items()):
            info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.create_system = 3
            info.external_attr = (stat.S_IFREG | 0o644) << 16
            archive.writestr(info, raw)
            files.append({"path": name, "size": len(raw), "sha256": sha256(raw)})
            chunks.extend(_chunks(name, raw, len(chunks)))
    archive_bytes = stream.getvalue()
    manifest = _json({"schema": "source-baseline-proposal/1", "candidateId": candidate_id,
                      "repository": repository, "revision": revision, "files": files,
                      "archiveSha256": sha256(archive_bytes), **_gates()})
    plan = _json({"schema": "source-review-plan-proposal/1", "candidateId": candidate_id,
                  "archiveSha256": sha256(archive_bytes), "manifestSha256": sha256(manifest),
                  "chunkBytes": CHUNK_BYTES, "chunks": chunks, **_gates()})
    if len(archive_bytes) > ARCHIVE_LIMIT or max(len(manifest), len(plan)) > JSON_LIMIT:
        raise ValueError("BUNDLE_SIZE_LIMIT")
    return Bundle(archive_bytes, manifest, plan)


def verify_bundle(bundle, expected):
    """Recompute exact coverage against three external pins; return no authority."""
    if type(bundle) is not Bundle or type(expected) is not dict or set(expected) != {"archive", "manifest", "plan"}:
        raise ValueError("INDEPENDENT_PINS_REQUIRED")
    for key, maximum in (("archive", ARCHIVE_LIMIT), ("manifest", JSON_LIMIT), ("plan", JSON_LIMIT)):
        raw = getattr(bundle, key)
        if type(raw) is not bytes or len(raw) > maximum:
            raise ValueError("BUNDLE_SIZE_LIMIT")
        pin = expected[key]
        if not isinstance(pin, str) or not re.fullmatch(r"[a-f0-9]{64}", pin) or sha256(raw) != pin:
            raise ValueError("BUNDLE_PIN_MISMATCH")
    try:
        manifest = json.loads(bundle.manifest)
        if type(manifest) is not dict:
            raise ValueError("INVALID_MANIFEST")
        sources = {}
        expanded = 0
        with zipfile.ZipFile(io.BytesIO(bundle.archive)) as archive:
            entries = archive.infolist()
            if not 1 <= len(entries) <= FILE_COUNT_LIMIT:
                raise ValueError("INVALID_SOURCE_COUNT")
            for info in entries:
                name = _path(info.filename)
                mode = info.external_attr >> 16
                if (name in sources or not stat.S_ISREG(mode) or info.flag_bits & 1 or info.is_dir()
                        or info.compress_type != zipfile.ZIP_STORED or info.compress_size != info.file_size):
                    raise ValueError("INVALID_ARCHIVE_ENTRY")
                expanded += info.file_size
                if info.file_size > FILE_LIMIT or expanded > TOTAL_LIMIT:
                    raise ValueError("SOURCE_TOTAL_LIMIT")
                with archive.open(info) as source:
                    raw = source.read(FILE_LIMIT + 1)
                if len(raw) != info.file_size:
                    raise ValueError("INVALID_ARCHIVE_SIZE")
                sources[name] = raw
        rebuilt = build_bundle(repository=manifest["repository"], revision=manifest["revision"],
                               candidate_id=manifest["candidateId"], sources=sources)
        if rebuilt != bundle:
            raise ValueError("NONCANONICAL_BUNDLE_OR_PLAN")
        plan = json.loads(rebuilt.plan)
    except (KeyError, TypeError, UnicodeError, zipfile.BadZipFile, RuntimeError, NotImplementedError) as exc:
        raise ValueError("INVALID_BUNDLE") from exc
    return {**_gates(), "files": len(sources), "chunks": len(plan["chunks"]),
            "repository": manifest["repository"], "revision": manifest["revision"],
            "candidateId": manifest["candidateId"], "integrity": "MATCHED_EXTERNAL_PINS",
            "sourceAuthenticity": "REQUIRES_INDEPENDENT_PROVENANCE"}
