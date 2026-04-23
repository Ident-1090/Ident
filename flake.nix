{
  description = "Ident ADS-B receiver display development shell";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs =
    { self, nixpkgs }:
    let
      systems = [
        "aarch64-darwin"
        "aarch64-linux"
        "x86_64-darwin"
        "x86_64-linux"
      ];
      forAllSystems = nixpkgs.lib.genAttrs systems;
      pkgsFor = system: import nixpkgs { inherit system; };
      toolsFor =
        pkgs:
        let
          goPkg = pkgs.go_1_26 or pkgs.go;
          nodePkg = pkgs.nodejs_24 or pkgs.nodejs;
          pnpmPkg = pkgs.pnpm_10 or pkgs.pnpm;
        in
        {
          inherit goPkg nodePkg pnpmPkg;
          common = [
            goPkg
            nodePkg
            pnpmPkg
            pkgs.git
            pkgs.nfpm
            pkgs.ripgrep
            pkgs.rsync
          ];
        };
    in
    {
      devShells = forAllSystems (
        system:
        let
          pkgs = pkgsFor system;
          tools = toolsFor pkgs;
        in
        {
          default = pkgs.mkShell {
            packages = tools.common;
            shellHook = ''
              export HUSKY=0
              echo "Ident dev shell: Go $(${tools.goPkg}/bin/go version | awk '{print $3}'), Node $(${tools.nodePkg}/bin/node --version)"
            '';
          };
        }
      );

      apps = forAllSystems (
        system:
        let
          pkgs = pkgsFor system;
          tools = toolsFor pkgs;
          buildIdentd = pkgs.writeShellApplication {
            name = "build-identd";
            runtimeInputs = tools.common;
            text = ''
              exec ./scripts/build-identd.sh "$@"
            '';
          };
          packageIdentd = pkgs.writeShellApplication {
            name = "package-identd";
            runtimeInputs = tools.common;
            text = ''
              exec ./scripts/package-identd.sh "$@"
            '';
          };
        in
        {
          build-identd = {
            type = "app";
            program = "${buildIdentd}/bin/build-identd";
          };
          package-identd = {
            type = "app";
            program = "${packageIdentd}/bin/package-identd";
          };
        }
      );
    };
}
