"""Disposable hosted-runner signature tests. No production keys, installs, or uploads."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import struct
import subprocess
import sys
import tempfile
import zipfile


SCRIPT = Path(__file__).with_name("verify_release.py")


def command(arguments):
    return subprocess.run(list(map(str, arguments)), capture_output=True, text=True,
                          encoding="utf-8", timeout=120, check=True).stdout


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--unsigned", required=True, type=Path)
    parser.add_argument("--build-tools", required=True, type=Path)
    parser.add_argument("--source-commit", required=True)
    arguments = parser.parse_args()
    if (os.environ.get("GITHUB_ACTIONS") != "true"
            or os.environ.get("RUNNER_ENVIRONMENT") != "github-hosted"
            or sys.platform != "linux" or not os.environ.get("RUNNER_TEMP")):
        raise SystemExit("This signing fixture runs only on a disposable Linux GitHub-hosted runner.")
    unsigned = arguments.unsigned.resolve(strict=True)
    before = hashlib.sha256(unsigned.read_bytes()).hexdigest()
    apksigner = arguments.build_tools.resolve(strict=True) / "apksigner"
    zipalign = arguments.build_tools.resolve(strict=True) / "zipalign"
    aapt = arguments.build_tools.resolve(strict=True) / "aapt"
    # All key material, signed fixtures and deliberate corruptions are destroyed with
    # the temporary directory. The original build candidate is never modified.
    with tempfile.TemporaryDirectory(prefix="remote-lite-signing-fixture-", dir=os.environ["RUNNER_TEMP"]) as location:
        directory = Path(location)
        keystore, certificate = directory / "ci-test-only.p12", directory / "ci-test-only.der"
        password = "public-disposable-ci-fixture-only"
        command(["keytool", "-genkeypair", "-keystore", keystore, "-storetype", "PKCS12",
                 "-storepass", password, "-keypass", password, "-alias", "ci-test", "-keyalg", "RSA",
                 "-keysize", "2048", "-validity", "2", "-dname", "CN=Remote Lite CI fixture ONLY", "-noprompt"])
        command(["keytool", "-exportcert", "-keystore", keystore, "-storepass", password,
                 "-alias", "ci-test", "-file", certificate])
        expected_signer = hashlib.sha256(certificate.read_bytes()).hexdigest()

        def sign(source, target, v1=False):
            command([apksigner, "sign", "--ks", keystore, "--ks-key-alias", "ci-test",
                     "--ks-pass", "pass:" + password, "--key-pass", "pass:" + password,
                     "--v1-signing-enabled", str(v1).lower(), "--v2-signing-enabled", "true",
                     "--v3-signing-enabled", "true", "--v4-signing-enabled", "false", "--out", target, source])

        def verify(signed, expected_error=None, **overrides):
            options = dict(unsigned=unsigned, signed=signed, unsigned_sha256=before,
                           signer_sha256=expected_signer, version_code="1", version_name="0.1.0-dev",
                           previous_version_code="0", source_commit=arguments.source_commit,
                           build_tools=arguments.build_tools)
            options.update(overrides)
            cli = [sys.executable, SCRIPT]
            for key, value in options.items():
                cli.extend(["--" + key.replace("_", "-"), str(value)])
            result = subprocess.run([*map(str, cli), "--test-only-key"], capture_output=True,
                                    text=True, encoding="utf-8", timeout=180, check=False)
            if expected_error:
                if result.returncode == 0 or result.stdout.strip() or expected_error not in result.stderr:
                    raise AssertionError(f"Expected rejection {expected_error!r}: {result.returncode} {result.stdout} {result.stderr}")
                print("PASS rejection: " + expected_error)
                return None
            if result.returncode:
                raise AssertionError(result.stderr)
            receipt = json.loads(result.stdout)
            assert receipt["status"] == "PASS" and receipt["distributable"] is False
            assert receipt["signingKeyPurpose"] == "CI_TEST_ONLY" and receipt["physicalAcceptance"] == "NOT_RUN"
            return receipt

        signed = directory / "signed-test-only.apk"
        sign(unsigned, signed)
        # Preserve the tool/version boundary if the independent verifier rejects a
        # new SDK output shape. This is an ephemeral public certificate, never key
        # material or a production identity. Do not infer an expected fingerprint
        # from this output: it remains the independently exported DER hash above.
        print(json.dumps(dict(fixture="EPHEMERAL_CI_ONLY", buildToolsDirectory=arguments.build_tools.name,
                              apksignerVersion=command([apksigner, "version"]).strip(),
                              expectedCertificateSha256=expected_signer)), flush=True)
        print(command([apksigner, "verify", "--verbose", "--print-certs", "-Werr", signed]), flush=True)
        receipt = verify(signed)
        print("PASS actual v2/v3 signature with independently exported certificate fingerprint")
        signed_v1 = directory / "signed-v1-test-only.apk"
        sign(unsigned, signed_v1, v1=True)
        v1_receipt = verify(signed_v1)
        assert len(v1_receipt["excludedSigningEntries"]) == 3
        print("PASS actual v1+v2+v3 signature metadata exception")
        verify(signed, "signer certificate SHA256", signer_sha256="0" * 64)
        verify(signed, "unsigned SHA256", unsigned_sha256="0" * 64)
        verify(signed, "package/version", version_code="2")
        verify(signed, "versionCode must increase", previous_version_code="1")
        unsigned_copy = directory / "still-unsigned.apk"
        shutil.copyfile(unsigned, unsigned_copy)
        verify(unsigned_copy, "apksigner failed")

        # Corrupt only the v2/v3 signing block lengths: ZIP payload still matches.
        corrupt = directory / "corrupt-signature.apk"
        data = bytearray(signed.read_bytes())
        with zipfile.ZipFile(signed) as archive:
            central = archive.start_dir
        assert data[central - 16:central] == b"APK Sig Block 42"
        block_size = struct.unpack_from("<Q", data, central - 24)[0]
        position, changed = central - block_size, 0
        while position < central - 24:
            size, identifier = struct.unpack_from("<QI", data, position)
            assert size >= 4 and position + 8 + size <= central - 24
            if identifier in (0x7109871A, 0xF05368C0, 0x1B93AD61):
                data[position + 12:position + 16] = b"\xff\xff\xff\x7f"
                changed += 1
            position += 8 + size
        assert changed >= 2
        corrupt.write_bytes(data)
        verify(corrupt, "apksigner failed")

        # Re-sign a modified payload with the *correct* key. A valid signature alone
        # must not admit code/resource substitutions relative to the approved APK.
        changed_zip, aligned, changed_signed = (directory / name for name in
                                                ("changed.apk", "changed-aligned.apk", "changed-signed.apk"))
        with zipfile.ZipFile(unsigned) as original, zipfile.ZipFile(changed_zip, "w") as output:
            for entry in original.infolist():
                content = original.read(entry)
                if entry.filename == "classes.dex":
                    content += b"deliberate-test-only-change"
                output.writestr(entry, content)
        command([zipalign, "-P", "16", "-f", "4", changed_zip, aligned])
        sign(aligned, changed_signed)
        command([apksigner, "verify", "--verbose", "--print-certs", "-Werr", changed_signed])
        verify(changed_signed, "payload differs")
        assert hashlib.sha256(unsigned.read_bytes()).hexdigest() == before
        print(json.dumps(dict(fixture="EPHEMERAL_CI_ONLY", distributable=False,
                              checks="v1/v2/v3, signer, hash, version, unsigned, corrupt signature, re-signed payload",
                              buildTools=command([aapt, "version"]).strip(),
                              apksignerVersion=command([apksigner, "version"]).strip(), receipt=receipt), indent=2))


if __name__ == "__main__":
    main()
