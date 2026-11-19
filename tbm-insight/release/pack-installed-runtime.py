import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sys
import zipfile

root=Path(sys.argv[1]).resolve()
target=Path(sys.argv[2])
for entry in ('apps/cli/lib/bin.js',
              'tbm-insight/.runtime/node/node.exe',
              'tbm-insight/.runtime/python/python.exe'):
    if not (root/entry).is_file():
        raise SystemExit(f'Missing Windows release input: {entry}')

product_dependencies=(
    '@tbm-insight/session',
    '@tbm-insight/llm',
    '@tbm-insight/tools',
    '@tbm-insight/skill-filesystem',
    '@tbm-insight/mcp-client',
    'zod',
)
cli=root/'apps/cli'
package_lookup={}
for pattern in ('packages/*/*/package.json','apps/*/package.json','vendor/*/package.json','native/system/package.json','native/system/packages/*/package.json'):
    for file in root.glob(pattern):
        data=json.loads(file.read_text(encoding='utf-8-sig'))
        package_lookup[data['name']]=file.parent.resolve()

def lookup(place,name):
    for parent in (place,*place.parents):
        candidate=parent/'node_modules'/name
        if (candidate/'package.json').is_file():
            return candidate.resolve()
    return package_lookup.get(name)

slots={}
queue=[]
links={}
def target_slot(package):
    package=package.resolve()
    if package not in slots:
        name=package.name
        digest=hashlib.sha256(str(package.relative_to(root) if package.is_relative_to(root) else package).encode()).hexdigest()[:12]
        slots[package]=f'node_modules/.modules/{digest}/{name}'
        queue.append(package)
    return slots[package]

def dependencies(place, prefix, is_root=False):
    data=json.loads((place/'package.json').read_text(encoding='utf-8'))
    names=set(data.get('dependencies',{}))|set(data.get('optionalDependencies',{}))|set(data.get('peerDependencies',{}))
    if is_root: names.update(product_dependencies)
    for name in sorted(names):
        candidate=lookup(place,name)
        if candidate:
            links[f'{prefix}node_modules/{name}']=target_slot(candidate)
        elif is_root and name in product_dependencies:
            raise SystemExit(f'Missing product dependency: {name}')
        elif name in data.get('dependencies',{}):
            print('missing',data.get('name'),name,flush=True)
dependencies(cli,'',True)
for package in queue:
    dependencies(package,slots[package]+'/')

# The shared native loader resolves platform packages from its own location.
# Make those installed prebuilds reachable from the loader as well as their consumers.
for package, slot in slots.items():
    if package.name not in {'node-addon-require-builtin-win32-x64-msvc',
                            'node-addon-internal-loader-win32-x64-msvc'}:
        continue
    alias = f'node_modules/{package.name}'
    if links.setdefault(alias, slot) != slot:
        raise SystemExit(f'Multiple versions of Windows native dependency: {package.name}')

print('packages',len(queue),'links',len(links),flush=True)

spec=importlib.util.spec_from_file_location('assemble',root/'tbm-insight/release/assemble-windows.py')
assembly=importlib.util.module_from_spec(spec)
spec.loader.exec_module(assembly)

def regular_tree(base):
    for folder,children,files in os.walk(base):
        children[:]=[d for d in children if d not in {'node_modules','__pycache__','.git','.cache'}
                     and not Path(folder,d).is_junction() and not Path(folder,d).is_symlink()]
        for filename in files:
            path=Path(folder,filename)
            if not path.is_symlink() and path.is_file():
                yield path

def package_payload(package):
    file=package/'package.json'
    data=json.loads(file.read_text(encoding='utf-8'))
    entries=data.get('files')
    workspace=package.parent == root/'apps' or package.is_relative_to(root/'packages') or package.is_relative_to(root/'vendor') or package.is_relative_to(root/'native')
    if not workspace: return list(regular_tree(package))
    payload={file}
    for pattern in entries or ('lib','dist','*.yml','*.yaml','*.md','src','*.mjs','*.js'):
        if pattern.startswith('!'): continue
        if pattern.endswith('/*'): pattern=pattern[:-2]
        for path in package.glob(pattern.removeprefix('./')):
            if path.is_dir() and not path.is_junction() and not path.is_symlink():
                payload.update(regular_tree(path))
            elif path.is_file() and not path.is_symlink():
                payload.add(path)
    payload.update(p for p in package.glob('LICENSE*') if p.is_file())
    return sorted(payload)
def write_package(archive,package):
    prefix=slots[package]
    for path in package_payload(package):
        if path.name.endswith(('.map','.tsbuildinfo')):
            continue
        archive.write(path,prefix+'/'+path.relative_to(package).as_posix())
    archive.writestr(prefix+'/node_modules/','')

def runtime_manifest():
    packages_by_slot = {slot: package for package, slot in slots.items()}
    dependencies = {}
    for link, slot in links.items():
        name = link.removeprefix('node_modules/')
        if name.startswith('.modules/'):
            continue
        package = packages_by_slot[slot]
        metadata = json.loads((package/'package.json').read_text(encoding='utf-8'))
        dependencies[name] = metadata['version']
    return {
        'name': 'tbm-insight',
        'private': True,
        'type': 'module',
        'dependencies': dependencies,
    }

with zipfile.ZipFile(target,'x',zipfile.ZIP_DEFLATED,compresslevel=2) as archive:
    archive.writestr('package.json',json.dumps(runtime_manifest(), indent=2)+'\n')
    for path in (cli/'lib').glob('*.js'):
        archive.write(path,path.relative_to(cli).as_posix())
    for path in assembly.product_files():
        archive.write(path,path.relative_to(root).as_posix())
    for name in ('node','python'):
        for path in regular_tree(root/'tbm-insight/.runtime'/name):
            if path.suffix=='.pyc': continue
            archive.write(path,path.relative_to(root).as_posix())
    for entry in ('LICENSE','THIRD_PARTY_NOTICES.md','启动 TBM Insight.cmd'):
        archive.write(root/entry,entry)
    archive.write(root/'tbm-insight/README.md','使用说明.md')
    for i,package in enumerate(queue):
        write_package(archive,package)
        if i%100==0: print('packed',i,flush=True)
    for parent in sorted({str(Path(link).parent).replace('\\','/') for link in links}):
        entry=parent+'/'
        if entry not in archive.NameToInfo: archive.writestr(entry,'')
    archive.writestr('runtime-links.json',json.dumps(sorted(links.items())))
print(target.stat().st_size,flush=True)
