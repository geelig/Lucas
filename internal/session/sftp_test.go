package session

import (
	"context"
	"io/fs"
	"os"
	"path"
	"testing"
	"time"

	"github.com/pkg/sftp"
)

type remoteInfo struct {
	name string
	dir  bool
	link bool
	sys  any
}

func (i remoteInfo) Name() string { return i.name }
func (i remoteInfo) Size() int64  { return 0 }
func (i remoteInfo) Mode() os.FileMode {
	if i.link {
		return os.ModeSymlink | 0o777
	}
	if i.dir {
		return os.ModeDir | 0o755
	}
	return 0o644
}
func (i remoteInfo) ModTime() time.Time { return time.Time{} }
func (i remoteInfo) IsDir() bool        { return i.dir }
func (i remoteInfo) Sys() any           { return i.sys }

type remoteIDInfo struct {
	remoteInfo
	uid uint32
	gid uint32
}

func (i remoteIDInfo) Uid() uint32 { return i.uid }
func (i remoteIDInfo) Gid() uint32 { return i.gid }

type fakeRemote struct {
	items   map[string]os.FileInfo
	deleted []string
}

func (f *fakeRemote) Getwd() (string, error) { return "/home/test", nil }
func (f *fakeRemote) ReadDir(name string) ([]os.FileInfo, error) {
	var result []os.FileInfo
	for itemPath, info := range f.items {
		if path.Dir(itemPath) == path.Clean(name) {
			result = append(result, info)
		}
	}
	return result, nil
}
func (f *fakeRemote) MkdirAll(string) error       { return nil }
func (f *fakeRemote) Rename(string, string) error { return nil }
func (f *fakeRemote) RemoveDirectory(name string) error {
	f.deleted = append(f.deleted, name)
	return nil
}
func (f *fakeRemote) Remove(name string) error              { f.deleted = append(f.deleted, name); return nil }
func (f *fakeRemote) Open(string) (*sftp.File, error)       { return nil, fs.ErrInvalid }
func (f *fakeRemote) Create(string) (*sftp.File, error)     { return nil, fs.ErrInvalid }
func (f *fakeRemote) Stat(name string) (os.FileInfo, error) { return f.Lstat(name) }
func (f *fakeRemote) Lstat(name string) (os.FileInfo, error) {
	info, ok := f.items[path.Clean(name)]
	if !ok {
		return nil, os.ErrNotExist
	}
	return info, nil
}

func TestSFTPDeleteDoesNotFollowSymlink(t *testing.T) {
	remote := &fakeRemote{items: map[string]os.FileInfo{
		"/tree":         remoteInfo{name: "tree", dir: true},
		"/tree/link":    remoteInfo{name: "link", link: true},
		"/tree/file":    remoteInfo{name: "file"},
		"/outside/keep": remoteInfo{name: "keep"},
	}}
	filesystem := &sftpFileSystem{client: remote}
	if err := filesystem.Delete(context.Background(), "/tree/../tree", true); err != nil {
		t.Fatal(err)
	}
	if len(remote.deleted) != 3 {
		t.Fatalf("deleted = %v", remote.deleted)
	}
	for _, name := range remote.deleted {
		if name == "/outside/keep" || name == "/outside" {
			t.Fatalf("followed symlink: %v", remote.deleted)
		}
	}
}

func TestSFTPListUsesOwnershipFromFileStat(t *testing.T) {
	remote := &fakeRemote{items: map[string]os.FileInfo{
		"/tree":      remoteInfo{name: "tree", dir: true},
		"/tree/root": remoteInfo{name: "root", sys: &sftp.FileStat{UID: 0, GID: 0}},
		"/tree/app":  remoteInfo{name: "app", sys: &sftp.FileStat{UID: 1000, GID: 1001}},
	}}
	listing, err := (&sftpFileSystem{client: remote}).List(context.Background(), "/tree")
	if err != nil {
		t.Fatal(err)
	}
	if len(listing.Entries) != 2 {
		t.Fatalf("entries = %+v", listing.Entries)
	}
	byName := make(map[string]Entry, len(listing.Entries))
	for _, entry := range listing.Entries {
		byName[entry.Name] = entry
	}
	if entry := byName["root"]; entry.Owner != "root" || entry.Group != "root" {
		t.Fatalf("root owner/group = %q/%q", entry.Owner, entry.Group)
	}
	if entry := byName["app"]; entry.Owner != "1000" || entry.Group != "1001" {
		t.Fatalf("app owner/group = %q/%q", entry.Owner, entry.Group)
	}
}

func TestSFTPListUsesUIDGIDInterfaceAndLeavesUnknownEmpty(t *testing.T) {
	remote := &fakeRemote{items: map[string]os.FileInfo{
		"/tree":      remoteInfo{name: "tree", dir: true},
		"/tree/root": remoteIDInfo{remoteInfo: remoteInfo{name: "root"}, uid: 0, gid: 0},
		"/tree/app":  remoteIDInfo{remoteInfo: remoteInfo{name: "app"}, uid: 2000, gid: 2001},
		"/tree/none": remoteInfo{name: "none"},
	}}
	listing, err := (&sftpFileSystem{client: remote}).List(context.Background(), "/tree")
	if err != nil {
		t.Fatal(err)
	}
	byName := make(map[string]Entry, len(listing.Entries))
	for _, entry := range listing.Entries {
		byName[entry.Name] = entry
	}
	if entry := byName["root"]; entry.Owner != "root" || entry.Group != "root" {
		t.Fatalf("root owner/group = %q/%q", entry.Owner, entry.Group)
	}
	if entry := byName["app"]; entry.Owner != "2000" || entry.Group != "2001" {
		t.Fatalf("app owner/group = %q/%q", entry.Owner, entry.Group)
	}
	if entry := byName["none"]; entry.Owner != "" || entry.Group != "" {
		t.Fatalf("unknown owner/group = %q/%q, want empty", entry.Owner, entry.Group)
	}
}

func TestRemotePathNormalization(t *testing.T) {
	if got := cleanRemotePath("a/../../b/./c"); got != "../b/c" {
		t.Fatalf("path = %q", got)
	}
	if got := cleanRemotePath("/a//b/"); got != "/a/b" {
		t.Fatalf("path = %q", got)
	}
	if _, err := cleanLocalPath("\x00"); err == nil {
		t.Fatal("expected NUL path error")
	}
}
