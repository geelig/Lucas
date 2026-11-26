package session

import (
	"reflect"
	"testing"
)

func TestCWDTracker(t *testing.T) {
	var tracker cwdTracker
	if got := tracker.write([]byte("cd /tmp && printf ok\r"), "/home/me", "/home/me"); !reflect.DeepEqual(got, []string{"/tmp"}) {
		t.Fatalf("absolute: %v", got)
	}
	if got := tracker.write([]byte("cd ..\r"), "/tmp", "/home/me"); !reflect.DeepEqual(got, []string{"/"}) {
		t.Fatalf("parent: %v", got)
	}
	if got := tracker.write([]byte("cd 'my folder'\r"), "/tmp", "/home/me"); !reflect.DeepEqual(got, []string{"/tmp/my folder"}) {
		t.Fatalf("quoted: %v", got)
	}
	if got := tracker.write([]byte("cd\r"), "/tmp", "/home/me"); !reflect.DeepEqual(got, []string{"/home/me"}) {
		t.Fatalf("home: %v", got)
	}
	if got := tracker.write([]byte("cd /var"), "/tmp", "/home/me"); len(got) != 0 {
		t.Fatalf("partial command executed: %v", got)
	}
	if got := tracker.write([]byte("\r"), "/tmp", "/home/me"); !reflect.DeepEqual(got, []string{"/var"}) {
		t.Fatalf("split packet: %v", got)
	}
}
