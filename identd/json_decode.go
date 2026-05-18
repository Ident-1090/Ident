package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
)

func decodeIdentJSON(r io.Reader, v any) error {
	dec := json.NewDecoder(r)
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		return err
	}
	var extra any
	if err := dec.Decode(&extra); err != nil {
		if errors.Is(err, io.EOF) {
			return nil
		}
		return fmt.Errorf("decoding trailing content: %w", err)
	}
	return fmt.Errorf("unexpected trailing JSON")
}
