//go:build !embed

package main

import "io/fs"

func bundledWeb() fs.FS {
	return nil
}
