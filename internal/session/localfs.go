package session

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

var ErrTransferExists = errors.New("transfer already exists")

func NewLocalFS() FileSystem { return &localFileSystem{} }

type localFileSystem struct{ transfers transferTracker }

func cleanLocalPath(name string) (string, error) {
	if strings.IndexByte(name, 0) >= 0 {
		return "", errors.New("path contains NUL")
	}
	if name == "~" {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		name = home
	} else if strings.HasPrefix(name, "~/") {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		name = filepath.Join(home, strings.TrimPrefix(name, "~/"))
	}
	if name == "" {
		return "", errors.New("path is required")
	}
	return filepath.Abs(filepath.Clean(name))
}

func (f *localFileSystem) Home(ctx context.Context) (string, error) {
	if err := ctx.Err(); err != nil {
		return "", err
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return cleanLocalPath(home)
}

func (f *localFileSystem) List(ctx context.Context, name string) (Listing, error) {
	name, err := cleanLocalPath(name)
	if err != nil {
		return Listing{}, err
	}
	entries, err := os.ReadDir(name)
	if err != nil {
		return Listing{}, err
	}
	result := Listing{Path: name, Entries: make([]Entry, 0, len(entries))}
	for _, item := range entries {
		if err := ctx.Err(); err != nil {
			return Listing{}, err
		}
		info, err := item.Info()
		if err != nil {
			return Listing{}, err
		}
		result.Entries = append(result.Entries, localFileEntry(item.Name(), filepath.Join(name, item.Name()), info))
	}
	return result, nil
}

func fileEntry(name, fullPath string, info os.FileInfo) Entry {
	symlink := info.Mode()&os.ModeSymlink != 0
	return Entry{
		Name: name, Path: fullPath, Size: info.Size(), Directory: info.IsDir() && !symlink,
		Symlink: symlink, Modified: info.ModTime(), Permission: info.Mode().String(),
	}
}

func (f *localFileSystem) Mkdir(ctx context.Context, name string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	name, err := cleanLocalPath(name)
	if err != nil {
		return err
	}
	return os.MkdirAll(name, 0o755)
}

func (f *localFileSystem) Rename(ctx context.Context, oldName, newName string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	oldName, err := cleanLocalPath(oldName)
	if err != nil {
		return err
	}
	newName, err = cleanLocalPath(newName)
	if err != nil {
		return err
	}
	return os.Rename(oldName, newName)
}

func (f *localFileSystem) Delete(ctx context.Context, name string, recursive bool) error {
	name, err := cleanLocalPath(name)
	if err != nil {
		return err
	}
	return deleteLocal(ctx, name, recursive)
}

func deleteLocal(ctx context.Context, name string, recursive bool) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	info, err := os.Lstat(name)
	if err != nil {
		return err
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.IsDir() {
		return os.Remove(name)
	}
	if !recursive {
		return os.Remove(name)
	}
	entries, err := os.ReadDir(name)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if err := deleteLocal(ctx, filepath.Join(name, entry.Name()), true); err != nil {
			return err
		}
	}
	return os.Remove(name)
}

// Upload copies a local source file to a local destination. It is useful for
// local-terminal file panels and mirrors the remote FileSystem semantics.
func (f *localFileSystem) Upload(ctx context.Context, source, destination, transferID string, progress func(int64, int64)) error {
	ctx, err := f.transfers.begin(ctx, transferID)
	if err != nil {
		return err
	}
	defer f.transfers.end(transferID)
	source, destination, err = localTransferPaths(source, destination)
	if err != nil {
		return err
	}
	input, err := os.Open(source)
	if err != nil {
		return err
	}
	defer input.Close()
	info, err := input.Stat()
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() {
		return fmt.Errorf("source is not a regular file: %s", source)
	}
	output, err := os.OpenFile(destination, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o644)
	if err != nil {
		return err
	}
	defer output.Close()
	f.transfers.setFiles(transferID, input, output)
	_, err = copyWithProgress(ctx, input, output, info.Size(), progress)
	return err
}

// Download copies a local source file to a local destination.
func (f *localFileSystem) Download(ctx context.Context, source, destination, transferID string, progress func(int64, int64)) error {
	return f.Upload(ctx, source, destination, transferID, progress)
}

func localTransferPaths(source, destination string) (string, string, error) {
	var err error
	source, err = cleanLocalPath(source)
	if err != nil {
		return "", "", err
	}
	destination, err = cleanLocalPath(destination)
	if err != nil {
		return "", "", err
	}
	if info, statErr := os.Stat(destination); statErr == nil && info.IsDir() {
		destination = filepath.Join(destination, filepath.Base(source))
	} else if statErr != nil && !os.IsNotExist(statErr) {
		return "", "", statErr
	}
	if sourceInfo, sourceErr := os.Stat(source); sourceErr == nil {
		if destinationInfo, destinationErr := os.Stat(destination); destinationErr == nil && os.SameFile(sourceInfo, destinationInfo) {
			return "", "", errors.New("source and destination are the same file")
		}
	}
	return source, destination, nil
}

func (f *localFileSystem) Cancel(transferID string) error { return f.transfers.Cancel(transferID) }

type transferTracker struct {
	mu        sync.Mutex
	transfers map[string]*trackedTransfer
}

type trackedTransfer struct {
	cancel context.CancelFunc
	files  []io.Closer
}

func (t *transferTracker) begin(parent context.Context, id string) (context.Context, error) {
	if id == "" {
		return nil, errors.New("transfer ID is required")
	}
	ctx, cancel := context.WithCancel(parent)
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.transfers == nil {
		t.transfers = make(map[string]*trackedTransfer)
	}
	if t.transfers[id] != nil {
		cancel()
		return nil, ErrTransferExists
	}
	t.transfers[id] = &trackedTransfer{cancel: cancel}
	return ctx, nil
}

func (t *transferTracker) setFiles(id string, files ...io.Closer) {
	t.mu.Lock()
	if transfer := t.transfers[id]; transfer != nil {
		transfer.files = append([]io.Closer(nil), files...)
	}
	t.mu.Unlock()
}

func (t *transferTracker) end(id string) {
	t.mu.Lock()
	delete(t.transfers, id)
	t.mu.Unlock()
}

func (t *transferTracker) Cancel(id string) error {
	t.mu.Lock()
	transfer := t.transfers[id]
	if transfer == nil {
		t.mu.Unlock()
		return ErrTransferNotFound
	}
	transfer.cancel()
	files := append([]io.Closer(nil), transfer.files...)
	t.mu.Unlock()
	for _, file := range files {
		_ = file.Close()
	}
	return nil
}

func copyWithProgress(ctx context.Context, input io.Reader, output io.Writer, total int64, progress func(int64, int64)) (int64, error) {
	var done int64
	if progress != nil {
		progress(0, total)
	}
	buffer := make([]byte, 64*1024)
	for {
		if err := ctx.Err(); err != nil {
			return done, err
		}
		n, readErr := input.Read(buffer)
		if n > 0 {
			written := 0
			for written < n {
				if err := ctx.Err(); err != nil {
					return done, err
				}
				count, writeErr := output.Write(buffer[written:n])
				if writeErr != nil {
					if ctx.Err() != nil {
						return done, ctx.Err()
					}
					return done, writeErr
				}
				if count <= 0 {
					return done, io.ErrShortWrite
				}
				written += count
				done += int64(count)
			}
			if progress != nil {
				progress(done, total)
			}
		}
		if readErr != nil {
			if errors.Is(readErr, io.EOF) {
				return done, nil
			}
			if ctx.Err() != nil {
				return done, ctx.Err()
			}
			return done, readErr
		}
		if n == 0 {
			if err := ctx.Err(); err != nil {
				return done, err
			}
		}
	}
}
