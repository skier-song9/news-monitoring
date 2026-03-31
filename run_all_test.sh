#!/bin/bash
set -e

for file in tests/*.cjs
do
    echo "=============================="
    echo "Running test: $(basename "$file")"
    echo "=============================="

    node "$file" || echo "❌ Failed: $file"
done

echo "✅ All tests finished"
