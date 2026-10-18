import subprocess

with open('src/App.tsx', 'r') as f:
    lines = f.readlines()

print(f"Total lines: {len(lines)}")

# Let's use binary search to find which line breaks esbuild!
def test_prefix(n):
    # create a dummy closing for whatever is open
    # We can test by writing lines[:n] + some closing
    pass

# Or even simpler, let's look at lines around 2000-3500
# Let's count backticks
backticks = []
for i, line in enumerate(lines):
    for j, c in enumerate(line):
        if c == '`':
            backticks.append((i+1, j+1))

print(f"Backticks count: {len(backticks)}")
if len(backticks) % 2 != 0:
    print("ODD number of backticks!")
    for b in backticks:
        print(b, lines[b[0]-1].strip()[:60])
