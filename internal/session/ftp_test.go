package session

import (
	"bytes"
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/jlaffaye/ftp"

	"lucas/internal/store"
)

func TestFTPFileSystemOperations(t *testing.T) {
	modified := time.Date(2026, 11, 20, 12, 0, 0, 0, time.UTC)
	client := &fakeFTPClient{
		home: "/home/test",
		entries: []*ftp.Entry{
			{Name: ".", Type: ftp.EntryTypeFolder},
			{Name: "folder", Type: ftp.EntryTypeFolder, Time: modified},
			{Name: "link", Type: ftp.EntryTypeLink},
			{Name: "file", Type: ftp.EntryTypeFile, Size: 42, Time: modified},
		},
	}
	fs := newFakeFTPFileSystem(client)
	home, err := fs.Home(context.Background())
	if err != nil || home != "/home/test" {
		t.Fatalf("home=%q err=%v", home, err)
	}
	listing, err := fs.List(context.Background(), "")
	if err != nil {
		t.Fatal(err)
	}
	if listing.Path != "/home/test" || len(listing.Entries) != 3 {
		t.Fatalf("listing=%+v", listing)
	}
	if listing.Entries[2].Path != "/home/test/file" || listing.Entries[2].Size != 42 || !listing.Entries[2].Modified.Equal(modified) {
		t.Fatalf("file entry=%+v", listing.Entries[2])
	}
	if !listing.Entries[0].Directory || !listing.Entries[1].Symlink {
		t.Fatalf("entry types=%+v", listing.Entries)
	}
	for _, entry := range listing.Entries {
		if entry.Owner != "" || entry.Group != "" {
			t.Fatalf("FTP owner/group must stay empty: %+v", entry)
		}
	}
	if err := fs.Mkdir(context.Background(), "/new"); err != nil {
		t.Fatal(err)
	}
	if client.mkdirPath != "/new" {
		t.Fatalf("mkdir=%q", client.mkdirPath)
	}
	if err := fs.Rename(context.Background(), "/old", "/new-name"); err != nil {
		t.Fatal(err)
	}
	if client.renameFrom != "/old" || client.renameTo != "/new-name" {
		t.Fatalf("rename=%q %q", client.renameFrom, client.renameTo)
	}
	if err := fs.Delete(context.Background(), "/file", false); err != nil {
		t.Fatal(err)
	}
	if client.deletePath != "/file" {
		t.Fatalf("delete=%q", client.deletePath)
	}
	if err := fs.Delete(context.Background(), "/dir", true); err != nil {
		t.Fatal(err)
	}
	if client.recursivePath != "/dir" {
		t.Fatalf("recursive delete=%q", client.recursivePath)
	}
}

func TestFTPDeleteEmptyDirectoryFallback(t *testing.T) {
	client := &fakeFTPClient{deleteErr: errors.New("not a file")}
	fs := newFakeFTPFileSystem(client)
	if err := fs.Delete(context.Background(), "/empty", false); err != nil {
		t.Fatal(err)
	}
	if client.removeDirPath != "/empty" {
		t.Fatalf("remove dir=%q", client.removeDirPath)
	}
}

func TestFTPUploadDownloadAndProgress(t *testing.T) {
	directory := t.TempDir()
	source := filepath.Join(directory, "source.txt")
	if err := os.WriteFile(source, []byte("payload"), 0o600); err != nil {
		t.Fatal(err)
	}
	client := &fakeFTPClient{data: []byte("downloaded")}
	fs := newFakeFTPFileSystem(client)
	var uploadProgress [][2]int64
	if err := fs.Upload(context.Background(), source, "/remote.txt", "upload", func(done, total int64) {
		uploadProgress = append(uploadProgress, [2]int64{done, total})
	}); err != nil {
		t.Fatal(err)
	}
	if client.uploadPath != "/remote.txt" || client.uploaded.String() != "payload" {
		t.Fatalf("upload path=%q data=%q", client.uploadPath, client.uploaded.String())
	}
	if got := uploadProgress[len(uploadProgress)-1]; got != [2]int64{7, 7} {
		t.Fatalf("upload progress=%v", uploadProgress)
	}

	destination := filepath.Join(directory, "destination.txt")
	var downloadProgress [][2]int64
	if err := fs.Download(context.Background(), "/remote.txt", destination, "download", func(done, total int64) {
		downloadProgress = append(downloadProgress, [2]int64{done, total})
	}); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(destination)
	if err != nil || string(data) != "downloaded" {
		t.Fatalf("data=%q err=%v", data, err)
	}
	if got := downloadProgress[len(downloadProgress)-1]; got != [2]int64{10, 10} {
		t.Fatalf("download progress=%v", downloadProgress)
	}
	if err := fs.Cancel("download"); err == nil {
		t.Fatalf("cancel finished transfer: %v", err)
	}
}

func TestFTPFailedDownloadPreservesDestination(t *testing.T) {
	directory := t.TempDir()
	destination := filepath.Join(directory, "existing.txt")
	if err := os.WriteFile(destination, []byte("original"), 0o600); err != nil {
		t.Fatal(err)
	}
	client := &fakeFTPClient{retrErr: errors.New("retrieval failed")}
	fs := newFakeFTPFileSystem(client)
	if err := fs.Download(context.Background(), "/bad", destination, "download", nil); err == nil {
		t.Fatal("expected download error")
	}
	data, err := os.ReadFile(destination)
	if err != nil || string(data) != "original" {
		t.Fatalf("destination=%q err=%v", data, err)
	}
	matches, err := filepath.Glob(filepath.Join(directory, ".lucas-download-*"))
	if err != nil || len(matches) != 0 {
		t.Fatalf("temporary files=%v err=%v", matches, err)
	}
}

func TestFTPCancelActiveOperation(t *testing.T) {
	fs := newFakeFTPFileSystem(&fakeFTPClient{})
	op, err := fs.begin(context.Background(), "active")
	if err != nil {
		t.Fatal(err)
	}
	if err := fs.Cancel("active"); err != nil {
		t.Fatal(err)
	}
	select {
	case <-op.ctx.Done():
	default:
		t.Fatal("cancel did not cancel the operation")
	}
	fs.finish(op)
	if err := fs.Cancel("active"); err == nil {
		t.Fatalf("got %v", err)
	}
}

func TestFTPCancelActiveUploadUsesTransferID(t *testing.T) {
	source := filepath.Join(t.TempDir(), "source.txt")
	if err := os.WriteFile(source, []byte("payload"), 0o600); err != nil {
		t.Fatal(err)
	}
	client := &fakeFTPClient{
		uploadStarted: make(chan struct{}),
		uploadRelease: make(chan struct{}),
	}
	fs := newFakeFTPFileSystem(client)
	result := make(chan error, 1)
	go func() {
		result <- fs.Upload(context.Background(), source, "/remote.txt", "upload-id", nil)
	}()
	select {
	case <-client.uploadStarted:
	case err := <-result:
		t.Fatalf("upload ended before the transfer started: %v", err)
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for upload to start")
	}
	if err := fs.Cancel("upload-id"); err != nil {
		close(client.uploadRelease)
		t.Fatalf("cancel transfer ID: %v", err)
	}
	close(client.uploadRelease)
	select {
	case err := <-result:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("upload error after cancellation: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for cancelled upload")
	}
}

func TestFTPTerminalPlaceholderLifecycle(t *testing.T) {
	client := &fakeFTPClient{}
	connector := &ftpConnector{
		profile: store.Profile{Host: "not-contacted"},
		dial: func(context.Context, store.Profile, *ftpConnSet) (ftpClient, error) {
			return client, nil
		},
	}
	conn, files, err := connector.Connect(context.Background(), ConnectOptions{}, Hooks{})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := conn.Write([]byte("not supported")); !errors.Is(err, ErrTerminalNotSupported) {
		t.Fatalf("write error=%v", err)
	}
	readResult := make(chan error, 1)
	go func() {
		_, readErr := conn.Read(make([]byte, 1))
		readResult <- readErr
	}()
	select {
	case err := <-readResult:
		t.Fatalf("FTP terminal read returned before close: %v", err)
	case <-time.After(20 * time.Millisecond):
	}
	if err := conn.Close(); err != nil {
		t.Fatal(err)
	}
	if err := <-readResult; !errors.Is(err, io.EOF) {
		t.Fatalf("read after close=%v", err)
	}
	if err := conn.Wait(); err != nil {
		t.Fatal(err)
	}
	if err := conn.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := files.Home(context.Background()); !errors.Is(err, ErrFTPClosed) {
		t.Fatalf("operation after close=%v", err)
	}
}

func newFakeFTPFileSystem(client ftpClient) *ftpFileSystem {
	return &ftpFileSystem{
		dial: func(context.Context, store.Profile, *ftpConnSet) (ftpClient, error) {
			return client, nil
		},
		operations: make(map[*ftpOperation]struct{}),
		transfers:  make(map[string]*ftpOperation),
	}
}

type fakeFTPClient struct {
	home    string
	entries []*ftp.Entry
	data    []byte

	mkdirPath     string
	renameFrom    string
	renameTo      string
	deletePath    string
	removeDirPath string
	recursivePath string
	uploadPath    string
	uploaded      bytes.Buffer
	uploadStarted chan struct{}
	uploadRelease chan struct{}

	deleteErr error
	retrErr   error
}

func (c *fakeFTPClient) CurrentDir() (string, error) {
	if c.home == "" {
		return "/", nil
	}
	return c.home, nil
}
func (c *fakeFTPClient) List(string) ([]*ftp.Entry, error) { return c.entries, nil }
func (c *fakeFTPClient) MakeDir(path string) error {
	c.mkdirPath = path
	return nil
}
func (c *fakeFTPClient) Rename(from, to string) error {
	c.renameFrom, c.renameTo = from, to
	return nil
}
func (c *fakeFTPClient) Delete(path string) error {
	c.deletePath = path
	return c.deleteErr
}
func (c *fakeFTPClient) RemoveDir(path string) error {
	c.removeDirPath = path
	return nil
}
func (c *fakeFTPClient) RemoveDirRecur(path string) error {
	c.recursivePath = path
	return nil
}
func (c *fakeFTPClient) FileSize(string) (int64, error) { return int64(len(c.data)), nil }
func (c *fakeFTPClient) Retr(string) (io.ReadCloser, error) {
	if c.retrErr != nil {
		return nil, c.retrErr
	}
	return io.NopCloser(strings.NewReader(string(c.data))), nil
}
func (c *fakeFTPClient) Stor(path string, reader io.Reader) error {
	c.uploadPath = path
	if c.uploadStarted != nil {
		close(c.uploadStarted)
	}
	if c.uploadRelease != nil {
		<-c.uploadRelease
	}
	_, err := io.Copy(&c.uploaded, reader)
	return err
}
func (c *fakeFTPClient) Quit() error { return nil }
