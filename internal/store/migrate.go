package store

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

type legacyDocument struct {
	Groups     []Group         `json:"groups"`
	Profiles   []legacyProfile `json:"profiles"`
	GroupOrder []string        `json:"groupOrder"`
}

type legacyProfile struct {
	ID             string    `json:"id"`
	Name           string    `json:"name"`
	Protocol       string    `json:"protocol"`
	GroupID        string    `json:"groupId"`
	Host           string    `json:"host"`
	Port           int       `json:"port"`
	Username       string    `json:"username"`
	User           string    `json:"user"`
	Auth           string    `json:"auth"`
	AuthType       string    `json:"authType"`
	Password       string    `json:"password"`
	KeyPath        string    `json:"keyPath"`
	PrivateKeyPath string    `json:"privateKeyPath"`
	Passphrase     string    `json:"passphrase"`
	SerialPort     string    `json:"serialPort"`
	Baud           int       `json:"baud"`
	BaudRate       int       `json:"baudRate"`
	DataBits       int       `json:"dataBits"`
	StopBits       int       `json:"stopBits"`
	Parity         string    `json:"parity"`
	Flow           string    `json:"flow"`
	FlowControl    string    `json:"flowControl"`
	Shell          string    `json:"shell"`
	Directory      string    `json:"directory"`
	JumpID         string    `json:"jumpId"`
	JumpProfileID  string    `json:"jumpProfileId"`
	Encoding       string    `json:"encoding"`
	Color          string    `json:"color"`
	CreatedAt      time.Time `json:"createdAt"`
	UpdatedAt      time.Time `json:"updatedAt"`
}

func decodeLegacy(data []byte) (Document, map[string]credentials, error) {
	var legacy legacyDocument
	if err := json.Unmarshal(data, &legacy); err != nil {
		return Document{}, nil, fmt.Errorf("store: decode legacy profiles: %w", err)
	}
	doc := Document{Groups: legacy.Groups, GroupOrder: legacy.GroupOrder, Profiles: make([]Profile, 0, len(legacy.Profiles))}
	secrets := make(map[string]credentials, len(legacy.Profiles))

	groupIDs := make(map[string]bool, len(doc.Groups))
	for i := range doc.Groups {
		if doc.Groups[i].ID == "" {
			id, err := uniqueID("group", func(id string) bool { return groupIDs[id] })
			if err != nil {
				return Document{}, nil, err
			}
			doc.Groups[i].ID = id
		}
		if groupIDs[doc.Groups[i].ID] {
			return Document{}, nil, fmt.Errorf("%w: duplicate legacy group %q", ErrConflict, doc.Groups[i].ID)
		}
		groupIDs[doc.Groups[i].ID] = true
	}

	profileIDs := make(map[string]bool, len(legacy.Profiles))
	for _, old := range legacy.Profiles {
		id := old.ID
		if id == "" {
			var err error
			id, err = uniqueID("profile", func(candidate string) bool { return profileIDs[candidate] })
			if err != nil {
				return Document{}, nil, err
			}
		}
		if profileIDs[id] {
			return Document{}, nil, fmt.Errorf("%w: duplicate legacy profile %q", ErrConflict, id)
		}
		profileIDs[id] = true
		protocol := strings.ToLower(old.Protocol)
		if protocol != "local" && protocol != "ssh" && protocol != "serial" {
			return Document{}, nil, fmt.Errorf("%w: legacy profile %q has unsupported protocol %q", ErrInvalid, id, old.Protocol)
		}
		username := old.Username
		if username == "" {
			username = old.User
		}
		auth := old.Auth
		if auth == "" {
			auth = old.AuthType
		}
		if auth == "" && protocol == "ssh" {
			auth = "password"
		}
		keyPath := old.PrivateKeyPath
		if keyPath == "" {
			keyPath = old.KeyPath
		}
		baud := old.BaudRate
		if baud == 0 {
			baud = old.Baud
		}
		if protocol == "serial" && baud == 0 {
			baud = 9600
		}
		flow := old.FlowControl
		if flow == "" {
			flow = old.Flow
		}
		jumpID := old.JumpProfileID
		if jumpID == "" {
			jumpID = old.JumpID
		}
		port := old.Port
		if protocol == "ssh" && port == 0 {
			port = 22
		}
		password, err := decodeLegacySecret(old.Password)
		if err != nil {
			return Document{}, nil, fmt.Errorf("store: legacy profile %q password: %w", id, err)
		}
		passphrase, err := decodeLegacySecret(old.Passphrase)
		if err != nil {
			return Document{}, nil, fmt.Errorf("store: legacy profile %q passphrase: %w", id, err)
		}
		updatedAt := old.UpdatedAt
		if updatedAt.IsZero() {
			updatedAt = old.CreatedAt
		}
		doc.Profiles = append(doc.Profiles, Profile{
			ID: id, Name: old.Name, Protocol: protocol, GroupID: old.GroupID,
			Host: old.Host, Port: port, Username: username, Auth: auth,
			KeyPath: keyPath, SerialPort: old.SerialPort, Baud: baud,
			DataBits: old.DataBits, StopBits: old.StopBits, Parity: old.Parity,
			Flow: flow, Shell: old.Shell, Directory: old.Directory,
			JumpID: jumpID, Encoding: old.Encoding, Color: old.Color,
			CreatedAt: old.CreatedAt, UpdatedAt: updatedAt,
		})
		secrets[id] = credentials{Password: password, Passphrase: passphrase}
	}
	redactDocument(&doc)
	return doc, secrets, nil
}

func decodeLegacySecret(encoded string) (string, error) {
	if encoded == "" {
		return "", nil
	}
	decoded, err := base64.StdEncoding.Strict().DecodeString(encoded)
	if err != nil {
		decoded, err = base64.RawStdEncoding.Strict().DecodeString(encoded)
	}
	if err != nil {
		return "", fmt.Errorf("invalid base64 credential: %w", err)
	}
	return string(decoded), nil
}
