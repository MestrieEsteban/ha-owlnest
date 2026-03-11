"""Config flow for Owlnest — single-step, no user input required."""
from __future__ import annotations

from homeassistant import config_entries
from homeassistant.data_entry_flow import FlowResult

from . import DOMAIN


class OwlnestConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """One-click setup: just creates the entry with no configuration."""

    VERSION = 1

    async def async_step_user(self, user_input: dict | None = None) -> FlowResult:
        # Prevent duplicate entries
        await self.async_set_unique_id(DOMAIN)
        self._abort_if_unique_id_configured()

        if user_input is not None:
            return self.async_create_entry(title="Owlnest", data={})

        return self.async_show_form(step_id="user")
