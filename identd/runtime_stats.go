package main

import (
	"os"
	"strconv"
	"strings"
)

type RuntimeStatsSample struct {
	CPUPct *float64
	RAMPct *float64
}

type runtimeCPUStat struct {
	total uint64
	idle  uint64
}

func newRuntimeStatsProvider() func() RuntimeStatsSample {
	var previous *runtimeCPUStat
	return func() RuntimeStatsSample {
		var sample RuntimeStatsSample
		if stat, ok := readRuntimeCPUStat("/proc/stat"); ok {
			if previous != nil {
				if pct, ok := cpuUsagePct(*previous, stat); ok {
					sample.CPUPct = &pct
				}
			}
			previous = &stat
		}
		if pct, ok := readRuntimeMemoryPct("/proc/meminfo"); ok {
			sample.RAMPct = &pct
		}
		return sample
	}
}

func readRuntimeCPUStat(path string) (runtimeCPUStat, bool) {
	body, err := os.ReadFile(path)
	if err != nil {
		return runtimeCPUStat{}, false
	}
	return parseRuntimeCPUStat(string(body))
}

func parseRuntimeCPUStat(body string) (runtimeCPUStat, bool) {
	for _, line := range strings.Split(body, "\n") {
		fields := strings.Fields(line)
		if len(fields) < 5 || fields[0] != "cpu" {
			continue
		}
		var total uint64
		values := make([]uint64, 0, len(fields)-1)
		for _, raw := range fields[1:] {
			value, err := strconv.ParseUint(raw, 10, 64)
			if err != nil {
				return runtimeCPUStat{}, false
			}
			values = append(values, value)
			total += value
		}
		idle := values[3]
		if len(values) > 4 {
			idle += values[4]
		}
		if total == 0 {
			return runtimeCPUStat{}, false
		}
		return runtimeCPUStat{total: total, idle: idle}, true
	}
	return runtimeCPUStat{}, false
}

func cpuUsagePct(previous, current runtimeCPUStat) (float64, bool) {
	if current.total <= previous.total || current.idle < previous.idle {
		return 0, false
	}
	totalDelta := current.total - previous.total
	idleDelta := current.idle - previous.idle
	if idleDelta > totalDelta {
		return 0, false
	}
	return (float64(totalDelta-idleDelta) / float64(totalDelta)) * 100, true
}

func readRuntimeMemoryPct(path string) (float64, bool) {
	body, err := os.ReadFile(path)
	if err != nil {
		return 0, false
	}
	return parseRuntimeMemoryPct(string(body))
}

func parseRuntimeMemoryPct(body string) (float64, bool) {
	var total, available uint64
	for _, line := range strings.Split(body, "\n") {
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		value, err := strconv.ParseUint(fields[1], 10, 64)
		if err != nil {
			continue
		}
		switch fields[0] {
		case "MemTotal:":
			total = value
		case "MemAvailable:":
			available = value
		}
	}
	if total == 0 || available > total {
		return 0, false
	}
	return (1 - float64(available)/float64(total)) * 100, true
}
