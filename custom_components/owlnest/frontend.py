"""Serve and register the Lovelace card from the integration itself.

Owlnest ships two things: a Home Assistant integration and a Lovelace card.
HACS only ever installs one category per repository, so whichever the user
picked, the other half was missing — the card would then fail with
``Custom element doesn't exist: ha-3d-floorplan``.

Serving the bundle from the integration removes the choice entirely: install
the integration and the card comes with it, always at a matching version.
"""
from __future__ import annotations

import logging
from pathlib import Path

from homeassistant.components.frontend import add_extra_js_url
from homeassistant.core import HomeAssistant
from homeassistant.loader import async_get_integration

_LOGGER = logging.getLogger(__name__)

DOMAIN = "owlnest"
CARD_FILENAME = "ha-3d-floorplan.js"
URL_BASE = f"/{DOMAIN}_frontend"
_REGISTERED = f"{DOMAIN}_frontend_registered"


async def async_register_card(hass: HomeAssistant) -> None:
    """Expose the bundle over HTTP and load it on every dashboard.

    Registering twice raises in Home Assistant, and there is one call per config
    entry, so the work is guarded by a flag.
    """
    if hass.data.get(_REGISTERED):
        return

    path = Path(__file__).parent / "frontend" / CARD_FILENAME
    if not path.is_file():
        _LOGGER.error(
            "Owlnest: %s is missing from the integration folder. The card cannot "
            "be served; add it as a Lovelace resource manually.",
            CARD_FILENAME,
        )
        return

    try:
        # Home Assistant 2024.7 replaced the blocking helper with an async one.
        from homeassistant.components.http import StaticPathConfig

        await hass.http.async_register_static_paths(
            [StaticPathConfig(URL_BASE, str(path.parent), cache_headers=False)]
        )
    except ImportError:
        hass.http.register_static_path(URL_BASE, str(path.parent), cache_headers=False)

    # The version query busts the browser cache when the integration updates —
    # without it a stale bundle survives an upgrade, which is a whole class of
    # bug reports on its own.
    #
    # It comes from the manifest, not from the config entry: `entry.version` is
    # the config schema version and would sit at 1 forever.
    integration = await async_get_integration(hass, DOMAIN)
    add_extra_js_url(hass, f"{URL_BASE}/{CARD_FILENAME}?v={integration.version}")

    hass.data[_REGISTERED] = True
    _LOGGER.debug(
        "Owlnest card served from %s/%s (v%s)", URL_BASE, CARD_FILENAME, integration.version
    )
