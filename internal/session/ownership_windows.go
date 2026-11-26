//go:build windows

package session

import "os"

func localFileEntry(name, fullPath string, info os.FileInfo) Entry {
	return fileEntry(name, fullPath, info)
}
