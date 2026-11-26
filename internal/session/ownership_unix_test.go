//go:build !windows

package session

import (
	"context"
	"encoding/json"
	"os"
	"os/user"
	"path/filepath"
	"strconv"
	"syscall"
	"testing"
)

func TestEntryJSONIncludesOwnerAndGroup(t *testing.T) {
	data, err := json.Marshal(Entry{Name: "file", Owner: "renew", Group: "staff"})
	if err != nil {
		t.Fatal(err)
	}
	var got map[string]any
	if err := json.Unmarshal(data, &got); err != nil {
		t.Fatal(err)
	}
	if got["owner"] != "renew" || got["group"] != "staff" {
		t.Fatalf("owner/group JSON = %s", data)
	}
}

func TestLocalFSListResolvesOwnerAndGroup(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "file"), []byte("data"), 0o600); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(filepath.Join(root, "file"))
	if err != nil {
		t.Fatal(err)
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok {
		t.Fatalf("stat type = %T, want *syscall.Stat_t", info.Sys())
	}
	wantOwner := strconv.FormatUint(uint64(stat.Uid), 10)
	if account, lookupErr := user.LookupId(wantOwner); lookupErr == nil && account.Username != "" {
		wantOwner = account.Username
	}
	wantGroup := strconv.FormatUint(uint64(stat.Gid), 10)
	if group, lookupErr := user.LookupGroupId(wantGroup); lookupErr == nil && group.Name != "" {
		wantGroup = group.Name
	}

	listing, err := NewLocalFS().List(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	if len(listing.Entries) != 1 {
		t.Fatalf("entries = %+v", listing.Entries)
	}
	entry := listing.Entries[0]
	if entry.Owner != wantOwner || entry.Group != wantGroup {
		t.Fatalf("owner/group = %q/%q, want %q/%q", entry.Owner, entry.Group, wantOwner, wantGroup)
	}
}

func TestLocalOwnershipResolvesNamesOrFallsBackToNumericIDs(t *testing.T) {
	info := remoteInfo{name: "file", sys: &syscall.Stat_t{Uid: ^uint32(0), Gid: ^uint32(0)}}
	entry := localFileEntry("file", "/tmp/file", info)
	wantOwner, wantGroup := "4294967295", "4294967295"
	if account, err := user.LookupId(wantOwner); err == nil && account.Username != "" {
		wantOwner = account.Username
	}
	if group, err := user.LookupGroupId(wantGroup); err == nil && group.Name != "" {
		wantGroup = group.Name
	}
	if entry.Owner != wantOwner || entry.Group != wantGroup {
		t.Fatalf("owner/group = %q/%q, want %q/%q", entry.Owner, entry.Group, wantOwner, wantGroup)
	}
}
