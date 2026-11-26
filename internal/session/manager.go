package session

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"lucas/internal/store"
)

const (
	StateConnected = "connected"
	StateClosing   = "closing"
	StateClosed    = "closed"
	StateError     = "error"

	maxSessionOutput = 1 << 20
)

var (
	ErrSessionNotFound  = errors.New("session not found")
	ErrTransferNotFound = errors.New("transfer not found")
)

// Manager owns session lifetimes. Connector.Connect's context limits connection
// establishment; after Open returns, sessions are terminated by Close.
type Manager struct {
	mu        sync.RWMutex
	factories map[string]Factory
	sessions  map[string]*managedSession
	transfers map[string]*managedTransfer
	sequence  atomic.Uint64
}

type managedSession struct {
	info           Info
	conn           Connection
	fs             FileSystem
	hooks          Hooks
	recorder       *os.File
	done           chan struct{}
	home           string
	tracker        cwdTracker
	writeMu        sync.Mutex
	output         []byte
	outputSequence uint64
}

type managedTransfer struct {
	sessionID string
	cancel    context.CancelFunc
	fs        FileSystem
}

func NewManager() *Manager {
	return &Manager{
		factories: make(map[string]Factory),
		sessions:  make(map[string]*managedSession),
		transfers: make(map[string]*managedTransfer),
	}
}

func (m *Manager) Register(protocol string, factory Factory) error {
	protocol = strings.ToLower(strings.TrimSpace(protocol))
	if protocol == "" {
		return errors.New("session protocol is required")
	}
	if factory == nil {
		return errors.New("session factory is required")
	}
	m.mu.Lock()
	m.factories[protocol] = factory
	m.mu.Unlock()
	return nil
}

func (m *Manager) Open(ctx context.Context, profile store.Profile, options ConnectOptions, hooks Hooks) (Info, error) {
	protocol := strings.ToLower(strings.TrimSpace(profile.Protocol))
	m.mu.RLock()
	factory := m.factories[protocol]
	m.mu.RUnlock()
	if factory == nil {
		return Info{}, fmt.Errorf("no connector registered for protocol %q", protocol)
	}
	connector := factory(profile)
	if connector == nil {
		return Info{}, errors.New("session factory returned no connector")
	}
	// Manager is the single owner of terminal output and connection state.
	connection, filesystem, err := connector.Connect(ctx, options, Hooks{Prompt: hooks.Prompt, HostKey: hooks.HostKey, HostKeyChanged: hooks.HostKeyChanged})
	if err != nil {
		if connection != nil {
			_ = connection.Close()
		}
		return Info{}, err
	}
	if connection == nil {
		return Info{}, errors.New("connector returned no connection")
	}

	id := "session-" + strconv.FormatUint(m.sequence.Add(1), 10)
	entry := &managedSession{
		info: Info{
			ID: id, ProfileID: profile.ID, Name: profile.Name, Protocol: protocol,
			Address: profileAddress(profile), State: StateConnected, OS: profile.OS,
			SupportsFiles: filesystem != nil, OpenedAt: time.Now(),
		},
		conn: connection, fs: filesystem, hooks: hooks, done: make(chan struct{}),
	}
	if filesystem != nil {
		if home, homeErr := filesystem.Home(ctx); homeErr == nil {
			entry.home = home
			entry.info.Cwd = home
		}
	}
	if protocol == "local" {
		entry.info.OS = runtime.GOOS
	}
	if provider, ok := connection.(interface{ OperatingSystem() string }); ok {
		entry.info.OS = provider.OperatingSystem()
	}
	m.mu.Lock()
	m.sessions[id] = entry
	m.mu.Unlock()
	if hooks.State != nil {
		hooks.State(id, StateConnected, "")
	}
	if hooks.Cwd != nil && entry.info.Cwd != "" {
		hooks.Cwd(id, entry.info.Cwd)
	}
	go m.readLoop(entry)
	return entry.info, nil
}

func profileAddress(profile store.Profile) string {
	if profile.Host == "" {
		return profile.Directory
	}
	if profile.Port == 0 {
		return profile.Host
	}
	return net.JoinHostPort(profile.Host, strconv.Itoa(profile.Port))
}

func (m *Manager) readLoop(entry *managedSession) {
	buffer := make([]byte, 32*1024)
	for {
		n, readErr := entry.conn.Read(buffer)
		if n > 0 {
			data := append([]byte(nil), buffer[:n]...)
			m.appendOutput(entry, data)
			m.record(entry, data)
			if entry.hooks.Sequence != nil {
				entry.hooks.Sequence(entry.info.ID, entry.outputSequence, data)
			} else if entry.hooks.Data != nil {
				entry.hooks.Data(entry.info.ID, data)
			}
		}
		if readErr != nil {
			m.finish(entry, readErr)
			return
		}
		if n == 0 {
			// An io.Reader should not repeatedly return (0, nil), but avoid a
			// tight loop if a custom connector does.
			time.Sleep(time.Millisecond)
		}
	}
}

func (m *Manager) appendOutput(entry *managedSession, data []byte) {
	m.mu.Lock()
	defer m.mu.Unlock()
	entry.outputSequence += uint64(len(data))
	if len(data) >= maxSessionOutput {
		entry.output = append(entry.output[:0], data[len(data)-maxSessionOutput:]...)
		return
	}
	if overflow := len(entry.output) + len(data) - maxSessionOutput; overflow > 0 {
		copy(entry.output, entry.output[overflow:])
		entry.output = entry.output[:len(entry.output)-overflow]
	}
	entry.output = append(entry.output, data...)
}

// OutputWithSequence returns the retained output and its total byte position.
func (m *Manager) OutputWithSequence(sessionID string) (OutputState, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	entry := m.sessions[sessionID]
	if entry == nil {
		return OutputState{}, ErrSessionNotFound
	}
	return OutputState{Data: append([]byte(nil), entry.output...), Sequence: entry.outputSequence}, nil
}

// Output returns a copy of the latest raw terminal output, including output
// buffered before the current frontend attached. Closed sessions retain it.
func (m *Manager) Output(sessionID string) ([]byte, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	entry := m.sessions[sessionID]
	if entry == nil {
		return nil, ErrSessionNotFound
	}
	return append([]byte(nil), entry.output...), nil
}

// Metrics forwards to connections that expose host resource sampling.
func (m *Manager) Metrics(ctx context.Context, sessionID string) (Metrics, error) {
	entry, err := m.active(sessionID)
	if err != nil {
		return Metrics{}, err
	}
	provider, ok := entry.conn.(interface {
		Metrics(context.Context) (Metrics, error)
	})
	if !ok {
		return Metrics{}, errors.New("session does not support metrics")
	}
	return provider.Metrics(ctx)
}

func (m *Manager) TerminateProcess(ctx context.Context, sessionID string, pid int, signal string) error {
	entry, err := m.active(sessionID)
	if err != nil {
		return err
	}
	provider, ok := entry.conn.(interface {
		TerminateProcess(context.Context, int, string) error
	})
	if !ok {
		return errors.New("session does not support process management")
	}
	return provider.TerminateProcess(ctx, pid, signal)
}

func (m *Manager) record(entry *managedSession, data []byte) {
	m.mu.Lock()
	if entry.recorder == nil {
		m.mu.Unlock()
		return
	}
	_, err := entry.recorder.Write(data)
	if err == nil {
		m.mu.Unlock()
		return
	}
	_ = entry.recorder.Close()
	entry.recorder = nil
	entry.info.Recording = false
	entry.info.RecordingPath = ""
	callback := entry.hooks.State
	id := entry.info.ID
	m.mu.Unlock()
	if callback != nil {
		callback(id, "recording-error", err.Error())
	}
}

func (m *Manager) finish(entry *managedSession, readErr error) {
	_ = entry.conn.Close()
	waitErr := entry.conn.Wait()

	m.mu.Lock()
	if entry.recorder != nil {
		_ = entry.recorder.Close()
		entry.recorder = nil
	}
	entry.info.Recording = false
	entry.info.RecordingPath = ""
	closing := entry.info.State == StateClosing || entry.info.State == StateClosed
	message := ""
	if !closing && readErr != nil && !errors.Is(readErr, io.EOF) && !errors.Is(readErr, os.ErrClosed) {
		entry.info.State = StateError
		message = readErr.Error()
	} else if !closing && waitErr != nil && !errors.Is(waitErr, io.EOF) {
		entry.info.State = StateError
		message = waitErr.Error()
	} else {
		entry.info.State = StateClosed
	}
	state, id, callback := entry.info.State, entry.info.ID, entry.hooks.State
	m.mu.Unlock()
	if callback != nil {
		callback(id, state, message)
	}
	close(entry.done)
}

func (m *Manager) Write(sessionID string, data []byte) error {
	entry, err := m.active(sessionID)
	if err != nil {
		return err
	}
	entry.writeMu.Lock()
	defer entry.writeMu.Unlock()
	for len(data) > 0 {
		n, err := entry.conn.Write(data)
		if err != nil {
			return err
		}
		if n <= 0 {
			return io.ErrShortWrite
		}
		m.mu.RLock()
		currentCwd := entry.info.Cwd
		m.mu.RUnlock()
		changes := entry.tracker.write(data[:n], currentCwd, entry.home)
		for _, cwd := range changes {
			m.changeCwd(entry, cwd)
		}
		data = data[n:]
	}
	return nil
}

func (m *Manager) changeCwd(entry *managedSession, cwd string) {
	m.mu.Lock()
	entry.info.Cwd = cwd
	callback, id := entry.hooks.Cwd, entry.info.ID
	m.mu.Unlock()
	if callback != nil {
		callback(id, cwd)
	}
}

func (m *Manager) Resize(sessionID string, cols, rows int) error {
	entry, err := m.active(sessionID)
	if err != nil {
		return err
	}
	return entry.conn.Resize(cols, rows)
}

func (m *Manager) active(sessionID string) (*managedSession, error) {
	m.mu.RLock()
	entry := m.sessions[sessionID]
	if entry == nil || entry.info.State == StateClosing || entry.info.State == StateClosed || entry.info.State == StateError {
		m.mu.RUnlock()
		if entry == nil {
			return nil, ErrSessionNotFound
		}
		return nil, errors.New("session is not active")
	}
	m.mu.RUnlock()
	return entry, nil
}

// Close is idempotent and waits for output, waiters and recording files to end.
func (m *Manager) Close(sessionID string) error {
	m.mu.Lock()
	entry := m.sessions[sessionID]
	if entry == nil {
		m.mu.Unlock()
		return nil
	}
	if entry.info.State != StateClosing && entry.info.State != StateClosed {
		entry.info.State = StateClosing
		if entry.hooks.State != nil {
			entry.hooks.State(sessionID, StateClosing, "")
		}
	}
	m.mu.Unlock()
	err := entry.conn.Close()
	<-entry.done
	return err
}

func (m *Manager) List() []Info {
	m.mu.RLock()
	result := make([]Info, 0, len(m.sessions))
	for _, entry := range m.sessions {
		result = append(result, entry.info)
	}
	m.mu.RUnlock()
	sort.Slice(result, func(i, j int) bool {
		if result[i].OpenedAt.Equal(result[j].OpenedAt) {
			return result[i].ID < result[j].ID
		}
		return result[i].OpenedAt.Before(result[j].OpenedAt)
	})
	return result
}

func (m *Manager) Files(sessionID string) (FileSystem, error) {
	entry, err := m.active(sessionID)
	if err != nil {
		return nil, err
	}
	if entry.fs == nil {
		return nil, errors.New("session does not support files")
	}
	return &managedFileSystem{manager: m, session: entry, filesystem: entry.fs}, nil
}

// SetRecording enables raw (unescaped, unchanged) output recording. An empty
// path disables recording. Existing files are appended to and kept private.
func (m *Manager) SetRecording(sessionID, name string) error {
	entry, err := m.active(sessionID)
	if err != nil {
		return err
	}
	if name == "" {
		m.mu.Lock()
		old := entry.recorder
		entry.recorder = nil
		entry.info.Recording = false
		entry.info.RecordingPath = ""
		m.mu.Unlock()
		if old != nil {
			return old.Close()
		}
		return nil
	}
	name, err = cleanLocalPath(name)
	if err != nil {
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
	m.mu.Lock()
	old := entry.recorder
	entry.recorder = file
	entry.info.Recording = true
	entry.info.RecordingPath = filepath.Clean(name)
	m.mu.Unlock()
	if old != nil {
		_ = old.Close()
	}
	return nil
}

type managedFileSystem struct {
	manager    *Manager
	session    *managedSession
	filesystem FileSystem
}

func (f *managedFileSystem) Home(ctx context.Context) (string, error) {
	return f.filesystem.Home(ctx)
}
func (f *managedFileSystem) List(ctx context.Context, name string) (Listing, error) {
	return f.filesystem.List(ctx, name)
}
func (f *managedFileSystem) Mkdir(ctx context.Context, name string) error {
	return f.filesystem.Mkdir(ctx, name)
}
func (f *managedFileSystem) Rename(ctx context.Context, oldName, newName string) error {
	return f.filesystem.Rename(ctx, oldName, newName)
}
func (f *managedFileSystem) Delete(ctx context.Context, name string, recursive bool) error {
	return f.filesystem.Delete(ctx, name, recursive)
}

func (f *managedFileSystem) Upload(ctx context.Context, source, destination, transferID string, progress func(int64, int64)) error {
	return f.transfer(ctx, transferID, progress, func(ctx context.Context, id string, progress func(int64, int64)) error {
		return f.filesystem.Upload(ctx, source, destination, id, progress)
	})
}

func (f *managedFileSystem) Download(ctx context.Context, source, destination, transferID string, progress func(int64, int64)) error {
	return f.transfer(ctx, transferID, progress, func(ctx context.Context, id string, progress func(int64, int64)) error {
		return f.filesystem.Download(ctx, source, destination, id, progress)
	})
}

func (f *managedFileSystem) transfer(ctx context.Context, id string, progress func(int64, int64), run func(context.Context, string, func(int64, int64)) error) error {
	if id == "" {
		id = "transfer-" + strconv.FormatUint(f.manager.sequence.Add(1), 10)
	}
	transferCtx, cancel := context.WithCancel(ctx)
	operation := &managedTransfer{sessionID: f.session.info.ID, cancel: cancel, fs: f.filesystem}
	f.manager.mu.Lock()
	if f.manager.transfers[id] != nil {
		f.manager.mu.Unlock()
		cancel()
		return errors.New("transfer ID already exists")
	}
	f.manager.transfers[id] = operation
	f.manager.mu.Unlock()
	defer func() {
		f.manager.mu.Lock()
		if f.manager.transfers[id] == operation {
			delete(f.manager.transfers, id)
		}
		f.manager.mu.Unlock()
		cancel()
	}()

	err := run(transferCtx, id, func(done, total int64) {
		if progress != nil {
			progress(done, total)
		}
		if f.session.hooks.Transfer != nil {
			f.session.hooks.Transfer(Transfer{ID: id, Done: done, Total: total})
		}
	})
	if f.session.hooks.Transfer != nil {
		result := Transfer{ID: id, Finished: true}
		if err != nil {
			result.Error = err.Error()
		}
		f.session.hooks.Transfer(result)
	}
	return err
}

func (f *managedFileSystem) Cancel(transferID string) error {
	return f.manager.CancelTransfer(transferID)
}

func (m *Manager) CancelTransfer(transferID string) error {
	m.mu.RLock()
	operation := m.transfers[transferID]
	m.mu.RUnlock()
	if operation == nil {
		return ErrTransferNotFound
	}
	operation.cancel()
	return operation.fs.Cancel(transferID)
}
