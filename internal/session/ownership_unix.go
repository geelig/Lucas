//go:build !windows

package session

import (
	"os"
	"os/user"
	"strconv"
	"syscall"
)

func localFileEntry(name, fullPath string, info os.FileInfo) Entry {
	entry := fileEntry(name, fullPath, info)
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok || stat == nil {
		return entry
	}
	entry.Owner = localOwner(strconv.FormatUint(uint64(stat.Uid), 10))
	entry.Group = localGroup(strconv.FormatUint(uint64(stat.Gid), 10))
	return entry
}

func localOwner(id string) string {
	account, err := user.LookupId(id)
	if err == nil && account.Username != "" {
		return account.Username
	}
	return id
}

func localGroup(id string) string {
	group, err := user.LookupGroupId(id)
	if err == nil && group.Name != "" {
		return group.Name
	}
	return id
}
