{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    # Smelter compositor binary, built from source at commit 9211c898 (master
    # right after the ts-sdk 0.5.0-rc.1 publish). Not pinned to 482f554a (the
    # build smelter-node 0.5.0-rc.1 downloads) because its Cargo.lock has a
    # duplicate mp4-0.14.0 crate and its tools/nix package lacks aws-lc, so it
    # does not build with nix.
    # The flake lives in the tools/nix subdirectory of the repo.
    smelter.url = "github:software-mansion/smelter/9211c89888a1b2302c2849db23a22c6be5160b53?dir=tools/nix";
  };

  outputs = inputs@{ flake-parts, ... }:
    flake-parts.lib.mkFlake { inherit inputs; } {
      systems = [ "x86_64-linux" "aarch64-linux" "aarch64-darwin" "x86_64-darwin" ];
      perSystem = { config, self', inputs', pkgs, system, lib, ... }:
        let
          # Smelter compositor binary built from commit 9211c898 (tools/nix flake).
          # @swmansion/smelter-node uses SMELTER_PATH instead of downloading a
          # prebuilt binary when it is set — see the devShell shellHook below.
          smelter = inputs'.smelter.packages.default;

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

          # Python environment for the node-yolo-whisper sidecar.
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
                ffmpeg
                smelter
              ];

              shellHook = ''
                export SMELTER_PATH=${smelter}/bin/smelter
              '';
            };
          };
        };
    };
}
