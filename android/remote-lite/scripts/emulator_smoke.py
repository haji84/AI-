"""Check real Accessibility screenshot and gesture dispatch inside an Android VM.

The emulator's secure setting enables the test service only inside this disposable VM.
The distributable app itself never grants Accessibility permission.
"""

import re
import subprocess
import time
import xml.etree.ElementTree as ET


PACKAGE = "app.goriq.remote.lite"
SERVICE = f"{PACKAGE}/{PACKAGE}.ManualAccessibilityService"
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


def wait_for_text(fragment, seconds=35):
    deadline = time.monotonic() + seconds
    last = []
    while time.monotonic() < deadline:
        try:
            last = nodes()
            found = next((node for node in last if fragment in node.get("text", "")), None)
            if found is not None:
                return found
        except (subprocess.CalledProcessError, ET.ParseError):
            pass
        time.sleep(1)
    visible = [node.get("text", "") for node in last if node.get("text")]
    bound = [line.strip() for line in adb("shell", "dumpsys", "accessibility").splitlines()
             if PACKAGE in line][:12]
    raise AssertionError(f"Missing UI text {fragment!r}; visible={visible!r}; accessibility={bound!r}")


def tap_text(fragment):
    node = wait_for_text(fragment)
    bounds = [int(value) for value in re.findall(r"\d+", node.get("bounds", ""))]
    if len(bounds) != 4:
        raise AssertionError(f"Missing UI bounds for {fragment}")
    adb("shell", "input", "tap", str((bounds[0] + bounds[2]) // 2), str((bounds[1] + bounds[3]) // 2))


def main():
    adb("install", "-r", APK)
    adb("shell", "settings", "put", "secure", "enabled_accessibility_services", SERVICE)
    adb("shell", "settings", "put", "secure", "accessibility_enabled", "1")
    adb("shell", "am", "start", "-n", f"{PACKAGE}/.MainActivity")
    wait_for_text("端末ID:")
    tap_text("画面取得を診断する")
    wait_for_text("画面取得:")
    tap_text("手動入力を診断する")
    wait_for_text("画面取得と手動入力: 成功")
    print("Android 15 VM: local key, Accessibility screenshot and actual tap passed")


if __name__ == "__main__":
    main()
