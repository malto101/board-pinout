#!/usr/bin/env python3
"""Validate the core metadata embedded in built distributions."""

from __future__ import annotations

import argparse
import re
import sys
import tarfile
import zipfile
from email.parser import Parser
from pathlib import Path

_PROJECT_NAME = "board-pinout"
_FILENAME_NAME = "board_pinout"
_SUPPORTED_METADATA_VERSIONS = frozenset(
    {"1.0", "1.1", "1.2", "2.0", "2.1", "2.2", "2.3"}
)
_VERSION_RE = re.compile(r'^__version__ = "([^"]+)"$', re.MULTILINE)


def _expected_version(value: str | None) -> str:
    if value:
        return value
    source = Path("src/board_pinout/_version.py")
    match = _VERSION_RE.search(source.read_text(encoding="utf-8"))
    if not match:
        raise ValueError(f"could not read package version from {source}")
    return match.group(1)


def _check_metadata(raw: bytes, archive: Path, member: str, expected: str) -> None:
    metadata = Parser().parsestr(raw.decode("utf-8"))
    actual_name = metadata.get("Name")
    actual_version = metadata.get("Version")
    metadata_version = metadata.get("Metadata-Version")
    if metadata_version not in _SUPPORTED_METADATA_VERSIONS:
        raise ValueError(
            f"{archive}: {member} has unsupported Metadata-Version "
            f"{metadata_version!r}; expected one of "
            f"{sorted(_SUPPORTED_METADATA_VERSIONS)!r}"
        )
    if actual_name != _PROJECT_NAME:
        raise ValueError(f"{archive}: {member} has Name {actual_name!r}")
    if actual_version != expected:
        raise ValueError(
            f"{archive}: {member} has Version {actual_version!r}; expected {expected!r}"
        )


def _one(matches: list[str], archive: Path, label: str) -> str:
    if len(matches) != 1:
        raise ValueError(f"{archive}: expected one {label}, found {matches!r}")
    return matches[0]


def check_distribution(path: Path, expected: str) -> None:
    if path.suffix == ".whl":
        with zipfile.ZipFile(path) as archive:
            member = _one(
                [
                    name
                    for name in archive.namelist()
                    if name.endswith(".dist-info/METADATA")
                ],
                path,
                "wheel METADATA member",
            )
            _check_metadata(archive.read(member), path, member, expected)
        if not path.name.startswith(f"{_FILENAME_NAME}-{expected}-"):
            raise ValueError(f"{path}: filename does not match {_PROJECT_NAME} {expected}")
        return

    if path.name.endswith(".tar.gz"):
        with tarfile.open(path, "r:gz") as archive:
            member = _one(
                [
                    name
                    for name in archive.getnames()
                    if name.endswith("/PKG-INFO") or name == "PKG-INFO"
                ],
                path,
                "sdist PKG-INFO member",
            )
            extracted = archive.extractfile(member)
            if extracted is None:
                raise ValueError(f"{path}: could not read {member}")
            _check_metadata(extracted.read(), path, member, expected)
        if not path.name.startswith(f"{_FILENAME_NAME}-{expected}."):
            raise ValueError(f"{path}: filename does not match {_PROJECT_NAME} {expected}")
        return

    raise ValueError(f"unsupported distribution: {path}")


def _distributions(directory: Path) -> list[Path]:
    if not directory.is_dir():
        raise ValueError(f"distribution directory does not exist: {directory}")

    entries = sorted(directory.iterdir(), key=lambda path: path.name)
    unexpected = [
        path
        for path in entries
        if not path.is_file()
        or path.is_symlink()
        or not (path.name.endswith(".whl") or path.name.endswith(".tar.gz"))
    ]
    if unexpected:
        raise ValueError(f"unexpected entries in {directory}: {unexpected}")

    wheels = [path for path in entries if path.name.endswith(".whl")]
    sdists = [path for path in entries if path.name.endswith(".tar.gz")]
    if len(wheels) != 1 or len(sdists) != 1:
        raise ValueError(
            f"expected exactly one wheel and one sdist in {directory}; "
            f"found wheels={wheels!r}, sdists={sdists!r}"
        )
    return [*wheels, *sdists]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    parser.add_argument("--expected-version")
    args = parser.parse_args()

    expected = _expected_version(args.expected_version)
    distributions = _distributions(args.directory)
    for distribution in distributions:
        check_distribution(distribution, expected)
    print(f"validated {len(distributions)} distributions for {_PROJECT_NAME} {expected}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, UnicodeDecodeError, ValueError, zipfile.BadZipFile, tarfile.TarError) as exc:
        print(f"distribution metadata check failed: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc
