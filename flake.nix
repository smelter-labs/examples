{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs = inputs@{ flake-parts, ... }:
    flake-parts.lib.mkFlake { inherit inputs; } {
      systems = [ "x86_64-linux" "aarch64-linux" "aarch64-darwin" "x86_64-darwin" ];
      perSystem = { config, self', inputs', pkgs, system, lib, ... }:
        let
          # ROCm-enabled package set for the node-yolo-whisper sidecar, so YOLO
          # (Ultralytics) and Whisper (HF transformers) run on the AMD GPU.
          # `config.rocmSupport` flips torch + downstream to the ROCm backend.
          # No gpuTargets override, so torch is built for nixpkgs' full default
          # ROCm arch list — keeps the flake portable across AMD cards at the
          # cost of a larger torch compile. To trim build time to a single card,
          # override torch with `gpuTargets = [ "gfxNNNN" ]` via an overlay here.
          pkgsRocm = import inputs.nixpkgs {
            inherit system;
            config = {
              rocmSupport = true;
              allowUnfree = true;
            };
          };
          pyPkgs = pkgsRocm.python3Packages;

          # Native libs the Smelter binary (auto-spawned by @swmansion/smelter-node)
          # dynamically links against — see node-yolo-whisper.
          smelterRuntimeLibs = with pkgs; [
            libopus
            openssl
            ffmpeg
            vulkan-loader
            stdenv.cc.cc.lib
          ];

          # smelter-sdk is not yet packaged in nixpkgs; build it from the
          # upstream wheel. Pure-python, only numpy at runtime.
          smelter-sdk = pyPkgs.buildPythonPackage rec {
            pname = "smelter-sdk";
            version = "0.1.0";
            format = "wheel";
            src = pkgs.fetchPypi {
              inherit version format;
              pname = "smelter_sdk";
              dist = "py3";
              python = "py3";
              hash = "sha256-M4+shyOW6YcVRmC2dhPA8tw4g6WBPjOMypx+FUIeNKY=";
            };
            propagatedBuildInputs = [ pyPkgs.numpy ];
            doCheck = false;
          };

          # silero-vad isn't in nixpkgs — build from PyPI source.
          silero-vad = pyPkgs.buildPythonPackage rec {
            pname = "silero-vad";
            version = "5.1.2";
            pyproject = true;
            src = pkgs.fetchPypi {
              inherit version;
              pname = "silero_vad";
              hash = "sha256-xEKXEWACbS16oK2D8MfuhsiXl6ZSif5iXI6ln8b7go0=";
            };
            nativeBuildInputs = [ pyPkgs.hatchling ];
            propagatedBuildInputs = with pyPkgs; [
              torch
              torchaudio
              onnxruntime
            ];
            doCheck = false;
          };

          # Python environment for the node-yolo-whisper sidecar. Whisper runs
          # via HF transformers (not faster-whisper, whose CTranslate2 backend
          # is CUDA-only) so it shares the ROCm torch with Ultralytics/YOLO.
          pythonEnv = pkgsRocm.python3.withPackages (ps: with ps; [
            ultralytics
            transformers
            accelerate
            websockets
            numpy
            smelter-sdk
            silero-vad
            pip
          ]);
        in
        {
          packages.pythonEnv = pythonEnv;

          devShells = {
            default = pkgs.mkShell {
              packages = with pkgs; [
                pnpm
                nodejs
                ty
                ruff
                pythonEnv
              ] ++ smelterRuntimeLibs;

              shellHook = ''
                export LD_LIBRARY_PATH=${lib.makeLibraryPath smelterRuntimeLibs}:$LD_LIBRARY_PATH
              '';
            };
          };
        };
    };
}
