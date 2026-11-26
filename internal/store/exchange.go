package store

import (
	"encoding/json"
	"fmt"
	"strings"
)

const exchangeFormat = 1

type exchangeDocument struct {
	App        string    `json:"app,omitempty"`
	Format     int       `json:"format,omitempty"`
	Groups     []Group   `json:"groups"`
	Profiles   []Profile `json:"profiles"`
	GroupOrder []string  `json:"groupOrder"`
}

// ExportData returns a portable .lucas JSON document without credentials.
func (s *Store) ExportData() ([]byte, error) {
	snapshot := s.Snapshot()
	data, err := json.MarshalIndent(exchangeDocument{
		App: "Lucas", Format: exchangeFormat,
		Groups: snapshot.Groups, Profiles: snapshot.Profiles, GroupOrder: snapshot.GroupOrder,
	}, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("store: encode export: %w", err)
	}
	return append(data, '\n'), nil
}

func (s *Store) Export() ([]byte, error) { return s.ExportData() }

// ImportData merges a .lucas document. Existing IDs are never overwritten, and
// credential fields are deliberately discarded even if supplied by a caller.
func (s *Store) ImportData(data []byte) error {
	var exchange exchangeDocument
	if err := json.Unmarshal(data, &exchange); err != nil {
		return fmt.Errorf("store: decode import: %w", err)
	}
	if exchange.App != "" && !strings.EqualFold(exchange.App, "Lucas") {
		return fmt.Errorf("%w: unsupported export application %q", ErrInvalid, exchange.App)
	}
	if exchange.Format != 0 && exchange.Format != exchangeFormat {
		return fmt.Errorf("%w: unsupported export format %d", ErrInvalid, exchange.Format)
	}
	imported := Document{Groups: exchange.Groups, Profiles: exchange.Profiles, GroupOrder: exchange.GroupOrder}
	redactDocument(&imported)
	if err := normalizeDocument(&imported); err != nil {
		return fmt.Errorf("store: import: %w", err)
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	merged := cloneDocument(s.doc)
	merged.Groups = append(merged.Groups, imported.Groups...)
	merged.Profiles = append(merged.Profiles, imported.Profiles...)
	merged.GroupOrder = append(merged.GroupOrder, imported.GroupOrder...)
	if err := normalizeDocument(&merged); err != nil {
		return fmt.Errorf("store: import: %w", err)
	}
	if err := s.persist(merged, s.secrets); err != nil {
		return err
	}
	s.doc = merged
	return nil
}

func (s *Store) Import(data []byte) error { return s.ImportData(data) }
