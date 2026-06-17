# Changelog

## [2026.6.8](https://github.com/perfectra1n/protondb-mcp-server/compare/v2026.6.7...v2026.6.8) (2026-06-17)


### Features

* **tools:** enrich analysis with OOB rate, faults, launchers, WMs ([1fca50e](https://github.com/perfectra1n/protondb-mcp-server/commit/1fca50ee43aecb609a885a5f96e588423ff78b47))

## [2026.6.7](https://github.com/perfectra1n/protondb-mcp-server/compare/v2026.6.6...v2026.6.7) (2026-06-17)


### Features

* **dev:** yay format ([f7ba9cb](https://github.com/perfectra1n/protondb-mcp-server/commit/f7ba9cbbabef10141e7df20cbee6daeb385a83fd))
* **tools:** add some more useful tools ([516cafc](https://github.com/perfectra1n/protondb-mcp-server/commit/516cafc74fef9979b1c3681f5bfe129f60491618))
* **tools:** update tools too ([d641900](https://github.com/perfectra1n/protondb-mcp-server/commit/d641900e29d9b90fd8ba4479a6d5521fa8a41f77))

## [2026.6.6](https://github.com/perfectra1n/protondb-mcp-server/compare/v2026.6.5...v2026.6.6) (2026-06-15)


### Features

* refactor ([8ffe324](https://github.com/perfectra1n/protondb-mcp-server/commit/8ffe3245d36ef06461579e0c6b49d61e37d0725b))

## [2026.6.5](https://github.com/perfectra1n/protondb-mcp-server/compare/v2026.6.4...v2026.6.5) (2026-06-15)


### Bug Fixes

* tidy http-server entrypoint (force release of recent prompt/field changes) ([edec851](https://github.com/perfectra1n/protondb-mcp-server/commit/edec85131cb27d27e18e141cf5618bc2370cc49e))

## [2026.6.4](https://github.com/perfectra1n/protondb-mcp-server/compare/v2026.6.3...v2026.6.4) (2026-06-15)


### Features

* bake DB snapshot into the image (seed-on-empty start) ([efdb190](https://github.com/perfectra1n/protondb-mcp-server/commit/efdb19038f31d6f978da48df20fd3704de2860c3))
* capture every report field; native user_version migrations ([1b6c93b](https://github.com/perfectra1n/protondb-mcp-server/commit/1b6c93bfa8708325c7812a88566b099a0f2cd06a))
* readiness gate instead of baking the DB into the image ([3a31606](https://github.com/perfectra1n/protondb-mcp-server/commit/3a3160621e272673fe5d091f4793323cd1e6696d))


### Bug Fixes

* install build toolchain in Dockerfile.playwright so better-sqlite3 compiles ([97186e3](https://github.com/perfectra1n/protondb-mcp-server/commit/97186e347fe05ae37037520854e029396c078bf7))

## [2026.6.3](https://github.com/perfectra1n/protondb-mcp-server/compare/v2026.6.2...v2026.6.3) (2026-06-15)


### Bug Fixes

* search_games crashed on null/non-numeric Algolia fields ([8ec6cc8](https://github.com/perfectra1n/protondb-mcp-server/commit/8ec6cc8841b09e449b069895b71bc912dee84d9a))

## [2026.6.2](https://github.com/perfectra1n/protondb-mcp-server/compare/v2026.6.1...v2026.6.2) (2026-06-15)


### Features

* optional shared-token auth for the HTTP transport ([abb4ec7](https://github.com/perfectra1n/protondb-mcp-server/commit/abb4ec7e123dba71f09007d74d0ffbc70a4d5e74))

## [2026.6.1](https://github.com/perfectra1n/protondb-mcp-server/compare/v2026.6.0...v2026.6.1) (2026-06-14)


### Features

* add Linux-environment instructions and general report search ([9fa8b2c](https://github.com/perfectra1n/protondb-mcp-server/commit/9fa8b2c6691b2d9c37b5de3cb28f934f1a685b04))
* make all settings env-configurable; thorough README ([a0232a4](https://github.com/perfectra1n/protondb-mcp-server/commit/a0232a424fc75070e761101c41dbaf3c38abe1ad))
* ProtonDB MCP server with bulk+live data, Docker, and CI/CD ([673799d](https://github.com/perfectra1n/protondb-mcp-server/commit/673799d5413fc28c9ee22a604221fc98ef17ff1a))


### Bug Fixes

* cross-device DB swap in containers; add Linux troubleshooting prompt ([bccc63f](https://github.com/perfectra1n/protondb-mcp-server/commit/bccc63f2f1c8da8cc3af6d3bd9d6b31cea662929))
