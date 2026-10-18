import re

with open('src/App.tsx', 'r') as f:
    text = f.read()

# Let's inspect the JSX part from "return (" at line 2217 to the end
lines = text.split('\n')
jsx_lines = lines[2216:]
print(f"JSX lines from 2217 to {len(lines)}")

# Let's count occurrences of opening and closing JSX tags or braces
# Specifically check braces { and } in JSX
brace_stack = []
for i, line in enumerate(jsx_lines, 2217):
    # skip strings
    # let's find { and }
    in_str = None
    for j, c in enumerate(line):
        if in_str:
            if c == in_str and (j == 0 or line[j-1] != '\\'):
                in_str = None
            continue
        if c in ('"', "'", '`'):
            in_str = c
            continue
        if c == '{':
            brace_stack.append((i, j, line.strip()))
        elif c == '}':
            if not brace_stack:
                print(f"Extra '}}' at line {i}:{j}")
            else:
                brace_stack.pop()

print(f"Unclosed braces in JSX: {len(brace_stack)}")
for b in brace_stack[-10:]:
    print(f"Line {b[0]}:{b[1]} -> {b[2][:60]}")
