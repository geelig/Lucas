package store

import (
	"os"
	"path/filepath"
	"testing"
)

func TestMigrateToCopiesEncryptedStoreAndPreservesSource(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	source := filepath.Join(home, "Library", "Application Support", "Lucas 2")
	s, err := NewAt(source, filepath.Join(home, "missing.json"))
	if err != nil {
		t.Fatal(err)
	}
	profile := Profile{ID: "server", Name: "Server", Protocol: "ssh", Host: "example.test", Password: "secret", Passphrase: "phrase"}
	if err := s.SaveProfile(profile); err != nil {
		t.Fatal(err)
	}
	recordings := filepath.Join(source, "recordings")
	if err := os.MkdirAll(recordings, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(recordings, "sample.log"), []byte("sample"), 0o600); err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(filepath.Join(source, profilesFileName))
	if err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(home, "new-location")
	if err := s.MigrateTo(target); err != nil {
		t.Fatal(err)
	}
	if got := s.Directory(); got != target {
		t.Fatalf("directory = %q", got)
	}
	after, err := os.ReadFile(filepath.Join(source, profilesFileName))
	if err != nil {
		t.Fatal(err)
	}
	if string(before) != string(after) {
		t.Fatal("source changed during migration")
	}
	if _, err := os.Stat(filepath.Join(target, "recordings", "sample.log")); err != nil {
		t.Fatal(err)
	}
	reopened, err := NewAt(target)
	if err != nil {
		t.Fatal(err)
	}
	got, ok := reopened.Profile(profile.ID)
	if !ok || got.Password != "secret" || got.Passphrase != "phrase" {
		t.Fatal("encrypted credentials did not migrate")
	}
	defaulted, err := New()
	if err != nil {
		t.Fatal(err)
	}
	if defaulted.Directory() != target {
		t.Fatalf("remembered directory = %q", defaulted.Directory())
	}
	conflict := filepath.Join(home, "conflict")
	if err := os.MkdirAll(conflict, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(conflict, "keep.txt"), []byte("keep"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := s.MigrateTo(conflict); err == nil {
		t.Fatal("non-empty destination was accepted")
	}
	content, err := os.ReadFile(filepath.Join(conflict, "keep.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if string(content) != "keep" {
		t.Fatal("destination was overwritten")
	}
}

func TestDefaultStoreDirectoryAtMigratesLegacy(t *testing.T) {
	home := t.TempDir()
	legacy := filepath.Join(home, "Library", "Application Support", "Lucas 2")
	if err := os.MkdirAll(legacy, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(legacy, "profiles.json"), []byte(`{"groups":[],"profiles":[],"groupOrder":[]}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(legacy, "credentials.key"), []byte("legacy-key"), 0o600); err != nil {
		t.Fatal(err)
	}
	got, err := defaultStoreDirectoryAt(home)
	if err != nil {
		t.Fatal(err)
	}
	want := filepath.Join(home, "Library", "Application Support", "Lucas")
	if got != want {
		t.Fatalf("directory = %q, want %q", got, want)
	}
	data, err := os.ReadFile(filepath.Join(want, "credentials.key"))
	if err != nil || string(data) != "legacy-key" {
		t.Fatalf("legacy key was not preserved: %q, %v", data, err)
	}
}
