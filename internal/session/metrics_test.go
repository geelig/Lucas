package session

import (
	"context"
	"errors"
	"fmt"
	"math"
	"runtime"
	"testing"
	"time"

	"lucas/internal/store"
)

func TestParseLinuxCPUStat(t *testing.T) {
	total, idle, err := parseLinuxCPUStat("cpu  100 20 30 400 50 10 20 30 900 800\n")
	if err != nil {
		t.Fatal(err)
	}
	// Guest time is already included in user and nice time.
	if total != 660 || idle != 450 {
		t.Fatalf("total, idle = %d, %d; want 660, 450", total, idle)
	}
	for _, input := range []string{"", "cpu 1 2 3\n", "cpu 1 x 3 4 5\n", "cpu -1 2 3 4 5\n"} {
		if _, _, err := parseLinuxCPUStat(input); err == nil {
			t.Fatalf("parseLinuxCPUStat(%q) should fail", input)
		}
	}
}

func TestCalculateCPUPercent(t *testing.T) {
	got, err := calculateCPUPercent(1000, 600, 2000, 1300)
	if err != nil {
		t.Fatal(err)
	}
	if got != 30 {
		t.Fatalf("CPU = %v, want 30", got)
	}
	if _, err := calculateCPUPercent(2000, 600, 1000, 500); err == nil {
		t.Fatal("decreasing CPU counters must fail")
	}
	if _, err := calculateCPUPercent(1000, 500, 1000, 500); err == nil {
		t.Fatal("unchanged total CPU counter must fail")
	}
}

func TestParseLinuxMeminfo(t *testing.T) {
	total, used, percent, err := parseLinuxMeminfo("MemTotal: 1000 kB\nMemFree: 100 kB\nMemAvailable: 250 kB\n")
	if err != nil {
		t.Fatal(err)
	}
	if total != 1024000 || used != 768000 || percent != 75 {
		t.Fatalf("memory = %d, %d, %v", total, used, percent)
	}
	if _, _, _, err := parseLinuxMeminfo("MemTotal: 0 kB\nMemAvailable: 0 kB\n"); err == nil {
		t.Fatal("zero memory total must fail")
	}
	if _, _, _, err := parseLinuxMeminfo("MemTotal: 1000 kB\nMemAvailable: 1200 kB\n"); err == nil {
		t.Fatal("available memory above total must fail")
	}
}

func TestParseLinuxNetworkAndRates(t *testing.T) {
	input := "Inter-| Receive | Transmit\n" +
		" face |bytes packets errs drop fifo frame compressed multicast|bytes packets errs drop fifo colls carrier compressed\n" +
		" lo: 999 0 0 0 0 0 0 0 999 0 0 0 0 0 0 0\n" +
		" eth0: 1000 0 0 0 0 0 0 0 2000 0 0 0 0 0 0 0\n" +
		" eth1: 3000 0 0 0 0 0 0 0 4000 0 0 0 0 0 0 0\n"
	rx, tx, err := parseLinuxNetwork(input)
	if err != nil {
		t.Fatal(err)
	}
	if rx != 4000 || tx != 6000 {
		t.Fatalf("network = %d, %d; want 4000, 6000", rx, tx)
	}
	rxRate, txRate, err := calculateNetworkRates(1000, 2000, 4000, 8000, 2*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	if rxRate != 1500 || txRate != 3000 {
		t.Fatalf("rates = %v, %v", rxRate, txRate)
	}
	if _, _, err := calculateNetworkRates(4000, 2000, 1000, 8000, time.Second); err == nil {
		t.Fatal("decreasing network counters must fail")
	}
}

func TestParseProcessListLimitAndValues(t *testing.T) {
	input := " 123 alice 12.5 3.5 2048 /usr/bin/example --two words\n"
	for i := 0; i < 25; i++ {
		input += fmt.Sprintf("%d user 1.0 2.0 10 command-%d\n", i+1000, i)
	}
	processes, err := parseProcessList(input)
	if err != nil {
		t.Fatal(err)
	}
	if len(processes) != 20 {
		t.Fatalf("process count = %d, want 20", len(processes))
	}
	first := processes[0]
	if first.PID != 123 || first.User != "alice" || first.CPUPercent != 12.5 || first.MemoryPercent != 3.5 || first.MemoryBytes != 2048*1024 || first.Command != "/usr/bin/example --two words" {
		t.Fatalf("unexpected process: %+v", first)
	}
	for _, input := range []string{"bad user 1 2 3 cmd", "1 user nan 2 3 cmd", "1 user 1 2 -3 cmd", "1 user 1 2 3"} {
		if _, err := parseProcessList(input); err == nil {
			t.Fatalf("parseProcessList(%q) should fail", input)
		}
	}
}

func TestParseDarwinMetrics(t *testing.T) {
	cpu, err := parseDarwinCPU("CPU usage: 1.0% user, 2.0% sys, 96.0% idle\nCPU usage: 12.5% user, 7.5% sys, 80.0% idle\n")
	if err != nil || cpu != 20 {
		t.Fatalf("CPU = %v, err = %v", cpu, err)
	}
	total, used, percent, err := parseDarwinMemory("4194304\n4096", "Mach Virtual Memory Statistics: (page size of 4096 bytes)\nPages free: 100.\nPages active: 200.\nPages inactive: 300.\nPages wired down: 50.\nPages occupied by compressor: 25.\n")
	if err != nil {
		t.Fatal(err)
	}
	if total != 4194304 || used != 275*4096 || math.Abs(percent-float64(275*4096)*100/4194304) > 0.0001 {
		t.Fatalf("memory = %d, %d, %v", total, used, percent)
	}
	rawNet := "Name Mtu Network Address Ipkts Ierrs Ibytes Opkts Oerrs Obytes Coll\n" +
		"en0 1500 <Link#2> aa:bb:cc:dd:ee:ff 1 0 1000 1 0 2000 0\n" +
		"en0 1500 192.168.1 host 1 0 1000 1 0 2000 0\n" +
		"lo0 16384 <Link#1> localhost 1 0 999 1 0 999 0\n"
	rx, tx, err := parseDarwinNetwork(rawNet)
	if err != nil || rx != 1000 || tx != 2000 {
		t.Fatalf("network = %d, %d, err = %v", rx, tx, err)
	}
}

func TestProcessTerminationValidationOnly(t *testing.T) {
	command, err := sshProcessKillCommand(123, "term")
	if err != nil || command != "kill -TERM -- 123" {
		t.Fatalf("command = %q, err = %v", command, err)
	}
	if _, err := sshProcessKillCommand(123, ""); err != nil {
		t.Fatal("empty signal should default to TERM")
	}
	for _, test := range []struct {
		pid    int
		signal string
	}{{0, "TERM"}, {-1, "TERM"}, {1, "TERM; echo unsafe"}, {1, "9"}, {1, "UNKNOWN"}} {
		if _, err := sshProcessKillCommand(test.pid, test.signal); err == nil {
			t.Fatalf("pid %d signal %q should fail without running a command", test.pid, test.signal)
		}
	}
}

func TestLocalMetricsDarwinBounded(t *testing.T) {
	if runtime.GOOS != "darwin" {
		t.Skip("macOS metric commands are platform-specific")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	metrics, err := (&localConnection{}).Metrics(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if metrics.MemoryTotal == 0 || metrics.MemoryUsed > metrics.MemoryTotal {
		t.Fatalf("invalid local memory metrics: %+v", metrics)
	}
	if metrics.CPUPercent < 0 || metrics.CPUPercent > 100 || len(metrics.Processes) > 20 {
		t.Fatalf("invalid local CPU/process metrics: %+v", metrics)
	}
}

type fakeMetricsConnection struct {
	*fakeConnection
	metrics Metrics
	pid     int
	signal  string
}

func (c *fakeMetricsConnection) Metrics(context.Context) (Metrics, error) { return c.metrics, nil }
func (c *fakeMetricsConnection) TerminateProcess(_ context.Context, pid int, signal string) error {
	c.pid, c.signal = pid, signal
	return nil
}

func TestManagerMetricsForwardingAndActiveValidation(t *testing.T) {
	conn := &fakeMetricsConnection{fakeConnection: newFakeConnection(), metrics: Metrics{User: "tester", CPUPercent: 12}}
	m := NewManager()
	if err := m.Register("ssh", func(store.Profile) Connector { return fakeConnector{conn: conn} }); err != nil {
		t.Fatal(err)
	}
	info, err := m.Open(context.Background(), store.Profile{Protocol: "ssh"}, ConnectOptions{}, Hooks{})
	if err != nil {
		t.Fatal(err)
	}
	got, err := m.Metrics(context.Background(), info.ID)
	if err != nil || got.User != "tester" || got.CPUPercent != 12 {
		t.Fatalf("metrics = %+v, err = %v", got, err)
	}
	if err := m.TerminateProcess(context.Background(), info.ID, 123, "TERM"); err != nil {
		t.Fatal(err)
	}
	if conn.pid != 123 || conn.signal != "TERM" {
		t.Fatalf("termination = %d, %q", conn.pid, conn.signal)
	}
	if err := m.Close(info.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := m.Metrics(context.Background(), info.ID); err == nil {
		t.Fatal("closed session must not return metrics")
	}
	if _, err := m.Metrics(context.Background(), "missing"); !errors.Is(err, ErrSessionNotFound) {
		t.Fatalf("missing session error = %v", err)
	}
}

func TestManagerMetricsUnsupported(t *testing.T) {
	conn := newFakeConnection()
	m := NewManager()
	_ = m.Register("local", func(store.Profile) Connector { return fakeConnector{conn: conn} })
	info, err := m.Open(context.Background(), store.Profile{Protocol: "local"}, ConnectOptions{}, Hooks{})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := m.Metrics(context.Background(), info.ID); err == nil {
		t.Fatal("unsupported metrics must fail")
	}
	if err := m.TerminateProcess(context.Background(), info.ID, 123, "TERM"); err == nil {
		t.Fatal("unsupported termination must fail")
	}
	_ = m.Close(info.ID)
}
