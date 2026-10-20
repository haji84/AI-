//go:build windows

package main

import _ "embed"

//go:embed index.html
var htmlBytes []byte

func init() { indexHTML = htmlBytes }
