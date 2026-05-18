package main

import "sync"

type DiagnosticCollector struct {
	mu          sync.Mutex
	diagnostics []diagnostic
}

func NewDiagnosticCollector() *DiagnosticCollector {
	return &DiagnosticCollector{}
}

func (c *DiagnosticCollector) Record(d diagnostic) {
	if c == nil {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.diagnostics = appendUniqueDiagnostic(c.diagnostics, d)
}

func (c *DiagnosticCollector) Snapshot() []diagnostic {
	if c == nil {
		return nil
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	return append([]diagnostic(nil), c.diagnostics...)
}

func (c *DiagnosticCollector) Drain() []diagnostic {
	if c == nil {
		return nil
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	out := append([]diagnostic(nil), c.diagnostics...)
	c.diagnostics = nil
	return out
}

func appendUniqueDiagnostic(diagnostics []diagnostic, d diagnostic) []diagnostic {
	for _, existing := range diagnostics {
		if existing.Severity == d.Severity &&
			existing.Channel == d.Channel &&
			existing.Code == d.Code &&
			existing.Message == d.Message {
			return diagnostics
		}
	}
	return append(diagnostics, d)
}
