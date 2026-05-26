# generator
import os, sys
base = sys.argv[1]
files = {}
exec(open(os.path.join(base, '_content.py')).read())
for name, content in files.items():
    with open(os.path.join(base, name), 'w') as f:
        f.write(content)
    print(f'{name}: {len(content)} bytes')
