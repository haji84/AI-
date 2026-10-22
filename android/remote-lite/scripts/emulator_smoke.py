"""Check Accessibility screenshot and gesture via Android's visible setup UI."""

import json
import re
import select
import shlex
import ssl
import subprocess
import time
import urllib.request
import urllib.parse
import xml.etree.ElementTree as ET


PACKAGE = "app.goriq.remote.lite"
APK = "android/remote-lite/app/build/outputs/apk/debug/app-debug.apk"
PROBE_APK = "android/remote-lite/vm-ui-probe/build/outputs/apk/debug/vm-ui-probe-debug.apk"


def adb(*arguments):
    result = subprocess.run(
        ["adb", *arguments], capture_output=True, text=True, timeout=45, check=True
    )
    return result.stdout


def nodes():
    output = adb("shell", "am", "instrument", "-w", "-r",
                 "app.goriq.remote.vmprobe/.HierarchyProbe")
    found = re.search(r"^INSTRUMENTATION_RESULT: hierarchy=(.+)$", output, re.MULTILINE)
    if "probe_error=WINDOW_NOT_READY" in output:
        raise ET.ParseError("VM hierarchy window not ready")
    if found is None or "INSTRUMENTATION_CODE: 0" not in output:
        raise AssertionError(f"VM hierarchy probe failed: {output[-1200:]!r}")
    return list(ET.fromstring(found.group(1)).iter("node"))


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


def tap_scrolled(fragment):
    for direction in ("down", "up"):
        for _ in range(6):
            found = optional_text(fragment, seconds=2)
            if found is not None and found.get("enabled") == "true":
                tap_node(found)
                return
            start, end = (550, 180) if direction == "down" else (180, 550)
            adb("shell", "input", "swipe", "160", str(start), "160", str(end), "250")
    raise AssertionError(f"Missing scrollable control {fragment!r}; visible={visible()!r}")


def open_debug_activity():
    for attempt in range(1, 4):
        launched = adb("shell", "am", "start", "-W", "-f", "0x10000000",
            "-n", f"{PACKAGE}/.DebugPairingActivity")
        print(f"Debug activity launch {attempt}/3: {launched.strip()}", flush=True)
        if optional_text("アクティブを再発見する", seconds=6) is not None:
            return
        time.sleep(1)
    activity = adb("shell", "dumpsys", "activity", "activities")
    crashes = adb("shell", "logcat", "-d", "-t", "100", "-s", "AndroidRuntime:E")
    raise AssertionError(f"Debug activity did not appear; visible={visible()!r}; "
        f"activity={activity[-1800:]!r}; crashes={crashes[-1800:]!r}")


def accessibility_diagnostic(stage):
    pid = adb("shell", "pidof", PACKAGE).strip()
    state = [line.strip() for line in adb("shell", "dumpsys", "accessibility").splitlines()
             if PACKAGE in line or "Bound services:" in line or "Enabled services:" in line]
    events = adb("shell", "logcat", "-d", "-t", "300", "-s", "RemoteLiteLifecycle:I", "*:S")
    print(f"Accessibility {stage}: pid={pid}; state={state!r}; lifecycle={events[-2500:]!r}", flush=True)


def find_switch(items):
    return next((node for node in items if "Switch" in node.get("class", "")), None)


def enabled_switch(items):
    switch = find_switch(items)
    return switch if switch is not None and switch.get("checked") == "true" else None


def confirmation_or_enabled(items):
    if any(node.get("text", "").strip() == "Allow" for node in items):
        return "allow"
    return "enabled" if enabled_switch(items) is not None else None


def allow_accessibility_in_settings(return_to_main=True):
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

    for attempt in range(1, 4):
        try:
            switch = wait_for_nodes(find_switch, "Accessibility service switch", seconds=8)
            break
        except AssertionError:
            # Retry only if the same Settings list is still visible, never dismiss a product error.
            service = optional_text("GORIQ Remote Lite 手動操作", seconds=2)
            if attempt == 3 or service is None:
                raise
            print(f"VM Settings service row did not open, retry {attempt + 1}/3", flush=True)
            tap_node(service)
    if switch.get("checked") != "true":
        tap_node(switch)
        decision = wait_for_nodes(confirmation_or_enabled,
                                  "Accessibility confirmation or enabled switch")
        if decision == "allow":
            tap_exact_text("Allow")
        wait_for_nodes(enabled_switch, "enabled Accessibility switch")
    if return_to_main:
        adb("shell", "am", "start", "-f", "0x10000000", "-n", f"{PACKAGE}/.MainActivity")
    else:
        adb("shell", "input", "keyevent", "3")


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
        def open_invite(code):
            link = "goriqremote://enroll?" + urllib.parse.urlencode({
                "server": ready["origin"], "invite": code})
            for attempt in range(1, 4):
                adb("shell", "am", "start", "-W", "-n", f"{PACKAGE}/.EnrollmentActivity",
                    "-a", "android.intent.action.VIEW", "-d", shlex.quote(link))
                if optional_text(f"接続先: {ready['origin']}", seconds=10) is not None:
                    return
                # Cold hosted images can show a launcher ANR before the app starts.
                # Handle only that named external process; product ANRs remain failures.
                if optional_text("Pixel Launcher isn't responding", seconds=2) is None:
                    break
                print(f"VM environment: Pixel Launcher ANR during setup launch {attempt}/3; explicitly closing launcher dialog", flush=True)
                tap_exact_text("Close app")
                time.sleep(2)
            wait_for_text(f"接続先: {ready['origin']}")
        # A definitely invalid invite must leave recoverable metadata, never auto-resend.
        open_invite("0" * 48)
        wait_for_text(f"接続先: {ready['origin']}")
        tap_scrolled("この接続先へ端末を登録する")
        failed = wait_for_text("登録結果が不明", seconds=35).get("text", "")
        old_fingerprint = re.search(r"指紋: ([0-9a-f]{64})", failed)
        if old_fingerprint is None:
            raise AssertionError("Failed enrollment lost its identity")
        open_invite(ready["inviteCode"])
        tap_scrolled("所有者確認後に新しい招待で再申請する")
        tap_text("確認済み・再申請する")
        result = wait_for_text("所有者の承認待ち", seconds=35).get("text", "")
        request_id = re.search(r"申請ID: ([0-9a-f-]{36})", result)
        fingerprint = re.search(r"指紋: ([0-9a-f]{64})", result)
        if request_id is None or fingerprint is None:
            raise AssertionError(f"Android pairing receipt incomplete: {result!r}")
        if old_fingerprint.group(1) != fingerprint.group(1):
            raise AssertionError("Owner-confirmed recovery replaced the device key")
        adb("shell", "am", "force-stop", PACKAGE)
        adb("shell", "am", "start", "-W", "-n", f"{PACKAGE}/.EnrollmentActivity")
        retained = wait_for_text("所有者の承認待ち", seconds=35).get("text", "")
        if request_id.group(1) not in retained or fingerprint.group(1) not in retained:
            raise AssertionError("Normal setup lost its pending receipt after process restart")
        context = ssl.create_default_context(
            cafile="android/remote-lite/app/build/generated/vm-res/raw/remote_lite_vm_ca.pem")
        def owner_post(path, payload):
            request = urllib.request.Request(ready["origin"] + path,
                json.dumps(payload).encode(),
                {"Content-Type": "application/json", "X-VM-Owner": ready["ownerAuthorization"]})
            with urllib.request.urlopen(request, timeout=5, context=context) as response:
                return json.load(response)

        approved = owner_post("/v1/approve", {"requestId": request_id.group(1),
            "expectedFingerprint": fingerprint.group(1)})
        if not approved.get("ok") or approved.get("result", {}).get("status") != "registered":
            raise AssertionError(f"Node coordinator refused AndroidKeyStore proof: {approved!r}")
        tap_scrolled("所有者の承認を確認する")
        wait_for_text("登録済み", seconds=35)
        print("Android 15 VM: normal setup registered real AndroidKeyStore over HTTPS and retained receipt", flush=True)
        open_debug_activity()
        device_id = approved["result"]["deviceId"]
        started = owner_post("/v1/start", {"deviceId": device_id})
        if not started.get("ok") or not started.get("result", {}).get("sessionId"):
            raise AssertionError(f"Owner could not start local session: {started!r}")
        session_id = started["result"]["sessionId"]
        tap_text("セッションを診断する")
        wait_for_text(f"セッション有効 ID: {session_id}", seconds=35)
        print("Android 15 VM: signed discovery, acceptance and active status passed", flush=True)
        adb("shell", "am", "force-stop", PACKAGE)
        open_debug_activity()
        tap_text("アクティブを再発見する")
        wait_for_text(f"再発見成功 ID: {session_id}", seconds=35)
        print("Android 15 VM: process restart rediscovered the active session with AndroidKeyStore", flush=True)
        viewer_token = started["result"]["viewerToken"]
        offer = {"type": "offer", "sdp": "v=0\r\ns=android-vm-signaling\r\n"}
        signaled = owner_post("/v1/viewer/signal", {"sessionId": session_id,
            "viewerToken": viewer_token, "signal": offer})
        if not signaled.get("ok"):
            raise AssertionError("Owner synthetic signaling offer was refused")
        tap_text("署名付き信号を診断する")
        wait_for_text("署名付き信号の往復: 成功")
        for cursor, expected in (
            (0, {"type": "answer", "sdp": "v=0\r\ns=android-key-signaling-answer\r\n"}),
            (1, {"type": "candidate", "candidate": "candidate:1 1 UDP 1 127.0.0.1 5000 typ host",
                 "sdpMid": "0", "sdpMLineIndex": 0}),
        ):
            reply = owner_post("/v1/viewer/poll", {"sessionId": session_id,
                "viewerToken": viewer_token, "ack": cursor})
            if not reply.get("ok") or reply.get("result") != {"cursor": cursor + 1, "signals": [expected]}:
                raise AssertionError("Node did not accept AndroidKeyStore-bound SDP/ICE")
        print("Android 15 VM: Node verified actual AndroidKeyStore signatures binding synthetic SDP and ICE", flush=True)
        adb("shell", "am", "force-stop", PACKAGE)
        open_debug_activity()
        tap_text("アクティブを再発見する")
        wait_for_text(f"再発見成功 ID: {session_id}", seconds=35)
        tap_text("署名付き信号を診断する")
        wait_for_text("信号カーソル再発見: 成功")
        print("Android 15 VM: applied signaling cursor survived process restart", flush=True)
        allow_accessibility_in_settings(return_to_main=False)
        open_debug_activity()
        tap_text("アクティブを再発見する")
        wait_for_text(f"再発見成功 ID: {session_id}", seconds=35)
        for attempt in range(1, 11):
            tap_text("操作権限接続を確認する")
            if optional_text("操作権限状態: 接続済み", seconds=2, exact=True) is not None:
                break
            print(f"Accessibility not connected after check {attempt}/10", flush=True)
            time.sleep(1)
        else:
            raise AssertionError("Accessibility service did not bind after visible permission setup")
        accessibility_diagnostic("after connected check")
        if optional_text("対象タップ数: 0", exact=True) is None:
            raise AssertionError("Tap target changed before authorized operation")
        tap_text("画面操作ゲートを診断する")
        outcome = wait_for_nodes(
            lambda items: next((node for node in items if
                "認証済み画面取得と実タップ: 成功" in label(node) or
                "画面操作を拒否:" in label(node)), None),
            "authenticated capture and tap outcome", seconds=35)
        if "認証済み画面取得と実タップ: 成功" not in label(outcome):
            accessibility_diagnostic("operation refused")
            raise AssertionError(f"Authenticated operation uncertain or refused: {label(outcome)!r}; "
                f"target={optional_text('対象タップ数: 1', exact=True) is not None}")
        wait_for_text("対象タップ数: 1")
        print("Android 15 VM: signed status gated actual Accessibility screenshot and tap", flush=True)
        from native_vm import verify_native
        # Extend the previous local diagnostic to the real video/DataChannel OS path.
        native_session = verify_native(owner_post, ready, device_id, session_id, viewer_token)
        readable, _, _ = select.select([fixture.stdout], [], [], 10)
        if not readable:
            raise AssertionError("Node did not receive Android's post-revocation status challenge")
        rejected = json.loads(fixture.stdout.readline())
        if rejected != {"event": "revoked-status-rejected", "deviceId": device_id,
                        "sessionId": native_session, "code": "DEVICE_UNAVAILABLE"}:
            raise AssertionError(f"Node did not reject revoked native session status: {rejected!r}")
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
    adb("install", "-r", "-t", PROBE_APK)
    verify_real_keystore_pairing()
    adb("shell", "am", "start", "-f", "0x10000000", "-n", f"{PACKAGE}/.MainActivity")
    wait_for_text("端末ID:")
    verify_accessibility_capture()
    tap_scrolled("手動入力を診断する")
    wait_for_text("画面取得と手動入力: 成功")
    print("Android 15 VM: local key, Accessibility screenshot and actual tap passed")


if __name__ == "__main__":
    main()
