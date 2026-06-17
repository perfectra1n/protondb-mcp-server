import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerSearchGames } from "./tools/search-games.js";
import { registerGetGameDetails } from "./tools/get-game-details.js";
import { registerGetReports } from "./tools/get-reports.js";
import { registerAnalyzeCompatibility } from "./tools/analyze-compatibility.js";
import { registerAnalyzeEnvironment } from "./tools/analyze-environment.js";
import { registerSearchReports } from "./tools/search-reports.js";

// Read the version from package.json at runtime so it stays in sync with
// release tooling (release-please / the monthly CalVer job).
const pkg = createRequire(import.meta.url)("../package.json") as { version: string };

/**
 * Server-level instructions (the MCP "system prompt"). Clients surface this to
 * the model. It tells the assistant to first understand the user's actual Linux
 * environment, then use that to filter/interpret ProtonDB reports.
 */
const INSTRUCTIONS = `
This server provides ProtonDB Linux/Proton game-compatibility data: individual
community reports (with Proton version, hardware, and free-text notes), aggregated
analysis, search, and Steam details.

IMPORTANT — understand the user's environment first. ProtonDB reports vary wildly by
distro, GPU vendor/driver, kernel, and how Steam/Proton are installed. Before giving
advice, determine the user's setup. If you have shell access, run (best-effort, skip
what fails) and note the results:

- Distro & base:        cat /etc/os-release            (ID, ID_LIKE, VARIANT_ID)
- NixOS:                test -e /etc/NIXOS && nixos-version ; command -v nix
- Atomic/immutable:     rpm-ostree status              (Fedora Silverblue/Kinoite/Bazzite)
                        steamos-readonly status        (Steam Deck / SteamOS)
- Package manager:      command -v apt dnf pacman zypper nix-env flatpak emerge xbps-install
- Kernel:               uname -r
- CPU / RAM:            lscpu | grep 'Model name' ; free -h
- GPU & driver:         lspci -nnk | grep -iA3 'vga\\|3d\\|display'
                        glxinfo -B 2>/dev/null | grep -iE 'opengl renderer|opengl version'
                        nvidia-smi --query-gpu=name,driver_version --format=csv 2>/dev/null
- Mesa (AMD/Intel):     glxinfo -B | grep -i 'mesa'
- Session:              echo "$XDG_SESSION_TYPE $XDG_CURRENT_DESKTOP"   (wayland vs x11)
- Steam install:        command -v steam ; flatpak list 2>/dev/null | grep -i steam
- Proton-GE present:    ls ~/.steam/root/compatibilitytools.d ~/.local/share/Steam/compatibilitytools.d 2>/dev/null

WHAT EACH REPORT CONTAINS. get_reports and search_reports return rich, lossless records —
use these fields, don't assume only a tier/verdict:
- Flat/indexed: verdict, works, protonVersion, launcher, launchOptions (the actual Steam
  launch flags the user ran, e.g. "gamemoderun %command%"), antiCheat, gpu, cpu, os,
  kernel, ram, timestamp, notes (all free-text note categories combined).
- responses: the FULL questionnaire — every fault (audio/graphical/performance/stability/
  input/windowing/saveGame), installs/opens/startsPlay, frameRate, batteryPerformance,
  verdictOob/triedOob, type/variant, multiplayer appraisals, per-category notes, etc.
- systemInfo: cpu, gpu, gpuDriver, kernel, os, ram, steamRuntimeVersion, xWindowManager.
- device/contributor: present on live reports (hardwareType, playtime, …).
- includeRaw:true on get_reports adds the byte-for-byte original record.
analyze_compatibility aggregates these into: verdict breakdown, working rate, best Proton
versions among working reports, bestLaunchOptions (flags that working reports used),
antiCheatReports (count), and GPU-vendor/distro splits — start here for "what works/flags".

Then map findings to the tools:
- Filter get_reports by gpuContains (their GPU vendor/model) and protonVersionContains
  (a Proton/GE version they can actually install).
- The launchOptions field + analyze_compatibility.bestLaunchOptions are the direct answer
  to "what launch flags should I use" — prefer flags that recur in working reports on
  similar hardware/distro.
- Use search_reports for environment-specific gotchas, e.g. "nixos", "flatpak",
  "wayland", "silverblue", "steam deck", "anti-cheat", "gamescope".
- analyze_environment aggregates ALL reports matching an environment keyword (e.g.
  "nixos", "bazzite", "wayland") into the same patterns as analyze_compatibility —
  use it for cross-game "what flags/fixes work for <environment>" questions.
- Prefer analyze_compatibility for a quick overview, then drill in with get_reports.
- Caveats: NixOS often needs steam-run/FHS or extraPkgs; Flatpak Steam is sandboxed
  (paths/launchers differ); atomic distros (Silverblue/Bazzite/SteamOS) constrain which
  drivers/Proton builds are available; NVIDIA vs AMD/Intel (Mesa) behavior differs a lot.

TROUBLESHOOTING — common commands and fixes (when a game won't run or runs poorly).
Many report notes reference these; suggest them adapted to the user's <appId> and distro:
- Steam launch options (right-click game > Properties > Launch Options, "%command%"):
    PROTON_LOG=1 %command%       -> writes ~/steam-<appid>.log for debugging
    gamemoderun %command%        -> CPU/GPU governor tuning (needs gamemode)
    mangohud %command%           -> perf overlay; DXVK_HUD=fps,gpuload for DXVK stats
    PROTON_USE_WINED3D=1 %command%   -> fall back from DXVK if Vulkan is broken
- Pick/force a Proton or GE-Proton build: Properties > Compatibility; GE builds live in
    ~/.steam/root/compatibilitytools.d or ~/.local/share/Steam/compatibilitytools.d
- Reset a broken prefix: delete the per-game compatdata, then relaunch:
    rm -rf ~/.steam/steam/steamapps/compatdata/<appid>   (Flatpak: ~/.var/app/com.valvesoftware.Steam/.local/share/Steam/...)
- Verify game files: Properties > Installed Files > Verify integrity of game files
- protontricks (often Flatpak) for winetricks verbs/components:
    protontricks <appid> --gui ; protontricks <appid> vcrun2019 dotnet48
- Vulkan / driver health (32-bit libs are required for most games):
    vulkaninfo | grep -i deviceName ; vkcube ; glxinfo -B | grep -iE 'renderer|version'
    nvidia-smi ; inxi -G ; check Mesa / lib32-* / 32-bit vulkan driver packages
- Anti-cheat: confirm EAC/BattlEye Linux support (areweanticheatyet.com) and enable the
    Proton EAC/BattlEye runtime; many "borked" reports are anti-cheat, not Proton.
- Shaders/stutter: enable Steam shader pre-caching; try a newer Proton-GE; RADV_PERFTEST,
    mesa_glthread=true (AMD/Intel), or DXVK async builds.
- Flatpak Steam sandbox: grant access if a drive/launcher isn't visible, e.g.
    flatpak override --user com.valvesoftware.Steam --filesystem=/mnt/games
- NixOS: programs.steam.enable = true; hardware.graphics.enable = true; run non-Steam
    binaries via "steam-run ./game"; use extraPkgs/FHS for missing libraries.
- When a game won't start, check logs: journalctl --user -b -e ; dmesg | tail ;
    PROTON_LOG, and "ldd" on the binary for missing libraries.

Typical flow: search_games (name -> appId) -> analyze_compatibility -> get_reports /
search_reports filtered to the user's hardware and distro -> recommend the launch
options / Proton version / fixes that recurring reports show working on similar setups.
`.trim();

/** Build a fully-configured ProtonDB MCP server (no transport attached). */
export function buildServer(): McpServer {
  const server = new McpServer(
    {
      name: "protondb-mcp",
      version: pkg.version,
    },
    { instructions: INSTRUCTIONS },
  );

  registerSearchGames(server);
  registerGetGameDetails(server);
  registerGetReports(server);
  registerAnalyzeCompatibility(server);
  registerAnalyzeEnvironment(server);
  registerSearchReports(server);

  return server;
}
