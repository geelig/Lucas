package session

import (
	"bytes"
	"context"
	"errors"
	"testing"
	"time"

	"lucas/internal/store"
)

func TestManagerOutputAvailableBeforeDataCallbackAndAfterClose(t *testing.T) {
	conn := newFakeConnection()
	m := NewManager()
	if err := m.Register("local", func(store.Profile) Connector {
		return fakeConnector{conn: conn}
	}); err != nil {
		t.Fatal(err)
	}

	type result struct {
		data []byte
		err  error
	}
	beforeCallback := make(chan result, 1)
	info, err := m.Open(context.Background(), store.Profile{Protocol: "local"}, ConnectOptions{}, Hooks{
		Data: func(sessionID string, _ []byte) {
			data, err := m.Output(sessionID)
			beforeCallback <- result{data: data, err: err}
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	defer m.Close(info.ID)

	want := []byte("earliest terminal output")
	if _, err := conn.writes.Write(want); err != nil {
		t.Fatal(err)
	}
	select {
	case got := <-beforeCallback:
		if got.err != nil {
			t.Fatalf("Output in Data callback: %v", got.err)
		}
		if !bytes.Equal(got.data, want) {
			t.Fatalf("Output in Data callback = %q, want %q", got.data, want)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for Data callback")
	}

	if err := m.Close(info.ID); err != nil {
		t.Fatal(err)
	}
	got, err := m.Output(info.ID)
	if err != nil {
		t.Fatalf("Output after Close: %v", err)
	}
	if !bytes.Equal(got, want) {
		t.Fatalf("Output after Close = %q, want %q", got, want)
	}
	if _, err := m.Output("missing"); !errors.Is(err, ErrSessionNotFound) {
		t.Fatalf("missing Output error = %v, want %v", err, ErrSessionNotFound)
	}
}

func TestManagerOutputRetainsLatestMiB(t *testing.T) {
	conn := newFakeConnection()
	m := NewManager()
	if err := m.Register("local", func(store.Profile) Connector {
		return fakeConnector{conn: conn}
	}); err != nil {
		t.Fatal(err)
	}

	payload := make([]byte, maxSessionOutput+32*1024+17)
	for i := range payload {
		payload[i] = byte(i*31 + 7)
	}
	allDelivered := make(chan struct{})
	seen := 0
	info, err := m.Open(context.Background(), store.Profile{Protocol: "local"}, ConnectOptions{}, Hooks{
		Data: func(_ string, data []byte) {
			seen += len(data)
			if seen == len(payload) {
				close(allDelivered)
			}
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	defer m.Close(info.ID)

	if _, err := conn.writes.Write(payload); err != nil {
		t.Fatal(err)
	}
	select {
	case <-allDelivered:
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for buffered output")
	}

	got, err := m.Output(info.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != maxSessionOutput {
		t.Fatalf("Output length = %d, want %d", len(got), maxSessionOutput)
	}
	want := payload[len(payload)-maxSessionOutput:]
	if !bytes.Equal(got, want) {
		t.Fatal("Output did not retain the latest 1 MiB")
	}
}

func TestOutputSequenceTracksRawBytes(t *testing.T) {
	conn := newFakeConnection()
	m := NewManager()
	_ = m.Register("local", func(store.Profile) Connector { return fakeConnector{conn: conn} })
	var sequence uint64
	info, err := m.Open(context.Background(), store.Profile{Protocol: "local"}, ConnectOptions{}, Hooks{
		Sequence: func(_ string, value uint64, _ []byte) { sequence = value },
	})
	if err != nil {
		t.Fatal(err)
	}
	defer m.Close(info.ID)
	if _, err := conn.writes.Write([]byte("abc")); err != nil {
		t.Fatal(err)
	}
	if _, err := conn.writes.Write([]byte("de")); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(2 * time.Second)
	for sequence < 5 && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	if sequence != 5 {
		t.Fatalf("event sequence = %d", sequence)
	}
	state, err := m.OutputWithSequence(info.ID)
	if err != nil {
		t.Fatal(err)
	}
	if state.Sequence != 5 || string(state.Data) != "abcde" {
		t.Fatalf("state = %+v", state)
	}
}
