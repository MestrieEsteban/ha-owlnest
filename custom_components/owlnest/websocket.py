"""Owlnest WebSocket API — commands for scene load/save/list."""
from __future__ import annotations

import logging

import voluptuous as vol

_LOGGER = logging.getLogger(__name__)

from homeassistant.components.websocket_api import (
    ActiveConnection,
    async_register_command,
    async_response,
    websocket_command,
)
from homeassistant.core import HomeAssistant
from homeassistant.util import dt as dt_util

from .models import (
    URL_BASE,
    backup_name,
    copy_model,
    delete_model,
    is_local_url,
    list_models,
    models_dir,
    name_from_url,
)
from .storage import OwlnestStorage

_MODEL_KEYS = ("model_url", "model_original_url")


def _urls_in_use(storage: OwlnestStorage) -> set[str]:
    """Model URLs any stored scene still points at (top level or in its settings)."""
    urls: set[str] = set()
    for scene_id in storage.list_scenes():
        scene = storage.get_scene(scene_id) or {}
        for holder in (scene, scene.get("settings")):
            if not isinstance(holder, dict):
                continue
            for key in _MODEL_KEYS:
                value = holder.get(key)
                if isinstance(value, str) and value:
                    urls.add(value)
    return urls


def _same_model(url: str, used: set[str]) -> bool:
    """Whether ``url`` names a model in ``used``, ignoring any ``?query`` on either side."""
    name = name_from_url(url)
    return url in used or (name is not None and any(name_from_url(u) == name for u in used))


def async_setup_websocket(hass: HomeAssistant, storage: OwlnestStorage) -> None:
    """Register all Owlnest WebSocket commands."""

    def _get_storage() -> OwlnestStorage | None:
        bucket = hass.data.get("owlnest", {})
        return next(iter(bucket.values()), None)

    @websocket_command({vol.Required("type"): "owlnest/list_scenes"})
    @async_response
    async def handle_list_scenes(hass: HomeAssistant, connection: ActiveConnection, msg: dict) -> None:
        try:
            s = _get_storage()
            if s is None:
                connection.send_error(msg["id"], "not_ready", "Storage not initialized"); return
            connection.send_result(msg["id"], {"scenes": s.list_scenes()})
        except Exception as exc:
            _LOGGER.exception("list_scenes failed")
            connection.send_error(msg["id"], "list_failed", str(exc))

    @websocket_command({vol.Required("type"): "owlnest/load_scene", vol.Required("scene_id"): str})
    @async_response
    async def handle_load_scene(hass: HomeAssistant, connection: ActiveConnection, msg: dict) -> None:
        try:
            s = _get_storage()
            if s is None:
                connection.send_error(msg["id"], "not_ready", "Storage not initialized"); return
            scene = s.get_scene(msg["scene_id"])
            if scene is None:
                connection.send_error(msg["id"], "not_found", f"Scene '{msg['scene_id']}' not found"); return
            connection.send_result(msg["id"], scene)
        except Exception as exc:
            _LOGGER.exception("load_scene failed")
            connection.send_error(msg["id"], "load_failed", str(exc))

    @websocket_command({vol.Required("type"): "owlnest/save_scene", vol.Required("scene_id"): str, vol.Required("data"): dict})
    @async_response
    async def handle_save_scene(hass: HomeAssistant, connection: ActiveConnection, msg: dict) -> None:
        try:
            s = _get_storage()
            if s is None:
                connection.send_error(msg["id"], "not_ready", "Storage not initialized"); return
            await s.async_save_scene(msg["scene_id"], msg["data"])
            connection.send_result(msg["id"], {"success": True})
        except Exception as exc:
            _LOGGER.exception("save_scene failed for '%s'", msg.get("scene_id"))
            connection.send_error(msg["id"], "save_failed", str(exc))

    @websocket_command({vol.Required("type"): "owlnest/delete_scene", vol.Required("scene_id"): str})
    @async_response
    async def handle_delete_scene(hass: HomeAssistant, connection: ActiveConnection, msg: dict) -> None:
        try:
            s = _get_storage()
            if s is None:
                connection.send_error(msg["id"], "not_ready", "Storage not initialized"); return
            deleted = await s.async_delete_scene(msg["scene_id"])
            connection.send_result(msg["id"], {"success": deleted})
        except Exception as exc:
            _LOGGER.exception("delete_scene failed")
            connection.send_error(msg["id"], "delete_failed", str(exc))

    @websocket_command({vol.Required("type"): "owlnest/list_models"})
    @async_response
    async def handle_list_models(hass: HomeAssistant, connection: ActiveConnection, msg: dict) -> None:
        try:
            s = _get_storage()
            if s is None:
                connection.send_error(msg["id"], "not_ready", "Storage not initialized"); return
            models = await hass.async_add_executor_job(list_models, models_dir(hass))
            connection.send_result(msg["id"], {"models": models, "in_use": sorted(_urls_in_use(s))})
        except Exception as exc:
            _LOGGER.exception("list_models failed")
            connection.send_error(msg["id"], "list_failed", str(exc))

    @websocket_command({vol.Required("type"): "owlnest/backup_model", vol.Required("url"): str})
    @async_response
    async def handle_backup_model(hass: HomeAssistant, connection: ActiveConnection, msg: dict) -> None:
        try:
            if not connection.user.is_admin:
                connection.send_error(msg["id"], "unauthorized", "Administrator rights are required"); return
            url = msg["url"]
            # The original under /local stays where the user put it; the card only records its URL.
            if is_local_url(url):
                connection.send_result(msg["id"], {"url": url, "copied": False}); return
            name = name_from_url(url)
            if name is None:
                connection.send_error(msg["id"], "invalid_url", f"Not an Owlnest model URL: {url}"); return
            dest = backup_name(name, dt_util.now())
            try:
                size = await hass.async_add_executor_job(copy_model, models_dir(hass), name, dest)
            except FileNotFoundError:
                connection.send_error(msg["id"], "not_found", f"Model '{name}' not found"); return
            connection.send_result(msg["id"], {"url": f"{URL_BASE}/{dest}.glb", "copied": True, "size": size})
        except Exception as exc:
            _LOGGER.exception("backup_model failed")
            connection.send_error(msg["id"], "backup_failed", str(exc))

    @websocket_command({vol.Required("type"): "owlnest/delete_model", vol.Required("url"): str})
    @async_response
    async def handle_delete_model(hass: HomeAssistant, connection: ActiveConnection, msg: dict) -> None:
        try:
            if not connection.user.is_admin:
                connection.send_error(msg["id"], "unauthorized", "Administrator rights are required"); return
            s = _get_storage()
            if s is None:
                connection.send_error(msg["id"], "not_ready", "Storage not initialized"); return
            url = msg["url"]
            name = name_from_url(url)
            if name is None:
                connection.send_error(msg["id"], "invalid_url", f"Not an Owlnest model URL: {url}"); return
            if _same_model(url, _urls_in_use(s)):
                connection.send_error(msg["id"], "in_use", "A scene still uses this model"); return
            deleted = await hass.async_add_executor_job(delete_model, models_dir(hass), name)
            connection.send_result(msg["id"], {"deleted": deleted})
        except Exception as exc:
            _LOGGER.exception("delete_model failed")
            connection.send_error(msg["id"], "delete_failed", str(exc))

    for handler in (
        handle_list_scenes, handle_load_scene, handle_save_scene, handle_delete_scene,
        handle_list_models, handle_backup_model, handle_delete_model,
    ):
        try:
            async_register_command(hass, handler)
        except ValueError:
            _LOGGER.debug("WebSocket command '%s' already registered — skipping", handler.__name__)
