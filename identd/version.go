package main

var (
	version   = "dev"
	commit    = "unknown"
	buildDate = "unknown"
)

type VersionInfo struct {
	Version string `json:"version"`
	Commit  string `json:"commit"`
	Date    string `json:"date"`
}

func CurrentVersionInfo() VersionInfo {
	return VersionInfo{
		Version: version,
		Commit:  commit,
		Date:    buildDate,
	}
}
