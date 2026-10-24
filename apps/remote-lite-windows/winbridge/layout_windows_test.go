//go:build windows

package winbridge

import (
	"testing"
	"unsafe"
)

func TestWindowsInputABI(t *testing.T) {
	if size := unsafe.Sizeof(winInput{}); size != 40 {
		t.Fatalf("INPUT requires 40 bytes on Windows amd64, got %d", size)
	}
	if size := unsafe.Sizeof(mouseData{}); size != 32 {
		t.Fatalf("MOUSEINPUT requires 32 bytes on Windows amd64, got %d", size)
	}
	if size := unsafe.Sizeof(keyData{}); size != 24 {
		t.Fatalf("KEYBDINPUT requires 24 bytes on Windows amd64, got %d", size)
	}
}
