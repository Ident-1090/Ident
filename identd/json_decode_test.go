package main

import (
	"strings"
	"testing"
)

func TestDecodeIdentJSONWrapsTrailingDecodeError(t *testing.T) {
	var got struct {
		Schema string `json:"schema"`
	}
	err := decodeIdentJSON(strings.NewReader(`{"schema":"ident.test.v1"} {"unterminated"`), &got)
	if err == nil {
		t.Fatal("decodeIdentJSON returned nil for malformed trailing content")
	}
	if !strings.Contains(err.Error(), "decoding trailing content") {
		t.Fatalf("error = %q, want trailing content context", err)
	}
	if !strings.Contains(err.Error(), "invalid character") && !strings.Contains(err.Error(), "unexpected EOF") {
		t.Fatalf("error = %q, want underlying decoder error", err)
	}
}
