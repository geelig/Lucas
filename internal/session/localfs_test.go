package session

import (
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"sync"
	"testing"
	"time"
)

func TestCleanLocalPathExpandsHome(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	got, err := cleanLocalPath("~")
	if err != nil {
		t.Fatal(err)
	}
	if got != home {
		t.Fatalf("home path = %q, want %q", got, home)
	}
}

func TestLocalFSOperationsAndSymlinkSafeDelete(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("symlink test requires Unix permissions")
	}
	root := t.TempDir()
	outside := filepath.Join(root, "outside")
	if err := os.Mkdir(outside, 0o755); err != nil {
		t.Fatal(err)
	}
	keep := filepath.Join(outside, "keep.txt")
	if err := os.WriteFile(keep, []byte("keep"), 0o600); err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(root, "tree")
	fs := NewLocalFS()
	ctx := context.Background()
	if err := fs.Mkdir(ctx, filepath.Join(target, "nested")); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(target, "link")); err != nil {
		t.Fatal(err)
	}
	source := filepath.Join(root, "source.txt")
	destination := filepath.Join(target, "nested", "copy.txt")
	if err := fs.Upload(ctx, source, destination, "upload", func(int64, int64) {}); err == nil {
		t.Fatal("expected missing source error")
	}
	if err := os.WriteFile(source, []byte("payload"), 0o600); err != nil {
		t.Fatal(err)
	}
	var progress [][2]int64
	if err := fs.Upload(ctx, source, destination, "upload", func(done, total int64) {
		progress = append(progress, [2]int64{done, total})
	}); err != nil {
		t.Fatal(err)
	}
	listing, err := fs.List(ctx, target)
	if err != nil {
		t.Fatal(err)
	}
	if len(listing.Entries) != 2 {
		t.Fatalf("entries = %+v", listing.Entries)
	}
	for _, entry := range listing.Entries {
		if entry.Name == "link" && (!entry.Symlink || entry.Directory) {
			t.Fatalf("symlink followed: %+v", entry)
		}
	}
	download := filepath.Join(root, "download.txt")
	if err := fs.Download(ctx, destination, download, "download", nil); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(download)
	if err != nil || !bytes.Equal(got, []byte("payload")) {
		t.Fatalf("download = %q, %v", got, err)
	}
	renamed := filepath.Join(root, "renamed.txt")
	if err := fs.Rename(ctx, download, renamed); err != nil {
		t.Fatal(err)
	}
	if err := fs.Delete(ctx, target, false); err == nil {
		t.Fatal("expected non-recursive delete to fail")
	}
	if err := fs.Delete(ctx, target, true); err != nil {
		t.Fatal(err)
	}
	if got, err := os.ReadFile(keep); err != nil || string(got) != "keep" {
		t.Fatalf("symlink target was modified: %q, %v", got, err)
	}
	if len(progress) == 0 || progress[len(progress)-1] != [2]int64{7, 7} {
		t.Fatalf("progress = %v", progress)
	}
	home, err := fs.Home(ctx)
	if err != nil || !filepath.IsAbs(home) {
		t.Fatalf("home = %q, %v", home, err)
	}
}

type blockingFile struct {
	started chan struct{}
	release chan struct{}
	once    sync.Once
}

func (b *blockingFile) Read([]byte) (int, error) {
	b.once.Do(func() { close(b.started) })
	<-b.release
	return 0, os.ErrClosed
}
func (b *blockingFile) Write(p []byte) (int, error) { return len(p), nil }
func (b *blockingFile) Close() error {
	select {
	case <-b.release:
	default:
		close(b.release)
	}
	return nil
}

func TestTransferTrackerCancelClosesFiles(t *testing.T) {
	var tracker transferTracker
	ctx, err := tracker.begin(context.Background(), "t1")
	if err != nil {
		t.Fatal(err)
	}
	file := &blockingFile{started: make(chan struct{}), release: make(chan struct{})}
	tracker.setFiles("t1", file)
	done := make(chan error, 1)
	go func() {
		_, err := copyWithProgress(ctx, file, file, 1, nil)
		done <- err
	}()
	<-file.started
	if err := tracker.Cancel("t1"); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("copy error = %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("cancel did not unblock the transfer")
	}
	tracker.end("t1")
	if err := tracker.Cancel("t1"); !errors.Is(err, ErrTransferNotFound) {
		t.Fatalf("cancel error = %v", err)
	}
}
