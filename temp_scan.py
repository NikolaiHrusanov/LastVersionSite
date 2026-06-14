import re
from pathlib import Path
root = Path('.')
html_files = list(root.rglob('*.html'))
patterns = [re.compile(r'(?:nav|menu|dropdown|mobile-menu|footer)', re.I)]
out = []
for f in html_files:
    text = f.read_text(encoding='utf-8', errors='ignore')
    if not any(p.search(text) for p in patterns):
        continue
    for m in re.finditer(r'href=["\']([^"\']+)["\']', text):
        href = m.group(1)
        if href.startswith(('http://', 'https://', 'mailto:', 'tel:', 'javascript:', '#')):
            continue
        if not href.endswith('.html') and '/' not in href and not href.startswith('.'):
            continue
        target = (f.parent / href).resolve() if not href.startswith('/') else (root / href.lstrip('/')).resolve()
        if not target.exists():
            out.append(f'{f} -> {href}')
print('\n'.join(out[:200]))
