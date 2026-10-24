import unittest

from native_vm import window_is_drawn


COMPONENT = "app.goriq.remote.lite/app.goriq.remote.lite.LicenseActivity"


def window(component=COMPONENT, draw="HAS_DRAWN", surface="true", ready="true", visible="true"):
    return (f"  Window #7 Window{{test u0 {component}}}:\n"
        f"    mHasSurface={surface} isReadyForDisplay()={ready}\n"
        f"      Surface: shown=true mDrawState={draw}\n"
        f"    isVisible={visible}\n")


class WindowReadinessTest(unittest.TestCase):
    def test_target_itself_must_be_drawn(self):
        wallpaper = window("com.android.systemui/.ImageWallpaper")
        # Global dump footer can name the target after the unrelated wallpaper.
        dump = window(draw="DRAW_PENDING", ready="false") + wallpaper + f"  mFocusedApp={COMPONENT}\n"
        self.assertFalse(window_is_drawn(dump, COMPONENT))

    def test_all_target_readiness_flags_are_required(self):
        for flags in ({"surface": "false"}, {"ready": "false"}, {"visible": "false"},
                      {"draw": "NO_SURFACE"}, {"draw": "DRAW_PENDING"}):
            with self.subTest(flags=flags):
                self.assertFalse(window_is_drawn(window(**flags), COMPONENT))

    def test_exact_visible_target_drawn(self):
        self.assertTrue(window_is_drawn("WINDOW MANAGER WINDOWS\n" + window(), COMPONENT))
        self.assertFalse(window_is_drawn(window(COMPONENT + "Other"), COMPONENT))
        self.assertFalse(window_is_drawn("", COMPONENT))


if __name__ == "__main__":
    unittest.main()
