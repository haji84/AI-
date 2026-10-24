//go:build windows

package winbridge

import (
	"errors"
	"testing"
	"time"
	"unsafe"
)

func pointerFixture(t *testing.T) (*Bridge, *[]uint32) {
	t.Helper()
	flags := []uint32{}
	b := &Bridge{
		desktopFn: func() bool { return true },
		screenFn:  func() (rect, error) { return rect{0, 0, 1920, 1080}, nil },
		sendFn: func(inputs []winInput) error {
			for _, input := range inputs {
				if input.Kind == mouseInputType {
					flags = append(flags, (*mouseData)(unsafe.Pointer(&input.Data[0])).Flags)
				}
			}
			return nil
		},
	}
	if err := b.AuthorizeLocalUse(time.Now().Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	return b, &flags
}

func TestStopReleasesHeldPointerExactlyOnce(t *testing.T) {
	b, flags := pointerFixture(t)
	if err := b.Apply(Command{Action: "pointer", Phase: "down", Button: "left", X: .5, Y: .5}); err != nil {
		t.Fatal(err)
	}
	if err := b.Stop(); err != nil {
		t.Fatal(err)
	}
	if err := b.Stop(); err != nil {
		t.Fatal(err)
	}
	up := 0
	for _, flag := range *flags {
		if flag == mouseLeftUp {
			up++
		}
	}
	if up != 1 || b.heldLeft || !b.closed {
		t.Fatalf("stop must release once: up=%d held=%v closed=%v", up, b.heldLeft, b.closed)
	}
}

func TestExpiredConsentReleasesHeldPointer(t *testing.T) {
	b, flags := pointerFixture(t)
	if err := b.Apply(Command{Action: "pointer", Phase: "down", Button: "right", X: .5, Y: .5}); err != nil {
		t.Fatal(err)
	}
	b.grantedUntil = time.Now().Add(-time.Second)
	if err := b.Apply(Command{Action: "pointer", Phase: "move", Button: "right", X: .6, Y: .6}); err == nil {
		t.Fatal("expired consent accepted input")
	}
	up := 0
	for _, flag := range *flags {
		if flag == mouseRightUp {
			up++
		}
	}
	if up != 1 || b.heldRight {
		t.Fatalf("expired consent must release: up=%d held=%v", up, b.heldRight)
	}
}

func TestReleaseFailureDoesNotClaimButtonCleared(t *testing.T) {
	b, _ := pointerFixture(t)
	b.heldLeft = true
	b.sendFn = func([]winInput) error { return errors.New("SendInput failed") }
	if err := b.Stop(); err == nil {
		t.Fatal("failed release must be reported")
	}
	if !b.heldLeft {
		t.Fatal("failed release must remain observable")
	}
}

func TestStopReportsProtectedDesktopWithoutSendingInput(t *testing.T) {
	b, _ := pointerFixture(t)
	b.heldLeft = true
	b.desktopFn = func() bool { return false }
	sent := false
	b.sendFn = func([]winInput) error { sent = true; return nil }
	if err := b.Stop(); err == nil || !b.heldLeft || sent {
		t.Fatal("protected desktop release must remain unconfirmed without SendInput")
	}
}

func TestStoppedHostRetriesOnlyReleaseWhenDesktopReturns(t *testing.T) {
	b, _ := pointerFixture(t)
	b.heldLeft = true
	checks, sent := 0, []uint32{}
	b.desktopFn = func() bool { checks++; return checks >= 3 }
	b.sendFn = func(inputs []winInput) error {
		for _, input := range inputs {
			sent = append(sent, (*mouseData)(unsafe.Pointer(&input.Data[0])).Flags)
		}
		return nil
	}
	if err := b.Stop(); err == nil {
		t.Fatal("initial protected desktop must prevent release")
	}
	if err := b.WaitForRelease(2 * time.Second); err != nil {
		t.Fatal(err)
	}
	if b.heldLeft || len(sent) != 1 || sent[0] != mouseLeftUp {
		t.Fatalf("retry must send only left UP: held=%v flags=%v", b.heldLeft, sent)
	}
	if err := b.Apply(Command{Action: "tap", X: .5, Y: .5}); err == nil {
		t.Fatal("stop must never restore input consent")
	}
}

func TestPartialKeyboardBatchReleasesDownKeys(t *testing.T) {
	for _, command := range []Command{{Action: "key", Key: "ENTER"}, {Action: "text", Text: "Ab"}} {
		b, _ := pointerFixture(t)
		calls, cleanupUps := 0, 0
		b.sendFn = func(inputs []winInput) error {
			calls++
			if calls == 1 {
				return errors.New("partial keyboard batch")
			}
			for _, input := range inputs {
				if input.Kind == keyboardInputType && (*keyData)(unsafe.Pointer(&input.Data[0])).Flags&keyUp != 0 {
					cleanupUps++
				}
			}
			return nil
		}
		if err := b.Apply(command); err == nil {
			t.Fatalf("partial batch must fail: %v", command.Action)
		}
		if calls != 2 || cleanupUps == 0 || len(b.pendingKeyUps) != 0 {
			t.Fatalf("keyboard cleanup failed for %s: calls=%d ups=%d pending=%d", command.Action, calls, cleanupUps, len(b.pendingKeyUps))
		}
		if err := b.Stop(); err != nil {
			t.Fatal(err)
		}
	}
}

func TestHeldPointerWatchdogReleasesWithoutNextRequest(t *testing.T) {
	b, flags := pointerFixture(t)
	b.holdDuration = 20 * time.Millisecond
	defer b.Stop()
	if err := b.Apply(Command{Action: "pointer", Phase: "down", Button: "left", X: .5, Y: .5}); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		b.mu.Lock()
		released := !b.heldLeft
		b.mu.Unlock()
		if released {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	up := 0
	for _, flag := range *flags {
		if flag == mouseLeftUp {
			up++
		}
	}
	if b.heldLeft || up != 1 {
		t.Fatalf("watchdog must release held button: held=%v up=%d", b.heldLeft, up)
	}
}

func TestPartialSendInputFailureAttemptsButtonRelease(t *testing.T) {
	b, _ := pointerFixture(t)
	defer b.Stop()
	calls := 0
	badCleanup := false
	b.sendFn = func(inputs []winInput) error {
		calls++
		if calls == 1 {
			return errors.New("partial SendInput")
		}
		if len(inputs) != 1 || (*mouseData)(unsafe.Pointer(&inputs[0].Data[0])).Flags != mouseLeftUp {
			badCleanup = true
		}
		return nil
	}
	if err := b.Apply(Command{Action: "pointer", Phase: "down", Button: "left", X: .5, Y: .5}); err == nil {
		t.Fatal("partial SendInput must be an error")
	}
	if calls != 2 || b.heldLeft || badCleanup {
		t.Fatalf("cleanup failed: calls=%d held=%v badInput=%v", calls, b.heldLeft, badCleanup)
	}
}
