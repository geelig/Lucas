package store

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	profilesFileName    = "profiles.json"
	credentialsFileName = "credentials.json"
	keyFileName         = "credentials.key"
)

var (
	ErrNotFound = errors.New("store: not found")
	ErrInvalid  = errors.New("store: invalid data")
	ErrConflict = errors.New("store: conflict")
)

// Snapshot is a detached, credential-free view of the store.
type Snapshot struct {
	Groups     []Group   `json:"groups"`
	Profiles   []Profile `json:"profiles"`
	GroupOrder []string  `json:"groupOrder"`
}

type credentials struct {
	Password   string `json:"password,omitempty"`
	Passphrase string `json:"passphrase,omitempty"`
}

// Store owns one configuration directory. Its document never contains secrets;
// decrypted credentials live separately and are only returned by Profile.
type Store struct {
	mu      sync.RWMutex
	dir     string
	doc     Document
	secrets map[string]credentials
	key     []byte
}

// New opens the standard per-user Lucas store.
func New() (*Store, error) {
	dir, err := defaultStoreDirectory()
	if err != nil {
		return nil, fmt.Errorf("store: home directory: %w", err)
	}
	return NewAt(dir)
}

// NewAt opens a store at dir. An optional legacy path is intended for isolated
// tests and migration tooling; the default is ~/.lucas/profiles.json.
func NewAt(dir string, legacyPath ...string) (*Store, error) {
	if dir == "" {
		return nil, fmt.Errorf("%w: empty directory", ErrInvalid)
	}
	if len(legacyPath) > 1 {
		return nil, fmt.Errorf("%w: too many legacy paths", ErrInvalid)
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, fmt.Errorf("store: create directory: %w", err)
	}

	s := &Store{dir: dir, secrets: make(map[string]credentials)}
	profilesPath := filepath.Join(dir, profilesFileName)
	_, statErr := os.Stat(profilesPath)
	profilesExist := statErr == nil
	if statErr != nil && !os.IsNotExist(statErr) {
		return nil, fmt.Errorf("store: stat profiles: %w", statErr)
	}

	var plaintext map[string]credentials
	var err error
	if profilesExist {
		plaintext, err = s.loadCurrent(profilesPath)
	} else {
		err = s.loadInitial(legacyPath)
	}
	if err != nil {
		return nil, err
	}
	if err := normalizeDocument(&s.doc); err != nil {
		return nil, err
	}

	s.key, err = loadOrCreateKey(filepath.Join(dir, keyFileName))
	if err != nil {
		return nil, err
	}
	if err := s.loadCredentials(); err != nil {
		return nil, err
	}
	for id, secret := range plaintext {
		if _, exists := s.secrets[id]; !exists {
			s.secrets[id] = secret
		}
	}
	// A newly initialized/imported store must be persisted immediately. Also
	// rewrite a current file if it contained legacy plaintext secret fields.
	if !profilesExist || len(plaintext) != 0 {
		if err := s.persist(s.doc, s.secrets); err != nil {
			return nil, err
		}
	}
	return s, nil
}

func (s *Store) loadCurrent(path string) (map[string]credentials, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("store: read profiles: %w", err)
	}
	var doc Document
	if len(data) != 0 {
		if err := json.Unmarshal(data, &doc); err != nil {
			return nil, fmt.Errorf("store: decode profiles: %w", err)
		}
	}
	plaintext := splitSecrets(&doc)
	s.doc = doc
	return plaintext, nil
}

func (s *Store) loadInitial(legacyPath []string) error {
	path := ""
	if len(legacyPath) == 1 {
		path = legacyPath[0]
	} else {
		home, err := os.UserHomeDir()
		if err != nil {
			return fmt.Errorf("store: home directory: %w", err)
		}
		path = filepath.Join(home, ".lucas", "profiles.json")
	}
	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		s.doc = emptyDocument()
		return nil
	}
	if err != nil {
		return fmt.Errorf("store: read legacy profiles: %w", err)
	}
	doc, secrets, err := decodeLegacy(data)
	if err != nil {
		return err
	}
	s.doc, s.secrets = doc, secrets
	return nil
}

func emptyDocument() Document {
	return Document{Groups: []Group{}, Profiles: []Profile{}, GroupOrder: []string{}}
}

// Snapshot returns copies and never includes passwords or private-key phrases.
func (s *Store) Snapshot() Snapshot {
	s.mu.RLock()
	defer s.mu.RUnlock()
	doc := cloneDocument(s.doc)
	redactDocument(&doc)
	return Snapshot{Groups: doc.Groups, Profiles: doc.Profiles, GroupOrder: doc.GroupOrder}
}

// Profile returns a detached profile including its decrypted credentials.
func (s *Store) Profile(id string) (Profile, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, p := range s.doc.Profiles {
		if p.ID == id {
			p.Password = s.secrets[id].Password
			p.Passphrase = s.secrets[id].Passphrase
			return p, true
		}
	}
	return Profile{}, false
}

// SaveProfile creates or replaces a profile.
func (s *Store) SaveProfile(p Profile) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	p.ID = strings.TrimSpace(p.ID)
	p.Protocol = strings.ToLower(strings.TrimSpace(p.Protocol))
	if p.ID == "" {
		id, err := uniqueID("profile", s.profileExists)
		if err != nil {
			return err
		}
		p.ID = id
	}
	if p.Protocol == "" {
		p.Protocol = "local"
	}
	if !validProtocol(p.Protocol) {
		return fmt.Errorf("%w: unsupported protocol %q", ErrInvalid, p.Protocol)
	}
	if p.GroupID != "" && !s.groupExists(p.GroupID) {
		return fmt.Errorf("%w: group %q", ErrNotFound, p.GroupID)
	}
	if p.Protocol == "ssh" && p.Port == 0 {
		p.Port = 22
	}
	if p.Protocol == "serial" && p.Baud == 0 {
		p.Baud = 9600
	}
	secret := credentials{Password: p.Password, Passphrase: p.Passphrase}

	doc := cloneDocument(s.doc)
	secrets := cloneSecrets(s.secrets)
	now := time.Now().UTC()
	p.UpdatedAt = now
	p.Password, p.Passphrase = "", ""
	index := -1
	for i := range doc.Profiles {
		if doc.Profiles[i].ID == p.ID {
			index = i
			break
		}
	}
	if index >= 0 {
		previous := s.secrets[p.ID]
		if secret.Password == "" {
			secret.Password = previous.Password
		}
		if secret.Passphrase == "" {
			secret.Passphrase = previous.Passphrase
		}
		p.CreatedAt = doc.Profiles[index].CreatedAt
		doc.Profiles[index] = p
	} else {
		if p.CreatedAt.IsZero() {
			p.CreatedAt = now
		}
		doc.Profiles = append(doc.Profiles, p)
	}
	secrets[p.ID] = secret
	if err := s.persist(doc, secrets); err != nil {
		return err
	}
	s.doc, s.secrets = doc, secrets
	return nil
}

// Save is an alias for SaveProfile.
func (s *Store) Save(p Profile) error { return s.SaveProfile(p) }

// ClearCredentials removes only the saved secrets, keeping the connection.
func (s *Store) ClearCredentials(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.profileExists(id) {
		return fmt.Errorf("%w: profile %q", ErrNotFound, id)
	}
	secrets := cloneSecrets(s.secrets)
	delete(secrets, id)
	if err := s.persist(s.doc, secrets); err != nil {
		return err
	}
	s.secrets = secrets
	return nil
}

func (s *Store) DeleteProfile(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	doc := cloneDocument(s.doc)
	index := -1
	for i := range doc.Profiles {
		if doc.Profiles[i].ID == id {
			index = i
			break
		}
	}
	if index < 0 {
		return fmt.Errorf("%w: profile %q", ErrNotFound, id)
	}
	doc.Profiles = append(doc.Profiles[:index], doc.Profiles[index+1:]...)
	secrets := cloneSecrets(s.secrets)
	delete(secrets, id)
	if err := s.persist(doc, secrets); err != nil {
		return err
	}
	s.doc, s.secrets = doc, secrets
	return nil
}

func (s *Store) Delete(id string) error { return s.DeleteProfile(id) }

func (s *Store) DuplicateProfile(id string) (Profile, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var source Profile
	found := false
	for _, p := range s.doc.Profiles {
		if p.ID == id {
			source = p
			found = true
			break
		}
	}
	if !found {
		return Profile{}, fmt.Errorf("%w: profile %q", ErrNotFound, id)
	}
	newIDValue, err := uniqueID("profile", s.profileExists)
	if err != nil {
		return Profile{}, err
	}
	now := time.Now().UTC()
	source.ID = newIDValue
	source.Name += " 副本"
	source.CreatedAt, source.UpdatedAt = now, now
	doc := cloneDocument(s.doc)
	doc.Profiles = append(doc.Profiles, source)
	secrets := cloneSecrets(s.secrets)
	secrets[newIDValue] = s.secrets[id]
	if err := s.persist(doc, secrets); err != nil {
		return Profile{}, err
	}
	s.doc, s.secrets = doc, secrets
	result := source
	result.Password = secrets[newIDValue].Password
	result.Passphrase = secrets[newIDValue].Passphrase
	return result, nil
}

func (s *Store) Duplicate(id string) (Profile, error) { return s.DuplicateProfile(id) }

func (s *Store) SaveGroup(group Group) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	group.ID = strings.TrimSpace(group.ID)
	if group.ID == "" {
		id, err := uniqueID("group", s.groupExists)
		if err != nil {
			return err
		}
		group.ID = id
	}
	doc := cloneDocument(s.doc)
	index := -1
	for i := range doc.Groups {
		if doc.Groups[i].ID == group.ID {
			index = i
			break
		}
	}
	if index >= 0 {
		doc.Groups[index] = group
	} else {
		doc.Groups = append(doc.Groups, group)
		doc.GroupOrder = append(doc.GroupOrder, group.ID)
	}
	if err := normalizeDocument(&doc); err != nil {
		return err
	}
	if err := s.persist(doc, s.secrets); err != nil {
		return err
	}
	s.doc = doc
	return nil
}

func (s *Store) DeleteGroup(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.groupExists(id) {
		return fmt.Errorf("%w: group %q", ErrNotFound, id)
	}
	for _, group := range s.doc.Groups {
		if group.ParentID == id {
			return fmt.Errorf("%w: group %q has children", ErrConflict, id)
		}
	}
	for _, profile := range s.doc.Profiles {
		if profile.GroupID == id {
			return fmt.Errorf("%w: group %q contains profiles", ErrConflict, id)
		}
	}
	doc := cloneDocument(s.doc)
	for i := range doc.Groups {
		if doc.Groups[i].ID == id {
			doc.Groups = append(doc.Groups[:i], doc.Groups[i+1:]...)
			break
		}
	}
	order := doc.GroupOrder[:0]
	for _, groupID := range doc.GroupOrder {
		if groupID != id {
			order = append(order, groupID)
		}
	}
	doc.GroupOrder = order
	if err := normalizeDocument(&doc); err != nil {
		return err
	}
	if err := s.persist(doc, s.secrets); err != nil {
		return err
	}
	s.doc = doc
	return nil
}

func (s *Store) SetGroupOrder(ids []string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(ids) != len(s.doc.Groups) {
		return fmt.Errorf("%w: group order must contain every group exactly once", ErrInvalid)
	}
	seen := make(map[string]bool, len(ids))
	for _, id := range ids {
		if seen[id] || !s.groupExists(id) {
			return fmt.Errorf("%w: invalid group order entry %q", ErrInvalid, id)
		}
		seen[id] = true
	}
	doc := cloneDocument(s.doc)
	doc.GroupOrder = append([]string(nil), ids...)
	if err := normalizeDocument(&doc); err != nil {
		return err
	}
	if err := s.persist(doc, s.secrets); err != nil {
		return err
	}
	s.doc = doc
	return nil
}

func (s *Store) persist(doc Document, secrets map[string]credentials) error {
	doc = cloneDocument(doc)
	redactDocument(&doc)
	data, err := json.MarshalIndent(doc, "", "  ")
	if err != nil {
		return fmt.Errorf("store: encode profiles: %w", err)
	}
	data = append(data, '\n')
	if err := writeFileAtomic(filepath.Join(s.dir, profilesFileName), data, 0o600); err != nil {
		return fmt.Errorf("store: write profiles: %w", err)
	}
	if err := s.writeCredentials(secrets); err != nil {
		return err
	}
	return nil
}

func (s *Store) groupExists(id string) bool {
	for _, group := range s.doc.Groups {
		if group.ID == id {
			return true
		}
	}
	return false
}

func (s *Store) profileExists(id string) bool {
	for _, profile := range s.doc.Profiles {
		if profile.ID == id {
			return true
		}
	}
	return false
}

func validProtocol(protocol string) bool {
	switch protocol {
	case "local", "ssh", "telnet", "serial", "ftp":
		return true
	default:
		return false
	}
}

func cloneDocument(doc Document) Document {
	return Document{
		Groups:     append([]Group(nil), doc.Groups...),
		Profiles:   append([]Profile(nil), doc.Profiles...),
		GroupOrder: append([]string(nil), doc.GroupOrder...),
	}
}

func cloneSecrets(secrets map[string]credentials) map[string]credentials {
	clone := make(map[string]credentials, len(secrets))
	for id, secret := range secrets {
		clone[id] = secret
	}
	return clone
}

func redactDocument(doc *Document) {
	for i := range doc.Profiles {
		doc.Profiles[i].Password = ""
		doc.Profiles[i].Passphrase = ""
	}
}

func splitSecrets(doc *Document) map[string]credentials {
	secrets := make(map[string]credentials)
	for i := range doc.Profiles {
		p := &doc.Profiles[i]
		if p.Password != "" || p.Passphrase != "" {
			secrets[p.ID] = credentials{Password: p.Password, Passphrase: p.Passphrase}
		}
		p.Password, p.Passphrase = "", ""
	}
	return secrets
}

func normalizeDocument(doc *Document) error {
	if doc.Groups == nil {
		doc.Groups = []Group{}
	}
	if doc.Profiles == nil {
		doc.Profiles = []Profile{}
	}
	groups := make(map[string]Group, len(doc.Groups))
	for _, group := range doc.Groups {
		if group.ID == "" {
			return fmt.Errorf("%w: empty group id", ErrInvalid)
		}
		if _, exists := groups[group.ID]; exists {
			return fmt.Errorf("%w: duplicate group %q", ErrConflict, group.ID)
		}
		groups[group.ID] = group
	}
	for _, group := range doc.Groups {
		if group.ParentID != "" {
			if _, exists := groups[group.ParentID]; !exists {
				return fmt.Errorf("%w: parent group %q", ErrNotFound, group.ParentID)
			}
		}
		seen := map[string]bool{}
		for id := group.ID; id != ""; id = groups[id].ParentID {
			if seen[id] {
				return fmt.Errorf("%w: group cycle at %q", ErrInvalid, id)
			}
			seen[id] = true
		}
	}
	profiles := make(map[string]bool, len(doc.Profiles))
	for i := range doc.Profiles {
		p := &doc.Profiles[i]
		if p.ID == "" {
			return fmt.Errorf("%w: empty profile id", ErrInvalid)
		}
		if profiles[p.ID] {
			return fmt.Errorf("%w: duplicate profile %q", ErrConflict, p.ID)
		}
		profiles[p.ID] = true
		p.Protocol = strings.ToLower(p.Protocol)
		if !validProtocol(p.Protocol) {
			return fmt.Errorf("%w: unsupported protocol %q", ErrInvalid, p.Protocol)
		}
		if p.GroupID != "" {
			if _, exists := groups[p.GroupID]; !exists {
				return fmt.Errorf("%w: group %q", ErrNotFound, p.GroupID)
			}
		}
		if p.Protocol == "ssh" && p.Port == 0 {
			p.Port = 22
		}
		if p.Protocol == "serial" && p.Baud == 0 {
			p.Baud = 9600
		}
		p.Password, p.Passphrase = "", ""
	}

	order := make([]string, 0, len(doc.Groups))
	seen := make(map[string]bool, len(doc.Groups))
	for _, id := range doc.GroupOrder {
		if _, exists := groups[id]; exists && !seen[id] {
			order = append(order, id)
			seen[id] = true
		}
	}
	remaining := make([]Group, 0, len(doc.Groups)-len(order))
	for _, group := range doc.Groups {
		if !seen[group.ID] {
			remaining = append(remaining, group)
		}
	}
	if len(doc.GroupOrder) == 0 {
		sort.SliceStable(remaining, func(i, j int) bool { return remaining[i].Order < remaining[j].Order })
	}
	for _, group := range remaining {
		order = append(order, group.ID)
	}
	orderedGroups := make([]Group, 0, len(order))
	for i, id := range order {
		group := groups[id]
		group.Order = i
		orderedGroups = append(orderedGroups, group)
	}
	doc.Groups = orderedGroups
	doc.GroupOrder = order
	return nil
}

func uniqueID(prefix string, exists func(string) bool) (string, error) {
	for attempts := 0; attempts < 16; attempts++ {
		var bytes [16]byte
		if _, err := rand.Read(bytes[:]); err != nil {
			return "", fmt.Errorf("store: generate id: %w", err)
		}
		id := prefix + "-" + hex.EncodeToString(bytes[:])
		if !exists(id) {
			return id, nil
		}
	}
	return "", fmt.Errorf("store: could not generate a unique id")
}
