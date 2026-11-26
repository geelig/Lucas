package session

import (
	"context"
	"errors"
	"fmt"
	"math"
	"os/exec"
	"strconv"
	"strings"
	"time"
)

const (
	metricCommandTimeout = 4 * time.Second
	metricSampleInterval = time.Second
	maxMetricProcesses   = 20
)

// Metrics is a point-in-time view of a session host. Byte and rate values use
// bytes and bytes per second respectively.
type Metrics struct {
	User             string        `json:"user"`
	IP               string        `json:"ip"`
	CPUPercent       float64       `json:"cpuPercent"`
	MemoryTotal      uint64        `json:"memoryTotal"`
	MemoryUsed       uint64        `json:"memoryUsed"`
	MemoryPercent    float64       `json:"memoryPercent"`
	RxBytesPerSecond float64       `json:"rxPerSecond"`
	TxBytesPerSecond float64       `json:"txPerSecond"`
	Processes        []ProcessInfo `json:"processes"`
}

type ProcessInfo struct {
	PID           int     `json:"pid"`
	User          string  `json:"user"`
	CPUPercent    float64 `json:"cpu"`
	MemoryPercent float64 `json:"memory"`
	MemoryBytes   uint64  `json:"memoryBytes"`
	Command       string  `json:"command"`
}

type resourceSample struct {
	cpuTotal uint64
	cpuIdle  uint64
	rxBytes  uint64
	txBytes  uint64
	at       time.Time
}

func parseLinuxCPUStat(input string) (total, idle uint64, err error) {
	for _, line := range strings.Split(input, "\n") {
		if !strings.HasPrefix(line, "cpu ") {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 5 {
			return 0, 0, errors.New("invalid /proc/stat CPU line")
		}
		values := make([]uint64, len(fields)-1)
		for i, field := range fields[1:] {
			value, parseErr := strconv.ParseUint(field, 10, 64)
			if parseErr != nil {
				return 0, 0, fmt.Errorf("invalid CPU counter: %w", parseErr)
			}
			values[i] = value
		}
		// Guest counters are already included in user and nice. Only the first
		// eight counters form the host total.
		limit := len(values)
		if limit > 8 {
			limit = 8
		}
		for _, value := range values[:limit] {
			if math.MaxUint64-total < value {
				return 0, 0, errors.New("CPU counter overflow")
			}
			total += value
		}
		idle = values[3]
		if len(values) > 4 {
			if math.MaxUint64-idle < values[4] {
				return 0, 0, errors.New("idle CPU counter overflow")
			}
			idle += values[4]
		}
		return total, idle, nil
	}
	return 0, 0, errors.New("aggregate CPU line not found")
}

func calculateCPUPercent(firstTotal, firstIdle, secondTotal, secondIdle uint64) (float64, error) {
	if secondTotal < firstTotal || secondIdle < firstIdle {
		return 0, errors.New("CPU counters moved backwards")
	}
	totalDelta := secondTotal - firstTotal
	idleDelta := secondIdle - firstIdle
	if totalDelta == 0 || idleDelta > totalDelta {
		return 0, errors.New("invalid CPU counter delta")
	}
	return percent(float64(totalDelta-idleDelta), float64(totalDelta)), nil
}

func parseLinuxMeminfo(input string) (total, used uint64, usedPercent float64, err error) {
	var available uint64
	var foundTotal, foundAvailable bool
	for _, line := range strings.Split(input, "\n") {
		fields := strings.Fields(line)
		if len(fields) == 0 {
			continue
		}
		key := strings.TrimSuffix(fields[0], ":")
		if key != "MemTotal" && key != "MemAvailable" {
			continue
		}
		if len(fields) != 3 || fields[2] != "kB" {
			return 0, 0, 0, fmt.Errorf("invalid %s line", key)
		}
		value, parseErr := strconv.ParseUint(fields[1], 10, 64)
		if parseErr != nil || value > math.MaxUint64/1024 {
			return 0, 0, 0, fmt.Errorf("invalid %s value", key)
		}
		value *= 1024
		if key == "MemTotal" {
			total, foundTotal = value, true
		} else {
			available, foundAvailable = value, true
		}
	}
	if !foundTotal || !foundAvailable || total == 0 || available > total {
		return 0, 0, 0, errors.New("invalid Linux memory counters")
	}
	used = total - available
	return total, used, percent(float64(used), float64(total)), nil
}

func parseLinuxNetwork(input string) (rx, tx uint64, err error) {
	for _, line := range strings.Split(input, "\n") {
		name, values, found := strings.Cut(line, ":")
		if !found || strings.TrimSpace(name) == "lo" {
			continue
		}
		fields := strings.Fields(values)
		if len(fields) < 16 {
			// /proc/stat and section headers can coexist with network lines.
			continue
		}
		rxValue, rxErr := strconv.ParseUint(fields[0], 10, 64)
		txValue, txErr := strconv.ParseUint(fields[8], 10, 64)
		if rxErr != nil || txErr != nil {
			return 0, 0, errors.New("invalid network byte counter")
		}
		if math.MaxUint64-rx < rxValue || math.MaxUint64-tx < txValue {
			return 0, 0, errors.New("network byte counter overflow")
		}
		rx += rxValue
		tx += txValue
	}
	return rx, tx, nil
}

func parseLinuxResourceSample(input string) (resourceSample, error) {
	total, idle, err := parseLinuxCPUStat(input)
	if err != nil {
		return resourceSample{}, err
	}
	rx, tx, err := parseLinuxNetwork(input)
	if err != nil {
		return resourceSample{}, err
	}
	return resourceSample{cpuTotal: total, cpuIdle: idle, rxBytes: rx, txBytes: tx}, nil
}

func calculateNetworkRates(firstRx, firstTx, secondRx, secondTx uint64, elapsed time.Duration) (float64, float64, error) {
	if secondRx < firstRx || secondTx < firstTx {
		return 0, 0, errors.New("network counters moved backwards")
	}
	if elapsed <= 0 {
		return 0, 0, errors.New("invalid network sample interval")
	}
	seconds := elapsed.Seconds()
	return float64(secondRx-firstRx) / seconds, float64(secondTx-firstTx) / seconds, nil
}

func parseProcessList(input string) ([]ProcessInfo, error) {
	processes := make([]ProcessInfo, 0, maxMetricProcesses)
	for lineNumber, line := range strings.Split(input, "\n") {
		if strings.TrimSpace(line) == "" {
			continue
		}
		if len(processes) == maxMetricProcesses {
			break
		}
		columns, command := splitProcessColumns(line, 5)
		if len(columns) != 5 || command == "" {
			return nil, fmt.Errorf("invalid process line %d", lineNumber+1)
		}
		pid, err := strconv.Atoi(columns[0])
		if err != nil || pid <= 0 {
			return nil, fmt.Errorf("invalid process PID on line %d", lineNumber+1)
		}
		cpu, err := nonNegativeFloat(columns[2])
		if err != nil {
			return nil, fmt.Errorf("invalid process CPU on line %d", lineNumber+1)
		}
		memory, err := nonNegativeFloat(columns[3])
		if err != nil {
			return nil, fmt.Errorf("invalid process memory on line %d", lineNumber+1)
		}
		rss, err := strconv.ParseUint(columns[4], 10, 64)
		if err != nil || rss > math.MaxUint64/1024 {
			return nil, fmt.Errorf("invalid process RSS on line %d", lineNumber+1)
		}
		processes = append(processes, ProcessInfo{
			PID: pid, User: columns[1], CPUPercent: cpu, MemoryPercent: memory,
			MemoryBytes: rss * 1024, Command: command,
		})
	}
	return processes, nil
}

func splitProcessColumns(line string, count int) ([]string, string) {
	columns := make([]string, 0, count)
	rest := strings.TrimSpace(line)
	for len(columns) < count {
		if rest == "" {
			return columns, ""
		}
		index := strings.IndexAny(rest, " \t")
		if index < 0 {
			return columns, ""
		}
		columns = append(columns, rest[:index])
		rest = strings.TrimSpace(rest[index:])
	}
	return columns, strings.TrimSpace(rest)
}

func nonNegativeFloat(input string) (float64, error) {
	value, err := strconv.ParseFloat(input, 64)
	if err != nil || math.IsNaN(value) || math.IsInf(value, 0) || value < 0 {
		return 0, errors.New("invalid non-negative number")
	}
	return value, nil
}

func parseDarwinCPU(input string) (float64, error) {
	var result float64
	found := false
	for _, line := range strings.Split(input, "\n") {
		if !strings.HasPrefix(line, "CPU usage:") {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 8 {
			return 0, errors.New("invalid top CPU line")
		}
		idle, err := nonNegativeFloat(strings.TrimSuffix(fields[len(fields)-2], "%"))
		if err != nil || idle > 100 {
			return 0, errors.New("invalid top idle percentage")
		}
		result, found = 100-idle, true
	}
	if !found {
		return 0, errors.New("top CPU sample not found")
	}
	return result, nil
}

func parseDarwinMemory(sysctlOutput, vmStatOutput string) (total, used uint64, usedPercent float64, err error) {
	values := strings.Fields(sysctlOutput)
	if len(values) != 2 {
		return 0, 0, 0, errors.New("invalid macOS memory sizes")
	}
	total, err = strconv.ParseUint(values[0], 10, 64)
	if err != nil {
		return 0, 0, 0, errors.New("invalid macOS total memory")
	}
	pageSize, err := strconv.ParseUint(values[1], 10, 64)
	if err != nil || pageSize == 0 {
		return 0, 0, 0, errors.New("invalid macOS page size")
	}
	pageKeys := []string{"Pages active", "Pages wired down", "Pages occupied by compressor"}
	for _, key := range pageKeys {
		found := false
		for _, line := range strings.Split(vmStatOutput, "\n") {
			if !strings.HasPrefix(line, key+":") {
				continue
			}
			fields := strings.Fields(line)
			pages, parseErr := strconv.ParseUint(strings.TrimSuffix(fields[len(fields)-1], "."), 10, 64)
			if parseErr != nil || pages > math.MaxUint64/pageSize || used > math.MaxUint64-pages*pageSize {
				return 0, 0, 0, fmt.Errorf("invalid %s value", key)
			}
			used += pages * pageSize
			found = true
			break
		}
		if !found {
			return 0, 0, 0, fmt.Errorf("%s not found", key)
		}
	}
	if total == 0 || used > total {
		return 0, 0, 0, errors.New("invalid macOS memory counters")
	}
	return total, used, percent(float64(used), float64(total)), nil
}

func parseDarwinNetwork(input string) (rx, tx uint64, err error) {
	// The link-level row avoids counting an interface again for each address.
	type counters struct{ rx, tx uint64 }
	interfaces := make(map[string]counters)
	for _, line := range strings.Split(input, "\n") {
		fields := strings.Fields(line)
		if len(fields) < 10 || !strings.HasPrefix(fields[2], "<Link#") || strings.HasPrefix(fields[0], "lo") {
			continue
		}
		rxValue, rxErr := strconv.ParseUint(fields[6], 10, 64)
		txValue, txErr := strconv.ParseUint(fields[9], 10, 64)
		if rxErr != nil || txErr != nil {
			return 0, 0, errors.New("invalid macOS network byte counter")
		}
		interfaces[fields[0]] = counters{rx: rxValue, tx: txValue}
	}
	for _, value := range interfaces {
		if math.MaxUint64-rx < value.rx || math.MaxUint64-tx < value.tx {
			return 0, 0, errors.New("macOS network byte counter overflow")
		}
		rx += value.rx
		tx += value.tx
	}
	return rx, tx, nil
}

func percent(value, total float64) float64 {
	if total <= 0 {
		return 0
	}
	return math.Max(0, math.Min(100, value*100/total))
}

func waitMetricSample(ctx context.Context) error {
	timer := time.NewTimer(metricSampleInterval)
	defer timer.Stop()
	select {
	case <-timer.C:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func runLocalMetricCommand(ctx context.Context, name string, args ...string) (string, error) {
	commandCtx, cancel := context.WithTimeout(ctx, metricCommandTimeout)
	defer cancel()
	output, err := exec.CommandContext(commandCtx, name, args...).CombinedOutput()
	if commandCtx.Err() != nil {
		return "", commandCtx.Err()
	}
	if err != nil {
		return "", fmt.Errorf("%s metrics failed: %w", name, err)
	}
	return string(output), nil
}

func validateProcessTermination(pid int, signal string) (string, error) {
	if pid <= 0 {
		return "", errors.New("process PID must be a positive number")
	}
	signal = strings.ToUpper(strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(signal), "-")))
	if signal == "" {
		signal = "TERM"
	}
	switch signal {
	case "HUP", "INT", "QUIT", "TERM", "KILL", "USR1", "USR2":
		return signal, nil
	default:
		return "", errors.New("unsupported process signal")
	}
}

func sshProcessKillCommand(pid int, signal string) (string, error) {
	signal, err := validateProcessTermination(pid, signal)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("kill -%s -- %d", signal, pid), nil
}
