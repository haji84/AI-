"""Check Accessibility screenshot and gesture via Android's visible setup UI."""

import json
import re
import subprocess
import time
import urllib.request
import xml.etree.ElementTree as ET


PACKAGE = "app.goriq.remote.lite"
APK = "android/remote-lite/app/build/outputs/apk/debug/app-debug.apk"


def adb(*arguments):
    result = subprocess.run(
        ["adb", *arguments], capture_output=True, text=True, timeout=45, check=True
    )
    return result.stdout


def nodes():
    adb("shell", "uiautomator", "dump", "/sdcard/remote_lite_window.xml")
    xml = adb("exec-out", "cat", "/sdcard/remote_lite_window.xml")
    return list(ET.fromstring(xml).iter("node"))


def label(node):
    return " ".join((node.get("text", ""), node.get("content-desc", "")))


def visible():
    return [label(node) for node in nodes() if label(node).strip()]


def wait_for_nodes(find, description, seconds=35):
    deadline = time.monotonic() + seconds
    last = []
    while time.monotonic() < deadline:
        try:
            last = nodes()
            found = find(last)
            if found is not None:
                return found
        except (subprocess.CalledProcessError, ET.ParseError):
            pass
        time.sleep(1)
    visible_labels = [label(node) for node in last if label(node).strip()]
    bound = [line.strip() for line in adb("shell", "dumpsys", "accessibility").splitlines()
             if PACKAGE in line][:12]
    raise AssertionError(f"Missing {description}; visible={visible_labels!r}; accessibility={bound!r}")


def wait_for_text(fragment, seconds=35):
    return wait_for_nodes(
        lambda items: next((node for node in items if fragment in label(node)), None),
        f"UI text {fragment!r}", seconds)


def tap_node(node):
    bounds = [int(value) for value in re.findall(r"\d+", node.get("bounds", ""))]
    if len(bounds) != 4:
        raise AssertionError(f"Missing UI bounds for {label(node)}")
    adb("shell", "input", "tap", str((bounds[0] + bounds[2]) // 2), str((bounds[1] + bounds[3]) // 2))


def tap_text(fragment):
    tap_node(wait_for_text(fragment))


def tap_exact_text(value):
    tap_node(wait_for_nodes(
        lambda items: next((node for node in items if node.get("text", "").strip() == value), None),
        f"exact UI text {value!r}"))


def optional_text(fragment, seconds=6, exact=False):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        try:
            found = next((node for node in nodes() if
                          (node.get("text", "").strip() == fragment if exact else fragment in label(node))), None)
            if found is not None:
                return found
        except (subprocess.CalledProcessError, ET.ParseError):
            pass
        time.sleep(1)
    return None


def find_switch(items):
    return next((node for node in items if "Switch" in node.get("class", "")), None)


def enabled_switch(items):
    switch = find_switch(items)
    return switch if switch is not None and switch.get("checked") == "true" else None


def confirmation_or_enabled(items):
    if any(node.get("text", "").strip() == "Allow" for node in items):
        return "allow"
    return "enabled" if enabled_switch(items) is not None else None


def allow_accessibility_in_settings():
    # A sideloaded APK may require an extra confirmation on its App Info page.
    adb("shell", "am", "start", "-a", "android.settings.APPLICATION_DETAILS_SETTINGS",
        "-d", f"package:{PACKAGE}")
    wait_for_text("GORIQ Remote Lite")
    print(f"App Info controls: {visible()!r}", flush=True)
    more = optional_text("More options")
    if more is not None:
        tap_node(more)
        restricted = optional_text("Allow restricted settings")
        if restricted is not None:
            tap_node(restricted)
            if optional_text("Allow", 4, exact=True) is not None:
                tap_exact_text("Allow")

    adb("shell", "am", "start", "-a", "android.settings.ACCESSIBILITY_SETTINGS")
    for _ in range(4):
        option = wait_for_nodes(
            lambda items: next((node for name in ("GORIQ Remote Lite 手動操作", "Downloaded apps", "Installed apps")
                                for node in items if name in label(node)), None),
            "Accessibility service or downloaded-apps entry")
        print(f"Accessibility controls: {visible()!r}", flush=True)
        is_service = "GORIQ Remote Lite 手動操作" in label(option)
        tap_node(option)
        if is_service:
            break
    else:
        raise AssertionError(f"Service missing from Accessibility settings: {visible()!r}")

    switch = wait_for_nodes(find_switch, "Accessibility service switch")
    if switch.get("checked") != "true":
        tap_node(switch)
        decision = wait_for_nodes(confirmation_or_enabled,
                                  "Accessibility confirmation or enabled switch")
        if decision == "allow":
            tap_exact_text("Allow")
        wait_for_nodes(enabled_switch, "enabled Accessibility switch")
    adb("shell", "am", "start", "-n", f"{PACKAGE}/.MainActivity")


def verify_real_keystore_pairing():
    fixture = subprocess.Popen(
        ["node", "android/remote-lite/scripts/pairing_fixture.mjs"],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    port = None
    try:
        ready_line = fixture.stdout.readline()
        if not ready_line:
            raise AssertionError("Local pairing fixture failed to start")
        ready = json.loads(ready_line)
        port = ready["port"]
        adb("reverse", f"tcp:{port}", f"tcp:{port}")
        adb("shell", "am", "start", "-n", f"{PACKAGE}/.DebugPairingActivity",
            "--ei", "port", str(port), "--es", "inviteCode", ready["inviteCode"])
        tap_text("ローカル登録を診断する")
        result = wait_for_text("所有者の承認待ち", seconds=35).get("text", "")
        request_id = re.search(r"申請ID: ([0-9a-f-]{36})", result)
        fingerprint = re.search(r"指紋: ([0-9a-f]{64})", result)
        if request_id is None or fingerprint is None:
            raise AssertionError(f"Android pairing receipt incomplete: {result!r}")
        payload = json.dumps({"requestId": request_id.group(1),
                              "expectedFingerprint": fingerprint.group(1)}).encode()
        request = urllib.request.Request(f"http://127.0.0.1:{port}/v1/approve", payload,
            {"Content-Type": "application/json", "X-VM-Owner": ready["ownerAuthorization"]})
        with urllib.request.urlopen(request, timeout=5) as response:
            approved = json.load(response)
        if not approved.get("ok") or approved.get("result", {}).get("status") != "registered":
            raise AssertionError(f"Node coordinator refused AndroidKeyStore proof: {approved!r}")
        print("Android 15 VM: real AndroidKeyStore P-256 enrollment accepted by Node coordinator", flush=True)
    finally:
        if port is not None:
            subprocess.run(["adb", "reverse", "--remove", f"tcp:{port}"],
                           capture_output=True, text=True, timeout=10)
        fixture.terminate()
        try:
            fixture.communicate(timeout=5)
        except subprocess.TimeoutExpired:
            fixture.kill()
            fixture.communicate()


def verify_accessibility_capture():
    for attempt in range(1, 4):
        tap_text("画面取得を診断する")
        outcome = wait_for_nodes(
            lambda items: next((node for node in items if
                "画面取得:" in label(node) or "画面取得できません:" in label(node)), None),
            "screen capture diagnostic result")
        result = label(outcome)
        if "画面取得:" in result:
            return
        if "Accessibility disconnected" not in result:
            raise AssertionError(f"Screen capture diagnostic failed: {result!r}")
        print(f"Accessibility rebound during capture attempt {attempt}/3", flush=True)
        if attempt < 3:
            time.sleep(2)
    raise AssertionError("Accessibility stayed disconnected across 3 capture attempts")


def main():
    adb("install", "-r", APK)
    allow_accessibility_in_settings()
    wait_for_text("端末ID:")
    verify_accessibility_capture()
    tap_text("手動入力を診断する")
    wait_for_text("画面取得と手動入力: 成功")
    print("Android 15 VM: local key, Accessibility screenshot and actual tap passed")
    verify_real_keystore_pairing()


if __name__ == "__main__":
    main()
