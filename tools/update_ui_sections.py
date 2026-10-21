from pathlib import Path

def find_block(lines, start_pattern, end_pattern):
    start = None
    for idx, line in enumerate(lines):
        if start is None and line.strip().startswith(start_pattern):
            start = idx
        elif start is not None and line.strip().startswith(end_pattern):
            return start, idx
    raise SystemExit(f"Block starting with {start_pattern!r} not found")

path = Path('js/uiController.js')
lines = path.read_text(encoding='utf-8').splitlines()

# Replace createContinentBlock
start, end = find_block(lines, 'createContinentBlock(', 'createLocationEntry(')
new_block = [
    "    createContinentBlock(continentName, locations) {",
    "        const wrapper = document.createElement('div');",
    "        wrapper.className = 'continent';",
    "        wrapper.dataset.continent = continentName;",
    "",
    "        const toggleButton = document.createElement('button');",
    "        toggleButton.className = 'continent-toggle';",
    "        toggleButton.innerHTML = `${continentName} <span class=\"location-count\">(${locations.length})</span>`;",
    "",
    "        const content = document.createElement('div');",
    "        content.className = 'continent-content';",
    "        content.style.display = 'none';",
    "",
    "        const continentInfo = {",
    "            name: continentName,",
    "            wrapper,",
    "            toggleButton,",
    "            content,",
    "            isOpen: false,",
    "            entries: [],",
    "            pagination: {",
    "                currentPage: this.preferences ? this.preferences.getPagination(continentName) : 0,",
    "                totalPages: 1",
    "            },",
    "            paginationControls: null",
    "        };",
    "",
    "        toggleButton.addEventListener('click', () => {",
    "            continentInfo.isOpen = !continentInfo.isOpen;",
    "            content.style.display = continentInfo.isOpen ? 'block' : 'none';",
    "        });",
    "",
    "        locations.forEach(location => {",
    "            const entry = this.createLocationEntry(location, continentInfo);",
    "            content.appendChild(entry.element);",
    "            this.entries.push(entry);",
    "        });",
    "",
    "        continentInfo.paginationControls = this.createPaginationControls(continentInfo);",
    "        if (continentInfo.paginationControls) {",
    "            continentInfo.paginationControls.container.style.display = 'none';",
    "            content.appendChild(continentInfo.paginationControls.container);",
    "        }",
    "",
    "        wrapper.appendChild(toggleButton);",
    "        wrapper.appendChild(content);",
    "        return continentInfo;",
    "    }",
    ""
]
lines = lines[:start] + new_block + lines[end:]

path.write_text('\n'.join(lines) + '\n', encoding='utf-8')
