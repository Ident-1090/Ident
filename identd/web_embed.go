//go:build embed

package main

import (
	"embed"
	"io/fs"
)

//go:embed web
var embeddedWeb embed.FS

func bundledWeb() fs.FS {
	web, err := fs.Sub(embeddedWeb, "web")
	if err != nil {
		panic(err)
	}
	return web
}
