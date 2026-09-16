// Adapt the pinned Calipers save/run protocol to Mog's flag-based CLI.
// This executable is only used by the repository's verification/bench scripts.
package main

import (
	"fmt"
	"os"
	"os/exec"
)

func mogArgs(args []string) ([]string, error) {
	if len(args) == 0 || (args[0] != "save" && args[0] != "run") {
		return nil, fmt.Errorf("expected Calipers save or run request")
	}
	operation, args := args[0], args[1:]
	var flags []string
	if len(args) > 0 && args[0] == "--recalculate" {
		flags = append(flags, "--recalculate")
		args = args[1:]
	}
	if operation == "save" && len(args) == 2 {
		return append(flags, "--input", args[0], "--output", args[1]), nil
	}
	if operation == "run" && len(args) == 3 {
		return append(flags, "--input", args[0], "--output", args[2], "--file="+args[1]), nil
	}
	return nil, fmt.Errorf("invalid Calipers %s arguments", operation)
}

func main() {
	args, err := mogArgs(os.Args[1:])
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	binary := os.Getenv("MOG_BIN")
	if binary == "" {
		fmt.Fprintln(os.Stderr, "MOG_BIN must point to the Mog executable")
		os.Exit(1)
	}
	command := exec.Command(binary, args...)
	command.Stdin, command.Stdout, command.Stderr = os.Stdin, os.Stdout, os.Stderr
	if err := command.Run(); err != nil {
		if exit, ok := err.(*exec.ExitError); ok {
			os.Exit(exit.ExitCode())
		}
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
