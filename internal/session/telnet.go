package session

import (
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"net"
	"strconv"
	"strings"
	"sync"
	"time"

	"lucas/internal/store"
)

const (
	telnetSE   byte = 240
	telnetSB   byte = 250
	telnetWILL byte = 251
	telnetWONT byte = 252
	telnetDO   byte = 253
	telnetDONT byte = 254
	telnetIAC  byte = 255

	telnetOptEcho         byte = 1
	telnetOptSuppressGA   byte = 3
	telnetOptTerminalType byte = 24
	telnetOptNAWS         byte = 31

	telnetTerminalTypeIS   byte = 0
	telnetTerminalTypeSend byte = 1

	telnetMaxSubnegotiation = 64 * 1024
)

type telnetDialFunc func(context.Context, string, string) (net.Conn, error)

type telnetConnector struct {
	profileHost string
	port        int
	dial        telnetDialFunc
}

// TelnetFactory creates TCP Telnet connectors without automatic login.
var TelnetFactory Factory = func(profile store.Profile) Connector {
	dialer := &net.Dialer{Timeout: 30 * time.Second, KeepAlive: 30 * time.Second}
	return &telnetConnector{profileHost: profile.Host, port: profile.Port, dial: dialer.DialContext}
}

func (c *telnetConnector) Connect(ctx context.Context, options ConnectOptions, _ Hooks) (Connection, FileSystem, error) {
	if strings.TrimSpace(c.profileHost) == "" {
		return nil, nil, fmt.Errorf("telnet host is required")
	}
	if c.port < 0 || c.port > 65535 {
		return nil, nil, fmt.Errorf("invalid telnet port %d", c.port)
	}
	if options.Cols > 65535 || options.Rows > 65535 {
		return nil, nil, fmt.Errorf("terminal size exceeds Telnet NAWS limits")
	}
	conn, err := c.dial(ctx, "tcp", telnetAddress(c.profileHost, c.port))
	if err != nil {
		return nil, nil, fmt.Errorf("connect telnet: %w", err)
	}
	if err := ctx.Err(); err != nil {
		_ = conn.Close()
		return nil, nil, err
	}
	return newTelnetConnection(conn, options.Cols, options.Rows), nil, nil
}

// telnetConnection implements an incremental RFC 855 command parser. Terminal
// data and IAC-escaped 0xff bytes are exposed through Read; commands are not.
type telnetConnection struct {
	conn net.Conn

	writeMu      sync.Mutex
	controlWrite func([]byte) error
	closeOnce    sync.Once
	closeErr     error

	state          byte
	negotiateVerb  byte
	subnegotiation []byte
	subnegOverflow bool
	output         []byte
	pendingErr     error

	stateMu sync.Mutex
	cols    int
	rows    int
	naws    bool
}

func newTelnetConnection(conn net.Conn, cols, rows int) *telnetConnection {
	if cols <= 0 {
		cols = 80
	}
	if rows <= 0 {
		rows = 24
	}
	c := &telnetConnection{conn: conn, cols: cols, rows: rows}
	c.controlWrite = c.writeRaw
	return c
}

func (c *telnetConnection) Read(p []byte) (int, error) {
	if len(p) == 0 {
		return 0, nil
	}
	for {
		if len(c.output) > 0 {
			n := copy(p, c.output)
			c.output = c.output[n:]
			return n, nil
		}
		if c.pendingErr != nil {
			err := c.pendingErr
			c.pendingErr = nil
			return 0, err
		}

		var buffer [4096]byte
		n, readErr := c.conn.Read(buffer[:])
		if n > 0 {
			if err := c.feed(buffer[:n]); err != nil {
				if readErr != nil {
					readErr = errors.Join(err, readErr)
				} else {
					readErr = err
				}
			}
		}
		if readErr != nil {
			c.pendingErr = readErr
		}
		if len(c.output) == 0 && c.pendingErr != nil {
			err := c.pendingErr
			c.pendingErr = nil
			return 0, err
		}
	}
}

func (c *telnetConnection) Write(p []byte) (int, error) {
	if len(p) == 0 {
		return 0, nil
	}
	escaped := make([]byte, 0, len(p))
	for _, b := range p {
		escaped = append(escaped, b)
		if b == telnetIAC {
			escaped = append(escaped, telnetIAC)
		}
	}
	if err := c.writeRaw(escaped); err != nil {
		return 0, err
	}
	return len(p), nil
}

func (c *telnetConnection) Close() error {
	c.closeOnce.Do(func() { c.closeErr = c.conn.Close() })
	return c.closeErr
}

func (c *telnetConnection) Wait() error { return nil }

func (c *telnetConnection) Resize(cols, rows int) error {
	if cols <= 0 || rows <= 0 {
		return fmt.Errorf("invalid terminal size %dx%d", cols, rows)
	}
	if cols > 65535 || rows > 65535 {
		return fmt.Errorf("terminal size %dx%d exceeds Telnet NAWS limits", cols, rows)
	}
	c.stateMu.Lock()
	c.cols, c.rows = cols, rows
	naws := c.naws
	c.stateMu.Unlock()
	if naws {
		return c.sendNAWS()
	}
	return nil
}

func (c *telnetConnection) writeRaw(p []byte) error {
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	for len(p) > 0 {
		n, err := c.conn.Write(p)
		if err != nil {
			return err
		}
		if n == 0 {
			return io.ErrShortWrite
		}
		p = p[n:]
	}
	return nil
}

func (c *telnetConnection) send(bytes ...byte) error {
	return c.controlWrite(bytes)
}

func (c *telnetConnection) sendNAWS() error {
	c.stateMu.Lock()
	cols, rows := c.cols, c.rows
	c.stateMu.Unlock()
	payload := make([]byte, 4)
	binary.BigEndian.PutUint16(payload[0:2], uint16(cols))
	binary.BigEndian.PutUint16(payload[2:4], uint16(rows))
	message := []byte{telnetIAC, telnetSB, telnetOptNAWS}
	for _, b := range payload {
		message = append(message, b)
		if b == telnetIAC {
			message = append(message, telnetIAC)
		}
	}
	message = append(message, telnetIAC, telnetSE)
	return c.send(message...)
}

func (c *telnetConnection) feed(p []byte) error {
	for _, b := range p {
		switch c.state {
		case 0:
			if b == telnetIAC {
				c.state = telnetIAC
			} else {
				c.output = append(c.output, b)
			}
		case telnetIAC:
			switch b {
			case telnetIAC:
				c.output = append(c.output, telnetIAC)
				c.state = 0
			case telnetWILL, telnetWONT, telnetDO, telnetDONT:
				c.negotiateVerb = b
				c.state = b
			case telnetSB:
				c.subnegotiation = c.subnegotiation[:0]
				c.subnegOverflow = false
				c.state = telnetSB
			default:
				// Other two-byte commands do not belong in the terminal stream.
				c.state = 0
			}
		case telnetWILL, telnetWONT, telnetDO, telnetDONT:
			if err := c.negotiate(c.negotiateVerb, b); err != nil {
				return err
			}
			c.state = 0
		case telnetSB:
			if b == telnetIAC {
				c.state = telnetSE
			} else if len(c.subnegotiation) < telnetMaxSubnegotiation {
				c.subnegotiation = append(c.subnegotiation, b)
			} else {
				c.subnegOverflow = true
			}
		case telnetSE: // IAC inside a subnegotiation; SE ends it.
			switch b {
			case telnetSE:
				if !c.subnegOverflow {
					if err := c.handleSubnegotiation(c.subnegotiation); err != nil {
						return err
					}
				}
				c.subnegotiation = nil
				c.state = 0
			case telnetIAC:
				if !c.subnegOverflow {
					c.subnegotiation = append(c.subnegotiation, telnetIAC)
				}
				c.state = telnetSB
			default:
				// Discard malformed subnegotiation commands and remain inside SB.
				c.state = telnetSB
			}
		}
	}
	return nil
}

func (c *telnetConnection) negotiate(verb, option byte) error {
	switch verb {
	case telnetWILL:
		if option == telnetOptEcho || option == telnetOptSuppressGA {
			return c.send(telnetIAC, telnetDO, option)
		}
		return c.send(telnetIAC, telnetDONT, option)
	case telnetWONT:
		if option == telnetOptEcho || option == telnetOptSuppressGA {
			return c.send(telnetIAC, telnetDONT, option)
		}
		return nil
	case telnetDO:
		switch option {
		case telnetOptNAWS:
			c.stateMu.Lock()
			c.naws = true
			c.stateMu.Unlock()
			if err := c.send(telnetIAC, telnetWILL, option); err != nil {
				return err
			}
			return c.sendNAWS()
		case telnetOptTerminalType:
			return c.send(telnetIAC, telnetWILL, option)
		default:
			return c.send(telnetIAC, telnetWONT, option)
		}
	case telnetDONT:
		if option == telnetOptNAWS {
			c.stateMu.Lock()
			enabled := c.naws
			c.naws = false
			c.stateMu.Unlock()
			if enabled {
				return c.send(telnetIAC, telnetWONT, option)
			}
		} else if option == telnetOptTerminalType {
			return c.send(telnetIAC, telnetWONT, option)
		}
	}
	return nil
}

func (c *telnetConnection) handleSubnegotiation(p []byte) error {
	if len(p) == 2 && p[0] == telnetOptTerminalType && p[1] == telnetTerminalTypeSend {
		message := []byte{telnetIAC, telnetSB, telnetOptTerminalType, telnetTerminalTypeIS}
		message = append(message, "xterm-256color"...)
		message = append(message, telnetIAC, telnetSE)
		return c.send(message...)
	}
	return nil
}

func telnetAddress(host string, port int) string {
	host = strings.TrimSpace(host)
	if strings.HasPrefix(host, "[") && strings.HasSuffix(host, "]") {
		host = strings.TrimSuffix(strings.TrimPrefix(host, "["), "]")
	}
	if port == 0 {
		port = 23
	}
	return net.JoinHostPort(host, strconv.Itoa(port))
}
