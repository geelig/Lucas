package session

import (
	"context"
	"io"
	"time"

	"lucas/internal/store"
)

type Info struct {
	ID            string    `json:"id"`
	ProfileID     string    `json:"profileId,omitempty"`
	Name          string    `json:"name"`
	Protocol      string    `json:"protocol"`
	Address       string    `json:"address,omitempty"`
	State         string    `json:"state"`
	SupportsFiles bool      `json:"supportsFiles"`
	Recording     bool      `json:"recording"`
	RecordingPath string    `json:"recordingPath,omitempty"`
	OpenedAt      time.Time `json:"openedAt"`
	Cwd           string    `json:"cwd,omitempty"`
	OS            string    `json:"os,omitempty"`
}

type Entry struct {
	Name       string    `json:"name"`
	Path       string    `json:"path"`
	Size       int64     `json:"size"`
	Directory  bool      `json:"isDir"`
	Symlink    bool      `json:"symlink"`
	Modified   time.Time `json:"modified"`
	Permission string    `json:"permissions,omitempty"`
	Owner      string    `json:"owner,omitempty"`
	Group      string    `json:"group,omitempty"`
}

type Listing struct {
	Path    string  `json:"path"`
	Entries []Entry `json:"entries"`
}

type Transfer struct {
	ID        string `json:"id"`
	SessionID string `json:"sessionId,omitempty"`
	Name      string `json:"name,omitempty"`
	Direction string `json:"direction,omitempty"`
	Done      int64  `json:"done"`
	Total     int64  `json:"total"`
	Finished  bool   `json:"finished"`
	Error     string `json:"error,omitempty"`
}

type Hooks struct {
	Data           func(sessionID string, data []byte)
	State          func(sessionID string, state string, message string)
	Transfer       func(Transfer)
	Prompt         func(sessionID, prompt string, echo bool) (string, error) // optional interactive auth
	HostKey        func(host, fingerprint string) (bool, error)              // optional first-contact confirmation
	HostKeyChanged func(host, fingerprint string) (bool, error)              // optional changed-key confirmation
	Cwd            func(sessionID, cwd string)
	Sequence       func(sessionID string, sequence uint64, data []byte)
}

type OutputState struct {
	Data     []byte `json:"data"`
	Sequence uint64 `json:"sequence"`
}

type ConnectOptions struct {
	Cols int
	Rows int
}

type Connection interface {
	io.ReadWriteCloser
	Resize(cols, rows int) error
	Wait() error
}

type FileSystem interface {
	Home(context.Context) (string, error)
	List(context.Context, string) (Listing, error)
	Mkdir(context.Context, string) error
	Rename(context.Context, string, string) error
	Delete(context.Context, string, bool) error
	Upload(context.Context, string, string, string, func(int64, int64)) error
	Download(context.Context, string, string, string, func(int64, int64)) error
	Cancel(transferID string) error
}

type Connector interface {
	Connect(context.Context, ConnectOptions, Hooks) (Connection, FileSystem, error)
}

type Factory func(store.Profile) Connector
