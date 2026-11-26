package session

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net"
	"reflect"
	"testing"
	"time"
)

func TestTelnetConnectAddressAndDefaults(t *testing.T) {
	var gotAddress string
	peer := &memoryNetConn{}
	connector := &telnetConnector{
		profileHost: "[2001:db8::1]",
		dial: func(_ context.Context, network, address string) (net.Conn, error) {
			if network != "tcp" {
				t.Fatalf("network=%q", network)
			}
			gotAddress = address
			return peer, nil
		},
	}
	conn, files, err := connector.Connect(context.Background(), ConnectOptions{}, Hooks{})
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	if gotAddress != "[2001:db8::1]:23" || files != nil {
		t.Fatalf("address=%q files=%v", gotAddress, files)
	}
	terminal := conn.(*telnetConnection)
	if terminal.cols != 80 || terminal.rows != 24 {
		t.Fatalf("size=%dx%d", terminal.cols, terminal.rows)
	}
}

func TestTelnetNegotiationAndTerminalData(t *testing.T) {
	conn := newTelnetConnection(&memoryNetConn{}, 80, 24)
	var control bytes.Buffer
	conn.controlWrite = func(p []byte) error {
		_, err := control.Write(p)
		return err
	}
	input := []byte{
		'a',
		telnetIAC, telnetWILL, telnetOptEcho,
		telnetIAC, telnetDO, telnetOptNAWS,
		telnetIAC, telnetIAC,
		telnetIAC, telnetSB, telnetOptTerminalType, telnetTerminalTypeSend, telnetIAC, telnetSE,
		'z',
	}
	for _, b := range input {
		if err := conn.feed([]byte{b}); err != nil {
			t.Fatal(err)
		}
	}
	if !bytes.Equal(conn.output, []byte{'a', telnetIAC, 'z'}) {
		t.Fatalf("terminal data=%v", conn.output)
	}
	want := []byte{
		telnetIAC, telnetDO, telnetOptEcho,
		telnetIAC, telnetWILL, telnetOptNAWS,
		telnetIAC, telnetSB, telnetOptNAWS, 0, 80, 0, 24, telnetIAC, telnetSE,
		telnetIAC, telnetSB, telnetOptTerminalType, telnetTerminalTypeIS,
	}
	want = append(want, "xterm-256color"...)
	want = append(want, telnetIAC, telnetSE)
	if !bytes.Equal(control.Bytes(), want) {
		t.Fatalf("negotiation:\n got %v\nwant %v", control.Bytes(), want)
	}
}

func TestTelnetReadStripsCommands(t *testing.T) {
	peer := &memoryNetConn{reader: bytes.NewReader([]byte{
		telnetIAC, telnetWILL, telnetOptSuppressGA,
		'h', 'i', telnetIAC, telnetIAC,
	})}
	conn := newTelnetConnection(peer, 80, 24)
	data, err := io.ReadAll(conn)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(data, []byte{'h', 'i', telnetIAC}) {
		t.Fatalf("data=%v", data)
	}
	if !bytes.Equal(peer.written.Bytes(), []byte{telnetIAC, telnetDO, telnetOptSuppressGA}) {
		t.Fatalf("reply=%v", peer.written.Bytes())
	}
}

func TestTelnetWriteEscapesIAC(t *testing.T) {
	peer := &memoryNetConn{}
	conn := newTelnetConnection(peer, 80, 24)
	n, err := conn.Write([]byte{'a', telnetIAC, 'b'})
	if err != nil || n != 3 {
		t.Fatalf("n=%d err=%v", n, err)
	}
	if !bytes.Equal(peer.written.Bytes(), []byte{'a', telnetIAC, telnetIAC, 'b'}) {
		t.Fatalf("wire data=%v", peer.written.Bytes())
	}
}

func TestTelnetResizeSendsNAWSAndEscapesPayload(t *testing.T) {
	conn := newTelnetConnection(&memoryNetConn{}, 80, 24)
	var control bytes.Buffer
	conn.controlWrite = func(p []byte) error {
		_, err := control.Write(p)
		return err
	}
	if err := conn.feed([]byte{telnetIAC, telnetDO, telnetOptNAWS}); err != nil {
		t.Fatal(err)
	}
	control.Reset()
	if err := conn.Resize(255, 2); err != nil {
		t.Fatal(err)
	}
	want := []byte{telnetIAC, telnetSB, telnetOptNAWS, 0, telnetIAC, telnetIAC, 0, 2, telnetIAC, telnetSE}
	if !bytes.Equal(control.Bytes(), want) {
		t.Fatalf("NAWS=%v want=%v", control.Bytes(), want)
	}
	if err := conn.Resize(0, 24); err == nil {
		t.Fatal("expected invalid size error")
	}
}

func TestTelnetRejectsUnsupportedOptions(t *testing.T) {
	conn := newTelnetConnection(&memoryNetConn{}, 80, 24)
	var control bytes.Buffer
	conn.controlWrite = func(p []byte) error {
		_, err := control.Write(p)
		return err
	}
	if err := conn.feed([]byte{telnetIAC, telnetWILL, 99, telnetIAC, telnetDO, 100}); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(control.Bytes(), []byte{telnetIAC, telnetDONT, 99, telnetIAC, telnetWONT, 100}) {
		t.Fatalf("replies=%v", control.Bytes())
	}
}

func TestTelnetConnectDialError(t *testing.T) {
	want := errors.New("dial failed")
	connector := &telnetConnector{profileHost: "example", dial: func(context.Context, string, string) (net.Conn, error) {
		return nil, want
	}}
	if _, _, err := connector.Connect(context.Background(), ConnectOptions{}, Hooks{}); !errors.Is(err, want) {
		t.Fatalf("got %v", err)
	}
}

type memoryNetConn struct {
	reader  *bytes.Reader
	written bytes.Buffer
	closed  bool
}

func (c *memoryNetConn) Read(p []byte) (int, error) {
	if c.reader == nil {
		return 0, io.EOF
	}
	return c.reader.Read(p)
}
func (c *memoryNetConn) Write(p []byte) (int, error) { return c.written.Write(p) }
func (c *memoryNetConn) Close() error {
	c.closed = true
	return nil
}
func (c *memoryNetConn) LocalAddr() net.Addr              { return memoryAddr("local") }
func (c *memoryNetConn) RemoteAddr() net.Addr             { return memoryAddr("remote") }
func (c *memoryNetConn) SetDeadline(time.Time) error      { return nil }
func (c *memoryNetConn) SetReadDeadline(time.Time) error  { return nil }
func (c *memoryNetConn) SetWriteDeadline(time.Time) error { return nil }

type memoryAddr string

func (a memoryAddr) Network() string { return "memory" }
func (a memoryAddr) String() string  { return string(a) }
