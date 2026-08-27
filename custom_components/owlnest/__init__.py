"""Owlnest — Home Assistant companion integration for 3D floorplan scenes."""
from __future__ import annotations

import logging

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant

from .frontend import async_register_card
from .storage import OwlnestStorage
from .websocket import async_setup_websocket

DOMAIN = "owlnest"
_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    storage = OwlnestStorage(hass)
    await storage.async_load()

    hass.data.setdefault(DOMAIN, {})
    hass.data[DOMAIN][entry.entry_id] = storage

    async_setup_websocket(hass, storage)

    # The card travels with the integration: see frontend.py for why.
    await async_register_card(hass)

    _LOGGER.info("Owlnest integration loaded — %d scene(s) in storage", len(storage.list_scenes()))
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    hass.data[DOMAIN].pop(entry.entry_id, None)
    return True
