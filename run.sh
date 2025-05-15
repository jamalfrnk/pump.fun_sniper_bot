#!/bin/bash

# Check for cargo lock files and try to clean them
find . -name "*.cargo-lock" -delete 2>/dev/null
find ~/.cargo -name "*.cargo-lock" -delete 2>/dev/null

# Make sure cargo is available
command -v cargo >/dev/null 2>&1 || { 
    echo "Cargo not found. Please install Rust."; 
    exit 1; 
}

# Build the project with verbose output to see what's happening
echo "Building project..."
cargo clean && RUSTFLAGS="-C target-cpu=native" cargo build -v

# Run the project if the build was successful
if [ $? -eq 0 ]; then
    echo "Build successful! Running the bot..."
    cargo run
else
    echo "Build failed. See errors above."
fi