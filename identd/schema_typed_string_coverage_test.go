package main

import (
	"reflect"
	"sort"
	"testing"
)

// TestTypedStringsHaveSchemaOverrides walks every Go type reachable from the
// wire-payload roots and fails if any named type whose underlying kind is
// reflect.String lacks an entry in identTypeSchemaOverrides. Without an
// override the jsonschema generator emits {"type":"string"} with no enum,
// silently dropping the closed-enum contract.
func TestTypedStringsHaveSchemaOverrides(t *testing.T) {
	roots := []reflect.Type{
		reflect.TypeFor[identAircraftFrame](),
		reflect.TypeFor[capabilitiesPayload](),
		reflect.TypeFor[identConfig](),
		reflect.TypeFor[identRangeOutline](),
		reflect.TypeFor[identReplayAvailability](),
		reflect.TypeFor[identRoutes](),
		reflect.TypeFor[identStatus](),
	}

	registered := map[reflect.Type]bool{}
	for typ := range identTypeSchemaOverrides() {
		registered[typ] = true
	}

	used := map[reflect.Type]bool{}
	visited := map[reflect.Type]bool{}
	for _, root := range roots {
		collectTypedStrings(root, used, visited, registered)
	}

	plainString := reflect.TypeFor[string]()

	var missing []string
	for typ := range used {
		if typ == plainString {
			continue
		}
		if registered[typ] {
			continue
		}
		missing = append(missing, typ.String())
	}
	sort.Strings(missing)
	if len(missing) > 0 {
		t.Fatalf("typed-string fields without a TypeSchemas override: %v\n"+
			"add entries to identTypeSchemaOverrides so the generated schema includes the enum", missing)
	}
}

// collectTypedStrings walks typ and records every named type whose underlying
// kind is reflect.String. Recursion stops at registered types because those
// have a hand-authored schema override and the generator never descends into
// them, so any inner typed-strings are unreachable from generated output.
func collectTypedStrings(typ reflect.Type, used, visited, registered map[reflect.Type]bool) {
	if typ == nil || visited[typ] {
		return
	}
	visited[typ] = true

	if registered[typ] {
		return
	}

	if typ.Kind() == reflect.String && typ.PkgPath() != "" {
		used[typ] = true
		return
	}

	switch typ.Kind() {
	case reflect.Pointer, reflect.Slice, reflect.Array:
		collectTypedStrings(typ.Elem(), used, visited, registered)
	case reflect.Map:
		collectTypedStrings(typ.Key(), used, visited, registered)
		collectTypedStrings(typ.Elem(), used, visited, registered)
	case reflect.Struct:
		for i := 0; i < typ.NumField(); i++ {
			field := typ.Field(i)
			if !field.IsExported() {
				continue
			}
			collectTypedStrings(field.Type, used, visited, registered)
		}
	}
}
