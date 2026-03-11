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

from .storage import OwlnestStorage


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

    for handler in (handle_list_scenes, handle_load_scene, handle_save_scene, handle_delete_scene):
        try:
            async_register_command(hass, handler)
        except ValueError:
            _LOGGER.debug("WebSocket command '%s' already registered — skipping", handler.__name__)
