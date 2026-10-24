package app.goriq.remote.vmprobe;

import android.app.Instrumentation;
import android.app.UiAutomation;
import android.graphics.Rect;
import android.os.Bundle;
import android.os.SystemClock;
import android.util.Xml;
import android.view.accessibility.AccessibilityNodeInfo;
import java.io.StringWriter;
import org.xmlpull.v1.XmlSerializer;

/** VM-only read-only hierarchy probe. Never linked into the distributable app. */
public final class HierarchyProbe extends Instrumentation {
    private int count;

    @Override public void onCreate(Bundle arguments) {
        super.onCreate(arguments);
        start();
    }

    @Override public void onStart() {
        Bundle result = new Bundle();
        try {
            // Default UiAutomation (including CLI dump) suppresses the service being tested.
            UiAutomation automation = getUiAutomation(UiAutomation.FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES);
            if (automation == null) throw new IllegalStateException("UI automation unavailable");
            // A fresh automation connection has not necessarily observed the focused window yet.
            try { automation.waitForIdle(100, 2_000); }
            catch (java.util.concurrent.TimeoutException ignored) { /* A busy UI can still have a root. */ }
            AccessibilityNodeInfo root = null;
            long deadline = SystemClock.elapsedRealtime() + 3_000;
            while (root == null && SystemClock.elapsedRealtime() < deadline) {
                root = automation.getRootInActiveWindow();
                if (root == null) SystemClock.sleep(50);
            }
            if (root == null) {
                result.putString("probe_error", "WINDOW_NOT_READY");
                finish(1, result);
                return;
            }
            StringWriter output = new StringWriter();
            XmlSerializer xml = Xml.newSerializer();
            xml.setOutput(output);
            xml.startTag(null, "hierarchy");
            try { writeNode(xml, root, 0); } finally { root.recycle(); }
            xml.endTag(null, "hierarchy");
            xml.flush();
            if (output.getBuffer().length() > 400_000) throw new IllegalStateException("Hierarchy too large");
            result.putString("hierarchy", output.toString());
            finish(0, result);
        } catch (Exception failure) {
            result.putString("probe_error", failure.getClass().getSimpleName() + ": " + failure.getMessage());
            finish(1, result);
        }
    }

    private void writeNode(XmlSerializer xml, AccessibilityNodeInfo node, int depth) throws Exception {
        if (++count > 2000 || depth > 60) throw new IllegalStateException("Hierarchy limit");
        Rect bounds = new Rect();
        node.getBoundsInScreen(bounds);
        xml.startTag(null, "node");
        xml.attribute(null, "text", text(node.getText()));
        xml.attribute(null, "content-desc", text(node.getContentDescription()));
        xml.attribute(null, "class", text(node.getClassName()));
        xml.attribute(null, "bounds", bounds.toShortString());
        xml.attribute(null, "enabled", Boolean.toString(node.isEnabled()));
        xml.attribute(null, "checked", Boolean.toString(node.isChecked()));
        for (int index = 0; index < node.getChildCount(); index++) {
            AccessibilityNodeInfo child = node.getChild(index);
            if (child == null) continue;
            try { if (child.isVisibleToUser()) writeNode(xml, child, depth + 1); }
            finally { child.recycle(); }
        }
        xml.endTag(null, "node");
    }

    private String text(CharSequence value) {
        if (value == null) return "";
        String string = value.toString();
        if (string.length() > 12_000) throw new IllegalStateException("Node text limit");
        return string.replaceAll("[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F]", "");
    }
}
