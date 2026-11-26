package session

import (
	"bytes"
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"lucas/internal/store"
)

type fakeConnection struct {
	mu      sync.Mutex
	reads   *io.PipeReader
	writes  *io.PipeWriter
	input   bytes.Buffer
	cols    int
	rows    int
	closed  bool
	waited  bool
	closeCh chan struct{}
}

func newFakeConnection() *fakeConnection {
	r, w := io.Pipe()
	return &fakeConnection{reads: r, writes: w, closeCh: make(chan struct{})}
}

func (c *fakeConnection) Read(p []byte) (int, error) { return c.reads.Read(p) }
func (c *fakeConnection) Write(p []byte) (int, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.input.Write(p)
}
func (c *fakeConnection) Close() error {
	c.mu.Lock()
	if !c.closed {
		c.closed = true
		close(c.closeCh)
	}
	c.mu.Unlock()
	c.writes.Close()
	return c.reads.Close()
}
func (c *fakeConnection) Resize(cols, rows int) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.cols, c.rows = cols, rows
	return nil
}
func (c *fakeConnection) Wait() error {
	<-c.closeCh
	c.mu.Lock()
	defer c.mu.Unlock()
	c.waited = true
	return nil
}

type fakeConnector struct {
	conn Connection
	fs   FileSystem
	err  error
}

func (f fakeConnector) Connect(context.Context, ConnectOptions, Hooks) (Connection, FileSystem, error) {
	return f.conn, f.fs, f.err
}

func TestManagerLifecycleAndRawRecording(t *testing.T) {
	conn := newFakeConnection()
	m := NewManager()
	if err := m.Register("ssh", func(store.Profile) Connector {
		return fakeConnector{conn: conn, fs: NewLocalFS()}
	}); err != nil {
		t.Fatal(err)
	}

	var mu sync.Mutex
	var received []byte
	info, err := m.Open(context.Background(), store.Profile{ID: "p1", Name: "test", Protocol: "ssh"}, ConnectOptions{}, Hooks{
		Data: func(_ string, data []byte) {
			mu.Lock()
			received = append(received, data...)
			mu.Unlock()
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if info.ID == "" || info.State != StateConnected || !info.SupportsFiles {
		t.Fatalf("unexpected info: %+v", info)
	}
	recording := filepath.Join(t.TempDir(), "raw.bin")
	if err := m.SetRecording(info.ID, recording); err != nil {
		t.Fatal(err)
	}
	want := []byte{0, 1, '\n', 0xff, 'x'}
	if _, err := conn.writes.Write(want); err != nil {
		t.Fatal(err)
	}
	if err := m.Write(info.ID, []byte("input")); err != nil {
		t.Fatal(err)
	}
	if err := m.Resize(info.ID, 120, 40); err != nil {
		t.Fatal(err)
	}
	if err := m.Close(info.ID); err != nil {
		t.Fatal(err)
	}
	if err := m.Close(info.ID); err != nil {
		t.Fatalf("close must be idempotent: %v", err)
	}
	got, err := os.ReadFile(recording)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, want) {
		t.Fatalf("recording = %v, want %v", got, want)
	}
	mu.Lock()
	dataOK := bytes.Equal(received, want)
	mu.Unlock()
	if !dataOK {
		t.Fatalf("callback data = %v, want %v", received, want)
	}
	conn.mu.Lock()
	defer conn.mu.Unlock()
	if !conn.closed || !conn.waited || conn.input.String() != "input" || conn.cols != 120 || conn.rows != 40 {
		t.Fatalf("resources or calls not completed: %+v", conn)
	}
	if got := m.List(); len(got) != 1 || got[0].State != StateClosed || got[0].Recording {
		t.Fatalf("unexpected session list: %+v", got)
	}
}

func TestManagerRejectsUnknownOperations(t *testing.T) {
	m := NewManager()
	if err := m.Register("", func(store.Profile) Connector { return nil }); err == nil {
		t.Fatal("expected empty protocol error")
	}
	if err := m.Register("local", nil); err == nil {
		t.Fatal("expected nil factory error")
	}
	if _, err := m.Open(context.Background(), store.Profile{Protocol: "missing"}, ConnectOptions{}, Hooks{}); err == nil {
		t.Fatal("expected missing factory error")
	}
	if err := m.Close("missing"); err != nil {
		t.Fatalf("closing a missing session must be harmless: %v", err)
	}
	if err := m.Write("missing", nil); !errors.Is(err, ErrSessionNotFound) {
		t.Fatalf("write error = %v", err)
	}
	if _, err := m.Files("missing"); !errors.Is(err, ErrSessionNotFound) {
		t.Fatalf("files error = %v", err)
	}
}

func TestManagerCloseWhileOutputIsBlocked(t *testing.T) {
	conn := newFakeConnection()
	m := NewManager()
	_ = m.Register("local", func(store.Profile) Connector {
		return fakeConnector{conn: conn}
	})
	info, err := m.Open(context.Background(), store.Profile{Protocol: "local"}, ConnectOptions{}, Hooks{})
	if err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { done <- m.Close(info.ID) }()
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("Close did not release the read loop")
	}
}
