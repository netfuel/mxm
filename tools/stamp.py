"""Add content-hash version stamps (?v=...) to the asset links in public/index.html.
Browsers cache /assets/* for an hour (see _headers); a changed file gets a new stamp,
so visitors always load matching HTML, CSS and JS. Run before every push
("Push to GitHub.command" runs it automatically)."""
import hashlib, os, re
site = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
pub = os.path.join(site, 'public')
path = os.path.join(pub, 'index.html')
html = open(path, encoding='utf-8').read()

def stamp(m):
    attr, ref = m.group(1), m.group(2)
    f = os.path.join(pub, ref)
    if not os.path.isfile(f):
        return m.group(0)
    h = hashlib.sha1(open(f, 'rb').read()).hexdigest()[:10]
    return f'{attr}="{ref}?v={h}"'

new = re.sub(r'(src|href)="(assets/[^"?]+\.(?:js|css))(?:\?v=[0-9a-f]+)?"', stamp, html)
if new != html:
    open(path, 'w', encoding='utf-8').write(new)
print('\n'.join(re.findall(r'assets/[^"]+\?v=[0-9a-f]+', new)))
