# @kirknock/node-openxr-babylonjs

[![CI](https://github.com/kirknock/node-openxr-babylonjs/actions/workflows/ci.yml/badge.svg)](https://github.com/kirknock/node-openxr-babylonjs/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@kirknock/node-openxr-babylonjs)](https://www.npmjs.com/package/@kirknock/node-openxr-babylonjs)

Plain browser-style Babylon.js WebXR helpers the node-openxr demo app is
built from: `create-engine`, `xr` (WebXRDefaultExperience setup),
`list-files`, `load-asset`, `asset-slideshow`, `dot-grid-floor`,
`controller-visuals`, `controller-log`. Imports only `@babylonjs/*` (peer
dependencies), so it runs in a browser unchanged.

## Install

```bash
npm install @kirknock/node-openxr-babylonjs @babylonjs/core@9.33.2 @babylonjs/loaders@9.33.2
```

Modules are imported by path, e.g.
`@kirknock/node-openxr-babylonjs/xr.js`.

## Development

```bash
npm ci
npm run build        # dist/
npm run lint && npm run typecheck
npm test             # pure group: controller logging over IWER + NullEngine
npm run push         # build + yalc push to local consumers
```

Tests run on [`@kirknock/node-openxr-core`](https://www.npmjs.com/package/@kirknock/node-openxr-core)
(dev dependency): its IWER runtime and the `nodexr-test` runner.

## Releasing

Bump `version` in `package.json`, commit, then push a matching tag:

```bash
npm version patch    # or minor / major / prerelease --preid beta
git push --follow-tags
```

The `Release` workflow checks the tag, lints, tests, publishes to npm via
trusted publishing (with provenance) and creates a GitHub release with the
tarball attached.

## License

MIT
