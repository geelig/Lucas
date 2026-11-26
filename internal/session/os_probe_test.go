package session

import "testing"

func TestParseSystemProbe(t *testing.T) {
	for input, expected := range map[string]string{"Linux\nubuntu\n": "ubuntu", "Darwin\n": "darwin", "FreeBSD\n": "freebsd", "": ""} {
		if got := parseSystemProbe(input); got != expected {
			t.Fatalf("%q = %q, want %q", input, got, expected)
		}
	}
}
