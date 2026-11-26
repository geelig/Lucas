package session

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"sync"

	"go.bug.st/serial"

	"lucas/internal/store"
)

type serialOpenFunc func(string, *serial.Mode) (serial.Port, error)

type serialConnector struct {
	profile store.Profile
	open    serialOpenFunc
}

// SerialFactory creates serial connectors. Serial ports do not expose files.
var SerialFactory Factory = func(profile store.Profile) Connector {
	return &serialConnector{profile: profile, open: serial.Open}
}

// ListSerialPorts returns the stable, sorted names of available serial ports.
func ListSerialPorts() ([]string, error) {
	ports, err := enumerateSerialPorts()
	if err != nil {
		return nil, err
	}
	sort.Strings(ports)
	return ports, nil
}

var enumerateSerialPorts = serial.GetPortsList

func (c *serialConnector) Connect(ctx context.Context, _ ConnectOptions, _ Hooks) (Connection, FileSystem, error) {
	if err := ctx.Err(); err != nil {
		return nil, nil, err
	}
	mode, err := makeSerialMode(c.profile)
	if err != nil {
		return nil, nil, err
	}
	name := strings.TrimSpace(c.profile.SerialPort)
	if name == "" {
		return nil, nil, fmt.Errorf("serial port is required")
	}
	port, err := c.open(name, mode)
	if err != nil {
		return nil, nil, fmt.Errorf("open serial port %q: %w", name, err)
	}
	if err := ctx.Err(); err != nil {
		_ = port.Close()
		return nil, nil, err
	}
	return &serialConnection{port: port}, nil, nil
}

func makeSerialMode(profile store.Profile) (*serial.Mode, error) {
	baud := profile.Baud
	if baud == 0 {
		baud = 9600
	}
	if baud < 0 {
		return nil, fmt.Errorf("invalid serial baud rate %d", baud)
	}

	dataBits := profile.DataBits
	if dataBits == 0 {
		dataBits = 8
	}
	if dataBits < 5 || dataBits > 8 {
		return nil, fmt.Errorf("invalid serial data bits %d: use 5, 6, 7, or 8", dataBits)
	}

	stopBits := profile.StopBits
	if stopBits == 0 {
		stopBits = 1
	}
	var stops serial.StopBits
	switch stopBits {
	case 1:
		stops = serial.OneStopBit
	case 15: // Profile.StopBits is an integer; 15 represents 1.5 stop bits.
		stops = serial.OnePointFiveStopBits
	case 2:
		stops = serial.TwoStopBits
	default:
		return nil, fmt.Errorf("invalid serial stop bits %d: use 1, 15 (1.5), or 2", stopBits)
	}

	var parity serial.Parity
	switch strings.ToLower(strings.TrimSpace(profile.Parity)) {
	case "", "none", "n":
		parity = serial.NoParity
	case "odd", "o":
		parity = serial.OddParity
	case "even", "e":
		parity = serial.EvenParity
	case "mark", "m":
		parity = serial.MarkParity
	case "space", "s":
		parity = serial.SpaceParity
	default:
		return nil, fmt.Errorf("invalid serial parity %q", profile.Parity)
	}

	switch strings.ToLower(strings.TrimSpace(profile.Flow)) {
	case "", "none", "n":
		// No flow control is the library default.
	case "rtscts", "rts/cts", "cts/rts", "hardware", "xonxoff", "xon/xoff", "software":
		return nil, fmt.Errorf("serial flow control %q is not supported by go.bug.st/serial", profile.Flow)
	default:
		return nil, fmt.Errorf("invalid serial flow control %q", profile.Flow)
	}

	return &serial.Mode{
		BaudRate: baud,
		DataBits: dataBits,
		Parity:   parity,
		StopBits: stops,
	}, nil
}

type serialConnection struct {
	port      serial.Port
	closeOnce sync.Once
	closeErr  error
}

func (c *serialConnection) Read(p []byte) (int, error)  { return c.port.Read(p) }
func (c *serialConnection) Write(p []byte) (int, error) { return c.port.Write(p) }

func (c *serialConnection) Close() error {
	c.closeOnce.Do(func() { c.closeErr = c.port.Close() })
	return c.closeErr
}

// Resize has no serial-port equivalent.
func (c *serialConnection) Resize(_, _ int) error { return nil }

// Wait has no process to wait for; Read reports device disconnection.
func (c *serialConnection) Wait() error { return nil }
