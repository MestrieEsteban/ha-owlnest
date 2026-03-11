"""Owlnest scene storage — uses HA's native Store for persistence."""
from __future__ import annotations

import logging
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

STORAGE_KEY = "owlnest.scenes"
STORAGE_VERSION = 1

_LOGGER = logging.getLogger(__name__)


class OwlnestStorage:
    """Persists Owlnest scenes using HA's built-in JSON storage."""

    def __init__(self, hass: HomeAssistant) -> None:
        self._store: Store = Store(hass, STORAGE_VERSION, STORAGE_KEY)
        self._scenes: dict[str, Any] = {}

    async def async_load(self) -> None:
        data = await self._store.async_load()
        self._scenes = data or {}

    async def _async_save(self) -> None:
        await self._store.async_save(self._scenes)

    def get_scene(self, scene_id: str) -> dict | None:
        return self._scenes.get(scene_id)

    def list_scenes(self) -> list[str]:
        return list(self._scenes.keys())

    async def async_save_scene(self, scene_id: str, data: dict) -> None:
        data["scene_id"] = scene_id
        self._scenes[scene_id] = data
        await self._async_save()
        _LOGGER.debug("Scene '%s' saved (%d anchors)", scene_id, len(data.get("anchors", [])))

    async def async_delete_scene(self, scene_id: str) -> bool:
        if scene_id not in self._scenes:
            return False
        del self._scenes[scene_id]
        await self._async_save()
        return True
