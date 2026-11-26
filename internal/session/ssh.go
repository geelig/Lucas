package session

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"os/user"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/pkg/sftp"
	"golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/agent"
	"golang.org/x/crypto/ssh/knownhosts"
	"lucas/internal/store"
)

var (
	ErrHostKeyChanged = errors.New("SSH host key has changed")
	ErrHostKeyUnknown = errors.New("SSH host key was not confirmed")
)

// ProfileResolver resolves a jump profile without coupling session to storage.
type ProfileResolver func(context.Context, string) (store.Profile, error)

type SSHOptions struct {
	KnownHostsPath string // defaults to ~/.ssh/known_hosts
	AgentSocket    string // defaults to SSH_AUTH_SOCK
}

// NewSSHFactory accepts zero or one resolver. Jump profiles are dialed as SSH
// clients and the target connection is tunneled through that client.
func NewSSHFactory(resolvers ...ProfileResolver) Factory {
	return NewSSHFactoryWithOptions(SSHOptions{}, resolvers...)
}

func NewSSHFactoryWithOptions(options SSHOptions, resolvers ...ProfileResolver) Factory {
	var resolver ProfileResolver
	if len(resolvers) > 0 {
		resolver = resolvers[0]
	}
	return func(profile store.Profile) Connector {
		return &sshConnector{profile: profile, resolver: resolver, options: options}
	}
}

func NewSSHConnector(profile store.Profile) Connector {
	return &sshConnector{profile: profile}
}

type sshConnector struct {
	profile  store.Profile
	resolver ProfileResolver
	options  SSHOptions
}

func (c *sshConnector) Connect(ctx context.Context, options ConnectOptions, hooks Hooks) (Connection, FileSystem, error) {
	chain, err := c.openClient(ctx, hooks, make(map[string]bool), 0)
	if err != nil {
		return nil, nil, err
	}
	fileClient, err := sftp.NewClient(chain.client)
	if err != nil {
		_ = chain.Close()
		return nil, nil, err
	}
	chain.sftp = fileClient

	terminal, err := chain.client.NewSession()
	if err != nil {
		_ = chain.Close()
		return nil, nil, err
	}
	stdin, err := terminal.StdinPipe()
	if err != nil {
		_ = terminal.Close()
		_ = chain.Close()
		return nil, nil, err
	}
	stdout, err := terminal.StdoutPipe()
	if err != nil {
		_ = terminal.Close()
		_ = chain.Close()
		return nil, nil, err
	}
	stderr, err := terminal.StderrPipe()
	if err != nil {
		_ = terminal.Close()
		_ = chain.Close()
		return nil, nil, err
	}
	cols, rows, err := terminalSize(options)
	if err != nil {
		_ = terminal.Close()
		_ = chain.Close()
		return nil, nil, err
	}
	modes := ssh.TerminalModes{ssh.TTY_OP_ISPEED: 38400, ssh.TTY_OP_OSPEED: 38400}
	if err := terminal.RequestPty("xterm-256color", rows, cols, modes); err != nil {
		_ = terminal.Close()
		_ = chain.Close()
		return nil, nil, err
	}
	if err := terminal.Shell(); err != nil {
		_ = terminal.Close()
		_ = chain.Close()
		return nil, nil, err
	}
	reader, writer := io.Pipe()
	go combineSSHOutput(stdout, stderr, writer)
	connection := &sshConnection{
		terminal: terminal, stdin: stdin, output: reader, chain: chain,
	}
	connection.osName = detectSSHOS(ctx, chain.client)
	return connection, &sftpFileSystem{client: fileClient}, nil
}

func combineSSHOutput(stdout, stderr io.Reader, output *io.PipeWriter) {
	var copies sync.WaitGroup
	copies.Add(2)
	for _, reader := range []io.Reader{stdout, stderr} {
		go func() {
			defer copies.Done()
			_, _ = io.Copy(output, reader)
		}()
	}
	copies.Wait()
	_ = output.Close()
}

type sshClientChain struct {
	client *ssh.Client
	parent *sshClientChain
	sftp   *sftp.Client
	once   sync.Once
}

func (c *sshClientChain) Close() error {
	var err error
	c.once.Do(func() {
		if c.sftp != nil {
			_ = c.sftp.Close()
		}
		if c.client != nil {
			err = c.client.Close()
		}
		if c.parent != nil {
			_ = c.parent.Close()
		}
	})
	return err
}

func (c *sshConnector) openClient(ctx context.Context, hooks Hooks, visited map[string]bool, depth int) (*sshClientChain, error) {
	if depth >= 8 {
		return nil, errors.New("too many SSH jump hosts")
	}
	var parent *sshClientChain
	if c.profile.JumpID != "" {
		if c.resolver == nil {
			return nil, errors.New("SSH jump profile resolver is not configured")
		}
		if visited[c.profile.JumpID] {
			return nil, errors.New("SSH jump profile cycle detected")
		}
		visited[c.profile.JumpID] = true
		jump, err := c.resolver(ctx, c.profile.JumpID)
		if err != nil {
			return nil, fmt.Errorf("resolve jump profile: %w", err)
		}
		if jump.Protocol != "" && !strings.EqualFold(jump.Protocol, "ssh") {
			return nil, errors.New("jump profile must use SSH")
		}
		jumpConnector := &sshConnector{profile: jump, resolver: c.resolver, options: c.options}
		parent, err = jumpConnector.openClient(ctx, hooks, visited, depth+1)
		if err != nil {
			return nil, err
		}
	}

	config, cleanup, err := c.clientConfig(ctx, hooks)
	if err != nil {
		if parent != nil {
			_ = parent.Close()
		}
		return nil, err
	}
	defer cleanup()
	address := net.JoinHostPort(c.profile.Host, strconv.Itoa(c.profile.Port))
	if c.profile.Port == 0 {
		address = net.JoinHostPort(c.profile.Host, "22")
	}
	var raw net.Conn
	if parent == nil {
		raw, err = (&net.Dialer{}).DialContext(ctx, "tcp", address)
	} else {
		raw, err = dialJumpContext(ctx, parent.client, address)
	}
	if err != nil {
		if parent != nil {
			_ = parent.Close()
		}
		return nil, err
	}
	stopCancel := context.AfterFunc(ctx, func() { _ = raw.Close() })
	connection, channels, requests, err := ssh.NewClientConn(raw, address, config)
	stopCancel()
	if err != nil {
		_ = raw.Close()
		if parent != nil {
			_ = parent.Close()
		}
		return nil, err
	}
	return &sshClientChain{client: ssh.NewClient(connection, channels, requests), parent: parent}, nil
}

func dialJumpContext(ctx context.Context, client *ssh.Client, address string) (net.Conn, error) {
	type result struct {
		connection net.Conn
		err        error
	}
	results := make(chan result, 1)
	go func() {
		connection, err := client.Dial("tcp", address)
		results <- result{connection, err}
	}()
	select {
	case result := <-results:
		return result.connection, result.err
	case <-ctx.Done():
		go func() {
			result := <-results
			if result.connection != nil {
				_ = result.connection.Close()
			}
		}()
		return nil, ctx.Err()
	}
}

func (c *sshConnector) clientConfig(ctx context.Context, hooks Hooks) (*ssh.ClientConfig, func(), error) {
	if c.profile.Host == "" {
		return nil, func() {}, errors.New("SSH host is required")
	}
	username := c.profile.Username
	if username == "" {
		if current, err := user.Current(); err == nil {
			username = current.Username
		} else {
			username = os.Getenv("USER")
		}
	}
	if username == "" {
		return nil, func() {}, errors.New("SSH username is required")
	}
	hostKeyCallback, err := newHostKeyCallback(c.options.KnownHostsPath, hooks.HostKey, hooks.HostKeyChanged)
	if err != nil {
		return nil, func() {}, err
	}
	config := &ssh.ClientConfig{User: username, HostKeyCallback: hostKeyCallback}
	var closers []io.Closer
	cleanup := func() {
		for _, closer := range closers {
			_ = closer.Close()
		}
	}
	authentication := strings.ToLower(c.profile.Auth)
	if authentication == "" && c.profile.KeyPath != "" {
		authentication = "key"
	}
	switch authentication {
	case "", "password":
		if c.profile.Password != "" {
			config.Auth = append(config.Auth, ssh.Password(c.profile.Password))
		}
		config.Auth = append(config.Auth, ssh.KeyboardInteractive(keyboardInteractiveChallenge(c.profile.Password, hooks)))
	case "keyboard-interactive", "interactive":
		config.Auth = append(config.Auth, ssh.KeyboardInteractive(keyboardInteractiveChallenge(c.profile.Password, hooks)))
	case "key":
		signer, err := loadPrivateKey(c.profile.KeyPath, c.profile.Passphrase)
		if err != nil {
			cleanup()
			return nil, func() {}, err
		}
		config.Auth = append(config.Auth, ssh.PublicKeys(signer))
		if hooks.Prompt != nil {
			config.Auth = append(config.Auth, ssh.KeyboardInteractive(keyboardInteractiveChallenge("", hooks)))
		}
	case "agent":
		socket := c.options.AgentSocket
		if socket == "" {
			socket = os.Getenv("SSH_AUTH_SOCK")
		}
		if socket == "" {
			cleanup()
			return nil, func() {}, errors.New("SSH agent socket is not configured")
		}
		connection, err := (&net.Dialer{}).DialContext(ctx, "unix", socket)
		if err != nil {
			cleanup()
			return nil, func() {}, fmt.Errorf("connect SSH agent: %w", err)
		}
		closers = append(closers, connection)
		agentClient := agent.NewClient(connection)
		config.Auth = append(config.Auth, ssh.PublicKeysCallback(agentClient.Signers))
		if hooks.Prompt != nil {
			config.Auth = append(config.Auth, ssh.KeyboardInteractive(keyboardInteractiveChallenge("", hooks)))
		}
	default:
		cleanup()
		return nil, func() {}, fmt.Errorf("unsupported SSH authentication %q", c.profile.Auth)
	}
	if len(config.Auth) == 0 {
		cleanup()
		return nil, func() {}, errors.New("no SSH authentication method available")
	}
	return config, cleanup, nil
}

func loadPrivateKey(name, passphrase string) (ssh.Signer, error) {
	if name == "" {
		return nil, errors.New("private key path is required")
	}
	name, err := cleanLocalPath(name)
	if err != nil {
		return nil, err
	}
	data, err := os.ReadFile(name)
	if err != nil {
		return nil, err
	}
	if passphrase != "" {
		signer, err := ssh.ParsePrivateKeyWithPassphrase(data, []byte(passphrase))
		if err != nil {
			return nil, fmt.Errorf("parse encrypted private key: %w", err)
		}
		return signer, nil
	}
	signer, err := ssh.ParsePrivateKey(data)
	if err != nil {
		return nil, fmt.Errorf("parse private key: %w", err)
	}
	return signer, nil
}

func keyboardInteractiveChallenge(password string, hooks Hooks) ssh.KeyboardInteractiveChallenge {
	return func(_, _ string, questions []string, echoes []bool) ([]string, error) {
		answers := make([]string, len(questions))
		for index, question := range questions {
			if hooks.Prompt != nil {
				answer, err := hooks.Prompt("", question, index < len(echoes) && echoes[index])
				if err != nil {
					return nil, err
				}
				answers[index] = answer
			} else if password != "" {
				answers[index] = password
			} else {
				return nil, errors.New("interactive SSH authentication requires a prompt callback")
			}
		}
		return answers, nil
	}
}

var hostKeyLocks sync.Map

func newHostKeyCallback(name string, confirmation ...func(string, string) (bool, error)) (ssh.HostKeyCallback, error) {
	if name == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return nil, err
		}
		name = filepath.Join(home, ".ssh", "known_hosts")
	}
	name, err := cleanLocalPath(name)
	if err != nil {
		return nil, err
	}
	return func(hostname string, remote net.Addr, key ssh.PublicKey) error {
		err := checkKnownHost(name, hostname, remote, key)
		if err == nil {
			return nil
		}
		var keyError *knownhosts.KeyError
		if !errors.As(err, &keyError) {
			return err
		}

		lockValue, _ := hostKeyLocks.LoadOrStore(name, &sync.Mutex{})
		lock := lockValue.(*sync.Mutex)
		lock.Lock()
		defer lock.Unlock()
		// Recheck under the lock so concurrent first connections cannot accept
		// two different keys for the same address.
		err = checkKnownHost(name, hostname, remote, key)
		if err == nil {
			return nil
		}
		if !errors.As(err, &keyError) {
			return err
		}
		changed := len(keyError.Want) > 0
		confirmationIndex := 0
		if changed {
			confirmationIndex = 1
		}
		if len(confirmation) <= confirmationIndex || confirmation[confirmationIndex] == nil {
			if changed {
				return fmt.Errorf("%w for %s (%s)", ErrHostKeyChanged, remote.String(), key.Type())
			}
			return fmt.Errorf("%w: %s %s", ErrHostKeyUnknown, remote.String(), ssh.FingerprintSHA256(key))
		}
		accepted, promptErr := confirmation[confirmationIndex](remote.String(), ssh.FingerprintSHA256(key))
		if promptErr != nil {
			return promptErr
		}
		if !accepted {
			if changed {
				return fmt.Errorf("%w: %s", ErrHostKeyChanged, remote.String())
			}
			return fmt.Errorf("%w: %s", ErrHostKeyUnknown, remote.String())
		}
		if changed {
			return replaceKnownHost(name, remote, key)
		}
		return appendKnownHost(name, remote, key)
	}, nil
}

func appendKnownHost(name string, remote net.Addr, key ssh.PublicKey) error {
	if err := os.MkdirAll(filepath.Dir(name), 0o700); err != nil {
		return err
	}
	file, err := os.OpenFile(name, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		return err
	}
	if err := file.Chmod(0o600); err != nil {
		_ = file.Close()
		return err
	}
	line := knownhosts.Line([]string{knownhosts.Normalize(remote.String())}, key)
	_, writeErr := io.WriteString(file, line+"\n")
	closeErr := file.Close()
	return errors.Join(writeErr, closeErr)
}

func replaceKnownHost(name string, remote net.Addr, key ssh.PublicKey) error {
	data, err := os.ReadFile(name)
	if err != nil {
		return err
	}
	normalized := knownhosts.Normalize(remote.String())
	hashed := knownhosts.HashHostname(normalized)
	lines := make([]string, 0, strings.Count(string(data), "\n")+2)
	for _, line := range strings.Split(string(data), "\n") {
		if line == "" {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) > 0 && !strings.HasPrefix(fields[0], "#") && !strings.HasPrefix(fields[0], "@") {
			hosts := strings.Split(fields[0], ",")
			kept := make([]string, 0, len(hosts))
			for _, host := range hosts {
				if host != normalized && host != hashed {
					kept = append(kept, host)
				}
			}
			if len(kept) == 0 {
				continue
			}
			fields[0] = strings.Join(kept, ",")
			line = strings.Join(fields, " ")
		}
		lines = append(lines, line)
	}
	lines = append(lines, knownhosts.Line([]string{normalized}, key))
	if err := os.MkdirAll(filepath.Dir(name), 0o700); err != nil {
		return err
	}
	temporary, err := os.CreateTemp(filepath.Dir(name), ".known_hosts-lucas-*")
	if err != nil {
		return err
	}
	temporaryName := temporary.Name()
	defer os.Remove(temporaryName)
	if err := temporary.Chmod(0o600); err != nil {
		_ = temporary.Close()
		return err
	}
	if _, err := io.WriteString(temporary, strings.Join(lines, "\n")+"\n"); err != nil {
		_ = temporary.Close()
		return err
	}
	if err := temporary.Sync(); err != nil {
		_ = temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	if err := os.Rename(temporaryName, name); err != nil {
		return err
	}
	return checkKnownHost(name, remote.String(), remote, key)
}

func checkKnownHost(path, hostname string, remote net.Addr, key ssh.PublicKey) error {
	if _, err := os.Stat(path); err != nil {
		if os.IsNotExist(err) {
			return &knownhosts.KeyError{}
		}
		return err
	}
	callback, err := knownhosts.New(path)
	if err != nil {
		return err
	}
	return callback(hostname, remote, key)
}

type sshConnection struct {
	terminal *ssh.Session
	stdin    io.WriteCloser
	output   *io.PipeReader
	chain    *sshClientChain
	closeOne sync.Once
	waitOne  sync.Once
	waitErr  error
	osName   string
}

func (c *sshConnection) OperatingSystem() string { return c.osName }

// Metrics samples Linux hosts without using the interactive terminal channel.
// Every command has its own SSH session and a four-second deadline.
func (c *sshConnection) Metrics(ctx context.Context) (Metrics, error) {
	if c == nil || c.chain == nil || c.chain.client == nil {
		return Metrics{}, errors.New("SSH connection is not available")
	}
	switch strings.ToLower(c.osName) {
	case "darwin", "windows", "freebsd":
		return Metrics{}, fmt.Errorf("SSH metrics are only supported on Linux, not %s", c.osName)
	}
	username, err := runSSHMetricCommand(ctx, c.chain.client, "whoami")
	if err != nil {
		return Metrics{}, err
	}
	first, err := readLinuxResourceSample(ctx, c.chain.client)
	if err != nil {
		return Metrics{}, err
	}
	if err := waitMetricSample(ctx); err != nil {
		return Metrics{}, err
	}
	second, err := readLinuxResourceSample(ctx, c.chain.client)
	if err != nil {
		return Metrics{}, err
	}
	memoryOutput, err := runSSHMetricCommand(ctx, c.chain.client, "cat /proc/meminfo")
	if err != nil {
		return Metrics{}, err
	}
	processOutput, err := runSSHMetricCommand(ctx, c.chain.client, "LC_ALL=C ps -eo pid=,user=,pcpu=,pmem=,rss=,args= --sort=-pcpu | head -n 20")
	if err != nil {
		return Metrics{}, err
	}
	cpu, err := calculateCPUPercent(first.cpuTotal, first.cpuIdle, second.cpuTotal, second.cpuIdle)
	if err != nil {
		return Metrics{}, err
	}
	rxRate, txRate, err := calculateNetworkRates(first.rxBytes, first.txBytes, second.rxBytes, second.txBytes, second.at.Sub(first.at))
	if err != nil {
		return Metrics{}, err
	}
	memoryTotal, memoryUsed, memoryPercent, err := parseLinuxMeminfo(memoryOutput)
	if err != nil {
		return Metrics{}, err
	}
	processes, err := parseProcessList(processOutput)
	if err != nil {
		return Metrics{}, err
	}
	ip := c.chain.client.RemoteAddr().String()
	if host, _, splitErr := net.SplitHostPort(ip); splitErr == nil {
		ip = host
	}
	return Metrics{
		User: strings.TrimSpace(username), IP: ip, CPUPercent: cpu,
		MemoryTotal: memoryTotal, MemoryUsed: memoryUsed, MemoryPercent: memoryPercent,
		RxBytesPerSecond: rxRate, TxBytesPerSecond: txRate, Processes: processes,
	}, nil
}

func readLinuxResourceSample(ctx context.Context, client *ssh.Client) (resourceSample, error) {
	output, err := runSSHMetricCommand(ctx, client, "cat /proc/stat /proc/net/dev")
	if err != nil {
		return resourceSample{}, err
	}
	sample, err := parseLinuxResourceSample(output)
	if err != nil {
		return resourceSample{}, err
	}
	sample.at = time.Now()
	return sample, nil
}

func runSSHMetricCommand(ctx context.Context, client *ssh.Client, command string) (string, error) {
	if err := ctx.Err(); err != nil {
		return "", err
	}
	metricSession, err := client.NewSession()
	if err != nil {
		return "", err
	}
	defer metricSession.Close()
	commandCtx, cancel := context.WithTimeout(ctx, metricCommandTimeout)
	defer cancel()
	type commandResult struct {
		output []byte
		err    error
	}
	done := make(chan commandResult, 1)
	go func() {
		output, runErr := metricSession.CombinedOutput(command)
		done <- commandResult{output: output, err: runErr}
	}()
	select {
	case result := <-done:
		if result.err != nil {
			return "", fmt.Errorf("SSH metrics command failed: %w", result.err)
		}
		return string(result.output), nil
	case <-commandCtx.Done():
		_ = metricSession.Close()
		// CombinedOutput normally returns immediately after Close. Bound the
		// cleanup wait as well; the buffered channel prevents a blocked sender.
		timer := time.NewTimer(time.Second)
		select {
		case <-done:
		case <-timer.C:
		}
		if !timer.Stop() {
			select {
			case <-timer.C:
			default:
			}
		}
		return "", commandCtx.Err()
	}
}

func (c *sshConnection) TerminateProcess(ctx context.Context, pid int, signal string) error {
	command, err := sshProcessKillCommand(pid, signal)
	if err != nil {
		return err
	}
	if c == nil || c.chain == nil || c.chain.client == nil {
		return errors.New("SSH connection is not available")
	}
	_, err = runSSHMetricCommand(ctx, c.chain.client, command)
	return err
}

func (c *sshConnection) Read(data []byte) (int, error)  { return c.output.Read(data) }
func (c *sshConnection) Write(data []byte) (int, error) { return c.stdin.Write(data) }
func (c *sshConnection) Resize(cols, rows int) error {
	if cols < 1 || rows < 1 || cols > 65535 || rows > 65535 {
		return errors.New("invalid terminal size")
	}
	return c.terminal.WindowChange(rows, cols)
}
func (c *sshConnection) Close() error {
	var err error
	c.closeOne.Do(func() {
		_ = c.stdin.Close()
		_ = c.terminal.Close()
		err = c.chain.Close()
		_ = c.output.Close()
	})
	return err
}
func (c *sshConnection) Wait() error {
	c.waitOne.Do(func() { c.waitErr = c.terminal.Wait() })
	return c.waitErr
}
