package main

import "testing"

func TestParseRuntimeCPUStatAndUsage(t *testing.T) {
	first, ok := parseRuntimeCPUStat("cpu  100 0 50 850 0 0 0 0 0 0\n")
	if !ok {
		t.Fatal("first CPU sample did not parse")
	}
	second, ok := parseRuntimeCPUStat("cpu  150 0 75 875 0 0 0 0 0 0\n")
	if !ok {
		t.Fatal("second CPU sample did not parse")
	}

	pct, ok := cpuUsagePct(first, second)

	if !ok || pct != 75 {
		t.Fatalf("cpu usage = %v ok=%v, want 75 true", pct, ok)
	}
}

func TestParseRuntimeMemoryPct(t *testing.T) {
	pct, ok := parseRuntimeMemoryPct("MemTotal: 1000 kB\nMemAvailable: 250 kB\n")

	if !ok || pct != 75 {
		t.Fatalf("memory usage = %v ok=%v, want 75 true", pct, ok)
	}
}
