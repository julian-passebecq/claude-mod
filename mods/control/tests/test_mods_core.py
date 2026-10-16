"""« Mods chargés » (control, Python) against lib/core/mods.mjs (the JS reader every other mod uses), on an invented
folder: same plugin dirs split, same mods found with the same names and versions, same loaded / missing verdicts.
python -I -m unittest discover -s mods/control/tests -p "test_*.py"   (needs node on PATH; skipped without it)"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
MOD = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(MOD, 'scanner'))
import control_scan as cs  # noqa: E402

CORE = os.path.join(MOD, 'lib', 'core', 'mods.mjs')
NODE = shutil.which('node')

SCRIPT = r"""
import { pathToFileURL } from 'node:url'
const [core, root, dirs] = process.argv.slice(2)
const m = await import(pathToFileURL(core).href)
const found = m.listMods(root)
console.log(JSON.stringify({
  split: m.splitDirs(dirs),
  mods: m.loadedState(found, dirs).map(x => ({ name: x.name, version: x.version, loaded: x.loaded })),
  missing: m.missingDirs(dirs, found),
}))
"""


@unittest.skipUnless(NODE, 'node not on PATH')
class SameAsCore(unittest.TestCase):
    def test_same_mods_and_verdicts_as_lib_core_mods(self):
        tmp = tempfile.mkdtemp()
        try:
            home = os.path.join(tmp, 'home')
            os.makedirs(home)
            root = os.path.join(tmp, 'repo', 'mods')
            for name, version in (('alpha', '0.2.0'), ('beta', '1.0.0'), ('gamma', '')):
                d = os.path.join(root, name, '.claude-plugin')
                os.makedirs(d)
                with open(os.path.join(d, 'plugin.json'), 'w', encoding='utf8') as f:
                    json.dump({'name': name, **({'version': version} if version else {})}, f)
            os.makedirs(os.path.join(root, 'not-a-mod'))
            gone = os.path.join(tmp, 'gone').replace(os.sep, '/')
            dirs = os.pathsep.join([os.path.join(root, 'alpha'), os.path.join(root, 'beta'), gone])
            cfg = json.loads(json.dumps(cs.load_config(user_override=False)))
            cfg['mods']['extra_roots'] = [root]
            cfg['mods']['show_dev_mods'] = False
            py = cs.mod_states(cfg, home, {}, environ={'CLAUDE_CODE_PLUGIN_DIRS': dirs})
            script = os.path.join(tmp, 'core.mjs')
            with open(script, 'w', encoding='utf8') as f:
                f.write(SCRIPT)
            out = subprocess.run([NODE, script, CORE, root, dirs], capture_output=True, text=True, check=True)
            js = json.loads(out.stdout)

            norm = lambda p: p.replace('\\', '/').rstrip('/').lower()  # noqa: E731
            self.assertEqual([norm(x) for x in cs.plugin_dirs(dirs)], [norm(x) for x in js['split']])
            py_found = {m['name']: m for m in py['items'] if m['state'] != 'missing'}
            self.assertEqual(sorted(py_found), sorted(m['name'] for m in js['mods']))
            for m in js['mods']:
                self.assertEqual(py_found[m['name']]['version'], m['version'], m['name'])
                self.assertEqual(py_found[m['name']]['state'] == 'loaded', m['loaded'], m['name'])
            self.assertEqual(sorted(norm(m['path']) for m in py['items'] if m['state'] == 'missing'),
                             sorted(norm(x) for x in js['missing']))
        finally:
            shutil.rmtree(tmp, ignore_errors=True)


if __name__ == '__main__':
    unittest.main()
