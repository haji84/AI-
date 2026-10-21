//go:build windows

package main

import _ "embed"

//go:embed index.html
var htmlBytes []byte

// These two copies are checked byte-for-byte against src/remote-lite in CI.
// Embedding keeps the standalone EXE independent of the source checkout.
//go:embed browser-webrtc.mjs
var browserPeerBytes []byte

//go:embed manual-protocol.mjs
var manualProtocolBytes []byte

//go:embed windows-host.mjs
var windowsHostBytes []byte

func init() { indexHTML = htmlBytes }
