package session

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"github.com/pkg/sftp"
)

type sftpBackend interface {
	Getwd() (string, error)
	ReadDir(string) ([]os.FileInfo, error)
	MkdirAll(string) error
	Rename(string, string) error
	Remove(string) error
	RemoveDirectory(string) error
	Stat(string) (os.FileInfo, error)
	Lstat(string) (os.FileInfo, error)
	Open(string) (*sftp.File, error)
	Create(string) (*sftp.File, error)
}

type sftpFileSystem struct {
	client    sftpBackend
	transfers transferTracker
}

func NewSFTPFileSystem(client *sftp.Client) FileSystem {
	return &sftpFileSystem{client: client}
}

func cleanRemotePath(name string) string {
	if name == "" {
		return "."
	}
	return path.Clean(name)
}

func remotePath(name string) (string, error) {
	if strings.IndexByte(name, 0) >= 0 {
		return "", errors.New("path contains NUL")
	}
	return cleanRemotePath(name), nil
}

func (f *sftpFileSystem) Home(ctx context.Context) (string, error) {
	if err := ctx.Err(); err != nil {
		return "", err
	}
	name, err := f.client.Getwd()
	if err != nil {
		return "", err
	}
	return cleanRemotePath(name), nil
}

func (f *sftpFileSystem) List(ctx context.Context, name string) (Listing, error) {
	if err := ctx.Err(); err != nil {
		return Listing{}, err
	}
	name, err := remotePath(name)
	if err != nil {
		return Listing{}, err
	}
	items, err := f.client.ReadDir(name)
	if err != nil {
		return Listing{}, err
	}
	result := Listing{Path: name, Entries: make([]Entry, 0, len(items))}
	for _, item := range items {
		if err := ctx.Err(); err != nil {
			return Listing{}, err
		}
		result.Entries = append(result.Entries, sftpFileEntry(item.Name(), path.Join(name, item.Name()), item))
	}
	sort.Slice(result.Entries, func(i, j int) bool { return result.Entries[i].Name < result.Entries[j].Name })
	return result, nil
}

func sftpFileEntry(name, fullPath string, info os.FileInfo) Entry {
	entry := fileEntry(name, fullPath, info)
	uid, gid, ok := sftpOwnership(info)
	if !ok {
		return entry
	}
	entry.Owner = sftpIDName(uid)
	entry.Group = sftpIDName(gid)
	return entry
}

func sftpOwnership(info os.FileInfo) (uint32, uint32, bool) {
	if stat, ok := info.Sys().(*sftp.FileStat); ok && stat != nil {
		return stat.UID, stat.GID, true
	}
	if ids, ok := info.(sftp.FileInfoUidGid); ok {
		return ids.Uid(), ids.Gid(), true
	}
	return 0, 0, false
}

func sftpIDName(id uint32) string {
	if id == 0 {
		return "root"
	}
	return strconv.FormatUint(uint64(id), 10)
}

func (f *sftpFileSystem) Mkdir(ctx context.Context, name string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	name, err := remotePath(name)
	if err != nil {
		return err
	}
	return f.client.MkdirAll(name)
}

func (f *sftpFileSystem) Rename(ctx context.Context, oldName, newName string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	oldName, err := remotePath(oldName)
	if err != nil {
		return err
	}
	newName, err = remotePath(newName)
	if err != nil {
		return err
	}
	return f.client.Rename(oldName, newName)
}

func (f *sftpFileSystem) Delete(ctx context.Context, name string, recursive bool) error {
	name, err := remotePath(name)
	if err != nil {
		return err
	}
	return f.delete(ctx, name, recursive)
}

func (f *sftpFileSystem) delete(ctx context.Context, name string, recursive bool) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	info, err := f.client.Lstat(name)
	if err != nil {
		return err
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.IsDir() {
		return f.client.Remove(name)
	}
	if !recursive {
		return f.client.RemoveDirectory(name)
	}
	items, err := f.client.ReadDir(name)
	if err != nil {
		return err
	}
	for _, item := range items {
		if err := f.delete(ctx, path.Join(name, item.Name()), true); err != nil {
			return err
		}
	}
	return f.client.RemoveDirectory(name)
}

// Upload copies a local file to a remote SFTP path. Download reverses the
// direction. A directory destination receives the source's base name.
func (f *sftpFileSystem) Upload(ctx context.Context, source, destination, transferID string, progress func(int64, int64)) error {
	ctx, err := f.transfers.begin(ctx, transferID)
	if err != nil {
		return err
	}
	defer f.transfers.end(transferID)
	source, err = cleanLocalPath(source)
	if err != nil {
		return err
	}
	destination, err = remotePath(destination)
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
	if destinationInfo, statErr := f.client.Stat(destination); statErr == nil && destinationInfo.IsDir() {
		destination = path.Join(destination, filepath.Base(source))
	} else if statErr != nil && !os.IsNotExist(statErr) {
		return statErr
	}
	output, err := f.client.Create(destination)
	if err != nil {
		return err
	}
	defer output.Close()
	f.transfers.setFiles(transferID, input, output)
	_, err = copyWithProgress(ctx, input, output, info.Size(), progress)
	return err
}

func (f *sftpFileSystem) Download(ctx context.Context, source, destination, transferID string, progress func(int64, int64)) error {
	ctx, err := f.transfers.begin(ctx, transferID)
	if err != nil {
		return err
	}
	defer f.transfers.end(transferID)
	source, err = remotePath(source)
	if err != nil {
		return err
	}
	destination, err = cleanLocalPath(destination)
	if err != nil {
		return err
	}
	input, err := f.client.Open(source)
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
	if destinationInfo, statErr := os.Stat(destination); statErr == nil && destinationInfo.IsDir() {
		destination = filepath.Join(destination, path.Base(source))
	} else if statErr != nil && !os.IsNotExist(statErr) {
		return statErr
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

func (f *sftpFileSystem) Cancel(transferID string) error {
	return f.transfers.Cancel(transferID)
}
