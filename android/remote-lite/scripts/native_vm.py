"""Real Android MediaProjection -> separate Chromium -> Accessibility, local TURN only."""

import json
import os
from pathlib import Path
import re
import socket
import subprocess
import time
import urllib.request
import urllib.error


def window_is_drawn(window_dump, component):
    # A resumed activity can still have NO_SURFACE/DRAW_PENDING. Match its own
    # window header, not another ready window or a later mFocusedApp reference.
    for block in re.split(r"(?m)(?=^[ \t]*Window #\d+ )", window_dump):
        if not re.match(r"[ \t]*Window #\d+ Window\{[^\n]* " + re.escape(component) + r"\}:", block):
            continue
        return all(re.search(pattern, block) for pattern in (
            r"\bmHasSurface=true\b", r"\bisReadyForDisplay\(\)=true\b",
            r"\bmDrawState=HAS_DRAWN\b", r"\bisVisible=true\b"))
    return False


class Browser:
    def __init__(self, ready):
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            port = probe.getsockname()[1]
        self.url = f"http://127.0.0.1:{port}"
        self.session = None
        self.log = open("android/remote-lite/app/build/chromedriver.log", "w+")
        self.driver = subprocess.Popen([os.environ.get("REMOTE_LITE_CHROMEDRIVER", "chromedriver"),
            f"--port={port}", "--allowed-ips=127.0.0.1", "--verbose"], stdout=self.log, stderr=self.log)
        try:
            for _ in range(40):
                try:
                    self.call("GET", "/status")
                    break
                except (OSError, ValueError):
                    time.sleep(.25)
            options = {"args": ["--headless=new", "--autoplay-policy=no-user-gesture-required",
                "--ignore-certificate-errors-spki-list=" + ready["spki"]]}
            if os.environ.get("REMOTE_LITE_CHROME"):
                options["binary"] = os.environ["REMOTE_LITE_CHROME"]
            self.session = self.call("POST", "/session", {"capabilities": {"alwaysMatch": {
                "browserName": "chrome", "goog:chromeOptions": options}}})["sessionId"]
            self.call("POST", f"/session/{self.session}/timeouts", {"script": 30000})
            self.navigate(ready["origin"] + "/vm/viewer")
            self.until("return window.vm?.ready === true", "viewer module load")
            self.script("window.configureVmIce(arguments[0]); return true", ready["turnIceServers"])
        except Exception:
            self.log.flush()
            self.log.seek(0)
            print("ChromeDriver startup diagnostics: " + self.log.read()[-5000:], flush=True)
            self.close()
            raise

    def call(self, method, path, payload=None):
        request = urllib.request.Request(self.url + path, method=method,
            data=None if payload is None else json.dumps(payload).encode(),
            headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(request, timeout=35) as response:
                result = json.load(response)["value"]
        except urllib.error.HTTPError as failure:
            detail = failure.read(8000).decode("utf-8", errors="replace")
            raise AssertionError(f"WebDriver {method} {path} HTTP{failure.code}: {detail}") from failure
        if isinstance(result, dict) and result.get("error"):
            raise AssertionError(f"WebDriver failed: {result}")
        return result

    def script(self, code, *args, asynchronous=False):
        return self.call("POST", f"/session/{self.session}/execute/" + ("async" if asynchronous else "sync"),
            {"script": code, "args": list(args)})

    def navigate(self, url):
        self.call("POST", f"/session/{self.session}/url", {"url": url})

    def until(self, code, description, seconds=35, require_live=False):
        deadline = time.monotonic() + seconds
        result = None
        while time.monotonic() < deadline:
            result = self.script(code)
            if result:
                return result
            if require_live:
                snapshot = self.stats()
                assert not snapshot["closed"], f"Native RTC ended before {description}: " + json.dumps(snapshot)
            time.sleep(.2)
        raise AssertionError(f"Browser missing {description}; last={result}; state=" +
            str(self.script("return {state:window.vm?.state, errors:window.vm?.errors}")))

    def stats(self):
        return self.script("const done=arguments[arguments.length-1]; window.vm.stats().then(done)", asynchronous=True)

    def close(self):
        try:
            if self.session:
                self.call("DELETE", f"/session/{self.session}")
        finally:
            self.driver.terminate()
            try:
                self.driver.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.driver.kill()
                self.driver.wait(timeout=5)
            self.log.close()


def turn_arguments(log_path):
    return [os.environ["REMOTE_LITE_TURNSERVER"], "-n", "--verbose",
        "--listening-ip=127.0.0.1", "--relay-ip=127.0.0.1", "--listening-port=43478",
        "--min-port=50000", "--max-port=50100", "--realm=remote-lite-vm",
        "--use-auth-secret", "--static-auth-secret=public-vm-turn-secret-never-a-production-secret-1831", "--userdb=:memory:",
        "--no-tls", "--no-dtls", "--no-cli", "--no-multicast-peers", "--allow-loopback-peers",
        "--log-file=stdout", "--simple-log", "--pidfile=" + str(log_path.with_suffix(".pid"))]


def wait_turn(turn, log_path):
    for _ in range(30):
        if turn.poll() is not None:
            raise AssertionError("Loopback TURN exited: " + log_path.read_text()[-2000:])
        try:
            with socket.create_connection(("127.0.0.1", 43478), timeout=.2):
                return
        except OSError:
            time.sleep(.2)
    raise AssertionError("Loopback TURN listener did not start")


def verify_native(owner_post, ready, device_id, old_session, old_token):
    # Import the already-running smoke module without executing main again.
    import emulator_smoke as ui
    adb = ui.adb
    ended = owner_post("/v1/viewer/end", {"sessionId": old_session, "viewerToken": old_token})
    assert ended.get("ok"), ended
    log_path = Path("android/remote-lite/app/build/turnserver.log")
    with log_path.open("w") as log:
        turn = subprocess.Popen(turn_arguments(log_path), stdout=log, stderr=log)
        browser = None
        try:
            wait_turn(turn, log_path)
            browser = Browser(ready)

            def projection_released():
                projection = adb("shell", "dumpsys", "media_projection")
                if not re.search(r"Media Projection:\s*null\b", projection):
                    raise AssertionError("OS still has a MediaProjection grant: " + projection[-2000:])
                print("Android OS confirms Media Projection: null", flush=True)

            def new_session():
                started = owner_post("/v1/start", {"deviceId": device_id})
                assert started.get("ok"), started
                session = started["result"]
                adb("shell", "am", "start", "-W", "-n", f"{ui.PACKAGE}/.MainActivity")
                ui.tap_scrolled("画面共有の設定を開く")
                ui.tap_text("接続要求を確認する")
                ui.wait_for_text("セッションID: " + session["sessionId"])
                ui.tap_scrolled("このセッションへ画面を共有する")
                # Notification permission may appear after the first hierarchy read.
                # Wait for either OS dialog instead of treating a short absence as a grant.
                dialog_deadline = time.monotonic() + 35
                for attempt in range(1, 5):
                    consent = ui.wait_for_nodes(lambda items: next((node for node in items if
                        node.get("text", "").strip() in ("Allow", "Start", "Start now", "Start recording", "Share screen")), None),
                        "OS notification or full-display MediaProjection confirmation",
                        seconds=max(1, dialog_deadline - time.monotonic()))
                    notification = consent.get("text", "").strip() == "Allow"
                    if notification and attempt > 3:
                        raise AssertionError("Notification permission did not close after three visible UI taps")
                    ui.tap_node(consent)
                    if not notification:
                        break
                    print(f"Android OS notification Allow tapped {attempt}/3", flush=True)
                else:
                    raise AssertionError("OS MediaProjection confirmation not reached")
                ui.wait_for_text("画面共有を開始しました", seconds=35)
                projection = adb("shell", "dumpsys", "media_projection")
                assert ui.PACKAGE in projection, "OS capture grant not present: " + projection[-1500:]
                browser.navigate(ready["origin"] + "/vm/viewer")
                browser.until("return window.vm?.ready === true", "viewer reload")
                browser.script("window.configureVmIce(arguments[0]); return true", ready["turnIceServers"])
                result = browser.script("const done=arguments[arguments.length-1]; "
                    "window.beginNative(arguments[0]).then(()=>done('started'),e=>done(String(e)))",
                    {"sessionId": session["sessionId"], "viewerToken": session["viewerToken"], "bridge": ready["bridge"]},
                    asynchronous=True)
                assert result == "started", result
                deadline = time.monotonic() + 40
                while time.monotonic() < deadline:
                    stats = browser.stats()
                    if stats["width"] > 0 and stats["decoded"] >= 3 and stats.get("localType") == "relay" and stats.get("remoteType") == "relay":
                        print("Android native decoded video via forced loopback TURN: " + json.dumps(stats), flush=True)
                        return session
                    time.sleep(.5)
                raise AssertionError("Native media not decoded/relayed: " + json.dumps(stats))

            def scroll_target(fragment):
                # Scroll the local setup UI only. The target itself is pressed exclusively over RTC.
                for _ in range(6):
                    target = ui.optional_text(fragment, seconds=2)
                    if target is not None:
                        bounds = [int(v) for v in re.findall(r"\d+", target.get("bounds", ""))]
                        if len(bounds) == 4 and bounds[3] > bounds[1]:
                            return target, bounds
                    adb("shell", "input", "swipe", "160", "550", "160", "180", "250")
                raise AssertionError("Real tap target not visible")

            def command_at(bounds):
                size = re.findall(r"(\d+)x(\d+)", adb("shell", "wm", "size"))[-1]
                return {"action": "tap", "x": (bounds[0] + bounds[2]) / 2 / int(size[0]),
                    "y": (bounds[1] + bounds[3]) / 2 / int(size[1])}

            def queued_taps(bounds, expected=3):
                browser.script("window.vm.send(arguments[0]); window.vm.send(arguments[0]); return true", command_at(bounds))
                browser.until(f"return window.vm.acknowledged === {expected}", "two queued same-window taps without screenshot throttling", require_live=True)
                ui.wait_for_text("入力テスト: 3")
                print(f"Android native two rapid same-window taps paced fresh proofs, actual count=3/ACK={expected}", flush=True)

            def real_tap(rapid=True):
                _, bounds = scroll_target("この画面の入力テスト対象")
                counter = ui.wait_for_text("入力テスト: 0")
                counter_bounds = [int(v) for v in re.findall(r"\d+", counter.get("bounds", ""))]
                # Sample the counter background away from glyphs, after the scroll settles in video.
                size = re.findall(r"(\d+)x(\d+)", adb("shell", "wm", "size"))[-1]
                sample = ((counter_bounds[2] - 8) / int(size[0]), (counter_bounds[1] + 8) / int(size[1]))
                time.sleep(1)
                before = browser.script("return window.vm.pixel(arguments[0],arguments[1])", *sample)
                began = time.monotonic()
                browser.script("window.vm.send(arguments[0]); return true", command_at(bounds))
                browser.until("return window.vm.acknowledged === 1", "actual OS input ACK", require_live=True)
                elapsed = time.monotonic() - began
                ui.wait_for_text("入力テスト: 1")
                deadline = time.monotonic() + 10
                while time.monotonic() < deadline:
                    after = browser.script("return window.vm.pixel(arguments[0],arguments[1])", *sample)
                    if after[1] > after[0] * 1.5 and after[1] > after[2] * 1.3:
                        break
                    time.sleep(.2)
                else:
                    raise AssertionError(f"Real screen pixel change absent: {before} -> {after}")
                print(f"Android native actual Accessibility tap + ACK + decoded pixel change: latency={elapsed:.3f}s {before}->{after}", flush=True)
                if rapid:
                    queued_taps(bounds)
                return bounds

            def swipe_and_idle():
                # The sharing activity redraws its frame counter every 500 ms.
                # Use the existing static license screen so it cannot mask idle capture gaps.
                ui.tap_scrolled("ライセンスを表示する")
                # Its full third-party notice text exceeds the VM hierarchy probe's
                # 12KB node limit. Resumed is too early: the first layout can still
                # be DRAW_PENDING. Require its actual drawn OS window, then a new
                # received frame, before taking the first swipe's pixel baseline.
                began = time.monotonic()
                deadline = time.monotonic() + 20
                while time.monotonic() < deadline:
                    if window_is_drawn(adb("shell", "dumpsys", "window", "windows"),
                            f"{ui.PACKAGE}/{ui.PACKAGE}.LicenseActivity"):
                        break
                    time.sleep(.2)
                else:
                    raise AssertionError("Static license window did not become drawn/visible")
                ready = browser.stats()
                deadline = time.monotonic() + 10
                while time.monotonic() < deadline:
                    snapshot = browser.stats()
                    assert not snapshot["closed"], "Native RTC ended before drawn-window video: " + json.dumps(snapshot)
                    if (snapshot["frameCallbacks"] > ready["frameCallbacks"] and
                            snapshot["frameAgeMs"] is not None and snapshot["frameAgeMs"] < 2000):
                        break
                    time.sleep(.2)
                else:
                    raise AssertionError("No fresh received frame after static window became drawn")
                print(f"Android VM static target drawn + fresh received frame in {time.monotonic() - began:.3f}s", flush=True)
                for index in range(4):
                    time.sleep(1)
                    browser.script("window.vm.markContent(); return true")
                    decoded = browser.stats()["decoded"]
                    y1, y2 = (.75, .3) if index % 2 == 0 else (.3, .75)
                    began = time.monotonic()
                    browser.script("window.vm.send(arguments[0]); return true", {
                        "action": "swipe", "x1": .5, "y1": y1, "x2": .5, "y2": y2, "durationMs": 250})
                    expected = 2 + index
                    browser.until(f"return window.vm.acknowledged === {expected}", f"swipe {index + 1}/4 OS input ACK", require_live=True)
                    deadline = time.monotonic() + 10
                    while time.monotonic() < deadline:
                        changed = browser.script("return window.vm.contentChange()")
                        if changed > .02 and browser.stats()["decoded"] > decoded:
                            break
                        time.sleep(.2)
                    else:
                        raise AssertionError(f"Swipe {index + 1}/4 acknowledged but received content did not change")
                    print(f"Android native swipe {index + 1}/4 ACK={expected} + decoded app-content change "
                        f"{changed:.1%} in {time.monotonic() - began:.3f}s", flush=True)
                # Observe real compositor callbacks, not a transport heartbeat/currentTime.
                # Defer the freshness assertion until existing secure/revoke checks also finish.
                time.sleep(1)
                browser.script("window.vm.beginIdleObservation(); return true")
                start = browser.stats()
                maximum_gap = 0
                deadline = time.monotonic() + 10
                while True:
                    snapshot = browser.stats()
                    assert not snapshot["closed"], "Native RTC ended while license screen was idle: " + json.dumps(snapshot)
                    assert snapshot["frameAgeMs"] is not None, "No native video presentation callback"
                    maximum_gap = max(maximum_gap, snapshot["maxIdleFrameGapMs"])
                    if time.monotonic() >= deadline:
                        break
                    time.sleep(.2)
                print("Android native static-screen observation: " + json.dumps({
                    "seconds": 10, "maxFrameAgeMs": maximum_gap,
                    "callbackDelta": snapshot["frameCallbacks"] - start["frameCallbacks"],
                    "decodedDelta": snapshot["decoded"] - start["decoded"]}), flush=True)
                # Read bounded fixed numeric diagnostics before later session logs
                # displace them. No screenshot, coordinates, identity or token.
                capture_log = adb("shell", "logcat", "-d", "-s", "RemoteLiteNative:I", "*:S")
                observations = [line for line in capture_log.splitlines()
                    if "idle-capture-observation:" in line or "idle-display-refresh-requested" in line]
                print("Android native capture-side idle observations:\n" + "\n".join(observations[-25:]), flush=True)
                adb("shell", "input", "keyevent", "4")
                ui.wait_for_text("入力テスト: 1")
                return maximum_gap

            new_session()
            real_tap(rapid=False)
            idle_frame_gap = swipe_and_idle()
            # Keep the rapid-input assertion, after static media observation so
            # independent queue latency cannot hide the capture experiment.
            _, bounds = scroll_target("この画面の入力テスト対象")
            queued_taps(bounds, expected=7)
            adb("shell", "am", "start", "-W", "-n", f"{ui.PACKAGE}/.SecureTestActivity")
            target = ui.wait_for_text("Secure target taps: 0")
            secure_bounds = [int(v) for v in re.findall(r"\d+", target.get("bounds", ""))]
            browser.script("window.vm.send(arguments[0]); return true", command_at(secure_bounds))
            browser.until("return window.vm.state === 'connection-lost' || window.vm.state === 'control-channel-closed' || "
                "window.vm.state === 'control-channel-failed' || window.vm.state === 'fixture-signaling-ended'", "secure input refusal")
            assert browser.stats()["acknowledged"] == 7, "Secure input was acknowledged"
            ui.wait_for_text("Secure target taps: 0")
            print("Android native secure-window input refused with no OS target tap or ACK", flush=True)
            # Observe final capture cleanup before a new consent/session; no force-stop workaround.
            adb("shell", "input", "keyevent", "4")
            ui.wait_for_text("入力結果を確認できないため停止しました", seconds=35)
            projection_released()

            second = new_session()
            bounds = real_tap()
            # Keep established RTC/channel alive across owner revocation; no viewer-side stop shortcut.
            browser.script("window.vm.pausePolling=true; return true")
            revoked_at = time.monotonic()
            revoked = owner_post("/v1/revoke", {"deviceId": device_id})
            assert revoked.get("ok") and revoked["result"]["status"] == "revoked", revoked
            # Either signed worker can stop first. Require the actual Android-driven
            # channel closure AND OS projection release, not a race-dependent label.
            deadline = revoked_at + 12
            while time.monotonic() < deadline:
                closed = browser.stats()["closed"]
                projection = adb("shell", "dumpsys", "media_projection")
                if closed and re.search(r"Media Projection:\s*null\b", projection):
                    break
                time.sleep(.2)
            else:
                raise AssertionError("Revoked Android did not close RTC and release OS capture: " +
                    json.dumps(browser.stats()) + projection[-1500:])
            elapsed = time.monotonic() - revoked_at
            assert elapsed < 12, f"Native cleanup exceeded bounded VM deadline: {elapsed}"
            projection_released()
            # A longer stop/end-unconfirmed explanation can move the counter
            # below the viewport. Inspect it by local scrolling only, after the
            # Android-driven RTC/capture shutdown has already been asserted.
            scroll_target("入力テスト: 3")
            snapshot = browser.stats()
            time.sleep(2)
            later = browser.stats()
            assert later["decoded"] == snapshot["decoded"] and later["acknowledged"] == 3, (snapshot, later)
            result = browser.script("try {window.vm.send(arguments[0]); return 'sent';} catch {return 'refused';}", command_at(bounds))
            assert result == "refused", result
            scroll_target("入力テスト: 3")
            print(f"Android native owner revoke stopped actual video/input and released capture in {elapsed:.3f}s: " + json.dumps(later), flush=True)
            assert idle_frame_gap < 4000, ("Native static-screen frame gap exceeds the production owner's four-second "
                f"stop threshold: {idle_frame_gap:.0f}ms; standalone RTC success is not product acceptance")
            return second["sessionId"]
        except Exception:
            # VM-only read-only geometry, captured immediately on channel loss.
            # Never dump the license's huge text tree to establish window readiness.
            try:
                print("VM display size: " + adb("shell", "wm", "size"), flush=True)
                window_dump = adb("shell", "dumpsys", "window", "windows")
                geometry = [line for line in window_dump.splitlines() if re.search(
                    r"Window #|mCurrentFocus|mFocusedApp|mDisplayId|mHasSurface|mViewVisibility|mFrame=|Frames:|mWindowFrames|DrawState|isReadyForDisplay|isVisible=", line)]
                print("VM window geometry at failure:\n" + "\n".join(geometry[-100:]), flush=True)
            except Exception as diagnostic_error:
                print("VM geometry diagnostic unavailable: " + type(diagnostic_error).__name__, flush=True)
            print("Native diagnostics: " + adb("shell", "logcat", "-d", "-s",
                "RemoteLiteNative:I", "RemoteLiteLifecycle:I", "AndroidRuntime:E", "libc:F", "libjingle:V", "org.webrtc.Logging:V",
                "NetworkMonitor:V", "NetworkMonitorAutoDetect:V", "*:S")[-12000:], flush=True)
            try:
                print("Android visible controls: " + str(ui.visible()), flush=True)
            except Exception as diagnostic_error:
                print("Android hierarchy diagnostic unavailable: " + type(diagnostic_error).__name__, flush=True)
            print("TURN diagnostics: " + log_path.read_text()[-3500:], flush=True)
            raise
        finally:
            if browser:
                browser.close()
            turn.terminate()
            try:
                turn.wait(timeout=5)
            except subprocess.TimeoutExpired:
                turn.kill()
                turn.wait(timeout=5)


if __name__ == "__main__":
    # Fail browser/TLS setup early, before the slower emulator acceptance stage.
    fixture = subprocess.Popen(["node", "android/remote-lite/scripts/pairing_fixture.mjs"],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    browser = None
    log_path = Path("android/remote-lite/app/build/turn-preflight.log")
    log = log_path.open("w")
    turn = subprocess.Popen(turn_arguments(log_path), stdout=log, stderr=log)
    try:
        wait_turn(turn, log_path)
        ready = json.loads(fixture.stdout.readline())
        browser = Browser(ready)
        print("PASS separate Chromium process and pinned loopback TLS viewer preflight", flush=True)
        relay = browser.script("const done=arguments[arguments.length-1]; window.probeRelay().then(done)", asynchronous=True)
        assert "relay" in relay["candidates"], "Browser did not obtain TURN allocation: " + json.dumps(relay)
        print("PASS actual browser loopback TURN allocation: " + json.dumps(relay), flush=True)
        denied = browser.script("const done=arguments[arguments.length-1]; window.probeRelay('invalid-vm-credential').then(done)", asynchronous=True)
        assert "relay" not in denied["candidates"], "TURN accepted an invalid fixture credential"
        print("PASS loopback TURN refused allocation with invalid credential", flush=True)
    finally:
        if browser:
            browser.close()
        fixture.terminate()
        try:
            fixture.communicate(timeout=5)
        except subprocess.TimeoutExpired:
            fixture.kill()
            fixture.communicate()
        turn.terminate()
        try:
            turn.wait(timeout=5)
        except subprocess.TimeoutExpired:
            turn.kill(); turn.wait(timeout=5)
        log.close()
