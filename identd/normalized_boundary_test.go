package main

import (
	"reflect"
	"testing"
)

func TestReplayAndTrailStoresDoNotExposeRawAircraftIngest(t *testing.T) {
	for _, tc := range []struct {
		name string
		typ  reflect.Type
	}{
		{name: "ReplayStore", typ: reflect.TypeOf(&ReplayStore{})},
		{name: "TrailStore", typ: reflect.TypeOf(&TrailStore{})},
	} {
		if _, ok := tc.typ.MethodByName("IngestAircraftJSON"); ok {
			t.Fatalf("%s exposes raw aircraft JSON ingest; use normalized identAircraftFrame", tc.name)
		}
	}
}
