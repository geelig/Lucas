package store

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func testStore(t *testing.T) (*Store, string) {
	t.Helper()
	root := t.TempDir()
	s, err := NewAt(filepath.Join(root, "store"), filepath.Join(root, "missing-legacy.json"))
	if err != nil {
		t.Fatal(err)
	}
	return s, root
}

func writeJSON(t *testing.T, path string, value any) []byte {
	t.Helper()
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatal(err)
	}
	return data
}

func TestLegacyImportCompatibilityAndRedaction(t *testing.T) {
	root := t.TempDir()
	legacyPath := filepath.Join(root, ".lucas", "profiles.json")
	secret := "correct horse battery staple"
	passphrase := "private key secret"
	created := time.Date(2024, 2, 3, 4, 5, 6, 0, time.UTC)
	legacy := map[string]any{
		"groups": []any{
			map[string]any{"id": "mixed", "name": "Mixed"},
			map[string]any{"id": "nested", "name": "Nested", "parentId": "mixed"},
		},
		"groupOrder": []string{"nested", "mixed"},
		"profiles": []any{
			map[string]any{
				"id": "ssh-one", "name": "Server", "protocol": "ssh",
				"groupId": "nested", "host": "example.test", "user": "alice",
				"authType": "key", "keyPath": "/keys/id_ed25519",
				"password":   base64.StdEncoding.EncodeToString([]byte(secret)),
				"passphrase": base64.StdEncoding.EncodeToString([]byte(passphrase)),
				"createdAt":  created,
			},
			map[string]any{
				"id": "serial-one", "name": "Console", "protocol": "serial",
				"groupId": "mixed", "serialPort": "/dev/tty.usbserial-test",
			},
			map[string]any{
				"id": "local-one", "name": "Local", "protocol": "local",
			},
		},
	}
	before := writeJSON(t, legacyPath, legacy)
	dir := filepath.Join(root, "new-store")
	s, err := NewAt(dir, legacyPath)
	if err != nil {
		t.Fatal(err)
	}

	snapshot := s.Snapshot()
	if len(snapshot.Groups) != 2 || len(snapshot.Profiles) != 3 {
		t.Fatalf("legacy tree changed: %+v", snapshot)
	}
	if got := snapshot.GroupOrder; len(got) != 2 || got[0] != "nested" || got[1] != "mixed" {
		t.Fatalf("group order = %v", got)
	}
	for _, p := range snapshot.Profiles {
		if p.Password != "" || p.Passphrase != "" {
			t.Fatalf("snapshot leaked credentials: %+v", p)
		}
	}

	p, ok := s.Profile("ssh-one")
	if !ok {
		t.Fatal("migrated SSH profile not found")
	}
	if p.Username != "alice" || p.Auth != "key" || p.KeyPath != "/keys/id_ed25519" || p.Port != 22 {
		t.Fatalf("SSH fields not preserved: %+v", p)
	}
	if p.Password != secret || p.Passphrase != passphrase {
		t.Fatal("legacy credentials were not decoded")
	}
	serial, _ := s.Profile("serial-one")
	if serial.SerialPort != "/dev/tty.usbserial-test" || serial.Baud != 9600 {
		t.Fatalf("serial fields not preserved: %+v", serial)
	}

	after, err := os.ReadFile(legacyPath)
	if err != nil {
		t.Fatal(err)
	}
	if string(after) != string(before) {
		t.Fatal("legacy source was modified")
	}
	info, err := os.Stat(filepath.Join(dir, keyFileName))
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("key permissions = %o", info.Mode().Perm())
	}
	for _, name := range []string{profilesFileName, credentialsFileName} {
		data, err := os.ReadFile(filepath.Join(dir, name))
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(string(data), secret) || strings.Contains(string(data), passphrase) {
			t.Fatalf("plaintext secret found in %s", name)
		}
	}

	writeJSON(t, legacyPath, map[string]any{"profiles": []any{map[string]any{"id": "must-not-import", "protocol": "local"}}})
	reopened, err := NewAt(dir, legacyPath)
	if err != nil {
		t.Fatal(err)
	}
	if _, exists := reopened.Profile("must-not-import"); exists {
		t.Fatal("legacy import ran more than once")
	}
	if got, _ := reopened.Profile("ssh-one"); got.Password != secret || got.Passphrase != passphrase {
		t.Fatal("encrypted credentials did not survive reopen")
	}
}

func TestSaveDuplicateDeleteAndPersistence(t *testing.T) {
	s, root := testStore(t)
	if err := s.SaveGroup(Group{ID: "work", Name: "Work"}); err != nil {
		t.Fatal(err)
	}
	original := Profile{ID: "server", Name: "Server", Protocol: "ssh", GroupID: "work", Host: "host.test", Port: 22, Password: "secret", Passphrase: "phrase"}
	if err := s.SaveProfile(original); err != nil {
		t.Fatal(err)
	}
	duplicate, err := s.DuplicateProfile("server")
	if err != nil {
		t.Fatal(err)
	}
	if duplicate.ID == original.ID || duplicate.Name == original.Name {
		t.Fatalf("invalid duplicate: %+v", duplicate)
	}
	if duplicate.Password != "secret" || duplicate.Passphrase != "phrase" {
		t.Fatal("duplicate did not copy credentials")
	}

	reopened, err := NewAt(filepath.Join(root, "store"), filepath.Join(root, "unused.json"))
	if err != nil {
		t.Fatal(err)
	}
	got, ok := reopened.Profile(duplicate.ID)
	if !ok || got.Password != "secret" || got.Passphrase != "phrase" {
		t.Fatalf("duplicate not persisted: %+v, %v", got, ok)
	}
	if err := reopened.DeleteProfile("server"); err != nil {
		t.Fatal(err)
	}
	if _, ok := reopened.Profile("server"); ok {
		t.Fatal("deleted profile still exists")
	}
	if err := reopened.DeleteProfile("missing"); err == nil {
		t.Fatal("expected missing profile error")
	}
}

func TestClearCredentialsIsExplicit(t *testing.T) {
	s, root := testStore(t)
	p := Profile{ID: "secure", Name: "Secure", Protocol: "ssh", Host: "example.test", Password: "secret", Passphrase: "phrase"}
	if err := s.SaveProfile(p); err != nil {
		t.Fatal(err)
	}
	if err := s.ClearCredentials(p.ID); err != nil {
		t.Fatal(err)
	}
	reopened, err := NewAt(filepath.Join(root, "store"), filepath.Join(root, "unused.json"))
	if err != nil {
		t.Fatal(err)
	}
	got, _ := reopened.Profile(p.ID)
	if got.Password != "" || got.Passphrase != "" {
		t.Fatal("credentials survived explicit clear")
	}
}

func TestSaveProfileEditPreservesOmittedCredentials(t *testing.T) {
	tests := []struct {
		name           string
		password       string
		passphrase     string
		wantPassword   string
		wantPassphrase string
	}{
		{name: "redacted snapshot", wantPassword: "old-password", wantPassphrase: "old-passphrase"},
		{name: "new password only", password: "new-password", wantPassword: "new-password", wantPassphrase: "old-passphrase"},
		{name: "new passphrase only", passphrase: "new-passphrase", wantPassword: "old-password", wantPassphrase: "new-passphrase"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s, _ := testStore(t)
			if err := s.SaveProfile(Profile{ID: "server", Name: "Server", Protocol: "ssh", Password: "old-password", Passphrase: "old-passphrase"}); err != nil {
				t.Fatal(err)
			}

			edited := s.Snapshot().Profiles[0]
			edited.Name = "Renamed"
			edited.Password = tt.password
			edited.Passphrase = tt.passphrase
			if err := s.SaveProfile(edited); err != nil {
				t.Fatal(err)
			}

			got, ok := s.Profile("server")
			if !ok {
				t.Fatal("edited profile not found")
			}
			if got.Name != "Renamed" || got.Password != tt.wantPassword || got.Passphrase != tt.wantPassphrase {
				t.Fatalf("edited profile = %+v, want name %q, password %q, passphrase %q", got, "Renamed", tt.wantPassword, tt.wantPassphrase)
			}
		})
	}
}

func TestJSONCredentialsAcceptedButNeverStoredInPlaintext(t *testing.T) {
	s, root := testStore(t)
	input := []byte(`{"id":"json-save","name":"JSON save","protocol":"ssh","privateKeyPath":"/keys/test","baudRate":19200,"flowControl":"rtscts","jumpProfileId":"jump","password":"json-password","passphrase":"json-passphrase"}`)
	var profile Profile
	if err := json.Unmarshal(input, &profile); err != nil {
		t.Fatal(err)
	}
	if profile.KeyPath != "/keys/test" || profile.Baud != 19200 || profile.Flow != "rtscts" || profile.JumpID != "jump" {
		t.Fatalf("latest JSON field names not mapped: %+v", profile)
	}
	if err := s.SaveProfile(profile); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(root, "store", profilesFileName))
	if err != nil {
		t.Fatal(err)
	}
	for _, forbidden := range []string{"json-password", "json-passphrase", `"password"`, `"passphrase"`} {
		if strings.Contains(string(data), forbidden) {
			t.Fatalf("profiles.json contains %s: %s", forbidden, data)
		}
	}
	var persisted map[string]any
	if err := json.Unmarshal(data, &persisted); err != nil {
		t.Fatal(err)
	}
	exported, err := s.ExportData()
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(exported), "json-password") || strings.Contains(string(exported), "json-passphrase") {
		t.Fatal("export leaked credentials")
	}
	if got := s.Snapshot().Profiles[0]; got.Password != "" || got.Passphrase != "" {
		t.Fatal("snapshot leaked credentials")
	}
	got, _ := s.Profile("json-save")
	if got.Password != "json-password" || got.Passphrase != "json-passphrase" {
		t.Fatal("Profile(id) must return credentials")
	}
}

func TestGroupValidationAndOrdering(t *testing.T) {
	s, _ := testStore(t)
	for _, group := range []Group{{ID: "a", Name: "A"}, {ID: "b", Name: "B", ParentID: "a"}, {ID: "c", Name: "C"}} {
		if err := s.SaveGroup(group); err != nil {
			t.Fatal(err)
		}
	}
	if err := s.SaveGroup(Group{ID: "bad", Name: "Bad", ParentID: "missing"}); err == nil {
		t.Fatal("expected missing parent error")
	}
	if err := s.SaveGroup(Group{ID: "a", Name: "A", ParentID: "b"}); err == nil {
		t.Fatal("expected cycle error")
	}
	if err := s.SaveGroup(Group{ID: "b", Name: "B", ParentID: "b"}); err == nil {
		t.Fatal("expected self-parent error")
	}
	if err := s.DeleteGroup("a"); err == nil {
		t.Fatal("expected non-empty group error")
	}
	if err := s.SetGroupOrder([]string{"c", "a"}); err == nil {
		t.Fatal("expected incomplete order error")
	}
	if err := s.SetGroupOrder([]string{"c", "b", "b"}); err == nil {
		t.Fatal("expected duplicate order error")
	}
	if err := s.SetGroupOrder([]string{"c", "b", "a"}); err != nil {
		t.Fatal(err)
	}
	if got := s.Snapshot().GroupOrder; strings.Join(got, ",") != "c,b,a" {
		t.Fatalf("order = %v", got)
	}
	if err := s.SaveProfile(Profile{ID: "p", Name: "P", Protocol: "local", GroupID: "c"}); err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteGroup("c"); err == nil {
		t.Fatal("expected group-in-use error")
	}
	if err := s.DeleteGroup("b"); err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteGroup("a"); err != nil {
		t.Fatal(err)
	}
}

func TestExportImportNeverIncludesPasswords(t *testing.T) {
	s, _ := testStore(t)
	if err := s.SaveGroup(Group{ID: "g", Name: "G"}); err != nil {
		t.Fatal(err)
	}
	if err := s.SaveProfile(Profile{ID: "p", Name: "P", Protocol: "ssh", GroupID: "g", Host: "host.test", Password: "never-export", Passphrase: "also-secret"}); err != nil {
		t.Fatal(err)
	}
	data, err := s.ExportData()
	if err != nil {
		t.Fatal(err)
	}
	lower := strings.ToLower(string(data))
	if strings.Contains(lower, "never-export") || strings.Contains(lower, "also-secret") || strings.Contains(lower, "passphrase") || strings.Contains(lower, "password") {
		t.Fatalf("export contains secret fields: %s", data)
	}

	other, _ := testStore(t)
	if err := other.ImportData(data); err != nil {
		t.Fatal(err)
	}
	p, ok := other.Profile("p")
	if !ok || p.Password != "" || p.Passphrase != "" {
		t.Fatalf("import did not redact credentials: %+v", p)
	}
	if err := other.ImportData(data); err == nil {
		t.Fatal("expected duplicate import error")
	}

	manual := strings.Replace(string(data), `"name": "P"`, `"name": "P", "password": "must-not-load", "passphrase": "must-not-load"`, 1)
	third, _ := testStore(t)
	if err := third.ImportData([]byte(manual)); err != nil {
		t.Fatal(err)
	}
	p, _ = third.Profile("p")
	if p.Password != "" || p.Passphrase != "" {
		t.Fatal("import accepted embedded credentials")
	}
}

func TestParseSSHConfigText(t *testing.T) {
	profiles, err := ParseSSHConfig(`
# defaults
User default-user
Port 2222
Host alpha
  HostName alpha.internal
  User alice
  IdentityFile "~/.ssh/a key"
Host beta
Host *.wild !excluded
  User ignored
`)
	if err != nil {
		t.Fatal(err)
	}
	if len(profiles) != 2 {
		t.Fatalf("profiles = %+v", profiles)
	}
	byName := map[string]Profile{}
	for _, p := range profiles {
		byName[p.Name] = p
	}
	alpha := byName["alpha"]
	if alpha.Protocol != "ssh" || alpha.Host != "alpha.internal" || alpha.Username != "alice" || alpha.Port != 2222 || alpha.Auth != "key" || alpha.KeyPath != "~/.ssh/a key" {
		t.Fatalf("alpha = %+v", alpha)
	}
	beta := byName["beta"]
	if beta.Host != "beta" || beta.Username != "default-user" || beta.Port != 2222 {
		t.Fatalf("beta defaults = %+v", beta)
	}
	if _, err := ParseSSHConfig("Host bad\nPort nope\n"); err == nil {
		t.Fatal("expected invalid port error")
	}
}

func TestConcurrentAccess(t *testing.T) {
	s, _ := testStore(t)
	const count = 32
	var wg sync.WaitGroup
	errs := make(chan error, count)
	for i := 0; i < count; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			id := fmt.Sprintf("p-%02d", i)
			if err := s.SaveProfile(Profile{ID: id, Name: id, Protocol: "local", Password: id}); err != nil {
				errs <- err
				return
			}
			p, ok := s.Profile(id)
			if !ok || p.Password != id {
				errs <- fmt.Errorf("profile %s not readable", id)
			}
			for _, snap := range []Snapshot{s.Snapshot()} {
				for _, profile := range snap.Profiles {
					if profile.Password != "" || profile.Passphrase != "" {
						errs <- fmt.Errorf("snapshot leaked a secret")
					}
				}
			}
		}(i)
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		t.Error(err)
	}
	if got := len(s.Snapshot().Profiles); got != count {
		t.Fatalf("profiles = %d, want %d", got, count)
	}
}
