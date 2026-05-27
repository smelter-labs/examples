{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs = inputs@{ flake-parts, ... }:
    flake-parts.lib.mkFlake { inherit inputs; } {
      systems = [ "x86_64-linux" "aarch64-linux" "aarch64-darwin" "x86_64-darwin" ];
      perSystem = { config, self', inputs', pkgs, system, lib, ... }:
        let
          # Native libs the Smelter binary (auto-spawned by @swmansion/smelter-node)
          # dynamically links against — see yolo-whisper-node.
          smelterRuntimeLibs = with pkgs; [
            libopus
            openssl
            ffmpeg
            vulkan-loader
            stdenv.cc.cc.lib
          ];

          # smelter-sdk is not yet packaged in nixpkgs; build it from the
          # upstream wheel. Pure-python, only numpy at runtime.
          smelter-sdk = pkgs.python3Packages.buildPythonPackage rec {
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
            propagatedBuildInputs = [ pkgs.python3Packages.numpy ];
            doCheck = false;
          };

          # silero-vad isn't in nixpkgs — build from PyPI source.
          silero-vad = pkgs.python3Packages.buildPythonPackage rec {
            pname = "silero-vad";
            version = "5.1.2";
            pyproject = true;
            src = pkgs.fetchPypi {
              inherit version;
              pname = "silero_vad";
              hash = "sha256-xEKXEWACbS16oK2D8MfuhsiXl6ZSif5iXI6ln8b7go0=";
            };
            nativeBuildInputs = [ pkgs.python3Packages.hatchling ];
            propagatedBuildInputs = with pkgs.python3Packages; [
              torch
              torchaudio
              onnxruntime
            ];
            doCheck = false;
          };

          # Python environment for the yolo-whisper-node sidecar.
          pythonEnv = pkgs.python3.withPackages (ps: with ps; [
            ultralytics
            faster-whisper
            websockets
            numpy
            smelter-sdk
            silero-vad
            pip
          ]);
        in
        {
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
