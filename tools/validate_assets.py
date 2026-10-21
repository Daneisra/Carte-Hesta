# -*- coding: utf-8 -*-
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Dict, Iterable, List, Tuple

ROOT = Path(__file__).resolve().parents[1]
ASSETS_DIR = ROOT / "assets"
LOCATIONS_PATH = ASSETS_DIR / "locations.json"
TYPES_PATH = ASSETS_DIR / "types.json"


def load_json(path: Path) -> Any:
    if not path.exists():
        raise FileNotFoundError(f"Fichier introuvable : {path}")
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise ValueError(f"JSON invalide dans {path}: {error}") from error


def validate_types(types: Dict[str, Dict[str, Any]], *, check_media: bool) -> List[str]:
    issues: List[str] = []
    for type_name, payload in types.items():
        icon = payload.get("icon")
        zoom = payload.get("zoom")
        if not isinstance(icon, str) or not icon:
            issues.append(f"Type '{type_name}': champ 'icon' manquant ou invalide")
        elif check_media:
            icon_path = ROOT / icon
            if not icon_path.exists():
                issues.append(f"Type '{type_name}': icone introuvable ({icon})")
        if zoom is None:
            issues.append(f"Type '{type_name}': champ 'zoom' manquant")
        elif not isinstance(zoom, (int, float)):
            issues.append(f"Type '{type_name}': champ 'zoom' doit etre numerique (actuel: {zoom!r})")
        elif zoom <= 0:
            issues.append(f"Type '{type_name}': champ 'zoom' doit etre strictement positif (actuel: {zoom})")
    return issues


def normalize_media_path(path: str | None) -> Path | None:
    if not path or not isinstance(path, str):
        return None
    return (ROOT / path).resolve()


def validate_media(path: Path) -> bool:
    return path.exists() and path.is_file()


def validate_locations(dataset: Dict[str, Any], types: Dict[str, Any], *, check_media: bool) -> Tuple[List[str], List[str]]:
    issues: List[str] = []
    warnings: List[str] = []
    seen_names: Dict[str, str] = {}

    for continent, raw_locations in dataset.items():
        if not isinstance(raw_locations, list):
            issues.append(f"Continent '{continent}': structure attendue = liste")
            continue

        for index, entry in enumerate(raw_locations):
            if not isinstance(entry, dict):
                issues.append(f"{continent}[{index}]: entree non objet JSON")
                continue

            name = (entry.get("name") or "").strip()
            if not name:
                issues.append(f"{continent}[{index}]: nom manquant")
                continue
            if name in seen_names:
                issues.append(f"Doublon de nom '{name}' (deja vu dans {seen_names[name]})")
            else:
                seen_names[name] = f"{continent}[{index}]"

            loc_type = (entry.get("type") or "default").strip()
            if loc_type != "default" and loc_type not in types:
                issues.append(f"{name}: type inconnu '{loc_type}'")

            for coord_key in ("x", "y"):
                value = entry.get(coord_key)
                if not isinstance(value, (int, float)):
                    issues.append(f"{name}: coordonnee '{coord_key}' invalide ({value!r})")

            audio_path = entry.get("audio")
            if audio_path:
                if not isinstance(audio_path, str):
                    issues.append(f"{name}: champ audio doit etre une chaine")
                elif check_media:
                    resolved = normalize_media_path(audio_path)
                    if not resolved or not validate_media(resolved):
                        issues.append(f"{name}: fichier audio introuvable ({audio_path})")
            videos = entry.get("videos") or []
            if isinstance(videos, list):
                for video_index, video in enumerate(videos):
                    if isinstance(video, str):
                        if not video.strip():
                            issues.append(f"{name}: videos[{video_index}] vide")
                        continue
                    if isinstance(video, dict):
                        url = video.get('url')
                        if not isinstance(url, str) or not url.strip():
                            issues.append(f"{name}: videos[{video_index}] url manquant")
                        title = video.get('title')
                        if title is not None and not isinstance(title, str):
                            issues.append(f"{name}: videos[{video_index}] title invalide ({title!r})")
                        continue
                    issues.append(f"{name}: videos[{video_index}] invalide ({video!r})")
            elif videos:
                issues.append(f"{name}: champ videos doit etre une liste")

            if 'videoTitles' in entry:
                issues.append(f"{name}: champ legacy 'videoTitles' detecte")


            images = entry.get("images") or []
            if isinstance(images, list):
                for image in images:
                    if not isinstance(image, str):
                        issues.append(f"{name}: entree image non valide ({image!r})")
                        continue
                    if check_media:
                        resolved = normalize_media_path(image)
                        if not resolved or not validate_media(resolved):
                            issues.append(f"{name}: image introuvable ({image})")
            elif images:
                issues.append(f"{name}: champ images doit etre une liste")

            description = (entry.get("description") or "").strip()
            if not description:
                warnings.append(f"{name}: description absente ou vide.")

            tags = entry.get("tags")
            has_tags = False
            if isinstance(tags, list):
                has_tags = any(isinstance(tag, str) and tag.strip() for tag in tags)
            elif isinstance(tags, str):
                has_tags = bool(tags.strip())
            if not has_tags:
                warnings.append(f"{name}: aucun tag attribue.")

            has_media = False
            if isinstance(entry.get("images"), list):
                has_media = any(isinstance(image, str) and image.strip() for image in entry["images"])
            if isinstance(entry.get("videos"), list):
                has_media = has_media or any(
                    (isinstance(video, str) and video.strip()) or
                    (isinstance(video, dict) and isinstance(video.get("url"), str) and video["url"].strip())
                    for video in entry["videos"]
                )
            if isinstance(entry.get("audio"), str) and entry["audio"].strip():
                has_media = True
            if not has_media:
                warnings.append(f"{name}: aucun media (image, video ou audio) associe.")

            quests = entry.get("quests")
            if quests:
                if isinstance(quests, list):
                    for quest in quests:
                        if not isinstance(quest, str) or not quest.strip():
                            issues.append(f"{name}: entree de quete invalide ({quest!r})")
                elif isinstance(quests, str):
                    if not quests.strip():
                        issues.append(f"{name}: entree de quete vide")
                else:
                    issues.append(f"{name}: champ quests doit etre une liste ou une chaine")

            tags = entry.get("tags")
            if tags is not None:
                if isinstance(tags, list):
                    for tag_index, tag in enumerate(tags):
                        if not isinstance(tag, str) or not tag.strip():
                            issues.append(f"{name}: tags[{tag_index}] invalide ({tag!r})")
                elif isinstance(tags, str):
                    if not tags.strip():
                        issues.append(f"{name}: champ tags vide")
                else:
                    issues.append(f"{name}: champ tags doit etre une liste ou une chaine")

            pnjs = entry.get("pnjs") or []
            if isinstance(pnjs, list):
                for pnj_index, pnj in enumerate(pnjs):
                    if not isinstance(pnj, dict):
                        issues.append(f"{name}: pnjs[{pnj_index}] n'est pas un objet")
                        continue
                    pnj_name = (pnj.get("name") or "").strip()
                    if not pnj_name:
                        issues.append(f"{name}: PNJ #{pnj_index + 1} sans nom")
                    role = pnj.get("role")
                    if role is not None and not isinstance(role, str):
                        issues.append(f"{name}: PNJ '{pnj_name or pnj_index + 1}' role invalide ({role!r})")
                    description = pnj.get("description")
                    if description is not None and not isinstance(description, str):
                        issues.append(f"{name}: PNJ '{pnj_name or pnj_index + 1}' description invalide ({description!r})")
            elif pnjs:
                issues.append(f"{name}: champ pnjs doit etre une liste")
    return issues, warnings


def collect_media(dataset: Dict[str, Any]) -> Iterable[str]:
    for raw_locations in dataset.values():
        if not isinstance(raw_locations, list):
            continue
        for entry in raw_locations:
            if not isinstance(entry, dict):
                continue
            for image in entry.get("images") or []:
                if isinstance(image, str):
                    yield image
            audio = entry.get("audio")
            if isinstance(audio, str):
                yield audio


def collect_registered_media(types: Dict[str, Any]) -> Iterable[str]:
    for payload in types.values():
        icon = payload.get("icon")
        if isinstance(icon, str):
            yield icon


def detect_unused_media(dataset: Dict[str, Any], types: Dict[str, Any]) -> List[str]:
    declared = {Path(path).as_posix() for path in collect_media(dataset)}
    declared.update(Path(path).as_posix() for path in collect_registered_media(types))
    existing = {
        path.relative_to(ROOT).as_posix()
        for path in ASSETS_DIR.rglob("*")
        if path.is_file()
    }
    unused = sorted(existing - declared)
    return [f"Media non référencé : {path}" for path in unused if not path.endswith(".json")]


def main() -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except AttributeError:
        pass

    parser = argparse.ArgumentParser(description="Validation des ressources de la carte interactive")
    parser.add_argument("--locations", type=Path, default=LOCATIONS_PATH, help="Chemin du fichier locations.json")
    parser.add_argument("--types", type=Path, default=TYPES_PATH, help="Chemin du fichier types.json")
    parser.add_argument("--no-files", action="store_true", help="Ignore la verification de presence des fichiers medias")
    args = parser.parse_args()

    types_data = load_json(args.types)
    locations_data = load_json(args.locations)

    check_media = not args.no_files
    issues: List[str] = []
    warnings: List[str] = []
    issues.extend(validate_types(types_data, check_media=check_media))
    location_errors, location_warnings = validate_locations(locations_data, types_data, check_media=check_media)
    issues.extend(location_errors)
    warnings.extend(location_warnings)
    if check_media:
        warnings.extend(detect_unused_media(locations_data, types_data))

    if issues:
        print("\n[ERREUR] Problemes detectes :")
        for entry in issues:
            print(f" - {entry}")
    else:
        print("[OK] Aucun probleme detecte")

    if warnings:
        print("\n[AVERTISSEMENTS] Points a verifier :")
        for entry in dict.fromkeys(warnings):
            print(f" - {entry}")

    total_locations = sum(len(v) for v in locations_data.values() if isinstance(v, list))
    print(f"\nResume : {len(types_data)} types, {total_locations} lieux analyses.")
    if issues and check_media:
        missing_files = [msg for msg in issues if "introuvable" in msg]
        if missing_files:
            print(f"- {len(missing_files)} fichiers medias manquants")
    return 1 if issues else 0


if __name__ == "__main__":
    raise SystemExit(main())
