"""Tests de custom_components/owlnest/models.py, sans Home Assistant installé.

Home Assistant n'est pas une dépendance de développement du dépôt : on le
remplace par des doublures minimales, juste ce que le module importe. Ce qui
est testé est la logique d'Owlnest — validation, écriture par morceaux,
publication, droits — pas le serveur HTTP de Home Assistant.

    python -m unittest discover checks
"""
import asyncio
import importlib.util
import sys
import tempfile
import types
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _stub_homeassistant():
    """Installe des modules `homeassistant` et `aiohttp` factices."""
    ha = types.ModuleType("homeassistant")
    http = types.ModuleType("homeassistant.components.http")
    comps = types.ModuleType("homeassistant.components")
    core = types.ModuleType("homeassistant.core")

    class HomeAssistantView:
        def json(self, data, status_code=200):
            return {"status": status_code, "body": data}

        def json_message(self, message, status_code=200):
            return {"status": status_code, "body": {"message": message}}

    http.HomeAssistantView = HomeAssistantView
    core.HomeAssistant = object
    aiohttp = types.ModuleType("aiohttp")
    aiohttp.web = types.SimpleNamespace(Request=object, Response=object)

    sys.modules.update({
        "homeassistant": ha,
        "homeassistant.components": comps,
        "homeassistant.components.http": http,
        "homeassistant.core": core,
        "aiohttp": aiohttp,
    })


_stub_homeassistant()
_spec = importlib.util.spec_from_file_location(
    "owlnest_models", ROOT / "custom_components" / "owlnest" / "models.py"
)
models = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(models)


class FakeHass:
    async def async_add_executor_job(self, fn, *args):
        return fn(*args)


class FakeRequest(dict):
    def __init__(self, query, body, admin=True):
        super().__init__()
        self.query = query
        self._body = body
        self.app = {"hass": FakeHass()}
        self["hass_user"] = types.SimpleNamespace(is_admin=admin)

    async def read(self):
        return self._body


GLB = b"glTF" + bytes(range(256)) * 40


def run(coro):
    return asyncio.run(coro)


class NameTest(unittest.TestCase):
    def test_simple_slug(self):
        self.assertTrue(models.valid_name("maison-2026_10"))

    def test_rejects_paths_and_extensions(self):
        # Rien qui permette de sortir du dossier ou d'écraser autre chose.
        for bad in ("../secrets", "a/b", "a\\b", "maison.glb", "", "-tiret", "A" * 65, "Maison"):
            self.assertFalse(models.valid_name(bad), bad)


class UploadTest(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())
        self.view = models.OwlnestUploadView(self.dir)

    def post(self, query, body, admin=True):
        return run(self.view.post(FakeRequest(query, body, admin)))

    def test_single_chunk_is_published(self):
        res = self.post({"name": "maison", "offset": "0", "final": "1"}, GLB)
        self.assertEqual(res["status"], 200)
        self.assertEqual(res["body"]["url"], "/owlnest_models/maison.glb")
        self.assertEqual((self.dir / "maison.glb").read_bytes(), GLB)
        self.assertFalse((self.dir / "maison.glb.part").exists(), "le fichier partiel disparaît")

    def test_chunks_are_reassembled_in_order(self):
        third = len(GLB) // 3
        pieces = [GLB[:third], GLB[third:2 * third], GLB[2 * third:]]
        offset = 0
        for i, piece in enumerate(pieces):
            q = {"name": "maison", "offset": str(offset)}
            if i == len(pieces) - 1:
                q["final"] = "1"
            res = self.post(q, piece)
            self.assertEqual(res["status"], 200)
            offset += len(piece)
        self.assertEqual((self.dir / "maison.glb").read_bytes(), GLB)

    def test_nothing_is_published_before_the_last_chunk(self):
        # Un modèle à moitié envoyé ne doit jamais être servi.
        self.post({"name": "maison", "offset": "0"}, GLB[:100])
        self.assertFalse((self.dir / "maison.glb").exists())

    def test_retried_chunk_does_not_duplicate_data(self):
        # Un morceau renvoyé après une coupure réseau réécrit sa place, il ne s'ajoute pas.
        self.post({"name": "maison", "offset": "0"}, GLB[:100])
        self.post({"name": "maison", "offset": "0"}, GLB[:100])
        self.post({"name": "maison", "offset": "100", "final": "1"}, GLB[100:])
        self.assertEqual((self.dir / "maison.glb").read_bytes(), GLB)

    def test_rejects_a_file_that_is_not_a_glb(self):
        res = self.post({"name": "maison", "offset": "0", "final": "1"}, b"PK\x03\x04 une archive")
        self.assertEqual(res["status"], 400)
        self.assertFalse(any(self.dir.iterdir()))

    def test_rejects_a_bad_name(self):
        res = self.post({"name": "../../configuration", "offset": "0", "final": "1"}, GLB)
        self.assertEqual(res["status"], 400)

    def test_rejects_a_bad_offset(self):
        for offset in ("-1", "abc"):
            self.assertEqual(self.post({"name": "maison", "offset": offset}, GLB)["status"], 400)

    def test_non_admin_cannot_write(self):
        res = self.post({"name": "maison", "offset": "0", "final": "1"}, GLB, admin=False)
        self.assertEqual(res["status"], 403)
        self.assertFalse(any(self.dir.iterdir()))

    def test_size_cap(self):
        res = self.post({"name": "maison", "offset": str(models.MAX_BYTES)}, b"x")
        self.assertEqual(res["status"], 413)


if __name__ == "__main__":
    unittest.main()
