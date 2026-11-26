package session

import (
	"context"
	"errors"
	"fmt"
	"net"
	"os"
	"os/exec"
	"os/user"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/creack/pty"
	"lucas/internal/store"
)

func NewLocalFactory() Factory {
	return func(profile store.Profile) Connector { return NewLocalConnector(profile) }
}

func NewLocalConnector(profile store.Profile) Connector {
	return &localConnector{profile: profile}
}

type localConnector struct {
	profile store.Profile
}

func (c *localConnector) Connect(ctx context.Context, options ConnectOptions, _ Hooks) (Connection, FileSystem, error) {
	if err := ctx.Err(); err != nil {
		return nil, nil, err
	}
	shell := c.profile.Shell
	if shell == "" {
		shell = os.Getenv("SHELL")
	}
	if shell == "" {
		shell = "/bin/sh"
	}
	command := exec.Command(shell)
	if c.profile.Directory != "" {
		directory, err := cleanLocalPath(c.profile.Directory)
		if err != nil {
			return nil, nil, err
		}
		info, err := os.Stat(directory)
		if err != nil {
			return nil, nil, err
		}
		if !info.IsDir() {
			return nil, nil, fmt.Errorf("not a directory: %s", directory)
		}
		command.Dir = directory
	}
	command.Env = append(os.Environ(), "TERM=xterm-256color", "COLORTERM=truecolor")
	cols, rows, err := terminalSize(options)
	if err != nil {
		return nil, nil, err
	}
	terminal, err := pty.StartWithSize(command, &pty.Winsize{Cols: uint16(cols), Rows: uint16(rows)})
	if err != nil {
		return nil, nil, err
	}
	connection := &localConnection{terminal: terminal, command: command, waitDone: make(chan struct{})}
	go func() {
		connection.waitErr = command.Wait()
		close(connection.waitDone)
	}()
	return connection, NewLocalFS(), nil
}

func terminalSize(options ConnectOptions) (int, int, error) {
	cols, rows := options.Cols, options.Rows
	if cols == 0 {
		cols = 80
	}
	if rows == 0 {
		rows = 24
	}
	if cols < 1 || rows < 1 || cols > 65535 || rows > 65535 {
		return 0, 0, errors.New("invalid terminal size")
	}
	return cols, rows, nil
}

type localConnection struct {
	terminal *os.File
	command  *exec.Cmd
	closeOne sync.Once
	closeErr error
	waitDone chan struct{}
	waitErr  error
}

func (c *localConnection) Metrics(ctx context.Context) (Metrics, error) {
	if runtime.GOOS != "darwin" {
		return Metrics{}, errors.New("local metrics are currently supported only on macOS")
	}
	username := os.Getenv("USER")
	if current, err := user.Current(); err == nil && current.Username != "" {
		username = current.Username
	}
	cpuOutput, err := runLocalMetricCommand(ctx, "top", "-l", "2", "-n", "0", "-s", "1")
	if err != nil {
		return Metrics{}, err
	}
	cpu, err := parseDarwinCPU(cpuOutput)
	if err != nil {
		return Metrics{}, err
	}
	sysctlOutput, err := runLocalMetricCommand(ctx, "sysctl", "-n", "hw.memsize", "hw.pagesize")
	if err != nil {
		return Metrics{}, err
	}
	vmStatOutput, err := runLocalMetricCommand(ctx, "vm_stat")
	if err != nil {
		return Metrics{}, err
	}
	memoryTotal, memoryUsed, memoryPercent, err := parseDarwinMemory(sysctlOutput, vmStatOutput)
	if err != nil {
		return Metrics{}, err
	}
	firstNetwork, err := runLocalMetricCommand(ctx, "netstat", "-ibn")
	if err != nil {
		return Metrics{}, err
	}
	firstAt := time.Now()
	firstRx, firstTx, err := parseDarwinNetwork(firstNetwork)
	if err != nil {
		return Metrics{}, err
	}
	if err := waitMetricSample(ctx); err != nil {
		return Metrics{}, err
	}
	secondNetwork, err := runLocalMetricCommand(ctx, "netstat", "-ibn")
	if err != nil {
		return Metrics{}, err
	}
	secondAt := time.Now()
	secondRx, secondTx, err := parseDarwinNetwork(secondNetwork)
	if err != nil {
		return Metrics{}, err
	}
	rxRate, txRate, err := calculateNetworkRates(firstRx, firstTx, secondRx, secondTx, secondAt.Sub(firstAt))
	if err != nil {
		return Metrics{}, err
	}
	processOutput, err := runLocalMetricCommand(ctx, "/bin/sh", "-c", "LC_ALL=C ps -axo pid=,user=,pcpu=,pmem=,rss=,command= -r | head -n 20")
	if err != nil {
		return Metrics{}, err
	}
	processes, err := parseProcessList(processOutput)
	if err != nil {
		return Metrics{}, err
	}
	return Metrics{
		User: username, IP: localMetricIP(), CPUPercent: cpu,
		MemoryTotal: memoryTotal, MemoryUsed: memoryUsed, MemoryPercent: memoryPercent,
		RxBytesPerSecond: rxRate, TxBytesPerSecond: txRate, Processes: processes,
	}, nil
}

func localMetricIP() string {
	interfaces, err := net.Interfaces()
	if err != nil {
		return ""
	}
	for _, iface := range interfaces {
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
			continue
		}
		addresses, err := iface.Addrs()
		if err != nil {
			continue
		}
		for _, address := range addresses {
			var ip net.IP
			switch value := address.(type) {
			case *net.IPNet:
				ip = value.IP
			case *net.IPAddr:
				ip = value.IP
			}
			if ipv4 := ip.To4(); ipv4 != nil && !ipv4.IsLoopback() {
				return ipv4.String()
			}
		}
	}
	return ""
}

func (c *localConnection) TerminateProcess(ctx context.Context, pid int, signal string) error {
	signal, err := validateProcessTermination(pid, signal)
	if err != nil {
		return err
	}
	_, err = runLocalMetricCommand(ctx, "kill", "-"+signal, strconv.Itoa(pid))
	if err != nil && strings.Contains(err.Error(), "exit status") {
		return errors.New("process could not be terminated")
	}
	return err
}

func (c *localConnection) Read(data []byte) (int, error)  { return c.terminal.Read(data) }
func (c *localConnection) Write(data []byte) (int, error) { return c.terminal.Write(data) }
func (c *localConnection) Resize(cols, rows int) error {
	if cols < 1 || rows < 1 || cols > 65535 || rows > 65535 {
		return errors.New("invalid terminal size")
	}
	return pty.Setsize(c.terminal, &pty.Winsize{Cols: uint16(cols), Rows: uint16(rows)})
}

func (c *localConnection) Close() error {
	c.closeOne.Do(func() {
		select {
		case <-c.waitDone:
			// The child has already been reaped; signaling its Process handle
			// now would be both unnecessary and potentially misleading.
		default:
			if c.command.Process != nil {
				_ = c.command.Process.Signal(syscall.SIGHUP)
			}
		}
		c.closeErr = c.terminal.Close()
		select {
		case <-c.waitDone:
		case <-time.After(2 * time.Second):
			if c.command.Process != nil {
				_ = c.command.Process.Kill()
			}
			<-c.waitDone
		}
	})
	return c.closeErr
}

func (c *localConnection) Wait() error {
	<-c.waitDone
	return c.waitErr
}
