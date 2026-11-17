"""Receive and serve the 3D models imported from the card.

The user drops an export on the card; the card converts it to GLB in the
browser and sends it here. Nobody has to copy a file into ``config/www``.

Two traps this module sidesteps, both met in real installs:

- ``/local`` only serves ``config/www`` if that folder existed when Home
  Assistant started. Models live in a folder this integration creates itself,
  at setup, and serves under its own path.
- Home Assistant serves its 404s with a month-long cache. Every import gets a
  new file name and the path is served without cache headers, so a new model
  never collides with a stale answer for an old one.
"""
from __future__ import annotations

import logging
import os
import re
import shutil
from datetime import datetime
from pathlib import Path

from aiohttp import web
from homeassistant.components.http import HomeAssistantView
from homeassistant.core import HomeAssistant

_LOGGER = logging.getLogger(__name__)

DOMAIN = "owlnest"
URL_BASE = f"/{DOMAIN}_models"
UPLOAD_URL = f"/api/{DOMAIN}/upload"
_REGISTERED = f"{DOMAIN}_models_registered"

# Plenty for a furnished flat with its textures (a real one is about 26 MB),
# small enough that a stray upload cannot fill the disk.
MAX_BYTES = 300 * 1024 * 1024

_NAME = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")
_GLB_MAGIC = b"glTF"


def models_dir(hass: HomeAssistant) -> Path:
    return Path(hass.config.path(DOMAIN, "models"))


def valid_name(name: str) -> bool:
    """A bare slug: no path, no extension, nothing to escape the folder with."""
    return bool(_NAME.fullmatch(name or ""))


def name_from_url(url: str) -> str | None:
    """The slug behind ``/owlnest_models/<slug>.glb``, or None for any other URL.

    Strict on purpose: the result names a file we may copy or delete.
    """
    path = re.split(r"[?#]", url or "", maxsplit=1)[0]
    prefix, suffix = f"{URL_BASE}/", ".glb"
    if not path.startswith(prefix) or not path.endswith(suffix):
        return None
    name = path[len(prefix):-len(suffix)]
    return name if valid_name(name) else None


def is_local_url(url: str) -> bool:
    """A file in ``config/www``: the user's own, never copied, moved or deleted."""
    return (url or "").startswith("/local/")


def backup_name(name: str, now: datetime) -> str:
    """``<name>-orig-<stamp>``, the name cut short so the result stays a valid slug."""
    suffix = f"-orig-{now.strftime('%Y%m%d%H%M%S')}"
    return name[: 64 - len(suffix)] + suffix


def list_models(folder: Path) -> list[dict]:
    """Published models in the folder, newest first; uploads in progress are skipped."""
    models = []
    for path in folder.glob("*.glb"):
        if not path.is_file() or not valid_name(path.stem):
            continue
        st = path.stat()
        models.append(
            {
                "name": path.stem,
                "url": f"{URL_BASE}/{path.name}",
                "size": st.st_size,
                "modified": st.st_mtime,
            }
        )
    models.sort(key=lambda m: m["modified"], reverse=True)
    return models


def copy_model(folder: Path, name: str, dest_name: str) -> int:
    """Copy a model under a new name; never overwrites, never exposes a partial file."""
    if not valid_name(name) or not valid_name(dest_name):
        raise ValueError("Invalid model name")
    src = folder / f"{name}.glb"
    dest = folder / f"{dest_name}.glb"
    if not src.is_file():
        raise FileNotFoundError(src)
    if dest.exists():
        raise FileExistsError(dest)
    part = folder / f"{dest_name}.glb.part"
    try:
        shutil.copyfile(src, part)
        os.replace(part, dest)
    except BaseException:
        part.unlink(missing_ok=True)
        raise
    return dest.stat().st_size


def delete_model(folder: Path, name: str) -> bool:
    if not valid_name(name):
        raise ValueError("Invalid model name")
    try:
        (folder / f"{name}.glb").unlink()
    except FileNotFoundError:
        return False
    return True


def _write_chunk(part: Path, offset: int, data: bytes) -> int:
    """Write one chunk at its offset; return the new file size."""
    mode = "r+b" if part.exists() else "wb"
    with open(part, mode) as f:
        f.seek(offset)
        f.write(data)
        f.truncate()
        return f.tell()


def _publish(part: Path, final: Path) -> None:
    os.replace(part, final)


class OwlnestUploadView(HomeAssistantView):
    """Chunked upload of a GLB.

    Home Assistant caps a request body at a few megabytes, and a model is
    tens of them, so the card sends it in pieces: ``?name=…&offset=…`` for each
    one, and ``&final=1`` on the last, which publishes the file.
    """

    url = UPLOAD_URL
    name = "api:owlnest:upload"
    requires_auth = True

    def __init__(self, folder: Path) -> None:
        self._folder = folder

    async def post(self, request: web.Request) -> web.Response:
        hass: HomeAssistant = request.app["hass"]
        user = request.get("hass_user")
        # Writing files on the server is an administrator's decision.
        if user is None or not user.is_admin:
            return self.json_message("Administrator rights are required", 403)

        name = request.query.get("name", "")
        if not valid_name(name):
            return self.json_message("Invalid model name", 400)
        try:
            offset = int(request.query.get("offset", "0"))
        except ValueError:
            return self.json_message("Invalid offset", 400)
        if offset < 0:
            return self.json_message("Invalid offset", 400)

        data = await request.read()
        if offset == 0 and not data.startswith(_GLB_MAGIC):
            return self.json_message("Not a GLB file", 400)
        if offset + len(data) > MAX_BYTES:
            return self.json_message("Model too large", 413)

        final = self._folder / f"{name}.glb"
        # A scene may point at the existing file: an upload never replaces it.
        if offset == 0 and await hass.async_add_executor_job(final.exists):
            return self.json_message("Model already exists", 409)

        part = self._folder / f"{name}.glb.part"
        size = await hass.async_add_executor_job(_write_chunk, part, offset, data)

        if request.query.get("final") != "1":
            return self.json({"received": size})

        await hass.async_add_executor_job(_publish, part, final)
        _LOGGER.info("Owlnest: model %s imported (%.1f MB)", final.name, size / 1048576)
        return self.json({"url": f"{URL_BASE}/{final.name}", "size": size})


async def async_setup_models(hass: HomeAssistant) -> None:
    """Create the models folder, serve it, and accept uploads."""
    if hass.data.get(_REGISTERED):
        return

    folder = models_dir(hass)
    await hass.async_add_executor_job(lambda: folder.mkdir(parents=True, exist_ok=True))

    try:
        from homeassistant.components.http import StaticPathConfig

        await hass.http.async_register_static_paths(
            [StaticPathConfig(URL_BASE, str(folder), cache_headers=False)]
        )
    except ImportError:
        hass.http.register_static_path(URL_BASE, str(folder), cache_headers=False)

    hass.http.register_view(OwlnestUploadView(folder))
    hass.data[_REGISTERED] = True
    _LOGGER.debug("Owlnest models served from %s (%s)", URL_BASE, folder)
