from pathlib import Path
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'reference' / 'V19-authoritative.html'
soup = BeautifulSoup(SOURCE.read_text(encoding='utf-8'), 'html.parser')

styles = [tag.get_text() for tag in soup.find_all('style')]
(ROOT / 'src/styles/v19.css').write_text(
    '\n\n/* ---- style block boundary ---- */\n\n'.join(styles),
    encoding='utf-8',
)

scripts = []
for tag in soup.find_all('script'):
    scripts.append(tag.get('src') or (tag.string or tag.get_text()))

body = soup.body
for tag in body.find_all(['script', 'style']):
    tag.decompose()
markup = ''.join(str(node) for node in body.contents)
(ROOT / 'src/runtime/v19Markup.ts').write_text(
    'export const V19_MARKUP = ' + repr(markup) + ';\n', encoding='utf-8'
)

manifest = []
for index, value in enumerate(scripts):
    if value.startswith(('http://', 'https://', '/')) and '\n' not in value:
        manifest.append(value)
        continue
    path = ROOT / f'public/runtime/v19-{index}.js'
    path.write_text(value, encoding='utf-8')
    manifest.append(f'/runtime/v19-{index}.js')
(ROOT / 'src/runtime/scriptManifest.ts').write_text(
    'export const V19_SCRIPTS = ' + repr(manifest) + ' as const;\n', encoding='utf-8'
)
print(f'Extracted {len(styles)} style blocks, {len(scripts)} script blocks, {len(markup)} body characters.')
