package main

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"testing"

	"github.com/google/jsonschema-go/jsonschema"
)

const identSchemaDir = "../schemas/ident"

type identSchemaSpec struct {
	name  string
	title string
	build func(t *testing.T) *jsonschema.Schema
}

func TestIdentSchemasAreCurrent(t *testing.T) {
	specs := identSchemaSpecs()
	update := os.Getenv("IDENT_UPDATE_SCHEMAS") == "1"
	for _, spec := range specs {
		t.Run(spec.name, func(t *testing.T) {
			got := marshalIdentSchema(t, spec.build(t))
			path := filepath.Join(identSchemaDir, spec.name+".schema.json")
			if update {
				if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
					t.Fatalf("mkdir schema dir: %v", err)
				}
				if err := os.WriteFile(path, got, 0o644); err != nil {
					t.Fatalf("write schema: %v", err)
				}
				return
			}
			want, err := os.ReadFile(path)
			if err != nil {
				t.Fatalf("read schema: %v; run IDENT_UPDATE_SCHEMAS=1 go test . -run TestIdentSchemasAreCurrent", err)
			}
			if !bytes.Equal(want, got) {
				t.Fatalf("schema is stale; run IDENT_UPDATE_SCHEMAS=1 go test . -run TestIdentSchemasAreCurrent")
			}
		})
	}
}

func identSchemaSpecs() []identSchemaSpec {
	return []identSchemaSpec{
		{"ident.aircraft.v1", "Ident aircraft frame", func(t *testing.T) *jsonschema.Schema {
			schema := inferIdentSchema[identAircraftFrame](t, "ident.aircraft.v1", "Ident aircraft frame")
			requireConstSchema(schema, "ident.aircraft.v1")
			return schema
		}},
		{"ident.capabilities.v1", "Ident capabilities", func(t *testing.T) *jsonschema.Schema {
			schema := inferIdentSchema[capabilitiesPayload](t, "ident.capabilities.v1", "Ident capabilities")
			requireConstSchema(schema, "ident.capabilities.v1")
			return schema
		}},
		{"ident.config.v1", "Ident config", func(t *testing.T) *jsonschema.Schema {
			schema := inferIdentSchema[identConfig](t, "ident.config.v1", "Ident config")
			requireConstSchema(schema, "ident.config.v1")
			schema.Properties["lineOfSight"] = anyObjectSchema()
			return schema
		}},
		{"ident.rangeOutline.v1", "Ident range outline", func(t *testing.T) *jsonschema.Schema {
			schema := inferIdentSchema[identRangeOutline](t, "ident.rangeOutline.v1", "Ident range outline")
			requireConstSchema(schema, "ident.rangeOutline.v1")
			schema.Properties["source"] = stringEnumSchema("outline_json")
			schema.Properties["scope"] = stringEnumSchema("last24h", "alltime", "points", "other")
			return schema
		}},
		{"ident.replay.availability.v1", "Ident replay availability", func(t *testing.T) *jsonschema.Schema {
			schema := inferIdentSchema[identReplayAvailability](t, "ident.replay.availability.v1", "Ident replay availability")
			requireConstSchema(schema, "ident.replay.availability.v1")
			return schema
		}},
		{"ident.routes.v1", "Ident routes", func(t *testing.T) *jsonschema.Schema {
			schema := inferIdentSchema[identRoutes](t, "ident.routes.v1", "Ident routes")
			requireConstSchema(schema, "ident.routes.v1")
			return schema
		}},
		{"ident.status.v1", "Ident status", func(t *testing.T) *jsonschema.Schema {
			schema := inferIdentSchema[identStatus](t, "ident.status.v1", "Ident status")
			requireConstSchema(schema, "ident.status.v1")
			schema.Properties["observedAt"] = statusValueSchema(epochValueSchema(), []string{"stats_now", "stats_window_end", "aircraft_now", "ingest_clock"})
			schema.Properties["receiverPosition"] = statusValueSchema(positionValueSchema(), []string{"receiver_json"})
			schema.Properties["messageRate"] = statusValueSchema(messageRateValueSchema(), []string{"stats_last1min_messages_valid", "stats_last1min_messages", "aircraft_counter_delta"})
			schema.Properties["gain"] = statusValueSchema(objectSchema(map[string]*jsonschema.Schema{"db": {Type: "number"}}, []string{"db"}), []string{"top_level", "latest_local", "last1min_local", "last5min_local", "last15min_local", "total_local"})
			schema.Properties["uptime"] = statusValueSchema(objectSchema(map[string]*jsonschema.Schema{
				"sec":     {Type: "number"},
				"subject": stringEnumSchema("receiver", "ident"),
			}, []string{"sec", "subject"}), []string{"stats_now_minus_total_start", "window_end_minus_total_start", "ident_process_start"})
			schema.Properties["maxRange"] = statusValueSchema(objectSchema(map[string]*jsonschema.Schema{
				"nm":          {Type: "number"},
				"scope":       stringEnumSchema("last24h", "alltime", "points", "other", "stats"),
				"computation": stringEnumSchema("max_receiver_to_outline_vertex", "producer_reported_distance"),
			}, []string{"nm", "scope", "computation"}), []string{"outline_last24h_vertices", "outline_alltime_vertices", "outline_points_vertices", "outline_other_vertices", "stats_max_distance_meters"})
			return schema
		}},
		{"ident.diagnostics.v1", "Ident diagnostics", func(t *testing.T) *jsonschema.Schema {
			schema := inferIdentSchema[identDiagnostics](t, "ident.diagnostics.v1", "Ident diagnostics")
			requireConstSchema(schema, "ident.diagnostics.v1")
			// The envelope wrapper guarantees a non-nil slice
			// (newIdentDiagnostics replaces nil with []). Drop the "null"
			// variant the schema generator inferred from the bare slice
			// type so the wire contract matches what's actually emitted.
			schema.Properties["diagnostics"].Types = []string{"array"}
			return schema
		}},
	}
}

func identTypeSchemaOverrides() map[reflect.Type]*jsonschema.Schema {
	return map[reflect.Type]*jsonschema.Schema{
		reflect.TypeFor[identProducerKind]():   stringEnumSchema(string(producerReadsb), string(producerDump1090FA), string(producerSkyaware978), string(producerUnknown)),
		reflect.TypeFor[capabilitySource]():    stringEnumSchema(string(capabilityProducerProvided), string(capabilityIdentDerived), string(capabilityUnavailable)),
		reflect.TypeFor[identAircraftIDKind](): stringEnumSchema(string(identAircraftIDICAO), string(identAircraftIDNonICAO), string(identAircraftIDUnknown)),
		reflect.TypeFor[identAircraftSource](): stringEnumSchema(aircraftSourceStrings()...),
		reflect.TypeFor[rangeOutlineSource]():  stringEnumSchema(string(rangeOutlineSourceOutlineJSON)),
		reflect.TypeFor[rangeOutlineScope]():   stringEnumSchema(string(rangeOutlineScopeLast24h), string(rangeOutlineScopeAlltime), string(rangeOutlineScopePoints), string(rangeOutlineScopeOther)),
		reflect.TypeFor[statusValueKind]():     stringEnumSchema(string(statusValueProducerProvided), string(statusValueIdentDerived), string(statusValueUnavailable)),
		reflect.TypeFor[unavailableReason]():   stringEnumSchema(unavailableReasonStrings()...),
		reflect.TypeFor[diagnosticSeverity]():  stringEnumSchema(string(severityInfo), string(severityWarning), string(severityError)),
		reflect.TypeFor[json.RawMessage]():     anyObjectSchema(),
		reflect.TypeFor[map[string]any]():      anyObjectSchema(),
		reflect.TypeFor[map[string]float64]():  anyObjectSchema(),
	}
}

func inferIdentSchema[T any](t *testing.T, id, title string) *jsonschema.Schema {
	t.Helper()
	schema, err := jsonschema.For[T](&jsonschema.ForOptions{
		TypeSchemas: identTypeSchemaOverrides(),
	})
	if err != nil {
		t.Fatalf("infer schema: %v", err)
	}
	schema.Schema = "https://json-schema.org/draft/2020-12/schema"
	schema.ID = "https://github.com/Ident-1090/Ident/schemas/ident/" + id + ".schema.json"
	schema.Title = title
	return schema
}

func requireConstSchema(schema *jsonschema.Schema, name string) {
	schema.Properties["schema"] = constStringSchema(name)
	if !slices.Contains(schema.Required, "schema") {
		schema.Required = append([]string{"schema"}, schema.Required...)
	}
}

func marshalIdentSchema(t *testing.T, schema *jsonschema.Schema) []byte {
	t.Helper()
	body, err := json.MarshalIndent(schema, "", "  ")
	if err != nil {
		t.Fatalf("marshal schema: %v", err)
	}
	return append(body, '\n')
}

func statusValueSchema(valueSchema *jsonschema.Schema, sources []string) *jsonschema.Schema {
	return &jsonschema.Schema{
		OneOf: []*jsonschema.Schema{
			objectSchema(map[string]*jsonschema.Schema{
				"kind":   constStringSchema(string(statusValueProducerProvided)),
				"source": stringEnumSchema(sources...),
				"value":  valueSchema,
			}, []string{"kind", "source", "value"}),
			objectSchema(map[string]*jsonschema.Schema{
				"kind":   constStringSchema(string(statusValueIdentDerived)),
				"source": stringEnumSchema(sources...),
				"value":  valueSchema,
			}, []string{"kind", "source", "value"}),
			objectSchema(map[string]*jsonschema.Schema{
				"kind":   constStringSchema(string(statusValueUnavailable)),
				"reason": stringEnumSchema(unavailableReasonStrings()...),
			}, []string{"kind", "reason"}),
		},
	}
}

func objectSchema(properties map[string]*jsonschema.Schema, required []string) *jsonschema.Schema {
	return &jsonschema.Schema{
		Type:                 "object",
		Properties:           properties,
		Required:             required,
		AdditionalProperties: &jsonschema.Schema{Not: &jsonschema.Schema{}},
		PropertyOrder:        required,
	}
}

func anyObjectSchema() *jsonschema.Schema {
	return &jsonschema.Schema{Type: "object"}
}

func epochValueSchema() *jsonschema.Schema {
	return objectSchema(map[string]*jsonschema.Schema{"epochSec": {Type: "number"}}, []string{"epochSec"})
}

func positionValueSchema() *jsonschema.Schema {
	return objectSchema(map[string]*jsonschema.Schema{
		"lat": {Type: "number"},
		"lon": {Type: "number"},
	}, []string{"lat", "lon"})
}

func messageRateValueSchema() *jsonschema.Schema {
	return objectSchema(map[string]*jsonschema.Schema{
		"hz":       {Type: "number"},
		"basisSec": {Type: "number"},
	}, []string{"hz"})
}

func constStringSchema(v string) *jsonschema.Schema {
	value := any(v)
	return &jsonschema.Schema{Const: &value}
}

func stringEnumSchema(values ...string) *jsonschema.Schema {
	enum := make([]any, 0, len(values))
	for _, value := range values {
		enum = append(enum, value)
	}
	return &jsonschema.Schema{Type: "string", Enum: enum}
}

func aircraftSourceStrings() []string {
	return []string{
		string(aircraftSourceADSBICAO),
		string(aircraftSourceADSBICAONT),
		string(aircraftSourceADSRICAO),
		string(aircraftSourceTISBICAO),
		string(aircraftSourceADSBOther),
		string(aircraftSourceADSROther),
		string(aircraftSourceTISBOther),
		string(aircraftSourceTISBTrackfile),
		string(aircraftSourceModeS),
		string(aircraftSourceModeAC),
		string(aircraftSourceMLAT),
		string(aircraftSourceUnknown),
	}
}

func unavailableReasonStrings() []string {
	return []string{
		string(reasonNotProvidedByProducer),
		string(reasonAwaitingClassification),
		string(reasonAwaitingSecondSample),
		string(reasonProducerChanged),
		string(reasonCounterReset),
		string(reasonClockNotAdvanced),
		string(reasonStaleSample),
		string(reasonMalformedFile),
	}
}
