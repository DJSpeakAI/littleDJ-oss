#!/bin/sh
# task381：selftest 统一入口薄壳（实现与设计说明见 run-selftests.js）
# 用法：sh deploy/run-selftests.sh [--filter 模式串] [--timeout 秒]
exec node "$(dirname "$0")/run-selftests.js" "$@"
