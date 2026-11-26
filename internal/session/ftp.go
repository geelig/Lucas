package session

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	pathpkg "path"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/jlaffaye/ftp"

	"lucas/internal/store"
)

var (
	ErrFTPClosed            = errors.New("FTP session is closed")
	ErrTerminalNotSupported = errors.New("FTP sessions do not provide a terminal")
	ErrFTPTransferNotFound  = errors.New("active FTP transfer not found")
)

type ftpClient interface {
	CurrentDir() (string, error)
	List(string) ([]*ftp.Entry, error)
	MakeDir(string) error
	Rename(string, string) error
	Delete(string) error
	RemoveDir(string) error
	RemoveDirRecur(string) error
	FileSize(string) (int64, error)
	Retr(string) (io.ReadCloser, error)
	Stor(string, io.Reader) error
	Quit() error
}

type ftpDialFunc func(context.Context, store.Profile, *ftpConnSet) (ftpClient, error)

type ftpConnector struct {
	profile store.Profile
	dial    ftpDialFunc
}

// FTPFactory creates file-only sessions. Read blocks until Close so a session
// manager does not mistake the absence of a terminal for a disconnect.
var FTPFactory Factory = func(profile store.Profile) Connector {
	return &ftpConnector{profile: profile, dial: dialFTP}
}

func (c *ftpConnector) Connect(ctx context.Context, _ ConnectOptions, _ Hooks) (Connection, FileSystem, error) {
	fs := &ftpFileSystem{
		profile:    c.profile,
		dial:       c.dial,
		operations: make(map[*ftpOperation]struct{}),
		transfers:  make(map[string]*ftpOperation),
	}
	op, err := fs.begin(ctx, "")
	if err != nil {
		return nil, nil, err
	}
	fs.finish(op)
	if err := ctx.Err(); err != nil {
		return nil, nil, err
	}
	conn := &ftpConnection{fs: fs, done: make(chan struct{})}
	return conn, fs, nil
}

type ftpConnection struct {
	fs        *ftpFileSystem
	done      chan struct{}
	closeOnce sync.Once
}

func (c *ftpConnection) Read(p []byte) (int, error) {
	if len(p) == 0 {
		return 0, nil
	}
	<-c.done
	return 0, io.EOF
}

func (c *ftpConnection) Write([]byte) (int, error) { return 0, ErrTerminalNotSupported }
func (c *ftpConnection) Resize(_, _ int) error     { return nil }
func (c *ftpConnection) Wait() error               { <-c.done; return nil }

func (c *ftpConnection) Close() error {
	c.closeOnce.Do(func() {
		c.fs.close()
		close(c.done)
	})
	return nil
}

type ftpFileSystem struct {
	profile store.Profile
	dial    ftpDialFunc

	mu         sync.Mutex
	closed     bool
	operations map[*ftpOperation]struct{}
	transfers  map[string]*ftpOperation
}

type ftpOperation struct {
	ctx    context.Context
	cancel context.CancelFunc
	conns  *ftpConnSet
	stop   func() bool
	client ftpClient
}

func (f *ftpFileSystem) begin(ctx context.Context, transferID string) (*ftpOperation, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	opCtx, cancel := context.WithCancel(ctx)
	op := &ftpOperation{ctx: opCtx, cancel: cancel, conns: newFTPConnSet()}
	op.stop = context.AfterFunc(opCtx, op.conns.closeAll)

	f.mu.Lock()
	if f.closed {
		f.mu.Unlock()
		op.stop()
		cancel()
		return nil, ErrFTPClosed
	}
	if transferID != "" {
		if _, exists := f.transfers[transferID]; exists {
			f.mu.Unlock()
			op.stop()
			cancel()
			return nil, fmt.Errorf("transfer %q is already active", transferID)
		}
		f.transfers[transferID] = op
	}
	f.operations[op] = struct{}{}
	f.mu.Unlock()

	client, err := f.dial(opCtx, f.profile, op.conns)
	if err != nil {
		f.finish(op)
		if ctxErr := opCtx.Err(); ctxErr != nil {
			return nil, ctxErr
		}
		return nil, err
	}
	op.client = client
	return op, nil
}

func (f *ftpFileSystem) finish(op *ftpOperation) {
	if op.client != nil {
		_ = op.client.Quit()
	}
	op.stop()
	op.conns.closeAll()
	op.cancel()

	f.mu.Lock()
	delete(f.operations, op)
	for id, candidate := range f.transfers {
		if candidate == op {
			delete(f.transfers, id)
		}
	}
	f.mu.Unlock()
}

func (f *ftpFileSystem) close() {
	f.mu.Lock()
	if f.closed {
		f.mu.Unlock()
		return
	}
	f.closed = true
	ops := make([]*ftpOperation, 0, len(f.operations))
	for op := range f.operations {
		ops = append(ops, op)
	}
	f.mu.Unlock()
	for _, op := range ops {
		op.cancel()
	}
}

func (f *ftpFileSystem) Home(ctx context.Context) (string, error) {
	op, err := f.begin(ctx, "")
	if err != nil {
		return "", err
	}
	defer f.finish(op)
	home, err := op.client.CurrentDir()
	return home, ftpOperationError(op, err)
}

func (f *ftpFileSystem) List(ctx context.Context, directory string) (Listing, error) {
	op, err := f.begin(ctx, "")
	if err != nil {
		return Listing{}, err
	}
	defer f.finish(op)
	if directory == "" {
		directory, err = op.client.CurrentDir()
		if err != nil {
			return Listing{}, ftpOperationError(op, err)
		}
	}
	entries, err := op.client.List(directory)
	if err != nil {
		return Listing{}, ftpOperationError(op, err)
	}
	listing := Listing{Path: directory, Entries: make([]Entry, 0, len(entries))}
	for _, item := range entries {
		if item == nil || item.Name == "." || item.Name == ".." {
			continue
		}
		size := int64(item.Size)
		if size < 0 { // Clamp uint64 values that cannot fit Entry.Size.
			size = int64(^uint64(0) >> 1)
		}
		listing.Entries = append(listing.Entries, Entry{
			Name:      item.Name,
			Path:      pathpkg.Join(directory, item.Name),
			Size:      size,
			Directory: item.Type == ftp.EntryTypeFolder,
			Symlink:   item.Type == ftp.EntryTypeLink,
			Modified:  item.Time,
		})
	}
	return listing, nil
}

func (f *ftpFileSystem) Mkdir(ctx context.Context, path string) error {
	op, err := f.begin(ctx, "")
	if err != nil {
		return err
	}
	defer f.finish(op)
	return ftpOperationError(op, op.client.MakeDir(path))
}

func (f *ftpFileSystem) Rename(ctx context.Context, from, to string) error {
	op, err := f.begin(ctx, "")
	if err != nil {
		return err
	}
	defer f.finish(op)
	return ftpOperationError(op, op.client.Rename(from, to))
}

func (f *ftpFileSystem) Delete(ctx context.Context, path string, recursive bool) error {
	op, err := f.begin(ctx, "")
	if err != nil {
		return err
	}
	defer f.finish(op)
	if recursive {
		err = op.client.RemoveDirRecur(path)
		if err == nil {
			return nil
		}
		// A caller may set recursive without first determining the entry type.
		if fileErr := op.client.Delete(path); fileErr == nil {
			return nil
		} else {
			err = errors.Join(err, fileErr)
		}
	} else {
		err = op.client.Delete(path)
		if err == nil {
			return nil
		}
		// DELE handles files; RMD handles empty directories.
		if dirErr := op.client.RemoveDir(path); dirErr == nil {
			return nil
		} else {
			err = errors.Join(err, dirErr)
		}
	}
	return ftpOperationError(op, err)
}

func (f *ftpFileSystem) Upload(ctx context.Context, source, destination, transferID string, progress func(int64, int64)) error {
	file, err := os.Open(source)
	if err != nil {
		return err
	}
	defer file.Close()
	stat, err := file.Stat()
	if err != nil {
		return err
	}
	if stat.IsDir() {
		return fmt.Errorf("upload source %q is a directory", source)
	}
	op, err := f.begin(ctx, transferID)
	if err != nil {
		return err
	}
	defer f.finish(op)
	if progress != nil {
		progress(0, stat.Size())
	}
	reader := &ftpProgressReader{ctx: op.ctx, reader: file, total: stat.Size(), progress: progress}
	err = op.client.Stor(destination, reader)
	return ftpOperationError(op, err)
}

func (f *ftpFileSystem) Download(ctx context.Context, source, destination, transferID string, progress func(int64, int64)) error {
	op, err := f.begin(ctx, transferID)
	if err != nil {
		return err
	}
	defer f.finish(op)
	total, sizeErr := op.client.FileSize(source)
	if sizeErr != nil {
		if err := op.ctx.Err(); err != nil {
			return err
		}
		total = 0 // SIZE is optional; zero denotes an unknown total.
	}
	response, err := op.client.Retr(source)
	if err != nil {
		return ftpOperationError(op, err)
	}
	defer response.Close()

	temp, err := os.CreateTemp(filepath.Dir(destination), ".lucas-download-*")
	if err != nil {
		return err
	}
	tempName := temp.Name()
	committed := false
	defer func() {
		_ = temp.Close()
		if !committed {
			_ = os.Remove(tempName)
		}
	}()
	if progress != nil {
		progress(0, total)
	}
	writer := &ftpProgressWriter{ctx: op.ctx, writer: temp, total: total, progress: progress}
	if _, err = io.Copy(writer, response); err != nil {
		return ftpOperationError(op, err)
	}
	if err = response.Close(); err != nil {
		return ftpOperationError(op, err)
	}
	if err = temp.Close(); err != nil {
		return err
	}
	if err = op.ctx.Err(); err != nil {
		return err
	}
	if err = os.Rename(tempName, destination); err != nil {
		return err
	}
	committed = true
	return nil
}

func (f *ftpFileSystem) Cancel(transferID string) error {
	f.mu.Lock()
	op := f.transfers[transferID]
	f.mu.Unlock()
	if op == nil {
		return ErrFTPTransferNotFound
	}
	op.cancel()
	return nil
}

func ftpOperationError(op *ftpOperation, err error) error {
	if op.ctx.Err() != nil {
		return op.ctx.Err()
	}
	return err
}

type ftpProgressReader struct {
	ctx      context.Context
	reader   io.Reader
	done     int64
	total    int64
	progress func(int64, int64)
}

func (r *ftpProgressReader) Read(p []byte) (int, error) {
	if err := r.ctx.Err(); err != nil {
		return 0, err
	}
	n, err := r.reader.Read(p)
	r.done += int64(n)
	if n > 0 && r.progress != nil {
		r.progress(r.done, r.total)
	}
	return n, err
}

type ftpProgressWriter struct {
	ctx      context.Context
	writer   io.Writer
	done     int64
	total    int64
	progress func(int64, int64)
}

func (w *ftpProgressWriter) Write(p []byte) (int, error) {
	if err := w.ctx.Err(); err != nil {
		return 0, err
	}
	n, err := w.writer.Write(p)
	w.done += int64(n)
	if n > 0 && w.progress != nil {
		w.progress(w.done, w.total)
	}
	return n, err
}

// ftpConnSet tracks both control and passive data connections. Closing the set
// interrupts library calls without invoking ServerConn concurrently.
type ftpConnSet struct {
	mu     sync.Mutex
	closed bool
	conns  map[net.Conn]struct{}
}

func newFTPConnSet() *ftpConnSet { return &ftpConnSet{conns: make(map[net.Conn]struct{})} }

func (s *ftpConnSet) dial(ctx context.Context, network, address string) (net.Conn, error) {
	dialer := &net.Dialer{Timeout: 30 * time.Second, KeepAlive: 30 * time.Second}
	conn, err := dialer.DialContext(ctx, network, address)
	if err != nil {
		return nil, err
	}
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		_ = conn.Close()
		return nil, context.Canceled
	}
	s.conns[conn] = struct{}{}
	s.mu.Unlock()
	return conn, nil
}

func (s *ftpConnSet) closeAll() {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return
	}
	s.closed = true
	conns := make([]net.Conn, 0, len(s.conns))
	for conn := range s.conns {
		conns = append(conns, conn)
	}
	s.mu.Unlock()
	for _, conn := range conns {
		_ = conn.Close()
	}
}

func dialFTP(ctx context.Context, profile store.Profile, conns *ftpConnSet) (ftpClient, error) {
	host := strings.TrimSpace(profile.Host)
	if host == "" {
		return nil, fmt.Errorf("FTP host is required")
	}
	if profile.Port < 0 || profile.Port > 65535 {
		return nil, fmt.Errorf("invalid FTP port %d", profile.Port)
	}
	port := profile.Port
	if port == 0 {
		port = 21
	}
	if strings.HasPrefix(host, "[") && strings.HasSuffix(host, "]") {
		host = strings.TrimSuffix(strings.TrimPrefix(host, "["), "]")
	}
	server, err := ftp.Dial(
		net.JoinHostPort(host, strconv.Itoa(port)),
		ftp.DialWithDialFunc(func(network, address string) (net.Conn, error) {
			return conns.dial(ctx, network, address)
		}),
	)
	if err != nil {
		conns.closeAll()
		return nil, fmt.Errorf("connect FTP: %w", err)
	}
	username := profile.Username
	if username == "" {
		username = "anonymous"
	}
	password := profile.Password
	if username == "anonymous" && password == "" {
		password = "anonymous@"
	}
	if err := server.Login(username, password); err != nil {
		_ = server.Quit()
		conns.closeAll()
		return nil, fmt.Errorf("FTP login: %w", err)
	}
	return &realFTPClient{server: server}, nil
}

type realFTPClient struct{ server *ftp.ServerConn }

func (c *realFTPClient) CurrentDir() (string, error)             { return c.server.CurrentDir() }
func (c *realFTPClient) List(path string) ([]*ftp.Entry, error)  { return c.server.List(path) }
func (c *realFTPClient) MakeDir(path string) error               { return c.server.MakeDir(path) }
func (c *realFTPClient) Rename(from, to string) error            { return c.server.Rename(from, to) }
func (c *realFTPClient) Delete(path string) error                { return c.server.Delete(path) }
func (c *realFTPClient) RemoveDir(path string) error             { return c.server.RemoveDir(path) }
func (c *realFTPClient) RemoveDirRecur(path string) error        { return c.server.RemoveDirRecur(path) }
func (c *realFTPClient) FileSize(path string) (int64, error)     { return c.server.FileSize(path) }
func (c *realFTPClient) Stor(path string, r io.Reader) error     { return c.server.Stor(path, r) }
func (c *realFTPClient) Quit() error                             { return c.server.Quit() }
func (c *realFTPClient) Retr(path string) (io.ReadCloser, error) { return c.server.Retr(path) }
