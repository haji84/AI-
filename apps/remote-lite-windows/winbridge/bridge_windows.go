//go:build windows

// Package winbridge provides screen snapshots and bounded manual input on the
// currently signed-in Windows user's interactive desktop. It opens no sockets
// and does not evade screen lock, UAC, protected desktops or OS policy.
package winbridge

import (
	"bytes"
	"errors"
	"image"
	"image/jpeg"
	"math"
	"sync"
	"syscall"
	"time"
	"unicode/utf16"
	"unsafe"
)

var (
	user32                 = syscall.NewLazyDLL("user32.dll")
	gdi32                  = syscall.NewLazyDLL("gdi32.dll")
	getSystemMetrics       = user32.NewProc("GetSystemMetrics")
	getDC                  = user32.NewProc("GetDC")
	releaseDC              = user32.NewProc("ReleaseDC")
	createCompatibleDC     = gdi32.NewProc("CreateCompatibleDC")
	deleteDC               = gdi32.NewProc("DeleteDC")
	createCompatibleBitmap = gdi32.NewProc("CreateCompatibleBitmap")
	deleteObject           = gdi32.NewProc("DeleteObject")
	selectObject           = gdi32.NewProc("SelectObject")
	bitBlt                 = gdi32.NewProc("BitBlt")
	getDIBits              = gdi32.NewProc("GetDIBits")
	sendInput              = user32.NewProc("SendInput")
	openInputDesktop       = user32.NewProc("OpenInputDesktop")
	closeDesktop           = user32.NewProc("CloseDesktop")
	userObjectInformation  = user32.NewProc("GetUserObjectInformationW")
)

const (
	smXVScreen        = 76
	smYVScreen        = 77
	smCXVScreen       = 78
	smCYVScreen       = 79
	srccopy           = 0x00CC0020
	mouseInputType    = 0
	keyboardInputType = 1
	mouseMove         = 0x0001
	mouseLeftDown     = 0x0002
	mouseLeftUp       = 0x0004
	mouseRightDown    = 0x0008
	mouseRightUp      = 0x0010
	mouseWheel        = 0x0800
	mouseAbsolute     = 0x8000
	mouseVirtualDesk  = 0x4000
	keyUp             = 0x0002
	keyUnicode        = 0x0004
)

type rect struct{ X, Y, Width, Height int32 }
type bitmapHeader struct {
	Size         uint32
	Width        int32
	Height       int32
	Planes       uint16
	BitCount     uint16
	Compression  uint32
	SizeImage    uint32
	XPels        int32
	YPels        int32
	ClrUsed      uint32
	ClrImportant uint32
}
type bitmapInfo struct {
	Header bitmapHeader
	Colors [1]uint32
}
type winInput struct {
	Kind uint32
	_    uint32
	Data [32]byte
}
type mouseData struct {
	Dx    int32
	Dy    int32
	Wheel uint32
	Flags uint32
	When  uint32
	_     uint32
	Extra uintptr
}
type keyData struct {
	Key   uint16
	Scan  uint16
	Flags uint32
	When  uint32
	_     uint32
	Extra uintptr
}

type Command struct {
	Action     string  `json:"action"`
	X          float64 `json:"x,omitempty"`
	Y          float64 `json:"y,omitempty"`
	X1         float64 `json:"x1,omitempty"`
	Y1         float64 `json:"y1,omitempty"`
	X2         float64 `json:"x2,omitempty"`
	Y2         float64 `json:"y2,omitempty"`
	DurationMs int32   `json:"durationMs,omitempty"`
	Phase      string  `json:"phase,omitempty"`
	Button     string  `json:"button,omitempty"`
	Key        string  `json:"key,omitempty"`
	Text       string  `json:"text,omitempty"`
	DeltaY     int32   `json:"deltaY,omitempty"`
}

type Bridge struct {
	mu           sync.Mutex
	grantedUntil time.Time
	closed       bool
}

// AuthorizeLocalUse must be called only from the host-side visible consent UI
// after the local user approves; a remote WebRTC message must NEVER call it.
func (b *Bridge) AuthorizeLocalUse(expiry time.Time) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.closed || !expiry.After(time.Now()) || expiry.After(time.Now().Add(30*time.Minute)) {
		return errors.New("invalid local consent")
	}
	b.grantedUntil = expiry
	return nil
}
func (b *Bridge) Stop() {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.closed = true
	b.grantedUntil = time.Time{}
}
func (b *Bridge) allowed() bool { return !b.closed && time.Now().Before(b.grantedUntil) }
func screen() (rect, error) {
	x, _, _ := getSystemMetrics.Call(smXVScreen)
	y, _, _ := getSystemMetrics.Call(smYVScreen)
	w, _, _ := getSystemMetrics.Call(smCXVScreen)
	h, _, _ := getSystemMetrics.Call(smCYVScreen)
	r := rect{int32(x), int32(y), int32(w), int32(h)}
	if r.Width < 1 || r.Height < 1 || r.Width > 4096 || r.Height > 4096 || int64(r.Width)*int64(r.Height) > 10000000 {
		return r, errors.New("unsupported screen bounds")
	}
	return r, nil
}

// CaptureJPEG captures a single frame. Encoding is local. Caller must bind
// frame emission to an authenticated, explicitly consented peer session.
func (b *Bridge) CaptureJPEG() ([]byte, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if !b.allowed() {
		return nil, errors.New("host consent required")
	}
	if !normalInputDesktop() {
		return nil, errors.New("locked or protected desktop refused")
	}
	r, err := screen()
	if err != nil {
		return nil, err
	}
	hdc, _, _ := getDC.Call(0)
	if hdc == 0 {
		return nil, errors.New("screen DC unavailable")
	}
	defer releaseDC.Call(0, hdc)
	mem, _, _ := createCompatibleDC.Call(hdc)
	if mem == 0 {
		return nil, errors.New("memory DC unavailable")
	}
	defer deleteDC.Call(mem)
	bmp, _, _ := createCompatibleBitmap.Call(hdc, uintptr(r.Width), uintptr(r.Height))
	if bmp == 0 {
		return nil, errors.New("bitmap unavailable")
	}
	defer deleteObject.Call(bmp)
	old, _, _ := selectObject.Call(mem, bmp)
	if old == 0 {
		return nil, errors.New("select bitmap failed")
	}
	ok, _, _ := bitBlt.Call(mem, 0, 0, uintptr(r.Width), uintptr(r.Height), hdc, uintptr(r.X), uintptr(r.Y), srccopy)
	selectObject.Call(mem, old)
	if ok == 0 {
		return nil, errors.New("BitBlt failed")
	}
	buf := make([]byte, int(r.Width*r.Height)*4)
	info := bitmapInfo{Header: bitmapHeader{Size: uint32(unsafe.Sizeof(bitmapHeader{})), Width: r.Width, Height: -r.Height, Planes: 1, BitCount: 32}}
	copied, _, _ := getDIBits.Call(hdc, bmp, 0, uintptr(r.Height), uintptr(unsafe.Pointer(&buf[0])), uintptr(unsafe.Pointer(&info)), 0)
	if copied != uintptr(r.Height) {
		return nil, errors.New("screen pixel transfer failed")
	}
	rgba := image.NewRGBA(image.Rect(0, 0, int(r.Width), int(r.Height)))
	for i := 0; i < len(buf); i += 4 {
		rgba.Pix[i], rgba.Pix[i+1], rgba.Pix[i+2], rgba.Pix[i+3] = buf[i+2], buf[i+1], buf[i], 255
	}
	var out bytes.Buffer
	if err := jpeg.Encode(&out, rgba, &jpeg.Options{Quality: 65}); err != nil {
		return nil, err
	}
	if out.Len() > 4*1024*1024 {
		return nil, errors.New("snapshot exceeds transport bound")
	}
	return out.Bytes(), nil
}

// Refuse capture/control when the interactive input desktop is not the ordinary
// user desktop. This is a defense-in-depth gate, not a promise of universal
// Windows lock or UAC handling across all versions.
func normalInputDesktop() bool {
	handle, _, _ := openInputDesktop.Call(0, 0, 0x0001)
	if handle == 0 {
		return false
	}
	defer closeDesktop.Call(handle)
	name := make([]uint16, 128)
	var needed uint32
	ok, _, _ := userObjectInformation.Call(handle, 2, uintptr(unsafe.Pointer(&name[0])), uintptr(len(name)*2), uintptr(unsafe.Pointer(&needed)))
	if ok == 0 {
		return false
	}
	return syscall.UTF16ToString(name) == "Default"
}

func normalized(n float64) bool { return !math.IsNaN(n) && !math.IsInf(n, 0) && n >= 0 && n <= 1 }
func mouseInput(flags uint32, x, y int32, data uint32) winInput {
	v := winInput{Kind: mouseInputType}
	*(*mouseData)(unsafe.Pointer(&v.Data[0])) = mouseData{Dx: x, Dy: y, Wheel: data, Flags: flags}
	return v
}
func keyboardInput(scan uint16, flags uint32) winInput {
	v := winInput{Kind: keyboardInputType}
	*(*keyData)(unsafe.Pointer(&v.Data[0])) = keyData{Scan: scan, Flags: flags}
	return v
}
func send(inputs []winInput) error {
	// On Windows/amd64 the native INPUT structure is exactly 40 bytes.
	if unsafe.Sizeof(winInput{}) != 40 {
		return errors.New("invalid Windows INPUT layout")
	}
	if len(inputs) < 1 || len(inputs) > 1024 {
		return errors.New("input size denied")
	}
	sent, _, _ := sendInput.Call(uintptr(len(inputs)), uintptr(unsafe.Pointer(&inputs[0])), unsafe.Sizeof(winInput{}))
	if sent != uintptr(len(inputs)) {
		return errors.New("Windows rejected input: locked, elevated or inaccessible desktop")
	}
	return nil
}
func (b *Bridge) Apply(c Command) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	if !b.allowed() {
		return errors.New("host consent required")
	}
	if !normalInputDesktop() {
		return errors.New("locked or protected desktop refused")
	}
	r, err := screen()
	if err != nil {
		return err
	}
	inputs := make([]winInput, 0, 512)
	switch c.Action {
	case "tap", "pointer":
		if !normalized(c.X) || !normalized(c.Y) {
			return errors.New("bad coordinates")
		}
		x := int32(math.Round(c.X * 65535))
		y := int32(math.Round(c.Y * 65535))
		move := mouseInput(mouseMove|mouseAbsolute|mouseVirtualDesk, x, y, 0)
		inputs = append(inputs, move)
		if c.Action == "tap" {
			inputs = append(inputs, mouseInput(mouseLeftDown, 0, 0, 0), mouseInput(mouseLeftUp, 0, 0, 0))
		}
		if c.Action == "pointer" {
			if c.Button != "left" && c.Button != "right" {
				return errors.New("unsupported button")
			}
			switch c.Phase {
			case "down":
				if c.Button == "left" {
					inputs = append(inputs, mouseInput(mouseLeftDown, 0, 0, 0))
				} else {
					inputs = append(inputs, mouseInput(mouseRightDown, 0, 0, 0))
				}
			case "up":
				if c.Button == "left" {
					inputs = append(inputs, mouseInput(mouseLeftUp, 0, 0, 0))
				} else {
					inputs = append(inputs, mouseInput(mouseRightUp, 0, 0, 0))
				}
			case "move":
			default:
				return errors.New("unsupported pointer phase")
			}
		}
	case "swipe":
		if !normalized(c.X1) || !normalized(c.Y1) || !normalized(c.X2) || !normalized(c.Y2) || c.DurationMs < 50 || c.DurationMs > 5000 {
			return errors.New("bad swipe")
		}
		sx := int32(math.Round(c.X1 * 65535))
		sy := int32(math.Round(c.Y1 * 65535))
		ex := int32(math.Round(c.X2 * 65535))
		ey := int32(math.Round(c.Y2 * 65535))
		inputs = append(inputs,
			mouseInput(mouseMove|mouseAbsolute|mouseVirtualDesk, sx, sy, 0),
			mouseInput(mouseLeftDown, 0, 0, 0),
			mouseInput(mouseMove|mouseAbsolute|mouseVirtualDesk, ex, ey, 0),
			mouseInput(mouseLeftUp, 0, 0, 0))
	case "wheel":
		if c.DeltaY < -1000 || c.DeltaY > 1000 {
			return errors.New("wheel out of bounds")
		}
		inputs = append(inputs, mouseInput(mouseWheel, 0, 0, uint32(-c.DeltaY)))
	case "text":
		if len(c.Text) == 0 || len(c.Text) > 512 {
			return errors.New("text length denied")
		}
		for _, ch := range utf16.Encode([]rune(c.Text)) {
			inputs = append(inputs, keyboardInput(ch, keyUnicode), keyboardInput(ch, keyUnicode|keyUp))
		}
	case "key":
		vk := map[string]uint16{"ENTER": 0x0D, "ESCAPE": 0x1B, "TAB": 0x09, "BACKSPACE": 0x08, "DELETE": 0x2E, "HOME": 0x24, "ARROW_UP": 0x26, "ARROW_DOWN": 0x28, "ARROW_LEFT": 0x25, "ARROW_RIGHT": 0x27}[c.Key]
		if vk == 0 {
			return errors.New("key not in allowlist")
		}
		d := winInput{Kind: keyboardInputType}
		*(*keyData)(unsafe.Pointer(&d.Data[0])) = keyData{Key: vk}
		u := d
		(*keyData)(unsafe.Pointer(&u.Data[0])).Flags = keyUp
		inputs = append(inputs, d, u)
	default:
		return errors.New("action not manually permitted")
	}
	_ = r
	return send(inputs)
}
