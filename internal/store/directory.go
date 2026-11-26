package store

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

const locationFileName = "config-location"

func defaultStoreDirectory() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return defaultStoreDirectoryAt(home)
}

func defaultStoreDirectoryAt(home string) (string, error) {
	base := filepath.Join(home, "Library", "Application Support", "Lucas")
	if raw, err := os.ReadFile(filepath.Join(base, locationFileName)); err == nil {
		if custom := strings.TrimSpace(string(raw)); filepath.IsAbs(custom) {
			return custom, nil
		}
	}
	if _, err := os.Stat(filepath.Join(base, profilesFileName)); err == nil {
		return base, nil
	}
	legacy := ""
	for _, name := range []string{"Lucas 2"} {
		candidate := filepath.Join(home, "Library", "Application Support", name)
		if raw, err := os.ReadFile(filepath.Join(candidate, locationFileName)); err == nil {
			if custom := strings.TrimSpace(string(raw)); filepath.IsAbs(custom) {
				return custom, nil
			}
		}
		if _, err := os.Stat(filepath.Join(candidate, profilesFileName)); err == nil {
			legacy = candidate
			break
		} else if !os.IsNotExist(err) {
			return "", err
		}
	}
	if legacy == "" {
		return base, nil
	}
	entries, err := os.ReadDir(base)
	if err != nil && !os.IsNotExist(err) {
		return "", err
	}
	if len(entries) > 0 {
		return base, nil
	}
	if err := os.MkdirAll(base, 0o700); err != nil {
		return "", err
	}
	for _, name := range []string{profilesFileName, credentialsFileName, keyFileName, "sender_commands.json", "command_history.json", "appearance.json"} {
		if err := copyStoreFile(filepath.Join(legacy, name), filepath.Join(base, name)); err != nil {
			return "", err
		}
	}
	if err := copyStoreRecordings(filepath.Join(legacy, "recordings"), filepath.Join(base, "recordings")); err != nil {
		return "", err
	}
	return base, nil
}

func (s *Store) Directory() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.dir
}

// MigrateTo copies the complete store without changing the source. Existing
// non-empty destinations are never merged or overwritten.
func (s *Store) MigrateTo(target string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	target = filepath.Clean(strings.TrimSpace(target))
	if target == "" || !filepath.IsAbs(target) {
		return fmt.Errorf("%w: config directory must be absolute", ErrInvalid)
	}
	if target == s.dir {
		return nil
	}
	if entries, err := os.ReadDir(target); err == nil && len(entries) > 0 {
		return fmt.Errorf("%w: destination is not empty", ErrConflict)
	}
	parent := filepath.Dir(target)
	if err := os.MkdirAll(parent, 0o700); err != nil {
		return err
	}
	stage, err := os.MkdirTemp(parent, ".lucas-migrate-*")
	if err != nil {
		return err
	}
	defer os.RemoveAll(stage)
	for _, name := range []string{profilesFileName, credentialsFileName, keyFileName, "sender_commands.json", "command_history.json", "appearance.json"} {
		if err := copyStoreFile(filepath.Join(s.dir, name), filepath.Join(stage, name)); err != nil {
			return err
		}
	}
	if err := copyStoreRecordings(filepath.Join(s.dir, "recordings"), filepath.Join(stage, "recordings")); err != nil {
		return err
	}
	// Refuse a destination that became non-empty while copying.
	if entries, err := os.ReadDir(target); err == nil && len(entries) > 0 {
		return fmt.Errorf("%w: destination is not empty", ErrConflict)
	}
	if _, err := os.Stat(target); err == nil {
		if err := os.Remove(target); err != nil {
			return err
		}
	} else if !os.IsNotExist(err) {
		return err
	}
	if err := os.Rename(stage, target); err != nil {
		return err
	}
	s.dir = target
	base, err := defaultStoreDirectory()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(base, 0o700); err != nil {
		return err
	}
	if err := writeFileAtomic(filepath.Join(base, locationFileName), []byte(target), 0o600); err != nil {
		return fmt.Errorf("migration succeeded but cannot record location: %w", err)
	}
	return nil
}

func copyStoreFile(source, destination string) error {
	info, err := os.Stat(source)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() {
		return nil
	}
	input, err := os.Open(source)
	if err != nil {
		return err
	}
	defer input.Close()
	output, err := os.OpenFile(destination, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	if _, err := io.Copy(output, input); err != nil {
		_ = output.Close()
		return err
	}
	return output.Close()
}

func copyStoreRecordings(source, destination string) error {
	entries, err := os.ReadDir(source)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	if err := os.MkdirAll(destination, 0o700); err != nil {
		return err
	}
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		if err := copyStoreFile(filepath.Join(source, entry.Name()), filepath.Join(destination, entry.Name())); err != nil {
			return err
		}
	}
	return nil
}
