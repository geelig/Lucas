package session

import (
	"context"
	"strings"
	"time"

	"golang.org/x/crypto/ssh"
)

func parseSystemProbe(output string) string {
	lines := strings.Fields(strings.TrimSpace(output))
	if len(lines) == 0 {
		return ""
	}
	first := strings.ToLower(lines[0])
	if first == "linux" && len(lines) > 1 {
		return strings.ToLower(lines[1])
	}
	switch first {
	case "darwin", "linux", "freebsd", "windows":
		return first
	default:
		return ""
	}
}

// detectSSHOS is a bounded, read-only probe on its own SSH channel. Failure is
// deliberately silent: an unknown system uses the protocol icon instead.
func detectSSHOS(ctx context.Context, client *ssh.Client) string {
	probe, err := client.NewSession()
	if err != nil {
		return ""
	}
	defer probe.Close()
	ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	type result struct {
		output []byte
		err    error
	}
	done := make(chan result, 1)
	go func() {
		output, err := probe.Output("uname -s 2>/dev/null; if [ -r /etc/os-release ]; then . /etc/os-release; echo \"$ID\"; fi")
		done <- result{output, err}
	}()
	select {
	case result := <-done:
		if result.err != nil {
			return ""
		}
		return parseSystemProbe(string(result.output))
	case <-ctx.Done():
		_ = probe.Close()
		return ""
	}
}
