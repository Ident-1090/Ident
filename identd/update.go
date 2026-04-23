package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
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
	lastStatus    string
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

type githubCompare struct {
	Status string `json:"status"`
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
		status.Status = c.lastStatus
		if status.Status == "" {
			status.Status = UpdateUnknown
		}
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
	status.Status = c.classifyUpdate(fetchCtx, latest)
	c.lastSuccess = latest
	c.lastStatus = status.Status
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
	owner, name, ok := splitRepo(repo)
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

func (c *UpdateChecker) classifyUpdate(ctx context.Context, latest *ReleaseInfo) string {
	if latest == nil {
		return UpdateUnknown
	}
	latestVersion := strings.TrimSpace(latest.Version)
	currentVersion := strings.TrimSpace(c.current.Version)
	if latestVersion != "" && currentVersion == latestVersion {
		return UpdateCurrent
	}
	currentCommit := normalizeCommit(c.current.Commit)
	if currentCommit == "" || latestVersion == "" {
		return UpdateUnknown
	}
	status, err := c.compareToLatest(ctx, currentCommit, latestVersion)
	if err != nil {
		return UpdateUnknown
	}
	return mapCompareStatus(status)
}

func (c *UpdateChecker) compareToLatest(ctx context.Context, currentCommit, latestVersion string) (string, error) {
	endpoint, err := compareURL(c.apiBase, c.repo, currentCommit, latestVersion)
	if err != nil {
		return "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "identd/"+safeUserAgentVersion(c.current.Version))

	resp, err := c.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("compare latest release: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("GitHub compare returned HTTP %d", resp.StatusCode)
	}

	var compare githubCompare
	if err := json.NewDecoder(resp.Body).Decode(&compare); err != nil {
		return "", fmt.Errorf("decode compare: %w", err)
	}
	return strings.TrimSpace(compare.Status), nil
}

func compareURL(apiBase, repo, currentCommit, latestVersion string) (string, error) {
	owner, name, ok := splitRepo(repo)
	if !ok || owner == "" || name == "" || strings.Contains(name, "/") {
		return "", fmt.Errorf("invalid update repo %q", repo)
	}
	base, err := url.Parse(strings.TrimRight(apiBase, "/") + "/")
	if err != nil {
		return "", fmt.Errorf("invalid update API URL: %w", err)
	}
	rel := &url.URL{
		Path: "repos/" + owner + "/" + name + "/compare/" + currentCommit + "..." + strings.TrimSpace(latestVersion),
	}
	return base.ResolveReference(rel).String(), nil
}

func splitRepo(repo string) (owner, name string, ok bool) {
	owner, name, ok = strings.Cut(strings.Trim(repo, "/"), "/")
	return owner, name, ok
}

func mapCompareStatus(status string) string {
	switch status {
	case "behind":
		return UpdateAvailable
	case "diverged":
		return UpdateAvailable
	case "ahead", "identical":
		return UpdateCurrent
	default:
		return UpdateUnknown
	}
}

func normalizeCommit(raw string) string {
	raw = strings.ToLower(strings.TrimSpace(raw))
	if raw == "" || raw == "unknown" {
		return ""
	}
	if strings.HasPrefix(raw, "g") {
		raw = raw[1:]
	}
	if !isHexString(raw) {
		return ""
	}
	return raw
}

func isHexString(raw string) bool {
	if raw == "" {
		return false
	}
	for _, r := range raw {
		if (r < '0' || r > '9') && (r < 'a' || r > 'f') {
			return false
		}
	}
	return true
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
