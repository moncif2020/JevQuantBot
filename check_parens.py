with open('src/App.tsx', 'r', encoding='utf-8') as f:
    lines = f.readlines()

stack = []
for i, line in enumerate(lines):
    # remove strings and comments roughly
    s = line
    # handle strings roughly
    clean = []
    in_s = False
    in_d = False
    in_t = False
    j = 0
    while j < len(s):
        c = s[j]
        if in_s:
            if c == '\\': j += 2; continue
            if c == "'": in_s = False
            j += 1
            continue
        if in_d:
            if c == '\\': j += 2; continue
            if c == '"': in_d = False
            j += 1
            continue
        if in_t:
            if c == '\\': j += 2; continue
            if c == '`': in_t = False
            j += 1
            continue
        if c == '/' and j + 1 < len(s) and s[j+1] == '/':
            break
        if c == "'": in_s = True; j += 1; continue
        if c == '"': in_d = True; j += 1; continue
        if c == '`': in_t = True; j += 1; continue
        clean.append(c)
        j += 1

    clean_str = "".join(clean)
    for c in clean_str:
        if c in '({[':
            stack.append((c, i + 1))
        elif c in ')}]':
            expected = '(' if c == ')' else '{' if c == '}' else '['
            if not stack:
                print(f"Unmatched {c} at line {i+1}")
            else:
                last_c, last_line = stack[-1]
                if last_c == expected:
                    stack.pop()
                else:
                    # Let's inspect mismatch
                    pass

print(f"Remaining stack size: {len(stack)}")
for char, line_no in stack[-15:]:
    print(f"Unclosed '{char}' from line {line_no}: {lines[line_no-1].strip()[:70]}")
