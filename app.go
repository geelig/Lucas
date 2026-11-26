package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
	wruntime "github.com/wailsapp/wails/v2/pkg/runtime"

	appkit "lucas/internal/app"
	"lucas/internal/session"
	"lucas/internal/store"
)

type Snapshot struct {
	Groups     []store.Group   `json:"groups"`
	Profiles   []store.Profile `json:"profiles"`
	GroupOrder []string        `json:"groupOrder"`
	Sessions   []session.Info  `json:"sessions"`
}

type App struct {
	ctx      context.Context
	store    *store.Store
	sessions *session.Manager
	prompts  *appkit.PromptBroker
}

func NewApp() *App {
	a := &App{sessions: session.NewManager()}
	a.prompts = appkit.NewPromptBroker(func(request appkit.PromptRequest) {
		if a.ctx != nil {
			wruntime.EventsEmit(a.ctx, "lucas:prompt", request)
		}
	})
	a.registerConnectors()
	return a
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	st, err := store.New()
	if err != nil {
		panic(fmt.Sprintf("无法初始化 Lucas 配置: %v", err))
	}
	a.store = st
}

func (a *App) shutdown(context.Context) {
	a.prompts.Close()
	for _, item := range a.sessions.List() {
		_ = a.sessions.Close(item.ID)
	}
}

func (a *App) ListState() Snapshot {
	doc := a.store.Snapshot()
	return Snapshot{Groups: doc.Groups, Profiles: doc.Profiles, GroupOrder: doc.GroupOrder, Sessions: a.sessions.List()}
}

func (a *App) SaveProfile(profile store.Profile) error { return a.store.SaveProfile(profile) }
func (a *App) DeleteProfile(id string) error           { return a.store.DeleteProfile(id) }
func (a *App) DuplicateProfile(id string) (store.Profile, error) {
	p, err := a.store.DuplicateProfile(id)
	p.Password, p.Passphrase = "", ""
	return p, err
}
func (a *App) SaveGroup(group store.Group) error { return a.store.SaveGroup(group) }
func (a *App) DeleteGroup(id string) error       { return a.store.DeleteGroup(id) }
func (a *App) SetGroupOrder(ids []string) error  { return a.store.SetGroupOrder(ids) }

func (a *App) hooks() session.Hooks {
	return session.Hooks{
		Sequence: func(id string, sequence uint64, data []byte) {
			wruntime.EventsEmit(a.ctx, "lucas:data", map[string]any{"id": id, "data": base64.StdEncoding.EncodeToString(data), "sequence": sequence})
		},
		State: func(id, state, message string) {
			wruntime.EventsEmit(a.ctx, "lucas:state", map[string]any{"id": id, "state": state, "message": message})
		},
		Transfer: func(update session.Transfer) { wruntime.EventsEmit(a.ctx, "lucas:transfer", update) },
		Prompt:   a.prompts.Ask,
		HostKey: func(host, fingerprint string) (bool, error) {
			return a.prompts.Confirm(appkit.PromptRequest{Kind: "hostkey", Title: "验证主机身份", Message: "首次连接到 " + host + "。请核对指纹后再接受。", Fingerprint: fingerprint})
		},
		HostKeyChanged: func(host, fingerprint string) (bool, error) {
			return a.prompts.Confirm(appkit.PromptRequest{Kind: "hostkey", Title: "主机密钥已变更", Message: host + " 返回了与已保存记录不同的主机密钥。请通过可信渠道核实新指纹；只有确认服务器变更可信后才接受。", Fingerprint: fingerprint, Changed: true})
		},
		Cwd: func(id, cwd string) { wruntime.EventsEmit(a.ctx, "lucas:cwd", map[string]string{"id": id, "cwd": cwd}) },
	}
}

func (a *App) OpenSession(profileID string, cols, rows int) (session.Info, error) {
	p, ok := a.store.Profile(profileID)
	if !ok {
		return session.Info{}, fmt.Errorf("连接配置不存在或已删除")
	}
	info, err := a.sessions.Open(a.ctx, p, session.ConnectOptions{Cols: cols, Rows: rows}, a.hooks())
	if err == nil && info.OS != "" && info.OS != p.OS {
		p.OS = info.OS
		_ = a.store.SaveProfile(p)
	}
	return info, err
}

func (a *App) OpenAdHoc(p store.Profile, save bool, cols, rows int) (session.Info, error) {
	if p.ID == "" {
		p.ID = uuid.NewString()
	}
	if save {
		if err := a.store.SaveProfile(p); err != nil {
			return session.Info{}, err
		}
	}
	info, err := a.sessions.Open(a.ctx, p, session.ConnectOptions{Cols: cols, Rows: rows}, a.hooks())
	if save && err == nil && info.OS != "" && info.OS != p.OS {
		p.OS = info.OS
		_ = a.store.SaveProfile(p)
	}
	return info, err
}

// DetectProfileOperatingSystem performs one bounded probe without emitting a
// terminal tab. The temporary session is always closed before returning.
func (a *App) DetectProfileOperatingSystem(profileID string) (info session.Info, err error) {
	p, ok := a.store.Profile(profileID)
	if !ok {
		return info, fmt.Errorf("连接配置不存在或已删除")
	}
	ctx, cancel := context.WithTimeout(a.ctx, 8*time.Second)
	defer cancel()
	info, err = a.sessions.Open(ctx, p, session.ConnectOptions{Cols: 80, Rows: 24}, session.Hooks{})
	if info.ID != "" {
		defer func() {
			if closeErr := a.sessions.Close(info.ID); err == nil {
				err = closeErr
			}
		}()
	}
	if err != nil {
		return info, err
	}
	if info.OS == "" {
		return info, fmt.Errorf("无法识别操作系统")
	}
	p.OS = info.OS
	if err = a.store.SaveProfile(p); err != nil {
		return info, err
	}
	return info, nil
}

func (a *App) Write(id, text string) error { return a.sessions.Write(id, []byte(text)) }
func (a *App) WriteBinary(id, data string) error {
	raw, err := base64.StdEncoding.DecodeString(data)
	if err != nil {
		return err
	}
	return a.sessions.Write(id, raw)
}
func (a *App) SaveBinaryFile(name, data string) (string, error) {
	path, err := a.PickSavePath(name)
	if err != nil || path == "" {
		return "", err
	}
	raw, err := base64.StdEncoding.DecodeString(data)
	if err != nil {
		return "", err
	}
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		return "", err
	}
	return path, nil
}

func (a *App) SaveTextFile(name, content string) (string, error) {
	path, err := a.PickSavePath(name)
	if err != nil || path == "" {
		return "", err
	}
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		return "", err
	}
	return path, nil
}
func (a *App) Resize(id string, cols, rows int) error { return a.sessions.Resize(id, cols, rows) }
func (a *App) CloseSession(id string) error           { return a.sessions.Close(id) }
func (a *App) AnswerPrompt(id, answer string) error   { return a.prompts.Answer(id, answer) }

func (a *App) GetOutput(id string) (string, error) {
	data, err := a.sessions.Output(id)
	if err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(data), nil
}

type OutputView struct {
	Data     string `json:"data"`
	Sequence uint64 `json:"sequence"`
}

func (a *App) GetOutputState(id string) (OutputView, error) {
	state, err := a.sessions.OutputWithSequence(id)
	if err != nil {
		return OutputView{}, err
	}
	return OutputView{Data: base64.StdEncoding.EncodeToString(state.Data), Sequence: state.Sequence}, nil
}

func (a *App) ListFiles(id, path string) (session.Listing, error) {
	fs, err := a.sessions.Files(id)
	if err != nil {
		return session.Listing{}, err
	}
	if path == "" {
		path, err = fs.Home(a.ctx)
		if err != nil {
			return session.Listing{}, err
		}
	}
	return fs.List(a.ctx, path)
}

func (a *App) Upload(id, local, remote string) error {
	fs, err := a.sessions.Files(id)
	if err != nil {
		return err
	}
	transferID := uuid.NewString()
	wruntime.EventsEmit(a.ctx, "lucas:transfer", session.Transfer{ID: transferID, SessionID: id, Name: filepath.Base(local), Direction: "upload"})
	return fs.Upload(a.ctx, local, remote, transferID, nil)
}

func (a *App) Download(id, remote, local string) error {
	fs, err := a.sessions.Files(id)
	if err != nil {
		return err
	}
	transferID := uuid.NewString()
	wruntime.EventsEmit(a.ctx, "lucas:transfer", session.Transfer{ID: transferID, SessionID: id, Name: filepath.Base(remote), Direction: "download"})
	return fs.Download(a.ctx, remote, local, transferID, nil)
}

func (a *App) Mkdir(id, path string) error {
	fs, err := a.sessions.Files(id)
	if err != nil {
		return err
	}
	return fs.Mkdir(a.ctx, path)
}
func (a *App) RenameFile(id, oldPath, newPath string) error {
	fs, err := a.sessions.Files(id)
	if err != nil {
		return err
	}
	return fs.Rename(a.ctx, oldPath, newPath)
}
func (a *App) DeleteFile(id, path string) error {
	fs, err := a.sessions.Files(id)
	if err != nil {
		return err
	}
	return fs.Delete(a.ctx, path, true)
}
func (a *App) CancelTransfer(id string) error { return a.sessions.CancelTransfer(id) }

func (a *App) SetRecording(id string, enabled bool) error {
	if !enabled {
		return a.sessions.SetRecording(id, "")
	}
	dir, err := a.ConfigDirectory()
	if err != nil {
		return err
	}
	dir = filepath.Join(dir, "recordings")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	name := time.Now().Format("20060102-150405") + "-" + id + ".log"
	return a.sessions.SetRecording(id, filepath.Join(dir, name))
}

func (a *App) ExportData() (string, error) {
	data, err := a.store.ExportData()
	return string(data), err
}
func (a *App) ImportData(data string) error     { return a.store.ImportData([]byte(data)) }
func (a *App) ClearCredentials(id string) error { return a.store.ClearCredentials(id) }
func (a *App) ExportDataTo(path string) (string, error) {
	data, err := a.store.ExportData()
	if err != nil {
		return "", err
	}
	return writeExportDocument(path, data)
}

// ExportDocumentTo writes the connection export enriched by the frontend with
// local command history and saved commands. Credentials are never accepted.
func (a *App) ExportDocumentTo(path string, document string) (string, error) {
	var content any
	if err := json.Unmarshal([]byte(document), &content); err != nil {
		return "", fmt.Errorf("export: invalid JSON document")
	}
	if err := rejectCredentialFields(content); err != nil {
		return "", err
	}
	return writeExportDocument(path, []byte(document))
}

func rejectCredentialFields(value any) error {
	switch typed := value.(type) {
	case map[string]any:
		for key, child := range typed {
			if strings.EqualFold(key, "password") || strings.EqualFold(key, "passphrase") {
				return fmt.Errorf("export: credential field %q is not allowed", key)
			}
			if err := rejectCredentialFields(child); err != nil {
				return err
			}
		}
	case []any:
		for _, child := range typed {
			if err := rejectCredentialFields(child); err != nil {
				return err
			}
		}
	}
	return nil
}

func writeExportDocument(path string, data []byte) (string, error) {
	if path == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		path = filepath.Join(home, "Downloads", "Lucas-"+time.Now().Format("2006-01-02")+".lucas")
	}
	if filepath.Ext(path) == "" {
		path += ".lucas"
	}
	if err := os.WriteFile(path, data, 0o600); err != nil {
		return "", err
	}
	return path, nil
}
func (a *App) ImportSSHConfig(path string) (int, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return 0, err
	}
	profiles, err := store.ParseSSHConfig(string(raw))
	if err != nil {
		return 0, err
	}
	for _, p := range profiles {
		if err := a.store.SaveProfile(p); err != nil {
			return 0, err
		}
	}
	return len(profiles), nil
}

func (a *App) ListSerialPorts() ([]string, error) { return session.ListSerialPorts() }
func (a *App) BaudRates() []int {
	return []int{300, 1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600}
}
func (a *App) PickFile(title string) (string, error) {
	return wruntime.OpenFileDialog(a.ctx, wruntime.OpenDialogOptions{Title: title})
}
func (a *App) PickFolder(title string) (string, error) {
	return wruntime.OpenDirectoryDialog(a.ctx, wruntime.OpenDialogOptions{Title: title})
}
func (a *App) PickSavePath(name string) (string, error) {
	return wruntime.SaveFileDialog(a.ctx, wruntime.SaveDialogOptions{Title: "保存文件", DefaultFilename: name})
}

func (a *App) ConfigDirectory() (string, error) {
	return a.store.Directory(), nil
}

func (a *App) SetConfigDirectory(path string) (string, error) {
	if err := a.store.MigrateTo(path); err != nil {
		return "", err
	}
	return a.store.Directory(), nil
}

func (a *App) OpenConfigDirectory() error {
	dir, err := a.ConfigDirectory()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	return exec.Command("open", dir).Run()
}

func (a *App) RevealInFinder(path string) error {
	if path == "" {
		return fmt.Errorf("文件路径为空")
	}
	return exec.Command("open", "-R", path).Run()
}

func (a *App) GetSessionMetrics(id string) (session.Metrics, error) {
	ctx, cancel := context.WithTimeout(a.ctx, 5*time.Second)
	defer cancel()
	return a.sessions.Metrics(ctx, id)
}

func (a *App) TerminateProcess(id string, pid int) error {
	ctx, cancel := context.WithTimeout(a.ctx, 5*time.Second)
	defer cancel()
	return a.sessions.TerminateProcess(ctx, id, pid, "TERM")
}
