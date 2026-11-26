package store

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
)

const credentialFormat = 1

type encryptedCredentials struct {
	Version    int    `json:"version"`
	Nonce      string `json:"nonce"`
	Ciphertext string `json:"ciphertext"`
}

func loadOrCreateKey(path string) ([]byte, error) {
	key, err := os.ReadFile(path)
	if err == nil {
		if len(key) != 32 {
			return nil, fmt.Errorf("store: invalid credential key length %d", len(key))
		}
		if err := os.Chmod(path, 0o600); err != nil {
			return nil, fmt.Errorf("store: protect credential key: %w", err)
		}
		return key, nil
	}
	if !os.IsNotExist(err) {
		return nil, fmt.Errorf("store: read credential key: %w", err)
	}

	key = make([]byte, 32)
	if _, err := io.ReadFull(rand.Reader, key); err != nil {
		return nil, fmt.Errorf("store: generate credential key: %w", err)
	}
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if os.IsExist(err) {
		return loadOrCreateKey(path)
	}
	if err != nil {
		return nil, fmt.Errorf("store: create credential key: %w", err)
	}
	ok := false
	defer func() {
		file.Close()
		if !ok {
			os.Remove(path)
		}
	}()
	if _, err := file.Write(key); err != nil {
		return nil, fmt.Errorf("store: write credential key: %w", err)
	}
	if err := file.Sync(); err != nil {
		return nil, fmt.Errorf("store: sync credential key: %w", err)
	}
	if err := file.Close(); err != nil {
		return nil, fmt.Errorf("store: close credential key: %w", err)
	}
	ok = true
	return key, nil
}

func (s *Store) loadCredentials() error {
	data, err := os.ReadFile(filepath.Join(s.dir, credentialsFileName))
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("store: read credentials: %w", err)
	}
	if len(data) == 0 {
		return fmt.Errorf("store: empty encrypted credentials")
	}
	var envelope encryptedCredentials
	if err := json.Unmarshal(data, &envelope); err != nil {
		return fmt.Errorf("store: decode encrypted credentials: %w", err)
	}
	if envelope.Version != credentialFormat {
		return fmt.Errorf("store: unsupported credential format %d", envelope.Version)
	}
	nonce, err := base64.StdEncoding.Strict().DecodeString(envelope.Nonce)
	if err != nil {
		return fmt.Errorf("store: decode credential nonce: %w", err)
	}
	ciphertext, err := base64.StdEncoding.Strict().DecodeString(envelope.Ciphertext)
	if err != nil {
		return fmt.Errorf("store: decode credential ciphertext: %w", err)
	}
	gcm, err := credentialGCM(s.key)
	if err != nil {
		return err
	}
	if len(nonce) != gcm.NonceSize() {
		return fmt.Errorf("store: invalid credential nonce")
	}
	plaintext, err := gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return fmt.Errorf("store: decrypt credentials: %w", err)
	}
	var secrets map[string]credentials
	if err := json.Unmarshal(plaintext, &secrets); err != nil {
		return fmt.Errorf("store: decode credentials: %w", err)
	}
	if secrets == nil {
		secrets = make(map[string]credentials)
	}
	s.secrets = secrets
	return nil
}

func (s *Store) writeCredentials(secrets map[string]credentials) error {
	plaintext, err := json.Marshal(secrets)
	if err != nil {
		return fmt.Errorf("store: encode credentials: %w", err)
	}
	gcm, err := credentialGCM(s.key)
	if err != nil {
		return err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return fmt.Errorf("store: generate credential nonce: %w", err)
	}
	ciphertext := gcm.Seal(nil, nonce, plaintext, nil)
	envelope := encryptedCredentials{
		Version:    credentialFormat,
		Nonce:      base64.StdEncoding.EncodeToString(nonce),
		Ciphertext: base64.StdEncoding.EncodeToString(ciphertext),
	}
	data, err := json.MarshalIndent(envelope, "", "  ")
	if err != nil {
		return fmt.Errorf("store: encode credential envelope: %w", err)
	}
	data = append(data, '\n')
	if err := writeFileAtomic(filepath.Join(s.dir, credentialsFileName), data, 0o600); err != nil {
		return fmt.Errorf("store: write credentials: %w", err)
	}
	return nil
}

func credentialGCM(key []byte) (cipher.AEAD, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("store: initialize credential cipher: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("store: initialize credential GCM: %w", err)
	}
	return gcm, nil
}

func writeFileAtomic(path string, data []byte, mode os.FileMode) (returnErr error) {
	temp, err := os.CreateTemp(filepath.Dir(path), "."+filepath.Base(path)+".tmp-")
	if err != nil {
		return err
	}
	tempPath := temp.Name()
	defer func() {
		temp.Close()
		if returnErr != nil {
			os.Remove(tempPath)
		}
	}()
	if err := temp.Chmod(mode); err != nil {
		return err
	}
	if _, err := temp.Write(data); err != nil {
		return err
	}
	if err := temp.Sync(); err != nil {
		return err
	}
	if err := temp.Close(); err != nil {
		return err
	}
	if err := os.Rename(tempPath, path); err != nil {
		return err
	}
	return nil
}
