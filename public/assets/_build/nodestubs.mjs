// Minimal DOM stubs so three's GLTFLoader can parse glTF in Node without decoding textures (offline tools + tests only).
export function installStubs() {
  globalThis.self ??= globalThis;
  if (!globalThis.document) {
    globalThis.document = {
      createElementNS(ns, name) {
        const el = new EventTarget();
        el.nodeName = name; el.style = {}; el.width = 4; el.height = 4; el.naturalWidth = 4; el.naturalHeight = 4;
        let src = '';
        Object.defineProperty(el, 'src', { get: () => src, set: (v) => { src = v; el.loadedUrls?.push(v); setTimeout(() => el.dispatchEvent(new Event('load')), 0); } });
        return el;
      },
      createElement(name) { return this.createElementNS('', name); },
    };
  }
}
