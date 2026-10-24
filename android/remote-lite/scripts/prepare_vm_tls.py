"""Generate a short-lived, debug-only loopback TLS fixture in ignored build output."""

import argparse
import os
from pathlib import Path
import subprocess
import uuid


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--keytool", default=str(Path(os.environ.get("JAVA_HOME", "")) /
        "bin" / ("keytool.exe" if os.name == "nt" else "keytool")))
    args = parser.parse_args()
    app = Path(__file__).resolve().parents[1] / "app"
    tls = app / "build" / "vm-tls"
    raw = app / "build" / "generated" / "vm-res" / "raw"
    tls.mkdir(parents=True, exist_ok=True)
    raw.mkdir(parents=True, exist_ok=True)
    pending = tls / f"{uuid.uuid4()}.p12"
    password = "vm-fixture-only"  # Public fixture password, never a production credential.
    subprocess.run([args.keytool, "-genkeypair", "-alias", "loopback", "-keyalg", "EC",
        "-groupname", "secp256r1", "-storetype", "PKCS12", "-keystore", str(pending),
        "-storepass", password, "-keypass", password, "-dname", "CN=Remote Lite VM ONLY",
        "-ext", "SAN=ip:127.0.0.1", "-ext", "BC=ca:true", "-ext", "EKU=serverAuth",
        "-startdate", "-1d", "-validity", "2", "-noprompt"], check=True, capture_output=True)
    subprocess.run([args.keytool, "-exportcert", "-rfc", "-alias", "loopback", "-keystore",
        str(pending), "-storepass", password, "-file", str(raw / "remote_lite_vm_ca.pem")],
        check=True, capture_output=True)
    os.replace(pending, tls / "server.p12")
    print("Prepared ephemeral debug-only HTTPS fixture for 127.0.0.1")


if __name__ == "__main__":
    main()
