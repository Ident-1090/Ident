package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	defaultLOSAlts    = "12192m"
	defaultLOSBaseURL = "http://www.heywhatsthat.com/api/upintheair.json"
	defaultLOSTimeout = 10 * time.Second
)

type LOSOptions struct {
	PanoramaID string
	Alts       string
	CacheDir   string
	BaseURL    string
	Client     *http.Client
}

type LOSCache struct {
	panoramaID string
	alts       string
	cacheDir   string
	baseURL    string
	client     *http.Client
	outFile    string
	urlFile    string
	mu         sync.Mutex
}

func NewLOSCache(opts LOSOptions) *LOSCache {
	cacheDir := strings.TrimSpace(opts.CacheDir)
	if cacheDir == "" {
		cacheDir = filepath.Join(os.TempDir(), "identd")
	}
	baseURL := strings.TrimSpace(opts.BaseURL)
	if baseURL == "" {
		baseURL = defaultLOSBaseURL
	}
	client := opts.Client
	if client == nil {
		client = &http.Client{Timeout: defaultLOSTimeout}
	}
	return &LOSCache{
		panoramaID: strings.TrimSpace(opts.PanoramaID),
		alts:       strings.TrimSpace(opts.Alts),
		cacheDir:   cacheDir,
		baseURL:    baseURL,
		client:     client,
		outFile:    filepath.Join(cacheDir, "upintheair.json"),
		urlFile:    filepath.Join(cacheDir, "upintheair.url"),
	}
}

func (c *LOSCache) OutputPath() string {
	if c == nil {
		return ""
	}
	return c.outFile
}

func (c *LOSCache) Load(ctx context.Context) ([]byte, error) {
	if c == nil {
		return nil, nil
	}

	c.mu.Lock()
	defer c.mu.Unlock()

	if c.panoramaID == "" {
		c.clear()
		return nil, nil
	}

	requestURL, err := c.requestURL()
	if err != nil {
		c.clear()
		return nil, err
	}

	if body, ok := c.cachedBody(requestURL); ok {
		return body, nil
	}

	body, err := c.fetch(ctx, requestURL)
	if err != nil {
		c.clear()
		return nil, err
	}
	if err := os.MkdirAll(c.cacheDir, 0o755); err != nil {
		return nil, fmt.Errorf("create LOS cache dir: %w", err)
	}
	if err := writeFileAtomic(c.outFile, body, 0o644); err != nil {
		return nil, err
	}
	if err := writeFileAtomic(c.urlFile, []byte(requestURL+"\n"), 0o644); err != nil {
		return nil, err
	}
	return body, nil
}

func (c *LOSCache) cachedBody(requestURL string) ([]byte, bool) {
	urlBody, err := os.ReadFile(c.urlFile)
	if err != nil {
		return nil, false
	}
	if strings.TrimSpace(string(urlBody)) != requestURL {
		return nil, false
	}
	body, err := os.ReadFile(c.outFile)
	if err != nil || !json.Valid(body) {
		return nil, false
	}
	return body, true
}

func (c *LOSCache) fetch(ctx context.Context, requestURL string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, requestURL, nil)
	if err != nil {
		return nil, fmt.Errorf("build LOS request: %w", err)
	}
	req.Header.Set("User-Agent", "identd/"+safeUserAgentVersion(CurrentVersionInfo().Version))

	resp, err := c.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("download LOS rings: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("download LOS rings: HTTP %d", resp.StatusCode)
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read LOS rings: %w", err)
	}
	if !json.Valid(body) {
		return nil, fmt.Errorf("download LOS rings: invalid JSON payload")
	}
	return body, nil
}

func (c *LOSCache) requestURL() (string, error) {
	alts, err := normalizeLOSAlts(c.alts)
	if err != nil {
		return "", err
	}
	base, err := url.Parse(c.baseURL)
	if err != nil {
		return "", fmt.Errorf("invalid LOS API URL: %w", err)
	}
	query := base.Query()
	query.Set("id", c.panoramaID)
	query.Set("refraction", "0.25")
	query.Set("alts", alts)
	base.RawQuery = query.Encode()
	return base.String(), nil
}

func (c *LOSCache) clear() {
	_ = os.Remove(c.outFile)
	_ = os.Remove(c.urlFile)
}

func normalizeLOSAlts(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		raw = defaultLOSAlts
	}
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		meters, err := parseLOSAltEntry(part)
		if err != nil {
			return "", err
		}
		out = append(out, strconv.Itoa(meters))
	}
	return strings.Join(out, ","), nil
}

func parseLOSAltEntry(raw string) (int, error) {
	value := strings.TrimSpace(raw)
	if value == "" {
		return 0, fmt.Errorf("invalid LOS altitude %q", raw)
	}

	unit := "ft"
	switch {
	case strings.HasSuffix(value, "km"):
		unit = "km"
		value = strings.TrimSuffix(value, "km")
	case strings.HasSuffix(value, "ft"):
		unit = "ft"
		value = strings.TrimSuffix(value, "ft")
	case strings.HasSuffix(value, "m"):
		unit = "m"
		value = strings.TrimSuffix(value, "m")
	}

	number, err := strconv.ParseFloat(strings.TrimSpace(value), 64)
	if err != nil || !isFinitePositive(number) {
		return 0, fmt.Errorf("invalid LOS altitude %q", raw)
	}

	switch unit {
	case "km":
		return int(math.Round(number * 1000)), nil
	case "m":
		return int(math.Round(number)), nil
	default:
		return int(math.Round(number / 3.28084)), nil
	}
}

func isFinitePositive(v float64) bool {
	return !math.IsNaN(v) && !math.IsInf(v, 0) && v > 0
}

func writeFileAtomic(path string, body []byte, mode os.FileMode) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("create cache dir %s: %w", dir, err)
	}
	tmp, err := os.CreateTemp(dir, filepath.Base(path)+".tmp-*")
	if err != nil {
		return fmt.Errorf("create temp file for %s: %w", path, err)
	}
	tmpPath := tmp.Name()
	defer func() {
		_ = os.Remove(tmpPath)
	}()

	if _, err := tmp.Write(body); err != nil {
		_ = tmp.Close()
		return fmt.Errorf("write temp file for %s: %w", path, err)
	}
	if err := tmp.Chmod(mode); err != nil {
		_ = tmp.Close()
		return fmt.Errorf("chmod temp file for %s: %w", path, err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("close temp file for %s: %w", path, err)
	}
	if err := os.Rename(tmpPath, path); err != nil {
		return fmt.Errorf("rename temp file for %s: %w", path, err)
	}
	return nil
}
