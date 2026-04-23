package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	UpdateCurrent     = "current"
	UpdateAvailable   = "available"
	UpdateUnavailable = "unavailable"
	UpdateDisabled    = "disabled"
	UpdateUnknown     = "unknown"
)

const (
	defaultUpdateRepo     = "Ident-1090/Ident"
	defaultUpdateAPIBase  = "https://api.github.com"
	defaultUpdateInterval = 24 * time.Hour
	defaultUpdateTimeout  = 10 * time.Second
)

type ReleaseInfo struct {
	Version     string `json:"version"`
	Name        string `json:"name,omitempty"`
	URL         string `json:"url,omitempty"`
	PublishedAt string `json:"publishedAt,omitempty"`
}

type UpdateStatus struct {
	Enabled       bool         `json:"enabled"`
	Status        string       `json:"status"`
	Current       VersionInfo  `json:"current"`
	Latest        *ReleaseInfo `json:"latest,omitempty"`
	CheckedAt     string       `json:"checkedAt,omitempty"`
	LastSuccessAt string       `json:"lastSuccessAt,omitempty"`
	Error         string       `json:"error,omitempty"`
}

type UpdateCheckerOptions struct {
	Enabled bool
	Repo    string
	APIBase string
	TTL     time.Duration
	Timeout time.Duration
	Current VersionInfo
	Client  *http.Client
	Now     func() time.Time
}

type UpdateChecker struct {
	enabled bool
	repo    string
	apiBase string
	ttl     time.Duration
	timeout time.Duration
	current VersionInfo
	client  *http.Client
	now     func() time.Time

	mu            sync.Mutex
	cached        UpdateStatus
	cachedAt      time.Time
	lastSuccess   *ReleaseInfo
	lastSuccessAt string
	etag          string
	inFlight      chan struct{}
}

type githubRelease struct {
	TagName     string    `json:"tag_name"`
	Name        string    `json:"name"`
	HTMLURL     string    `json:"html_url"`
	PublishedAt time.Time `json:"published_at"`
}

func NewUpdateChecker(opts UpdateCheckerOptions) *UpdateChecker {
	repo := strings.TrimSpace(opts.Repo)
	if repo == "" {
		repo = defaultUpdateRepo
	}
	apiBase := strings.TrimRight(strings.TrimSpace(opts.APIBase), "/")
	if apiBase == "" {
		apiBase = defaultUpdateAPIBase
	}
	ttl := opts.TTL
	if ttl <= 0 {
		ttl = defaultUpdateInterval
	}
	timeout := opts.Timeout
	if timeout <= 0 {
		timeout = defaultUpdateTimeout
	}
	client := opts.Client
	if client == nil {
		client = &http.Client{Timeout: timeout}
	}
	now := opts.Now
	if now == nil {
		now = time.Now
	}
	current := opts.Current
	if current.Version == "" {
		current = CurrentVersionInfo()
	}

	return &UpdateChecker{
		enabled: opts.Enabled,
		repo:    repo,
		apiBase: apiBase,
		ttl:     ttl,
		timeout: timeout,
		current: current,
		client:  client,
		now:     now,
	}
}

func (c *UpdateChecker) Status(ctx context.Context) UpdateStatus {
	now := c.now()
	if !c.enabled {
		return UpdateStatus{
			Enabled: false,
			Status:  UpdateDisabled,
			Current: c.current,
		}
	}

	c.mu.Lock()
	if !c.cachedAt.IsZero() && now.Sub(c.cachedAt) < c.ttl {
		status := c.cached
		c.mu.Unlock()
		return status
	}
	if c.inFlight != nil {
		ch := c.inFlight
		c.mu.Unlock()
		select {
		case <-ch:
			return c.Status(ctx)
		case <-ctx.Done():
			return c.unavailable(now, ctx.Err())
		}
	}
	c.inFlight = make(chan struct{})
	c.mu.Unlock()

	fetchCtx, cancel := context.WithTimeout(ctx, c.timeout)
	defer cancel()

	latest, notModified, etag, err := c.fetchLatest(fetchCtx)
	checkedAt := formatTime(now)
	status := UpdateStatus{
		Enabled:   true,
		Current:   c.current,
		CheckedAt: checkedAt,
	}

	c.mu.Lock()
	defer c.mu.Unlock()
	defer func() {
		close(c.inFlight)
		c.inFlight = nil
	}()

	if err != nil {
		status = c.unavailableLocked(checkedAt, err)
		c.cached = status
		c.cachedAt = now
		return status
	}

	if etag != "" {
		c.etag = etag
	}
	if notModified && c.lastSuccess != nil {
		status.Latest = c.lastSuccess
		status.LastSuccessAt = c.lastSuccessAt
		status.Status = classifyUpdate(c.current.Version, c.lastSuccess.Version)
		c.cached = status
		c.cachedAt = now
		return status
	}
	if latest == nil {
		status = c.unavailableLocked(checkedAt, fmt.Errorf("latest release was not available"))
		c.cached = status
		c.cachedAt = now
		return status
	}

	status.Latest = latest
	status.LastSuccessAt = checkedAt
	status.Status = classifyUpdate(c.current.Version, latest.Version)
	c.lastSuccess = latest
	c.lastSuccessAt = checkedAt
	c.cached = status
	c.cachedAt = now
	return status
}

func (c *UpdateChecker) unavailable(now time.Time, err error) UpdateStatus {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.unavailableLocked(formatTime(now), err)
}

func (c *UpdateChecker) unavailableLocked(checkedAt string, err error) UpdateStatus {
	return UpdateStatus{
		Enabled:       true,
		Status:        UpdateUnavailable,
		Current:       c.current,
		Latest:        c.lastSuccess,
		CheckedAt:     checkedAt,
		LastSuccessAt: c.lastSuccessAt,
		Error:         err.Error(),
	}
}

func (c *UpdateChecker) fetchLatest(ctx context.Context) (*ReleaseInfo, bool, string, error) {
	endpoint, err := latestReleaseURL(c.apiBase, c.repo)
	if err != nil {
		return nil, false, "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, false, "", err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "identd/"+safeUserAgentVersion(c.current.Version))
	if c.etag != "" {
		req.Header.Set("If-None-Match", c.etag)
	}

	resp, err := c.client.Do(req)
	if err != nil {
		return nil, false, "", fmt.Errorf("update check failed: %w", err)
	}
	defer resp.Body.Close()

	etag := strings.TrimSpace(resp.Header.Get("ETag"))
	if resp.StatusCode == http.StatusNotModified {
		return nil, true, etag, nil
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, false, etag, fmt.Errorf("GitHub latest release returned HTTP %d", resp.StatusCode)
	}

	var release githubRelease
	if err := json.NewDecoder(resp.Body).Decode(&release); err != nil {
		return nil, false, etag, fmt.Errorf("decode latest release: %w", err)
	}
	tag := strings.TrimSpace(release.TagName)
	if tag == "" {
		return nil, false, etag, fmt.Errorf("latest release did not include a tag")
	}
	info := &ReleaseInfo{
		Version: tag,
		Name:    strings.TrimSpace(release.Name),
		URL:     strings.TrimSpace(release.HTMLURL),
	}
	if !release.PublishedAt.IsZero() {
		info.PublishedAt = formatTime(release.PublishedAt)
	}
	return info, false, etag, nil
}

func latestReleaseURL(apiBase, repo string) (string, error) {
	owner, name, ok := strings.Cut(strings.Trim(repo, "/"), "/")
	if !ok || owner == "" || name == "" || strings.Contains(name, "/") {
		return "", fmt.Errorf("invalid update repo %q", repo)
	}
	base, err := url.Parse(strings.TrimRight(apiBase, "/") + "/")
	if err != nil {
		return "", fmt.Errorf("invalid update API URL: %w", err)
	}
	rel := &url.URL{Path: "repos/" + owner + "/" + name + "/releases/latest"}
	return base.ResolveReference(rel).String(), nil
}

func classifyUpdate(current, latest string) string {
	cmp, ok := compareReleaseVersions(current, latest)
	if !ok {
		return UpdateUnknown
	}
	if cmp < 0 {
		return UpdateAvailable
	}
	return UpdateCurrent
}

func compareReleaseVersions(current, latest string) (int, bool) {
	currentParts, ok := parseReleaseVersion(current)
	if !ok {
		return 0, false
	}
	latestParts, ok := parseReleaseVersion(latest)
	if !ok {
		return 0, false
	}
	for i := range currentParts {
		if currentParts[i] < latestParts[i] {
			return -1, true
		}
		if currentParts[i] > latestParts[i] {
			return 1, true
		}
	}
	return 0, true
}

func parseReleaseVersion(raw string) ([3]int, bool) {
	var out [3]int
	s := strings.TrimSpace(strings.TrimPrefix(raw, "v"))
	if s == "" || s == "dev" || s == "unknown" {
		return out, false
	}
	main, _, _ := strings.Cut(s, "-")
	parts := strings.Split(main, ".")
	if len(parts) < 2 || len(parts) > 3 {
		return out, false
	}
	for i, part := range parts {
		if part == "" {
			return out, false
		}
		n, err := strconv.Atoi(part)
		if err != nil {
			return out, false
		}
		out[i] = n
	}
	return out, true
}

func formatTime(t time.Time) string {
	return t.UTC().Format(time.RFC3339)
}

func safeUserAgentVersion(v string) string {
	v = strings.TrimSpace(v)
	if v == "" {
		return "dev"
	}
	return strings.Map(func(r rune) rune {
		if r >= 'A' && r <= 'Z' || r >= 'a' && r <= 'z' || r >= '0' && r <= '9' {
			return r
		}
		switch r {
		case '.', '-', '_':
			return r
		default:
			return '-'
		}
	}, v)
}
