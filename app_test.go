package main

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	appkit "lucas/internal/app"
	"lucas/internal/session"
	"lucas/internal/store"
)

func TestMigrateWebKitDataAtPreservesLocalStorage(t *testing.T) {
	home := t.TempDir()
	source := filepath.Join(home, "Library", "WebKit", "com.lucas.independent", "WebsiteData", "Default", "one", "two", "LocalStorage")
	if err := os.MkdirAll(source, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(source, "localstorage.sqlite3"), []byte("preferences"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := migrateWebKitDataAt(home); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(home, "Library", "WebKit", "com.lucas.terminal", "WebsiteData", "Default", "one", "two", "LocalStorage", "localstorage.sqlite3"))
	if err != nil || string(data) != "preferences" {
		t.Fatalf("migrated local storage = %q, %v", data, err)
	}
}

func TestDetectProfileOperatingSystemPersistsAndCloses(t *testing.T) {
	dir := t.TempDir()
	st, err := store.NewAt(dir, filepath.Join(dir, "missing.json"))
	if err != nil {
		t.Fatal(err)
	}
	a := &App{ctx: context.Background(), store: st, sessions: session.NewManager()}
	a.prompts = appkit.NewPromptBroker(func(appkit.PromptRequest) {})
	a.registerConnectors()
	if err := a.SaveProfile(store.Profile{Name: "Local probe", Protocol: "local", Shell: "/bin/sh", Directory: dir}); err != nil {
		t.Fatal(err)
	}
	id := a.ListState().Profiles[0].ID
	info, err := a.DetectProfileOperatingSystem(id)
	if err != nil {
		t.Fatal(err)
	}
	if info.OS != runtime.GOOS {
		t.Fatalf("detected OS = %q, want %q", info.OS, runtime.GOOS)
	}
	profile, _ := st.Profile(id)
	if profile.OS != runtime.GOOS {
		t.Fatalf("saved OS = %q, want %q", profile.OS, runtime.GOOS)
	}
	items := a.sessions.List()
	if len(items) != 1 || items[0].State != session.StateClosed {
		t.Fatalf("probe session was not closed: %+v", items)
	}
}

func TestAppStateAndExportStayRedacted(t *testing.T) {
	dir := t.TempDir()
	st, err := store.NewAt(dir, filepath.Join(dir, "missing.json"))
	if err != nil {
		t.Fatal(err)
	}
	a := &App{store: st, sessions: session.NewManager()}
	a.prompts = appkit.NewPromptBroker(func(appkit.PromptRequest) {})
	a.registerConnectors()
	profile := store.Profile{Name: "Example", Protocol: "ssh", Host: "example.test", Password: "never-write-this", Passphrase: "nor-this"}
	if err := a.SaveProfile(profile); err != nil {
		t.Fatal(err)
	}
	state := a.ListState()
	if len(state.Profiles) != 1 || state.Profiles[0].Password != "" || state.Profiles[0].Passphrase != "" {
		t.Fatalf("state contains credentials: %+v", state.Profiles)
	}
	exported, err := a.ExportData()
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(exported, "never-write-this") || strings.Contains(exported, "nor-this") {
		t.Fatal("export contains a secret")
	}
	copy, err := a.DuplicateProfile(state.Profiles[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	if copy.Password != "" || copy.Passphrase != "" {
		t.Fatal("duplicate response contains credentials")
	}
}

func TestHostKeyChangedPromptRequiresVerification(t *testing.T) {
	events := make(chan appkit.PromptRequest, 1)
	a := &App{prompts: appkit.NewPromptBroker(func(request appkit.PromptRequest) { events <- request })}
	result := make(chan bool, 1)
	go func() {
		accepted, err := a.hooks().HostKeyChanged("example.test:22355", "SHA256:test")
		if err != nil {
			t.Errorf("changed host key prompt: %v", err)
		}
		result <- accepted
	}()
	request := <-events
	if !request.Changed || request.Kind != "hostkey" || request.Fingerprint != "SHA256:test" {
		t.Fatalf("changed host key request = %+v", request)
	}
	if !strings.Contains(request.Message, "可信渠道") {
		t.Fatalf("changed host key warning = %q", request.Message)
	}
	if err := a.prompts.Answer(request.ID, "yes"); err != nil {
		t.Fatal(err)
	}
	if !(<-result) {
		t.Fatal("changed host key was not accepted after explicit confirmation")
	}
}

func TestExportDocumentToPreservesHistory(t *testing.T) {
	path := filepath.Join(t.TempDir(), "backup")
	document := "{\"app\":\"Lucas\",\"history\":[{\"command\":\"ls\"}]}"
	a := &App{}
	saved, err := a.ExportDocumentTo(path, document)
	if err != nil {
		t.Fatal(err)
	}
	if filepath.Ext(saved) != ".lucas" {
		t.Fatalf("saved path = %q", saved)
	}
	data, err := os.ReadFile(saved)
	if err != nil || string(data) != document {
		t.Fatalf("saved document = %q, %v", data, err)
	}
	if _, err := a.ExportDocumentTo(path, "not-json"); err == nil {
		t.Fatal("expected invalid JSON to be rejected")
	}
	if _, err := a.ExportDocumentTo(path, "{\"profiles\":[{\"password\":\"must-not-write\"}]}"); err == nil {
		t.Fatal("expected credential fields to be rejected")
	}
	data, err = os.ReadFile(saved)
	if err != nil || string(data) != document {
		t.Fatalf("rejected export changed the existing file: %q, %v", data, err)
	}
}
