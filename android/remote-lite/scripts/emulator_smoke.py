"""Check Accessibility screenshot and gesture via Android's visible setup UI."""

import re
import subprocess
import time
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


def wait_for_text(fragment, seconds=35):
    deadline = time.monotonic() + seconds
    last = []
    while time.monotonic() < deadline:
        try:
            last = nodes()
            found = next((node for node in last if fragment in label(node)), None)
            if found is not None:
                return found
        except (subprocess.CalledProcessError, ET.ParseError):
            pass
        time.sleep(1)
    visible_labels = [label(node) for node in last if label(node).strip()]
    bound = [line.strip() for line in adb("shell", "dumpsys", "accessibility").splitlines()
             if PACKAGE in line][:12]
    raise AssertionError(f"Missing UI text {fragment!r}; visible={visible_labels!r}; accessibility={bound!r}")


def tap_node(node):
    bounds = [int(value) for value in re.findall(r"\d+", node.get("bounds", ""))]
    if len(bounds) != 4:
        raise AssertionError(f"Missing UI bounds for {label(node)}")
    adb("shell", "input", "tap", str((bounds[0] + bounds[2]) // 2), str((bounds[1] + bounds[3]) // 2))


def tap_text(fragment):
    tap_node(wait_for_text(fragment))


def has_text(fragment):
    return any(fragment in label(node) for node in nodes())


def has_exact_text(value):
    return any(node.get("text", "").strip() == value for node in nodes())


def tap_exact_text(value):
    node = next(node for node in nodes() if node.get("text", "").strip() == value)
    tap_node(node)


def allow_accessibility_in_settings():
    # A sideloaded APK may require an extra confirmation on its App Info page.
    adb("shell", "am", "start", "-a", "android.settings.APPLICATION_DETAILS_SETTINGS",
        "-d", f"package:{PACKAGE}")
    wait_for_text("GORIQ Remote Lite")
    print(f"App Info controls: {visible()!r}", flush=True)
    if has_text("More options"):
        tap_text("More options")
        if has_text("Allow restricted settings"):
            tap_text("Allow restricted settings")
            if has_exact_text("Allow"):
                tap_exact_text("Allow")

    adb("shell", "am", "start", "-a", "android.settings.ACCESSIBILITY_SETTINGS")
    print(f"Accessibility controls: {visible()!r}", flush=True)
    for _ in range(4):
        if has_text("GORIQ Remote Lite 手動操作"):
            tap_text("GORIQ Remote Lite 手動操作")
            break
        if has_text("Downloaded apps"):
            tap_text("Downloaded apps")
            continue
        if has_text("Installed apps"):
            tap_text("Installed apps")
            continue
        raise AssertionError(f"Accessibility setup page unknown: {visible()!r}")
    else:
        raise AssertionError(f"Service missing from Accessibility settings: {visible()!r}")

    switches = [node for node in nodes() if "Switch" in node.get("class", "")]
    if not switches:
        raise AssertionError(f"Accessibility service switch missing: {visible()!r}")
    switch = switches[0]
    if switch.get("checked") != "true":
        tap_node(switch)
        if has_exact_text("Allow"):
            tap_exact_text("Allow")
    adb("shell", "am", "start", "-n", f"{PACKAGE}/.MainActivity")


def main():
    adb("install", "-r", APK)
    allow_accessibility_in_settings()
    wait_for_text("端末ID:")
    tap_text("画面取得を診断する")
    wait_for_text("画面取得:")
    tap_text("手動入力を診断する")
    wait_for_text("画面取得と手動入力: 成功")
    print("Android 15 VM: local key, Accessibility screenshot and actual tap passed")


if __name__ == "__main__":
    main()
