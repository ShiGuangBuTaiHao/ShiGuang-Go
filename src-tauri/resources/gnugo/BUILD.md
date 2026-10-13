# GNU Go referee runtime

This directory contains the Windows x64 GNU Go 3.8 executable, compiled
locally from the upstream source. No neural-network model or Cygwin DLL
is required. The executable is a separately invoked GTP process.

- Upstream: https://www.gnu.org/software/gnugo/
- Source: https://ftp.gnu.org/gnu/gnugo/gnugo-3.8.tar.gz
- Download mirror used: https://mirrors.tuna.tsinghua.edu.cn/gnu/gnugo/gnugo-3.8.tar.gz
- Source archive: `gnugo-3.8-source.tar.gz`
- Source SHA256: `da68d7a65f44dcf6ce6e4e630b6f6dd9897249d34425920bfdd4e07ff1866a72`
- License: GPL-3.0-or-later; see `COPYING` and the bundled source archive.

The executable and DLL files are ignored by git, like the existing KataGo
runtimes. Keep the executable present before building a desktop installer.
Do not distribute the engine without its license and corresponding source.
The bundled source archive plus `modern-cmake.patch` reproduce this build.
Review licensing obligations before distributing the complete application.

## Build on Windows

Requires Visual Studio 2022 C++ Build Tools and CMake. Extract the source,
apply `modern-cmake.patch`, then run:

```powershell
cmake -S gnugo-3.8 -B gnugo-build -G "Visual Studio 17 2022" -A x64
cmake --build gnugo-build --config Release --target gnugo --parallel 4
Copy-Item gnugo-build/interface/Release/gnugo.exe ./gnugo.exe
```

For other platforms, build GNU Go from the bundled source and put the
`gnugo` executable in this directory. Alternatively, set `GNUGO_EXECUTABLE`
to an absolute executable path before starting the desktop application.

## Runtime behavior

The referee starts only when requested. It uses level 8, an 8 MB search
cache, and deterministic seed 0. GTP moves are replayed into an isolated
process; `final_score 0` and the dead/seki status queries share that seed.
The player's board and move history are never replaced by engine moves.

There is a 120-second deadline. Cancellation or completion terminates the
process. Chinese and Japanese rules are supported. AGA requests are rejected
because silently substituting Chinese rules would not be an AGA referee.

Chinese setup komi is displayed in zi; the frontend converts it to points
before invoking GNU Go. The returned point margin is saved verbatim.

## Position estimation

`gnugo_estimate` reuses the isolated GTP process with a 30-second deadline,
calls `estimate_score` and `initial_influence <side> influence_regions`, and
never calls `final_score` or generates follow-up moves. Score bounds are
normalized to Black's perspective. Influence regions are integer category
labels (-4..4), not win rates or ownership probabilities. A board change,
explicit cancellation, or leaving the view terminates any pending request.

Local counting applications request an additional readiness check before
scoring. This checks the estimate interval, weak influence regions (1/2),
critical/unknown dragon statuses, and requires both `reg_genmove B` and
`reg_genmove W` to return PASS. Neutral dame alone is not uncertainty.
Only then is `final_score` called. The scoring IPC enforces the gate again.
This is a conservative GNU Go heuristic, not a proof of a settled position.
