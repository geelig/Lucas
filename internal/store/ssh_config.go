package store

import (
	"bufio"
	"fmt"
	"strconv"
	"strings"
	"unicode"
)

type sshConfigBlock struct {
	patterns []string
	settings map[string]string
}

// ParseSSHConfig parses OpenSSH-style text without reading Include files or
// touching the filesystem. Wildcard-only blocks are intentionally not emitted.
func ParseSSHConfig(text string) ([]Profile, error) {
	global := make(map[string]string)
	var blocks []sshConfigBlock
	current := -1
	inMatch := false

	scanner := bufio.NewScanner(strings.NewReader(text))
	scanner.Buffer(make([]byte, 4096), 1024*1024)
	lineNumber := 0
	for scanner.Scan() {
		lineNumber++
		fields, err := splitSSHConfigFields(scanner.Text())
		if err != nil {
			return nil, fmt.Errorf("store: SSH config line %d: %w", lineNumber, err)
		}
		if len(fields) == 0 {
			continue
		}
		keyword, args, err := splitSSHDirective(fields)
		if err != nil {
			return nil, fmt.Errorf("store: SSH config line %d: %w", lineNumber, err)
		}
		keyword = strings.ToLower(keyword)
		switch keyword {
		case "host":
			if len(args) == 0 {
				return nil, fmt.Errorf("store: SSH config line %d: Host requires a pattern", lineNumber)
			}
			blocks = append(blocks, sshConfigBlock{patterns: args, settings: make(map[string]string)})
			current = len(blocks) - 1
			inMatch = false
		case "match":
			inMatch = true
		default:
			if len(args) == 0 || inMatch {
				continue
			}
			value := strings.Join(args, " ")
			if current >= 0 {
				blocks[current].settings[keyword] = value
			} else {
				global[keyword] = value
			}
		}
	}
	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("store: scan SSH config: %w", err)
	}

	profiles := make([]Profile, 0)
	usedIDs := make(map[string]int)
	seenAliases := make(map[string]bool)
	for _, block := range blocks {
		for _, alias := range block.patterns {
			if strings.HasPrefix(alias, "!") || strings.ContainsAny(alias, "*?") || seenAliases[alias] {
				continue
			}
			seenAliases[alias] = true
			settings := make(map[string]string, len(global)+len(block.settings))
			for key, value := range global {
				settings[key] = value
			}
			for key, value := range block.settings {
				settings[key] = value
			}
			hostname := settings["hostname"]
			if hostname == "" {
				hostname = alias
			}
			port := 22
			if value := settings["port"]; value != "" {
				parsed, err := strconv.Atoi(value)
				if err != nil || parsed < 1 || parsed > 65535 {
					return nil, fmt.Errorf("store: SSH config host %q: invalid port %q", alias, value)
				}
				port = parsed
			}
			auth := "password"
			if settings["identityfile"] != "" {
				auth = "key"
			}
			idBase := "ssh-" + sshIDSlug(alias)
			usedIDs[idBase]++
			id := idBase
			if usedIDs[idBase] > 1 {
				id = fmt.Sprintf("%s-%d", idBase, usedIDs[idBase])
			}
			profiles = append(profiles, Profile{
				ID: id, Name: alias, Protocol: "ssh", Host: hostname,
				Port: port, Username: settings["user"], Auth: auth,
				KeyPath: settings["identityfile"],
			})
		}
	}
	return profiles, nil
}

func splitSSHDirective(fields []string) (string, []string, error) {
	keyword := fields[0]
	args := fields[1:]
	if index := strings.IndexByte(keyword, '='); index >= 0 {
		value := keyword[index+1:]
		keyword = keyword[:index]
		if value != "" {
			args = append([]string{value}, args...)
		}
	}
	if keyword == "" {
		return "", nil, fmt.Errorf("missing directive")
	}
	if len(args) != 0 && args[0] == "=" {
		args = args[1:]
	} else if len(args) != 0 && strings.HasPrefix(args[0], "=") {
		args[0] = strings.TrimPrefix(args[0], "=")
		if args[0] == "" {
			args = args[1:]
		}
	}
	return keyword, args, nil
}

func splitSSHConfigFields(line string) ([]string, error) {
	var fields []string
	var field strings.Builder
	var quote rune
	escaped := false
	started := false
	flush := func() {
		if started {
			fields = append(fields, field.String())
			field.Reset()
			started = false
		}
	}
	for _, r := range line {
		if escaped {
			field.WriteRune(r)
			started = true
			escaped = false
			continue
		}
		if quote != 0 {
			if r == quote {
				quote = 0
			} else if r == '\\' && quote == '"' {
				escaped = true
			} else {
				field.WriteRune(r)
			}
			started = true
			continue
		}
		switch {
		case r == '"' || r == '\'':
			quote = r
			started = true
		case r == '\\':
			escaped = true
			started = true
		case unicode.IsSpace(r):
			flush()
		case r == '#' && !started:
			return fields, nil
		default:
			field.WriteRune(r)
			started = true
		}
	}
	if escaped {
		return nil, fmt.Errorf("unfinished escape")
	}
	if quote != 0 {
		return nil, fmt.Errorf("unterminated quote")
	}
	flush()
	return fields, nil
}

func sshIDSlug(alias string) string {
	var slug strings.Builder
	for _, r := range strings.ToLower(alias) {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '-' || r == '_' || r == '.' {
			slug.WriteRune(r)
		} else {
			slug.WriteByte('-')
		}
	}
	result := strings.Trim(slug.String(), "-")
	if result == "" {
		return "host"
	}
	return result
}
