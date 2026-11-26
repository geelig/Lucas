package session

import (
	"bytes"
	"context"
	"testing"
	"time"

	"lucas/internal/store"
)

func TestLocalConnectorShellAndResize(t *testing.T) {
	conn, fs, err := NewLocalConnector(store.Profile{Shell: "/bin/sh", Directory: t.TempDir()}).Connect(
		context.Background(), ConnectOptions{Cols: 90, Rows: 30}, Hooks{},
	)
	if err != nil {
		t.Fatal(err)
	}
	if fs == nil {
		t.Fatal("local sessions must expose a file system")
	}
	if err := conn.Resize(100, 35); err != nil {
		t.Fatal(err)
	}
	if _, err := conn.Write([]byte("printf 'lucas-local-ok\\n'; exit\n")); err != nil {
		t.Fatal(err)
	}
	output := make(chan []byte, 1)
	go func() {
		var data []byte
		buf := make([]byte, 256)
		// PTY input echo contains the marker as part of the printf command.
		// Wait for the marker on its own output line before expecting exit.
		for !bytes.Contains(data, []byte("\nlucas-local-ok\r\n")) {
			n, err := conn.Read(buf)
			data = append(data, buf[:n]...)
			if err != nil {
				break
			}
		}
		output <- data
	}()
	select {
	case data := <-output:
		if !bytes.Contains(data, []byte("lucas-local-ok")) {
			t.Fatalf("output = %q", data)
		}
	case <-time.After(5 * time.Second):
		_ = conn.Close()
		t.Fatal("timed out reading local shell")
	}
	// Exercise the lifecycle the application actually uses: close the terminal,
	// then wait for process reaping. A deliberate SIGHUP is a valid exit here.
	_ = conn.Close()
	waited := make(chan error, 1)
	go func() { waited <- conn.Wait() }()
	select {
	case <-waited:
	case <-time.After(5 * time.Second):
		t.Fatal("local shell was not reaped after close")
	}
	_ = conn.Close()
}
