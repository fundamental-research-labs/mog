package main

import (
	"reflect"
	"testing"
)

func TestMogArgs(t *testing.T) {
	for _, test := range []struct{ input, want []string }{
		{[]string{"save", "a b.xlsx", "out.xlsx"}, []string{"--input", "a b.xlsx", "--output", "out.xlsx"}},
		{[]string{"save", "--recalculate", "in.xlsx", "out.xlsx"}, []string{"--recalculate", "--input", "in.xlsx", "--output", "out.xlsx"}},
		{[]string{"run", "in.xlsx", "-script.js", "out.xlsx"}, []string{"--input", "in.xlsx", "--output", "out.xlsx", "--file=-script.js"}},
		{[]string{"run", "--recalculate", "in.xlsx", "script.js", "out.xlsx"}, []string{"--recalculate", "--input", "in.xlsx", "--output", "out.xlsx", "--file=script.js"}},
	} {
		got, err := mogArgs(test.input)
		if err != nil || !reflect.DeepEqual(got, test.want) {
			t.Fatalf("%v: got %v, %v; want %v", test.input, got, err, test.want)
		}
	}
	for _, args := range [][]string{nil, {"other"}, {"save", "in.xlsx"}, {"run", "in.xlsx", "out.xlsx"}, {"save", "a", "b", "extra"}} {
		if _, err := mogArgs(args); err == nil {
			t.Fatalf("accepted %v", args)
		}
	}
}
