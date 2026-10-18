with open('src/App.tsx', 'r') as f:
    text = f.read()

# Let's find "export default function App"
app_idx = text.find('export default function App')
print("export default function App at char:", app_idx)
line_no = text[:app_idx].count('\n') + 1
print("Line:", line_no)

# Now let's trace braces from that line onwards
lines = text.split('\n')
stack = []
for i in range(line_no - 1, len(lines)):
    line = lines[i]
    # rough skip strings
    in_s = False
    in_d = False
    in_t = False
    j = 0
    while j < len(line):
        c = line[j]
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
        if c == '/' and j + 1 < len(line) and line[j+1] == '/':
            break
        if c == "'": in_s = True; j += 1; continue
        if c == '"': in_d = True; j += 1; continue
        if c == '`': in_t = True; j += 1; continue

        if c == '{':
            stack.append(('{', i + 1, j + 1))
        elif c == '}':
            if not stack:
                print(f"Extra }} at line {i+1}:{j+1}")
            else:
                stack.pop()
        elif c == '(':
            stack.append(('(', i + 1, j + 1))
        elif c == ')':
            if not stack:
                print(f"Extra ) at line {i+1}:{j+1}")
            else:
                top = stack[-1]
                if top[0] == '(':
                    stack.pop()
                else:
                    print(f"Mismatched ) at line {i+1}:{j+1}, expected matching {top[0]} from line {top[1]}")
        j += 1

print(f"Open stack size: {len(stack)}")
for item in stack:
    print(f"Unclosed {item[0]} at line {item[1]}:{item[2]} -> {lines[item[1]-1].strip()[:60]}")
