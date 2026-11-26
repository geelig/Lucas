package session

import (
	"path"
	"strings"
)

// cwdTracker only observes complete, locally entered commands. It never probes
// a remote host in the background and never changes the shell's working state.
type cwdTracker struct{ input []byte }

func (t *cwdTracker) write(data []byte, cwd, home string) []string {
	var changes []string
	for _, value := range data {
		switch value {
		case 3:
			t.input = t.input[:0]
		case 8, 127:
			if len(t.input) > 0 {
				t.input = t.input[:len(t.input)-1]
			}
		case '\r', '\n':
			command := string(t.input)
			t.input = t.input[:0]
			for _, part := range splitCommand(command) {
				if next, ok := cdTarget(part, cwd, home); ok {
					cwd = next
					changes = append(changes, next)
				}
			}
		default:
			t.input = append(t.input, value)
		}
	}
	return changes
}

func splitCommand(command string) []string {
	var result []string
	start := 0
	var quote byte
	escaped := false
	for i := 0; i < len(command); i++ {
		c := command[i]
		if escaped {
			escaped = false
			continue
		}
		if c == '\\' {
			escaped = true
			continue
		}
		if quote != 0 {
			if c == quote {
				quote = 0
			}
			continue
		}
		if c == '\'' || c == '"' {
			quote = c
			continue
		}
		if c == ';' || ((c == '&' || c == '|') && i+1 < len(command) && command[i+1] == c) {
			result = append(result, command[start:i])
			if c != ';' {
				i++
			}
			start = i + 1
		}
	}
	return append(result, command[start:])
}

func cdTarget(command, cwd, home string) (string, bool) {
	command = strings.TrimSpace(command)
	if command == "cd" {
		if home != "" {
			return home, true
		}
		return "", false
	}
	if !strings.HasPrefix(command, "cd ") {
		return "", false
	}
	target := strings.TrimSpace(strings.TrimPrefix(command, "cd "))
	target = strings.TrimSpace(strings.TrimPrefix(target, "-- "))
	if target == "" || target == "-" {
		return "", false
	}
	if len(target) >= 2 && ((target[0] == '\'' && target[len(target)-1] == '\'') || (target[0] == '"' && target[len(target)-1] == '"')) {
		target = target[1 : len(target)-1]
	}
	target = strings.ReplaceAll(target, "\\ ", " ")
	switch {
	case target == "~":
		return home, home != ""
	case strings.HasPrefix(target, "~/"):
		return path.Join(home, target[2:]), home != ""
	case strings.HasPrefix(target, "/"):
		return path.Clean(target), true
	default:
		return path.Join(cwd, target), cwd != ""
	}
}
