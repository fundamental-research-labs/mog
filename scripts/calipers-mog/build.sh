#!/usr/bin/env bash
# Sourced by the repository runners after choosing mog_bin and root.
# A native adapter also works with Go's exec.Command on Windows.
export MOG_BIN="${mog_bin}"
mkdir -p "${root}/target-native"
calipers_mog="${root}/target-native/calipers-mog$(go env GOEXE)"
go build -o "${calipers_mog}" "${root}/scripts/calipers-mog/main.go"
