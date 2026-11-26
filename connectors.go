package main

import (
	"context"
	"fmt"

	"lucas/internal/session"
	"lucas/internal/store"
)

func (a *App) registerConnectors() {
	// Registration is static and happens before the window can accept input.
	_ = a.sessions.Register("local", session.NewLocalFactory())
	_ = a.sessions.Register("serial", session.SerialFactory)
	_ = a.sessions.Register("telnet", session.TelnetFactory)
	_ = a.sessions.Register("ftp", session.FTPFactory)
	resolver := func(_ context.Context, id string) (store.Profile, error) {
		profile, ok := a.store.Profile(id)
		if !ok {
			return store.Profile{}, fmt.Errorf("跳板机配置不存在")
		}
		return profile, nil
	}
	_ = a.sessions.Register("ssh", session.NewSSHFactory(resolver))
}
