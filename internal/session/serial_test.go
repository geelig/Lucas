package session

import (
	"bytes"
	"context"
	"errors"
	"io"
	"reflect"
	"testing"
	"time"

	"go.bug.st/serial"

	"lucas/internal/store"
)

func TestMakeSerialModeDefaults(t *testing.T) {
	mode, err := makeSerialMode(store.Profile{})
	if err != nil {
		t.Fatal(err)
	}
	if mode.BaudRate != 9600 || mode.DataBits != 8 || mode.StopBits != serial.OneStopBit || mode.Parity != serial.NoParity {
		t.Fatalf("unexpected defaults: %+v", mode)
	}
}

func TestMakeSerialModeParameters(t *testing.T) {
	tests := []struct {
		parity string
		want   serial.Parity
	}{
		{"none", serial.NoParity},
		{"O", serial.OddParity},
		{"even", serial.EvenParity},
		{"mark", serial.MarkParity},
		{"space", serial.SpaceParity},
	}
	for _, test := range tests {
		mode, err := makeSerialMode(store.Profile{Baud: 115200, DataBits: 7, StopBits: 2, Parity: test.parity, Flow: "none"})
		if err != nil {
			t.Fatalf("parity %q: %v", test.parity, err)
		}
		if mode.BaudRate != 115200 || mode.DataBits != 7 || mode.StopBits != serial.TwoStopBits || mode.Parity != test.want {
			t.Fatalf("parity %q: unexpected mode %+v", test.parity, mode)
		}
	}
	mode, err := makeSerialMode(store.Profile{StopBits: 15})
	if err != nil || mode.StopBits != serial.OnePointFiveStopBits {
		t.Fatalf("1.5 stop bits: mode=%+v err=%v", mode, err)
	}
}

func TestMakeSerialModeRejectsInvalidParameters(t *testing.T) {
	profiles := []store.Profile{
		{Baud: -1},
		{DataBits: 9},
		{StopBits: 3},
		{Parity: "invalid"},
		{Flow: "rtscts"},
		{Flow: "xonxoff"},
	}
	for _, profile := range profiles {
		if _, err := makeSerialMode(profile); err == nil {
			t.Fatalf("expected error for %+v", profile)
		}
	}
}

func TestSerialConnectorAndConnection(t *testing.T) {
	fake := &fakeSerialPort{}
	connector := &serialConnector{
		profile: store.Profile{SerialPort: "test-port", Baud: 57600},
		open: func(name string, mode *serial.Mode) (serial.Port, error) {
			if name != "test-port" || mode.BaudRate != 57600 {
				t.Fatalf("unexpected open: %q %+v", name, mode)
			}
			return fake, nil
		},
	}
	conn, files, err := connector.Connect(context.Background(), ConnectOptions{}, Hooks{})
	if err != nil {
		t.Fatal(err)
	}
	if files != nil {
		t.Fatal("serial unexpectedly provides a file system")
	}
	fake.read = bytes.NewReader([]byte("input"))
	buffer := make([]byte, 5)
	if _, err = io.ReadFull(conn, buffer); err != nil || string(buffer) != "input" {
		t.Fatalf("read=%q err=%v", buffer, err)
	}
	if _, err = conn.Write([]byte("output")); err != nil {
		t.Fatal(err)
	}
	if fake.written.String() != "output" {
		t.Fatalf("written %q", fake.written.String())
	}
	if err = conn.Resize(120, 40); err != nil || conn.Wait() != nil {
		t.Fatalf("resize/wait failed: %v", err)
	}
	if err = conn.Close(); err != nil {
		t.Fatal(err)
	}
	if err = conn.Close(); err != nil || fake.closeCalls != 1 {
		t.Fatalf("close calls=%d err=%v", fake.closeCalls, err)
	}
}

func TestSerialConnectorHonorsContext(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	called := false
	connector := &serialConnector{
		profile: store.Profile{SerialPort: "unused"},
		open: func(string, *serial.Mode) (serial.Port, error) {
			called = true
			return &fakeSerialPort{}, nil
		},
	}
	if _, _, err := connector.Connect(ctx, ConnectOptions{}, Hooks{}); !errors.Is(err, context.Canceled) {
		t.Fatalf("got %v", err)
	}
	if called {
		t.Fatal("opened a port with an already canceled context")
	}
}

func TestListSerialPortsSorted(t *testing.T) {
	original := enumerateSerialPorts
	defer func() { enumerateSerialPorts = original }()
	enumerateSerialPorts = func() ([]string, error) {
		return []string{"/dev/tty.z", "/dev/tty.a"}, nil
	}
	ports, err := ListSerialPorts()
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(ports, []string{"/dev/tty.a", "/dev/tty.z"}) {
		t.Fatalf("ports=%v", ports)
	}
}

type fakeSerialPort struct {
	read       *bytes.Reader
	written    bytes.Buffer
	closeCalls int
}

func (p *fakeSerialPort) SetMode(*serial.Mode) error { return nil }
func (p *fakeSerialPort) Read(buffer []byte) (int, error) {
	if p.read == nil {
		return 0, io.EOF
	}
	return p.read.Read(buffer)
}
func (p *fakeSerialPort) Write(buffer []byte) (int, error) { return p.written.Write(buffer) }
func (p *fakeSerialPort) Drain() error                     { return nil }
func (p *fakeSerialPort) ResetInputBuffer() error          { return nil }
func (p *fakeSerialPort) ResetOutputBuffer() error         { return nil }
func (p *fakeSerialPort) SetDTR(bool) error                { return nil }
func (p *fakeSerialPort) SetRTS(bool) error                { return nil }
func (p *fakeSerialPort) GetModemStatusBits() (*serial.ModemStatusBits, error) {
	return &serial.ModemStatusBits{}, nil
}
func (p *fakeSerialPort) SetReadTimeout(time.Duration) error { return nil }
func (p *fakeSerialPort) Close() error {
	p.closeCalls++
	return nil
}
func (p *fakeSerialPort) Break(time.Duration) error { return nil }
