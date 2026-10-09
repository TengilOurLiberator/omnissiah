// Static analysis of a creation's source: which game mechanisms it touches.
// ------------------------------------------------------------------ static source analysis
export function analyzeSource(src) {
  const has = (re) => re.test(src);
  const uses = new Set();
  const add = (name, re) => { if (has(re)) uses.add(name); };
  add('library', /\blibrary\b|\blib\s*\.\s*(spawn|wave)|\blib\?\.(spawn|wave)/);
  add('models', /models\??\.(spawn|instances|find|has|list|preload)|\bM\??\.(spawn|instances)/);
  add('generate', /\.generate\s*\(\s*ctx/);
  add('travel', /travel\??\.(go|home)/);
  add('blast', /blast\??\.(create|open)/);
  add('kit', /\bkit\b|world\??\.kit/);
  add('kit.actor', /kit\??\.(humanoid|creature|actor)\s*\(/);
  add('combat.fighter', /combat\??\.(fighter|wave|fire)\s*\(/);
  add('physics', /physics\b|\bP\??\.(body|joint|vehicle|ragdoll|raycast|explode|character)/);
  add('kit.body', /kit\??\.body\s*\(/);
  add('audio', /world\??\.audio|\bA\??\.(sfx|music)\b|audio\??\.(sfx|music)/);
  add('kit.sound', /kit\??\.sound\s*\(/);
  add('voices', /voices\b/);
  add('persona', /\bpersona\b|\bnpcName\b|\.role\s*=/);
  add('quests', /quests\??\.(offer|advance|complete)/);
  add('menu', /menu\??\.register/);
  add('perf', /perf\??\.(allow|canSpawn|headroom)/);
  add('weapons', /weapons\??\.(create|define)/);
  add('spells', /spells\??\.register/);
  add('env', /world\??\.env\b|\benv\??\.\w+\(/);
  add('style', /world\??\.style\b/);
  add('player', /world\??\.player\b/);
  add('oracle-body', /world\??\.oracle\??\.(flare|beamTo|setMood|lookAt|creation)/);
  add('commentary', /world\??\.commentary/);
  add('threeMesh', /new\s+(ctx\.)?THREE\.(Mesh|InstancedMesh|Points|Line|Sprite)\b|new\s+THREE\.(Mesh|InstancedMesh)|const\s*\{[^}]*Mesh[^}]*\}\s*=\s*THREE/);
  add('update', /\bupdate\s*\(\s*(dt|d|delta|_dt)?\s*(,\s*\w+)?\s*\)\s*\{/);
  return [...uses];
}
export function librarySpawnedNames(src) {
  const names = new Set();
  for (const m of src.matchAll(/(?:spawn|wave)\s*\(\s*ctx\s*,\s*(?:\[([^\]]*)\]|['"`]([^'"`]+)['"`])/g)) {
    if (m[2]) names.add(m[2]);
    if (m[1]) for (const n of m[1].matchAll(/name\s*:\s*['"`]([^'"`]+)/g)) names.add(n[1]);
  }
  return [...names];
}


