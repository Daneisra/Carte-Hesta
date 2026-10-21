import re
from pathlib import Path
path = Path("js/mapController.js")
text = path.read_text(encoding="utf-8")
pattern = r"        const marker = L\.marker\(\[location\.y, location\.x\], \{\r\n            icon: this\.createCustomIcon\(location\.type\)\r\n        \}\.addTo\(this\.map\);"
match = re.search(pattern, text)
if not match:
    raise SystemExit("createEntry block not found")
replacement = "        const marker = L.marker([location.y, location.x], {\r\n            icon: this.createCustomIcon(location.type)\r\n        });\r\n\r\n        this.#addMarkerToLayer(marker);"
text = text.replace(match.group(0), replacement, 1)
path.write_text(text, encoding="utf-8")
