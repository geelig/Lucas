package session

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/pem"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/knownhosts"
	"lucas/internal/store"
)

type testAddr string

func (a testAddr) Network() string { return "tcp" }
func (a testAddr) String() string  { return string(a) }

func testPublicKey(t *testing.T) ssh.PublicKey {
	t.Helper()
	_, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	signer, err := ssh.NewSignerFromKey(private)
	if err != nil {
		t.Fatal(err)
	}
	return signer.PublicKey()
}

func TestKnownHostsAcceptsNewAndRejectsChanged(t *testing.T) {
	path := filepath.Join(t.TempDir(), "known_hosts")
	callback, err := newHostKeyCallback(path, func(_, _ string) (bool, error) { return true, nil })
	if err != nil {
		t.Fatal(err)
	}
	address := testAddr("example.test:22")
	key := testPublicKey(t)
	if err := callback(address.String(), address, key); err != nil {
		t.Fatalf("first trust: %v", err)
	}
	if err := callback(address.String(), address, key); err != nil {
		t.Fatalf("trusted key: %v", err)
	}
	if err := callback(address.String(), address, testPublicKey(t)); !errors.Is(err, ErrHostKeyChanged) {
		t.Fatalf("changed key error = %v", err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("known_hosts mode = %o", info.Mode().Perm())
	}
}

func TestKnownHostsRequiresConfirmation(t *testing.T) {
	path := filepath.Join(t.TempDir(), "known_hosts")
	callback, err := newHostKeyCallback(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := callback("example.test", testAddr("example.test:22"), testPublicKey(t)); !errors.Is(err, ErrHostKeyUnknown) {
		t.Fatalf("unknown key without confirmation = %v", err)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatal("declined key was written")
	}
	called := false
	callback, _ = newHostKeyCallback(path, func(host, fingerprint string) (bool, error) {
		called = true
		if host == "" || !strings.HasPrefix(fingerprint, "SHA256:") {
			t.Fatalf("bad confirmation: %q %q", host, fingerprint)
		}
		return true, nil
	})
	if err := callback("example.test", testAddr("example.test:22"), testPublicKey(t)); err != nil {
		t.Fatal(err)
	}
	if !called {
		t.Fatal("confirmation not called")
	}
}

func TestKnownHostsChangedRequiresExplicitConfirmation(t *testing.T) {
	path := filepath.Join(t.TempDir(), "known_hosts")
	address := testAddr("example.test:22355")
	oldKey, newKey := testPublicKey(t), testPublicKey(t)
	callback, err := newHostKeyCallback(path, func(_, _ string) (bool, error) { return true, nil })
	if err != nil {
		t.Fatal(err)
	}
	if err := callback(address.String(), address, oldKey); err != nil {
		t.Fatal(err)
	}
	otherHost := testAddr("other.test:22")
	otherKey := testPublicKey(t)
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		t.Fatal(err)
	}
	_, err = file.WriteString("# keep this comment\n" + knownhosts.Line([]string{knownhosts.Normalize(otherHost.String())}, otherKey) + "\n")
	if closeErr := file.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		t.Fatal(err)
	}

	callback, _ = newHostKeyCallback(path,
		func(_, _ string) (bool, error) { t.Fatal("unexpected first-contact prompt"); return false, nil },
		func(host, fingerprint string) (bool, error) {
			if host != address.String() || !strings.HasPrefix(fingerprint, "SHA256:") {
				t.Fatalf("bad changed confirmation: %q %q", host, fingerprint)
			}
			return false, nil
		})
	if err := callback(address.String(), address, newKey); !errors.Is(err, ErrHostKeyChanged) {
		t.Fatalf("declined changed key error = %v", err)
	}
	if err := callback(address.String(), address, oldKey); err != nil {
		t.Fatalf("declined change replaced the old key: %v", err)
	}

	callback, _ = newHostKeyCallback(path, nil, func(_, _ string) (bool, error) { return true, nil })
	if err := callback(address.String(), address, newKey); err != nil {
		t.Fatalf("accepted changed key: %v", err)
	}
	if err := callback(address.String(), address, newKey); err != nil {
		t.Fatalf("updated key was not saved: %v", err)
	}
	if err := callback(otherHost.String(), otherHost, otherKey); err != nil {
		t.Fatalf("unrelated host key was changed: %v", err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(data), "# keep this comment") {
		t.Fatal("known_hosts comment was not preserved")
	}
}

func TestClientConfigUsesChangedHostKeyConfirmation(t *testing.T) {
	path := filepath.Join(t.TempDir(), "known_hosts")
	address := testAddr("example.test:22355")
	oldKey, newKey := testPublicKey(t), testPublicKey(t)
	callback, err := newHostKeyCallback(path, func(_, _ string) (bool, error) { return true, nil })
	if err != nil {
		t.Fatal(err)
	}
	if err := callback(address.String(), address, oldKey); err != nil {
		t.Fatal(err)
	}
	changedCalled := false
	connector := &sshConnector{
		profile: store.Profile{Username: "alice", Host: "example.test", Password: "secret"},
		options: SSHOptions{KnownHostsPath: path},
	}
	config, cleanup, err := connector.clientConfig(context.Background(), Hooks{
		HostKey: func(_, _ string) (bool, error) { t.Fatal("unexpected first-contact confirmation"); return false, nil },
		HostKeyChanged: func(_, _ string) (bool, error) { changedCalled = true; return true, nil },
	})
	if err != nil {
		t.Fatal(err)
	}
	defer cleanup()
	if err := config.HostKeyCallback(address.String(), address, newKey); err != nil {
		t.Fatalf("client config rejected accepted changed key: %v", err)
	}
	if !changedCalled {
		t.Fatal("client config did not invoke changed host key confirmation")
	}
}

func TestInteractiveAuthenticationAlias(t *testing.T) {
	connector := &sshConnector{profile: store.Profile{Username: "alice", Host: "example.test", Auth: "interactive"}}
	config, cleanup, err := connector.clientConfig(context.Background(), Hooks{Prompt: func(_, _ string, _ bool) (string, error) { return "answer", nil }})
	if err != nil {
		t.Fatal(err)
	}
	defer cleanup()
	if len(config.Auth) != 1 {
		t.Fatalf("auth methods = %d", len(config.Auth))
	}
}

func TestPrivateKeyWithAndWithoutPassphrase(t *testing.T) {
	_, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	block, err := ssh.MarshalPrivateKey(private, "")
	if err != nil {
		t.Fatal(err)
	}
	plainPath := filepath.Join(t.TempDir(), "id_ed25519")
	if err := os.WriteFile(plainPath, pem.EncodeToMemory(block), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := loadPrivateKey(plainPath, ""); err != nil {
		t.Fatal(err)
	}
	encryptedBlock, err := ssh.MarshalPrivateKeyWithPassphrase(private, "", []byte("secret"))
	if err != nil {
		t.Fatal(err)
	}
	encryptedPath := filepath.Join(t.TempDir(), "id_ed25519_encrypted")
	if err := os.WriteFile(encryptedPath, pem.EncodeToMemory(encryptedBlock), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := loadPrivateKey(encryptedPath, "wrong"); err == nil {
		t.Fatal("expected wrong passphrase to fail")
	}
	if _, err := loadPrivateKey(encryptedPath, "secret"); err != nil {
		t.Fatal(err)
	}
}

func TestKeyboardInteractiveUsesPrompt(t *testing.T) {
	challenge := keyboardInteractiveChallenge("fallback", Hooks{
		Prompt: func(_ string, prompt string, echo bool) (string, error) {
			if prompt != "OTP:" || echo {
				t.Fatalf("unexpected prompt %q echo=%v", prompt, echo)
			}
			return "123456", nil
		},
	})
	answers, err := challenge("", "", []string{"OTP:"}, []bool{false})
	if err != nil || len(answers) != 1 || answers[0] != "123456" {
		t.Fatalf("answers = %v, %v", answers, err)
	}
}

func TestJumpRequiresInjectedResolver(t *testing.T) {
	connector := &sshConnector{profile: store.Profile{Host: "unused", JumpID: "jump"}}
	_, err := connector.openClient(context.Background(), Hooks{}, nil, 0)
	if err == nil {
		t.Fatal("expected missing jump resolver error")
	}
}
