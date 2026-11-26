package main

import (
	"io"
	"os"
	"path/filepath"
)

// migrateWebKitDataAt copies only small LocalStorage stores. Existing Lucas
// data and browser caches are never overwritten.
func migrateWebKitDataAt(home string) error {
	source := filepath.Join(home, "Library", "WebKit", "com.lucas.independent", "WebsiteData", "Default")
	target := filepath.Join(home, "Library", "WebKit", "com.lucas.terminal", "WebsiteData", "Default")
	for _, first := range directories(source) {
		for _, second := range directories(filepath.Join(source, first.Name())) {
			for _, storage := range directories(filepath.Join(source, first.Name(), second.Name())) {
				if storage.Name() != "LocalStorage" {
					continue
				}
				sourceDir := filepath.Join(source, first.Name(), second.Name(), storage.Name())
				targetDir := filepath.Join(target, first.Name(), second.Name(), storage.Name())
				if _, err := os.Stat(targetDir); err == nil {
					continue
				}
				if err := copyDirectoryExclusive(sourceDir, targetDir); err != nil {
					return err
				}
			}
		}
	}
	return nil
}

func directories(path string) []os.DirEntry {
	entries, err := os.ReadDir(path)
	if err != nil {
		return nil
	}
	result := make([]os.DirEntry, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() {
			result = append(result, entry)
		}
	}
	return result
}

func copyDirectoryExclusive(source, target string) error {
	return filepath.WalkDir(source, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		relative, err := filepath.Rel(source, path)
		if err != nil {
			return err
		}
		destination := filepath.Join(target, relative)
		if entry.IsDir() {
			return os.MkdirAll(destination, 0o700)
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		input, err := os.Open(path)
		if err != nil {
			return err
		}
		defer input.Close()
		output, err := os.OpenFile(destination, os.O_WRONLY|os.O_CREATE|os.O_EXCL, info.Mode().Perm())
		if err != nil {
			return err
		}
		_, copyErr := io.Copy(output, input)
		closeErr := output.Close()
		if copyErr != nil {
			return copyErr
		}
		return closeErr
	})
}

func migrateLegacyWebKitData() {
	home, err := os.UserHomeDir()
	if err == nil {
		_ = migrateWebKitDataAt(home)
	}
}
